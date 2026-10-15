import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readContentEpisode, readEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import type { ContentEpisode, DemoEvidence } from "../src/domain.js";
import { buildLibrary, collectLibrary } from "../src/library.js";
import { createLibraryPages } from "../src/library-review.js";
import { encodePcmWav, pronounce, sampleRate } from "../src/media/audio.js";
import type { MediaProvider, NarrationTiming } from "../src/media/model.js";
import { packageNarration } from "../src/media/package.js";
import { MediaStore } from "../src/media/store.js";
import { createMediaJob, loadVerifiedRun, productionSettings } from "../src/media/worker.js";
import { newsEvidence, readNewsEpisode } from "../src/news/contracts.js";
import { prepareContentEpisode } from "../src/pipeline.js";

const episode = await readEpisode("CAP-01");
const evidence: DemoEvidence = {
  demoId: "cap-inventory",
  verifiedAt: new Date().toISOString(),
  environment: { node: process.version, cds: "10.1.1", database: "sqlite-memory" },
  checks: [...episode.demo.expectedChecks],
  captures: {
    products: { value: [] },
    filtered: { value: [] },
    metadata: '<edmx:Edmx Version="4.0"></edmx:Edmx>',
  },
};

test("the library keeps presentation variants separate from the original episode and each other", async (t) => {
  const directory = await root(t);
  const casual = await readContentEpisode("CAP-01@casual");
  const duo = await readContentEpisode("CAP-01@duo");
  const originalRun = await run(directory);
  const casualRun = await run(directory, casual);
  const duoRun = await run(directory, duo);
  const library = await collectLibrary([episode, casual, duo], directory);
  assert.deepEqual(
    library.entries.map((entry) => entry.preview?.sourceRunId).sort(),
    [originalRun.manifest.runId, casualRun.manifest.runId, duoRun.manifest.runId].sort(),
  );
  const pages = await createLibraryPages({
    ...library,
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.ok(pages["episodes/CAP-01/watch.html"]);
  assert.ok(pages["episodes/CAP-01@casual/watch.html"]);
  assert.ok(pages["episodes/CAP-01@duo/watch.html"]);
  assert.match(String(pages["review.html"]), /Delivery styles/);
  assert.match(String(pages["review.html"]), /Two-person conversation/);
});

async function root(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-library-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function run(directory: string, input: ContentEpisode = episode) {
  return prepareContentEpisode(input, {
    artifactRoot: directory,
    preview: true,
    verifier: async () => evidence,
  });
}

async function addNarration(t: TestContext, directory: string, source: string) {
  const providerOutput = resolve(directory, "synthetic-test-audio");
  await mkdir(providerOutput);
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "synthetic test fixture",
    rate: 180,
    sampleRate,
    durationSeconds: episode.targetDurationSeconds,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      speechSeconds: 0.1,
    })),
    cues: episode.scenes.map((scene) => ({
      sceneId: scene.id,
      text: scene.narration,
      spokenText: pronounce(scene.narration, episode.pronunciation),
      startSeconds: scene.startSeconds,
      endSeconds: scene.startSeconds + 0.1,
    })),
  };
  await writeFile(
    resolve(providerOutput, "narration.wav"),
    encodePcmWav(Buffer.alloc(sampleRate * 2 * episode.targetDurationSeconds)),
  );
  await writeFile(resolve(providerOutput, "timing.json"), JSON.stringify(timing));
  const store = await MediaStore.open(resolve(directory, "test-jobs.sqlite"));
  t.after(() => store.close());
  const provider: MediaProvider = {
    id: "local-speech",
    billing: "free",
    quote: () => 0,
    submit: async () => {
      throw new Error("Library tests must not generate media");
    },
    lookup: async () => ({ state: "unknown" }),
    poll: async () => {
      throw new Error("Library tests must not generate media");
    },
  };
  const job = await createMediaJob(store, source, provider, await productionSettings());
  job.providerOutput = { kind: "narration", billedCents: 0, directory: providerOutput };
  return packageNarration(job);
}

test("the library prefers matching narrated output over a newer silent run and excludes an old script revision", async (t) => {
  const directory = await root(t);
  const first = await run(directory);
  await addNarration(t, directory, first.directory);
  await run(directory);
  const library = await collectLibrary([episode], directory);
  assert.equal(library.entries[0]?.preview?.kind, "narrated");
  assert.equal(library.entries[0]?.preview?.sourceRunId, first.manifest.runId);
  assert.equal(library.entries[0]?.preview?.timingReady, true);
  const edited = structuredClone(episode);
  const hook = edited.scenes[0];
  assert.ok(hook);
  hook.narration = "Where is that service?";
  assert.equal((await collectLibrary([edited], directory)).entries[0]?.preview, null);
  edited.version++;
  assert.equal((await collectLibrary([edited], directory)).entries[0]?.preview, null);
});

test("modified narration is excluded while its verified silent preview remains available", async (t) => {
  const directory = await root(t);
  const source = await run(directory);
  const output = await addNarration(t, directory, source.directory);
  await writeFile(resolve(output, "narration.wav"), "partial download");
  const library = await collectLibrary([episode], directory);
  assert.equal(library.entries[0]?.preview?.kind, "storyboard");
  assert.equal(library.excludedRuns, 1);
});

test("a preview cannot include a symlink to a file outside its run, even with a matching digest", async (t) => {
  const directory = await root(t);
  const source = await run(directory);
  const review = resolve(source.directory, "review.html");
  const outside = resolve(directory, "outside.html");
  await writeFile(outside, await readFile(review));
  await rm(review);
  await symlink(outside, review);
  await assert.rejects(loadVerifiedRun(source.directory), /must stay inside/);
  assert.equal((await collectLibrary([episode], directory)).entries[0]?.preview, null);
});

test("expired news remains viewable with a recheck label while new media production stays blocked", async (t) => {
  const directory = await root(t);
  const news = await readNewsEpisode("NEWS-01");
  news.news.asOf = new Date().toISOString().slice(0, 10);
  for (const item of news.sources) item.retrievedOn = news.news.asOf;
  for (const item of news.claims) item.checkedOn = news.news.asOf;
  const source = await run(directory, news);
  news.news.asOf = "2000-01-01";
  for (const item of news.sources) {
    item.retrievedOn = news.news.asOf;
    item.publishedOn = null;
  }
  for (const item of news.claims) item.checkedOn = news.news.asOf;
  for (const [name, data] of [
    ["episode.json", news],
    ["news-evidence.json", newsEvidence(news)],
  ] as const) {
    const text = `${JSON.stringify(data, null, 2)}\n`;
    await writeFile(resolve(source.directory, name), text);
    source.manifest.artifactHashes[name] = hash(text);
  }
  source.manifest.inputHash = hash(JSON.stringify(news));
  await writeFile(resolve(source.directory, "manifest.json"), JSON.stringify(source.manifest));
  await assert.rejects(loadVerifiedRun(source.directory), /stale/);
  const library = await collectLibrary([news], directory);
  assert.ok(library.entries[0]?.preview);
  assert.equal(library.entries[0]?.sourceReviewExpired, true);
  const files = await createLibraryPages({
    ...library,
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.ok(String(files["review.html"]).includes("Sources need rechecking"));
  assert.ok(String(files["review.html"]).includes("Saved preview only"));
  assert.ok(String(files["episodes/NEWS-01/watch.html"]).includes("source recheck needed"));
});

test("a library is a portable hashed copy of validated previews and escapes titles", async (t) => {
  const directory = await root(t);
  const source = await run(directory);
  const built = await buildLibrary({ artifactRoot: directory });
  assert.ok(built.manifest.runtimeHashes["src/library.ts"]);
  assert.ok(built.manifest.sourceHashes["templates/library.css"]);
  for (const [name, expected] of Object.entries(built.manifest.artifactHashes))
    assert.equal(hash(await readFile(resolve(built.directory, name))), expected);
  const copied = resolve(built.directory, "episodes/CAP-01/review.html");
  const original = await readFile(resolve(source.directory, "review.html"));
  assert.deepEqual(await readFile(copied), original);
  await rm(source.directory, { recursive: true });
  assert.deepEqual(await readFile(copied), original);
  const library = await collectLibrary([episode], resolve(directory, "missing"));
  const entry = library.entries[0];
  assert.ok(entry);
  entry.episode.title = '<img src=x onerror="alert(1)">';
  const files = await createLibraryPages({
    ...library,
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  const html = String(files["review.html"]);
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("No matching preview yet"));
  assert.ok(!files["episodes/CAP-01/watch.html"]);
});
