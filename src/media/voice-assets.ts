import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { inside, sourceFile } from "../paths.js";
import { neuralRoot } from "./neural.js";
import { kokoroVoices, supportsKokoroVoice } from "./voices.js";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function regularFile(root: string, path: string) {
  const canonical = inside(root, await realpath(inside(root, path)));
  const file = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    if (!(await file.stat()).isFile()) throw new Error("Voice assets must be regular files");
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function checkedAsset(root: string, asset: unknown): Promise<boolean> {
  if (
    !record(asset) ||
    typeof asset.path !== "string" ||
    !asset.path ||
    isAbsolute(asset.path) ||
    typeof asset.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(asset.sha256)
  )
    return false;
  try {
    const file = await regularFile(root, asset.path);
    try {
      const digest = createHash("sha256");
      for await (const chunk of file.createReadStream({ autoClose: false })) digest.update(chunk);
      return digest.digest("hex") === asset.sha256;
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

// This is an asset inventory, not a synthesis or Python dependency check. It
// deliberately avoids neuralRuntime, which creates pinned runtime snapshots.
export async function verifiedKokoroVoices(runtimeRoot = neuralRoot): Promise<string[]> {
  try {
    const root = await realpath(runtimeRoot);
    const manifest = await regularFile(root, "runtime.json");
    let runtime: unknown;
    try {
      if ((await manifest.stat()).size > 1024 * 1024) return [];
      runtime = JSON.parse(await manifest.readFile({ encoding: "utf8" }));
    } finally {
      await manifest.close();
    }
    const specification: unknown = JSON.parse(
      await readFile(await sourceFile("config/neural-voice.json"), "utf8"),
    );
    if (
      !record(specification) ||
      specification.schemaVersion !== 1 ||
      typeof specification.repository !== "string" ||
      typeof specification.revision !== "string" ||
      !/^[a-f0-9]{40}$/u.test(specification.revision) ||
      !record(runtime) ||
      runtime.schemaVersion !== 1 ||
      runtime.engine !== "kokoro" ||
      runtime.repository !== specification.repository ||
      runtime.revision !== specification.revision ||
      typeof runtime.voice !== "string" ||
      !supportsKokoroVoice(runtime.voice) ||
      !record(runtime.packages) ||
      typeof runtime.packages.kokoro !== "string" ||
      !runtime.packages.kokoro.trim() ||
      !record(runtime.files)
    )
      return [];
    if (
      !(await checkedAsset(root, runtime.files.model)) ||
      !(await checkedAsset(root, runtime.files.config))
    )
      return [];
    const voices = Object.hasOwn(runtime, "voices")
      ? runtime.voices
      : { [runtime.voice]: runtime.files.voice };
    if (!record(voices)) return [];
    const checked: string[] = [];
    for (const voice of kokoroVoices)
      if (Object.hasOwn(voices, voice.id) && (await checkedAsset(root, voices[voice.id])))
        checked.push(voice.id);
    return checked;
  } catch {
    // An unavailable installation must not prevent reading or revising a script.
    return [];
  }
}
