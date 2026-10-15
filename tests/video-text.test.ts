import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { readContentEpisode } from "../src/contracts.js";
import { readLayout } from "../src/layout.js";
import type { NarrationTiming } from "../src/media/model.js";
import { sourceFile } from "../src/paths.js";
import { drawVideoFrame, loadVideoFonts, wrapVideoText } from "../src/video/frames.js";

async function codeContext() {
  await loadVideoFonts();
  const context = createCanvas(1080, 1920).getContext("2d");
  context.font = '44px "Shorts Code"';
  return context;
}

test("the actual service wraps at whitespace without splitting its quoted path or projection keyword", async () => {
  const context = await codeContext();
  const source = await readFile(
    await sourceFile("demos/cap/inventory/srv/inventory-service.cds"),
    "utf8",
  );
  const lines = wrapVideoText(context, source, 800, true);
  assert.ok(lines.some((line) => line.includes("'../db/schema';")));
  assert.ok(lines.some((line) => line.includes("projection")));
  assert.ok(lines.every((line) => context.measureText(line).width <= 800));
  assert.ok(lines.length * 44 * 1.22 <= 730, "source remains readable at the existing font size");
  for (const original of source.replaceAll("\r", "").split("\n"))
    assert.equal(wrapVideoText(context, original, 800, true).join(""), original);
});

test("code wrapping preserves indentation, repeated spaces, trailing spaces, and blank lines", async () => {
  const context = await codeContext();
  const paragraphs = [
    "",
    "  entity Products as projection on demo.Products;  ",
    "\t  ",
    "",
    "}",
    "",
  ];
  const source = paragraphs.join("\r\n");
  const expected = paragraphs.flatMap((line) => wrapVideoText(context, line, 350, true));
  assert.deepEqual(wrapVideoText(context, source, 350, true), expected);
  for (const original of paragraphs) {
    const lines = wrapVideoText(context, original, 350, true);
    assert.equal(lines.join(""), original);
    assert.ok(lines.every((line) => context.measureText(line).width <= 350));
  }
  const short = "  title  : String(100);  ";
  assert.deepEqual(wrapVideoText(context, short, 800, true), [short]);
  assert.deepEqual(wrapVideoText(context, "\n\n", 800, true), ["", "", ""]);
});

test("oversized URLs and Unicode tokens wrap without losing characters or splitting surrogate pairs", async () => {
  const context = await codeContext();
  for (const token of [
    "http://localhost:4004/odata/v4/inventory/Products?$filter=stock%20gt%200&$select=title,stock&$orderby=title",
    "𐐀𝛑😀".repeat(40),
    " ".repeat(100),
  ]) {
    const lines = wrapVideoText(context, token, 800, true);
    assert.ok(lines.length > 1);
    assert.equal(lines.join(""), token);
    for (const line of lines) {
      assert.ok(context.measureText(line).width <= 800);
      assert.doesNotMatch(line, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  }
  assert.throws(() => wrapVideoText(context, "M", 1, true), /character does not fit/u);
});

test("prose still wraps at words and trims trailing whitespace independently of code", async () => {
  const context = await codeContext();
  const width = context.measureText("one  two").width;
  assert.deepEqual(wrapVideoText(context, "one  two three  ", width), ["one  two", "three"]);
  assert.deepEqual(wrapVideoText(context, "one\n\n two  ", 800), ["one", "", " two"]);
});

test("actual schema, service, and CSV code frames fit without smaller fonts or relaxed overflow guards", async () => {
  const { layout } = await readLayout();
  const seen = new Set<string>();
  for (const selector of ["CAP-01@countdown", "CAP-02"]) {
    const episode = await readContentEpisode(selector);
    const timing: NarrationTiming = {
      schemaVersion: 1,
      mode: "local-preview",
      voice: "test",
      rate: 180,
      sampleRate: 22050,
      durationSeconds: episode.targetDurationSeconds,
      scenes: [],
      cues: [],
    };
    for (const [sceneIndex, scene] of episode.scenes.entries()) {
      if (scene.visual.kind !== "code" || !scene.visual.codePath || seen.has(scene.visual.codePath))
        continue;
      seen.add(scene.visual.codePath);
      const source = await readFile(await sourceFile(scene.visual.codePath), "utf8");
      const moment = { startFrame: 0, endFrame: 1, sceneIndex, cueIndex: null };
      const input = { episode, timing, layout, code: { [scene.visual.codePath]: source } };
      const png = await drawVideoFrame(input, moment);
      assert.equal(png.readUInt32BE(16), 1080);
      assert.equal(png.readUInt32BE(20), 1920);
      await assert.rejects(
        drawVideoFrame(
          { ...input, code: { [scene.visual.codePath]: "too many source lines\n".repeat(50) } },
          moment,
        ),
        /source code does not fit/u,
      );
    }
  }
  assert.equal(seen.size, 3);
});
