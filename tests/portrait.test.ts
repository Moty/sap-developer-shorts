import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { hash } from "../src/digest.js";
import { createMotionTrack, sampleMotionTrack } from "../src/media/portrait-motion.js";
import {
  prepareTalkingHeadSequence,
  readPortraitManifest,
  talkingHeadRuntime,
} from "../src/media/talking-head.js";
import { sourceFile } from "../src/paths.js";

test("realistic requests cannot omit the portrait and silently fall back", async () => {
  await assert.rejects(
    prepareTalkingHeadSequence({
      speakerId: "narrator",
      avatar: { mode: "photo", animation: "neural" },
      wavBytes: Buffer.alloc(0),
      cues: [],
      frameCount: 30,
    }),
    /requires a picture/,
  );
});

test("local runtime status refuses changed installed engine code", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "portrait-runtime-"));
  try {
    await mkdir(resolve(directory, "venv/bin"), { recursive: true });
    await mkdir(resolve(directory, "source"));
    await writeFile(resolve(directory, "venv/bin/python"), "fixture");
    const engine = resolve(directory, "source/engine.py");
    await writeFile(engine, "verified fixture");
    await writeFile(
      resolve(directory, "runtime.json"),
      JSON.stringify({
        schemaVersion: 2,
        engine: "ditto",
        accelerator: "cpu",
        specSha256: hash(await readFile(await sourceFile("config/portrait-runtime.json"))),
        sourceHashes: { "engine.py": hash(Buffer.from("verified fixture")) },
      }),
    );
    assert.equal((await talkingHeadRuntime(directory)).installed, true);
    await writeFile(engine, "altered fixture");
    assert.equal((await talkingHeadRuntime(directory)).installed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("portrait motion is deterministic, continuous across captions and quieter at zero intensity", () => {
  const whole = [{ text: "What does this mean?", startSeconds: 1, endSeconds: 4 }];
  const split = [
    { text: "What does", startSeconds: 1, endSeconds: 2 },
    { text: "this mean?", startSeconds: 2, endSeconds: 4 },
  ];
  const track = createMotionTrack(whole, 30, "narrator");
  assert.deepEqual(track, createMotionTrack(split, 30, "narrator"));
  assert.deepEqual(track, createMotionTrack(whole, 30, "narrator"));
  assert.notDeepEqual(track, createMotionTrack(whole, 30, "narrator", { seed: 2 }));
  const still = createMotionTrack(whole, 30, "narrator", { intensity: 0 });
  let previous = sampleMotionTrack(track, 0);
  for (let frame = 1; frame <= 900; frame++) {
    const next = sampleMotionTrack(track, frame / 30);
    assert.ok(Math.abs(next.headTilt - previous.headTilt) < 0.004, "no head-angle jumps");
    assert.ok(Math.abs(next.headBobY - previous.headBobY) < 0.1, "no head-position jumps");
    assert.ok(next.blink >= 0 && next.blink <= 1);
    assert.equal(Math.abs(sampleMotionTrack(still, frame / 30).headTilt), 0);
    previous = next;
  }
  assert.equal(Math.abs(previous.headTilt), 0, "ending settles");
  const intervals = track.blinks.slice(1).map((time, i) => time - (track.blinks[i] as number));
  assert.ok(
    new Set(intervals.map((value) => value.toFixed(2))).size > 2,
    "blinks are not metronomic",
  );
  const blink = track.blinks[0] as number;
  assert.ok(sampleMotionTrack(track, blink + 0.035).blink > 0.1);
  assert.ok(sampleMotionTrack(track, blink + 0.035).blink < 0.9, "eyelids move continuously");
  assert.throws(() => createMotionTrack(whole, 30, "narrator", { intensity: 1.1 }));
  assert.throws(() => createMotionTrack(whole, 30, "narrator", { seed: -1 }));
});

test("portrait cache rejects stale, partial, redirected and changed frames", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "portrait-manifest-"));
  // realpath on macOS canonicalizes /var to /private/var.
  const { realpath } = await import("node:fs/promises");
  const root = await realpath(directory);
  const frame = Buffer.from("frame fixture; pixel decoding is a separate render check");
  const manifest = {
    schemaVersion: 2,
    engine: "ditto",
    requestHash: "request",
    fps: 30,
    frameCount: 1,
    frameHashes: [hash(frame)],
  };
  try {
    await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest));
    const path = resolve(root, "frame-0000.png");
    await assert.rejects(readPortraitManifest(root, "request", 1, 30));
    await writeFile(path, frame);
    await readPortraitManifest(root, "request", 1, 30);
    await assert.rejects(readPortraitManifest(root, "old-request", 1, 30), /does not match/);
    await assert.rejects(readPortraitManifest(root, "request", 2, 30), /does not match/);
    await assert.rejects(readPortraitManifest(root, "request", 1, 25), /does not match/);
    await writeFile(path, "changed");
    await assert.rejects(readPortraitManifest(root, "request", 1, 30), /changed/);
    await rm(path);
    await writeFile(resolve(root, "redirect.png"), frame);
    await symlink(resolve(root, "redirect.png"), path);
    await assert.rejects(readPortraitManifest(root, "request", 1, 30), /redirected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
