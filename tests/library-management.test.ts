import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readContentEpisode } from "../src/contracts.js";
import { readCreatorRecord } from "../src/creator-store.js";
import { hash } from "../src/digest.js";
import {
  compareLibraryVersions,
  type defaultStoryMetadata,
  libraryMetadataMatch,
  parseStoryMetadata,
  saveStoryMetadata,
  verifiedLibraryVideo,
} from "../src/library-management.js";

test("story filters compose and archive is reversible without touching versions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "story-management-"));
  try {
    await writeFile(
      resolve(root, "library-manifest.json"),
      JSON.stringify({
        episodes: [{ selector: "CAP-01" }, { selector: "CAP-01@casual-v2" }],
        artifactHashes: {},
      }),
    );
    await saveStoryMetadata(resolve(root, ".creator"), root, "CAP-01", {
      favorite: true,
      series: "CAP essentials",
    });
    await saveStoryMetadata(resolve(root, ".creator"), root, "CAP-01", { archived: true });
    const records = (await readCreatorRecord(resolve(root, ".creator"), "library")) as Record<
      string,
      typeof defaultStoryMetadata
    >;
    const meta = records["CAP-01"];
    assert.ok(meta);
    assert.equal(libraryMetadataMatch(meta, "active", false, ""), false);
    assert.equal(libraryMetadataMatch(meta, "archived", true, "CAP essentials"), true);
    assert.equal(libraryMetadataMatch(meta, "all", true, "Other series"), false);
    await saveStoryMetadata(resolve(root, ".creator"), root, "CAP-01", { archived: false });
    const restored = (await readCreatorRecord(
      resolve(root, ".creator"),
      "library",
    )) as typeof records;
    assert.deepEqual(restored["CAP-01"], {
      favorite: true,
      archived: false,
      series: "CAP essentials",
    });
    await assert.rejects(
      () => saveStoryMetadata(root, root, "../../elsewhere", { archived: true }),
      /current library/,
    );
    assert.throws(
      () => parseStoryMetadata({ favorite: true, archived: false, series: "<img>" }),
      /organization/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("separate studio processes cannot lose concurrent metadata updates", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "creator-concurrent-"));
  try {
    const module = new URL("../src/creator-store.ts", import.meta.url).href;
    const exec = promisify(execFile);
    await Promise.all(
      ["one", "two"].map((name) =>
        exec(process.execPath, [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `import {updateCreatorRecord} from ${JSON.stringify(module)}; await updateCreatorRecord(${JSON.stringify(root)},'concurrent',old=>[...(old??[]),${JSON.stringify(name)}]);`,
        ]),
      ),
    );
    assert.deepEqual(((await readCreatorRecord(root, "concurrent")) as string[]).sort(), [
      "one",
      "two",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("comparison reads actual version text and rejects mismatched saved input", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "creator-compare-"));
  try {
    const selectors = ["CAP-01", "CAP-01@casual-v2"];
    const episodes = await Promise.all(selectors.map(readContentEpisode));
    await mkdir(resolve(root, ".workflow"));
    await writeFile(
      resolve(root, "library-manifest.json"),
      JSON.stringify({
        episodes: episodes.map((episode, index) => ({
          selector: selectors[index],
          inputHash: hash(JSON.stringify(episode)),
          sourceReviewExpired: false,
          preview: { kind: "storyboard", durationSeconds: 55 },
        })),
        artifactHashes: {},
      }),
    );
    const versions = await compareLibraryVersions(root, resolve(root, ".workflow"), selectors);
    assert.equal(versions[0]?.title, episodes[0]?.title);
    assert.equal(versions[1]?.scenes[0]?.narration, episodes[1]?.scenes[0]?.narration);
    assert.equal(versions[0]?.video, null);
    assert.equal(versions[0]?.measuredSeconds, null);
    await assert.rejects(
      () => compareLibraryVersions(root, root, ["CAP-01", "CAP-01"]),
      /different/,
    );
    await writeFile(
      resolve(root, "library-manifest.json"),
      JSON.stringify({
        episodes: selectors.map((selector) => ({ selector, inputHash: "changed" })),
        artifactHashes: {},
      }),
    );
    await assert.rejects(() => compareLibraryVersions(root, root, selectors), /script changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compared MP4 playback rejects a changed render or changed bytes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "compare-media-"));
  try {
    await mkdir(resolve(root, "episodes/CAP-01/video"), { recursive: true });
    const bytes = Buffer.from("video A");
    const renderKey = "a".repeat(64);
    const digest = hash(bytes);
    await writeFile(resolve(root, "episodes/CAP-01/video/short.mp4"), bytes);
    const manifest = {
      episodes: [{ selector: "CAP-01", video: { renderKey } }],
      artifactHashes: { "episodes/CAP-01/video/short.mp4": digest },
    };
    await writeFile(resolve(root, "library-manifest.json"), JSON.stringify(manifest));
    assert.deepEqual(await verifiedLibraryVideo(root, "CAP-01", renderKey, digest), bytes);
    assert.ok(manifest.episodes[0]);
    manifest.episodes[0].video.renderKey = "b".repeat(64);
    await writeFile(resolve(root, "library-manifest.json"), JSON.stringify(manifest));
    await assert.rejects(
      () => verifiedLibraryVideo(root, "CAP-01", renderKey, digest),
      /video changed/,
    );
    assert.ok(manifest.episodes[0]);
    manifest.episodes[0].video.renderKey = renderKey;
    await writeFile(resolve(root, "library-manifest.json"), JSON.stringify(manifest));
    await writeFile(resolve(root, "episodes/CAP-01/video/short.mp4"), "video B");
    await assert.rejects(
      () => verifiedLibraryVideo(root, "CAP-01", renderKey, digest),
      /video changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
