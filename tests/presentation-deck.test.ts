import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { readContentEpisode, validateEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { type DemoEvidence, isNewsEpisode } from "../src/domain.js";
import { readLayout } from "../src/layout.js";
import type { NarrationTiming } from "../src/media/model.js";
import { sourceFile } from "../src/paths.js";
import { createPresentationDeck, presentationPlan } from "../src/presentation-deck.js";
import { parsePresentationDesign, type SceneComposition } from "../src/presentation-design.js";
import { cueIdentifiers, feedSceneDesign } from "../src/video/feed-design.js";
import { drawVideoFrame } from "../src/video/frames.js";
import { sceneMotion, storySteps } from "../src/video/motion.js";
import { readVideoReceipt } from "../src/video/receipt.js";

async function input() {
  const episode = await readContentEpisode("CAP-01");
  const code: Record<string, string> = {};
  for (const scene of episode.scenes)
    if ("codePath" in scene.visual && scene.visual.codePath)
      code[scene.visual.codePath] = await readFile(await sourceFile(scene.visual.codePath), "utf8");
  const evidence = {
    verifiedAt: "2026-10-25T10:00:00Z",
    captures: {
      filtered: { value: [{ ID: "fixture", title: "Synthetic keyboard", stock: 12 }] },
      products: {
        value: [
          { ID: "fixture", title: "Synthetic keyboard", stock: 12 },
          { ID: "fixture2", title: "Synthetic dock", stock: 0 },
        ],
      },
    },
  } as unknown as DemoEvidence;
  return { episode, code, evidence };
}
test("presentation plans preserve source code, exact captured rows, scene order, claims and source dates", async () => {
  const value = await input();
  const plan = presentationPlan(value);
  assert.equal(plan.width / plan.height, 9 / 16);
  assert.equal(plan.scenes.length, value.episode.scenes.length);
  assert.equal(
    plan.scenes.find((scene) => scene.id === "model")?.code,
    value.code["demos/cap/inventory/db/schema.cds"],
  );
  assert.deepEqual(plan.scenes.find((scene) => scene.id === "query")?.rows, [
    { title: "Synthetic keyboard", stock: 12 },
  ]);
  assert.equal(plan.sources[0]?.retrievedOn, value.episode.sources[0]?.retrievedOn);
  assert.deepEqual(
    plan.claims,
    value.episode.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceIds: claim.sourceIds,
    })),
  );
  assert.deepEqual(
    plan.steps.map((step) => step.label),
    ["1. Define the data", "2. Expose a service", "3. Run and query"],
  );
  const unverified = presentationPlan({ episode: value.episode, code: {} });
  assert.match(unverified.basis, /no captured demo/);
  assert.ok(unverified.scenes.every((scene) => !scene.rows));
});
test("a supplied narration timeline must include every scene and is used without changing measured boundaries", async () => {
  const value = await input();
  const timing = {
    durationSeconds: 57,
    scenes: value.episode.scenes.map((scene, index) => ({
      id: scene.id,
      startSeconds: scene.startSeconds + 0.1 * index,
      endSeconds: scene.endSeconds + 0.1 * index,
      speechSeconds: 1,
    })),
    cues: [],
  } as unknown as NarrationTiming;
  const plan = presentationPlan({ ...value, timing });
  assert.equal(plan.duration, 57);
  assert.equal(plan.scenes[2]?.start, timing.scenes[2]?.startSeconds);
  timing.scenes.pop();
  assert.throws(() => presentationPlan({ ...value, timing }), /timing is missing/);
});
test("self-contained Reveal decks escape untrusted content, keep technical controls and bundle the pinned vendor license", async () => {
  const value = await input();
  value.episode.title = "</script><script>bad()</script>";
  value.code["demos/cap/inventory/db/schema.cds"] = "<img src=x onerror=bad()>\nentity Products {}";
  const files = await createPresentationDeck({ ...value, audioSrc: "narration.wav" });
  const html = files["presentation.html"];
  assert.match(html, /reveal-viewport|class="reveal"/);
  assert.match(html, /scrollActivationWidth: 0/);
  assert.match(html, /data-stock-filter/);
  assert.match(html, /data-code-focus/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<img src=x|<script>bad\(\)/);
  assert.match(html, /&lt;img src=x/);
  assert.match(files["reveal-LICENSE.txt"], /MIT|Permission is hereby granted/);
  assert.match(html, /id="deck-focus"/);
  assert.equal(
    JSON.parse(files["presentation.json"]).inputHash,
    hash(JSON.stringify(value.episode)),
  );
});
test("news slides preserve explicit availability, scope, cited sources and expired-source disclosure", async () => {
  const episode = await readContentEpisode("NEWS-01");
  const files = await createPresentationDeck({ episode, code: {}, sourceReviewExpired: true });
  const plan = JSON.parse(files["presentation.json"]);
  assert.ok(plan.scenes.some((scene: { claims: unknown[] }) => scene.claims.length));
  assert.match(files["presentation.html"], /source review has expired/);
  assert.match(files["presentation.html"], /Scope &amp; sources|Scope & sources/);
  assert.equal(plan.sources.length, episode.sources.length);
  assert.ok(!plan.audioSrc);
});
test("motion is deterministic and the video changes within a caption without changing the source data", async () => {
  const value = await input();
  const { layout } = await readLayout();
  const timing = { durationSeconds: 55, scenes: [], cues: [] } as unknown as NarrationTiming;
  const first = sceneMotion(value.episode, timing, 0, 0),
    settled = sceneMotion(value.episode, timing, 0, 30);
  assert.deepEqual(first, sceneMotion(value.episode, timing, 0, 0));
  assert.equal(settled.enter, 1);
  assert.ok(first.enter < settled.enter);
  const base = { ...value, timing, layout };
  const a = await drawVideoFrame(base, {
    startFrame: 0,
    endFrame: 1,
    sceneIndex: 0,
    cueIndex: null,
  });
  const b = await drawVideoFrame(base, {
    startFrame: 20,
    endFrame: 21,
    sceneIndex: 0,
    cueIndex: null,
  });
  assert.notEqual(hash(a), hash(b));
  assert.deepEqual(
    storySteps(value.episode).map((step) => step.index),
    [2, 3, 4],
  );
});
test("video receipts validate optional complete presentation artifacts and still support older exports", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "sap-deck-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(root, { recursive: true });
  const files: Record<string, Buffer> = {
    "short.mp4": Buffer.from("0000ftypfixture"),
    "poster.png": Buffer.from("89504e470d0a1a0a", "hex"),
    "review.html": Buffer.from("player"),
    "captions.vtt": Buffer.from("WEBVTT"),
    "timing.json": Buffer.from("{}"),
    "publication-draft.txt": Buffer.from("draft"),
  };
  const hashes: Record<string, string> = {};
  for (const [n, b] of Object.entries(files)) {
    await writeFile(resolve(root, n), b);
    hashes[n] = hash(b);
  }
  const manifest = {
    schemaVersion: 1,
    stage: "READY",
    quality: { decoded: true, audioChecked: true, durationSeconds: 55 },
    artifactHashes: hashes,
  };
  const save = () => writeFile(resolve(root, "video-manifest.json"), JSON.stringify(manifest));
  await save();
  await readVideoReceipt(root);
  for (const [n, s] of Object.entries({
    "presentation.html": "Deck",
    "presentation.json": "{}",
    "reveal-LICENSE.txt": "MIT",
  })) {
    await writeFile(resolve(root, n), s);
    hashes[n] = hash(s);
  }
  await save();
  assert.ok((await readVideoReceipt(root)).files["presentation.html"]);
  await writeFile(resolve(root, "presentation.html"), "tampered");
  await assert.rejects(readVideoReceipt(root), /presentation artifact changed/);
});

test("feed layouts follow the real scene content and keep the service diagram tied to its claim", async () => {
  const { episode } = await input();
  assert.deepEqual(
    episode.scenes.map((_, index) => feedSceneDesign(episode, index).kind),
    ["hook", "code", "code", "code", "result", "result", "closing"],
  );
  assert.equal(feedSceneDesign(episode, 0).serviceBridge, true);
  assert.ok(!isNewsEpisode(episode));
  episode.claims = episode.claims.filter((claim) => claim.id !== "explicit-service");
  assert.equal(feedSceneDesign(episode, 0).serviceBridge, false);
  const model = episode.scenes[2];
  assert.ok(model);
  model.phase = "hook";
  assert.equal(feedSceneDesign(episode, 2).kind, "code");
  const news = await readContentEpisode("NEWS-01");
  assert.equal(feedSceneDesign(news, 0).serviceBridge, false);
  assert.throws(() => feedSceneDesign(episode, 100), /Missing feed scene/);
});
test("feed emphasis preserves exact source identifiers and the closing question comes from the script", async () => {
  const { episode } = await input();
  const last = episode.scenes.at(-1);
  assert.ok(last);
  last.narration = "Try the demo. Which entity would you expose first?";
  assert.equal(
    feedSceneDesign(episode, episode.scenes.length - 1).question,
    "Which entity would you expose first?",
  );
  assert.deepEqual(
    cueIdentifiers(
      "entity Products { ID: UUID; stock: Integer; stocked: Boolean; }",
      "Your Products entity has an ID and stock.",
    ),
    ["entity", "Products", "ID", "stock"],
  );
  assert.deepEqual(cueIdentifiers("stocked", "stock"), []);
});
test("the feed comparison keeps the public CAP script and voice; the deck uses real navigation and source links", async () => {
  const episode = await readContentEpisode("CAP-01@feed-pop");
  const baseline = await readContentEpisode("CAP-01@casual-v2");
  assert.deepEqual(episode.scenes, baseline.scenes);
  assert.deepEqual(episode.claims, baseline.claims);
  assert.deepEqual(episode.presentation?.speakers, baseline.presentation?.speakers);
  const { code, evidence } = await input();
  const files = await createPresentationDeck({ episode, code, evidence });
  assert.match(files["presentation.html"], /class="bridge-node bridge-missing" data-jump="3"/);
  assert.match(files["presentation.html"], /class="closing-action"/);
  assert.ok(files["presentation.html"].includes(episode.sources[0]?.url ?? "missing"));
  assert.match(files["presentation.html"], /<details class="code-interaction">/);
});

test("stored presentation designs drive matching deck/video headlines and preserve factual content", async () => {
  const value = await input();
  const base = await createPresentationDeck(value);
  const { layout } = await readLayout();
  const timing = { durationSeconds: 55, scenes: [], cues: [] } as unknown as NarrationTiming;
  const moment = { startFrame: 20, endFrame: 21, sceneIndex: 2, cueIndex: null };
  const before = await drawVideoFrame({ ...value, timing, layout }, moment);
  value.episode.presentation ??= {
    tone: "professional",
    format: "explainer",
    humor: "none",
    speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
  };
  value.episode.presentation.design = {
    schemaVersion: 1,
    theme: "sunset",
    motion: "minimal",
    scenes: value.episode.scenes.map((scene) => ({
      id: scene.id,
      headline: `Focus: ${scene.overlay}`.slice(0, 48),
      emphasis: "evidence",
    })),
  };
  const plan = presentationPlan(value);
  assert.equal(plan.scenes[2]?.title, value.episode.presentation.design.scenes[2]?.headline);
  assert.equal(feedSceneDesign(value.episode, 2).headline, plan.scenes[2]?.title);
  assert.deepEqual(plan.scenes[2]?.code, JSON.parse(base["presentation.json"]).scenes[2].code);
  const deck = await createPresentationDeck(value);
  assert.match(deck["presentation.html"], /custom-design/);
  assert.equal(sceneMotion(value.episode, timing, 2, 300).enter, 1);
  assert.notEqual(hash(before), hash(await drawVideoFrame({ ...value, timing, layout }, moment)));
  assert.deepEqual(plan.sources, value.episode.sources);
});

test("callout, steps and comparison compositions change both deck and MP4 frames without replacing evidence", async () => {
  const value = await input();
  const original = structuredClone(value.episode);
  const originalCode = presentationPlan(value).scenes[2]?.code;
  const { layout } = await readLayout();
  const timing = { durationSeconds: 55, scenes: [], cues: [] } as unknown as NarrationTiming;
  const moment = { startFrame: 20, endFrame: 21, sceneIndex: 0, cueIndex: null };
  const hashes = new Set<string>();
  for (const kind of ["callout", "steps", "comparison"] as const) {
    const labels =
      kind === "callout"
        ? ["Find the missing connection"]
        : kind === "steps"
          ? ["Define data", "Expose service", "Call the endpoint"]
          : ["Data definition", "Exposed service"];
    const composition: SceneComposition = { kind, items: labels.map((label) => ({ label })) };
    value.episode.presentation = {
      tone: "professional",
      format: "explainer",
      humor: "none",
      speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
      design: {
        schemaVersion: 1,
        theme: "ocean",
        motion: "minimal",
        scenes: value.episode.scenes.map((scene, index) => ({
          id: scene.id,
          headline: scene.overlay,
          emphasis: "balanced",
          ...(index === 0 ? { composition } : {}),
        })),
      },
    };
    validateEpisode(value.episode);
    const html = (await createPresentationDeck(value))["presentation.html"];
    assert.match(html, new RegExp(`composition-${kind}`));
    assert.ok(html.includes(labels[0] ?? "missing"));
    hashes.add(hash(await drawVideoFrame({ ...value, timing, layout }, moment)));
    assert.deepEqual(value.episode.claims, original.claims);
    assert.deepEqual(value.episode.sources, original.sources);
    assert.deepEqual(presentationPlan(value).scenes[2]?.code, originalCode);
  }
  assert.equal(hashes.size, 3);
  const design = value.episode.presentation?.design;
  assert.ok(design);
  const explanation = design.scenes[0];
  const code = design.scenes[2];
  assert.ok(explanation && code);
  assert.ok(explanation.composition);
  code.composition = explanation.composition;
  assert.throws(() => validateEpisode(value.episode), /evidence layout/u);
  delete code.composition;
  explanation.composition = {
    kind: "callout",
    items: [{ label: "Unsupported fact", claimId: "invented-claim" }],
  };
  assert.throws(() => validateEpisode(value.episode), /claim references/u);
  explanation.composition = { kind: "callout", items: [{ label: "Seventy percent growth" }] };
  const invalid = structuredClone(design);
  const invalidItem = invalid.scenes[0]?.composition?.items[0];
  assert.ok(invalidItem);
  invalidItem.label = "70% growth";
  assert.throws(
    () =>
      parsePresentationDesign(
        invalid,
        value.episode.scenes.map((s) => s.id),
      ),
    /factual values/u,
  );
});

test("wide accepted visual headlines fit export and repeated story cards at readable sizes", async () => {
  const { assertPresentationDesignFits } = await import("../src/video/frames.js");
  const value = await input();
  value.episode.presentation = {
    tone: "professional",
    format: "explainer",
    humor: "none",
    speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
    design: {
      schemaVersion: 1,
      theme: "ocean",
      motion: "minimal",
      scenes: value.episode.scenes.map((scene) => ({
        id: scene.id,
        headline: "WWW integration: WWW modules meet WWW middleware",
        emphasis: "headline",
      })),
    },
  };
  await assertPresentationDesignFits(value.episode);
  const { layout } = await readLayout();
  const timing = { durationSeconds: 55, scenes: [], cues: [] } as unknown as NarrationTiming;
  for (const index of [0, 2])
    await drawVideoFrame(
      { ...value, timing, layout },
      { startFrame: 20, endFrame: 21, sceneIndex: index, cueIndex: null },
    );
  // Exercise the hook's repeated story cards as well as the CAP diagram.
  assert.ok(!isNewsEpisode(value.episode));
  value.episode.claims = value.episode.claims.filter((claim) => claim.id !== "explicit-service");
  await drawVideoFrame(
    { ...value, timing, layout },
    { startFrame: 20, endFrame: 21, sceneIndex: 0, cueIndex: null },
  );
});

test("presentation fit guards reject text that would overflow smaller numbered story cards", async () => {
  const { assertPresentationDesignFits } = await import("../src/video/frames.js");
  const episode = await readContentEpisode("NEWS-01");
  episode.presentation = {
    tone: "professional",
    format: "explainer",
    humor: "none",
    speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
    design: {
      schemaVersion: 1,
      theme: "ocean",
      motion: "minimal",
      scenes: episode.scenes.map((scene) => ({
        id: scene.id,
        headline: "W".repeat(48),
        emphasis: "headline",
      })),
    },
  };
  await assert.rejects(assertPresentationDesignFits(episode), /story headline is too wide/);
});
