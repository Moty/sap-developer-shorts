import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { isNewsEpisode } from "../src/domain.js";
import { createLibraryPages } from "../src/library-review.js";
import type { MediaRequest } from "../src/media/model.js";
import { narrationIdentity } from "../src/media/reuse.js";
import { productionSettings } from "../src/media/worker.js";
import { projectRoot } from "../src/paths.js";
import { createScriptEditor, scriptEditorSeed } from "../src/script-editor.js";
import { importScript } from "../src/script-import.js";
import { validatePresentationDefinition } from "../src/variants.js";

test("script workshop seeds preserve tutorial, dialogue, and news inputs with a current base binding", async () => {
  for (const selector of ["CAP-01", "CAP-02@quiz", "CAP-01@duo", "NEWS-02", "NEWS-02@duo"]) {
    const original = await readContentEpisode(selector);
    const seed = await scriptEditorSeed(original, "af_bella");
    const { episode } = await validatePresentationDefinition(seed);
    assert.deepEqual(episode.sources, original.sources);
    assert.deepEqual(episode.claims, original.claims);
    assert.deepEqual(episode.scenes, original.scenes);
    assert.equal(seed.baseInputHash, hash(JSON.stringify(await readContentEpisode(original.id))));
    assert.notEqual(episode.presentation?.variant, original.presentation?.variant);
    assert.deepEqual(
      episode.presentation?.speakers,
      original.presentation?.speakers ?? [{ id: "narrator", name: "Narrator", voice: "af_bella" }],
    );
    if (isNewsEpisode(original)) {
      assert.ok(isNewsEpisode(episode));
      assert.deepEqual(episode.news, original.news);
    }
  }
});

test("workshop escapes edited text and has a readable no-JavaScript fallback", async () => {
  const episode = await readContentEpisode("CAP-02@quiz");
  episode.title = 'A <tag> & "quoted" title';
  const scene = episode.scenes[0];
  assert.ok(scene);
  scene.narration = "What does </script><img src=x> mean?";
  const html = await createScriptEditor(episode);
  assert.equal((html.match(/<script\b/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /<img src=x>/u);
  assert.match(html, /&lt;tag&gt; &amp;/u);
  assert.match(html, /\\u003c\/script>/u);
  assert.match(html, /<noscript>.*original script and sources remain readable/su);
  assert.match(html, /<fieldset id="editor-fields" disabled>/u);
  assert.match(html, /id="download-controls"[^>]*hidden/u);
  assert.match(html, /class="original-script"/u);
  const expired = await createScriptEditor(await readContentEpisode("NEWS-02"), {
    sourceReviewExpired: true,
  });
  assert.match(expired, /Source recheck required/u);
  assert.match(expired, /Sources reviewed <strong>2026-10-15<\/strong>/u);
  assert.match(expired, /review valid through <strong>2026-10-22<\/strong>/u);
});

async function workshop(selector: string, availableVoices = ["af_heart", "am_michael"]) {
  const html = await createScriptEditor(await readContentEpisode(selector), {
    reservedNames: ["taken"],
    availableVoices,
  });
  const match = html.match(
    /<script type="application\/json" id="editor-data">([\s\S]*?)<\/script>/u,
  );
  assert.ok(match?.[1]);
  const payload = JSON.parse(match[1]);
  const nodes = new Map<string, ReturnType<typeof node>>();
  function node(id: string, value = "") {
    assert.ok(html.includes(`id="${id}"`), `Missing editor element: ${id}`);
    const result = {
      value,
      textContent: "",
      hidden: false,
      disabled: false,
      listeners: new Map<string, () => void>(),
      addEventListener(name: string, handler: () => void) {
        result.listeners.set(name, handler);
      },
    };
    nodes.set(id, result);
    return result;
  }
  const get = (id: string) => {
    const result = nodes.get(id);
    assert.ok(result, `Unknown editor element: ${id}`);
    return result;
  };
  node("editor-data").textContent = match[1];
  for (const id of [
    "editor-fields",
    "download-controls",
    "download-script",
    "download-status",
    "draft-count",
    "draft-errors",
    "produce-command",
  ])
    node(id);
  node("variant-name", payload.seed.presentation.variant);
  node("draft-title", payload.seed.title);
  node("publication-text", payload.seed.publicationText);
  for (const [index, speaker] of payload.seed.presentation.speakers.entries()) {
    node(`speaker-voice-${index}`, speaker.voice);
    node(`speaker-voice-${index}-help`);
  }
  for (const [index, scene] of payload.seed.scenes.entries()) {
    node(`overlay-${index}`, scene.overlay);
    node(`scene-${index}-count`);
    node(`scene-${index}-warning`);
    if (scene.dialogue)
      for (const [position, turn] of scene.dialogue.entries())
        node(`turn-${index}-${position}`, turn.text);
    else node(`narration-${index}`, scene.narration);
  }
  class TestBlob {
    constructor(readonly parts: string[]) {}
  }
  const downloads: TestBlob[] = [];
  runInNewContext(await readFile(resolve(projectRoot, "templates/script-editor.js"), "utf8"), {
    structuredClone,
    document: {
      getElementById: get,
      body: { append() {} },
      createElement: () => ({ href: "", download: "", click() {}, remove() {} }),
    },
    Blob: TestBlob,
    URL: {
      createObjectURL(blob: TestBlob) {
        downloads.push(blob);
        return "blob:fixture";
      },
      revokeObjectURL() {},
    },
    setTimeout: (handler: () => void) => handler(),
  });
  const update = () => get("editor-fields").listeners.get("input")?.();
  const download = () => get("download-script").listeners.get("click")?.();
  return { get, update, download, downloads };
}

test("the actual workshop script downloads validated solo/dialogue revisions and derives exact turn narration", async () => {
  for (const selector of ["CAP-02@quiz", "CAP-01@duo"]) {
    const ui = await workshop(selector);
    ui.get("variant-name").value = "workshop-check";
    ui.get(selector.includes("duo") ? "turn-0-0" : "narration-0").value =
      "Which CAP products have stock?";
    ui.get("overlay-0").value = 'Predict <stock> & "answer"';
    ui.update();
    assert.equal(ui.get("download-script").disabled, false);
    ui.download();
    assert.equal(ui.downloads.length, 1);
    const definition = JSON.parse(ui.downloads[0]?.parts.join("") ?? "null");
    const checked = await validatePresentationDefinition(definition);
    assert.match(checked.selector, /@workshop-check$/u);
    assert.equal(checked.episode.scenes[0]?.overlay, 'Predict <stock> & "answer"');
    assert.equal(checked.episode.scenes[0]?.narration, "Which CAP products have stock?");
    if (selector.includes("duo")) {
      const turns = checked.episode.scenes[0]?.dialogue;
      assert.equal(checked.episode.scenes[0]?.narration, turns?.map((turn) => turn.text).join(" "));
    }
    assert.match(ui.get("produce-command").textContent, /@workshop-check --serve$/u);
  }
});

test("the actual workshop blocks duplicate/invalid names and overlong openings before download", async () => {
  const ui = await workshop("CAP-02@quiz");
  for (const name of ["taken", "../../outside", "UpperCase"]) {
    ui.get("variant-name").value = name;
    ui.update();
    ui.download();
    assert.equal(ui.get("download-script").disabled, true);
    assert.equal(ui.downloads.length, 0);
  }
  ui.get("variant-name").value = "a-new-version";
  ui.get("narration-0").value = "This opening has far too many words for the short.";
  ui.update();
  ui.download();
  assert.equal(ui.get("download-script").disabled, true);
  assert.match(ui.get("scene-0-warning").textContent, /seven words/u);
  assert.equal(ui.downloads.length, 0);
});

test("prepared scripts with no recording still get a workshop without claiming media readiness", async () => {
  const pages = await createLibraryPages({
    entries: [
      {
        episode: await readContentEpisode("CAP-02@quiz"),
        preview: null,
        sourceReviewExpired: false,
      },
    ],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.ok(pages["episodes/CAP-02@quiz/edit.html"]);
  assert.match(String(pages["review.html"]), /CAP-02%40quiz\/edit.html/u);
  assert.doesNotMatch(String(pages["review.html"]), /Watch MP4/u);
  assert.match(String(pages["review.html"]), /No recording yet/u);
});

test("a workshop voice change imports as a new revision without changing the default or source", async (t) => {
  const configPath = resolve(projectRoot, "config/production.json");
  const configBefore = await readFile(configPath);
  const sourceBefore = await readContentEpisode("CAP-02");
  const ui = await workshop("CAP-02");
  ui.get("variant-name").value = "michael-review";
  ui.get("speaker-voice-0").value = "am_michael";
  ui.update();
  assert.equal(ui.get("download-script").disabled, false);
  ui.download();
  const draft = JSON.parse(ui.downloads[0]?.parts.join("") ?? "null");
  const root = await mkdtemp(resolve(tmpdir(), "sap-workshop-voice-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const presentationDirectory = resolve(root, "presentations");
  await mkdir(presentationDirectory);
  const input = resolve(root, "download.json");
  await writeFile(input, JSON.stringify(draft));
  const result = await importScript(input, { presentationDirectory });
  assert.equal(result.selector, "CAP-02@michael-review");
  assert.deepEqual(result.episode.presentation?.speakers, [
    { id: "narrator", name: "Narrator", voice: "am_michael" },
  ]);
  assert.deepEqual(result.episode.scenes, sourceBefore.scenes);
  assert.deepEqual(await readContentEpisode("CAP-02"), sourceBefore);
  assert.deepEqual(await readFile(configPath), configBefore);
  assert.equal(
    (await productionSettings()).localPreview.voice,
    JSON.parse(configBefore.toString()).localPreview.voice,
  );

  const request = {
    provider: "local-kokoro",
    generatorHash: hash("generator"),
    voiceRuntimeHash: hash("runtime"),
    settings: await productionSettings(),
    episode: { ...result.episode, presentation: structuredClone(result.episode.presentation) },
  } as MediaRequest;
  const changedIdentity = narrationIdentity(request);
  const speaker = request.episode.presentation?.speakers[0];
  assert.ok(speaker);
  speaker.voice = "af_heart";
  assert.notEqual(
    narrationIdentity(request),
    changedIdentity,
    "per-revision voices cannot reuse mismatched speech",
  );
});

test("conversation voice choices preserve names and turns and block duplicate or injected choices", async () => {
  const original = await readContentEpisode("CAP-01@duo");
  const ui = await workshop("CAP-01@duo");
  ui.get("speaker-voice-0").value = "am_michael";
  ui.update();
  ui.download();
  assert.equal(ui.downloads.length, 0);
  assert.match(ui.get("draft-errors").textContent, /different voice for each/u);
  ui.get("speaker-voice-1").value = "af_heart";
  ui.update();
  ui.download();
  const checked = await validatePresentationDefinition(
    JSON.parse(ui.downloads[0]?.parts.join("") ?? "null"),
  );
  assert.deepEqual(
    checked.episode.presentation?.speakers.map(({ id, name }) => ({ id, name })),
    original.presentation?.speakers.map(({ id, name }) => ({ id, name })),
  );
  assert.deepEqual(checked.episode.scenes, original.scenes);
  assert.deepEqual(
    checked.episode.presentation?.speakers.map(({ voice }) => voice),
    ["am_michael", "af_heart"],
  );
  for (const voice of ["../outside", "af_bella", ""]) {
    ui.get("speaker-voice-0").value = voice;
    ui.update();
    ui.download();
    assert.equal(ui.downloads.length, 1);
    assert.match(ui.get("draft-errors").textContent, /available voice/u);
  }
});

test("missing original voices stay selectable and drafts remain portable without local assets", async () => {
  const ui = await workshop("CAP-02", []);
  assert.equal(ui.get("speaker-voice-0").value, "af_heart");
  assert.match(ui.get("speaker-voice-0-help").textContent, /voice-setup af_heart/u);
  assert.equal(ui.get("download-script").disabled, false);
  ui.download();
  const checked = await validatePresentationDefinition(
    JSON.parse(ui.downloads[0]?.parts.join("") ?? "null"),
  );
  assert.equal(checked.episode.presentation?.speakers[0]?.voice, "af_heart");
  const pages = await createLibraryPages({
    entries: [
      { episode: await readContentEpisode("CAP-02"), preview: null, sourceReviewExpired: false },
    ],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
    voiceCatalog: {
      selected: "af_heart",
      installed: ["af_heart", "af_bella", "am_michael"],
      available: ["am_michael", "invalid"],
      samples: [],
    },
  });
  const html = String(pages["episodes/CAP-02/edit.html"]);
  assert.match(html, /<option value="af_heart" selected>.*Setup needed/u);
  assert.match(html, /<option value="am_michael">/u);
  assert.doesNotMatch(html, /<option value="af_bella"/u);
  assert.doesNotMatch(html, /<option value="invalid"/u);
  assert.match(html, /href="\.\.\/\.\.\/review\.html#voices" target="_blank" rel="noopener"/u);
  assert.match(html, /Listen to saved voice samples/u);
  assert.match(html, /opens in a new tab/u);
});
