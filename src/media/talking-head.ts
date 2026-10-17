import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { type Image, loadImage } from "@napi-rs/canvas";
import { hash } from "../digest.js";
import type { SpeakerAvatarConfig } from "../domain.js";
import { inside, projectRoot, sourceFile } from "../paths.js";
import { acquireVideoGate } from "../video/cache.js";
import { resolveAvatarPath } from "./avatar.js";
import type { Cue } from "./model.js";
import { withModelLock } from "./model-lock.js";

export const talkingHeadRoot = resolve(projectRoot, ".state/portrait-runtime");

async function runLogged(
  binary: string,
  args: string[],
  logPath: string,
  progress?: (message: string) => void,
  timeout = 3_600_000,
) {
  const log = createWriteStream(logPath);
  try {
    await new Promise<void>((done, reject) => {
      const child = spawn(binary, args, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        env: { ...process.env, PYTHONUNBUFFERED: "1", PYTORCH_ENABLE_MPS_FALLBACK: "1" },
      });
      let pending = "";
      child.stdout.on("data", (chunk: Buffer) => {
        log.write(chunk);
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/u);
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) progress?.(line);
      });
      child.stderr.on("data", (chunk: Buffer) => log.write(chunk));
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (code === 0) done();
        else
          reject(new Error(`Local portrait renderer failed (${signal ?? code}); see ${logPath}`));
      });
      log.on("error", (error) => {
        child.kill();
        reject(error);
      });
    });
  } finally {
    await new Promise<void>((done) => log.end(done));
  }
}

export async function setupTalkingHead(progress?: (message: string) => void): Promise<string> {
  await mkdir(talkingHeadRoot, { recursive: true });
  const release = await acquireVideoGate(await realpath(talkingHeadRoot));
  try {
    await runLogged(
      "python3",
      [await sourceFile("scripts/setup-portrait.py")],
      resolve(talkingHeadRoot, "setup.log"),
      progress,
    );
    return "Local Ditto portrait renderer installed and model loading verified. Render a sample to assess the portrait.";
  } finally {
    release();
  }
}

export async function talkingHeadRuntime(runtimeRoot = talkingHeadRoot): Promise<{
  installed: boolean;
  hash?: string;
  accelerator?: string;
  engine?: string;
}> {
  try {
    const bytes = await readFile(resolve(runtimeRoot, "runtime.json"));
    const runtime = JSON.parse(bytes.toString("utf8"));
    const spec = await readFile(await sourceFile("config/portrait-runtime.json"));
    await access(resolve(runtimeRoot, "venv/bin/python"));
    if (
      runtime.schemaVersion !== 2 ||
      runtime.engine !== "ditto" ||
      runtime.specSha256 !== hash(spec) ||
      !runtime.sourceHashes ||
      typeof runtime.sourceHashes !== "object" ||
      Array.isArray(runtime.sourceHashes) ||
      !Object.keys(runtime.sourceHashes).length
    )
      return { installed: false };
    const sourceRoot = await realpath(resolve(runtimeRoot, "source"));
    for (const [name, expected] of Object.entries(runtime.sourceHashes)) {
      const path = inside(sourceRoot, name);
      if ((await realpath(path)) !== path || hash(await readFile(path)) !== expected)
        return { installed: false };
    }
    return {
      installed: true,
      hash: hash(bytes),
      accelerator: runtime.accelerator,
      engine: "ditto",
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

interface SequenceManifest {
  schemaVersion: number;
  engine: string;
  requestHash: string;
  frameCount: number;
  fps: number;
  frameHashes: string[];
}

export async function readPortraitManifest(
  directory: string,
  requestHash: string,
  frameCount: number,
  fps: number,
): Promise<SequenceManifest> {
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  ) as SequenceManifest;
  if (
    manifest.schemaVersion !== 2 ||
    manifest.engine !== "ditto" ||
    manifest.requestHash !== requestHash ||
    manifest.frameCount !== frameCount ||
    manifest.fps !== fps ||
    !Array.isArray(manifest.frameHashes) ||
    manifest.frameHashes.length !== frameCount ||
    !manifest.frameHashes.every((value) => /^[a-f0-9]{64}$/u.test(value))
  )
    throw new Error("Portrait sequence manifest does not match this render");
  for (let i = 0; i < frameCount; i++) {
    const path = resolve(directory, `frame-${String(i).padStart(4, "0")}.png`);
    if ((await realpath(path)) !== path || hash(await readFile(path)) !== manifest.frameHashes[i])
      throw new Error(`Portrait frame ${i} is missing, redirected, or changed`);
  }
  return manifest;
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
  if (options.avatar.mode !== "photo" || options.avatar.animation !== "neural") return undefined;
  if (!options.avatar.imageId) throw new Error("Realistic portrait rendering requires a picture");
  const runtimeRoot = options.runtimeRoot ?? talkingHeadRoot;
  const status = await talkingHeadRuntime(runtimeRoot);
  if (!status.installed || !status.hash)
    throw new Error(
      "Realistic portrait rendering needs local model setup. Run npm run shorts -- talking-head-setup. A lightweight photo effect will not be substituted.",
    );
  const fps = options.fps ?? 30;
  if (
    fps !== 30 ||
    !Number.isInteger(options.frameCount) ||
    options.frameCount < 1 ||
    options.frameCount > 18000
  )
    throw new Error("Portrait output requires 30 fps and at most ten minutes");
  const portraitPath = await resolveAvatarPath(options.avatar.imageId);
  const portraitBytes = await readFile(portraitPath);
  const runnerPath = await sourceFile("src/media/portrait-runner.py");
  const requestHash = hash(
    JSON.stringify({
      schemaVersion: 2,
      runtimeHash: status.hash,
      runnerSha256: hash(await readFile(runnerPath)),
      portraitSha256: hash(portraitBytes),
      wavSha256: hash(options.wavBytes),
      speakerId: options.speakerId,
      avatar: options.avatar,
      cues: options.cues,
      frameCount: options.frameCount,
      fps,
    }),
  );
  const directory = resolve(runtimeRoot, "cache", requestHash);
  await mkdir(resolve(runtimeRoot, "cache"), { recursive: true });
  const release = await acquireVideoGate(await realpath(runtimeRoot));
  let manifest: SequenceManifest;
  try {
    try {
      manifest = await readPortraitManifest(directory, requestHash, options.frameCount, fps);
    } catch {
      // Keep incomplete or corrupted output for diagnosis; publish only a complete sequence.
      try {
        await rename(directory, `${directory}.recovery-${randomUUID()}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await mkdir(directory);
      const wavPath = resolve(directory, "input.wav");
      const requestPath = resolve(directory, "request.json");
      const imagePath = resolve(directory, `portrait-input${extname(portraitPath)}`);
      await writeFile(wavPath, options.wavBytes);
      await writeFile(imagePath, portraitBytes);
      await writeFile(
        requestPath,
        `${JSON.stringify(
          {
            schemaVersion: 2,
            requestHash,
            speakerId: options.speakerId,
            portraitPath: imagePath,
            wavPath,
            avatar: options.avatar,
            cues: options.cues,
            frameCount: options.frameCount,
            fps,
          },
          null,
          2,
        )}\n`,
      );
      await withModelLock(() =>
        runLogged(
          resolve(runtimeRoot, "venv/bin/python"),
          [runnerPath, "render", runtimeRoot, requestPath, directory],
          resolve(directory, "render.log"),
          options.progress,
          Math.max(3_600_000, options.frameCount * 2000 + 300_000),
        ),
      );
      manifest = await readPortraitManifest(directory, requestHash, options.frameCount, fps);
    }
  } finally {
    release();
  }
  const loaded = new Map<number, Image>();
  return {
    speakerId: options.speakerId,
    frameCount: options.frameCount,
    directory,
    async getFrame(index) {
      if (!Number.isInteger(index) || index < 0 || index >= options.frameCount)
        throw new Error("Portrait frame index is out of range");
      const cached = loaded.get(index);
      if (cached) return cached;
      const bytes = await readFile(
        resolve(directory, `frame-${String(index).padStart(4, "0")}.png`),
      );
      if (hash(bytes) !== manifest.frameHashes[index])
        throw new Error(`Portrait frame ${index} changed after generation`);
      const image = await loadImage(bytes);
      if (image.width !== 512 || image.height !== 512)
        throw new Error("Portrait frame dimensions differ");
      loaded.set(index, image);
      if (loaded.size > 32) loaded.delete(loaded.keys().next().value as number);
      return image;
    },
  };
}
