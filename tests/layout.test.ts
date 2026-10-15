import assert from "node:assert/strict";
import test from "node:test";
import { readLayout, validateLayout } from "../src/layout.js";

test("video layout rejects invalid dimensions, small code, and out-of-bounds content", async () => {
  const { layout } = await readLayout();
  const invalidSize = { ...layout, canvas: { width: 1920, height: 1080 } };
  assert.throws(() => validateLayout(invalidSize), /Video layout:/);
  const smallText = structuredClone(layout);
  smallText.demo.fontSize = 20;
  assert.throws(() => validateLayout(smallText), /Video layout:/);
  const clipped = structuredClone(layout);
  clipped.demo.x = 1000;
  assert.throws(() => validateLayout(clipped), /demo must fit inside/);
});
