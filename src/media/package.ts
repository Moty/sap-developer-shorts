import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv } from "ajv";
import { hash } from "../digest.js";
import type { ContentEpisode } from "../domain.js";
import { inside, sourceFile } from "../paths.js";
import { readRuntimeFiles } from "../provenance.js";
import { buildVtt, pronounce, readPcmWav, sampleRate, splitNarration } from "./audio.js";
import type { MediaJob, NarrationTiming } from "./model.js";
import { kokoroVoice } from "./voices.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const timingValidator = ajv.compile<NarrationTiming>(
  JSON.parse(await readFile(await sourceFile("schemas/narration-timing.schema.json"), "utf8")),
);

export function validateTiming(
  value: unknown,
  episode: ContentEpisode,
  frames: number,
): NarrationTiming {
  if (!timingValidator(value))
    throw new Error(`Narration timing: ${ajv.errorsText(timingValidator.errors)}`);
  if (Math.abs(value.durationSeconds * sampleRate - frames) > 1)
    throw new Error("Narration timing does not match the audio samples");
  let end = 0;
  value.scenes.forEach((scene, index) => {
    if (
      scene.id !== episode.scenes[index]?.id ||
      scene.startSeconds !== end ||
      scene.endSeconds <= end ||
      scene.speechSeconds > scene.endSeconds - scene.startSeconds + 1 / sampleRate
    )
      throw new Error("Narration scenes are inconsistent");
    end = scene.endSeconds;
  });
  if (end !== value.durationSeconds) throw new Error("Narration scenes do not cover the audio");
  end = 0;
  for (const cue of value.cues) {
    const scene = value.scenes.find((item) => item.id === cue.sceneId);
    if (
      !scene ||
      cue.startSeconds < end ||
      cue.endSeconds <= cue.startSeconds ||
      cue.startSeconds < scene.startSeconds ||
      cue.endSeconds > scene.endSeconds + 1 / sampleRate
    )
      throw new Error("Caption timing is inconsistent");
    end = cue.endSeconds;
    if (cue.spokenText !== pronounce(cue.text, episode.pronunciation))
      throw new Error("Spoken caption input differs from the pronunciation glossary");
  }
  for (const scene of episode.scenes) {
    const actual = value.cues.filter((cue) => cue.sceneId === scene.id);
    if (scene.dialogue) {
      const expected = scene.dialogue.flatMap((turn) =>
        splitNarration(turn.text).map((text) => ({
          text,
          speaker: episode.presentation?.speakers.find((speaker) => speaker.id === turn.speakerId),
        })),
      );
      if (
        actual.length !== expected.length ||
        actual.some(
          (cue, index) =>
            cue.text !== expected[index]?.text ||
            cue.speakerId !== expected[index]?.speaker?.id ||
            cue.speakerName !== expected[index]?.speaker?.name,
        )
      )
        throw new Error("Dialogue captions do not match the declared speaker turns");
    } else if (actual.some((cue) => cue.speakerId || cue.speakerName))
      throw new Error("Solo narration cannot claim dialogue speakers");
    const text = value.cues
      .filter((cue) => cue.sceneId === scene.id)
      .map((cue) => cue.text)
      .join(" ");
    if (text !== scene.narration.trim().replace(/\s+/gu, " "))
      throw new Error(`Caption text differs from scene ${scene.id}`);
  }
  return value;
}

export async function packageNarration(job: MediaJob): Promise<string> {
  if (job.providerOutput?.kind !== "narration" || !job.providerOutput.directory)
    throw new Error("No recorded narration output");
  const providerDirectory = job.providerOutput.directory;
  const wav = await readFile(resolve(providerDirectory, "narration.wav"));
  const frames = readPcmWav(wav).length / 2;
  const timingText = await readFile(resolve(providerDirectory, "timing.json"), "utf8");
  const timing = validateTiming(JSON.parse(timingText), job.request.episode, frames);
  const neural = job.request.provider === "local-kokoro";
  if (
    neural &&
    (timing.engine !== "kokoro" ||
      timing.voice !== job.request.settings.localPreview.voice ||
      !job.request.voiceRuntimeHash)
  )
    throw new Error("Neural narration does not match the saved voice request");
  if (!neural && timing.engine === "kokoro")
    throw new Error("Neural timing cannot be used for a system-voice job");
  const base = await readFile(resolve(job.request.sourceDirectory, "review.html"), "utf8");
  const duration = timing.durationSeconds;
  const hookSeconds = timing.scenes[0]?.speechSeconds ?? Infinity;
  const quality = {
    durationSeconds: duration,
    hookSeconds,
    durationInRange: duration >= 45 && duration <= 60,
    hookWithinThreeSeconds: hookSeconds <= 3,
    captions: timing.alignment ?? "measured-phrase-boundaries",
    narrator: {
      engine: timing.engine ?? "system",
      voice: timing.voice,
      ...(job.request.episode.presentation
        ? { speakers: job.request.episode.presentation.speakers }
        : {}),
    },
    avatar: "pending",
    finalProviderVoice: "pending",
  };
  const data = JSON.stringify(timing).replaceAll("<", "\\u003c");
  const player = `<audio id="narration" preload="metadata" src="narration.wav"><track kind="captions" src="captions.vtt" srclang="en" label="English"></audio><script id="narration-data" type="application/json">${data}</script>`;
  let html = base
    .replace("<!--MEDIA_PLAYER-->", player)
    .replace("default-src 'none';", "default-src 'none'; media-src 'self';")
    .replaceAll("Avatar and voice pending", "Avatar pending · local preview voice")
    .replace(
      "Choose the presenter and voice, measure narration, and align the final scenes and captions. The code link in the companion post needs a published repository path.",
      "Stock presenter selected. Connect a permitted avatar provider within the pilot budget, choose the final voice, then render and check the MP4. The public code link is still pending.",
    )
    .replace("STORYBOARD · PLANNED TIMING", "LOCAL VOICE PREVIEW · MEASURED TIMING")
    .replace(
      "Silent storyboard. Presenter, voice, and synchronized captions are pending. Code panels are illustrated from the verified source; results come from this run.",
      "Local system voice preview. Captions follow measured phrase boundaries. Stock avatar and final provider voice are pending. Code and results come from the verified source run.",
    )
    .replace(
      `<b>${job.request.episode.targetDurationSeconds}s</b><span>Planned duration</span>`,
      `<b>${duration.toFixed(1)}s</b><span>Measured duration</span>`,
    )
    .replace('aria-label="Play silent storyboard"', 'aria-label="Play narrated preview"');
  html = html
    .replace(
      "Silent news storyboard. Announcement cards reflect the dated source review. Narration, avatar, and final editorial approval are pending.",
      "Local voice news preview. Captions follow measured phrase boundaries. Announcement cards reflect the dated source review; avatar and final editorial approval are pending.",
    )
    .replace(
      "Measure narration and captions, recheck the source pages, and review the final news script before using a permitted avatar provider.",
      "Local narration and captions are measured. Recheck the source pages and review the final script before using a permitted avatar provider within the pilot budget.",
    );
  if (neural) {
    const voice = {
      name:
        job.request.episode.presentation?.speakers
          .map((speaker) => kokoroVoice(speaker.voice).name)
          .join(" + ") ?? kokoroVoice(timing.voice).name,
    };
    html = html
      .replace(
        "Local system voice preview. Captions follow measured phrase boundaries.",
        `Local AI voice (Kokoro / ${voice.name}). Captions use model timing estimates.`,
      )
      .replace(
        "Local voice news preview. Captions follow measured phrase boundaries.",
        `Local AI news voice (Kokoro / ${voice.name}). Captions use model timing estimates.`,
      )
      .replace("LOCAL VOICE PREVIEW · MEASURED TIMING", "LOCAL NEURAL VOICE · MEASURED AUDIO");
  }
  const assessment =
    quality.durationInRange && quality.hookWithinThreeSeconds
      ? "Timing checks passed"
      : "Timing needs editorial revision";
  html = html.replace(
    '<div class="eyebrow">Scene by scene</div>',
    `<div class="eyebrow">${assessment} · local voice</div><p class="note">Stock presenter selected · $${(job.request.settings.pilotBudgetCents / 100).toFixed(2)} pilot limit · $0 spent on this local preview</p><div class="eyebrow">Scene by scene</div>`,
  );
  const directory = inside(job.request.sourceDirectory, `media/${job.id}`);
  await mkdir(directory, { recursive: true });
  const files: Record<string, string | Buffer> = {
    "review.html": html,
    "narration.wav": wav,
    "timing.json": timingText,
    "captions.vtt": buildVtt(timing.cues),
  };
  const artifactHashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    await writeFile(resolve(directory, `${name}.tmp`), content);
    await rename(resolve(directory, `${name}.tmp`), resolve(directory, name));
    artifactHashes[name] = hash(content);
  }
  const runtimeHashes: Record<string, string> = {};
  for (const [file, content] of Object.entries(await readRuntimeFiles()))
    runtimeHashes[file] = hash(content);
  const receipt = {
    schemaVersion: 1,
    jobId: job.id,
    requestKey: job.requestKey,
    sourceManifestHash: job.request.sourceManifestHash,
    mode: "local-narration-preview",
    costCents: 0,
    ...(job.request.voiceRuntimeHash ? { voiceRuntimeHash: job.request.voiceRuntimeHash } : {}),
    quality,
    artifactHashes,
    runtimeHashes,
  };
  await writeFile(
    resolve(directory, "media-manifest.json.tmp"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await rename(
    resolve(directory, "media-manifest.json.tmp"),
    resolve(directory, "media-manifest.json"),
  );
  return directory;
}
