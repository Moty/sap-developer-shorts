import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { finalReviewPanel, writingPanel } from "../src/editorial/panel.js";
import { projectRoot } from "../src/paths.js";

const ids = (html: string) => [...html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);

test("the editor shows a status chip instead of a second engine configuration", () => {
  const editor = writingPanel(true);
  for (const id of [
    "writing-provider",
    "writing-model",
    "writing-save",
    "writing-refresh",
    "writing-connect",
    "writing-api-key",
    "writing-output-writing",
    "writing-local-base",
  ])
    assert.ok(!ids(editor).includes(id), `${id} must only exist in Settings`);
  assert.doesNotMatch(editor, /Response length|Connection &amp; API key|<select id="writing-p/u);
  assert.match(editor, /data-engine-chip/u);
  assert.match(editor, /href="\.\.\/\.\.\/review\.html#settings"[^>]*>Change in Settings/u);
  for (const id of [
    "writing-style",
    "writing-direction",
    "writing-allow-remote",
    "writing-ideas",
    "writing-rewrite",
    "writing-review",
    "writing-presentation",
    "writing-hint",
    "writing-history",
  ])
    assert.ok(ids(editor).includes(id), `${id} is still needed to make requests`);

  const review = finalReviewPanel();
  assert.match(review, /id="final-review-engine"[^>]*data-engine-chip/u);
  assert.match(review, /Change in Settings/u);
  assert.ok(ids(review).includes("final-review-remote"));
  assert.ok(ids(review).includes("final-review-hint"));
  assert.doesNotMatch(review, /Choose writing engine|Final-review budget/u);
});

test("Settings presents provider radio cards over the same provider and model controls", () => {
  const settings = writingPanel();
  assert.match(settings, /Free \(local\)/u);
  assert.match(settings, /May incur cost \(Hyperspace\)/u);
  assert.equal(settings.match(/name="writing-provider-choice"/gu)?.length, 2);
  for (const id of ["writing-provider", "writing-model", "writing-save", "writing-connect"])
    assert.ok(ids(settings).includes(id), id);
  assert.match(settings, /<option value="local">/u);
  assert.match(settings, /<option value="hyperspace">/u);
  assert.match(settings, /Response length &amp; model budgets/u);
  assert.match(settings, /Recent writing requests/u);
});

class Fake {
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  checked = false;
  className = "";
  dataset: Record<string, string> = {};
  children: Fake[] = [];
  listeners = new Map<string, () => unknown>();
  byId = new Map<string, Fake>();
  addEventListener(name: string, handler: () => unknown) {
    this.listeners.set(name, handler);
  }
  append(...items: Fake[]) {
    this.children.push(...items);
  }
  prepend(...items: Fake[]) {
    this.children.unshift(...items);
  }
  replaceChildren(...items: Fake[]) {
    this.children = items;
  }
  hasAttribute() {
    return false;
  }
  querySelector(selector: string) {
    return this.byId.get(selector) ?? null;
  }
  queryAll: (selector: string) => Fake[] = () => [];
  querySelectorAll(selector: string) {
    return this.queryAll(selector);
  }
  click() {
    return this.listeners.get("click")?.();
  }
}

async function editorHarness(
  settings: Record<string, unknown>,
  offline = false,
  runningAtStart = false,
) {
  const panel = new Fake();
  panel.dataset.writingMode = "editor";
  const named = new Map<string, Fake>();
  const node = (id: string) => {
    const item = new Fake();
    named.set(id, item);
    return item;
  };
  for (const id of ["status", "usage", "result", "history", "hint", "ack-row", "cancel"]) node(id);
  for (const id of ["direction", "allow-remote"]) node(id);
  node("style").value = "conversational";
  const buttons = ["ideas", "rewrite", "review", "presentation"].map((action) => {
    const button = node(action);
    button.dataset.writingAction = action;
    return button;
  });
  const chip = new Fake();
  const items = new Fake();
  const note = new Fake();
  chip.byId.set("[data-engine-items]", items);
  chip.byId.set("[data-engine-note]", note);
  for (const [id, item] of named) panel.byId.set(`#writing-${id}`, item);
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server = {
    settings,
    hash: "a".repeat(64),
    online: !offline,
    jobs: runningAtStart
      ? [{ id: "running-job", state: "RUNNING", stages: [], action: "ideas", model: "m" }]
      : [],
  };
  const pageEvents = new Map<string, (event: { persisted?: boolean }) => unknown>();
  const fetchMock = async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace("/api/editorial/", "");
    const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
    if (url === "/api/local-voices/session") return reply({});
    if (init?.method === "POST") posts.push({ path, body: JSON.parse(init.body ?? "{}") });
    if (path === "status")
      return reply({
        settings: server.settings,
        settingsHash: server.hash,
        jobs: server.jobs,
        keyConfigured: true,
      });
    if (path === "catalog") {
      const current = server.settings as Record<string, { model: string }> & {
        provider: "local" | "hyperspace";
      };
      const model = current[current.provider]?.model ?? "";
      return reply({
        status: server.online ? "ready" : "offline",
        message: "Ready",
        models: [{ id: model, chat: true, loaded: true }],
      });
    }
    if (path === "jobs")
      return reply({ id: "job-1", state: "FAILED", stages: [], message: "stopped", model: "m" });
    return reply({ error: "unexpected" }, false);
  };
  const context = {
    document: {
      querySelector: () => panel,
      createElement: () => new Fake(),
    },
    fetch: fetchMock,
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    structuredClone,
    setTimeout: runningAtStart ? () => 0 : setTimeout,
    addEventListener: (name: string, callback: (event: { persisted?: boolean }) => unknown) =>
      pageEvents.set(name, callback),
    shortsWritingEditor: {
      context: { selector: "NEWS-06@draft", sourceHash: "b".repeat(64) },
      snapshot: () => ({ title: "x", scenes: [] }),
    },
  };
  panel.queryAll = (selector: string) =>
    selector === "[data-writing-action]"
      ? buttons
      : selector.startsWith("[data-engine-chip]")
        ? [chip]
        : [];
  runInNewContext(
    await readFile(resolve(projectRoot, "templates/writing-assistant.js"), "utf8"),
    context,
  );
  const settle = async () => {
    for (let index = 0; index < 20; index++) await new Promise((done) => setImmediate(done));
  };
  await settle();
  return { named, buttons, items, note, posts, hash: server.hash, server, settle, pageEvents };
}

const hyperspace = {
  schemaVersion: 1,
  provider: "hyperspace",
  local: { baseUrl: "http://127.0.0.1:1234/v1", model: "gemma-4-31b-it" },
  hyperspace: { baseUrl: "http://127.0.0.1:6655/litellm/v1", model: "gemini-3.8-flash" },
  outputTokens: { writing: 8192, finalReview: 16384 },
};

test("the editor loads the saved preference without engine controls and keeps Hyperspace consent explicit", async () => {
  const ui = await editorHarness(hyperspace);
  assert.deepEqual(
    ui.items.children.map((item) => item.textContent),
    ["gemini-3.8-flash", "SAP Hyperspace", "May incur cost", "Connected"],
  );
  assert.equal(ui.named.get("ack-row")?.hidden, false);
  assert.ok(ui.buttons.every((button) => button.disabled));
  assert.equal(ui.named.get("hint")?.textContent, "Tick the cost consent to use Hyperspace.");

  const request = ui.buttons[0];
  assert.ok(request);

  const consent = ui.named.get("allow-remote");
  assert.ok(consent);
  consent.checked = true;
  consent.listeners.get("change")?.();
  assert.ok(ui.buttons.every((button) => !button.disabled));
  assert.equal(ui.named.get("hint")?.hidden, true);

  await request.click();
  await ui.settle();
  assert.ok(!ui.posts.some((post) => post.path === "settings"), "the editor never saves settings");
  const job = ui.posts.find((post) => post.path === "jobs");
  assert.ok(job);
  assert.equal(job.body.settingsHash, ui.hash, "the request is bound to the saved provider/model");
  assert.equal(job.body.allowRemote, true);
  assert.equal(job.body.action, "ideas");
  assert.equal(consent.checked, false, "consent is per request");
  assert.ok(ui.buttons.every((button) => button.disabled));
});

test("a local engine needs no consent and the chip says it is free", async () => {
  const ui = await editorHarness({
    ...hyperspace,
    provider: "local",
  });
  assert.deepEqual(
    ui.items.children.map((item) => item.textContent),
    ["gemma-4-31b-it", "Local · LM Studio", "Free", "Connected"],
  );
  assert.equal(ui.named.get("ack-row")?.hidden, true);
  assert.ok(ui.buttons.every((button) => !button.disabled));
  const request = ui.buttons[1];
  assert.ok(request);
  await request.click();
  await ui.settle();
  const job = ui.posts.find((post) => post.path === "jobs");
  assert.ok(job);
  assert.equal(job.body.allowRemote, false);
  assert.equal(job.body.settingsHash, ui.hash);
});

test("a preference changed in another tab repaints the chip, clears consent and sends no request", async () => {
  const ui = await editorHarness({ ...hyperspace, provider: "local" });
  assert.equal(ui.named.get("ack-row")?.hidden, true);
  const switched = { ...hyperspace, hyperspace: { ...hyperspace.hyperspace, model: "claude-x" } };
  ui.server.settings = switched;
  ui.server.hash = "c".repeat(64);

  const request = ui.buttons[0];
  assert.ok(request);
  await request.click();
  await ui.settle();
  assert.ok(!ui.posts.some((post) => post.path === "jobs"), "no job is started");
  assert.ok(!ui.posts.some((post) => post.path === "settings"));
  assert.match(ui.named.get("status")?.textContent ?? "", /settings changed.*start again/iu);
  assert.deepEqual(
    ui.items.children.map((item) => item.textContent),
    ["claude-x", "SAP Hyperspace", "May incur cost", "Connected"],
  );
  assert.equal(ui.named.get("ack-row")?.hidden, false);
  const consent = ui.named.get("allow-remote");
  assert.ok(consent);
  assert.equal(consent.checked, false);
  assert.ok(ui.buttons.every((button) => button.disabled));
  assert.equal(ui.named.get("hint")?.textContent, "Tick the cost consent to use Hyperspace.");

  consent.checked = true;
  consent.listeners.get("change")?.();
  await request.click();
  await ui.settle();
  const job = ui.posts.find((post) => post.path === "jobs");
  assert.ok(job);
  assert.equal(job.body.settingsHash, "c".repeat(64));
  assert.equal(job.body.allowRemote, true);
});

test("consent ticked for one Hyperspace model is cleared when the saved model changes", async () => {
  const ui = await editorHarness(hyperspace);
  const consent = ui.named.get("allow-remote");
  assert.ok(consent);
  consent.checked = true;
  consent.listeners.get("change")?.();
  ui.server.settings = {
    ...hyperspace,
    hyperspace: { ...hyperspace.hyperspace, model: "other-model" },
  };
  ui.server.hash = "d".repeat(64);
  await ui.buttons[2]?.click();
  await ui.settle();
  assert.ok(!ui.posts.some((post) => post.path === "jobs"));
  assert.equal(consent.checked, false);
  assert.equal(ui.items.children[0]?.textContent, "other-model");
});

test("returning from Settings refreshes an offline editor without submitting a model job", async () => {
  const ui = await editorHarness({ ...hyperspace, provider: "local" }, true);
  assert.ok(ui.buttons.every((button) => button.disabled));
  ui.pageEvents.get("pagehide")?.({});
  ui.server.online = true;
  ui.server.hash = "b".repeat(64);
  ui.pageEvents.get("pageshow")?.({ persisted: true });
  await ui.settle();
  assert.ok(ui.buttons.every((button) => !button.disabled));
  assert.equal(ui.named.get("hint")?.hidden, true);
  assert.equal(ui.posts.filter((post) => post.path === "jobs").length, 0);
});

test("a writing job completed while away does not leave restored editor actions disabled", async () => {
  const ui = await editorHarness({ ...hyperspace, provider: "local" }, false, true);
  assert.ok(ui.buttons.every((button) => button.disabled));
  ui.pageEvents.get("pagehide")?.({});
  ui.server.jobs = [];
  ui.pageEvents.get("pageshow")?.({ persisted: true });
  await ui.settle();
  assert.ok(ui.buttons.every((button) => !button.disabled));
  assert.equal(ui.posts.filter((post) => post.path === "jobs").length, 0);
});
