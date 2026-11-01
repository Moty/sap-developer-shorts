import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { groupStories } from "../src/library-stories.js";
import { allocateVersionOrder, validateVersionOrder } from "../src/version-order.js";

test("saved version numbers survive old renders, additions, deletion gaps and snapshot restoration", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "shorts-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const versions = [
    { selector: "CAP-01", updatedAt: "2026-10-01T00:00:00Z" },
    { selector: "CAP-01@newer", updatedAt: "2026-10-02T00:00:00Z" },
  ];
  const order = await allocateVersionOrder(root, versions);
  assert.deepEqual(order, { "CAP-01": 1, "CAP-01@newer": 2 });
  assert.ok(versions[0]);
  versions[0].updatedAt = "2026-10-28T00:00:00Z";
  assert.deepEqual(await allocateVersionOrder(root, versions), order);
  const stories = groupStories(
    versions.map((v, index) => ({
      ...v,
      id: "CAP-01",
      stage: index === 0 ? ("publish" as const) : ("review" as const),
      attention: false,
      ordinal: (order as Record<string, number>)[v.selector],
    })),
  );
  assert.equal(stories[0]?.latest.selector, "CAP-01@newer");
  assert.equal(stories[0]?.representative.selector, "CAP-01@newer");
  assert.ok(stories[0]);
  assert.deepEqual(Object.fromEntries(stories[0].labels), {
    "CAP-01": "v1",
    "CAP-01@newer": "v2",
  });
  const added = await allocateVersionOrder(root, [
    { selector: "CAP-01@alphabetically-first", updatedAt: "2020-01-01T00:00:00Z" },
  ]);
  assert.equal(added["CAP-01@alphabetically-first"], 3);
  const snapshot = resolve(root, "library-abc");
  await mkdir(snapshot);
  await writeFile(
    resolve(snapshot, "library-manifest.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), versionOrder: added }),
  );
  await rm(resolve(root, ".studio-versions"), { recursive: true });
  await mkdir(resolve(root, ".studio-versions"));
  new DatabaseSync(resolve(root, ".studio-versions/order.sqlite")).close();
  const restored = await allocateVersionOrder(root, [
    { selector: "CAP-01@fourth", updatedAt: "2020-01-01T00:00:00Z" },
  ]);
  assert.equal(restored["CAP-01@fourth"], 4);
  assert.equal(restored["CAP-01@newer"], 2);
});

test("concurrent allocations preserve unique ordinals, and malformed portable ledgers are rejected", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "shorts-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(
    ["first", "second", "third"].map((name) =>
      allocateVersionOrder(root, [{ selector: `CAP-01@${name}`, updatedAt: "2026-10-28" }]),
    ),
  );
  const order = await allocateVersionOrder(root, []);
  assert.equal(new Set(Object.values(order)).size, 3);
  assert.throws(() => validateVersionOrder({ "CAP-01": 1, "CAP-01@dup": 1 }));
  assert.throws(() => validateVersionOrder({ "../bad": 1 }));
  assert.throws(() => validateVersionOrder({ "CAP-01": 0 }));
});
