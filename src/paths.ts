import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from this module, so commands work outside the repository directory.
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const root = [resolve(moduleDirectory, ".."), resolve(moduleDirectory, "../..")].find((candidate) =>
  existsSync(resolve(candidate, "schemas/episode.schema.json")),
);
if (!root) throw new Error("Cannot locate repository schemas beside the application");
// Registered workers stage each job in a private workspace. The caller supplies
// this process-level path before any pipeline modules are imported.
export const repositoryRoot = root;
export const projectRoot = process.env.SHORTS_WORKSPACE_ROOT
  ? resolve(process.env.SHORTS_WORKSPACE_ROOT)
  : root;
export const modelStateRoot = process.env.SHORTS_MODEL_STATE_ROOT
  ? resolve(process.env.SHORTS_MODEL_STATE_ROOT)
  : resolve(projectRoot, ".state");

export function inside(root: string, candidate: string): string {
  const absolute = resolve(root, candidate);
  const child = relative(root, absolute);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`Path must stay inside ${root}: ${candidate}`);
  }
  return absolute;
}

export async function sourceFile(path: string): Promise<string> {
  const resolved = await realpath(inside(projectRoot, path));
  return inside(projectRoot, resolved);
}
