import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { buildEpisodePackage } from "../src/episode-package.js";
import type { LibraryEntry } from "../src/library.js";
import { createLibraryPages } from "../src/library-review.js";
import { encodePcmWav, pronounce, sampleRate } from "../src/media/audio.js";
import type { NarrationTiming } from "../src/media/model.js";
import { episodeSelector } from "../src/presentation.js";

const now = new Date("2026-10-15T09:00:00Z");
async function entry(selector = "CAP-02", voice = "af_heart"): Promise<LibraryEntry> {
  const episode = await readContentEpisode(selector);
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    engine: "kokoro",
    alignment: "model-estimated-phrase-boundaries",
    voice,
    rate: 180,
    speed: 0.96,
    sampleRate,
    durationSeconds: episode.targetDurationSeconds,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      speechSeconds: 1,
    })),
    cues: episode.scenes.map((scene) => ({
      sceneId: scene.id,
      text: scene.narration,
      spokenText: pronounce(scene.narration, episode.pronunciation),
      startSeconds: scene.startSeconds,
      endSeconds: scene.startSeconds + 1,
    })),
  };
  const audio = encodePcmWav(Buffer.alloc(sampleRate * 2 * episode.targetDurationSeconds));
  const files = {
    "short.mp4": Buffer.from("0000ftyp-test-fixture"),
    "poster.png": Buffer.from("89504e470d0a1a0a", "hex"),
    "review.html": Buffer.from(
      '<main><!--LIBRARY_BACK--><video controls poster="poster.png"><source src="short.mp4"></video><div class="links"><a href="captions.vtt">Captions</a></div></main>',
    ),
    "captions.vtt": Buffer.from("WEBVTT\n\nTest captions\n"),
    "timing.json": Buffer.from(JSON.stringify(timing)),
    "publication-draft.txt": Buffer.from(
      "Exact exported companion draft.\nAI-generated narration.\n",
    ),
  };
  const mediaJobId = hash(`job ${voice}`);
  const sourceManifestHash = hash("source preview");
  const preview = {
    kind: "narrated" as const,
    durationSeconds: timing.durationSeconds,
    timingReady: true,
    sourceRunId: "fixture",
    sourceManifestHash,
    mediaJobId,
    updatedAt: now.toISOString(),
    files: {
      "narration.wav": audio,
      "timing.json": files["timing.json"],
      "captions.vtt": files["captions.vtt"],
    },
  };
  const receipt = {
    selector: episodeSelector(episode),
    inputHash: hash(JSON.stringify(episode)),
    renderKey: hash(`render ${voice}`),
    mediaJobId,
    sourceManifestHash,
    sourceAudioHash: hash(audio),
    sourceCodeCommit: "b".repeat(40),
    updatedAt: now.toISOString(),
    quality: { durationSeconds: timing.durationSeconds, decoded: true, audioChecked: true },
    artifactHashes: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
    ),
  };
  return {
    episode,
    sourceReviewExpired: false,
    preview,
    video: {
      renderKey: receipt.renderKey,
      durationSeconds: timing.durationSeconds,
      files,
      receipt,
    },
  };
}

function extract(value: ReturnType<typeof buildEpisodePackage>) {
  assert.ok(value);
  return Object.fromEntries(
    Object.entries(unzipSync(value.bytes)).map(([name, bytes]) => [
      name.split("/").slice(1).join("/"),
      Buffer.from(bytes),
    ]),
  );
}

test("episode download preserves the exact selected export and hashes every portable member", async () => {
  const input = await entry();
  const download = buildEpisodePackage(input, now);
  assert.ok(download);
  assert.equal(download.sha256, hash(download.bytes));
  const files = extract(download);
  const manifest = JSON.parse(files["package-manifest.json"]?.toString() ?? "null");
  assert.equal(manifest.selector, "CAP-02");
  assert.equal(manifest.mediaJobId, input.preview?.mediaJobId);
  assert.equal(manifest.captionAlignment, "model-estimated-phrase-boundaries");
  assert.equal(manifest.published, false);
  for (const [name, expected] of Object.entries(manifest.artifactHashes))
    assert.equal(hash(files[name] as Buffer), expected);
  for (const name of [
    "short.mp4",
    "poster.png",
    "captions.vtt",
    "publication-draft.txt",
    "timing.json",
  ])
    assert.deepEqual(files[name], input.video?.files[name]);
  assert.match(String(files["README.txt"]), /Kokoro · Heart/);
  assert.match(String(files["README.txt"]), /UNPUBLISHED/);
  assert.match(String(files["transcript.txt"]), /Give your CAP demo real data/);
  assert.match(String(files["sources.txt"]), /https:\/\/cap.cloud.sap/);
  assert.doesNotMatch(String(files["review.html"]), /LIBRARY_BACK|\.\.\/|artifacts\//);
  assert.doesNotMatch(JSON.stringify(manifest), /\/Users\/|\.state\//);
  assert.deepEqual(
    buildEpisodePackage(input, now)?.bytes,
    download.bytes,
    "same snapshot generates the same ZIP",
  );
});

test("packages retain the chosen recorded voice and reject another job, selector, audio, or altered export", async () => {
  const heart = await entry();
  const bella = await entry("CAP-02", "af_bella");
  assert.match(String(extract(buildEpisodePackage(heart, now))["README.txt"]), /Kokoro · Heart/);
  assert.match(String(extract(buildEpisodePackage(bella, now))["README.txt"]), /Kokoro · Bella/);
  const video = heart.video;
  assert.ok(video?.receipt);
  for (const field of ["selector", "mediaJobId", "sourceAudioHash"] as const) {
    const original = video.receipt[field];
    video.receipt[field] = "another recording";
    assert.throws(() => buildEpisodePackage(heart, now), /must match|invalid package provenance/);
    video.receipt[field] = original;
  }
  video.files["short.mp4"] = Buffer.from("altered bytes");
  assert.throws(() => buildEpisodePackage(heart, now), /artifact changed/);
  delete heart.video;
  assert.equal(buildEpisodePackage(heart, now), null);
});

test("news downloads keep fixed source dates, expiry warnings and availability after review expires", async () => {
  const input = await entry("NEWS-01");
  const originalHash = hash(JSON.stringify(input.episode));
  const fresh = extract(buildEpisodePackage(input, now));
  assert.match(String(fresh["sources.txt"]), /SOURCE REVIEW: 2026-10-14/);
  assert.match(String(fresh["sources.txt"]), /Valid through 2026-10-21/);
  const download = buildEpisodePackage(input, new Date("2026-10-22T00:00:00Z"));
  assert.ok(download?.savedNews);
  const expired = extract(download);
  assert.match(String(expired["README.txt"]), /SOURCE RECHECK REQUIRED/);
  assert.match(String(expired["review.html"]), /source recheck required/);
  assert.match(String(expired["sources.txt"]), /Availability: planned/);
  assert.equal(
    hash(JSON.stringify(input.episode)),
    originalHash,
    "packaging must not refresh a review date",
  );
});

test("static review links package downloads only when a matching export package exists", async () => {
  const input = await entry();
  const download = buildEpisodePackage(input, now);
  assert.ok(download);
  input.download = download;
  const pages = await createLibraryPages({
    entries: [input],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.match(String(pages["review.html"]), /Download episode package · ZIP/);
  assert.match(
    String(pages["episodes/CAP-02/video/review.html"]),
    /href="\.\.\/episode-package.zip" download=/,
  );
  assert.equal(
    hash(pages["episodes/CAP-02/episode-package.zip"] as Buffer),
    input.download?.sha256,
  );
  delete input.download;
  const noPackage = await createLibraryPages({
    entries: [input],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.doesNotMatch(String(noPackage["review.html"]), /Download episode package/);
});
