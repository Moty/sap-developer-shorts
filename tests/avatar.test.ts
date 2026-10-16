import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  determineViseme,
  drawAvatarBadge,
  resolveCueAnimation,
  type VisemeShape,
} from "../src/media/avatar.js";
import type { NarrationTiming } from "../src/media/model.js";
import { videoTimeline } from "../src/video/timeline.js";

test("determineViseme maps phonetic text correctly", () => {
  assert.equal(determineViseme("hello", false), "rest");
  assert.equal(determineViseme("", true), "rest");
  assert.equal(determineViseme("app", true), "open_a");
  assert.equal(determineViseme("CAP", true), "open_a");
  assert.equal(determineViseme("see", true), "open_e");
  assert.equal(determineViseme("odata", true), "open_o");
  assert.equal(determineViseme("code", true), "open_o");
  assert.equal(determineViseme("joule", true), "open_u");
  assert.equal(determineViseme("cool", true), "open_u");
});

test("resolveCueAnimation varies visemes across syllables and raises brows on questions", () => {
  const cue = {
    text: "What is in Products today?",
    spokenText: "What is in Products today?",
    startSeconds: 1.0,
    endSeconds: 3.5,
  };
  const seenVisemes = new Set<VisemeShape>();
  for (let t = 1.05; t < 3.45; t += 0.16) {
    const state = resolveCueAnimation(cue, t, true, "mira");
    seenVisemes.add(state.viseme);
    assert.ok(state.browLift >= 2.5, "questions lift eyebrows");
  }
  assert.ok(seenVisemes.size >= 3, "mouth changes shape across syllables within a single cue");

  const idle = resolveCueAnimation(cue, 4.0, false, "mira");
  assert.equal(idle.viseme, "rest");
  assert.equal(idle.jawOpen, 0);
});

test("videoTimeline animateAvatar option subdivides speech cues into syllable steps", () => {
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate: 22050,
    durationSeconds: 2.0,
    scenes: [{ id: "hook", startSeconds: 0, endSeconds: 2.0, speechSeconds: 2.0 }],
    cues: [
      {
        sceneId: "hook",
        text: "My entity ghosted my API.",
        spokenText: "My entity ghosted my A P I.",
        startSeconds: 0.1,
        endSeconds: 1.9,
      },
    ],
  };
  const baseMoments = videoTimeline(timing);
  const animatedMoments = videoTimeline(timing, { animateAvatar: true });
  assert.ok(animatedMoments.length > baseMoments.length + 5);
  assert.equal(animatedMoments[0]?.startFrame, 0);
  assert.equal(animatedMoments.at(-1)?.endFrame, baseMoments.at(-1)?.endFrame);
});

test("drawAvatarBadge renders solo and duo co-speaker badges without errors", () => {
  const canvas = createCanvas(300, 300);
  const ctx = canvas.getContext("2d");
  const bounds = { x: 30, y: 30, width: 240, height: 240 };

  const visemes: VisemeShape[] = [
    "rest",
    "open_a",
    "open_e",
    "open_o",
    "open_u",
    "smile",
    "consonant",
  ];

  for (const viseme of visemes) {
    const anim = resolveCueAnimation(
      { text: "Hello world?", startSeconds: 0, endSeconds: 2 },
      0.5,
      true,
      "mira",
    );
    drawAvatarBadge(
      ctx,
      bounds,
      { id: "mira", name: "Mira" },
      viseme,
      true,
      { animation: { ...anim, viseme }, coSpeaker: { id: "max", name: "Max" } },
    );
    drawAvatarBadge(ctx, bounds, { id: "max", name: "Max" }, viseme, false);
    drawAvatarBadge(ctx, bounds, { id: "narrator", name: "SAP" }, viseme, true);
  }

  const png = canvas.toBuffer("image/png");
  assert.ok(png.length > 500);
});
