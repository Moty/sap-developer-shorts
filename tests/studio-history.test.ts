import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { projectRoot } from "../src/paths.js";

test("the actual studio script restores default and explicit styles through browser history", async () => {
  type Click = {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    preventDefault(): void;
  };
  type Handler = (event?: Click) => void;
  const node = (id = "") => ({
    id,
    hash: `#${id}`,
    hidden: false,
    value: "",
    textContent: "",
    attributes: new Map<string, string>(),
    listeners: new Map<string, Handler>(),
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    removeAttribute(name: string) {
      this.attributes.delete(name);
    },
    addEventListener(name: string, handler: Handler) {
      this.listeners.set(name, handler);
    },
    focus() {},
  });
  const panels = [
    node("compare-CAP-01"),
    node("compare-CAP-01--casual"),
    node("compare-CAP-01--duo"),
  ];
  const choices = panels.map((panel) => node(panel.id));
  const selectors = new Map(
    [
      "#episode-search",
      "#clear-search",
      "#filter-status",
      "#no-episodes",
      "#reset-filters",
      "[data-enhancement-only]",
    ].map((selector) => [selector, node()]),
  );
  const listeners = new Map<string, Handler>();
  const location = { hash: "" };
  const history = [""];
  let index = 0;
  runInNewContext(await readFile(resolve(projectRoot, "templates/library.js"), "utf8"), {
    document: {
      querySelector: (selector: string) => selectors.get(selector),
      querySelectorAll: (selector: string) =>
        selector === "[data-style-choice]"
          ? choices
          : selector === "[data-comparison-panel]"
            ? panels
            : [],
    },
    window: {
      location,
      history: {
        pushState(_state: unknown, _title: string, hash: string) {
          history.splice(++index);
          history.push(hash);
          location.hash = hash;
        },
      },
      addEventListener: (name: string, handler: Handler) => listeners.set(name, handler),
    },
  });
  const selected = () => panels.filter((panel) => !panel.hidden).map((panel) => panel.id);
  assert.deepEqual(selected(), ["compare-CAP-01"]);
  choices[1]?.listeners.get("click")?.({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
  });
  assert.deepEqual(selected(), ["compare-CAP-01--casual"]);
  location.hash = history[--index] as string;
  listeners.get("popstate")?.();
  assert.deepEqual(selected(), ["compare-CAP-01"]);
  location.hash = history[++index] as string;
  listeners.get("popstate")?.();
  assert.deepEqual(selected(), ["compare-CAP-01--casual"]);
  assert.equal(choices[1]?.attributes.get("aria-current"), "true");
  assert.equal(choices[0]?.attributes.has("aria-current"), false);
  location.hash = "#compare-CAP-01--duo";
  listeners.get("hashchange")?.();
  assert.deepEqual(selected(), ["compare-CAP-01--duo"]);
});
