import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createCanvas } from "@napi-rs/canvas";
import { drawAvatarBadge, type VisemeShape } from "../src/media/avatar.js";
import { mouthGeometry, warpPhotoMouth } from "../src/media/photo-texture.js";
import { projectRoot } from "../src/paths.js";

function portraitFixture() {
  const canvas = createCanvas(140, 140);
  const ctx = canvas.getContext("2d");
  // Detailed pixels make unintended image translations visible, including
  // beneath the mouth where a plain-color fixture could hide the old jaw warp.
  for (let y = 0; y < 140; y += 4) {
    for (let x = 0; x < 140; x += 4) {
      ctx.fillStyle = `rgb(${(x * 7) % 255},${(y * 11) % 255},${(x + y) % 255})`;
      ctx.fillRect(x, y, 4, 4);
    }
  }
  return canvas;
}

function assertOnlyMouthChanges(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  mouth: { x: number; y: number; unit: number },
) {
  let changedMouthPixels = 0;
  let changedOutsidePixels = 0;
  for (let offset = 0; offset < before.length; offset += 4) {
    if (before.subarray(offset, offset + 4).every((value, i) => value === after[offset + i]))
      continue;
    const x = (offset / 4) % width;
    const y = Math.floor(offset / 4 / width);
    // Include one pixel for antialiasing at the calibrated ellipse boundary.
    if (
      Math.abs(x - mouth.x) <= 16 * mouth.unit + 1 &&
      Math.abs(y - mouth.y - mouth.unit * 0.5) <= 6 * mouth.unit + 1
    )
      changedMouthPixels++;
    else changedOutsidePixels++;
  }
  assert.equal(
    changedOutsidePixels,
    0,
    "head, neck, collar and background must stay pixel-identical",
  );
  assert.ok(changedMouthPixels > 5, "speech must still animate the mouth");
}

const visemes: VisemeShape[] = ["open_a", "open_e", "open_o", "open_u", "smile", "consonant"];

test("photo video frames animate only the calibrated mouth, even with head and blink signals", () => {
  const image = portraitFixture();
  for (const mouthScale of [0.5, 1, 2]) {
    const canvas = createCanvas(300, 300);
    const ctx = canvas.getContext("2d");
    const speaker = {
      id: "mira",
      name: "Mira",
      photoImage: image,
      avatar: { mode: "photo" as const, mouthX: 0.47, mouthY: 0.61, mouthScale },
    };
    const render = (viseme: VisemeShape) => {
      ctx.clearRect(0, 0, 300, 300);
      drawAvatarBadge(ctx, { x: 30, y: 30, width: 240, height: 240 }, speaker, viseme, true, {
        animation: {
          viseme,
          jawOpen: viseme === "rest" ? 0 : 1,
          isBlinking: viseme !== "rest",
          headBobY: viseme === "rest" ? 0 : 6,
          headTilt: viseme === "rest" ? 0 : 0.1,
          browLift: 3,
          voiceEnergy: 0.6,
          activeWordIndex: 0,
        },
      });
      return ctx.getImageData(0, 0, 300, 300).data;
    };
    const before = render("rest");
    for (const viseme of visemes) {
      assertOnlyMouthChanges(before, render(viseme), 300, {
        x: 150 + (0.47 - 0.5) * 224,
        y: 140 + (0.61 - 0.5) * 224,
        unit: (224 / 140) * mouthScale,
      });
    }
  }
});

test("actual workshop photo preview leaves every pixel outside the mouth stationary", async () => {
  const script = await readFile(resolve(projectRoot, "templates/script-editor.js"), "utf8");
  const start = script.indexOf("      function renderSpeakerCanvas(");
  const end = script.indexOf("      async function ensureImageLoaded(", start);
  assert.ok(start >= 0 && end > start);
  for (const width of [140, 280]) {
    for (const mouthScale of [0.5, 1, 2]) {
      const canvas = createCanvas(width, width);
      const fields: Record<string, unknown> = {
        "speaker-avatar-canvas-0": canvas,
        "speaker-avatar-image-0": { value: "fixture.png" },
        "speaker-avatar-mouth-x-0": { value: "0.47" },
        "speaker-avatar-mouth-y-0": { value: "0.61" },
        "speaker-avatar-mouth-scale-0": { value: String(mouthScale) },
      };
      const render = runInNewContext(`${script.slice(start, end)}; renderSpeakerCanvas`, {
        byId: (id: string) => fields[id],
        warpPhotoMouth,
        readMouthMetadata: () => ({}),
        loadedImages: new Map([["fixture.png", portraitFixture()]]),
      }) as (index: number, jawOpen: number, viseme: string, guide: boolean) => void;
      const pixels = () => canvas.getContext("2d").getImageData(0, 0, width, width).data;
      render(0, 0, "rest", false);
      const before = pixels();
      for (const viseme of visemes) {
        render(0, 1, viseme, false);
        assertOnlyMouthChanges(before, pixels(), width, {
          x: width * 0.47,
          y: width * 0.61,
          unit: (width / 140) * mouthScale,
        });
      }
      render(0, 0, "rest", false);
      assert.deepEqual(pixels(), before, "rest must restore the original portrait");
    }
  }
});

test("landmarks produce rotated lip geometry and reject unclear or unsupported faces", () => {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  points[61] = { x: 0.36, y: 0.59 };
  points[291] = { x: 0.56, y: 0.61 };
  points[0] = { x: 0.46, y: 0.58 };
  points[17] = { x: 0.46, y: 0.62 };
  const geometry = mouthGeometry(points);
  assert.equal(geometry.mouthX, 0.46);
  assert.equal(geometry.mouthY, 0.6);
  assert.ok(geometry.mouthAngle > 0.09 && geometry.mouthAngle < 0.11);
  assert.ok(geometry.mouthScale > 1 && geometry.mouthScale < 1.1);
  assert.throws(() => mouthGeometry([]), /could not be located/);
  points[291] = { x: 0.8, y: 0.8 };
  assert.throws(() => mouthGeometry(points), /front-facing/);
});

test("texture warp preserves source, rest and every pixel beyond rotated lip bounds", () => {
  const width = 140;
  const source = portraitFixture().getContext("2d").getImageData(0, 0, width, width).data;
  const copy = new Uint8ClampedArray(source);
  for (const mouthAngle of [-0.5, 0, 0.5]) {
    for (const mouthAspect of [0.2, 0.6]) {
      const config = { mouthX: 0.46, mouthY: 0.6, mouthScale: 1.25, mouthAngle, mouthAspect };
      assert.deepEqual(warpPhotoMouth(source, width, width, config, "rest"), source);
      const after = warpPhotoMouth(source, width, width, config, "open_a");
      for (let y = 0; y < width; y++)
        for (let x = 0; x < width; x++) {
          const dx = x - width * config.mouthX,
            dy = y - width * config.mouthY;
          const u = dx * Math.cos(mouthAngle) + dy * Math.sin(mouthAngle);
          const v = -dx * Math.sin(mouthAngle) + dy * Math.cos(mouthAngle);
          if ((u / (16 * 1.25)) ** 2 + (v / (16 * mouthAspect * 1.25)) ** 2 < 1) continue;
          const p = (y * width + x) * 4;
          assert.deepEqual(after.slice(p, p + 4), source.slice(p, p + 4));
        }
      assert.deepEqual(warpPhotoMouth(source, width, width, config, "open_a"), after);
    }
  }
  assert.deepEqual(source, copy, "animation never accumulates edits on the source");
});

test("actual async detector preserves newer manual edits and rejects missing/multiple faces", async () => {
  const script = await readFile(resolve(projectRoot, "templates/script-editor.js"), "utf8");
  const start = script.indexOf("      async function detectMouth(");
  const end = script.indexOf("      refreshAvatarUi =", start);
  assert.ok(start >= 0 && end > start);
  for (const scenario of ["manual", "selection", "no-face", "multiple", "missing-model"]) {
    const fields: Record<string, { value: string }> = {
      "speaker-avatar-image-0": { value: "old.png" },
      "speaker-avatar-mouth-x-0": { value: "0.41" },
      "speaker-avatar-mouth-y-0": { value: "0.62" },
      "speaker-avatar-mouth-scale-0": { value: "1.1" },
      "speaker-avatar-geometry-0": { value: "{}" },
    };
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revisions = new Map<number, number>();
    const notices: string[] = [];
    let applied = 0;
    const detect = runInNewContext(`${script.slice(start, end)}; detectMouth`, {
      byId: (id: string) => fields[id],
      revisions,
      invalidate: (index: number) => revisions.set(index, (revisions.get(index) || 0) + 1),
      detectStatus: (_index: number, message: string) => notices.push(message),
      ensureImageLoaded: async () => ({ img: portraitFixture(), sha: "a".repeat(64) }),
      detector: async () => {
        await ready;
        if (scenario === "missing-model") throw new Error("Missing model");
        return { detect: () => ({ faceLandmarks: scenario === "multiple" ? [[], []] : [] }) };
      },
      document: { createElement: () => createCanvas(512, 512) },
      renderSpeakerCanvas: () => {
        applied++;
      },
      update: () => {},
      mouthGeometry,
      faceDetector: { modelSha256: "b".repeat(64), version: "mediapipe-0.10.32" },
    }) as (index: number) => Promise<void>;
    const xField = fields["speaker-avatar-mouth-x-0"];
    const imageField = fields["speaker-avatar-image-0"];
    assert.ok(xField && imageField);
    const pending = detect(0);
    if (scenario === "manual") {
      xField.value = "0.49";
      revisions.set(0, 2);
    }
    if (scenario === "selection") imageField.value = "new.png";
    release();
    await pending;
    assert.equal(applied, 0);
    assert.equal(xField.value, scenario === "manual" ? "0.49" : "0.41");
    if (scenario === "no-face") assert.match(notices.at(-1) ?? "", /No clear face/);
    if (scenario === "multiple") assert.match(notices.at(-1) ?? "", /More than one face/);
    if (scenario === "missing-model") assert.match(notices.at(-1) ?? "", /adjust manually/);
  }
});
