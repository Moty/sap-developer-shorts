import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "../digest.js";
import { inside } from "../paths.js";
import { readPcmWav } from "./audio.js";
import type { MediaRequest } from "./model.js";
import { readCompletedNarration, validateTiming } from "./package.js";
import { readReusedAudio } from "./reused-audio.js";
import type { MediaStore } from "./store.js";
import { loadVerifiedRun, mediaRoot } from "./worker.js";

export function narrationIdentity(request: MediaRequest): string | null {
  if (request.provider === "fake" || !request.generatorHash) return null;
  const neural = request.provider === "local-kokoro";
  return hash(
    JSON.stringify({
      provider: request.provider,
      generatorHash: request.generatorHash,
      voiceRuntimeHash: request.voiceRuntimeHash,
      voice: request.settings.localPreview.voice,
      speed: neural
        ? request.settings.localPreview.speed
        : request.settings.localPreview.wordsPerMinute,
      sampleRate: request.settings.localPreview.sampleRate,
      pronunciation: request.episode.pronunciation,
      speakers: request.episode.presentation?.speakers.map(({ id, name, voice }) => ({
        id,
        name,
        voice,
      })),
      scenes: request.episode.scenes.map((scene) => ({
        id: scene.id,
        narration: scene.narration,
        dialogue: scene.dialogue,
        ...(neural ? {} : { startSeconds: scene.startSeconds, endSeconds: scene.endSeconds }),
      })),
    }),
  );
}

/** Copy verified completed speech into a new package without another submission. */
export async function reuseCompletedNarration(
  store: MediaStore,
  id: string,
  workRoot = resolve(mediaRoot, "provider-output"),
) {
  const owner = store.acquire(id);
  try {
    const job = store.get(id);
    const identity = narrationIdentity(job.request);
    if (job.phase !== "PLANNED" || !identity || job.quoteCents !== 0) return job;
    const finishCopy = async (directory: string) => {
      const copied = await readReusedAudio(job, directory);
      validateTiming(
        JSON.parse((copied.files["timing.json"] as Buffer).toString("utf8")),
        job.request.episode,
        readPcmWav(copied.files["narration.wav"] as Buffer).length / 2,
      );
      job.audioReuse = copied.audioReuse;
      job.providerOutput = { kind: "narration", billedCents: 0, directory: copied.directory };
      job.billedCents = 0;
      job.phase = "PACKAGE_PENDING";
      job.updatedAt = new Date().toISOString();
      job.history.push({ phase: job.phase, at: job.updatedAt });
      store.settle(job, 0);
      store.save(job, owner);
      return job;
    };
    let existing: string | undefined;
    try {
      const root = await realpath(workRoot);
      existing = inside(root, await realpath(inside(root, `reused-${job.id}`)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing) return await finishCopy(existing);
    for (const donor of store.list()) {
      if (
        donor.id === id ||
        donor.phase !== "SUCCEEDED" ||
        donor.billedCents !== 0 ||
        narrationIdentity(donor.request) !== identity
      )
        continue;
      let recorded: Awaited<ReturnType<typeof readCompletedNarration>>;
      try {
        const source = await loadVerifiedRun(donor.request.sourceDirectory, {
          requireFreshNews: false,
        });
        if (source.manifestHash !== donor.request.sourceManifestHash) continue;
        recorded = await readCompletedNarration(donor);
        validateTiming(
          recorded.timing,
          job.request.episode,
          readPcmWav(recorded.files["narration.wav"] as Buffer).length / 2,
        );
      } catch {
        continue;
      }
      await mkdir(workRoot, { recursive: true });
      const root = await realpath(workRoot);
      const directory = inside(root, `reused-${job.id}`);
      const files = ["narration.wav", "timing.json", "captions.vtt"];
      const audioReuse = {
        jobId: donor.id,
        sourceAudioHash: hash(recorded.files["narration.wav"] as Buffer),
        timingHash: hash(recorded.files["timing.json"] as Buffer),
      };
      const copyReceipt = `${JSON.stringify({ schemaVersion: 1, jobId: job.id, requestHash: job.requestHash, audioReuse, artifactHashes: Object.fromEntries(files.map((name) => [name, hash(recorded.files[name] as Buffer)])) }, null, 2)}\n`;
      const temporary = await mkdtemp(resolve(root, ".reuse-"));
      try {
        for (const name of files)
          await writeFile(resolve(temporary, name), recorded.files[name] as Buffer, { flag: "wx" });
        await writeFile(resolve(temporary, "reuse-manifest.json"), copyReceipt, { flag: "wx" });
        await rename(temporary, directory);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      return await finishCopy(directory);
    }
    return job;
  } finally {
    store.release(id, owner);
  }
}
