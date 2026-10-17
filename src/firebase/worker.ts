import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { validateContent } from "../contracts.js";
import { hash } from "../digest.js";
import { buildLibrary } from "../library.js";
import { listCustomAvatars, resolveAvatarPath, saveCustomAvatar } from "../media/avatar.js";
import { talkingHeadRuntime } from "../media/talking-head.js";
import { auditionPhrase, installedKokoroVoices } from "../media/voice-audition.js";
import { inside, projectRoot } from "../paths.js";
import { type ProductionReport, produce } from "../production.js";
import { validatePresentationDefinition } from "../variants.js";
import {
  readWorkflowManifest,
  type WorkflowRecord,
  workflowDirectory,
  workflowState,
} from "../workflow.js";
import {
  type FirebaseClientConfig,
  loadFirebaseConfig,
  resolveWorkerIdentity,
  type WorkerIdentity,
} from "./config.js";
import { type FirebaseCloudStore, RestFirebaseCloudStore } from "./rest-client.js";

export interface WorkerOptions {
  readonly store?: FirebaseCloudStore;
  readonly config?: FirebaseClientConfig;
  readonly workerIdentity?: WorkerIdentity;
  readonly artifactRoot?: string;
  readonly rootDir?: string;
  readonly pollIntervalMs?: number;
  readonly produceImpl?: typeof produce;
  readonly auditionImpl?: typeof auditionPhrase;
  readonly onLibraryUpdated?: (libraryDirectory: string) => void | Promise<void>;
  readonly logger?: (message: string) => void;
}

export interface SyncReport {
  readonly pulledAvatars: string[];
  readonly pushedAvatars: string[];
  readonly pulledVariants: string[];
  readonly pushedVariants: string[];
  readonly pulledWorkflows: string[];
  readonly pushedWorkflows: string[];
}

export async function upsertLocalPresentation(
  definition: unknown,
  rootDir = projectRoot,
): Promise<{ selector: string; file: string; changed: boolean }> {
  const validated = await validatePresentationDefinition(definition);
  const presentationDir = resolve(rootDir, "content/presentations");
  await mkdir(presentationDir, { recursive: true });
  const targetFile = inside(presentationDir, resolve(presentationDir, basename(validated.file)));
  const serialized = `${JSON.stringify(validated.definition, null, 2)}\n`;
  try {
    const existing = await readFile(targetFile, "utf8");
    if (existing === serialized) {
      return { selector: validated.selector, file: targetFile, changed: false };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const tempFile = resolve(presentationDir, `.${basename(targetFile)}-${randomUUID()}.tmp`);
  await writeFile(tempFile, serialized, "utf8");
  await rename(tempFile, targetFile);
  return { selector: validated.selector, file: targetFile, changed: true };
}

export async function publishWorkerHeartbeat(
  store: FirebaseCloudStore,
  identity: WorkerIdentity,
  status: "ONLINE" | "BUSY" | "OFFLINE",
  activeJobId: string | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  const [portraitRuntime, voices] = await Promise.all([
    talkingHeadRuntime().catch(() => ({ ready: false, engine: "ditto-talkinghead" })),
    installedKokoroVoices().catch(() => [] as string[]),
  ]);
  await store.setDocument("workers", identity.workerId, {
    workerId: identity.workerId,
    hostname: identity.hostname,
    arch: identity.arch,
    status,
    activeJobId,
    portraitRuntime: portraitRuntime as unknown as Record<string, unknown>,
    voices,
    lastHeartbeatAt: now,
    updatedAt: now,
  });
}

export async function syncAvatarsWithCloud(
  store: FirebaseCloudStore,
  rootDir = projectRoot,
): Promise<{ pulled: string[]; pushed: string[] }> {
  const pulled: string[] = [];
  const pushed: string[] = [];
  const localAvatars = new Set(await listCustomAvatars(rootDir));
  const cloudAvatars = await store.listDocuments("avatars");
  const cloudMap = new Map(cloudAvatars.map((doc) => [doc.id, doc.data]));

  // Pull missing avatars from cloud -> local Mac
  for (const [docId, data] of cloudMap.entries()) {
    const imageId = typeof data.imageId === "string" ? data.imageId : docId;
    if (localAvatars.has(imageId)) continue;
    let bytes: Buffer | null = null;
    if (typeof data.dataUrl === "string" && data.dataUrl.includes(",")) {
      const b64 = data.dataUrl.slice(data.dataUrl.indexOf(",") + 1);
      bytes = Buffer.from(b64, "base64");
    } else if (typeof data.storagePath === "string") {
      bytes = await store.downloadStorageObject(data.storagePath).catch(() => null);
    }
    if (bytes && bytes.byteLength > 0) {
      const saved = await saveCustomAvatar(imageId, bytes, rootDir);
      localAvatars.add(saved.imageId);
      pulled.push(saved.imageId);
    }
  }

  // Push local avatars missing in cloud -> Firebase
  for (const imageId of localAvatars) {
    if (cloudMap.has(imageId)) continue;
    try {
      const filePath = await resolveAvatarPath(imageId, rootDir);
      const bytes = await readFile(filePath);
      const sha256 = hash(bytes);
      const uploaded = await store
        .uploadStorageObject(`avatars/${imageId}`, bytes, "image/png")
        .catch(() => ({
          storagePath: `avatars/${imageId}`,
          downloadUrl: `/api/avatars/${encodeURIComponent(imageId)}`,
          sha256,
          byteLength: bytes.byteLength,
        }));
      const now = new Date().toISOString();
      await store.setDocument("avatars", imageId, {
        imageId,
        sha256,
        url: uploaded.downloadUrl,
        storagePath: uploaded.storagePath,
        ...(bytes.byteLength <= 700_000
          ? { dataUrl: `data:image/png;base64,${bytes.toString("base64")}` }
          : {}),
        createdAt: now,
        updatedAt: now,
      });
      pushed.push(imageId);
    } catch {
      /* skip invalid local avatar */
    }
  }

  return { pulled, pushed };
}

export async function syncVariantsWithCloud(
  store: FirebaseCloudStore,
  rootDir = projectRoot,
): Promise<{ pulled: string[]; pushed: string[] }> {
  const pulled: string[] = [];
  const pushed: string[] = [];
  const content = await validateContent();

  for (const baseEpisode of content.episodes) {
    const colPath = `episodes/${baseEpisode.id}/variants`;
    const cloudVariants = await store.listDocuments(colPath).catch(() => []);
    const cloudByVariant = new Map(cloudVariants.map((d) => [d.id, d.data]));

    // Pull cloud variants to local content/presentations/
    for (const [variantId, cloudDef] of cloudByVariant.entries()) {
      try {
        const { createdAt, updatedAt, ...cleanDef } = cloudDef;
        void createdAt;
        void updatedAt;
        const res = await upsertLocalPresentation(cleanDef, rootDir);
        if (res.changed) pulled.push(res.selector);
      } catch {
        void variantId;
      }
    }
  }

  // Push local presentation files that are not yet in Firestore
  const presentationDir = resolve(rootDir, "content/presentations");
  try {
    const entries = await readdir(presentationDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const raw = JSON.parse(await readFile(resolve(presentationDir, entry.name), "utf8")) as {
        baseEpisodeId?: string;
        presentation?: { variant?: string };
      };
      const baseId = raw.baseEpisodeId;
      const variantId = raw.presentation?.variant;
      if (!baseId || !variantId) continue;
      const colPath = `episodes/${baseId}/variants`;
      const existing = await store.getDocument(colPath, variantId).catch(() => null);
      if (!existing) {
        const now = new Date().toISOString();
        await store.setDocument(colPath, variantId, {
          ...(raw as Record<string, unknown>),
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        });
        pushed.push(`${baseId}@${variantId}`);
      }
    }
  } catch {
    /* ignore missing presentations dir */
  }

  return { pulled, pushed };
}

export async function syncWorkflowWithCloud(
  store: FirebaseCloudStore,
  artifactRoot = resolve(projectRoot, "artifacts"),
): Promise<{ pulled: string[]; pushed: string[] }> {
  const pulled: string[] = [];
  const pushed: string[] = [];
  const wfDir = workflowDirectory(artifactRoot);
  await mkdir(wfDir, { recursive: true });

  const cloudDocs = await store.listDocuments("workflow").catch(() => []);
  const cloudBySelector = new Map(cloudDocs.map((d) => [d.id, d.data]));

  // Read local .studio-workflow/*.json files
  const localRecords = new Map<string, WorkflowRecord>();
  try {
    const entries = await readdir(wfDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const rec = JSON.parse(await readFile(resolve(wfDir, entry.name), "utf8")) as WorkflowRecord;
      if (rec.selector && rec.renderKey) {
        localRecords.set(rec.selector, rec);
      }
    }
  } catch {
    /* empty workflow directory */
  }

  // Pull cloud workflow updates into local .studio-workflow/
  for (const [selector, data] of cloudBySelector.entries()) {
    const renderKey = typeof data.renderKey === "string" ? data.renderKey : "";
    const inputHash = typeof data.inputHash === "string" ? data.inputHash : "";
    const videoHash = typeof data.videoHash === "string" ? data.videoHash : "";
    if (!renderKey || renderKey === "draft") continue;

    const record: WorkflowRecord = {
      selector,
      renderKey,
      inputHash,
      videoHash,
      reviewedAt: typeof data.reviewedAt === "string" ? data.reviewedAt : null,
      publication:
        data.publication &&
        typeof data.publication === "object" &&
        typeof (data.publication as { url?: unknown }).url === "string"
          ? {
              url: String((data.publication as { url: string }).url),
              recordedAt: String(
                (data.publication as { recordedAt?: string }).recordedAt ??
                  new Date().toISOString(),
              ),
            }
          : null,
    };

    const file = resolve(wfDir, `${hash(`${selector}:${renderKey}`)}.json`);
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    let shouldWrite = true;
    try {
      if ((await readFile(file, "utf8")) === serialized) shouldWrite = false;
    } catch {
      /* file does not exist yet */
    }
    if (shouldWrite) {
      await writeFile(file, serialized, "utf8");
      pulled.push(selector);
    }
  }

  // Push local workflow records missing in cloud
  for (const [selector, rec] of localRecords.entries()) {
    if (cloudBySelector.has(selector)) continue;
    const stage = rec.publication ? "published" : rec.reviewedAt ? "publish" : "review";
    const labels: Record<string, string> = {
      review: "To review",
      publish: "To publish",
      published: "Published",
    };
    await store.setDocument("workflow", selector, {
      selector: rec.selector,
      renderKey: rec.renderKey,
      inputHash: rec.inputHash,
      videoHash: rec.videoHash,
      reviewedAt: rec.reviewedAt,
      publication: rec.publication,
      stage,
      label: labels[stage] ?? "To review",
      updatedAt: new Date().toISOString(),
    });
    pushed.push(selector);
  }

  return { pulled, pushed };
}

export async function processPendingAuditions(
  store: FirebaseCloudStore,
  auditionImpl: typeof auditionPhrase = auditionPhrase,
): Promise<number> {
  const docs = await store.listDocuments("auditions").catch(() => []);
  const pending = docs.filter((d) => d.data.status === "PENDING");
  let processed = 0;

  for (const item of pending) {
    const text = typeof item.data.text === "string" ? item.data.text.trim() : "";
    if (!text) continue;
    try {
      const voice = typeof item.data.voice === "string" ? item.data.voice : undefined;
      const speed = typeof item.data.speed === "number" ? item.data.speed : undefined;
      const pronunciation =
        item.data.pronunciation && typeof item.data.pronunciation === "object"
          ? (item.data.pronunciation as Record<string, string>)
          : undefined;

      const result = await auditionImpl(text, {
        ...(voice !== undefined ? { voice } : {}),
        ...(speed !== undefined ? { speed } : {}),
        ...(pronunciation !== undefined ? { pronunciation } : {}),
      });

      const uploaded = await store
        .uploadStorageObject(`auditions/${item.id}.wav`, result.audio, "audio/wav")
        .catch(() => null);

      await store.setDocument("auditions", item.id, {
        ...item.data,
        status: "READY",
        spokenText: result.spokenText,
        durationSeconds: result.durationSeconds,
        ...(uploaded ? { audioUrl: uploaded.downloadUrl } : {}),
        ...(result.audio.byteLength <= 700_000
          ? {
              audioDataUrl: `data:audio/wav;base64,${result.audio.toString("base64")}`,
            }
          : {}),
        updatedAt: new Date().toISOString(),
      });
      processed++;
    } catch (error) {
      await store.setDocument("auditions", item.id, {
        ...item.data,
        status: "FAILED",
        error: (error as Error).message,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return processed;
}

export async function processNextPendingProductionJob(
  options: WorkerOptions,
): Promise<ProductionReport | null> {
  const config = options.config ?? (await loadFirebaseConfig());
  const store = options.store ?? new RestFirebaseCloudStore(config);
  const identity = options.workerIdentity ?? resolveWorkerIdentity();
  const rootDir = options.rootDir ?? projectRoot;
  const artifactRoot = resolve(
    rootDir,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );
  const produceImpl = options.produceImpl ?? produce;
  const log = options.logger ?? console.log;

  const jobs = await store.listDocuments("productions").catch(() => []);
  const pendingJobs = jobs
    .filter((j) => j.data.stage === "PENDING")
    .sort((a, b) => String(a.data.startedAt ?? "").localeCompare(String(b.data.startedAt ?? "")));
  const nextJob = pendingJobs[0];
  if (!nextJob) return null;

  const jobId = nextJob.id;
  const jobData = nextJob.data;
  const selector = String(jobData.selector ?? "");

  log(`[firebase-worker] Claiming job ${jobId} for ${selector}...`);
  await publishWorkerHeartbeat(store, identity, "BUSY", jobId);

  let currentStage = "PREFLIGHT";
  let lastProgressWriteMs = 0;

  const writeJobState = async (
    stage: string,
    progressMessage: string,
    extra: Record<string, unknown> = {},
  ) => {
    currentStage = stage;
    lastProgressWriteMs = Date.now();
    await store.setDocument("productions", jobId, {
      ...jobData,
      schemaVersion: 1,
      id: jobId,
      selector,
      stage,
      progressMessage,
      workerId: identity.workerId,
      updatedAt: new Date().toISOString(),
      ...extra,
    });
  };

  try {
    await writeJobState(
      "PREFLIGHT",
      `Claimed by ${identity.hostname} (${identity.arch}); syncing draft & avatars...`,
    );

    // 1. Sync any uploaded avatars first so speaker portrait files exist on disk
    await syncAvatarsWithCloud(store, rootDir);

    // 2. If job includes an inline script definition, save/update it locally
    if (jobData.definition && typeof jobData.definition === "object") {
      await upsertLocalPresentation(jobData.definition, rootDir);
    } else {
      await syncVariantsWithCloud(store, rootDir);
    }

    // 3. Run local production pipeline (Kokoro-82M + Ditto MPS + FFmpeg)
    const report = await produceImpl(selector, {
      artifactRoot,
      progress(message) {
        const isStageToken = [
          "PREFLIGHT",
          "NARRATION",
          "RENDER",
          "LIBRARY",
          "READY",
          "BLOCKED",
          "FAILED",
        ].includes(message);
        const nextStage = isStageToken ? message : currentStage;
        const stageChanged = nextStage !== currentStage;
        if (stageChanged || Date.now() - lastProgressWriteMs >= 750) {
          void writeJobState(nextStage, message).catch(() => {});
        }
      },
    });

    // 4. Upload rendered media assets to Firebase Cloud Storage when READY
    const assets: Record<string, string> = {};
    if (report.stage === "READY" && report.videoDirectory) {
      for (const [key, filename, contentType] of [
        ["videoUrl", "short.mp4", "video/mp4"],
        ["posterUrl", "poster.png", "image/png"],
        ["captionsUrl", "captions.vtt", "text/vtt"],
        ["narrationUrl", "narration.wav", "audio/wav"],
      ] as const) {
        try {
          const filePath = resolve(report.videoDirectory, filename);
          const bytes = await readFile(filePath);
          const uploaded = await store.uploadStorageObject(
            `episodes/${selector}/${basename(report.videoDirectory)}/${filename}`,
            bytes,
            contentType,
          );
          assets[key] = uploaded.downloadUrl;
        } catch {
          /* optional artifact */
        }
      }
    }

    await writeJobState(
      report.stage,
      report.stage === "READY"
        ? "Production READY on Mac worker"
        : (report.issue?.message ?? `Production finished with stage ${report.stage}`),
      {
        report: report as unknown as Record<string, unknown>,
        ...(Object.keys(assets).length ? { assets } : {}),
        ...(report.mediaJobId ? { mediaJobId: report.mediaJobId } : {}),
        ...(report.durationSeconds !== undefined
          ? { durationSeconds: report.durationSeconds }
          : {}),
        ...(report.hookSeconds !== undefined ? { hookSeconds: report.hookSeconds } : {}),
        ...(report.issue ? { issue: report.issue as unknown as Record<string, unknown> } : {}),
        ...(report.stage !== "READY" ? { error: report.issue?.message ?? null } : {}),
      },
    );

    if (report.stage === "READY" && report.libraryDirectory) {
      try {
        const manifest = await readWorkflowManifest(report.libraryDirectory);
        const entry = manifest.episodes.find((e) => e.selector === selector);
        const videoHash =
          manifest.artifactHashes[`episodes/${selector}/video/short.mp4`] ?? "cloud";
        if (entry) {
          const state = await workflowState(workflowDirectory(artifactRoot), entry, videoHash);
          await store.setDocument("workflow", selector, {
            selector,
            renderKey: entry.video?.renderKey ?? "ready",
            inputHash: entry.inputHash,
            videoHash,
            reviewedAt: state.record?.reviewedAt ?? null,
            publication: state.record?.publication ?? null,
            stage: state.stage,
            label: state.label,
            ...(Object.keys(assets).length ? { assets } : {}),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {
        /* ignore workflow update failure */
      }

      if (options.onLibraryUpdated) {
        await options.onLibraryUpdated(report.libraryDirectory);
      }
    }

    log(`[firebase-worker] Completed job ${jobId} (${selector}): ${report.stage}`);
    return report;
  } catch (error) {
    const message = (error as Error).message;
    await writeJobState("FAILED", message, { error: message });
    log(`[firebase-worker] Job ${jobId} (${selector}) FAILED: ${message}`);
    return null;
  } finally {
    await publishWorkerHeartbeat(store, identity, "ONLINE", null).catch(() => {});
  }
}

export async function syncStudioWithFirebase(options: WorkerOptions = {}): Promise<SyncReport> {
  const config = options.config ?? (await loadFirebaseConfig());
  const store = options.store ?? new RestFirebaseCloudStore(config);
  const rootDir = options.rootDir ?? projectRoot;
  const artifactRoot = resolve(
    rootDir,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );

  const [avatars, variants, workflows] = await Promise.all([
    syncAvatarsWithCloud(store, rootDir),
    syncVariantsWithCloud(store, rootDir),
    syncWorkflowWithCloud(store, artifactRoot),
  ]);

  if (avatars.pulled.length || variants.pulled.length || workflows.pulled.length) {
    try {
      const built = await buildLibrary({ artifactRoot });
      if (options.onLibraryUpdated) {
        await options.onLibraryUpdated(built.directory);
      }
    } catch {
      /* library rebuild is best-effort during sync */
    }
  }

  return {
    pulledAvatars: avatars.pulled,
    pushedAvatars: avatars.pushed,
    pulledVariants: variants.pulled,
    pushedVariants: variants.pushed,
    pulledWorkflows: workflows.pulled,
    pushedWorkflows: workflows.pushed,
  };
}

export async function runWorkerTick(options: WorkerOptions = {}): Promise<{
  auditionsProcessed: number;
  productionReport: ProductionReport | null;
}> {
  const config = options.config ?? (await loadFirebaseConfig());
  const store = options.store ?? new RestFirebaseCloudStore(config);
  const rootDir = options.rootDir ?? projectRoot;
  const artifactRoot = resolve(
    rootDir,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );

  await syncAvatarsWithCloud(store, rootDir);
  await syncVariantsWithCloud(store, rootDir);
  await syncWorkflowWithCloud(store, artifactRoot);
  const auditionsProcessed = await processPendingAuditions(store, options.auditionImpl);
  const productionReport = await processNextPendingProductionJob({
    ...options,
    config,
    store,
  });

  return { auditionsProcessed, productionReport };
}

export async function startFirebaseWorkerDaemon(
  options: WorkerOptions = {},
): Promise<{ stop: () => Promise<void> }> {
  const config = options.config ?? (await loadFirebaseConfig());
  const store = options.store ?? new RestFirebaseCloudStore(config);
  const identity = options.workerIdentity ?? resolveWorkerIdentity();
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const log = options.logger ?? console.log;

  let stopped = false;
  let activeTick = false;

  await publishWorkerHeartbeat(store, identity, "ONLINE", null);
  log(
    `[firebase-worker] Online as ${identity.workerId} (${identity.hostname} · ${identity.arch}) watching Firebase project ${config.projectId}`,
  );

  const heartbeatInterval = setInterval(() => {
    if (!stopped && !activeTick) {
      void publishWorkerHeartbeat(store, identity, "ONLINE", null).catch(() => {});
    }
  }, 30_000);

  const pollInterval = setInterval(() => {
    if (stopped || activeTick) return;
    activeTick = true;
    void runWorkerTick({ ...options, config, store, workerIdentity: identity })
      .catch((error) => {
        log(`[firebase-worker] Poll error: ${(error as Error).message}`);
      })
      .finally(() => {
        activeTick = false;
      });
  }, pollIntervalMs);

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeatInterval);
    clearInterval(pollInterval);
    await publishWorkerHeartbeat(store, identity, "OFFLINE", null).catch(() => {});
  };

  return { stop };
}
