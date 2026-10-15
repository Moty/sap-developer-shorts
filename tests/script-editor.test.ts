import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { isNewsEpisode } from "../src/domain.js";
import { createLibraryPages } from "../src/library-review.js";
import { projectRoot } from "../src/paths.js";
import { createScriptEditor, scriptEditorSeed } from "../src/script-editor.js";
import { validatePresentationDefinition } from "../src/variants.js";

test("script workshop seeds preserve tutorial, dialogue, and news inputs with a current base binding", async () => {
  for (const selector of ["CAP-01", "CAP-02@quiz", "CAP-01@duo", "NEWS-02"]) {
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
  assert.match(expired, /Checked 2026-10-15/u);
});

async function workshop(selector: string) {
  const html = await createScriptEditor(await readContentEpisode(selector), {
    reservedNames: ["taken"],
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
