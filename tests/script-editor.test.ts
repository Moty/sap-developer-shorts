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
  let focused = "";
  class Element {
    value = "";
    hidden = false;
    disabled = false;
    open = false;
    className = "";
    type = "";
    href = "";
    download = "";
    options: { value: string; textContent: string }[] = [];
    children: Element[] = [];
    textUpdates = 0;
    listeners = new Map<string, () => void>();
    private text = "";
    constructor(
      readonly tagName: string,
      readonly id = "",
    ) {}
    get textContent(): string {
      return this.text + this.children.map((child) => child.textContent).join("");
    }
    set textContent(value: string) {
      this.textUpdates += 1;
      this.text = value;
      this.children = [];
    }
    set innerHTML(_value: string) {
      throw new Error("The workshop must render changed user text without parsing HTML");
    }
    append(...children: Element[]) {
      this.children.push(...children);
    }
    replaceChildren(...children: Element[]) {
      this.children = children;
      this.text = "";
    }
    addEventListener(name: string, handler: () => void) {
      this.listeners.set(name, handler);
    }
    click() {
      this.listeners.get("click")?.();
    }
    focus() {
      focused = this.id;
    }
    remove() {}
  }
  const nodes = new Map<string, Element>();
  function node(id: string, value = "") {
    assert.ok(html.includes(`id="${id}"`), `Missing editor element: ${id}`);
    const result = new Element("div", id);
    result.value = value;
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
    "review-changes",
    "review-changes-summary",
    "review-changes-count",
    "review-changes-list",
  ])
    node(id);
  node("variant-name", payload.seed.presentation.variant);
  node("draft-title", payload.seed.title);
  node("publication-text", payload.seed.publicationText);
  for (const [index, speaker] of payload.seed.presentation.speakers.entries()) {
    const select = node(`speaker-voice-${index}`, speaker.voice);
    const options = html.match(
      new RegExp(`<select id="speaker-voice-${index}"[^>]*>(.*?)</select>`, "u"),
    )?.[1];
    assert.ok(options);
    select.options = [...options.matchAll(/<option value="([^"]+)"[^>]*>(.*?)<\/option>/gu)].map(
      (option) => ({ value: option[1] as string, textContent: option[2] as string }),
    );
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
      createElement: (tag: string) => new Element(tag),
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
  const descendants = (element: Element): Element[] => [
    element,
    ...element.children.flatMap(descendants),
  ];
  const changes = () => get("review-changes-list").children;
  const restore = (label: string) => {
    const button = descendants(get("review-changes-list")).find(
      (element) => element.tagName === "button" && element.textContent === label,
    );
    assert.ok(button, `Missing restore control: ${label}`);
    button.click();
  };
  return {
    get,
    update,
    download,
    downloads,
    changes,
    descendants,
    restore,
    focused: () => focused,
    seed: payload.seed,
  };
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

test("change review shows the normalized downloadable text safely and counts content sections only", async () => {
  const ui = await workshop("CAP-02@quiz");
  assert.equal(ui.changes().length, 0);
  ui.get("review-changes").open = true;
  ui.get("variant-name").value = "reviewed-copy";
  ui.get("draft-title").value = `  ${ui.seed.title}\n`;
  ui.get("narration-0").value = `\n${ui.seed.scenes[0].narration}  `;
  ui.update();
  assert.equal(
    ui.changes().length,
    0,
    "version names and trimmed whitespace are not content changes",
  );
  const title = 'A <tag> & "quoted" title';
  const post = "First line.\n\nSecond <img src=x onerror=bad()> line.";
  const narration = "Which products have stock?";
  ui.get("draft-title").value = `  ${title}  `;
  ui.get("publication-text").value = `\n${post}\n`;
  ui.get("overlay-0").value = "  Predict <stock>  ";
  ui.get("narration-0").value = ` ${narration} `;
  ui.get("narration-0").focus();
  ui.update();
  assert.equal(ui.changes().length, 3);
  assert.match(ui.get("review-changes-count").textContent, /3 edited sections/u);
  assert.equal(ui.get("review-changes").open, true);
  assert.equal(ui.focused(), "narration-0", "typing must not move focus");
  const announcements = ui.get("review-changes-count").textUpdates;
  ui.update();
  assert.equal(
    ui.get("review-changes-count").textUpdates,
    announcements,
    "unchanged counts must not be re-announced",
  );
  const values = ui
    .descendants(ui.get("review-changes-list"))
    .filter((node) => node.tagName === "pre")
    .map((node) => node.textContent);
  assert.ok(values.includes(title));
  assert.ok(values.includes(post));
  assert.ok(values.includes(narration));
  assert.ok(values.includes("Predict <stock>"));
  assert.ok(ui.descendants(ui.get("review-changes-list")).every((node) => node.tagName !== "img"));
  assert.ok(
    ui
      .descendants(ui.get("review-changes-list"))
      .filter((node) => node.tagName === "button")
      .every((node) => node.type === "button"),
  );
  ui.download();
  const draft = JSON.parse(ui.downloads[0]?.parts.join("") ?? "null");
  assert.equal(draft.title, title);
  assert.equal(draft.publicationText, post);
  assert.equal(draft.scenes[0].narration, narration);
  assert.equal(draft.scenes[0].overlay, "Predict <stock>");
  await validatePresentationDefinition(draft);

  ui.get("draft-title").value = ui.seed.title;
  ui.update();
  assert.equal(ui.changes().length, 2, "manually reverting removes the section");
  ui.get("draft-title").value = "Autofilled title";
  ui.download();
  assert.equal(ui.changes().length, 3, "download refreshes review even without an input event");
  assert.equal(JSON.parse(ui.downloads[1]?.parts.join("") ?? "null").title, "Autofilled title");
});

test("targeted restoration preserves unrelated edits and version naming and revalidates invalid scenes", async () => {
  const ui = await workshop("CAP-02@quiz");
  const seedBefore = JSON.stringify(ui.seed);
  ui.get("variant-name").value = "keep-this-version";
  ui.get("draft-title").value = "Keep this edited title";
  ui.get("publication-text").value = "Keep this edited post.";
  ui.get("overlay-0").value = "Edited opening";
  ui.get("narration-0").value = "   ";
  ui.get("overlay-1").value = "Keep this other scene";
  ui.get("review-changes").open = true;
  ui.update();
  assert.equal(ui.get("download-script").disabled, true);
  assert.match(ui.get("review-changes-list").textContent, /Revised \(empty\)/u);
  ui.download();
  assert.equal(ui.downloads.length, 0);
  ui.get("download-status").textContent = "Earlier download";
  ui.restore("Restore scene 1");
  assert.equal(ui.get("narration-0").value, ui.seed.scenes[0].narration);
  assert.equal(ui.get("overlay-0").value, ui.seed.scenes[0].overlay);
  assert.equal(ui.get("overlay-1").value, "Keep this other scene");
  assert.equal(ui.get("draft-title").value, "Keep this edited title");
  assert.equal(ui.get("publication-text").value, "Keep this edited post.");
  assert.equal(ui.get("variant-name").value, "keep-this-version");
  assert.equal(ui.get("download-script").disabled, false);
  assert.equal(ui.get("download-status").textContent, "");
  assert.equal(ui.get("review-changes").open, true);
  assert.equal(ui.focused(), "narration-0");
  ui.restore("Restore title");
  assert.equal(ui.get("draft-title").value, ui.seed.title);
  assert.equal(ui.focused(), "draft-title");
  assert.equal(ui.get("publication-text").value, "Keep this edited post.");
  ui.restore("Restore post");
  assert.equal(ui.get("publication-text").value, ui.seed.publicationText);
  assert.equal(ui.focused(), "publication-text");
  assert.equal(ui.changes().length, 1);
  assert.equal(ui.get("variant-name").value, "keep-this-version");
  assert.equal(JSON.stringify(ui.seed), seedBefore);
  ui.get("draft-title").value = "";
  ui.update();
  ui.restore("Restore scene 2");
  assert.equal(
    ui.get("download-script").disabled,
    true,
    "restoring a scene must not clear another field's error",
  );
  assert.match(ui.get("draft-errors").textContent, /title of 1–60/u);
  ui.restore("Restore title");
  assert.equal(ui.get("download-script").disabled, false);
  assert.equal(ui.changes().length, 0);
});

test("dialogue restoration resets every scene turn and starting voice together without changing speaker identity", async () => {
  const ui = await workshop("NEWS-02@duo");
  ui.get("variant-name").value = "dialogue-review";
  const index = ui.seed.scenes.findIndex(
    (scene: { dialogue?: unknown[] }) => (scene.dialogue?.length ?? 0) > 1,
  );
  assert.ok(index >= 0);
  ui.get(`turn-${index}-0`).value = "A changed first turn.";
  ui.get(`turn-${index}-1`).value = "A changed second turn.";
  ui.get(`overlay-${index}`).value = "Changed scene title";
  ui.get("publication-text").value = "Keep this separate post edit.";
  ui.get("speaker-voice-0").value = ui.seed.presentation.speakers[1].voice;
  ui.update();
  assert.match(ui.get("draft-errors").textContent, /different voice for each/u);
  assert.equal(ui.changes().length, 3);
  const changes = ui.get("review-changes-list").textContent;
  assert.match(changes, /A changed first turn/u);
  assert.match(changes, /A changed second turn/u);
  assert.match(changes, /Heart|Michael/u);
  ui.restore("Restore starting voices");
  assert.equal(ui.get("speaker-voice-0").value, ui.seed.presentation.speakers[0].voice);
  assert.equal(ui.get("speaker-voice-1").value, ui.seed.presentation.speakers[1].voice);
  assert.equal(ui.focused(), "speaker-voice-0");
  assert.doesNotMatch(ui.get("draft-errors").textContent, /different voice for each/u);
  assert.equal(ui.get(`turn-${index}-0`).value, "A changed first turn.");
  ui.restore(`Restore scene ${index + 1}`);
  for (const [position, turn] of ui.seed.scenes[index].dialogue.entries())
    assert.equal(ui.get(`turn-${index}-${position}`).value, turn.text);
  assert.equal(ui.focused(), `turn-${index}-0`);
  assert.equal(ui.get("publication-text").value, "Keep this separate post edit.");
  ui.download();
  const definition = JSON.parse(ui.downloads[0]?.parts.join("") ?? "null");
  const checked = await validatePresentationDefinition(definition);
  const original = await readContentEpisode("NEWS-02@duo");
  assert.deepEqual(checked.episode.scenes, original.scenes);
  assert.deepEqual(checked.episode.presentation?.speakers, original.presentation?.speakers);
  assert.deepEqual(checked.episode.sources, original.sources);
  assert.deepEqual(checked.episode.claims, original.claims);
  assert.ok(isNewsEpisode(checked.episode) && isNewsEpisode(original));
  assert.deepEqual(checked.episode.news, original.news);
});

test("voice review compares profile IDs and can restore missing original assets without bypassing invalid input", async () => {
  const ui = await workshop("CAP-02", ["am_michael"]);
  ui.get("speaker-voice-0").value = "am_michael";
  ui.update();
  assert.equal(ui.changes().length, 1);
  assert.match(ui.get("review-changes-list").textContent, /Setup needed/u);
  ui.restore("Restore starting voices");
  assert.equal(ui.get("speaker-voice-0").value, "af_heart");
  assert.match(ui.get("speaker-voice-0-help").textContent, /voice-setup af_heart/u);
  assert.equal(ui.changes().length, 0);
  const select = ui.get("speaker-voice-0");
  for (const option of select.options) option.textContent = "Same display label";
  select.value = "am_michael";
  ui.update();
  assert.equal(ui.changes().length, 1, "distinct profiles remain a change despite equal labels");
  select.value = "Same display label";
  ui.update();
  assert.equal(ui.changes().length, 1, "an invalid profile cannot hide behind an existing label");
  ui.download();
  assert.equal(ui.downloads.length, 0);
  assert.equal(ui.get("download-script").disabled, true);
  ui.restore("Restore starting voices");
  assert.equal(ui.get("download-script").disabled, false);
  assert.equal(select.value, "af_heart");
});

test("unchanged input, blur, and download reads preserve review controls while still validating", async () => {
  const ui = await workshop("CAP-02@quiz");
  ui.get("variant-name").value = "stable-review";
  ui.get("draft-title").value = "Keep this revised title";
  ui.get("narration-0").value = "";
  ui.get("review-changes").open = true;
  ui.get("narration-0").focus();
  ui.update();
  const sections = [...ui.changes()];
  const restoreScene = ui
    .descendants(ui.get("review-changes-list"))
    .find((node) => node.tagName === "button" && node.textContent === "Restore scene 1");
  assert.ok(restoreScene);
  ui.update();
  ui.get("editor-fields").listeners.get("change")?.();
  ui.get("draft-errors").textContent = "";
  ui.get("download-script").disabled = false;
  ui.download();
  assert.equal(ui.downloads.length, 0, "cached comparison must not bypass validation");
  assert.equal(ui.get("download-script").disabled, true);
  assert.match(ui.get("draft-errors").textContent, /needs text/u);
  assert.equal(ui.changes().length, sections.length);
  for (const [index, section] of sections.entries())
    assert.equal(
      ui.changes()[index],
      section,
      "unchanged reads must preserve existing section objects",
    );
  assert.ok(ui.descendants(ui.get("review-changes-list")).includes(restoreScene));
  assert.equal(ui.get("review-changes").open, true);
  assert.equal(ui.focused(), "narration-0");
  restoreScene.click();
  assert.equal(ui.get("narration-0").value, ui.seed.scenes[0].narration);
  assert.equal(ui.get("download-script").disabled, false);
  assert.equal(ui.focused(), "narration-0");
  assert.equal(ui.get("draft-title").value, "Keep this revised title");
  assert.equal(ui.changes().length, 1);
  assert.notEqual(ui.changes()[0], sections[0], "actual content changes must refresh review");
  const titleSection = ui.changes()[0];
  ui.download();
  assert.equal(ui.downloads.length, 1);
  assert.equal(ui.changes()[0], titleSection, "valid download also preserves unchanged controls");
  assert.equal(
    JSON.parse(ui.downloads[0]?.parts.join("") ?? "null").title,
    "Keep this revised title",
  );
});
