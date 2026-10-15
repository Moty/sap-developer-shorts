import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateEpisode } from "../contracts.js";
import { hash } from "../digest.js";
import { type ContentEpisode, isNewsEpisode } from "../domain.js";
import { assertNewsEvidence, validateNewsEpisode } from "../news/contracts.js";
import { inside, projectRoot, sourceFile } from "../paths.js";
import { assertEvidence, type Manifest, prepareContentEpisode } from "../pipeline.js";
import { currentNarrationGeneratorHash } from "./fingerprint.js";
import type {
  FakeScenario,
  MediaJob,
  MediaPhase,
  MediaProvider,
  MediaRequest,
  ProductionSettings,
} from "./model.js";
import { kokoroOperationTimeoutMs, neuralRuntime } from "./neural.js";
import { packageNarration, readCompletedNarration } from "./package.js";
import { FakeProvider, LocalSpeechProvider } from "./providers.js";
import { MediaStore } from "./store.js";
import { supportsKokoroVoice } from "./voices.js";

export const mediaRoot = resolve(projectRoot, ".state/media");
export const mediaDatabase = resolve(mediaRoot, "jobs.sqlite");

export async function productionSettings(): Promise<ProductionSettings> {
  return validateProductionSettings(
    JSON.parse(await readFile(await sourceFile("config/production.json"), "utf8")),
  );
}

export function validateProductionSettings(value: unknown): ProductionSettings {
  const settings = value as ProductionSettings;
  if (
    settings?.schemaVersion !== 1 ||
    settings.presenter !== "stock" ||
    settings.currency !== "USD" ||
    settings.liveProvider !== null ||
    !Number.isSafeInteger(settings.pilotBudgetCents) ||
    settings.pilotBudgetCents < 0 ||
    !settings.localPreview?.voice ||
    settings.localPreview.sampleRate !== 22050 ||
    !Number.isInteger(settings.localPreview.wordsPerMinute) ||
    settings.localPreview.wordsPerMinute < 120 ||
    settings.localPreview.wordsPerMinute > 220 ||
    (settings.localPreview.engine !== undefined &&
      !["system", "kokoro"].includes(settings.localPreview.engine)) ||
    (settings.localPreview.engine === "kokoro" &&
      (!supportsKokoroVoice(settings.localPreview.voice) ||
        !Number.isFinite(settings.localPreview.speed) ||
        (settings.localPreview.speed ?? 0) < 0.8 ||
        (settings.localPreview.speed ?? Infinity) > 1.2))
  )
    throw new Error("Invalid production settings");
  return settings;
}

export async function loadVerifiedRun(
  directory: string,
  options: { requireFreshNews?: boolean } = {},
) {
  const artifactDirectory = await realpath(directory);
  const readArtifact = async (name: string) =>
    readFile(inside(artifactDirectory, await realpath(inside(artifactDirectory, name))));
  const manifestText = (await readArtifact("manifest.json")).toString("utf8");
  const manifest = JSON.parse(manifestText) as Manifest;
  if (manifest.schemaVersion !== 1 || manifest.stage !== "PREVIEW_READY")
    throw new Error("Media requires a verified preview run");
  for (const required of ["episode.json", "review.html"]) {
    if (!manifest.artifactHashes?.[required])
      throw new Error(`Missing verified artifact: ${required}`);
  }
  for (const [file, digest] of Object.entries(manifest.artifactHashes)) {
    if (!/^[a-zA-Z0-9.-]+$/u.test(file) || hash(await readArtifact(file)) !== digest)
      throw new Error(`Verified artifact changed: ${file}`);
  }
  const input = JSON.parse((await readArtifact("episode.json")).toString("utf8"));
  const episode: ContentEpisode =
    input?.format === "news"
      ? validateNewsEpisode(input, { requireFresh: options.requireFreshNews !== false })
      : validateEpisode(input);
  if (hash(JSON.stringify(episode)) !== manifest.inputHash)
    throw new Error("Verified episode input hash differs");
  const evidenceName = isNewsEpisode(episode) ? "news-evidence.json" : "demo-evidence.json";
  if (!manifest.artifactHashes[evidenceName])
    throw new Error(`Missing verified artifact: ${evidenceName}`);
  const evidence = JSON.parse((await readArtifact(evidenceName)).toString("utf8"));
  if (isNewsEpisode(episode)) {
    if (!manifest.history.some((entry) => entry.stage === "SOURCES_CHECKED"))
      throw new Error("News run has no source review stage");
    assertNewsEvidence(evidence, episode);
  } else assertEvidence(evidence, episode);
  if (!(await readArtifact("review.html")).toString("utf8").includes("<!--MEDIA_PLAYER-->"))
    throw new Error("Regenerate the preview before adding narration");
  return { manifest, manifestHash: hash(manifestText), episode };
}

export async function createMediaJob(
  store: MediaStore,
  directory: string,
  provider: MediaProvider,
  settings: ProductionSettings,
  scenario: FakeScenario = "success",
): Promise<MediaJob> {
  const source = await loadVerifiedRun(directory);
  if (provider.id === "local-speech" && source.episode.presentation?.format === "dialogue")
    throw new Error("Two-person dialogue requires the Kokoro narrator");
  settings = structuredClone(settings);
  const speakers = source.episode.presentation?.speakers;
  if (provider.id === "local-kokoro" && speakers?.[0])
    settings.localPreview.voice = speakers[0].voice;
  const runtime =
    provider.id === "local-kokoro"
      ? await neuralRuntime(
          speakers?.map((speaker) => speaker.voice) ?? [settings.localPreview.voice],
        )
      : undefined;
  if (runtime && runtime.voice !== settings.localPreview.voice)
    throw new Error("Configured narrator differs from the installed voice; run voice-setup");
  const request: MediaRequest = {
    schemaVersion: 1 as const,
    episode: source.episode,
    settings: structuredClone(settings),
    provider: provider.id,
    scenario,
    sourceDirectory: resolve(directory),
    sourceManifestHash: source.manifestHash,
    generatorHash: await currentNarrationGeneratorHash(provider.id),
    ...(runtime ? { voiceRuntimeHash: runtime.hash } : {}),
  };
  const requestKey = hash(
    JSON.stringify({
      episode: request.episode,
      artifactRoot: dirname(await realpath(directory)),
      settings,
      provider: provider.id,
      scenario,
      sourceHashes: source.manifest.sourceHashes,
      voiceRuntimeHash: request.voiceRuntimeHash,
      generatorHash: request.generatorHash,
    }),
  );
  const at = new Date().toISOString();
  const job: MediaJob = {
    schemaVersion: 1,
    id: randomUUID(),
    requestKey,
    requestHash: hash(JSON.stringify(request)),
    request,
    phase: "PLANNED",
    providerJobId: null,
    providerOutput: null,
    quoteCents: provider.quote(request),
    billedCents: null,
    outputDirectory: null,
    error: null,
    progress: null,
    createdAt: at,
    updatedAt: at,
    history: [{ phase: "PLANNED", at }],
  };
  const scope = `${provider.billing === "simulated" ? "simulation" : "production"}:${source.episode.id}`;
  // A fresh verified source can recover definitively local failures. Keep old
  // records and never reinterpret an uncertain submission as permission to resend.
  for (let attempt = 0; attempt < 100; attempt++) {
    const existing = store.findByKey(job.requestKey);
    if (!existing) return store.create(job, scope);
    let recover = provider.billing === "free" && existing.phase === "FAILED";
    if (
      provider.billing === "free" &&
      !["SUBMITTING", "SUBMISSION_UNKNOWN"].includes(existing.phase)
    ) {
      try {
        const saved = await loadVerifiedRun(existing.request.sourceDirectory);
        if (saved.manifestHash !== existing.request.sourceManifestHash) recover = true;
        if (existing.phase === "SUCCEEDED") {
          await readCompletedNarration(existing);
        }
      } catch {
        recover = true;
      }
    }
    if (!recover) return existing;
    job.retryOf = existing.id;
    job.requestKey = hash(JSON.stringify({ requestKey, afterLocalAttempt: existing.id }));
  }
  throw new Error("Too many failed local attempts; inspect the saved jobs before retrying");
}

async function bounded<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  settleAfterAbort = false,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = action(controller.signal);
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Provider operation timed out"));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // Local Kokoro cancellation confirms child close before the lease is released.
    if (settleAfterAbort && controller.signal.aborted) await pending.catch(() => undefined);
  }
}

export function mediaOperationTimeoutMs(
  provider: MediaProvider["id"],
  operation: "submit" | "lookup" | "poll",
  override?: number,
) {
  return (
    override ??
    (provider === "local-kokoro" && operation === "poll" ? kokoroOperationTimeoutMs : 25_000)
  );
}

export async function advanceMediaJob(
  store: MediaStore,
  id: string,
  provider: MediaProvider,
  timeoutMs?: number,
): Promise<MediaJob> {
  const owner = store.acquire(id);
  try {
    const job = store.get(id);
    if (job.request.provider !== provider.id)
      throw new Error("Media provider does not match the saved request");
    if (["SUCCEEDED", "SIMULATED", "FAILED"].includes(job.phase)) return job;
    const move = (phase: MediaPhase, error: string | null = null) => {
      job.phase = phase;
      job.updatedAt = new Date().toISOString();
      job.error = error;
      if (job.history.at(-1)?.phase !== phase) job.history.push({ phase, at: job.updatedAt });
      store.save(job, owner);
    };
    try {
      if (
        job.request.generatorHash &&
        job.request.generatorHash !== (await currentNarrationGeneratorHash(provider.id))
      )
        throw new Error(
          "Narration generator changed; start a new narration job for the current renderer",
        );
      const source = await loadVerifiedRun(job.request.sourceDirectory);
      if (source.manifestHash !== job.request.sourceManifestHash)
        throw new Error("Saved source run changed");
    } catch (error) {
      move("FAILED", error instanceof Error ? error.message : "Saved source run is invalid");
      return job;
    }
    if (
      provider.id !== "fake" &&
      !job.request.generatorHash &&
      ["PLANNED", "SUBMITTED", "PROCESSING", "POLL_TIMEOUT"].includes(job.phase)
    ) {
      move(
        "FAILED",
        "This unfinished legacy recording has no synthesis-code fingerprint. Run narrate to create a fresh local attempt.",
      );
      return job;
    }
    if (job.phase === "SUBMITTING")
      move("SUBMISSION_UNKNOWN", "Worker stopped before submission was confirmed");
    if (job.phase === "SUBMISSION_UNKNOWN") {
      try {
        const found = await bounded(
          (signal) => provider.lookup(job.requestKey, signal),
          mediaOperationTimeoutMs(provider.id, "lookup", timeoutMs),
        );
        if (found.state === "found") {
          if (!found.id) throw new Error("Provider lookup returned no job ID");
          job.providerJobId = found.id;
          move("SUBMITTED");
        }
      } catch {
        move("SUBMISSION_UNKNOWN", "Provider lookup could not confirm submission");
      }
      return job;
    }
    if (job.phase === "PLANNED") {
      move("SUBMITTING");
      try {
        const providerId = await bounded(
          (signal) => provider.submit(structuredClone(job.request), job.requestKey, signal),
          mediaOperationTimeoutMs(provider.id, "submit", timeoutMs),
        );
        if (typeof providerId !== "string" || !providerId.length)
          throw new Error("Provider returned no job ID");
        job.providerJobId = providerId;
        move("SUBMITTED");
      } catch {
        move(
          "SUBMISSION_UNKNOWN",
          "Submission outcome is unknown; the request will not be resent automatically",
        );
      }
      return job;
    }
    if (job.phase === "PACKAGE_PENDING" || job.phase === "PACKAGE_FAILED") {
      try {
        if (!job.providerOutput) throw new Error("Missing completed provider output");
        job.outputDirectory = await packageNarration(job);
        move("SUCCEEDED");
      } catch (error) {
        move("PACKAGE_FAILED", error instanceof Error ? error.message : "Packaging failed");
      }
      return job;
    }
    if (!job.providerJobId) throw new Error("Submitted media job has no provider ID");
    try {
      const status = await bounded(
        (signal) =>
          provider.poll(job.providerJobId as string, structuredClone(job.request), signal),
        mediaOperationTimeoutMs(provider.id, "poll", timeoutMs),
        provider.id === "local-kokoro",
      );
      if (status.state === "failed") move("FAILED", status.message);
      else if (status.state === "processing") {
        job.progress = status.progress;
        move("PROCESSING");
      } else {
        job.providerOutput = status.output;
        job.billedCents = status.output.billedCents;
        store.settle(job, status.output.billedCents);
        move(status.output.kind === "simulation" ? "SIMULATED" : "PACKAGE_PENDING");
      }
    } catch (error) {
      move("POLL_TIMEOUT", error instanceof Error ? error.message : "Provider polling interrupted");
    }
    return job;
  } finally {
    store.release(id, owner);
  }
}

export function providerForJob(store: MediaStore, job: MediaJob, root = mediaRoot): MediaProvider {
  return job.request.provider === "fake"
    ? new FakeProvider(store)
    : new LocalSpeechProvider(
        store,
        resolve(root, "provider-output"),
        job.request.provider === "local-kokoro" ? "kokoro" : "system",
      );
}

export async function rebuildMediaPackage(store: MediaStore, id: string): Promise<MediaJob> {
  const owner = store.acquire(id);
  try {
    const job = store.get(id);
    if (
      job.providerOutput?.kind !== "narration" ||
      !["SUCCEEDED", "PACKAGE_PENDING", "PACKAGE_FAILED"].includes(job.phase)
    )
      throw new Error("This job has no completed narration to repackage");
    job.phase = "PACKAGE_PENDING";
    job.error = null;
    job.updatedAt = new Date().toISOString();
    job.history.push({ phase: "PACKAGE_PENDING", at: job.updatedAt });
    store.save(job, owner);
  } finally {
    store.release(id, owner);
  }
  return advanceMediaJob(store, id, providerForJob(store, store.get(id)));
}

export async function planMediaEpisode(
  episodeId: string,
  providerId: "fake" | "local-speech" | "local-kokoro" | "local",
  scenario: FakeScenario = "success",
  options: { artifactRoot?: string } = {},
) {
  const { readContentEpisode, validateContent } = await import("../contracts.js");
  await validateContent();
  const settings = await productionSettings();
  const selected =
    providerId === "local"
      ? settings.localPreview.engine === "kokoro"
        ? "local-kokoro"
        : "local-speech"
      : providerId;
  const source = await prepareContentEpisode(await readContentEpisode(episodeId), {
    preview: true,
    ...options,
  });
  const store = await MediaStore.open(mediaDatabase);
  try {
    const provider =
      selected === "fake"
        ? new FakeProvider(store)
        : new LocalSpeechProvider(
            store,
            resolve(mediaRoot, "provider-output"),
            selected === "local-kokoro" ? "kokoro" : "system",
          );
    return await createMediaJob(store, source.directory, provider, settings, scenario);
  } finally {
    store.close();
  }
}
