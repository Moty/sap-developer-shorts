import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { hash } from "../digest.js";
import { inside, modelStateRoot, sourceFile } from "../paths.js";
import { readPcmWav } from "./audio.js";
import { withModelLock } from "./model-lock.js";
import { runNeuralProcess } from "./neural.js";
import { atomicJson, profileDirectory, readVoiceProfile } from "./voice-profiles.js";
import type { ClonedVoice } from "./voice-reference.js";

const exec = promisify(execFile);
export const qwenRoot = resolve(modelStateRoot, "qwen-voice");
const python = resolve(qwenRoot, "venv/bin/python");
export const qwenOperationTimeoutMs = 300_000;
export interface AlignedWord {
  text: string;
  startSeconds: number;
  endSeconds: number;
}
export interface QwenAlignment {
  words: AlignedWord[];
  frames: number;
  wavHash: string;
  generationSeconds: number;
  elapsedSeconds: number;
  peakMemoryBytes: number;
  nativeSampleRate: number;
  alignmentSampleRate: number;
}
async function setupQwenVoiceInternal() {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Qwen voice cloning currently requires an Apple Silicon Mac.");
  await mkdir(qwenRoot, { recursive: true, mode: 0o700 });
  await exec("uv", ["venv", "--allow-existing", "--python", "3.12", resolve(qwenRoot, "venv")], {
    timeout: 300000,
  });
  await exec(
    "uv",
    [
      "pip",
      "install",
      "--python",
      python,
      "--requirement",
      await sourceFile("config/qwen-voice-requirements.txt"),
    ],
    { timeout: 300000, maxBuffer: 2 * 1024 * 1024 },
  );
  const { stdout } = await exec(
    python,
    [
      await sourceFile("src/media/qwen-runner.py"),
      "setup",
      qwenRoot,
      await sourceFile("config/qwen-voice.json"),
    ],
    { timeout: 3600000, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}
export function setupQwenVoice() {
  return withModelLock(async () => {
    await mkdir(qwenRoot, { recursive: true, mode: 0o700 });
    try {
      const result = await setupQwenVoiceInternal();
      await writeFile(resolve(qwenRoot, "setup.log"), `${result}\n`, { mode: 0o600 });
      return result;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      await writeFile(
        resolve(qwenRoot, "setup.log"),
        [failure.message, failure.stdout, failure.stderr].filter(Boolean).join("\n"),
        { mode: 0o600 },
      );
      throw error;
    }
  });
}
export async function qwenRuntime(root = qwenRoot) {
  const cuda = process.env.SHORTS_QWEN_BACKEND === "cuda";
  if (!cuda && (process.platform !== "darwin" || process.arch !== "arm64"))
    throw new Error("Qwen voice cloning currently requires an Apple Silicon Mac.");
  let bytes: Buffer;
  try {
    await access(resolve(root, "venv/bin/python"));
    bytes = await readFile(resolve(root, "runtime.json"));
  } catch {
    throw new Error("Set up local voice cloning first: npm run shorts -- voice-clone-setup");
  }
  const runtime = JSON.parse(bytes.toString());
  if (
    runtime.schemaVersion !== 1 ||
    runtime.engine !== (cuda ? "qwen-cuda" : "qwen-mlx") ||
    runtime.configHash !==
      hash(
        await readFile(await sourceFile(cuda ? "config/qwen-cuda.json" : "config/qwen-voice.json")),
      ) ||
    !Array.isArray(runtime.files) ||
    runtime.files.length < 10
  )
    throw new Error("Qwen runtime changed. Run voice-clone-setup again.");
  for (const file of runtime.files) {
    const info = await stat(inside(root, file.path), { bigint: true });
    if (
      !info.isFile() ||
      String(info.size) !== String(file.size) ||
      String(info.mtimeNs) !== file.mtimeNs
    )
      throw new Error("Qwen model files changed. Run voice-clone-setup to verify them.");
  }
  return { hash: hash(bytes), engine: cuda ? ("qwen-cuda" as const) : ("qwen-mlx" as const) };
}
export async function qwenStatus() {
  try {
    return { ready: true, ...(await qwenRuntime()) };
  } catch (error) {
    return { ready: false, message: (error as Error).message };
  }
}
export async function synthesizeClonedSpeech(
  voice: ClonedVoice,
  text: string,
  options: { audition?: boolean; signal?: AbortSignal } = {},
) {
  if (!text.trim() || text.length > 4000 || /[<>[\]]/u.test(text))
    throw new Error("Use plain spoken text up to 4,000 characters.");
  return withModelLock(async () => {
    const runtime = await qwenRuntime();
    const { profile, directory, acceptance } = await readVoiceProfile(voice, {
      accepted: !options.audition,
    });
    if (!options.audition && acceptance?.runtimeHash !== runtime.hash)
      throw new Error("The voice model changed. Audition and accept this profile again.");
    const work = resolve(qwenRoot, "work", randomUUID());
    await mkdir(work, { recursive: true, mode: 0o700 });
    try {
      const input = resolve(work, "input.json");
      const output = resolve(work, "speech.wav");
      const alignmentPath = resolve(work, "alignment.json");
      await writeFile(
        input,
        JSON.stringify({
          text,
          sample: resolve(directory, "sample.wav"),
          transcript: profile.transcript,
          seed: 42,
          runtimeHash: runtime.hash,
        }),
        { mode: 0o600 },
      );
      await runNeuralProcess(
        python,
        [
          await sourceFile(
            process.env.SHORTS_QWEN_BACKEND === "cuda"
              ? "src/worker/qwen-cuda.py"
              : "src/media/qwen-runner.py",
          ),
          "render",
          qwenRoot,
          input,
          output,
          alignmentPath,
        ],
        {
          signal: options.signal ?? new AbortController().signal,
          timeoutMs: qwenOperationTimeoutMs - 5000,
          logPath: resolve(qwenRoot, "last-render.log"),
        },
      );
      const audio = await readFile(output);
      const alignment = JSON.parse(await readFile(alignmentPath, "utf8")) as QwenAlignment;
      if (hash(audio) !== alignment.wavHash || readPcmWav(audio).length / 2 !== alignment.frames)
        throw new Error("Qwen output integrity check failed.");
      return { audio, alignment, runtimeHash: runtime.hash };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
async function auditionClonedVoiceInternal(
  voice: ClonedVoice,
  text = "Let's make S A P simpler. Your cap A P I exposes oh data. Type N P M run demo.",
) {
  const output = await synthesizeClonedSpeech(voice, text, { audition: true });
  const directory = await profileDirectory(voice);
  const temporary = resolve(directory, `audition-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, output.audio, { mode: 0o600, flag: "wx" });
    await rename(temporary, resolve(directory, "audition.wav"));
  } finally {
    await rm(temporary, { force: true });
  }
  await rm(resolve(directory, "accepted.json"), { force: true });
  await atomicJson(resolve(directory, "audition.json"), {
    runtimeHash: output.runtimeHash,
    auditionHash: hash(output.audio),
    text,
    durationSeconds: output.alignment.frames / 22050,
    metrics: output.alignment,
  });
  return output;
}
export function auditionClonedVoice(voice: ClonedVoice, text?: string) {
  return withModelLock(() => auditionClonedVoiceInternal(voice, text));
}
async function acceptClonedVoiceInternal(voice: ClonedVoice) {
  const { directory } = await readVoiceProfile(voice, { accepted: false });
  const audition = JSON.parse(await readFile(resolve(directory, "audition.json"), "utf8"));
  if (
    audition.runtimeHash !== (await qwenRuntime()).hash ||
    audition.auditionHash !== hash(await readFile(resolve(directory, "audition.wav")))
  )
    throw new Error("Generate and listen to a new audition before accepting this voice.");
  await atomicJson(resolve(directory, "accepted.json"), {
    ...audition,
    acceptedAt: new Date().toISOString(),
  });
}

export function acceptClonedVoice(voice: ClonedVoice) {
  return withModelLock(() => acceptClonedVoiceInternal(voice));
}
