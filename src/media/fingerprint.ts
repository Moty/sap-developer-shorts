import { readFile } from "node:fs/promises";
import { hash } from "../digest.js";
import { sourceFile } from "../paths.js";
import { readRuntimeFiles } from "../provenance.js";
import type { MediaRequest } from "./model.js";

export function narrationGeneratorHash(
  provider: MediaRequest["provider"],
  files: Record<string, Buffer>,
): string {
  const selected = Object.entries(files)
    .filter(
      ([name]) =>
        /\/(?:audio|providers|fingerprint)\.(?:ts|js)$/u.test(name) ||
        (provider === "local-kokoro" &&
          (/\/(?:neural|voices)\.(?:ts|js)$/u.test(name) ||
            name === "src/media/kokoro-runner.py" ||
            name.startsWith("config/neural-voice"))) ||
        name === "schemas/narration-timing.schema.json",
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bytes]) => [name, hash(bytes)]);
  if (!selected.length) throw new Error("Narration generator files are missing");
  return hash(JSON.stringify({ provider, files: selected }));
}

export async function currentNarrationGeneratorHash(provider: MediaRequest["provider"]) {
  const files = await readRuntimeFiles();
  const schema = "schemas/narration-timing.schema.json";
  files[schema] = await readFile(await sourceFile(schema));
  return narrationGeneratorHash(provider, files);
}
