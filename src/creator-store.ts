import { chmod, lstat, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectRoot } from "./paths.js";

export function creatorRoot(artifactRoot?: string) {
  return resolve(
    projectRoot,
    artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
    ".creator",
  );
}
async function database(root: string, create: boolean) {
  const path = resolve(root, "studio.sqlite");
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    if (!(await lstat(path)).isFile()) throw new Error("Invalid private studio database.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!create) return null;
  }
  const db = new DatabaseSync(path, { readOnly: !create });
  if (create) {
    await chmod(path, 0o600);
    db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  } else db.exec("PRAGMA busy_timeout=5000");
  return db;
}
function decode(value: unknown) {
  if (typeof value !== "string" || value.length > 512 * 1024)
    throw new Error("Invalid private studio record.");
  return JSON.parse(value) as unknown;
}
export async function readCreatorRecord(root: string, key: string): Promise<unknown | null> {
  const db = await database(root, false);
  if (!db) return null;
  try {
    const row = db.prepare("SELECT value FROM records WHERE key=?").get(key);
    return row ? decode(row.value) : null;
  } finally {
    db.close();
  }
}
/** No asynchronous work occurs inside this cross-process write transaction. */
export async function updateCreatorRecord(
  root: string,
  key: string,
  mutate: (previous: unknown | null) => unknown,
) {
  const db = await database(root, true);
  if (!db) throw new Error("Private studio database unavailable.");
  try {
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT value FROM records WHERE key=?").get(key);
    const value = mutate(row ? decode(row.value) : null);
    if (value instanceof Promise) throw new Error("Studio transactions must be synchronous.");
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized) > 512 * 1024)
      throw new Error("Studio preferences exceed the saved record limit.");
    db.prepare(
      "INSERT INTO records(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(key, serialized);
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* No active transaction. */
    }
    throw error;
  } finally {
    db.close();
  }
}
export function writeCreatorRecord(root: string, key: string, value: unknown) {
  return updateCreatorRecord(root, key, () => value);
}
