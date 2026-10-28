import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { unzipSync } from "fflate";
import { hash } from "../src/digest.js";
import { packageLibrary } from "../src/library-package.js";

const now = new Date("2026-10-30T10:00:00.000Z");
const uuid = "12345678-1234-1234-1234-123456789abc";
const rootInputs = [
  "templates/library.css",
  "templates/library.js",
  "templates/script-editor.css",
  "templates/script-editor.js",
  "config/production.json",
  "content/topics/backlog.json",
  "content/news/backlog.json",
];

async function fixture(t: TestContext) {
  const root = await mkdtemp(resolve(await realpath(tmpdir()), "sap-library-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = resolve(root, "source");
  const output = resolve(root, "output");
  await mkdir(source);
  const renderKey = hash("render");
  const identity = {
    schemaVersion: 1,
    kind: "kokoro-voice-sample",
    text: "A saved sample.",
    pronunciation: { SAP: "S A P" },
    voice: "af_heart",
    speed: 0.96,
    voiceRuntimeHash: hash("runtime"),
    generatorHash: hash("generator"),
  };
  const key = hash(JSON.stringify(identity));
  const files: Record<string, Buffer> = {
    "review.html": Buffer.from('<a href="episodes/CAP-01/video/review.html">Review</a>'),
    [`voices/${key}/sample.wav`]: Buffer.from("voice sample fixture"),
    "episodes/NEWS-01/edit.html": Buffer.from("Dated source review: 2026-10-15"),
    "episodes/NEWS-01/review.html": Buffer.from("Saved storyboard"),
    "episodes/NEWS-01/watch.html": Buffer.from("Storyboard wrapper"),
    "episodes/CAP-02/edit.html": Buffer.from("Unrecorded script"),
  };
  for (const name of [
    "edit.html",
    "review.html",
    "watch.html",
    "narration.wav",
    "timing.json",
    "captions.vtt",
    "episode-package.zip",
    "video/short.mp4",
    "video/poster.png",
    "video/review.html",
    "video/captions.vtt",
    "video/timing.json",
    "video/publication-draft.txt",
  ])
    files[`episodes/CAP-01/${name}`] = Buffer.from(`Frozen ${name} bytes`);
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(dirname(resolve(source, name)), { recursive: true });
    await writeFile(resolve(source, name), bytes);
  }
  const manifest = {
    schemaVersion: 1,
    kind: "review-library",
    builtAt: "2026-10-15T10:00:00.000Z",
    sourceHashes: Object.fromEntries(
      [
        ...rootInputs,
        "content/episodes/CAP-01.json",
        "content/episodes/CAP-02.json",
        "content/episodes/NEWS-01.json",
      ].map((name) => [name, hash(name)]),
    ),
    runtimeHashes: { "src/library.ts": hash("historical runtime") },
    artifactHashes: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
    ),
    excludedRuns: 2,
    episodePackages: [
      {
        selector: "CAP-01",
        filename: `CAP-01-v1-${renderKey.slice(0, 8)}.zip`,
        sha256: hash(files["episodes/CAP-01/episode-package.zip"] as Buffer),
      },
    ],
    voiceSamples: [
      {
        key,
        identity,
        audioHash: hash(files[`voices/${key}/sample.wav`] as Buffer),
        durationSeconds: 10,
      },
    ],
    episodes: [
      {
        id: "CAP-01",
        selector: "CAP-01",
        version: 1,
        inputHash: hash("episode"),
        sourceReviewExpired: false,
        preview: {
          kind: "narrated",
          sourceRunId: `CAP-01-v1-${uuid}`,
          sourceManifestHash: hash("source"),
          mediaJobId: uuid,
          durationSeconds: 55,
          timingReady: true,
        },
        video: { renderKey, durationSeconds: 55 },
      },
      {
        id: "NEWS-01",
        selector: "NEWS-01",
        version: 1,
        inputHash: hash("news"),
        sourceReviewExpired: false,
        preview: {
          kind: "storyboard",
          sourceRunId: `NEWS-01-v1-${uuid}`,
          sourceManifestHash: hash("news source"),
          mediaJobId: null,
          durationSeconds: 58,
          timingReady: false,
        },
      },
      {
        id: "CAP-02",
        selector: "CAP-02",
        version: 1,
        inputHash: hash("pending"),
        sourceReviewExpired: false,
        preview: null,
      },
    ],
  };
  const save = (value: unknown = manifest) =>
    writeFile(resolve(source, "library-manifest.json"), `${JSON.stringify(value, null, 2)}\n`);
  await save();
  const run = () => packageLibrary(source, { artifactRoot: output, now });
  const noOutput = async () => {
    assert.deepEqual(
      await readdir(output).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }),
      [],
    );
  };
  return { root, source, output, manifest, files, save, run, noOutput };
}

test("a portable studio archive contains exactly the saved bytes and leaves original files and dates unchanged", async (t) => {
  const f = await fixture(t);
  const originalManifest = await readFile(resolve(f.source, "library-manifest.json"));
  await writeFile(resolve(f.source, ".env"), "SECRET=not for export");
  await mkdir(resolve(f.source, "config"));
  await writeFile(resolve(f.source, "config/credentials.json"), "private");
  const result = await f.run();
  assert.deepEqual((await readdir(result.directory)).sort(), [
    "package-manifest.json",
    "review.html",
    "studio.zip",
  ]);
  const archive = await readFile(resolve(result.directory, "studio.zip"));
  const members = unzipSync(archive);
  assert.deepEqual(
    Object.keys(members).sort(),
    [
      "README.txt",
      "studio/library-manifest.json",
      ...Object.keys(f.files).map((name) => `studio/${name}`),
    ].sort(),
  );
  for (const [name, bytes] of Object.entries(f.files)) {
    assert.deepEqual(Buffer.from(members[`studio/${name}`] as Uint8Array), bytes);
    assert.deepEqual(await readFile(resolve(f.source, name)), bytes);
  }
  assert.deepEqual(
    Buffer.from(members["studio/library-manifest.json"] as Uint8Array),
    originalManifest,
  );
  assert.deepEqual(await readFile(resolve(f.source, "library-manifest.json")), originalManifest);
  assert.equal(result.manifest.sourceManifestHash, hash(originalManifest));
  assert.equal(result.manifest.archive.sha256, hash(archive));
  for (const [name, digest] of Object.entries(result.manifest.memberHashes))
    assert.equal(hash(Buffer.from(members[name] as Uint8Array)), digest);
  assert.equal(result.manifest.episodeCount, 3);
  assert.equal(result.manifest.videoCount, 1);
  assert.equal(result.manifest.sourceReviewRenewed, false);
  assert.equal(result.manifest.libraryBuiltAt, f.manifest.builtAt);
  assert.doesNotMatch(JSON.stringify(result.manifest), new RegExp(f.root));
  const readme = Buffer.from(members["README.txt"] as Uint8Array).toString();
  assert.match(readme, /Recheck official sources/u);
  assert.match(readme, /2026-10-15/u);
  const html = await readFile(resolve(result.directory, "review.html"), "utf8");
  assert.match(html, /href="studio.zip" download=/u);
  assert.doesNotMatch(html, /<script|autoplay/u);
  const second = await f.run();
  assert.notEqual(second.directory, result.directory);
  assert.equal(second.manifest.archive.sha256, result.manifest.archive.sha256);
});

test("narration awaiting timing review remains a saved preview without invented MP4 readiness", async (t) => {
  const f = await fixture(t);
  const first = f.manifest.episodes[0];
  assert.ok(first?.preview);
  delete first.video;
  first.preview.durationSeconds = 72;
  first.preview.timingReady = false;
  f.manifest.episodePackages = [];
  for (const name of Object.keys(f.manifest.artifactHashes))
    if (name.includes("/video/") || name.endsWith("episode-package.zip"))
      delete f.manifest.artifactHashes[name];
  await f.save();
  const result = await f.run();
  assert.equal(result.manifest.videoCount, 0);
  assert.equal(result.manifest.episodePackageCount, 0);
  assert.equal(result.manifest.episodeCount, 3);
});

test("current portrait provenance and optional publication screens remain portable", async (t) => {
  const f = await fixture(t);
  const page = "episodes/CAP-01/publish.html";
  const bytes = Buffer.from("Review and publication fixture");
  await writeFile(resolve(f.source, page), bytes);
  await f.save({
    ...f.manifest,
    runtimeHashes: {
      ...f.manifest.runtimeHashes,
      ...Object.fromEntries(
        [
          "src/workflow.ts",
          "src/publish-review.ts",
          "templates/final-review.js",
          "templates/editor-workspace.js",
          "templates/editor-workspace.css",
          "scripts/setup-portrait.py",
          "config/portrait-runtime.json",
          "config/portrait-requirements.txt",
          "config/talking-head.json",
          "config/talking-head-requirements.txt",
        ].map((name) => [name, hash(name)]),
      ),
    },
    artifactHashes: { ...f.manifest.artifactHashes, [page]: hash(bytes) },
  });
  const result = await f.run();
  const members = unzipSync(await readFile(resolve(result.directory, "studio.zip")));
  assert.deepEqual(Buffer.from(members[`studio/${page}`] as Uint8Array), bytes);
});

test("malformed manifests, mismatched readiness, duplicate selectors, and missing inventory fail before publication", async (t) => {
  const f = await fixture(t);
  const cases: unknown[] = [
    { ...f.manifest, kind: "other" },
    { ...f.manifest, builtAt: "2026-02-31T10:00:00.000Z" },
    { ...f.manifest, builtAt: "2030-01-01T00:00:00.000Z" },
    { ...f.manifest, extra: true },
    { ...f.manifest, episodes: [...f.manifest.episodes, f.manifest.episodes[0]] },
    { ...f.manifest, episodePackages: [] },
    { ...f.manifest, voiceSamples: [...f.manifest.voiceSamples, f.manifest.voiceSamples[0]] },
    { ...f.manifest, runtimeHashes: { "/Users/someone/private.ts": hash("private") } },
    { ...f.manifest, sourceHashes: { "config/credentials.json": hash("private") } },
    { ...f.manifest, artifactHashes: { "review.html": "not-a-digest" } },
  ];
  const mismatched = structuredClone(f.manifest);
  const video = mismatched.episodes[0]?.video;
  assert.ok(video);
  video.durationSeconds = 58;
  cases.push(mismatched);
  for (const value of cases) {
    await f.save(value);
    await assert.rejects(f.run);
    await f.noOutput();
  }
  await writeFile(
    resolve(f.source, "library-manifest.json"),
    '{"schemaVersion":1,"schemaVersion":2}\n',
  );
  await assert.rejects(f.run, /canonical/u);
  await f.noOutput();
});

test("only generated inventory paths are eligible even when other files have matching hashes", async (t) => {
  const f = await fixture(t);
  for (const name of [
    ".env",
    "config/production.json",
    "models/model.bin",
    "episodes/CAP-01/private.txt",
    "episodes/CAP-99/edit.html",
    "episodes/CAP-01/../CAP-02/edit.html",
    "episodes//CAP-01/edit.html",
    "episodes\\CAP-01\\edit.html",
    "/tmp/private",
    "C:/private",
    "episodes/CAP-01/%2e%2e/private",
    "Review.html",
  ]) {
    await f.save({
      ...f.manifest,
      artifactHashes: { ...f.manifest.artifactHashes, [name]: hash("secret") },
    });
    await assert.rejects(f.run, /inventory path/u);
    await f.noOutput();
  }
});

test("missing and modified artifacts fail rather than producing a partial bundle", async (t) => {
  const f = await fixture(t);
  const path = resolve(f.source, "episodes/CAP-01/video/short.mp4");
  await writeFile(path, "Altered media");
  await assert.rejects(f.run, /digest differs/u);
  await f.noOutput();
  await rm(path);
  await assert.rejects(f.run, /ENOENT/u);
  await f.noOutput();
});

test("source files and directories cannot redirect packaging through symlinks", async (t) => {
  const f = await fixture(t);
  const sourceAlias = resolve(f.root, "alias");
  await symlink(f.source, sourceAlias);
  await assert.rejects(packageLibrary(sourceAlias, { artifactRoot: f.output, now }), /symlink/u);
  const target = resolve(f.root, "outside.html");
  await writeFile(target, f.files["review.html"] as Buffer);
  await rm(resolve(f.source, "review.html"));
  await symlink(target, resolve(f.source, "review.html"));
  await assert.rejects(f.run, /symlink/u);
  await f.noOutput();
  await rm(resolve(f.source, "review.html"));
  await writeFile(resolve(f.source, "review.html"), f.files["review.html"] as Buffer);
  const directory = resolve(f.source, "episodes/CAP-02");
  await rm(directory, { recursive: true });
  await symlink(f.root, directory);
  await assert.rejects(f.run, /symlink/u);
  await f.noOutput();
});

test("nonregular inputs including FIFOs fail without hanging", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const path = resolve(f.source, "review.html");
  await rm(path);
  await mkdir(path);
  await assert.rejects(f.run, /regular file/u);
  await rm(path, { recursive: true });
  execFileSync("mkfifo", [path]);
  await assert.rejects(f.run, /regular file/u);
  await f.noOutput();
});

test("output cannot be placed inside the original studio or redirected there", async (t) => {
  const f = await fixture(t);
  const before = await readdir(f.source);
  for (const output of [f.source, resolve(f.source, "new/output")])
    await assert.rejects(
      packageLibrary(f.source, { artifactRoot: output, now }),
      /outside the saved studio/u,
    );
  const alias = resolve(f.root, "output-alias");
  await symlink(f.source, alias);
  await assert.rejects(
    packageLibrary(f.source, { artifactRoot: resolve(alias, "nested"), now }),
    /symlink/u,
  );
  assert.deepEqual(await readdir(f.source), before);
});

test("manifest, artifact-count, and aggregate byte limits are checked before allocating media buffers", async (t) => {
  const f = await fixture(t);
  const path = resolve(f.source, "library-manifest.json");
  await writeFile(path, " ".repeat(1024 * 1024 + 1));
  await assert.rejects(f.run, /size limit/u);
  await f.save({
    ...f.manifest,
    artifactHashes: Object.fromEntries(
      Array.from({ length: 4097 }, (_, i) => [`file-${i}`, hash("x")]),
    ),
  });
  await assert.rejects(f.run, /4096/u);
  await f.save();
  await truncate(resolve(f.source, "episodes/CAP-01/narration.wav"), 300 * 1024 * 1024);
  await truncate(resolve(f.source, "episodes/CAP-01/video/short.mp4"), 300 * 1024 * 1024);
  await assert.rejects(f.run, /512 MiB/u);
  await f.noOutput();
});

test("studio packages retain complete presentation files for scripts and videos, plus their known template provenance", async (t) => {
  const f = await fixture(t);
  for (const prefix of ["episodes/CAP-01/", "episodes/CAP-01/video/", "episodes/CAP-02/"]) {
    for (const name of ["presentation.html", "presentation.json", "reveal-LICENSE.txt"]) {
      const path = prefix + name,
        bytes = Buffer.from(`Saved ${path}`);
      f.manifest.artifactHashes[path] = hash(bytes);
      await writeFile(resolve(f.source, path), bytes);
    }
  }
  for (const name of [
    "templates/presentation.css",
    "templates/presentation.js",
    "templates/library-collections.js",
    "templates/library-stories.js",
    "templates/library-navigation.js",
    "templates/library-browser.css",
    "templates/voice-library.css",
    "templates/local-actions.js",
    "templates/episode-shell.css",
    "templates/episode-shell.js",
    "templates/writing-assistant.css",
    "templates/writing-assistant.js",
  ])
    f.manifest.sourceHashes[name] = hash(name);
  const generation = {
    totalMs: 1000,
    basis: "generation",
    reusedAudio: false,
    reusedVideo: false,
    stages: { preparationMs: 100, audioMs: 400, videoMs: 500 },
  };
  const episode = f.manifest.episodes[0] as Record<string, unknown>;
  episode.generation = generation;
  await f.save();
  const result = await f.run();
  const archive = unzipSync(await readFile(resolve(result.directory, "studio.zip")));
  assert.ok(archive["studio/episodes/CAP-01/video/presentation.html"]);
  assert.ok(archive["studio/episodes/CAP-02/presentation.json"]);
  generation.stages.audioMs = -1;
  await f.save();
  await assert.rejects(f.run(), /Cannot package saved studio/);
  generation.stages.audioMs = 400;
  delete f.manifest.artifactHashes["episodes/CAP-02/presentation.json"];
  await f.save();
  await assert.rejects(f.run(), /incomplete presentation inventory/);
});
