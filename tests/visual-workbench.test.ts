import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { advancedVisualPanel } from "../src/editorial/visual-panel.js";

type Design = {
  theme: string;
  background?: string;
  motion: string;
  effect?: string;
  scenes: Array<{
    id: string;
    headline: string;
    emphasis: string;
    composition?: { kind: string; items: Array<{ label: string }> };
  }>;
};
async function workbench(initialDesign?: Design) {
  type Event = { target?: Node; key?: string; preventDefault?(): void };
  class Node {
    value = "";
    textContent = "";
    src = "";
    hidden = false;
    disabled = false;
    open = true;
    tabIndex = 0;
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    listeners = new Map<string, (event: Event) => unknown>();
    options: Node[] = [];
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value);
    }
    addEventListener(type: string, action: (event: Event) => unknown) {
      this.listeners.set(type, action);
    }
    append(option: Node) {
      this.options.push(option);
    }
    replaceChildren() {
      this.options = [];
    }
    focus() {}
    contains(target?: Node) {
      return target !== nodes.get("editor-fields");
    }
    querySelectorAll(selector: string) {
      return selector === "[data-visual-background]" ? backgrounds : tabs;
    }
    constructor(readonly id = "") {}
  }
  const nodes = new Map<string, Node>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Node(id));
    return nodes.get(id) as Node;
  };
  const root = get("root");
  const backgrounds = ["classic", "aurora", "spotlight"].map((value) => {
    const node = new Node();
    node.dataset.visualBackground = value;
    return node;
  });
  const tabs = ["look", "layout", "image"].map((value) => {
    const node = new Node();
    node.dataset.visualTab = value;
    return node;
  });
  for (const [id, value] of Object.entries({ "visual-scene": "0", "visual-progress": "0.5" }))
    get(id).value = value;
  for (const value of ["card", "background"]) {
    const node = new Node();
    node.value = value;
    get("visual-image-treatment").options.push(node);
  }
  const initial = {
    title: "A story",
    scenes: ["hook", "context"].map((id) => ({ id, overlay: id, texts: ["Words"] })),
  };
  let draft: typeof initial & { design?: Design } = {
    ...structuredClone(initial),
    ...(initialDesign ? { design: initialDesign } : {}),
  };
  let applications = 0;
  const requests: Array<{
    body: {
      definition: { presentation: { design?: Design } };
      sceneIndex: number;
      progress: number;
    };
    resolve: (response: unknown) => void;
  }> = [];
  const timers = new Map<number, () => unknown>();
  let nextTimer = 0;
  const events = new Map<string, () => void>();
  get("editor-data").textContent = JSON.stringify({
    seed: initial,
    compositionSceneIds: ["hook", "context"],
    visualOutputSceneIds: [],
  });
  runInNewContext(await readFile("templates/advanced-visuals.js", "utf8"), {
    structuredClone,
    document: { querySelector: () => root, getElementById: get, createElement: () => new Node() },
    addEventListener: (name: string, action: () => void) => events.set(name, action),
    shortsWritingEditor: {
      context: { selector: "CAP-01" },
      snapshot: () => structuredClone(draft),
      previewDesign: (design: Design | undefined, before: unknown) => {
        assert.equal(JSON.stringify(before), JSON.stringify(draft));
        return {
          draft: { presentation: { ...(design ? { design: structuredClone(design) } : {}) } },
          issues: { script: [], post: [] },
          errors: [],
        };
      },
      applyDesign: (design: Design, before: unknown) => {
        assert.equal(JSON.stringify(before), JSON.stringify(draft));
        applications++;
        draft = { ...draft, design: structuredClone(design) };
        events.get("shorts:design-applied")?.();
      },
    },
    setTimeout: (action: () => unknown) => {
      timers.set(++nextTimer, action);
      return nextTimer;
    },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: async (path: string, input?: { body: string }) => {
      if (path.endsWith("session")) return { ok: true };
      if (path.endsWith("visual-assets")) return { ok: true, json: async () => ({ assets: [] }) };
      assert.ok(path.endsWith("visual-preview"));
      return new Promise((resolve) =>
        requests.push({ body: JSON.parse(input?.body ?? "null"), resolve }),
      );
    },
  });
  const settle = async () => {
    for (let index = 0; index < 15; index++) await Promise.resolve();
  };
  const runTimer = async () => {
    const [id, action] = [...timers][0] ?? [];
    assert.ok(id && action, "a preview is scheduled");
    timers.delete(id);
    action();
    await settle();
  };
  const input = async (id: string, value: string) => {
    get(id).value = value;
    root.listeners.get("input")?.({ target: get(id) });
    await settle();
  };
  const click = async (node: Node) => {
    node.listeners.get("click")?.({ target: node });
    await settle();
  };
  const answer = async (index: number, image: string, error?: string) => {
    requests[index]?.resolve({
      ok: !error,
      json: async () => (error ? { error } : { imageDataUrl: image, note: "Planned frame." }),
    });
    await settle();
  };
  await settle();
  return {
    get,
    root,
    requests,
    runTimer,
    input,
    click,
    answer,
    backgrounds,
    applications: () => applications,
    draft: () => draft,
    async scene(index: number) {
      get("visual-scene").value = String(index);
      root.listeners.get("change")?.({ target: get("visual-scene") });
      await settle();
    },
  };
}

test("live preview keeps automatic defaults, coalesces edits and discards stale frames without applying", async () => {
  const ui = await workbench();
  await ui.runTimer();
  assert.equal(ui.requests[0]?.body.definition.presentation.design, undefined);
  assert.equal(ui.get("visual-apply").disabled, true);
  await ui.input("visual-theme", "ocean");
  await ui.click(ui.backgrounds[1] as (typeof ui.backgrounds)[number]);
  await ui.runTimer();
  assert.equal(ui.requests.length, 1, "only one local frame can be in flight");
  await ui.answer(0, "old-auto-frame");
  assert.notEqual(ui.get("visual-frame-image").src, "old-auto-frame");
  await ui.runTimer();
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.requests[1]?.body.definition.presentation.design?.theme, "ocean");
  assert.equal(ui.requests[1]?.body.definition.presentation.design?.background, "aurora");
  await ui.answer(1, "latest-frame");
  assert.equal(ui.get("visual-frame-image").src, "latest-frame");
  assert.equal(ui.applications(), 0);
  assert.equal(ui.draft().design, undefined);
  assert.match(ui.get("visual-draft-state").textContent, /not applied/);
  await ui.click(ui.get("visual-apply"));
  assert.equal(ui.applications(), 1);
  assert.equal(ui.draft().design?.background, "aurora");
  assert.equal(ui.get("visual-draft-state").textContent, "Current draft");
});

test("pending layouts survive scene navigation and invalid edits leave the last frame marked stale", async () => {
  const ui = await workbench();
  await ui.runTimer();
  await ui.answer(0, "good-frame");
  await ui.input("visual-layout", "flow");
  await ui.input("visual-labels", "Model\nService\nEndpoint");
  await ui.scene(1);
  await ui.input("visual-layout", "comparison");
  await ui.input("visual-labels", "Before\nAfter");
  await ui.scene(0);
  assert.equal(ui.get("visual-labels").value, "Model\nService\nEndpoint");
  await ui.runTimer();
  await ui.answer(1, "flow-frame");
  assert.equal(
    ui.requests[1]?.body.definition.presentation.design?.scenes[1]?.composition?.kind,
    "comparison",
  );
  await ui.input("visual-progress", "0.85");
  await ui.runTimer();
  assert.equal(ui.requests[2]?.body.progress, 0.85);
  await ui.answer(2, "late-frame");
  assert.equal(ui.draft().design, undefined);
  await ui.click(ui.get("visual-refresh"));
  await ui.runTimer();
  await ui.answer(3, "reset-frame");
  assert.equal(ui.get("visual-layout").value, "automatic");
  assert.equal(ui.get("visual-apply").disabled, true);
  assert.equal(ui.requests[3]?.body.definition.presentation.design, undefined);
  await ui.input("visual-layout", "flow");
  await ui.input("visual-labels", "One label");
  await ui.runTimer();
  await ui.answer(4, "", "Use two to four layout labels.");
  assert.equal(ui.get("visual-frame-image").src, "reset-frame");
  assert.match(ui.get("visual-preview-status").textContent, /two to four/);
  assert.equal(ui.get("visual-render-state").hidden, false);
  assert.equal(ui.draft().design, undefined);
});

test("visual workbench exposes keyboard tabs, a stable preview and explicit draft application", () => {
  const html = advancedVisualPanel();
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-controls="visual-panel-image"/);
  assert.match(html, /id="visual-progress"/);
  assert.match(html, /Apply to draft/);
  assert.ok(
    html.indexOf("visual-preview-pane") < html.indexOf("visual-settings-pane"),
    "phone preview precedes controls on narrow layouts",
  );
});

test("opening a saved custom design does not mark key order or omitted defaults as edits", async () => {
  const design: Design = {
    theme: "ocean",
    motion: "smooth",
    scenes: ["hook", "context"].map((id) => ({
      emphasis: "balanced",
      headline: id,
      id,
      ...(id === "hook"
        ? { composition: { items: [{ label: "Model" }, { label: "Service" }], kind: "flow" } }
        : {}),
    })),
  };
  const ui = await workbench(design);
  await ui.runTimer();
  await ui.answer(0, "saved-frame");
  assert.equal(ui.get("visual-draft-state").textContent, "Current draft");
  assert.equal(ui.get("visual-apply").disabled, true);
  assert.deepEqual(ui.requests[0]?.body.definition.presentation.design, design);
});
