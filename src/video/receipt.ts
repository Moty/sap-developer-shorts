import { readFile, realpath } from "node:fs/promises";
import { hash } from "../digest.js";
import { inside } from "../paths.js";

export function assertVideoQuality(
  quality: unknown,
  expectedDurationSeconds?: number,
): asserts quality is { decoded: true; audioChecked: true; durationSeconds: number } {
  const value = quality as {
    decoded?: unknown;
    audioChecked?: unknown;
    durationSeconds?: unknown;
  } | null;
  if (
    value?.decoded !== true ||
    value.audioChecked !== true ||
    typeof value.durationSeconds !== "number" ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 45 ||
    value.durationSeconds > 60.1 ||
    (expectedDurationSeconds !== undefined &&
      (!Number.isFinite(expectedDurationSeconds) ||
        expectedDurationSeconds <= 0 ||
        Math.abs(value.durationSeconds - expectedDurationSeconds) > 0.1 + 1e-9))
  )
    throw new Error(
      "Video quality metadata is invalid or differs from the selected narration duration",
    );
}

export async function readVideoReceipt(directory: string) {
  const root = await realpath(directory);
  const read = async (name: string) => readFile(inside(root, await realpath(inside(root, name))));
  const receipt = JSON.parse((await read("video-manifest.json")).toString("utf8"));
  if (receipt.schemaVersion !== 1 || receipt.stage !== "READY")
    throw new Error("Video has not passed export verification");
  assertVideoQuality(receipt.quality);
  const files: Record<string, Buffer> = {};
  for (const name of [
    "short.mp4",
    "poster.png",
    "review.html",
    "captions.vtt",
    "timing.json",
    "publication-draft.txt",
  ]) {
    const bytes = await read(name);
    if (hash(bytes) !== receipt.artifactHashes?.[name])
      throw new Error(`Saved video artifact changed: ${name}`);
    files[name] = bytes;
  }
  const presentationFiles = ["presentation.html", "presentation.json", "reveal-LICENSE.txt"];
  if (presentationFiles.some((name) => receipt.artifactHashes?.[name])) {
    for (const name of presentationFiles) {
      const bytes = await read(name);
      if (hash(bytes) !== receipt.artifactHashes?.[name])
        throw new Error(`Saved presentation artifact changed: ${name}`);
      files[name] = bytes;
    }
  }
  if (
    files["short.mp4"]?.toString("ascii", 4, 8) !== "ftyp" ||
    files["poster.png"]?.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("Video or poster has an invalid file header");
  return { receipt, files };
}
