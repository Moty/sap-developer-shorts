import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { projectRoot } from "../src/paths.js";

const script = await readFile(resolve(projectRoot, "templates/library-collections.js"), "utf8");
class Node {
  id = "";
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  children: Node[] = [];
  listeners = new Map<string, (event: { target: Node }) => void>();
  nodes = new Map<string, Node>();
  attributes = new Map<string, string>();
  get options() {
    return this.children;
  }
  addEventListener(name: string, fn: (event: { target: Node }) => void) {
    this.listeners.set(name, fn);
  }
  emit(name: string) {
    this.listeners.get(name)?.({ target: this });
  }
  append(...items: Node[]) {
    this.children = [...this.children.filter((item) => !items.includes(item)), ...items];
  }
  replaceChildren(...items: Node[]) {
    this.children = items;
  }
  querySelectorAll() {
    return [];
  }
  querySelector(selector: string) {
    return this.nodes.get(selector) ?? null;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  focus() {}
  scrollIntoView() {}
  classList = { toggle: (_name: string, _active: boolean) => {} };
}
function select(values: string[]) {
  const node = new Node();
  node.children = values.map((value) => Object.assign(new Node(), { value }));
  node.value = values[0] ?? "";
  return node;
}
function setup(storage = new Map<string, string>(), count = 25) {
  const nodes = new Map<string, Node>();
  for (const suffix of ["search", "status", "empty", "reset"])
    nodes.set(`fixture-${suffix}`, new Node());
  nodes.set("fixture-sort", select(["recent", "oldest", "title", "id", "score", "original"]));
  nodes.set("fixture-size", select(["8", "16", "32"]));
  const root = new Node();
  root.children = Array.from({ length: count }, (_, i) =>
    Object.assign(new Node(), {
      id: `CAP-${i + 1}`,
      textContent: `SAP example ${i + 1}`,
      dataset: {
        selector: `CAP-${i + 1}`,
        title: `Example ${i + 1}`,
        updated: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
        kind: i % 2 ? "news" : "tutorial",
      },
    }),
  );
  const pagers = [new Node(), new Node()];
  for (const pager of pagers) {
    pager.nodes.set("select", select(["1"]));
    for (const direction of ["previous", "next"])
      pager.nodes.set(`[data-page="${direction}"]`, new Node());
  }
  const context = {
    document: {
      getElementById: (id: string) => nodes.get(id),
      querySelectorAll: () => pagers,
      createElement: () => new Node(),
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  runInNewContext(script, context);
  const factory = (
    context as unknown as {
      shortsCollections: {
        create(options: unknown): {
          render(options?: unknown): { page: number; pages: number; count: number };
          reveal(item: Node): void;
        };
      };
    }
  ).shortsCollections;
  let kind = "all";
  const collection = factory.create({
    id: "fixture",
    root,
    label: "shorts",
    match: (item: Node) => kind === "all" || item.dataset.kind === kind,
  });
  const node = (suffix: string) => nodes.get(`fixture-${suffix}`) as Node;
  return {
    nodes,
    pagers,
    root,
    collection,
    node,
    visible: () => root.children.filter((item) => !item.hidden),
    setKind: (value: string) => {
      kind = value;
    },
  };
}

test("long lists are bounded, naturally sorted, and have synchronized accessible page controls", () => {
  const ui = setup();
  assert.equal(ui.visible().length, 8);
  assert.equal(ui.visible()[0]?.id, "CAP-25");
  assert.match(ui.node("status").textContent, /1–8 of 25 shorts/);
  ui.pagers[0]?.querySelector('[data-page="next"]')?.emit("click");
  assert.equal(ui.visible()[0]?.id, "CAP-17");
  assert.equal(ui.pagers[1]?.querySelector("select")?.value, "2");
  ui.node("sort").value = "title";
  ui.node("sort").emit("change");
  assert.equal(ui.visible()[0]?.id, "CAP-1");
  assert.equal(ui.visible()[1]?.id, "CAP-2");
  assert.equal(ui.collection.render().page, 1);
  ui.node("size").value = "16";
  ui.node("size").emit("change");
  assert.equal(ui.visible().length, 16);
  const secondPage = ui.pagers[1]?.querySelector("select");
  assert.ok(secondPage);
  secondPage.value = "2";
  ui.pagers[1]?.querySelector("select")?.emit("change");
  assert.equal(ui.visible().length, 9);
  assert.equal(ui.pagers[0]?.querySelector('[data-page="next"]')?.disabled, true);
});

test("filtering covers the complete list and clamps pages after live updates without resetting an unchanged page", () => {
  const ui = setup();
  const fourthPage = ui.pagers[0]?.querySelector("select");
  assert.ok(fourthPage);
  fourthPage.value = "4";
  ui.pagers[0]?.querySelector("select")?.emit("change");
  assert.equal(ui.collection.render().page, 4);
  assert.equal(ui.collection.render().page, 4, "workflow polling keeps the user's page");
  ui.root.children = ui.root.children.slice(0, 10);
  assert.equal(ui.collection.render().page, 2);
  ui.setKind("news");
  ui.collection.render({ reset: true });
  assert.ok(ui.visible().every((item) => item.dataset.kind === "news"));
  ui.node("search").value = "no such words";
  ui.node("search").emit("input");
  assert.equal(ui.visible().length, 0);
  assert.equal(ui.node("empty").hidden, false);
  assert.ok(
    ui.pagers.every((pager) => pager.hidden),
    "single-page controls stay out of the way",
  );
  ui.node("reset").emit("click");
  assert.equal(ui.node("empty").hidden, true);
  ui.setKind("all");
  ui.node("search").value = "SAP 20";
  ui.node("search").emit("input");
  assert.deepEqual(
    ui.visible().map((item) => item.id),
    ["CAP-20"],
  );
});

test("search, sorting, page size and current page survive returning to a saved library; corrupt preferences are ignored", () => {
  const storage = new Map<string, string>();
  let ui = setup(storage);
  ui.node("sort").value = "title";
  ui.node("sort").emit("change");
  ui.node("search").value = "SAP";
  ui.node("search").emit("input");
  ui.pagers[0]?.querySelector('[data-page="next"]')?.emit("click");
  ui = setup(storage);
  assert.equal(ui.node("search").value, "SAP");
  assert.equal(ui.node("sort").value, "title");
  assert.equal(ui.collection.render().page, 2);
  assert.equal(ui.visible()[0]?.id, "CAP-9");
  storage.set("shorts:collection:fixture", JSON.stringify({ sort: "bad", page: 1e99, size: "0" }));
  ui = setup(storage);
  assert.equal(ui.visible().length, 8);
  assert.equal(ui.collection.render().page, 1);
  storage.set("shorts:collection:fixture", "bad json");
  assert.equal(setup(storage).visible().length, 8);
});

test("newly added drafts are revealed even with a search and a later page selected", () => {
  const ui = setup();
  ui.node("search").value = "25";
  ui.node("search").emit("input");
  const draft = Object.assign(new Node(), {
    id: "NEWS-26",
    textContent: "A new draft",
    dataset: { title: "A new draft" },
  });
  ui.root.children.unshift(draft);
  ui.collection.reveal(draft);
  assert.equal(draft.hidden, false);
  assert.equal(ui.node("search").value, "");
  assert.equal(ui.collection.render().count, 26);
});

test("workspace navigation isolates sections, honors deep links/history, and separates idea collections", async () => {
  const sections = ["episodes", "ideas", "styles", "styles", "voices", "writing"].map((view) =>
    Object.assign(new Node(), { dataset: { workspaceView: view } }),
  );
  const links = ["episodes", "ideas", "styles", "voices", "writing"].map((view) =>
    Object.assign(new Node(), { dataset: { workspaceLink: view } }),
  );
  const panels = ["stories", "drafts", "curated", "tutorials"].map((view) =>
    Object.assign(new Node(), { dataset: { ideaPanel: view } }),
  );
  const tabs = ["stories", "drafts", "curated", "tutorials"].map((view) =>
    Object.assign(new Node(), { dataset: { ideaTab: view } }),
  );
  const nodes = new Map(
    ["workspace-title", "workspace-description", "compare-CAP-01"].map((id) => [id, new Node()]),
  );
  const handlers = new Map<string, () => void>();
  const location = { hash: "#voices" };
  const context = {
    shortsCollections: { create: () => null, read: () => ({}), save() {} },
    document: {
      getElementById: (id: string) => nodes.get(id),
      querySelector: () => sections[0],
      querySelectorAll: (selector: string) =>
        selector === "[data-workspace-view]"
          ? sections
          : selector === "[data-workspace-link]"
            ? links
            : selector === "[data-idea-panel]"
              ? panels
              : selector === "[data-idea-tab]"
                ? tabs
                : [],
      addEventListener() {},
    },
    Event: class {
      constructor(public type: string) {}
    },
    requestAnimationFrame() {},
    window: {
      location,
      scrollTo() {},
      dispatchEvent() {},
      addEventListener: (name: string, handler: () => void) => handlers.set(name, handler),
    },
  };
  runInNewContext(
    await readFile(resolve(projectRoot, "templates/library-navigation.js"), "utf8"),
    context,
  );
  const visible = () =>
    sections.filter((section) => !section.hidden).map((section) => section.dataset.workspaceView);
  assert.deepEqual(visible(), ["voices"]);
  assert.equal(nodes.get("workspace-title")?.textContent, "Voice library");
  assert.equal(links[3]?.attributes.get("aria-current"), "page");
  location.hash = "#tutorial-ideas";
  handlers.get("hashchange")?.();
  assert.deepEqual(visible(), ["ideas"]);
  assert.deepEqual(
    panels.filter((panel) => !panel.hidden).map((panel) => panel.dataset.ideaPanel),
    ["tutorials"],
  );
  location.hash = "#compare-CAP-01";
  handlers.get("popstate")?.();
  assert.deepEqual(visible(), ["styles", "styles"]);
  location.hash = "#episodes";
  handlers.get("hashchange")?.();
  assert.deepEqual(visible(), ["episodes"]);
  for (const alias of ["#settings", "#writing"]) {
    location.hash = alias;
    handlers.get("hashchange")?.();
    assert.deepEqual(visible(), ["writing"], alias);
    assert.equal(nodes.get("workspace-title")?.textContent, "Settings");
    assert.equal(links[4]?.attributes.get("aria-current"), "page");
  }
});
