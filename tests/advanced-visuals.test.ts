import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { readContentEpisode, validateEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import type { DemoEvidence } from "../src/domain.js";
import {
  parseWritingResult,
  type WritingInput,
  writingContext,
  writingMessages,
} from "../src/editorial/workflow.js";
import { readLayout } from "../src/layout.js";
import { createPresentationDeck, presentationPlan } from "../src/presentation-deck.js";
import { type PresentationDesign, parsePresentationDesign } from "../src/presentation-design.js";
import { assertPresentationDesignFits, drawVideoFrame } from "../src/video/frames.js";
import {
  chartPlan,
  figureGeometry,
  imagePlacement,
  sequenceGeometry,
  visualLabelLines,
  visualPrimitives,
} from "../src/video/visual-plan.js";
import {
  listVisualAssets,
  rasterDimensions,
  readVisualAsset,
  saveVisualAsset,
} from "../src/visual-assets.js";

const episode = await readContentEpisode("CAP-01");
function design(): PresentationDesign {
  return {
    schemaVersion: 1,
    theme: "ocean",
    motion: "smooth",
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      headline: scene.overlay,
      emphasis: "balanced",
    })),
  };
}
const code = Object.fromEntries(
  await Promise.all(
    episode.scenes
      .flatMap((scene) =>
        "codePath" in scene.visual && scene.visual.codePath ? [scene.visual.codePath] : [],
      )
      .map(async (path) => [path, await readFile(path, "utf8")]),
  ),
);
const evidence = {
  verifiedAt: "2026-10-30T10:00:00Z",
  captures: {
    products: {
      value: [
        { ID: "one", title: "Keyboard", stock: 12 },
        { ID: "two", title: "Dock", stock: 0 },
      ],
    },
    filtered: { value: [{ ID: "one", title: "Keyboard", stock: 12 }] },
  },
} as unknown as DemoEvidence;
const timing = {
  schemaVersion: 1 as const,
  mode: "local-preview" as const,
  voice: "af_heart",
  rate: 155,
  sampleRate: 22050,
  durationSeconds: episode.targetDurationSeconds,
  scenes: episode.scenes.map((scene) => ({
    id: scene.id,
    startSeconds: scene.startSeconds,
    endSeconds: scene.endSeconds,
    speechSeconds: scene.endSeconds - scene.startSeconds,
  })),
  cues: [],
};

test("local visual images preserve aspect, normalize metadata, survive simultaneous uploads and repair exact originals", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "visual-assets-"));
  try {
    const canvas = createCanvas(600, 300);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#12abcd";
    ctx.fillRect(0, 0, 600, 300);
    const png = canvas.toBuffer("image/png");
    const body = {
      label: "Landscape diagram",
      credit: "Original local illustration",
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    };
    const [first, second] = await Promise.all([
      saveVisualAsset(body, root),
      saveVisualAsset(body, root),
    ]);
    assert.equal(first.id, second.id);
    assert.equal(first.width / first.height, 2);
    assert.equal("bytes" in first, false);
    const asset = await readVisualAsset(first.id, root);
    assert.equal(hash(asset.bytes), first.id);
    assert.equal(asset.bytes[0], 255);
    assert.deepEqual(rasterDimensions(asset.bytes), { width: 600, height: 300 });
    assert.equal((await listVisualAssets(root)).length, 1);
    await writeFile(resolve(root, `${first.id}.jpg`), "interrupted upload");
    await assert.rejects(() => readVisualAsset(first.id, root));
    assert.equal((await saveVisualAsset(body, root)).id, first.id);
    assert.ok((await readdir(root)).some((name) => name.startsWith(".damaged-")));
    await assert.rejects(
      () => saveVisualAsset({ ...body, dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, root),
      /PNG|raster/,
    );
    const bomb = Buffer.from(png);
    bomb.writeUInt32BE(12000, 16);
    bomb.writeUInt32BE(12000, 20);
    await assert.rejects(
      () =>
        saveVisualAsset(
          { ...body, dataUrl: `data:image/png;base64,${bomb.toString("base64")}` },
          root,
        ),
      /megapixels/,
    );
    await assert.rejects(() => readVisualAsset("../../outside", root), /reference/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("procedural geometry is deterministic, minimal motion freezes it and charts never author values", () => {
  assert.deepEqual(
    visualPrimitives("aurora", "drift", 0.25),
    visualPrimitives("aurora", "drift", 0.25),
  );
  assert.notDeepEqual(
    visualPrimitives("aurora", "drift", 0.25),
    visualPrimitives("aurora", "drift", 0.75),
  );
  assert.deepEqual(
    visualPrimitives("aurora", "particles", 0.1, true),
    visualPrimitives("aurora", "particles", 0.9, true),
  );
  const chart = chartPlan([
    { title: "Keyboard", stock: 12 },
    { title: "Dock", stock: 0 },
  ]);
  assert.equal(chart.baseline, 0);
  assert.deepEqual(
    chart.rows.map((row) => row.value),
    [12, 0],
  );
  assert.equal(chart.rows[1]?.fraction, 0);
  assert.throws(() => chartPlan([{ title: "bad", stock: -1 }]), /captured/);
  const figure = figureGeometry({ x: 32, y: 100, width: 800, height: 730 });
  assert.equal(figure.width / figure.height, 1.6);
  const crop = imagePlacement(600, 600, figure, "cover", 0.5, 1);
  const deckCrop = imagePlacement(
    600,
    600,
    { x: 0, y: 0, width: 800, height: 500 },
    "cover",
    0.5,
    1,
  );
  assert.equal(crop.height, deckCrop.height);
  assert.equal(crop.y - figure.y, deckCrop.y);
  for (const kind of ["flow", "timeline"])
    for (const node of sequenceGeometry(kind, 4, { x: 0, y: 0, width: 800, height: 730 }))
      assert.ok(node.y + node.height <= 730);
  assert.deepEqual(
    visualLabelLines("W".repeat(32)).map((line) => line.length),
    [16, 16],
  );
});
test("advanced schema preserves old designs and rejects replacing protected evidence or injecting data", () => {
  const legacy = design();
  assert.deepEqual(
    parsePresentationDesign(
      legacy,
      episode.scenes.map((scene) => scene.id),
    ),
    legacy,
  );
  const changed = structuredClone(episode);
  const advanced = design();
  advanced.background = "blueprint";
  advanced.effect = "particles";
  assert.ok(advanced.scenes[0]);
  advanced.scenes[0].composition = {
    kind: "timeline",
    items: [
      "Understand the model",
      "Expose the service",
      "Query the endpoint",
      "Verify the results",
    ].map((label) => ({ label })),
  };
  changed.presentation = {
    tone: "casual",
    format: "explainer",
    humor: "none",
    speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
    design: advanced,
  };
  assert.doesNotThrow(() => validateEpisode(changed));
  assert.ok(advanced.scenes[2]);
  advanced.scenes[2].dataView = "bars";
  assert.throws(() => validateEpisode(changed), /output scene/);
  delete advanced.scenes[2].dataView;
  assert.throws(
    () =>
      parsePresentationDesign(
        { ...advanced, data: [100, 200] },
        episode.scenes.map((scene) => scene.id),
      ),
    /supported theme/,
  );
});
test("flow, timeline, charts and local images render in actual PNGs and offline decks without changing evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "visual-render-"));
  try {
    const canvas = createCanvas(600, 600);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#facc15";
    ctx.fillRect(0, 0, 600, 600);
    const asset = await saveVisualAsset(
      {
        label: "Square illustration",
        credit: "Local test art",
        dataUrl: `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`,
      },
      root,
    );
    const resolved = await readVisualAsset(asset.id, root);
    const { layout } = await readLayout();
    const hashes = new Set<string>();
    for (const kind of ["flow", "timeline", "image", "bars", "dots"] as const) {
      const value = structuredClone(episode);
      const visual = design();
      visual.background = "aurora";
      visual.effect = "drift";
      const index = kind === "bars" || kind === "dots" ? 4 : 0;
      const direction = visual.scenes[index];
      assert.ok(direction);
      if (kind === "flow" || kind === "timeline")
        direction.composition = {
          kind,
          items: [
            "W".repeat(32),
            "Expose the service",
            "Call the endpoint",
            "Inspect the result",
          ].map((label) => ({ label })),
        };
      else if (kind === "image")
        direction.image = {
          assetId: asset.id,
          fit: "cover",
          treatment: "card",
          focalX: 0.5,
          focalY: 1,
          alt: "Square example image",
          caption: "A source-backed illustration",
        };
      else direction.dataView = kind;
      value.presentation = {
        tone: "casual",
        format: "explainer",
        humor: "none",
        speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
        design: visual,
      };
      await assertPresentationDesignFits(value);
      const input = {
        episode: value,
        code,
        evidence,
        timing,
        layout,
        visualAssets: { [asset.id]: resolved },
      };
      const deck = await createPresentationDeck(input);
      const html = String(deck["presentation.html"]);
      assert.ok(html.includes("visualPrimitives"));
      assert.ok(html.includes("primitivesSvg"));
      assert.ok(!html.includes("/api/creator/visual-assets"));
      if (kind === "image") {
        assert.match(html, /data:image\/jpeg;base64/);
        assert.match(html, /Square example image/);
      }
      if (kind === "bars" || kind === "dots") {
        assert.match(html, /Zero baseline/);
        assert.equal(presentationPlan(input).scenes[4]?.rows?.[0]?.stock, 12);
      }
      hashes.add(
        hash(
          await drawVideoFrame(input, {
            sceneIndex: index,
            startFrame: Math.round((value.scenes[index]?.startSeconds ?? 0) * 30 + 30),
            endFrame: Math.round((value.scenes[index]?.startSeconds ?? 0) * 30 + 31),
            cueIndex: null,
          }),
        ),
      );
      assert.deepEqual(value.claims, episode.claims);
      assert.deepEqual(value.sources, episode.sources);
    }
    assert.equal(hashes.size, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("writer sees only image occupancy and preserves local pictures without inventing asset references", () => {
  const current = design();
  const first = current.scenes[0];
  assert.ok(first);
  first.image = {
    assetId: "f".repeat(64),
    treatment: "card",
    fit: "contain",
    focalX: 0.5,
    focalY: 0.5,
    alt: "Private user caption",
    caption: "Local illustration",
  };
  const input: WritingInput = {
    requestId: "a",
    selector: "CAP-01",
    sourceHash: "s",
    settingsHash: "s",
    action: "presentation",
    style: "conversational",
    instruction: "Make it pop",
    allowRemote: false,
    snapshot: {
      title: episode.title,
      scenes: episode.scenes.map((scene) => ({
        id: scene.id,
        overlay: scene.overlay,
        texts: [scene.narration],
      })),
      design: current,
    },
  };
  const context = writingContext(episode, input.snapshot);
  assert.equal(context.scenes[0]?.hasFramedIllustration, true);
  assert.ok(!JSON.stringify(writingMessages(input, episode)).includes(first.image.assetId));
  const proposed = design();
  assert.ok(proposed.scenes[0]);
  proposed.scenes[0].composition = {
    kind: "flow",
    items: [{ label: "One step" }, { label: "Next step" }],
  };
  const parsed = parseWritingResult(JSON.stringify(proposed), input, episode) as PresentationDesign;
  assert.deepEqual(parsed.scenes[0]?.image, first.image);
  assert.equal(parsed.scenes[0]?.composition, undefined);
  proposed.scenes[0].image = first.image;
  assert.throws(
    () => parseWritingResult(JSON.stringify(proposed), input, episode),
    /selected locally/,
  );
});

test("a missing illustration keeps the library preview usable while production remains strict", async () => {
  const value = structuredClone(episode);
  const visual = design();
  assert.ok(visual.scenes[0]);
  visual.scenes[0].image = {
    assetId: "0".repeat(64),
    fit: "contain",
    treatment: "card",
    focalX: 0.5,
    focalY: 0.5,
    alt: "Unavailable local illustration",
  };
  value.presentation = {
    tone: "casual",
    format: "explainer",
    humor: "none",
    speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
    design: visual,
  };
  await assert.rejects(
    () => createPresentationDeck({ episode: value, code, visualAssets: {} }),
    /unavailable/,
  );
  const deck = await createPresentationDeck({
    episode: value,
    code,
    visualAssets: {},
    allowMissingVisualAssets: true,
  });
  assert.match(String(deck["presentation.html"]), /Restore the selected image/);
  assert.equal(
    JSON.parse(String(deck["presentation.json"])).scenes[2].code,
    code["demos/cap/inventory/db/schema.cds"],
  );
});
