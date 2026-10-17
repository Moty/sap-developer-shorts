import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectRoot } from "../paths.js";

const held = new AsyncLocalStorage<boolean>();
const directory = resolve(projectRoot, ".state/local-model");
// The OS releases the SQLite transaction on process exit. There is no stale
// PID-file read/unlink window in which competing workers can both enter.
export async function withModelLock<T>(
  action: () => Promise<T>,
  gateDirectory = directory,
): Promise<T> {
  const directory = resolve(gateDirectory);
  if (held.getStore()) return action();
  await mkdir(directory, { recursive: true });
  if ((await realpath(directory)) !== directory)
    throw new Error("Model gate cannot contain redirects.");
  const path = resolve(directory, "gate.sqlite");
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (info && (!info.isFile() || (await realpath(path)) !== path))
    throw new Error("Model gate must be a regular file.");
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch (error) {
    database.close();
    throw new Error("A local voice or portrait model is busy. Wait for it to finish, then retry.", {
      cause: error,
    });
  }
  try {
    return await held.run(true, action);
  } finally {
    database.close();
  }
}
