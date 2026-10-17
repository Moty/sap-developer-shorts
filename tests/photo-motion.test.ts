import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createCanvas } from "@napi-rs/canvas";
import { drawAvatarBadge, type VisemeShape } from "../src/media/avatar.js";
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
  const end = script.indexOf("      function ensureImageLoaded(", start);
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
