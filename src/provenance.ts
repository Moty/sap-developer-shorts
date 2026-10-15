import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot, sourceFile } from "./paths.js";

// CAP discovers models, handlers, and configuration beyond its primary schema.
// Dependency contents are identified by the lockfile rather than this inventory.
export async function assertInventory(
  directory: string,
  expected: readonly string[],
): Promise<void> {
  const actual: string[] = [];
  async function walk(current: string, prefix = "") {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error(`Demo inventory cannot contain a symlink: ${name}`);
      if (entry.isDirectory()) await walk(resolve(current, entry.name), name);
      else if (entry.isFile()) actual.push(name);
      else throw new Error(`Unsupported demo input: ${name}`);
    }
  }
  await walk(directory);
  const added = actual.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !actual.includes(name));
  if (added.length || missing.length) {
    throw new Error(
      `Demo inventory differs from registration. Unregistered: ${added.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}`,
    );
  }
}

export async function runtimeFiles(): Promise<string[]> {
  const extension = extname(fileURLToPath(import.meta.url));
  const names = [
    "cli",
    "contracts",
    "domain",
    "demos",
    "doctor",
    "paths",
    "pipeline",
    "provenance",
    "review",
    "layout",
    "digest",
    "serve",
    "library",
    "library-review",
    "studio",
    "episode-package",
    "presentation",
    "production",
    "variants",
    "script-editor",
    "script-import",
    "video/timeline",
    "video/frames",
    "video/export",
    "video/receipt",
    "video/cache",
    "video/source",
    "news/contracts",
    "news/pipeline",
    "news/review",
    "media/model",
    "media/store",
    "media/worker",
    "media/audio",
    "media/neural",
    "media/voices",
    "media/voice-selection",
    "media/voice-audition",
    "media/providers",
    "media/package",
    "media/status",
    "media/fingerprint",
    "media/reuse",
    "media/reused-audio",
  ];
  return names.map((name) =>
    relative(
      projectRoot,
      fileURLToPath(new URL(`./${name}${extension}`, import.meta.url)),
    ).replaceAll("\\", "/"),
  );
}

export async function readRuntimeFiles(): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {};
  for (const file of await runtimeFiles()) result[file] = await readFile(await sourceFile(file));
  for (const file of [
    "src/media/kokoro-runner.py",
    "config/neural-voice.json",
    "config/neural-voice-requirements.txt",
  ])
    result[file] = await readFile(await sourceFile(file));
  return result;
}
