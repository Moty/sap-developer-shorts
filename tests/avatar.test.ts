import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { determineViseme, drawAvatarBadge, type VisemeShape } from "../src/media/avatar.js";

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

test("drawAvatarBadge renders onto canvas without errors", () => {
  const canvas = createCanvas(300, 300);
  const ctx = canvas.getContext("2d");
  const bounds = { x: 30, y: 30, width: 240, height: 240 };

  const visemes: VisemeShape[] = ["rest", "open_a", "open_e", "open_o", "open_u", "smile"];

  for (const viseme of visemes) {
    // Test Mira
    drawAvatarBadge(ctx, bounds, { id: "mira", name: "Mira" }, viseme, true);
    // Test Max
    drawAvatarBadge(ctx, bounds, { id: "max", name: "Max" }, viseme, false);
    // Test Narrator
    drawAvatarBadge(ctx, bounds, { id: "narrator", name: "Narrator" }, viseme, true);
  }

  const png = canvas.toBuffer("image/png");
  assert.ok(png.length > 500);
});
