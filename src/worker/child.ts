/** Disposable child. Its workspace and model roots are set before module loading. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { digest, type RecordData } from "../cloud/contracts.js";
import { projectRoot } from "../paths.js";

const input = JSON.parse(await readFile(resolve(projectRoot, "worker-input.json"), "utf8"));
const began = performance.now();
const progress = (stage: string) => process.stdout.write(`${JSON.stringify({ stage })}\n`);
let files: { kind: string; path: string }[], metrics: RecordData;
if (input.kind === "audition") {
  progress("NARRATION");
  const { synthesizeClonedSpeech } = await import("../media/qwen.js");
  const voice = input.episode.presentation.speakers[0].voice;
  const result = await synthesizeClonedSpeech(voice, input.snapshot.auditionText, {
    audition: true,
  });
  await writeFile(resolve(projectRoot, "audition.wav"), result.audio, { mode: 0o600 });
  files = [{ kind: "audition", path: resolve(projectRoot, "audition.wav") }];
  metrics = {
    totalMs: Math.round(performance.now() - began),
    durationSeconds: result.alignment.frames / 22050,
  };
} else {
  const { produce } = await import("../production.js");
  const report = await produce(input.episode.id, {
    stageProgress: progress,
    stages: { library: async (mediaJobId) => ({ directory: projectRoot, mediaJobId }) },
  });
  if (report.stage !== "READY" || !report.videoDirectory || !report.narrationDirectory) {
    if (report.issue?.code === "TIMING_REVIEW_REQUIRED")
      process.stdout.write(
        `${JSON.stringify({
          blocked: report.issue.code,
          durationSeconds: report.durationSeconds,
          hookSeconds: report.hookSeconds,
        })}\n`,
      );
    throw new Error(report.issue?.message ?? "Production did not complete.");
  }
  const video = await readFile(resolve(report.videoDirectory, "short.mp4"));
  const audio = await readFile(resolve(report.narrationDirectory, "narration.wav"));
  const captions = await readFile(resolve(report.narrationDirectory, "captions.vtt"));
  const episode = structuredClone(input.snapshot.episode);
  // Package includes the episode transcript, never reference samples or enrollment transcripts.
  const bundle = zipSync({
    "short.mp4": video,
    "narration.wav": audio,
    "captions.vtt": captions,
    "episode.json": strToU8(JSON.stringify(episode, null, 2)),
  });
  await writeFile(resolve(projectRoot, "episode.zip"), bundle);
  files = [
    { kind: "video", path: resolve(report.videoDirectory, "short.mp4") },
    { kind: "audio", path: resolve(report.narrationDirectory, "narration.wav") },
    { kind: "captions", path: resolve(report.narrationDirectory, "captions.vtt") },
    { kind: "package", path: resolve(projectRoot, "episode.zip") },
  ];
  metrics = {
    totalMs: Math.round(performance.now() - began),
    durationSeconds: report.durationSeconds,
    stages: report.generationTiming?.stages ?? {},
    reusedAudio: report.reusedAudio ?? false,
    reusedVideo: report.reusedVideo,
  };
}
const outputs = await Promise.all(
  files.map(async (file) => ({ kind: file.kind, sha256: digest(await readFile(file.path)) })),
);
const manifestPath = resolve(projectRoot, "result-manifest.json");
await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, metrics, outputs }), {
  mode: 0o600,
});
files.push({ kind: "manifest", path: manifestPath });
await writeFile(resolve(projectRoot, "worker-result.json"), JSON.stringify({ files, metrics }), {
  mode: 0o600,
});
progress("READY");
