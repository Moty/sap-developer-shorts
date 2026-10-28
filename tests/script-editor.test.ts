import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { isNewsEpisode } from "../src/domain.js";
import type { WritingProposal, WritingSnapshot } from "../src/editorial/workflow.js";
import { createLibraryPages } from "../src/library-review.js";
import type { MediaRequest } from "../src/media/model.js";
import { narrationIdentity } from "../src/media/reuse.js";
import { productionSettings } from "../src/media/worker.js";
import { projectRoot } from "../src/paths.js";
import { createScriptEditor, scriptEditorSeed } from "../src/script-editor.js";
import { importScript } from "../src/script-import.js";
import { validatePresentationDefinition } from "../src/variants.js";

test("script workshop seeds preserve tutorial, dialogue, and news inputs with a current base binding", async () => {
  for (const selector of [
    "CAP-01",
    "CAP-01@casual-v2",
    "CAP-02@quiz",
    "CAP-01@duo",
    "NEWS-02",
    "NEWS-02@duo",
  ]) {
    const original = await readContentEpisode(selector);
    const seed = await scriptEditorSeed(original, "af_bella");
    const { episode } = await validatePresentationDefinition(seed);
    assert.deepEqual(episode.sources, original.sources);
    assert.deepEqual(episode.claims, original.claims);
    assert.deepEqual(episode.scenes, original.scenes);
    assert.deepEqual(episode.pronunciation, original.pronunciation);
    if (selector === "CAP-01@casual-v2")
      assert.deepEqual(seed.pronunciation, { API: "A P I", npm: "N P M", URL: "U R L" });
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

type RecoveryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function recoveryStorage() {
  const data = new Map<string, string>();
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    data,
    calls,
    getItem(key: string) {
      calls.get++;
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      calls.set++;
      data.set(key, value);
    },
    removeItem(key: string) {
      calls.remove++;
      data.delete(key);
    },
  };
}

async function workshop(
  selector: string,
  availableVoices = ["af_heart", "am_michael"],
  recovery: {
    storage?: RecoveryStorage | null;
    blockedAccess?: boolean;
    pathname?: string;
    nativePhotoSelect?: boolean;
    mutatePayload?: (payload: Record<string, unknown>) => void;
  } = {},
) {
  const html = await createScriptEditor(await readContentEpisode(selector), {
    reservedNames: ["taken"],
    availableVoices,
  });
  const match = html.match(
    /<script type="application\/json" id="editor-data">([\s\S]*?)<\/script>/u,
  );
  assert.ok(match?.[1]);
  const payload = JSON.parse(match[1]);
  recovery.mutatePayload?.(payload);
  const storage = recovery.storage === undefined ? recoveryStorage() : recovery.storage;
  let focused = "";
  let scrollPosition = 0;
  const scrolledIntoView: string[] = [];
  const pageListeners = new Map<string, () => void>();
  let animationFrames: (() => void)[] = [];
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
    focus(_options?: { preventScroll?: boolean }) {
      focused = this.id;
    }
    scrollIntoView() {
      scrolledIntoView.push(this.id);
      scrollPosition = 0;
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
  node("editor-data").textContent = JSON.stringify(payload);
  for (const id of [
    "editor-fields",
    "download-controls",
    "download-script",
    "download-status",
    "produce-script",
    "produce-progress-box",
    "produce-progress-bar",
    "produce-progress-text",
    "produce-result",
    "draft-count",
    "production-voice-summary",
    "draft-errors",
    "produce-command",
    "review-changes",
    "review-changes-summary",
    "review-changes-count",
    "review-changes-list",
    "draft-recovery",
    "draft-recovery-message",
    "resume-draft",
    "discard-draft",
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
    if (typeof speaker.voice === "string") node(`speaker-voice-setup-${index}`);
    node(`speaker-avatar-mode-${index}`, speaker.avatar?.mode ?? "illustrated");
    node(`speaker-avatar-photo-panel-${index}`);
    const imageSelect = node(`speaker-avatar-image-${index}`, speaker.avatar?.imageId ?? "");
    if (recovery.nativePhotoSelect) {
      let selectedImage = imageSelect.value;
      Object.defineProperty(imageSelect, "value", {
        get: () => selectedImage,
        set: (value: string) => {
          selectedImage = [...imageSelect.options, ...imageSelect.children].some(
            (option) => option.value === value,
          )
            ? value
            : "";
        },
      });
    }
    node(`speaker-avatar-motion-style-${index}`, speaker.avatar?.motion?.style ?? "conversational");
    node(
      `speaker-avatar-motion-intensity-${index}`,
      String(speaker.avatar?.motion?.intensity ?? 0.7),
    );
    node(
      `speaker-avatar-geometry-${index}`,
      JSON.stringify({
        mouthAngle: speaker.avatar?.mouthAngle,
        mouthAspect: speaker.avatar?.mouthAspect,
        calibration: speaker.avatar?.calibration,
        animation: speaker.avatar?.animation,
        motion: speaker.avatar?.motion,
      }),
    );
    node(`speaker-avatar-mouth-y-${index}`, String(speaker.avatar?.mouthY ?? 0.68));
    node(`speaker-avatar-mouth-x-${index}`, String(speaker.avatar?.mouthX ?? 0.5));
    node(`speaker-avatar-mouth-scale-${index}`, String(speaker.avatar?.mouthScale ?? 1));
    node(`speaker-avatar-mouth-y-val-${index}`);
    node(`speaker-avatar-mouth-x-val-${index}`);
    node(`speaker-avatar-mouth-scale-val-${index}`);
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
  const context = {
    TextEncoder,
    addEventListener: (name: string, handler: () => void) => pageListeners.set(name, handler),
    requestAnimationFrame: (handler: () => void) => animationFrames.push(handler),
    location: {
      origin: "http://localhost:4173",
      pathname: recovery.pathname ?? `/episodes/${selector}/edit.html`,
    },
    get sessionStorage() {
      if (recovery.blockedAccess) throw new Error("Blocked browser storage");
      return storage;
    },
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
  };
  runInNewContext(
    await readFile(resolve(projectRoot, "templates/script-editor.js"), "utf8"),
    context,
  );
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
    writingEditor: (
      context as unknown as {
        shortsWritingEditor: {
          snapshot(): WritingSnapshot;
          apply(proposal: WritingProposal, expected: WritingSnapshot): void;
        };
      }
    ).shortsWritingEditor,
    get,
    update,
    download,
    downloads,
    changes,
    descendants,
    restore,
    focused: () => focused,
    seed: payload.seed,
    payload,
    storage,
    pageshow: () => pageListeners.get("pageshow")?.(),
    restoreScroll: (value: number) => {
      scrollPosition = value;
    },
    scrollPosition: () => scrollPosition,
    scrolledIntoView,
    animationFrame: () => {
      const callbacks = animationFrames;
      animationFrames = [];
      for (const callback of callbacks) callback();
    },
  };
}

test("the actual workshop script downloads validated solo/dialogue revisions and derives exact turn narration", async () => {
  for (const selector of ["CAP-02@quiz", "CAP-01@casual-v2", "CAP-01@duo"]) {
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
    assert.deepEqual(
      checked.episode.pronunciation,
      (await readContentEpisode(selector)).pronunciation,
    );
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

test("a downloaded pronunciation revision imports intact and changes the speech identity without changing captions", async (t) => {
  const original = await readContentEpisode("CAP-01@casual-v2");
  const ui = await workshop("CAP-01@casual-v2");
  ui.get("variant-name").value = "pronunciation-review";
  ui.update();
  ui.download();
  const draft = JSON.parse(ui.downloads[0]?.parts.join("") ?? "null");
  const directory = await mkdtemp(resolve(tmpdir(), "sap-workshop-pronunciation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = resolve(directory, "download.json");
  const presentationDirectory = resolve(directory, "presentations");
  await mkdir(presentationDirectory);
  await writeFile(input, JSON.stringify(draft));
  const result = await importScript(input, { presentationDirectory });
  assert.deepEqual(result.episode.pronunciation, original.pronunciation);
  assert.deepEqual(result.episode.scenes, original.scenes);
  const request = {
    provider: "local-kokoro",
    generatorHash: hash("generator"),
    voiceRuntimeHash: hash("runtime"),
    settings: await productionSettings(),
    episode: result.episode,
  } as MediaRequest;
  const changed = structuredClone(request);
  changed.episode.pronunciation.API = "ay pee eye";
  assert.notEqual(narrationIdentity(request), narrationIdentity(changed));
  assert.deepEqual(changed.episode.scenes, request.episode.scenes);
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
  assert.match(ui.get("speaker-voice-0-help").textContent, /Install this voice using the button/u);
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
  assert.match(ui.get("speaker-voice-0-help").textContent, /Install this voice using the button/u);
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

test("same-tab recovery automatically restores editable raw solo, dialogue and news fields", async () => {
  for (const selector of ["CAP-02", "CAP-01@duo", "NEWS-02@duo"]) {
    const storage = recoveryStorage();
    const first = await workshop(selector, undefined, { storage });
    const narration = selector.includes("duo") ? "turn-0-0" : "narration-0";
    first.get("variant-name").value = " recovered-version ";
    first.get("draft-title").value = " Raw <title> ";
    first.get("publication-text").value = " A revised post.\n\nKeep this line. ";
    first.get(narration).value = "  Check your access.\n";
    first.get("overlay-0").value = " Raw <headline> ";
    first.get("speaker-voice-0").value = "am_michael";
    if (selector.includes("duo")) first.get("speaker-voice-1").value = "af_heart";
    first.update();
    assert.equal(storage.data.size, 1);
    const saved = JSON.parse([...storage.data.values()][0] ?? "null");
    const second = await workshop(selector, undefined, { storage });
    assert.equal(second.get("editor-fields").disabled, false);
    assert.equal(second.get("download-controls").hidden, false);
    assert.equal(second.get("resume-draft").hidden, true);
    assert.equal(second.get("discard-draft").hidden, false);
    for (const [id, value] of Object.entries(saved.fields))
      assert.equal(second.get(id).value, value);
    assert.notEqual(second.focused(), "resume-draft");
    assert.match(second.get("draft-recovery-message").textContent, /Recovered/u);
    assert.equal(storage.calls.set, 1, "resume does not rewrite the same raw fields");
    second.download();
    const definition = JSON.parse(second.downloads[0]?.parts.join("") ?? "null");
    const checked = await validatePresentationDefinition(definition);
    assert.equal(definition.presentation.variant, "recovered-version");
    assert.equal(definition.scenes[0].narration, "Check your access.");
    const original = await readContentEpisode(selector);
    assert.deepEqual(checked.episode.sources, original.sources);
    assert.deepEqual(checked.episode.claims, original.claims);
    if (isNewsEpisode(original)) {
      assert.ok(isNewsEpisode(checked.episode));
      assert.deepEqual(checked.episode.news, original.news);
    }
  }
});

test("recovery retains invalid text and duplicate voices without bypassing download guards", async () => {
  const storage = recoveryStorage();
  const first = await workshop("NEWS-02@duo", undefined, { storage });
  first.get("variant-name").value = "taken";
  first.get("turn-0-0").value = "   ";
  first.get("speaker-voice-0").value = "am_michael";
  first.update();
  const second = await workshop("NEWS-02@duo", undefined, { storage });
  second.get("resume-draft").click();
  assert.equal(second.get("turn-0-0").value, "   ");
  assert.equal(second.get("download-script").disabled, true);
  assert.match(second.get("draft-errors").textContent, /already exists/u);
  assert.match(second.get("draft-errors").textContent, /different voice/u);
  assert.match(second.get("draft-errors").textContent, /needs text/u);
  second.download();
  assert.equal(second.downloads.length, 0);
  second.restore("Restore scene 1");
  assert.equal(second.get("download-script").disabled, true);
  second.restore("Restore starting voices");
  second.get("variant-name").value = "recovered-news";
  second.update();
  second.download();
  assert.equal(second.downloads.length, 1);
  await validatePresentationDefinition(JSON.parse(second.downloads[0]?.parts.join("") ?? "null"));
});

test("recovery rejects damaged, oversized, stale and injected records without altering the starting script", async () => {
  const storage = recoveryStorage();
  const original = await workshop("CAP-02", undefined, { storage });
  original.get("draft-title").value = "A saved draft";
  original.update();
  const key = [...storage.data.keys()][0];
  assert.ok(key);
  const valid = JSON.parse(storage.data.get(key) ?? "null");
  const cases = [
    "{broken",
    "[]",
    "null",
    JSON.stringify({ ...valid, recoveryId: "0".repeat(64) }),
    JSON.stringify({ ...valid, schemaVersion: 2 }),
    JSON.stringify({ ...valid, claims: ["injected"] }),
    JSON.stringify({ ...valid, fields: { ...valid.fields, baseInputHash: "injected" } }),
    JSON.stringify({ ...valid, fields: { ...valid.fields, "draft-title": 123 } }),
    JSON.stringify({ ...valid, fields: { ...valid.fields, "speaker-voice-0": "af_bella" } }),
    JSON.stringify({ ...valid, fields: { ...valid.fields, "draft-title": "😀".repeat(40000) } }),
  ];
  const missing = structuredClone(valid);
  delete missing.fields["overlay-0"];
  cases.push(JSON.stringify(missing));
  for (const saved of cases) {
    storage.data.set(key, saved);
    const ui = await workshop("CAP-02", undefined, { storage });
    assert.equal(ui.get("draft-title").value, original.seed.title);
    assert.equal(ui.get("editor-fields").disabled, false);
    assert.equal(ui.get("download-controls").hidden, false);
    assert.match(ui.get("draft-recovery-message").textContent, /ignored/u);
    assert.equal(storage.data.has(key), false);
    ui.download();
    assert.equal(ui.downloads.length, 1);
  }
  storage.data.set(key, JSON.stringify(valid));
  const changedAddress = await workshop("CAP-02", undefined, {
    storage,
    pathname: "/other/edit.html",
  });
  assert.equal(changedAddress.get("draft-title").value, original.seed.title);
  assert.equal(changedAddress.get("editor-fields").disabled, false);
  const changedContext = await workshop("CAP-02", ["af_heart"], { storage });
  assert.notEqual(changedContext.payload.recoveryId, original.payload.recoveryId);
  assert.equal(changedContext.get("draft-title").value, original.seed.title);
  assert.equal(changedContext.get("editor-fields").disabled, false);
  assert.equal(
    storage.data.get(key),
    JSON.stringify(valid),
    "another scope cannot consume the saved draft",
  );
});

test("browser storage absence and get/set/remove failures leave editing and downloads usable", async () => {
  const bad = () => {
    throw new Error("Storage blocked or full");
  };
  for (const options of [
    { storage: null },
    { blockedAccess: true },
    { storage: {} as RecoveryStorage },
    { storage: { getItem: bad, setItem: bad, removeItem: bad } },
    { storage: { getItem: () => null, setItem: bad, removeItem: bad } },
    { storage: { getItem: () => "{broken", setItem: bad, removeItem: bad } },
  ]) {
    const ui = await workshop("CAP-02", undefined, options);
    ui.get("variant-name").value = "storage-unavailable";
    ui.update();
    ui.download();
    assert.equal(ui.get("editor-fields").disabled, false);
    assert.equal(ui.downloads.length, 1);
    assert.match(ui.get("draft-recovery-message").textContent, /unavailable/u);
  }
  const store = recoveryStorage();
  const first = await workshop("CAP-02", undefined, { storage: store });
  first.get("draft-title").value = "Saved";
  first.update();
  const brokenRemove = { ...store, removeItem: bad };
  const second = await workshop("CAP-02", undefined, { storage: brokenRemove });
  second.get("discard-draft").click();
  assert.equal(second.get("draft-title").value, first.seed.title);
  assert.equal(second.get("editor-fields").disabled, false);
  assert.match(second.get("draft-recovery-message").textContent, /unavailable/u);
  second.download();
  assert.equal(second.downloads.length, 1);
});

test("recovery writes and announcements stay stable, discard clears only this draft, and unsafe current fields clear stale recovery", async () => {
  const storage = recoveryStorage();
  storage.data.set("unrelated", "keep");
  const ui = await workshop("CAP-02", undefined, { storage });
  assert.equal(storage.calls.set, 0, "opening an unchanged script creates no draft");
  ui.get("draft-title").value = "Saved title";
  ui.update();
  const announcements = ui.get("draft-recovery-message").textUpdates;
  ui.update();
  ui.get("editor-fields").listeners.get("change")?.();
  ui.download();
  assert.equal(storage.calls.set, 1);
  assert.equal(ui.get("draft-recovery-message").textUpdates, announcements);
  const reload = await workshop("CAP-02", undefined, { storage });
  reload.get("discard-draft").click();
  assert.equal(reload.get("draft-title").value, ui.seed.title);
  assert.equal(reload.get("variant-name").value, ui.seed.presentation.variant);
  assert.deepEqual([...storage.data], [["unrelated", "keep"]]);
  assert.equal(reload.focused(), "variant-name");
  reload.get("draft-title").value = "New draft";
  reload.update();
  assert.equal(storage.data.size, 2);
  reload.get("publication-text").value = "😀".repeat(40000);
  reload.update();
  assert.deepEqual([...storage.data], [["unrelated", "keep"]]);
  assert.equal(reload.get("publication-text").value.length, 80000);
  assert.match(reload.get("draft-recovery-message").textContent, /cannot be kept/u);
  reload.restore("Restore post");
  assert.equal(storage.data.size, 2, "a corrected draft becomes recoverable again");
  reload.get("speaker-voice-0").value = "injected-voice";
  reload.update();
  assert.deepEqual([...storage.data], [["unrelated", "keep"]]);
  reload.restore("Restore starting voices");
  reload.restore("Restore title");
  assert.deepEqual(
    [...storage.data],
    [["unrelated", "keep"]],
    "returning all fields to the start removes recovery",
  );
});

test("a reordered baseline record is cleared instead of falsely offering recovery", async () => {
  const storage = recoveryStorage();
  const ui = await workshop("CAP-02", undefined, { storage });
  ui.get("draft-title").value = "A changed title";
  ui.update();
  const key = [...storage.data.keys()][0];
  assert.ok(key);
  const record = JSON.parse(storage.data.get(key) ?? "null");
  record.fields["draft-title"] = ui.seed.title;
  record.fields = Object.fromEntries(Object.entries(record.fields).reverse());
  storage.data.set(key, JSON.stringify(record));
  const next = await workshop("CAP-02", undefined, { storage });
  assert.equal(next.get("editor-fields").disabled, false);
  assert.equal(next.get("draft-title").value, ui.seed.title);
  assert.equal(storage.data.size, 0);
});

test("automatic recovery preserves restored scroll and focus while offering an editable undo", async () => {
  const storage = recoveryStorage();
  const first = await workshop("CAP-02", undefined, { storage });
  first.get("publication-text").value = "A post edited near the bottom of the page.";
  first.update();
  const pending = await workshop("CAP-02", undefined, { storage });
  assert.equal(pending.get("editor-fields").disabled, false);
  pending.pageshow();
  pending.restoreScroll(4049);
  pending.animationFrame();
  assert.equal(pending.scrollPosition(), 4049);
  pending.animationFrame();
  assert.equal(pending.scrollPosition(), 4049);
  assert.deepEqual(pending.scrolledIntoView, []);
  assert.notEqual(pending.focused(), "resume-draft");
  for (const choice of ["resume-draft", "discard-draft"]) {
    first.update();
    // Preserve a valid saved record for both independent navigation cases.
    if (!storage.data.size) {
      first.get("draft-title").value = "Another change";
      first.update();
    }
    const quickChoice = await workshop("CAP-02", undefined, { storage });
    quickChoice.pageshow();
    quickChoice.get(choice).click();
    quickChoice.get("publication-text").focus();
    quickChoice.restoreScroll(4000);
    quickChoice.animationFrame();
    quickChoice.animationFrame();
    assert.equal(quickChoice.scrollPosition(), 4000);
    assert.equal(quickChoice.focused(), "publication-text");
    assert.deepEqual(quickChoice.scrolledIntoView, []);
    quickChoice.pageshow();
    quickChoice.animationFrame();
    quickChoice.animationFrame();
    assert.equal(
      quickChoice.scrollPosition(),
      4000,
      "later pageshow preserves ordinary editor position",
    );
  }
  const original = await workshop("CAP-02");
  original.get("publication-text").focus();
  original.restoreScroll(3900);
  original.pageshow();
  original.animationFrame();
  original.animationFrame();
  assert.equal(original.scrollPosition(), 3900);
  assert.equal(original.focused(), "publication-text");
});

test("workshop allows enhancing pronunciations and saves overrides to downloadable draft", async () => {
  const ui = await workshop("NEWS-01");
  ui.get("variant-name").value = "custom-pronounce";
  ui.update();
  ui.download();
  assert.equal(ui.get("download-script").disabled, false);
  const draft = JSON.parse(ui.downloads[0]?.parts.join("") ?? "null");
  const checked = await validatePresentationDefinition(draft);
  assert.equal(checked.episode.pronunciation.SAP, "S.A.P.");
  assert.equal(checked.episode.pronunciation.Signavio, "Signavio");
});

test("workshop configures custom photo avatar with mouth calibration and validates missing photo selection", async () => {
  const ui = await workshop("CAP-01@duo");
  ui.get("variant-name").value = "photo-avatar-duo";
  assert.equal(ui.get("speaker-avatar-photo-panel-0").hidden, true);

  // Switch speaker 0 to photo mode without selecting an image -> should block download
  ui.get("speaker-avatar-mode-0").value = "photo";
  ui.update();
  assert.equal(ui.get("speaker-avatar-photo-panel-0").hidden, false);
  assert.equal(ui.get("download-script").disabled, true);
  assert.match(ui.get("draft-errors").textContent, /photo avatar for Mira/u);

  // Provide valid imageId and calibrate mouth coordinates
  ui.get("speaker-avatar-image-0").value = "mira-portrait.png";
  ui.get("speaker-avatar-mouth-y-0").value = "0.71";
  ui.get("speaker-avatar-mouth-x-0").value = "0.49";
  ui.get("speaker-avatar-mouth-scale-0").value = "1.15";
  ui.update();
  assert.equal(ui.get("download-script").disabled, false);
  assert.equal(ui.changes().length, 1);
  assert.match(ui.get("review-changes-list").textContent, /mira-portrait\.png/u);

  ui.download();
  assert.equal(ui.downloads.length, 1);
  const draft = JSON.parse(ui.downloads[0]?.parts.join("") ?? "null");
  const checked = await validatePresentationDefinition(draft);
  assert.deepEqual(checked.episode.presentation?.speakers[0]?.avatar, {
    mode: "photo",
    imageId: "mira-portrait.png",
    mouthX: 0.49,
    mouthY: 0.71,
    mouthScale: 1.15,
  });
  assert.equal(checked.episode.presentation?.speakers[1]?.avatar, undefined);

  // Restore starting avatars
  ui.restore("Restore starting avatars");
  assert.equal(ui.get("speaker-avatar-mode-0").value, "illustrated");
  assert.equal(ui.get("speaker-avatar-photo-panel-0").hidden, true);
  assert.equal(ui.changes().length, 0);
});

test("automatic mouth calibration survives download, import and tab recovery", async () => {
  const { faceModelSha, faceDetectorVersion } = await import("../src/media/face-assets.js");
  const metadata = {
    mouthAngle: 0.12,
    mouthAspect: 0.32,
    calibration: {
      imageSha256: "a".repeat(64),
      modelSha256: faceModelSha,
      detector: faceDetectorVersion,
    },
  };
  const storage = recoveryStorage();
  const ui = await workshop("CAP-01@duo", undefined, { storage });
  ui.get("variant-name").value = "detected-mouth";
  ui.get("speaker-avatar-mode-0").value = "photo";
  ui.get("speaker-avatar-image-0").value = "mira-portrait.png";
  ui.get("speaker-avatar-mouth-x-0").value = "0.461";
  ui.get("speaker-avatar-geometry-0").value = JSON.stringify(metadata);
  ui.update();
  const resumed = await workshop("CAP-01@duo", undefined, { storage, nativePhotoSelect: true });
  const select = resumed.get("speaker-avatar-image-0");
  assert.equal(select.value, "mira-portrait.png");
  resumed.download();
  const draft = JSON.parse(resumed.downloads[0]?.parts.join("") ?? "null");
  const checked = await validatePresentationDefinition(draft);
  const avatar = checked.episode.presentation?.speakers[0]?.avatar;
  assert.equal(avatar?.mouthX, 0.461);
  assert.deepEqual(avatar?.calibration, metadata.calibration);
  assert.equal(avatar?.mouthAngle, metadata.mouthAngle);
  assert.equal(avatar?.mouthAspect, metadata.mouthAspect);
  resumed.restore("Restore starting avatars");
  assert.equal(resumed.get("speaker-avatar-geometry-0").value, "{}");

  // Verify full-face and neural animation modes + faceLandmarks persist through download & validation
  const fullFaceMeta = {
    animation: "full-face",
    motion: { style: "calm", intensity: 0.4, seed: 17 },
    mouthAngle: 0.05,
    mouthAspect: 0.35,
    faceLandmarks: {
      leftEye: [0.38, 0.42, 0.055, 0.024],
      rightEye: [0.62, 0.42, 0.055, 0.024],
      jawY: 0.84,
      faceX: 0.5,
      faceY: 0.54,
      faceRx: 0.24,
      faceRy: 0.31,
    },
    calibration: metadata.calibration,
  };
  resumed.get("speaker-avatar-mode-0").value = "photo";
  resumed.get("speaker-avatar-image-0").value = "mira-portrait.png";
  resumed.get("speaker-avatar-geometry-0").value = JSON.stringify(fullFaceMeta);
  resumed.update();
  resumed.download();
  const fullFaceDraft = JSON.parse(resumed.downloads.at(-1)?.parts.join("") ?? "null");
  const checkedFullFace = await validatePresentationDefinition(fullFaceDraft);
  const savedAvatar = checkedFullFace.episode.presentation?.speakers[0]?.avatar;
  assert.equal(savedAvatar?.animation, "full-face");
  assert.deepEqual(savedAvatar?.motion, fullFaceMeta.motion);
  assert.deepEqual(savedAvatar?.faceLandmarks, fullFaceMeta.faceLandmarks);
  const invalidMotion = structuredClone(fullFaceDraft);
  invalidMotion.presentation.speakers[0].avatar.motion.intensity = 1.5;
  await assert.rejects(validatePresentationDefinition(invalidMotion));
});

test("personal voice references survive recovery before the asynchronous profile catalog loads", async () => {
  const storage = recoveryStorage();
  const first = await workshop("CAP-01@casual-v2", ["af_heart"], { storage });
  const reference = `qwen:12345678-1234-4234-8234-123456789abc:${"a".repeat(64)}`;
  first.get("speaker-voice-0").value = reference;
  first.get("draft-title").value = "Keep my personal voice draft";
  first.update();
  assert.equal(storage.data.size, 1);
  const restored = await workshop("CAP-01@casual-v2", ["af_heart"], { storage });
  assert.equal(restored.get("resume-draft").hidden, true);
  assert.equal(restored.get("editor-fields").disabled, false);
  assert.equal(restored.get("speaker-voice-0").value, reference);
  restored.download();
  const definition = JSON.parse(restored.downloads[0]?.parts.join("") ?? "null");
  assert.equal(definition.schemaVersion, 2);
  assert.equal(
    definition.presentation.speakers[0].voice.profileId,
    "12345678-1234-4234-8234-123456789abc",
  );
  await validatePresentationDefinition(definition);
});

test("AI wording applies through the actual editor while retaining version, companion post, voices and portrait controls", async () => {
  for (const selector of ["CAP-01@casual-v2", "CAP-01@duo"]) {
    const ui = await workshop(selector);
    ui.get("variant-name").value = "keep-my-new-version";
    ui.get("publication-text").value = "My companion post stays here.";
    ui.get("speaker-voice-0").value = "am_michael";
    if (ui.seed.presentation.speakers.length > 1) ui.get("speaker-voice-1").value = "af_heart";
    ui.get("speaker-avatar-mode-0").value = "photo";
    ui.get("speaker-avatar-image-0").value = "private-headshot.png";
    ui.get("speaker-avatar-mouth-y-0").value = "0.63";
    const current = ui.writingEditor.snapshot();
    assert.doesNotMatch(
      JSON.stringify(current),
      /private-headshot|am_michael|publication|voice|avatar/u,
    );
    const proposal = structuredClone(current);
    proposal.title = "A clearer story";
    const opening = proposal.scenes[0];
    assert.ok(opening);
    opening.texts[0] = "Where did the API go?";
    opening.overlay = "Find the service";
    ui.writingEditor.apply(proposal, current);
    assert.equal(ui.get("draft-title").value, proposal.title);
    assert.equal(ui.get("variant-name").value, "keep-my-new-version");
    assert.equal(ui.get("publication-text").value, "My companion post stays here.");
    assert.equal(ui.get("speaker-voice-0").value, "am_michael");
    assert.equal(ui.get("speaker-avatar-image-0").value, "private-headshot.png");
    assert.equal(ui.get("speaker-avatar-mouth-y-0").value, "0.63");
    assert.equal(ui.get("overlay-0").value, "Find the service");
    const field = ui.seed.scenes[0].dialogue ? "turn-0-0" : "narration-0";
    assert.equal(ui.get(field).value, "Where did the API go?");
  }
});

test("AI Apply rejects stale or malformed proposals atomically rather than overwriting newer editor text", async () => {
  const ui = await workshop("CAP-01@casual-v2");
  const before = ui.writingEditor.snapshot();
  const proposal = structuredClone(before);
  proposal.title = "An older proposal";
  ui.get("narration-0").value = "My newer opening.";
  assert.throws(() => ui.writingEditor.apply(proposal, before), /script changed/u);
  assert.equal(ui.get("narration-0").value, "My newer opening.");
  assert.equal(ui.get("draft-title").value, before.title);
  const current = ui.writingEditor.snapshot();
  const broken = structuredClone(current);
  const last = broken.scenes.at(-1);
  assert.ok(last);
  last.texts.push("An extra speaker slot");
  assert.throws(() => ui.writingEditor.apply(broken, current), /speaker turns/u);
  assert.equal(ui.get("draft-title").value, current.title);
});
