import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { hash } from "../digest.js";
import { modelStateRoot, projectRoot, sourceFile } from "../paths.js";
import {
  buildVtt,
  encodePcmWav,
  pronounce,
  readPcmWav,
  sampleRate,
  splitNarration,
} from "./audio.js";
import type { Cue, LegacyNarrationTiming, MediaRequest } from "./model.js";
import { kokoroVoice } from "./voices.js";

const exec = promisify(execFile);
export const neuralRoot = resolve(modelStateRoot, "neural-voice");
const python = resolve(neuralRoot, "venv/bin/python");
export const kokoroSceneTimeoutMs = 60_000;
export const kokoroOperationTimeoutMs = kokoroSceneTimeoutMs + 5_000;

// Abort errors can arrive before close. Do not allow another scene attempt to
// write the same files until this disposable rendering process has fully closed.
export async function runNeuralProcess(
  command: string,
  args: string[],
  options: { signal: AbortSignal; logPath: string; timeoutMs?: number },
) {
  const timeoutMs = options.timeoutMs ?? kokoroSceneTimeoutMs;
  const started = performance.now();
  const execution = exec(command, args, {
    cwd: projectRoot,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  });
  const child = execution.child;
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  // execFile does not forward killSignal to spawn's AbortSignal handling on
  // supported Node versions. Send our rendering-only kill signal explicitly.
  const abort = () => {
    child.kill("SIGKILL");
  };
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    await execution;
    options.signal.throwIfAborted();
  } catch (error) {
    await closed;
    const failure = error as Error & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      code?: string | number;
    };
    const elapsedMs = Math.round(performance.now() - started);
    const reason = options.signal.aborted
      ? "aborted"
      : child.killed && elapsedMs >= timeoutMs
        ? "timeout"
        : "process-error";
    await writeFile(
      options.logPath,
      `${JSON.stringify(
        {
          reason,
          elapsedMs,
          timeoutMs,
          pid: child.pid ?? null,
          killed: child.killed || failure.killed === true,
          signal: child.signalCode,
          code: failure.code ?? child.exitCode,
          message: failure.message,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? "",
        },
        null,
        2,
      )}\n`,
    );
    throw new Error(
      `Local neural voice ${reason === "timeout" ? "reached its scene time limit" : reason === "aborted" ? "was interrupted" : "could not finish"}. Details: ${options.logPath}`,
      { cause: error },
    );
  } finally {
    options.signal.removeEventListener("abort", abort);
    await closed;
  }
}

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
  names = { wav: `scene-${index}.wav`, alignment: `scene-${index}.json` },
) {
  const input = sceneInput(request, index);
  const inputText = JSON.stringify(input);
  const wav = await readFile(resolve(directory, names.wav));
  const pcm = readPcmWav(wav);
  const alignment = JSON.parse(await readFile(resolve(directory, names.alignment), "utf8")) as {
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
  return { pcm, wav, alignment, inputText };
}

/** Cache only complete, hash-verified stock speech; personal Qwen audio is not stored here. */
function sceneCacheKey(request: NeuralSpeechRequest, index: number) {
  if (!request.generatorHash || !/^[a-f0-9]{64}$/u.test(request.generatorHash)) return null;
  return hash(JSON.stringify(sceneInput(request, index)));
}
export async function restoreNeuralScene(
  request: NeuralSpeechRequest,
  index: number,
  directory: string,
  cacheRoot = resolve(projectRoot, ".state/stock-scene-cache"),
) {
  const key = sceneCacheKey(request, index);
  if (!key) return false;
  const cached = resolve(cacheRoot, key);
  try {
    if (!(await lstat(cached)).isDirectory()) return false;
    for (const name of ["audio.wav", "alignment.json"]) {
      const info = await lstat(resolve(cached, name));
      if (!info.isFile() || info.size > 16 * 1024 * 1024) return false;
    }
    const scene = await readNeuralScene(request, index, cached, {
      wav: "audio.wav",
      alignment: "alignment.json",
    });
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `scene-${index}.wav`), scene.wav);
    await writeFile(resolve(directory, `scene-${index}.json`), JSON.stringify(scene.alignment));
    await writeFile(
      resolve(directory, `scene-${index}-reuse.json`),
      JSON.stringify({ inputHash: key, source: "scene-cache" }),
    );
    return true;
  } catch {
    return false; // A missing, unreadable or corrupt optional cache is a miss.
  }
}
export async function cacheNeuralScene(
  request: NeuralSpeechRequest,
  index: number,
  directory: string,
  cacheRoot = resolve(projectRoot, ".state/stock-scene-cache"),
) {
  const key = sceneCacheKey(request, index);
  if (!key) return;
  const scene = await readNeuralScene(request, index, directory);
  try {
    const existing = resolve(cacheRoot, key);
    if ((await lstat(existing)).isDirectory()) {
      const safe = await Promise.all(
        ["audio.wav", "alignment.json"].map((name) => lstat(resolve(existing, name))),
      );
      if (safe.every((info) => info.isFile() && info.size <= 16 * 1024 * 1024)) {
        await readNeuralScene(request, index, existing, {
          wav: "audio.wav",
          alignment: "alignment.json",
        });
        return;
      }
    }
  } catch {
    /* Publish a verified replacement below. */
  }
  try {
    await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    const temporary = resolve(cacheRoot, `.${randomUUID()}`);
    await mkdir(temporary, { mode: 0o700 });
    try {
      await writeFile(resolve(temporary, "audio.wav"), scene.wav, { mode: 0o600 });
      await writeFile(resolve(temporary, "alignment.json"), JSON.stringify(scene.alignment), {
        mode: 0o600,
      });
      const destination = resolve(cacheRoot, key);
      try {
        await rename(temporary, destination);
      } catch (error) {
        if (
          !["EEXIST", "ENOTEMPTY", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
        )
          throw error;
        // Preserve a corrupt entry for diagnostics, then replace it with verified output.
        await rename(destination, resolve(cacheRoot, `.replaced-${key}-${randomUUID()}`));
        await rename(temporary, destination);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } catch {
    /* Cache publication is optional; verified job output remains usable. */
  }
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
    await cacheNeuralScene(request, index, directory);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  signal.throwIfAborted();
  if (await restoreNeuralScene(request, index, directory)) return;
  await mkdir(directory, { recursive: true });
  const input = resolve(directory, `scene-${index}-input.json`);
  await writeFile(input, JSON.stringify(sceneInput(request, index)));
  await runNeuralProcess(
    python,
    [
      await sourceFile("src/media/kokoro-runner.py"),
      "render",
      neuralRoot,
      input,
      resolve(directory, `scene-${index}.wav`),
      resolve(directory, `scene-${index}.json`),
    ],
    { signal, logPath: resolve(directory, `scene-${index}.log`) },
  );
  await readNeuralScene(request, index, directory);
  await writeFile(
    resolve(directory, `scene-${index}-reuse.json`),
    JSON.stringify({ inputHash: sceneCacheKey(request, index), source: "generated" }),
  );
  await cacheNeuralScene(request, index, directory);
}

export async function assembleNeuralNarration(
  request: MediaRequest,
  directory: string,
): Promise<LegacyNarrationTiming> {
  const timing: LegacyNarrationTiming = {
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
  timing.sceneReuse = { reused: 0, generated: 0, checkpoint: 0 };
  const buffers: Buffer[] = [];
  let frames = 0;
  for (let index = 0; index < request.episode.scenes.length; index++) {
    const { pcm, alignment } = await readNeuralScene(request, index, directory);
    let source = "checkpoint";
    try {
      const saved = JSON.parse(
        await readFile(resolve(directory, `scene-${index}-reuse.json`), "utf8"),
      );
      if (
        saved.inputHash === sceneCacheKey(request, index) &&
        ["generated", "scene-cache"].includes(saved.source)
      )
        source = saved.source;
    } catch {
      /* Legacy validated checkpoints do not claim cache provenance. */
    }
    timing.sceneReuse[
      source === "scene-cache" ? "reused" : source === "generated" ? "generated" : "checkpoint"
    ]++;
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
