import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { readContentEpisode } from "../src/contracts.js";
import { readLayout } from "../src/layout.js";
import type { NarrationTiming } from "../src/media/model.js";
import { sourceFile } from "../src/paths.js";
import {
  assertVideoTextFits,
  codeHighlights,
  drawVideoFrame,
  fitVideoProse,
  loadVideoFonts,
  wrapVideoText,
} from "../src/video/frames.js";

test("code emphasis matches complete spoken identifiers, preserves columns, and ignores filler words", () => {
  const line = "  key ID: UUID; title: String(100); stock: Integer; stocking: Integer;";
  const ranges = codeHighlights(line, "An ID, a title, and a stock count.");
  assert.deepEqual(
    ranges.map(({ start, end }) => line.slice(start, end)),
    ["ID", "title", "stock"],
  );
  assert.equal(ranges[0]?.start, 6, "leading indentation stays in its original columns");
  assert.deepEqual(codeHighlights("from this and that", "from this and that"), []);
  assert.deepEqual(codeHighlights("InventoryService Products", "service product"), []);
  assert.deepEqual(codeHighlights(line, ""), []);
  assert.deepEqual(codeHighlights("Products", "products"), [{ start: 0, end: 8 }]);
});

test("closing questions fit by adjusting typography while narration and captions stay intact", async () => {
  const episode = await readContentEpisode("NEWS-01");
  const closing = episode.scenes.at(-1);
  assert.ok(closing);
  const question = "What awkward non-SAP systems would your balance sheet need to invite?";
  closing.narration = `Take a peek at the announcement below. ${question}`;
  closing.overlay = "What's in your stack?";
  const { layout } = await readLayout();
  await loadVideoFonts();
  const ctx = createCanvas(1080, 1920).getContext("2d");
  const size = fitVideoProse(ctx, question, { width: 864, height: 450 }, 78);
  assert.ok(size >= 48 && size < 78);
  ctx.font = `${size}px "Shorts Heading"`;
  const lines = wrapVideoText(ctx, question, 864);
  assert.equal(lines.join(" "), question);
  assert.ok(lines.length * size * 1.22 <= 451);
  const original = structuredClone(episode);
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate: 22050,
    durationSeconds: episode.targetDurationSeconds,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      speechSeconds: 1,
    })),
    cues: [],
  };
  await assertVideoTextFits({ episode, timing, layout, code: {} });
  await drawVideoFrame(
    { episode, timing, layout, code: {} },
    {
      startFrame: Math.ceil(closing.startSeconds * 30),
      endFrame: Math.ceil(closing.startSeconds * 30) + 1,
      sceneIndex: 6,
      cueIndex: null,
    },
  );
  assert.deepEqual(episode, original, "Fitting must not rewrite the episode");
  closing.narration = `${"An exceptionally detailed closing question ".repeat(30)}?`;
  await assert.rejects(
    assertVideoTextFits({ episode, timing, layout, code: {} }),
    /closing question does not fit/,
  );
});

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
