import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import type { LibraryContent } from "../src/library.js";
import type { SapNewsItem } from "../src/news/fetcher.js";
import { newShortSheet, presenterWorkspace } from "../src/workspace-panels.js";

const script = await readFile(new URL("../templates/workspace-panels.js", import.meta.url), "utf8");
class Element {
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  required = false;
  open = false;
  dataset: Record<string, string> = {};
  options: Element[] = [];
  group: Element[] = [];
  selected = false;
  listeners = new Map<string, (event: unknown) => unknown>();
  controls: Element[] = [];
  fields: Element[] = [];
  get checked() {
    return this.selected;
  }
  set checked(value: boolean) {
    if (value) for (const item of this.group) item.selected = false;
    this.selected = value;
  }
  addEventListener(name: string, fn: (event: unknown) => unknown) {
    this.listeners.set(name, fn);
  }
  emit(name: string) {
    return this.listeners.get(name)?.({ target: this, preventDefault() {}, stopPropagation() {} });
  }
  querySelectorAll(selector: string) {
    if (selector === "input, select") return this.fields;
    return selector === "input, select, button" ? this.controls : [];
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  focus() {}
}
function radios(values: string[]) {
  const nodes = values.map((value) => Object.assign(new Element(), { value }));
  for (const node of nodes) node.group = nodes;
  if (nodes[0]) nodes[0].checked = true;
  return nodes;
}
function setup(response: () => Promise<{ ok: boolean; json(): Promise<unknown> }>) {
  const nodes = new Map<string, Element>();
  for (const id of [
    "new-short-dialog",
    "new-short-form",
    "new-short-story",
    "new-short-url",
    "new-story-field",
    "new-url-field",
    "new-short-tone",
    "new-short-length",
    "new-short-length-label",
    "new-short-narrator",
    "new-short-secondary",
    "new-secondary-field",
    "new-short-status",
    "new-short-submit",
    "new-short-refresh",
  ])
    nodes.set(id, new Element());
  const get = (id: string) => {
    const node = nodes.get(id);
    assert.ok(node, id);
    return node;
  };
  get("new-short-tone").value = "professional";
  get("new-short-length").value = "60";
  for (const id of ["new-short-narrator", "new-short-secondary"]) {
    get(id).options = ["af_heart", "am_michael"].map((value) =>
      Object.assign(new Element(), { value }),
    );
    get(id).value = "af_heart";
  }
  const sources = radios(["story", "url"]);
  const formats = radios(["explainer", "dialogue", "quiz"]);
  const trigger = new Element();
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const navigations: string[] = [];
  get("new-short-refresh").hidden = true;
  get("new-short-dialog").fields = [get("new-short-url"), get("new-short-tone")];
  get("new-short-dialog").controls = [
    ...get("new-short-dialog").fields,
    get("new-short-submit"),
    trigger,
  ];
  runInNewContext(script, {
    document: {
      getElementById: (id: string) => nodes.get(id),
      querySelector(selector: string) {
        if (selector === 'input[name="new-format"]:checked')
          return formats.find((node) => node.checked);
        if (selector === 'input[name="new-source"]:checked')
          return sources.find((node) => node.checked);
        if (selector === 'input[name="new-source"][value="url"]') return sources[1];
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === "[data-new-short], [data-new-short-format]") return [trigger];
        if (selector === 'input[name="new-format"]') return formats;
        return [];
      },
    },
    fetch: async (path: string, options: { body: string }) => {
      assert.equal(path, "/api/news/create", "no production, paid writing or voice requests");
      requests.push({ path, body: JSON.parse(options.body) });
      return response();
    },
    window: { location: { assign: (path: string) => navigations.push(path) } },
  });
  return { get, trigger, requests, navigations, sources, formats };
}

test("New short carries each visible delivery choice into a mocked draft request and opens its editor", async () => {
  const ui = setup(async () => ({ ok: true, json: async () => ({ episode: { id: "NEWS-42" } }) }));
  ui.trigger.dataset.newShortFormat = "dialogue";
  ui.trigger.emit("click");
  assert.equal(ui.get("new-short-dialog").open, true);
  assert.equal(ui.get("new-secondary-field").hidden, false);
  assert.equal(ui.get("new-short-secondary").value, "am_michael");
  if (ui.sources[1]) ui.sources[1].checked = true;
  ui.get("new-short-url").value = "https://news.sap.com/2026/10/source/";
  ui.get("new-short-tone").value = "casual";
  ui.get("new-short-length").value = "45";
  ui.get("new-short-form").emit("change");
  assert.equal(ui.get("new-short-url").required, true);
  assert.equal(ui.get("new-short-story").required, false);
  assert.equal(ui.get("new-short-url").disabled, false);
  assert.equal(ui.get("new-short-story").disabled, true);
  await ui.get("new-short-form").emit("submit");
  assert.deepEqual(ui.requests[0]?.body, {
    url: "https://news.sap.com/2026/10/source/",
    promote: true,
    delivery: {
      format: "dialogue",
      tone: "casual",
      targetDurationSeconds: 45,
      narrator: "af_heart",
      secondaryNarrator: "am_michael",
    },
  });
  assert.deepEqual(ui.navigations, ["episodes/NEWS-42/edit.html#presentation"]);
});

test("switching sources disables the inactive URL so its invalid value cannot block native validation", () => {
  const ui = setup(async () => ({ ok: true, json: async () => ({}) }));
  if (ui.sources[1]) ui.sources[1].checked = true;
  ui.get("new-short-url").value = "invalid URL kept for later";
  ui.get("new-short-form").emit("change");
  assert.equal(ui.get("new-short-url").disabled, false);
  if (ui.sources[0]) ui.sources[0].checked = true;
  ui.get("new-short-form").emit("change");
  assert.equal(ui.get("new-short-url").disabled, true);
  assert.equal(ui.get("new-short-url").required, false);
  assert.equal(ui.get("new-short-story").disabled, false);
  assert.equal(ui.get("new-short-story").required, true);
  assert.equal(ui.get("new-short-url").value, "invalid URL kept for later");
});

test("zero-stock users can create a sourced draft with deferred default narration", async () => {
  const ui = setup(async () => ({ ok: true, json: async () => ({ episode: { id: "NEWS-42" } }) }));
  ui.get("new-short-narrator").value = "default";
  ui.get("new-short-narrator").options = [Object.assign(new Element(), { value: "default" })];
  ui.get("new-short-story").value = "https://news.sap.com/source/";
  await ui.get("new-short-form").emit("submit");
  const request = ui.requests[0];
  assert.ok(request);
  assert.equal((request.body.delivery as { narrator: string }).narrator, "default");
  assert.deepEqual(ui.navigations, ["episodes/NEWS-42/edit.html#presentation"]);
  const empty: LibraryContent = { entries: [], topics: [], newsTopics: [], budgetCents: 0 };
  const html = newShortSheet(empty, []);
  assert.match(html, /value="default" selected>Default \/ decide later/u);
  assert.doesNotMatch(html, /id="new-short-submit"[^>]*disabled/u);
  assert.doesNotMatch(html, /id="new-short-narrator"[^>]*disabled/u);
});

test("failed creation keeps the modal and choices for retry, restores controls, and does not navigate", async () => {
  let finish: ((value: { ok: boolean; json(): Promise<unknown> }) => void) | undefined;
  const ui = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  ui.trigger.emit("click");
  ui.get("new-short-story").value = "https://news.sap.com/source/";
  const pending = ui.get("new-short-form").emit("submit");
  assert.equal(ui.get("new-short-tone").disabled, true);
  assert.ok(finish);
  finish({ ok: false, json: async () => ({ error: "Source needs editorial review." }) });
  await pending;
  assert.equal(ui.get("new-short-status").textContent, "Source needs editorial review.");
  assert.equal(ui.get("new-short-tone").disabled, false);
  assert.equal(ui.get("new-short-dialog").open, true);
  assert.equal(ui.get("new-short-story").value, "https://news.sap.com/source/");
  assert.deepEqual(ui.navigations, []);
});

test("a saved draft without an updated library stays identified and cannot be submitted twice", async () => {
  const ui = setup(async () => ({
    ok: true,
    json: async () => ({ episode: { id: "NEWS-42" }, libraryUpdated: false }),
  }));
  ui.trigger.emit("click");
  ui.get("new-short-story").value = "https://news.sap.com/source/";
  await ui.get("new-short-form").emit("submit");
  assert.deepEqual(ui.navigations, [], "the editor may not exist in the served library");
  assert.match(ui.get("new-short-status").textContent, /Draft NEWS-42 saved/u);
  assert.match(ui.get("new-short-status").textContent, /Refresh My shorts/u);
  assert.equal(ui.get("new-short-refresh").hidden, false);
  assert.equal(ui.get("new-short-submit").disabled, true);
  assert.equal(ui.get("new-short-submit").textContent, "Draft saved");
  assert.equal(ui.get("new-short-tone").disabled, true);
  ui.get("new-short-dialog").close();
  ui.trigger.dataset.newShortFormat = "quiz";
  ui.trigger.emit("click");
  ui.get("new-short-form").emit("change");
  assert.equal(ui.get("new-short-dialog").open, true);
  assert.equal(ui.get("new-short-tone").disabled, true);
  await ui.get("new-short-form").emit("submit");
  assert.equal(ui.requests.length, 1, "reopening or resubmitting keeps the saved result");
});

test("New short markup escapes source titles and exposes only supported creation paths", () => {
  const content: LibraryContent = {
    entries: [],
    topics: [],
    newsTopics: [],
    budgetCents: 0,
    voiceCatalog: {
      selected: "af_heart",
      installed: ["af_heart"],
      available: ["af_heart"],
      samples: [],
    },
  };
  const story: SapNewsItem = {
    id: "one",
    title: "</option><script>bad()</script>",
    link: "https://news.sap.com/source/",
    pubDate: "",
    publishedIso: "",
    categories: [],
    relevanceScore: 3,
    angleSuggestion: "",
  };
  const html = newShortSheet(content, [story]);
  assert.match(html, /aria-labelledby="new-short-title"/u);
  assert.match(html, /&lt;\/option&gt;&lt;script&gt;/u);
  assert.doesNotMatch(html, /<script>bad/u);
  assert.match(html, /they do not rewrite the words/u);
  assert.match(html, /You can draft before setting up narration/u);
  assert.doesNotMatch(html, /value="blank"|value="tutorial"/u);
  assert.match(html, /id="new-short-refresh"[^>]*href="review.html\?refresh=workspace#episodes"/u);
  assert.match(presenterWorkspace([]), /data-workspace-view="voices"/u);
});
