import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readContentEpisode, readEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import type { ContentEpisode, DemoEvidence } from "../src/domain.js";
import { buildEpisodePackage } from "../src/episode-package.js";
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
  assert.match(String(pages["review.html"]), /Choose a storytelling format/);
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

async function addNarration(
  t: TestContext,
  directory: string,
  source: string,
  voice = "synthetic test fixture",
) {
  const providerOutput = resolve(directory, `synthetic-test-audio-${voice.replaceAll(" ", "-")}`);
  await mkdir(providerOutput);
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice,
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
  const settings = await productionSettings();
  settings.localPreview.voice = voice;
  const job = await createMediaJob(store, source, provider, settings);
  job.providerOutput = { kind: "narration", billedCents: 0, directory: providerOutput };
  return packageNarration(job);
}

test("explicit narration selection survives Heart to Bella to Heart without choosing newer audio", async (t) => {
  const directory = await root(t);
  const first = await run(directory);
  const heart = await addNarration(t, directory, first.directory, "af_heart");
  const heartReceipt = JSON.parse(await readFile(resolve(heart, "media-manifest.json"), "utf8"));
  const second = await run(directory);
  const bella = await addNarration(t, directory, second.directory, "af_bella");
  const bellaReceipt = JSON.parse(await readFile(resolve(bella, "media-manifest.json"), "utf8"));
  assert.equal(
    (await collectLibrary([episode], directory)).entries[0]?.preview?.mediaJobId,
    bellaReceipt.jobId,
  );
  const selectedMediaJobs = { "CAP-01": heartReceipt.jobId as string };
  const selected = await collectLibrary([episode], directory, new Date(), selectedMediaJobs);
  assert.equal(selected.entries[0]?.preview?.mediaJobId, heartReceipt.jobId);
  assert.equal(
    JSON.parse(selected.entries[0]?.preview?.files["timing.json"]?.toString("utf8") ?? "null")
      .voice,
    "af_heart",
  );
  const built = await buildLibrary({ artifactRoot: directory, selectedMediaJobs });
  assert.equal(
    built.manifest.episodes.find((item) => item.id === "CAP-01")?.preview?.mediaJobId,
    heartReceipt.jobId,
  );
  await assert.rejects(
    buildLibrary({ artifactRoot: directory, selectedMediaJobs: { "CAP-01": "missing-job" } }),
    /Selected narration.*unavailable/,
  );
});

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

test("self-consistent caption hashes cannot hide captions that contradict the validated narration", async (t) => {
  const directory = await root(t);
  const source = await run(directory);
  const output = await addNarration(t, directory, source.directory);
  const receiptPath = resolve(output, "media-manifest.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const original = await readFile(resolve(output, "captions.vtt"), "utf8");
  const variants = [
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAn unrelated caption.\n",
    original.replace("00:00:00.000", "00:00:00.001"),
  ];
  for (const captions of variants) {
    assert.notEqual(captions, original);
    await writeFile(resolve(output, "captions.vtt"), captions);
    receipt.artifactHashes["captions.vtt"] = hash(captions);
    await writeFile(receiptPath, JSON.stringify(receipt));
    const library = await collectLibrary([episode], directory);
    assert.equal(library.entries[0]?.preview?.kind, "storyboard");
    assert.equal(library.entries[0]?.preview?.sourceRunId, source.manifest.runId);
    assert.equal(library.excludedRuns, 1);
    const selected = await collectLibrary([episode], directory, new Date(), {
      "CAP-01": receipt.jobId,
    });
    assert.equal(selected.entries[0]?.preview, null);
  }
  const other = await run(directory);
  await addNarration(t, directory, other.directory, "another valid fixture");
  const recovered = await collectLibrary([episode], directory);
  assert.equal(recovered.entries[0]?.preview?.kind, "narrated");
  assert.equal(recovered.entries[0]?.preview?.sourceRunId, other.manifest.runId);
  assert.equal(recovered.excludedRuns, 1);
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
  assert.ok(String(files["review.html"]).includes("Saved preview · sources need rechecking"));
  assert.ok(String(files["review.html"]).includes("Saved media remains available."));
  assert.ok(String(files["episodes/NEWS-01/watch.html"]).includes("source recheck needed"));
  const noticeCount = (html: string) =>
    (html.match(/<section[^>]*data-news-review-notice/gu) ?? []).length;
  // watch.html frames review.html, so only the framed page carries the dated notice.
  assert.equal(noticeCount(String(files["episodes/NEWS-01/watch.html"])), 0);
  assert.equal(noticeCount(String(files["episodes/NEWS-01/review.html"])), 1);
  const workspace = String(files["review.html"]);
  assert.match(workspace, /<a class="new-short-button" data-new-short href="#ideas">/u);
  assert.doesNotMatch(workspace, /Explore ideas|Ideas &amp; SAP News Hub|Ideas & SAP News Hub/u);
  assert.doesNotMatch(workspace, /YOUR CONTENT, FROM IDEA TO PUBLISHED/u);
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

test("only an intact MP4 for the selected narration and exact editorial input is offered in the library", async (t) => {
  const directory = await root(t);
  const source = await run(directory);
  const narration = await addNarration(t, directory, source.directory);
  const media = JSON.parse(await readFile(resolve(narration, "media-manifest.json"), "utf8"));
  const renderKey = hash("video receipt fixture");
  const output = resolve(directory, "videos/CAP-01", `video-${renderKey.slice(0, 16)}`);
  await mkdir(output, { recursive: true });
  const files: Record<string, Buffer> = {
    "short.mp4": Buffer.from("0000ftyp-fixture-only"),
    "poster.png": Buffer.from("89504e470d0a1a0a", "hex"),
    "review.html": Buffer.from("<!--LIBRARY_BACK-->Test video player"),
    "captions.vtt": await readFile(resolve(narration, "captions.vtt")),
    "timing.json": await readFile(resolve(narration, "timing.json")),
    "publication-draft.txt": Buffer.from("Test post"),
  };
  const artifactHashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(resolve(output, name), bytes);
    artifactHashes[name] = hash(bytes);
  }
  const receipt = {
    schemaVersion: 1,
    stage: "READY",
    selector: "CAP-01",
    renderKey,
    inputHash: hash(JSON.stringify(episode)),
    mediaJobId: media.jobId,
    sourceManifestHash: media.sourceManifestHash,
    sourceAudioHash: hash(await readFile(resolve(narration, "narration.wav"))),
    updatedAt: new Date().toISOString(),
    quality: { durationSeconds: 55, decoded: true, audioChecked: true },
    artifactHashes,
  };
  const manifestPath = resolve(output, "video-manifest.json");
  await writeFile(manifestPath, JSON.stringify(receipt));
  const library = await collectLibrary([episode], directory);
  assert.equal(library.entries[0]?.video?.renderKey, renderKey);
  const directEntry = library.entries[0];
  assert.ok(directEntry?.video?.receipt);
  const invalidQuality = [
    { ...receipt.quality, decoded: "false" },
    { ...receipt.quality, audioChecked: "false" },
    { ...receipt.quality, decoded: 1 },
    { ...receipt.quality, durationSeconds: 999 },
    { ...receipt.quality, durationSeconds: 0 },
    { ...receipt.quality, durationSeconds: "55" },
    { ...receipt.quality, durationSeconds: null },
    { ...receipt.quality, durationSeconds: episode.targetDurationSeconds + 0.2 },
  ];
  for (const quality of invalidQuality) {
    await writeFile(manifestPath, JSON.stringify({ ...receipt, quality }));
    const invalid = await collectLibrary([episode], directory);
    assert.equal(invalid.entries[0]?.video, undefined);
    assert.equal(invalid.entries[0]?.preview?.kind, "narrated");
    const altered = structuredClone(directEntry);
    assert.ok(altered.video?.receipt);
    Object.assign(altered.video.receipt, { quality });
    assert.throws(() => buildEpisodePackage(altered), /quality metadata/);
  }
  await writeFile(manifestPath, JSON.stringify(receipt));
  assert.ok(directEntry.preview);
  const mismatchedTiming = {
    ...directEntry,
    preview: { ...directEntry.preview, durationSeconds: episode.targetDurationSeconds + 0.2 },
    video: {
      ...directEntry.video,
      receipt: {
        ...directEntry.video.receipt,
        quality: { ...receipt.quality, durationSeconds: episode.targetDurationSeconds + 0.2 },
      },
    },
  };
  assert.throws(
    () => buildEpisodePackage(mismatchedTiming),
    /quality metadata/,
    "matching outer metadata must not hide a mismatch with the saved timing file",
  );
  const pages = await createLibraryPages({
    ...library,
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.match(String(pages["review.html"]), /Watch MP4/u);
  assert.ok(pages["episodes/CAP-01/video/short.mp4"]);
  const videoPage = String(pages["episodes/CAP-01/video/review.html"]);
  assert.match(
    videoPage,
    /class="ep-back" href="\.\.\/\.\.\/\.\.\/review\.html#[^"]+" aria-label="Back to Shorts"/u,
  );
  assert.match(videoPage, /href="\.\.\/publish\.html"[^>]*>.*?Open Review &amp; publish/su);
  const audioPath = resolve(narration, "narration.wav");
  const originalAudio = await readFile(audioPath);
  const correctedAudio = Buffer.from(originalAudio);
  correctedAudio[44] = 1;
  await writeFile(audioPath, correctedAudio);
  const mediaPath = resolve(narration, "media-manifest.json");
  media.artifactHashes["narration.wav"] = hash(correctedAudio);
  await writeFile(mediaPath, JSON.stringify(media));
  const repackaged = await collectLibrary([episode], directory);
  assert.equal(repackaged.entries[0]?.preview?.kind, "narrated");
  assert.equal(repackaged.entries[0]?.video, undefined, "old MP4 must not match corrected audio");
  await writeFile(audioPath, originalAudio);
  media.artifactHashes["narration.wav"] = hash(originalAudio);
  await writeFile(mediaPath, JSON.stringify(media));
  for (const name of ["timing.json", "captions.vtt"]) {
    const originalHash = receipt.artifactHashes[name];
    receipt.artifactHashes[name] = hash("earlier timing or caption content");
    // The export's own file hashes remain consistent, but its selected narration
    // uses different timing/captions, so it is no longer an exact match.
    await writeFile(resolve(output, name), "earlier timing or caption content");
    await writeFile(manifestPath, JSON.stringify(receipt));
    assert.equal((await collectLibrary([episode], directory)).entries[0]?.video, undefined);
    receipt.artifactHashes[name] = originalHash as string;
    await writeFile(resolve(output, name), files[name] as Buffer);
  }
  await writeFile(manifestPath, JSON.stringify({ ...receipt, inputHash: hash("another script") }));
  assert.equal((await collectLibrary([episode], directory)).entries[0]?.video, undefined);
  await writeFile(manifestPath, JSON.stringify({ ...receipt, mediaJobId: "another recording" }));
  assert.equal((await collectLibrary([episode], directory)).entries[0]?.video, undefined);
  await writeFile(manifestPath, JSON.stringify({ ...receipt, selector: "CAP-02" }));
  assert.equal((await collectLibrary([episode], directory)).entries[0]?.video, undefined);
  await writeFile(manifestPath, JSON.stringify({ ...receipt, sourceCodeCommit: "corrupt" }));
  assert.equal((await collectLibrary([episode], directory)).entries[0]?.video, undefined);
  const recovered = await buildLibrary({ artifactRoot: directory });
  assert.equal(
    recovered.manifest.episodePackages.length,
    0,
    "invalid metadata cannot abort the whole studio or advertise a package",
  );
  await writeFile(manifestPath, JSON.stringify(receipt));
  await writeFile(resolve(output, "short.mp4"), "truncated MP4");
  const altered = await collectLibrary([episode], directory);
  assert.equal(altered.entries[0]?.video, undefined);
  assert.equal(altered.entries[0]?.preview?.kind, "narrated");
});
