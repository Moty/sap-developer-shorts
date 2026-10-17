import { readdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "../digest.js";
import { inside } from "../paths.js";

export function containsPrivateVoice(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsPrivateVoice);
  const record = value as Record<string, unknown>;
  return (
    record.localOnly === true ||
    record.engine === "qwen" ||
    record.engine === "local-voices" ||
    record.provider === "local-voices" ||
    Object.values(record).some(containsPrivateVoice)
  );
}
export async function assertCloudLibrarySafe(directory: string) {
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(resolve(root, "library-manifest.json"), "utf8"));
  if (containsPrivateVoice(manifest) || !manifest.artifactHashes)
    throw new Error(
      "This library contains local-only voice material. Build a stock-only library with: npm run shorts -- library --stock-only",
    );
  const files: string[] = [];
  async function walk(current: string, prefix = "") {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Cloud export cannot copy symlinked files.");
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(resolve(current, entry.name), name);
      else files.push(name);
    }
  }
  await walk(root);
  for (const name of files) {
    if (name === "library-manifest.json") continue;
    const bytes = await readFile(inside(root, name));
    if (hash(bytes) !== manifest.artifactHashes[name])
      throw new Error("Cloud export requires a complete, verified library inventory.");
    if (name.endsWith(".json") && containsPrivateVoice(JSON.parse(bytes.toString())))
      throw new Error(
        "Saved output contains a local-only voice. Rebuild a stock-only library before Firebase export.",
      );
    if (
      name.endsWith("/short.mp4") &&
      !manifest.artifactHashes[name.replace("short.mp4", "timing.json")]
    )
      throw new Error("Cannot classify a video without its recorded narration timing.");
  }
  if (Object.keys(manifest.artifactHashes).length !== files.length - 1)
    throw new Error("Cloud export inventory is incomplete.");
}
export async function assertCloudTimingSafe(directory: string) {
  const timing = JSON.parse(await readFile(resolve(directory, "timing.json"), "utf8"));
  if (containsPrivateVoice(timing) || timing.schemaVersion !== 1)
    throw new Error("Cloned voice output remains on its local Mac.");
}
