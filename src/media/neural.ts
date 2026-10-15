import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { hash } from "../digest.js";
import { projectRoot, sourceFile } from "../paths.js";
import {
  buildVtt,
  encodePcmWav,
  pronounce,
  readPcmWav,
  sampleRate,
  splitNarration,
} from "./audio.js";
import type { Cue, MediaRequest, NarrationTiming } from "./model.js";
import { kokoroVoice } from "./voices.js";

const exec = promisify(execFile);
export const neuralRoot = resolve(projectRoot, ".state/neural-voice");
const python = resolve(neuralRoot, "venv/bin/python");

export async function setupNeuralVoice(additionalVoices: string[] = []) {
  const settings = JSON.parse(await readFile(await sourceFile("config/production.json"), "utf8"));
  const voice = kokoroVoice(settings.localPreview?.voice);
  const voices = [...new Set([voice.id, ...additionalVoices.map((id) => kokoroVoice(id).id)])];
  await mkdir(neuralRoot, { recursive: true });
  try {
    await access(python);
  } catch {
    await exec("uv", ["venv", "--python", "3.12", resolve(neuralRoot, "venv")], {
      cwd: projectRoot,
      timeout: 300000,
      maxBuffer: 2 * 1024 * 1024,
    });
  }
  await exec(
    "uv",
    [
      "pip",
      "install",
      "--python",
      python,
      "--requirement",
      await sourceFile("config/neural-voice-requirements.txt"),
    ],
    { cwd: projectRoot, timeout: 300000, maxBuffer: 2 * 1024 * 1024 },
  );
  const { stdout } = await exec(
    python,
    [
      await sourceFile("src/media/kokoro-runner.py"),
      "setup",
      neuralRoot,
      await sourceFile("config/neural-voice.json"),
      ...voices,
    ],
    { cwd: projectRoot, timeout: 300000, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

export async function neuralRuntime(requestedVoices?: string[], runtimeRoot = neuralRoot) {
  let bytes: Buffer;
  try {
    bytes = await readFile(resolve(runtimeRoot, "runtime.json"));
  } catch {
    throw new Error("Local neural voice is not set up. Run npm run shorts -- voice-setup first.");
  }
  const runtime = JSON.parse(bytes.toString("utf8"));
  if (
    runtime.schemaVersion !== 1 ||
    runtime.engine !== "kokoro" ||
    !runtime.voice ||
    !runtime.files?.model?.sha256 ||
    !runtime.packages?.kokoro
  )
    throw new Error("Invalid neural voice runtime; run voice-setup again");
  const voices = [...new Set(requestedVoices ?? [runtime.voice])];
  if (runtime.voices) {
    for (const voice of voices)
      if (!runtime.voices[voice])
        throw new Error(
          `Voice ${voice} is not installed. Run npm run shorts -- voice-setup ${voice}.`,
        );
    bytes = Buffer.from(
      `${JSON.stringify({ ...runtime, voice: voices[0], voices: Object.fromEntries(voices.map((voice) => [voice, runtime.voices[voice]])) }, null, 2)}\n`,
    );
  } else if (voices.length !== 1 || voices[0] !== runtime.voice) {
    throw new Error(
      `Run npm run shorts -- voice-setup ${voices.join(" ")} to install the speaker voices.`,
    );
  }
  const fingerprint = hash(bytes);
  await mkdir(resolve(runtimeRoot, "runtimes"), { recursive: true });
  await writeFile(resolve(runtimeRoot, "runtimes", `${fingerprint}.json`), bytes, {
    flag: "wx",
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  if (hash(await readFile(resolve(runtimeRoot, "runtimes", `${fingerprint}.json`))) !== fingerprint)
    throw new Error(
      "Saved neural runtime snapshot changed; restore the pinned runtime before generation",
    );
  return { hash: fingerprint, voice: voices[0] as string };
}

// Speech samples can use the same renderer without claiming episode verification.
export interface NeuralSpeechRequest {
  episode: Pick<MediaRequest["episode"], "pronunciation" | "presentation"> & {
    scenes: Pick<MediaRequest["episode"]["scenes"][number], "id" | "narration" | "dialogue">[];
  };
  settings: Pick<MediaRequest["settings"], "localPreview">;
  voiceRuntimeHash?: string;
  generatorHash?: string;
}

function sceneInput(request: NeuralSpeechRequest, index: number) {
  const scene = request.episode.scenes[index];
  if (!scene || !request.voiceRuntimeHash)
    throw new Error("Missing neural scene or runtime fingerprint");
  const text = scene.narration.trim().replace(/\s+/gu, " ");
  const phraseInput = (text: string) =>
    splitNarration(text).map((phrase) => ({
      text: phrase,
      spokenText: pronounce(phrase, request.episode.pronunciation),
    }));
  const segments = scene.dialogue?.map((turn) => {
    const speaker = request.episode.presentation?.speakers.find(
      (item) => item.id === turn.speakerId,
    );
    if (!speaker) throw new Error("Dialogue speaker is not declared");
    return {
      text: turn.text,
      spokenText: pronounce(turn.text, request.episode.pronunciation),
      voice: speaker.voice,
      speakerId: speaker.id,
      speakerName: speaker.name,
      phrases: phraseInput(turn.text).map((phrase) => ({
        ...phrase,
        speakerId: speaker.id,
        speakerName: speaker.name,
      })),
    };
  });
  const phrases = segments ? segments.flatMap((segment) => segment.phrases) : phraseInput(text);
  const spokenText = pronounce(text, request.episode.pronunciation);
  if (phrases.map((phrase) => phrase.spokenText).join(" ") !== spokenText)
    throw new Error("Pronunciation glossary crosses a caption boundary");
  return {
    schemaVersion: 1,
    sceneId: scene.id,
    text,
    spokenText,
    phrases,
    voice: request.settings.localPreview.voice,
    speed: request.settings.localPreview.speed ?? 0.96,
    voiceRuntimeHash: request.voiceRuntimeHash,
    ...(request.generatorHash ? { generatorHash: request.generatorHash } : {}),
    ...(segments ? { segments } : {}),
  };
}

export async function readNeuralScene(
  request: NeuralSpeechRequest,
  index: number,
  directory: string,
) {
  const input = sceneInput(request, index);
  const inputText = JSON.stringify(input);
  const wav = await readFile(resolve(directory, `scene-${index}.wav`));
  const pcm = readPcmWav(wav);
  const alignment = JSON.parse(
    await readFile(resolve(directory, `scene-${index}.json`), "utf8"),
  ) as {
    schemaVersion: number;
    sceneId: string;
    inputHash: string;
    wavHash: string;
    frames: number;
    cues: Omit<Cue, "sceneId">[];
  };
  if (
    alignment.schemaVersion !== 1 ||
    alignment.sceneId !== input.sceneId ||
    alignment.inputHash !== hash(inputText) ||
    alignment.wavHash !== hash(wav) ||
    alignment.frames !== pcm.length / 2 ||
    !Array.isArray(alignment.cues) ||
    alignment.cues.length !== input.phrases.length
  )
    throw new Error("Saved neural scene does not match this request or audio");
  let end = 0;
  for (const [position, cue] of alignment.cues.entries()) {
    const phrase = input.phrases[position];
    if (
      !phrase ||
      cue.text !== phrase.text ||
      cue.spokenText !== phrase.spokenText ||
      cue.speakerId !== ("speakerId" in phrase ? phrase.speakerId : undefined) ||
      cue.speakerName !== ("speakerName" in phrase ? phrase.speakerName : undefined) ||
      !Number.isFinite(cue.startSeconds) ||
      !Number.isFinite(cue.endSeconds) ||
      cue.startSeconds < end ||
      cue.endSeconds <= cue.startSeconds ||
      cue.endSeconds > alignment.frames / sampleRate
    )
      throw new Error("Saved neural caption alignment is invalid");
    end = cue.endSeconds;
  }
  return { pcm, alignment, inputText };
}

export async function synthesizeNeuralScene(
  request: NeuralSpeechRequest,
  index: number,
  directory: string,
  signal: AbortSignal,
) {
  if (!request.voiceRuntimeHash || !/^[a-f0-9]{64}$/u.test(request.voiceRuntimeHash))
    throw new Error("Missing neural runtime fingerprint");
  try {
    await readNeuralScene(request, index, directory);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(directory, { recursive: true });
  const input = resolve(directory, `scene-${index}-input.json`);
  await writeFile(input, JSON.stringify(sceneInput(request, index)));
  try {
    await exec(
      python,
      [
        await sourceFile("src/media/kokoro-runner.py"),
        "render",
        neuralRoot,
        input,
        resolve(directory, `scene-${index}.wav`),
        resolve(directory, `scene-${index}.json`),
      ],
      { cwd: projectRoot, signal, timeout: 24000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    await writeFile(
      resolve(directory, `scene-${index}.log`),
      `${failure.message}\n${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    );
    throw new Error(
      `Local neural voice could not finish scene ${index + 1}. The saved scene log contains the details.`,
      { cause: error },
    );
  }
  await readNeuralScene(request, index, directory);
}

export async function assembleNeuralNarration(
  request: MediaRequest,
  directory: string,
): Promise<NarrationTiming> {
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    engine: "kokoro",
    alignment: "model-estimated-phrase-boundaries",
    voice: request.settings.localPreview.voice,
    rate: request.settings.localPreview.wordsPerMinute,
    speed: request.settings.localPreview.speed ?? 0.96,
    durationSeconds: 0,
    sampleRate,
    scenes: [],
    cues: [],
  };
  const buffers: Buffer[] = [];
  let frames = 0;
  for (let index = 0; index < request.episode.scenes.length; index++) {
    const { pcm, alignment } = await readNeuralScene(request, index, directory);
    const start = frames / sampleRate;
    buffers.push(pcm);
    frames += pcm.length / 2;
    for (const cue of alignment.cues)
      timing.cues.push({
        ...cue,
        sceneId: alignment.sceneId,
        startSeconds: start + cue.startSeconds,
        endSeconds: start + cue.endSeconds,
      });
    if (index < request.episode.scenes.length - 1) {
      const pause = Math.round(sampleRate * 0.18);
      buffers.push(Buffer.alloc(pause * 2));
      frames += pause;
    }
    timing.scenes.push({
      id: alignment.sceneId,
      startSeconds: start,
      endSeconds: frames / sampleRate,
      speechSeconds: pcm.length / 2 / sampleRate,
    });
  }
  timing.durationSeconds = frames / sampleRate;
  await writeFile(resolve(directory, "narration.wav"), encodePcmWav(Buffer.concat(buffers)));
  await writeFile(resolve(directory, "timing.json"), `${JSON.stringify(timing, null, 2)}\n`);
  await writeFile(resolve(directory, "captions.vtt"), buildVtt(timing.cues));
  return timing;
}
