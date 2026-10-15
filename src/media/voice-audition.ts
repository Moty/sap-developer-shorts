import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "../digest.js";
import { inside, projectRoot, sourceFile } from "../paths.js";
import { escapeHtml as esc } from "../review.js";
import { readPcmWav, sampleRate } from "./audio.js";
import { currentNarrationGeneratorHash } from "./fingerprint.js";
import type { ProductionSettings } from "./model.js";
import {
  type NeuralSpeechRequest,
  neuralRoot,
  neuralRuntime,
  synthesizeNeuralScene,
} from "./neural.js";
import { kokoroVoice, kokoroVoices } from "./voices.js";

export const auditionText =
  "Let's make SAP feel a little simpler. With CAP and OData, a small idea becomes something you can try. We'll check the result, and keep learning together.";
export const auditionPronunciation = { SAP: "S A P", CAP: "cap", OData: "oh data" };

export interface AuditionIdentity {
  schemaVersion: 1;
  kind: "kokoro-voice-sample";
  text: string;
  pronunciation: Record<string, string>;
  voice: string;
  speed: number;
  voiceRuntimeHash: string;
  generatorHash: string;
}

export interface VoiceSample {
  key: string;
  identity: AuditionIdentity;
  durationSeconds: number;
  audioHash: string;
  audio: Buffer;
  directory: string;
}

export function auditionIdentity(
  voice: string,
  speed: number,
  voiceRuntimeHash: string,
  generatorHash: string,
): AuditionIdentity {
  kokoroVoice(voice);
  if (!Number.isFinite(speed) || speed < 0.8 || speed > 1.2)
    throw new Error("Voice sample speed must be between 0.8 and 1.2.");
  if (![voiceRuntimeHash, generatorHash].every((value) => /^[a-f0-9]{64}$/u.test(value)))
    throw new Error("Voice samples need pinned runtime and generator fingerprints.");
  return {
    schemaVersion: 1,
    kind: "kokoro-voice-sample",
    text: auditionText,
    pronunciation: auditionPronunciation,
    voice,
    speed,
    voiceRuntimeHash,
    generatorHash,
  };
}

export const auditionKey = (identity: AuditionIdentity) => hash(JSON.stringify(identity));

export async function installedKokoroVoices(runtimeRoot = neuralRoot): Promise<string[]> {
  try {
    const runtime = JSON.parse(await readFile(resolve(runtimeRoot, "runtime.json"), "utf8"));
    if (runtime.schemaVersion !== 1 || runtime.engine !== "kokoro") return [];
    const ids = Object.keys(runtime.voices ?? { [runtime.voice]: runtime.files?.voice });
    return kokoroVoices.filter((voice) => ids.includes(voice.id)).map((voice) => voice.id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
      return [];
    throw error;
  }
}

async function confined(directory: string, name: string) {
  const root = await realpath(directory);
  return readFile(inside(root, await realpath(inside(root, name))));
}

export async function readVoiceSample(
  directory: string,
  identity: AuditionIdentity,
): Promise<VoiceSample> {
  const key = auditionKey(identity);
  const receipt = JSON.parse((await confined(directory, "sample-manifest.json")).toString("utf8"));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "voice-audition" ||
    receipt.key !== key ||
    JSON.stringify(receipt.identity) !== JSON.stringify(identity) ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    !/^[a-f0-9]{64}$/u.test(receipt.audioHash)
  )
    throw new Error("Voice sample receipt does not match the requested voice and settings.");
  const audio = await confined(directory, "sample.wav");
  const durationSeconds = readPcmWav(audio).length / 2 / sampleRate;
  if (
    hash(audio) !== receipt.audioHash ||
    receipt.durationSeconds !== durationSeconds ||
    durationSeconds <= 0 ||
    durationSeconds > 45
  )
    throw new Error("Voice sample audio is incomplete or changed.");
  return { key, identity, durationSeconds, audioHash: receipt.audioHash, audio, directory };
}

export function voiceSampleCard(sample: VoiceSample, selected: string, prefix = "") {
  const voice = kokoroVoice(sample.identity.voice);
  return `<article class="voice-card"><div class="voice-heading"><h3>${esc(voice.name)}</h3>${voice.id === selected ? '<span class="voice-selected">Default narrator</span>' : ""}</div><p>${esc(voice.accent)} · ${esc(voice.gender)}</p><audio controls preload="metadata" aria-label="${esc(voice.name)} voice sample" src="${prefix}${sample.key}/sample.wav"></audio><p class="voice-meta">${sample.durationSeconds.toFixed(1)}s · Speed ${sample.identity.speed.toFixed(2)} · <code>${esc(voice.id)}</code></p><details class="production-command"><summary>Use this voice</summary><p>Set the default for episodes without their own speaker assignments:</p><code tabindex="0">npm run shorts -- voice-select ${esc(voice.id)}</code><p>Then create a new recording:</p><code tabindex="0">npm run shorts -- produce CAP-01 --serve</code></details></article>`;
}

export async function createVoiceAudition(
  voiceId: string,
  settings: ProductionSettings,
  options: {
    artifactRoot?: string;
    runtime?: { hash: string; voice: string };
    generatorHash?: string;
    synthesize?: typeof synthesizeNeuralScene;
  } = {},
) {
  kokoroVoice(voiceId);
  if (settings.localPreview.engine !== "kokoro")
    throw new Error("Voice samples require the Kokoro engine.");
  const runtime = options.runtime ?? (await neuralRuntime([voiceId]));
  if (runtime.voice !== voiceId)
    throw new Error("Voice sample runtime differs from the requested voice.");
  const generatorHash = options.generatorHash ?? (await currentAuditionGeneratorHash());
  const identity = auditionIdentity(
    voiceId,
    settings.localPreview.speed ?? 0.96,
    runtime.hash,
    generatorHash,
  );
  const key = auditionKey(identity);
  const root = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
    "voice-auditions",
  );
  const directory = resolve(root, key);
  try {
    return { sample: await readVoiceSample(directory, identity), reused: true };
  } catch {
    /* An invalid completed sample is replaced only after a successful recording. */
  }
  const temporary = resolve(root, `.${key}-${randomUUID()}`);
  await mkdir(temporary, { recursive: true });
  try {
    const request: NeuralSpeechRequest = {
      episode: {
        pronunciation: identity.pronunciation,
        scenes: [{ id: "voice-sample", narration: identity.text }],
      },
      settings: { localPreview: { ...settings.localPreview, voice: voiceId } },
      voiceRuntimeHash: runtime.hash,
      generatorHash,
    };
    await (options.synthesize ?? synthesizeNeuralScene)(
      request,
      0,
      temporary,
      AbortSignal.timeout(26000),
    );
    const audio = await readFile(resolve(temporary, "scene-0.wav"));
    const durationSeconds = readPcmWav(audio).length / 2 / sampleRate;
    await writeFile(resolve(temporary, "sample.wav"), audio, { flag: "wx" });
    await writeFile(
      resolve(temporary, "sample-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "voice-audition",
          key,
          identity,
          createdAt: new Date().toISOString(),
          durationSeconds,
          audioHash: hash(audio),
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    await readVoiceSample(temporary, identity);
    if (!options.generatorHash && (await currentAuditionGeneratorHash()) !== generatorHash)
      throw new Error("Voice sample generator changed during recording; try again.");
    // Preserve a corrupt earlier result for diagnosis; incomplete directories remain hidden.
    await rename(directory, `${directory}.invalid-${randomUUID()}`).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    await rename(temporary, directory);
    return { sample: await readVoiceSample(directory, identity), reused: false };
  } catch (error) {
    const diagnostics = resolve(root, ".failures", `${key}-${randomUUID()}`);
    await writeFile(
      resolve(temporary, "failure.log"),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    await mkdir(resolve(diagnostics, ".."), { recursive: true });
    await rename(temporary, diagnostics);
    throw new Error(`Voice sample ${voiceId} could not finish. Diagnostics: ${diagnostics}`, {
      cause: error,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function currentAuditionGeneratorHash() {
  const module = new URL(import.meta.url).pathname.endsWith(".ts")
    ? "src/media/voice-audition.ts"
    : "dist/src/media/voice-audition.js";
  return hash(
    JSON.stringify({
      speech: await currentNarrationGeneratorHash("local-kokoro"),
      sample: hash(await readFile(await sourceFile(module))),
    }),
  );
}

export async function collectVoiceSamples(
  artifactRoot: string,
  settings: ProductionSettings,
  options: { runtimeRoot?: string; generatorHash?: string } = {},
) {
  const installed = await installedKokoroVoices(options.runtimeRoot);
  const samples: VoiceSample[] = [];
  if (settings.localPreview.engine !== "kokoro") return { installed, samples };
  const generatorHash = options.generatorHash ?? (await currentAuditionGeneratorHash());
  for (const id of installed) {
    try {
      const runtime = await neuralRuntime([id], options.runtimeRoot);
      const identity = auditionIdentity(
        id,
        settings.localPreview.speed ?? 0.96,
        runtime.hash,
        generatorHash,
      );
      samples.push(
        await readVoiceSample(
          resolve(artifactRoot, "voice-auditions", auditionKey(identity)),
          identity,
        ),
      );
    } catch {
      /* Missing, outdated, or corrupt samples are never exposed as playable. */
    }
  }
  return { installed, samples };
}

export async function buildAuditionPage(
  samples: VoiceSample[],
  selected: string,
  artifactRoot?: string,
) {
  const root = resolve(projectRoot, artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts");
  const id = `voice-samples-${randomUUID()}`;
  const temporary = resolve(root, `.${id}`);
  const directory = resolve(root, id);
  await mkdir(temporary, { recursive: true });
  try {
    const css = await readFile(await sourceFile("templates/library.css"), "utf8");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Kokoro voice samples · SAP Shorts</title><style>${css}</style></head><body><main class="audition-page"><p class="eyebrow">LISTEN BEFORE YOU CHOOSE</p><h1>Kokoro voice samples</h1><p>Identical words and speed. These samples help choose a narrator; they are not episode recordings.</p><blockquote class="audition-transcript">${esc(auditionText)}</blockquote><div class="voice-grid">${samples.map((sample) => voiceSampleCard(sample, selected)).join("")}</div><p>Your default voice has not changed. Prepared styles retain their own speaker assignments.</p></main></body></html>`;
    await writeFile(resolve(temporary, "review.html"), html, { flag: "wx" });
    for (const sample of samples) {
      const verified = await readVoiceSample(sample.directory, sample.identity);
      await mkdir(resolve(temporary, sample.key));
      await writeFile(resolve(temporary, sample.key, "sample.wav"), verified.audio, { flag: "wx" });
    }
    await rename(temporary, directory);
    return directory;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
