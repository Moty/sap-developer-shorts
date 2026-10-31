import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const selectorPattern = /^[A-Z]+-\d+(?:@[a-z][a-z0-9-]{0,31})?$/u;
export type VersionOrder = Record<string, number>;

export function validateVersionOrder(value: unknown): VersionOrder {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved version order");
  const seen = new Set<string>();
  const entries = Object.entries(value);
  if (entries.length > 10000) throw new Error("Version history is too large");
  for (const [selector, ordinal] of entries) {
    const key = `${selector.split("@")[0]}:${ordinal}`;
    if (
      !selectorPattern.test(selector) ||
      typeof ordinal !== "number" ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 1 ||
      seen.has(key)
    )
      throw new Error("Invalid or duplicate saved version number");
    seen.add(key);
  }
  return Object.fromEntries(entries);
}

async function savedSnapshotOrder(root: string): Promise<VersionOrder> {
  // A portable manifest carries the ledger, including gaps, so losing the local
  // database does not silently renumber versions when the snapshot is retained.
  const snapshots: { builtAt: string; order: VersionOrder }[] = [];
  for (const name of await readdir(root)) {
    if (!/^library-[a-f0-9-]+$/u.test(name)) continue;
    try {
      const manifest = JSON.parse(
        await readFile(resolve(root, name, "library-manifest.json"), "utf8"),
      );
      if (manifest.versionOrder && Number.isFinite(Date.parse(manifest.builtAt)))
        snapshots.push({
          builtAt: manifest.builtAt,
          order: validateVersionOrder(manifest.versionOrder),
        });
    } catch {
      /* Incomplete snapshots do not replace the ledger. */
    }
  }
  return snapshots.sort((a, b) => b.builtAt.localeCompare(a.builtAt))[0]?.order ?? {};
}

/** Append-only numbers, independent of rendering, mtimes, filtering and deletions. */
export async function allocateVersionOrder(
  root: string,
  versions: { selector: string; updatedAt: string }[],
): Promise<VersionOrder> {
  const directory = resolve(root, ".studio-versions");
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, "order.sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS versions (selector TEXT PRIMARY KEY, story TEXT NOT NULL, ordinal INTEGER NOT NULL, UNIQUE(story, ordinal));",
    );
    // An interrupted first transaction can leave an empty database file. Recover
    // before acquiring the write lease; no asynchronous I/O occurs inside it.
    const populated = db.prepare("SELECT 1 FROM versions LIMIT 1").get();
    const restore = populated ? {} : await savedSnapshotOrder(root);
    db.exec("BEGIN IMMEDIATE");
    const existing = db.prepare("SELECT selector, ordinal FROM versions").all();
    const insert = db.prepare("INSERT INTO versions(selector, story, ordinal) VALUES (?, ?, ?)");
    if (!existing.length)
      for (const [selector, ordinal] of Object.entries(restore))
        insert.run(selector, selector.split("@")[0] as string, ordinal);
    const known = db.prepare("SELECT ordinal FROM versions WHERE selector = ?");
    const next = db.prepare(
      "SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM versions WHERE story = ?",
    );
    // One-time legacy migration preserves the current display order. Historical
    // creation dates cannot be reconstructed from existing mutable timestamps.
    for (const version of [...versions].sort(
      (a, b) =>
        a.updatedAt.localeCompare(b.updatedAt) ||
        a.selector.localeCompare(b.selector, "en", { numeric: true }),
    )) {
      if (!selectorPattern.test(version.selector)) throw new Error("Invalid version selector");
      if (known.get(version.selector)) continue;
      const story = version.selector.split("@")[0] as string;
      insert.run(version.selector, story, (next.get(story) as { ordinal: number }).ordinal);
    }
    const order = Object.fromEntries(
      db
        .prepare("SELECT selector, ordinal FROM versions ORDER BY story, ordinal")
        .all()
        .map((row) => [row.selector, row.ordinal]),
    );
    db.exec("COMMIT");
    return validateVersionOrder(order);
  } finally {
    db.close(); // Also rolls back incomplete allocation and releases the lease on a crash.
  }
}
