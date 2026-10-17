import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type Image, loadImage } from "@napi-rs/canvas";
import { hash } from "../digest.js";
import type { SpeakerAvatarConfig } from "../domain.js";
import { projectRoot, sourceFile } from "../paths.js";
import { resolveAvatarPath } from "./avatar.js";
import type { Cue } from "./model.js";

const exec = promisify(execFile);
export const talkingHeadRoot = resolve(projectRoot, ".state/talking-head");
const talkingHeadPython = resolve(talkingHeadRoot, "venv/bin/python");
const sharedNeuralPython = resolve(projectRoot, ".state/neural-voice/venv/bin/python");

async function resolvePythonBinary(): Promise<string> {
  for (const candidate of [talkingHeadPython, sharedNeuralPython]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return talkingHeadPython;
}

export async function setupTalkingHead(): Promise<string> {
  await mkdir(talkingHeadRoot, { recursive: true });
  let python = await resolvePythonBinary();
  try {
    await access(python);
  } catch {
    await exec("uv", ["venv", "--python", "3.12", resolve(talkingHeadRoot, "venv")], {
      cwd: projectRoot,
      timeout: 300_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    python = talkingHeadPython;
  }
  await exec(
    "uv",
    [
      "pip",
      "install",
      "--python",
      python,
      "--requirement",
      await sourceFile("config/talking-head-requirements.txt"),
    ],
    { cwd: projectRoot, timeout: 300_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const { stdout } = await exec(
    python,
    [
      await sourceFile("src/media/talking-head-runner.py"),
      "setup",
      talkingHeadRoot,
      await sourceFile("config/talking-head.json"),
    ],
    { cwd: projectRoot, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

export async function talkingHeadRuntime(runtimeRoot = talkingHeadRoot): Promise<{
  installed: boolean;
  hash?: string;
  accelerator?: string;
}> {
  try {
    const bytes = await readFile(resolve(runtimeRoot, "runtime.json"));
    const runtime = JSON.parse(bytes.toString("utf8"));
    if (runtime.schemaVersion !== 1 || !runtime.engine) {
      return { installed: false };
    }
    return {
      installed: true,
      hash: hash(bytes),
      accelerator: runtime.accelerator ?? "cpu",
    };
  } catch {
    return { installed: false };
  }
}

export interface TalkingHeadSequence {
  speakerId: string;
  frameCount: number;
  directory: string;
  getFrame(frameIndex: number): Promise<Image | undefined>;
}

export async function prepareTalkingHeadSequence(options: {
  speakerId: string;
  avatar: SpeakerAvatarConfig;
  wavBytes: Buffer;
  cues: Cue[];
  frameCount: number;
  fps?: number;
  runtimeRoot?: string;
  progress?: (message: string) => void;
}): Promise<TalkingHeadSequence | undefined> {
  if (
    options.avatar.mode !== "photo" ||
    options.avatar.animation !== "neural" ||
    !options.avatar.imageId
  ) {
    return undefined;
  }
  const runtimeRoot = options.runtimeRoot ?? talkingHeadRoot;
  const status = await talkingHeadRuntime(runtimeRoot);
  if (!status.installed || !status.hash) {
    options.progress?.(
      `Local talking-head sidecar not set up for ${options.speakerId}; using built-in full-face 478-landmark warp.`,
    );
    return undefined;
  }

  const portraitPath = await resolveAvatarPath(options.avatar.imageId);
  const portraitBytes = await readFile(portraitPath);
  const fps = options.fps ?? 30;
  const cacheKey = hash(
    JSON.stringify({
      schemaVersion: 1,
      runtimeHash: status.hash,
      speakerId: options.speakerId,
      portraitSha256: hash(portraitBytes),
      wavSha256: hash(options.wavBytes),
      avatar: options.avatar,
      cues: options.cues,
      frameCount: options.frameCount,
      fps,
    }),
  );

  const sequenceDir = resolve(runtimeRoot, "cache", cacheKey);
  const manifestPath = resolve(sequenceDir, "manifest.json");
  let ready = false;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    ready = manifest.schemaVersion === 1 && manifest.frameCount === options.frameCount;
  } catch {
    ready = false;
  }

  if (!ready) {
    options.progress?.(
      `Synthesizing ${options.frameCount} neural talking-head frames for ${options.speakerId} (${status.accelerator ?? "local"}).`,
    );
    await mkdir(sequenceDir, { recursive: true });
    const wavPath = resolve(sequenceDir, "input.wav");
    const requestPath = resolve(sequenceDir, "request.json");
    await writeFile(wavPath, options.wavBytes);
    await writeFile(
      requestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          speakerId: options.speakerId,
          portraitPath,
          wavPath,
          avatar: options.avatar,
          cues: options.cues,
          frameCount: options.frameCount,
          fps,
          resolution: 256,
        },
        null,
        2,
      )}\n`,
    );
    const python = await resolvePythonBinary();
    await exec(
      python,
      [
        await sourceFile("src/media/talking-head-runner.py"),
        "render",
        runtimeRoot,
        requestPath,
        sequenceDir,
      ],
      { cwd: projectRoot, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    );
  }

  const loadedFrames = new Map<number, Image>();
  return {
    speakerId: options.speakerId,
    frameCount: options.frameCount,
    directory: sequenceDir,
    async getFrame(frameIndex: number): Promise<Image | undefined> {
      const clamped = Math.max(0, Math.min(options.frameCount - 1, frameIndex));
      const cached = loadedFrames.get(clamped);
      if (cached) return cached;
      try {
        const frameBytes = await readFile(
          resolve(sequenceDir, `frame-${String(clamped).padStart(4, "0")}.png`),
        );
        const img = await loadImage(frameBytes);
        loadedFrames.set(clamped, img);
        return img;
      } catch {
        return undefined;
      }
    },
  };
}
