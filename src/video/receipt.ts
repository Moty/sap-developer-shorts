import { readFile, realpath } from "node:fs/promises";
import { hash } from "../digest.js";
import { inside } from "../paths.js";

export async function readVideoReceipt(directory: string) {
  const root = await realpath(directory);
  const read = async (name: string) => readFile(inside(root, await realpath(inside(root, name))));
  const receipt = JSON.parse((await read("video-manifest.json")).toString("utf8"));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.stage !== "READY" ||
    !receipt.quality?.decoded ||
    !receipt.quality?.audioChecked
  )
    throw new Error("Video has not passed export verification");
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
  if (
    files["short.mp4"]?.toString("ascii", 4, 8) !== "ftyp" ||
    files["poster.png"]?.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("Video or poster has an invalid file header");
  return { receipt, files };
}
