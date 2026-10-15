import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inside } from "../paths.js";
import { assertVideoQuality, readVideoReceipt } from "./receipt.js";

const gateName = "export-gate.sqlite";

// A transaction supplies an OS-managed gate for stale PID-lock reclamation.
// Closing or losing the process releases it; no persistent lease/table is needed.
export async function acquireVideoGate(directory: string) {
  const path = resolve(directory, gateName);
  if ((await realpath(directory)) !== directory)
    throw new Error("Video cache directory must not be a symlink redirect");
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (stat && (!stat.isFile() || (await realpath(path)) !== path))
    throw new Error("Video export gate must not be a symlink redirect");
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA busy_timeout=0");
    database.exec("BEGIN IMMEDIATE");
  } catch (error) {
    database.close();
    throw new Error("This MP4 export cannot acquire its gate; another worker may be rendering it", {
      cause: error,
    });
  }
  let released = false;
  return () => {
    if (!released) {
      released = true;
      database.close();
    }
  };
}

export async function videoCacheDirectory(artifactRoot: string, selector: string, key: string) {
  if (
    !/^(ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}(?:@[a-z][a-z0-9-]{0,31})?$/u.test(selector) ||
    !/^[a-f0-9]{64}$/u.test(key)
  )
    throw new Error("Invalid video cache identity");
  let directory = await realpath(artifactRoot);
  for (const part of ["videos", selector.replace("@", "--"), `video-${key.slice(0, 16)}`]) {
    directory = resolve(directory, part);
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(directory)).isDirectory() || (await realpath(directory)) !== directory)
      throw new Error("Video cache directories must not contain symlink redirects");
  }
  return directory;
}

async function assertOwnedLock(directory: string, token: string) {
  const path = resolve(directory, "export.lock");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 4096) throw new Error("Video export lock is invalid");
  const owner = JSON.parse(await readFile(path, "utf8"));
  if (owner.pid !== process.pid || owner.host !== hostname() || owner.token !== token)
    throw new Error("Video export lock is no longer owned by this worker");
}

export async function releaseVideoLock(directory: string, token: string) {
  await assertOwnedLock(directory, token);
  await rm(resolve(directory, "export.lock"));
}

// Called only after acquiring export.lock. Recheck the cache because another
// worker may have completed between the initial read and lock acquisition.
export async function recoverVideoCache(
  directory: string,
  key: string,
  token: string,
  durationSeconds?: number,
) {
  if ((await realpath(directory)) !== directory)
    throw new Error("Video cache directory must not be a symlink redirect");
  await assertOwnedLock(directory, token);
  let failure: unknown;
  try {
    const saved = await readVideoReceipt(directory);
    if (saved.receipt.renderKey === key) {
      assertVideoQuality(saved.receipt.quality, durationSeconds);
      return { saved, recoveryDirectory: null };
    }
    throw new Error("Saved render key differs");
  } catch (error) {
    failure = error;
  }
  // A readable full key belonging to another render is a collision, not repair
  // permission. Missing/truncated metadata can still be preserved and rebuilt.
  let previous: { renderKey?: unknown } | null = null;
  try {
    const path = inside(directory, await realpath(resolve(directory, "video-manifest.json")));
    previous = JSON.parse(await readFile(path, "utf8"));
  } catch {
    /* Preserve malformed or redirected metadata without following it. */
  }
  if (
    typeof previous?.renderKey === "string" &&
    /^[a-f0-9]{64}$/u.test(previous.renderKey) &&
    previous.renderKey !== key
  )
    throw new Error("Saved render key differs; the existing export was left intact");
  const entries = (await readdir(directory)).filter(
    (name) =>
      name !== "export.lock" &&
      !/^export-gate\.sqlite(?:-journal|-wal|-shm)?$/u.test(name) &&
      !/^recovery-[a-f0-9-]{36}$/u.test(name),
  );
  if (!entries.length) return { saved: null, recoveryDirectory: null };
  const recoveryDirectory = resolve(directory, `recovery-${randomUUID()}`);
  await mkdir(recoveryDirectory);
  for (const name of entries) {
    await assertOwnedLock(directory, token);
    // rename moves a symlink itself and never opens its target. Incomplete moves
    // remain recoverable; a later retry preserves this recovery directory too.
    await rename(resolve(directory, name), resolve(recoveryDirectory, name));
  }
  await writeFile(
    resolve(recoveryDirectory, "recovery.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        renderKey: key,
        preservedAt: new Date().toISOString(),
        reason: failure instanceof Error ? failure.message : "Invalid saved export",
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  return { saved: null, recoveryDirectory };
}
