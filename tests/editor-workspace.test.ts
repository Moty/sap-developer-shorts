import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readContentEpisode } from "../src/contracts.js";
import { createScriptEditor } from "../src/script-editor.js";

// Exercise navigation independently of media/model services: hidden fields must remain intact.
async function workspace(hash = "") {
  const nodes: Element[] = [];
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const pageListeners = new Map<string, () => void>();
  let focused = "";
  let step = "";
  let url = "";
  let reviews = 0;
  class Element {
    value = "";
    textContent = "";
    hidden = false;
    disabled = false;
    open = false;
    attributes = new Map<string, string>();
    listeners = new Map<string, () => void>();
    constructor(
      readonly id: string,
      readonly dataset: Record<string, string> = {},
      readonly tagName = "SECTION",
    ) {
      nodes.push(this);
    }
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value);
    }
    removeAttribute(key: string) {
      this.attributes.delete(key);
    }
    matches() {
      return ["INPUT", "TEXTAREA", "BUTTON"].includes(this.tagName);
    }
    closest() {
      return phone;
    }
    scrollIntoView() {}
    focus() {
      focused = this.id;
    }
    contains(target: Element) {
      return this === target;
    }
    getBoundingClientRect() {
      return { height: 76 };
    }
    addEventListener(event: string, callback: () => void) {
      this.listeners.set(event, callback);
    }
    click() {
      if (!this.disabled) this.listeners.get("click")?.();
    }
    querySelector(selector: string): Element | undefined {
      if (selector === ".editor-reference") return reference;
      return nodes.find((node) => node.attributes.has("aria-current"));
    }
    querySelectorAll(selector: string) {
      const keys: Record<string, string> = {
        "[data-editor-pane]": "editorPane",
        "[data-workspace-pane]": "workspacePane",
        ".scene-editor[data-scene-index]": "sceneIndex",
        "[data-editor-step]": "editorStep",
        "[data-editor-target]": "editorTarget",
        "[data-editor-scene]": "editorScene",
      };
      const key = keys[selector];
      assert.ok(key, `Known workspace selector: ${selector}`);
      return nodes.filter((node) => Object.hasOwn(node.dataset, key));
    }
  }
  const root = new Element("root");
  const phone = new Element("phone");
  const reference = new Element("reference");
  const header = new Element("header");
  const id = (name: string) => nodes.find((node) => node.id === name) as Element;
  for (const name of [
    "workspace-title",
    "editor-save-state",
    "editor-validation-state",
    "scene-focus",
    "workspace-version",
    "workspace-total-words",
    "workspace-scene-position",
    "workspace-preview-number",
    "workspace-preview-headline",
    "workspace-preview-caption",
    "editor-outline-toggle",
    "editor-evidence-toggle",
    "editor-evidence",
    "editor-evidence-close",
    "editor-outline",
    "workspace-scene-previous",
    "workspace-scene-next",
    "editor-next",
    "editor-script-start",
    "presentation",
    "voice-heading",
    "companion-post-heading",
    "final-review-heading",
    "download-controls",
    "draft-errors",
  ])
    new Element(name);
  const seed = {
    scenes: [{ id: "hook" }, { id: "context" }, { id: "payoff", dialogue: [{}, {}] }],
  };
  new Element("editor-data").textContent = JSON.stringify({ seed });
  for (const [name, value] of Object.entries({
    "draft-title": "A working API",
    "variant-name": "my-revision",
    "presentation-design": "",
    "publication-text": "My companion post",
    "speaker-voice-0": "personal-voice",
    "speaker-avatar-image-0": "my-photo.png",
    "overlay-0": "Where is the API?",
    "overlay-1": "A service",
    "overlay-2": "Try it",
    "narration-0": "Where is my API?",
    "narration-1": "Expose it through a service.",
    "turn-2-0": "Your turn.",
    "turn-2-1": "Let us try.",
  }))
    new Element(
      name,
      {},
      name.startsWith("narration") || name.startsWith("turn") ? "TEXTAREA" : "INPUT",
    ).value = value;
  const cards = [0, 1, 2].map((index) => {
    new Element(`scene-${index}-heading`);
    new Element(`scene-button-${index}`, { editorScene: String(index) }, "BUTTON");
    return new Element(`card-${index}`, { editorPane: "script", sceneIndex: String(index) });
  });
  for (const [view, pane] of Object.entries({
    details: "script",
    writing: "script",
    scene: "script",
    companion: "review",
    "ai-review": "review",
    produce: "review",
  })) {
    new Element(`view-${view}`, { editorPane: pane, workspacePane: view });
    new Element(`link-${view}`, { editorTarget: view }, "BUTTON");
  }
  new Element("voice-pane", { editorPane: "voice" });
  for (const group of ["script", "voice", "review"])
    new Element(`step-${group}`, { editorStep: group }, "BUTTON");
  const context = {
    document: {
      querySelector: (selector: string) => (selector === ".studio-topbar" ? header : root),
      getElementById: id,
      documentElement: { style: { setProperty() {} } },
      addEventListener: (event: string, callback: (event: Record<string, unknown>) => void) =>
        listeners.set(event, callback),
    },
    history: {
      replaceState: (_state: unknown, _title: string, value: string) => {
        url = value;
      },
    },
    location: { hash },
    addEventListener: (event: string, callback: () => void) => pageListeners.set(event, callback),
    shortsWritingEditor: {
      syncStep: (value: string) => {
        step = value;
      },
    },
    shortsFinalReview: {
      refresh: () => {
        reviews++;
      },
    },
    shortsWorkspace: undefined as unknown as { jumpTo(id: string): boolean; refresh(): void },
  };
  runInNewContext(await readFile("templates/editor-workspace.js", "utf8"), context);
  return {
    id,
    cards,
    nodes,
    context,
    listeners,
    pageListeners,
    status: () => ({ focused, step, url, reviews }),
  };
}

test("focused navigation retains every field and DOM node across scenes, tools, voice and review", async () => {
  const ui = await workspace();
  const fields = ui.nodes.filter((node) => node.value);
  const original = fields.map((node) => node.value);
  assert.deepEqual(
    ui.cards.map((node) => node.hidden),
    [false, true, true],
  );
  assert.equal(ui.id("workspace-scene-previous").disabled, true);
  ui.id("narration-0").value = "Keep this unsaved narration.";
  ui.id("scene-button-2").click();
  assert.deepEqual(
    ui.cards.map((node) => node.hidden),
    [true, true, false],
  );
  assert.equal(ui.id("workspace-scene-next").disabled, true);
  assert.equal(ui.id("workspace-preview-caption").textContent, "Your turn. Let us try.");
  assert.equal(ui.status().focused, "scene-2-heading");
  for (const route of ["details", "writing"]) {
    ui.id(`link-${route}`).click();
    assert.equal(ui.id(`view-${route}`).hidden, false);
    assert.equal(
      ui.cards.every((node) => node.hidden),
      true,
    );
  }
  assert.equal(ui.id("presentation").open, true);
  ui.id("step-voice").click();
  assert.equal(ui.id("voice-pane").hidden, false);
  assert.equal(ui.status().step, "voice");
  ui.id("editor-next").click();
  assert.equal(ui.id("view-companion").hidden, false);
  ui.id("editor-next").click();
  assert.equal(ui.id("view-ai-review").hidden, false);
  ui.id("editor-next").click();
  assert.equal(ui.id("view-produce").hidden, false);
  assert.equal(ui.id("view-companion").hidden, true);
  assert.ok(ui.status().reviews > 0);
  ui.id("step-script").click();
  assert.equal(ui.cards[2]?.hidden, false);
  assert.equal(
    ui.id("narration-0"),
    fields.find((node) => node.id === "narration-0"),
  );
  assert.equal(ui.id("narration-0").value, "Keep this unsaved narration.");
  assert.deepEqual(
    fields.filter((node) => node.id !== "narration-0").map((node) => node.value),
    original.filter((_value, index) => fields[index]?.id !== "narration-0"),
  );
});

test("deep links and validation jumps reveal the right view without breaking field tab navigation", async () => {
  const ui = await workspace("#turn-2-1");
  assert.equal(ui.cards[2]?.hidden, false);
  assert.equal(ui.status().focused, "turn-2-1");
  assert.equal(ui.id("turn-2-1").attributes.has("tabindex"), false);
  ui.context.shortsWorkspace.jumpTo("draft-errors");
  assert.equal(ui.id("view-produce").hidden, false);
  assert.equal(ui.status().focused, "draft-errors");
  ui.context.shortsWorkspace.jumpTo("publication-text");
  assert.equal(ui.id("view-companion").hidden, false);
  assert.equal(ui.context.shortsWorkspace.jumpTo("unknown-section"), false);
  ui.context.location.hash = "#narration-1";
  ui.pageListeners.get("hashchange")?.();
  assert.equal(ui.cards[1]?.hidden, false);
  assert.equal(ui.status().focused, "narration-1");
  const malformed = await workspace("#%E0%A4");
  assert.equal(malformed.cards[0]?.hidden, false);
  assert.equal(malformed.status().step, "script");
});

test("mobile outline and evidence drawer dismiss cleanly and restore keyboard focus", async () => {
  const ui = await workspace();
  ui.id("editor-outline-toggle").click();
  assert.equal(ui.id("editor-outline-toggle").attributes.get("aria-expanded"), "true");
  ui.id("scene-button-1").click();
  assert.equal(ui.id("editor-outline-toggle").attributes.get("aria-expanded"), "false");
  ui.id("editor-evidence-toggle").click();
  assert.equal(ui.id("editor-evidence").hidden, false);
  assert.equal(ui.status().focused, "editor-evidence-close");
  ui.listeners.get("keydown")?.({ key: "Escape" });
  assert.equal(ui.id("editor-evidence").hidden, true);
  assert.equal(ui.status().focused, "editor-evidence-toggle");
});

test("generated editor wires mounted scene cards, exclusive review views and a top action bar", async () => {
  const html = await createScriptEditor(await readContentEpisode("CAP-01@duo"));
  assert.match(html, /data-editor-workspace/u);
  assert.match(html, /class="studio-topbar editor-actionbar"/u);
  assert.equal((html.match(/data-editor-scene="\d+"/gu) ?? []).length, 7);
  assert.equal((html.match(/data-scene-index="\d+"/gu) ?? []).length, 7);
  for (const view of ["details", "writing", "scene", "companion", "ai-review", "produce"])
    assert.ok(html.includes(`data-workspace-pane="${view}"`));
  assert.doesNotMatch(html, /id="editor-jump-target"/u);
  assert.match(html, /id="speaker-avatar-mode-0"/u);
  assert.match(html, /id="speaker-voice-1"/u);
});
