import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { readContentEpisode, readEpisode, validateContent } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { isNewsEpisode } from "../src/domain.js";
import { readLayout } from "../src/layout.js";
import type { NarrationTiming } from "../src/media/model.js";
import { loudnessResult, type VideoProbe, validateVideoProbe } from "../src/video/export.js";
import {
  drawVideoFrame,
  loadVideoFonts,
  newsCardLayout,
  wrapVideoText,
} from "../src/video/frames.js";
import { readVideoReceipt } from "../src/video/receipt.js";
import { concatTimeline, videoFps, videoTimeline } from "../src/video/timeline.js";

test("video timeline preserves silent caption gaps and covers every output frame within one-frame timing precision", () => {
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate: 22050,
    durationSeconds: 1.02,
    scenes: [{ id: "hook", startSeconds: 0, endSeconds: 1.02, speechSeconds: 1.02 }],
    cues: [
      { sceneId: "hook", text: "First", spokenText: "First", startSeconds: 0.15, endSeconds: 0.5 },
      { sceneId: "hook", text: "Next", spokenText: "Next", startSeconds: 0.6, endSeconds: 0.98 },
    ],
  };
  const moments = videoTimeline(timing);
  assert.equal(moments[0]?.startFrame, 0);
  assert.equal(moments.at(-1)?.endFrame, Math.ceil(timing.durationSeconds * videoFps));
  for (const [index, moment] of moments.entries()) {
    assert.equal(moment.startFrame, index ? moments[index - 1]?.endFrame : 0);
    assert.ok(moment.endFrame > moment.startFrame);
  }
  assert.deepEqual(
    moments.map((moment) => moment.cueIndex),
    [null, 0, null, 1, null],
  );
  assert.ok(Math.abs((moments[1]?.startFrame ?? 0) / videoFps - 0.15) <= 1 / videoFps);
  const concat = concatTimeline(moments);
  assert.match(concat, /^ffconcat version 1.0/u);
  assert.match(concat, /option framerate 30/u);
  assert.ok(!concat.includes("http"));
});

test("MP4 verification rejects missing audio, wrong codecs/dimensions, incomplete duration, and frame count drift", () => {
  const probe: VideoProbe = {
    format: { duration: "58.500000" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1080,
        height: 1920,
        pix_fmt: "yuv420p",
        avg_frame_rate: "30/1",
        duration: "58.500000",
        nb_frames: "1755",
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
        duration: "58.470204",
      },
    ],
  };
  assert.equal(validateVideoProbe(probe, 58.470204).frameCount, 1755);
  const noAudio = structuredClone(probe);
  noAudio.streams.pop();
  assert.throws(() => validateVideoProbe(noAudio, 58.470204), /MP4 verification failed/);
  for (const mutate of [
    (value: VideoProbe) => {
      const v = value.streams[0];
      if (v) v.width = 720;
    },
    (value: VideoProbe) => {
      const v = value.streams[0];
      if (v) delete v.duration;
    },
    (value: VideoProbe) => {
      const v = value.streams[1];
      if (v) v.codec_name = "pcm_s16le";
    },
    (value: VideoProbe) => {
      const v = value.streams[0];
      if (v) v.nb_frames = "100";
    },
    (value: VideoProbe) => {
      const a = value.streams[1];
      if (a) a.duration = "55";
    },
  ]) {
    const invalid = structuredClone(probe);
    mutate(invalid);
    assert.throws(() => validateVideoProbe(invalid, 58.470204), /MP4 verification failed/);
  }
});

test("audio normalization requires finite measurements and rejects silent input", () => {
  const measured = {
    input_i: "-26.75",
    input_tp: "-5.48",
    input_lra: "2.10",
    input_thresh: "-37.22",
    target_offset: "0.73",
  };
  assert.equal(loudnessResult(`FFmpeg diagnostics\n${JSON.stringify(measured)}`).input_i, "-26.75");
  assert.throws(() => loudnessResult("No measurements"), /no measurements/);
  assert.throws(
    () => loudnessResult(JSON.stringify({ ...measured, input_i: "-inf" })),
    /silent or has invalid/,
  );
});

test("video text wraps URLs at measured font widths and refuses unreadable caption overflow", async () => {
  await loadVideoFonts();
  const ctx = createCanvas(1080, 1920).getContext("2d");
  ctx.font = '44px "Shorts Code"';
  const url = "http://localhost:4004/odata/v4/inventory/Products?$filter=stock%20gt%200";
  const lines = wrapVideoText(ctx, url, 800, true);
  assert.equal(lines.join(""), url);
  assert.ok(lines.every((line) => ctx.measureText(line).width <= 800));
  const episode = await readEpisode("CAP-01");
  const { layout } = await readLayout();
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate: 22050,
    durationSeconds: 55,
    scenes: [],
    cues: [
      {
        sceneId: "hook",
        text: "Readable caption.",
        spokenText: "Readable caption.",
        startSeconds: 0,
        endSeconds: 3,
      },
    ],
  };
  const moment = { startFrame: 0, endFrame: 90, sceneIndex: 0, cueIndex: 0 };
  const png = await drawVideoFrame({ episode, timing, layout, code: {} }, moment);
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1920);
  const cue = timing.cues[0];
  assert.ok(cue);
  cue.text = "Too many words to display. ".repeat(80);
  await assert.rejects(
    drawVideoFrame({ episode, timing, layout, code: {} }, moment),
    /captions does not fit/,
  );
});

test("a completed video receipt rejects changed artifacts and files outside its own directory", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "sap-video-receipt-"));
  const directory = resolve(root, "export");
  await mkdir(directory);
  t.after(() => rm(root, { recursive: true, force: true }));
  const files: Record<string, Buffer> = {
    "short.mp4": Buffer.from("0000ftyp-test-fixture"),
    "poster.png": Buffer.from("89504e470d0a1a0a", "hex"),
    "review.html": Buffer.from("Test player"),
    "captions.vtt": Buffer.from("WEBVTT"),
    "timing.json": Buffer.from("{}"),
    "publication-draft.txt": Buffer.from("Test draft"),
  };
  const artifactHashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(resolve(directory, name), bytes);
    artifactHashes[name] = hash(bytes);
  }
  await writeFile(
    resolve(directory, "video-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      stage: "READY",
      quality: { decoded: true, audioChecked: true, durationSeconds: 55 },
      artifactHashes,
    }),
  );
  await readVideoReceipt(directory);
  await writeFile(resolve(directory, "short.mp4"), "changed");
  await assert.rejects(readVideoReceipt(directory), /artifact changed/);
  await writeFile(resolve(directory, "short.mp4"), files["short.mp4"] as Buffer);
  await writeFile(resolve(root, "outside.png"), files["poster.png"] as Buffer);
  await rm(resolve(directory, "poster.png"));
  await symlink(resolve(root, "outside.png"), resolve(directory, "poster.png"));
  await assert.rejects(readVideoReceipt(directory), /must stay inside/);
});

test("a new tutorial title changes its opening card even when scene captions and overlays are identical", async () => {
  const episode = await readEpisode("CAP-01");
  const { layout } = await readLayout();
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate: 22050,
    durationSeconds: 55,
    scenes: [],
    cues: [],
  };
  const moment = { startFrame: 0, endFrame: 90, sceneIndex: 0, cueIndex: null };
  const first = await drawVideoFrame({ episode, timing, layout, code: {} }, moment);
  const next = structuredClone(episode);
  next.title = (await readEpisode("CAP-02")).title;
  const second = await drawVideoFrame({ episode: next, timing, layout, code: {} }, moment);
  assert.notEqual(hash(first), hash(second), "opening must reflect the tutorial being reviewed");
});

test("every news card and its availability text fits the vertical export without clipping", async () => {
  const episodes = (await validateContent()).episodes.filter(isNewsEpisode);
  const { layout } = await readLayout();
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate: 22050,
    durationSeconds: 55,
    scenes: [],
    cues: [],
  };
  for (const episode of episodes)
    for (const [sceneIndex] of episode.scenes.entries()) {
      const png = await drawVideoFrame(
        { episode, timing, layout, code: {} },
        { startFrame: 0, endFrame: 1, sceneIndex, cueIndex: null },
      );
      assert.equal(png.readUInt32BE(16), 1080);
      assert.equal(png.readUInt32BE(20), 1920);
    }
});

test("news cards reserve the full badge and separate every text block with a visible gutter", async () => {
  await loadVideoFonts();
  const episode = await readContentEpisode("NEWS-02");
  assert.ok(isNewsEpisode(episode));
  const source = episode.claims[0];
  assert.ok(source);
  const claim = {
    ...source,
    text: "Financial consolidation supports data from SAP and non-SAP systems while keeping the close process on a governed foundation. Check the announced product scope before planning.",
    availability: {
      ...source.availability,
      timing: "Early adopter program planned for the first quarter of 2027; dates may change.",
      scope:
        "Enterprise financial consolidation across mixed landscapes. Confirm eligibility and availability in the official announcement before planning.",
    },
  };
  const body = { x: 104, y: 548, width: 800, height: 730 };
  const card = newsCardLayout(createCanvas(1080, 1920).getContext("2d"), claim, body);
  assert.ok(card.headline.y >= card.badge.y + card.badge.height + 28);
  assert.ok(card.timing.y >= card.headline.y + card.headline.height + 28);
  assert.ok(card.scope.y >= card.timing.y + card.timing.height + 20);
  assert.ok(card.scope.y + card.scope.height <= body.y + body.height + 1);
  assert.ok(card.size >= 40, "fit within mobile-readable typography without cutting the claim");
});

test("source-review dates remain visible on announcement frames outside the introduction", async () => {
  const episode = await readContentEpisode("NEWS-02");
  assert.ok(isNewsEpisode(episode));
  const { layout } = await readLayout();
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate: 22050,
    durationSeconds: 58,
    scenes: [],
    cues: [],
  };
  const moment = { startFrame: 0, endFrame: 1, sceneIndex: 2, cueIndex: null };
  const first = await drawVideoFrame({ episode, timing, layout, code: {} }, moment);
  const earlier = structuredClone(episode);
  earlier.news.asOf = "2026-10-14";
  for (const source of earlier.sources) source.retrievedOn = earlier.news.asOf;
  for (const claim of earlier.claims) claim.checkedOn = earlier.news.asOf;
  const second = await drawVideoFrame({ episode: earlier, timing, layout, code: {} }, moment);
  assert.notEqual(
    hash(first),
    hash(second),
    "a shared announcement frame must identify its saved source-review date",
  );
});
