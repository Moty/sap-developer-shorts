const assert = require("node:assert/strict");
const fs = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function fixture() {
  const elements = new Map();
  const make = (id, dataset = {}) => {
    const classes = new Set();
    const listeners = new Map();
    const attributes = new Map();
    const item = {
      id,
      dataset,
      hidden: false,
      disabled: false,
      textContent: "",
      value: "",
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        },
      },
      addEventListener(name, handler) {
        listeners.set(name, handler);
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      async click() {
        if (!item.disabled) await listeners.get("click")?.({});
      },
    };
    elements.set(id, item);
    return item;
  };
  const ids = [
    ...fs.readFileSync(resolve(__dirname, "../ui/index.html"), "utf8").matchAll(/id="([^"]+)"/gu),
  ];
  for (const match of ids) make(match[1]);
  const statuses = ["kokoro", "qwen", "portrait", "face"].map((status) =>
    make(`status-${status}`, { status }),
  );
  const actions = [
    "kokoro",
    "qwen",
    "portrait",
    "face",
    "test",
    "refresh",
    "retry-startup",
    "worker-start",
    "worker-stop",
  ].map((action) => make(`action-${action}`, { action }));
  const pages = ["create", "worker"].map((page) => make(`page-${page}`, { page }));
  const calls = [];
  let render;
  const api = {
    subscribe(callback) {
      render = callback;
    },
    state: () => Promise.resolve({}),
    action: async (input) => {
      calls.push(input);
    },
  };
  vm.runInNewContext(fs.readFileSync(resolve(__dirname, "../ui/app.js"), "utf8"), {
    window: { desktop: api, scrollTo() {} },
    document: {
      getElementById: (id) => {
        assert.ok(elements.has(id), `Missing UI element: ${id}`);
        return elements.get(id);
      },
      querySelectorAll: (selector) =>
        ({ "[data-status]": statuses, "[data-action]": actions, "[data-page]": pages })[selector],
    },
    setInterval() {},
    Date,
  });
  return { render: (state) => render(state), element: (id) => elements.get(id), calls };
}

test("desktop readiness distinguishes writing from engine availability and active installs", async () => {
  const f = fixture();
  await Promise.resolve();
  f.render({ ready: false, engines: {} });
  assert.equal(f.element("studio").disabled, true);
  assert.equal(f.element("engine-count").textContent, "—");
  assert.equal(f.element("engine-summary").textContent, "Checking rendering tools…");
  const ready = {
    ready: true,
    studioUrl: "http://mock.local",
    engines: { kokoro: true, face: true, qwen: false, portrait: false },
  };
  f.render(ready);
  assert.equal(f.element("studio").disabled, false);
  assert.equal(f.element("readiness").textContent, "Studio ready");
  assert.equal(f.element("engine-summary").textContent, "2 of 4 rendering tools ready");
  assert.equal(f.element("status-qwen").textContent, "Not installed");
  await f.element("action-qwen").click();
  assert.equal(f.calls[0].action, "qwen");
  f.render({ ...ready, task: { action: "qwen" } });
  assert.equal(f.element("status-qwen").textContent, "Installing…");
  assert.equal(f.element("status-qwen").classList.contains("active"), true);
  assert.equal(f.element("action-kokoro").disabled, true);
  assert.equal(f.element("engine-summary").textContent, "2 of 4 rendering tools ready");
  f.render({ ...ready, task: { action: "kokoro" } });
  assert.equal(f.element("status-kokoro").textContent, "Verifying / repairing…");
  assert.equal(f.element("engine-summary").textContent, "1 of 4 rendering tools ready");
});

test("desktop setup failures remain visible after core readiness and preserve worker and sample gates", async () => {
  const f = fixture();
  await Promise.resolve();
  const ready = {
    ready: true,
    studioUrl: "http://mock.local",
    engines: { kokoro: false, face: true, qwen: false, portrait: false },
  };
  f.render({ ...ready, error: "Operation failed (exit 1). Download interrupted." });
  assert.equal(f.element("readiness").textContent, "Setup needs attention");
  assert.equal(f.element("readiness").classList.contains("ready"), false);
  assert.match(f.element("error").textContent, /Download interrupted/u);
  assert.equal(f.element("activity-details").open, true);
  assert.equal(f.element("progress").hidden, true);
  assert.equal(f.element("action-test").disabled, true);
  f.render({ ...ready, worker: "running" });
  assert.equal(f.element("action-qwen").disabled, true);
  assert.equal(f.element("action-worker-start").disabled, true);
  assert.equal(f.element("action-worker-stop").disabled, false);
  await f.element("action-worker-stop").click();
  assert.equal(f.calls[0].action, "worker-stop");
  await f.element("page-worker").click();
  assert.equal(f.element("create").hidden, true);
  assert.equal(f.element("worker").hidden, false);
  assert.equal(f.element("page-worker").getAttribute("aria-current"), "page");
});

test("failed startup offers a retry without leaving unfinished tool checks spinning", async () => {
  const f = fixture();
  await Promise.resolve();
  const error = "News episode NEWS-10 needs a draft-ready news backlog entry";
  f.render({ ready: false, canRetryStartup: true, error, engines: {} });
  assert.equal(f.element("action-retry-startup").hidden, false);
  assert.equal(f.element("action-retry-startup").disabled, false);
  assert.match(f.element("engine-summary").textContent, /did not finish/u);
  assert.equal(f.element("status-kokoro").textContent, "Not checked");
  assert.equal(f.element("studio").disabled, true);
  assert.equal(f.element("action-kokoro").disabled, true);
  await f.element("action-retry-startup").click();
  assert.equal(f.calls[0].action, "retry-startup");
  f.render({ ready: false, error: null, task: { action: "startup" }, engines: {} });
  assert.equal(f.element("action-retry-startup").hidden, true);
  f.render({ ready: true, studioUrl: "http://mock.local", engines: {}, error: null });
  assert.equal(f.element("action-retry-startup").hidden, true);
  f.render({ ready: false, canRetryStartup: false, error: "Backend stopped", engines: {} });
  assert.equal(f.element("action-retry-startup").hidden, true);
  assert.match(f.element("engine-summary").textContent, /restart the app/u);
});
