import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { projectRoot } from "../src/paths.js";

const script = await readFile(resolve(projectRoot, "templates/local-actions.js"), "utf8");

async function page(options: { offline?: boolean; resume?: boolean; fail?: boolean } = {}) {
  type Node = {
    textContent: string;
    hidden: boolean;
    disabled: boolean;
    dataset: Record<string, string>;
    src?: string;
    controls?: boolean;
    setAttribute(name: string, value: string): void;
  };
  const node = (): Node => ({
    textContent: "",
    hidden: false,
    disabled: false,
    dataset: {},
    setAttribute() {},
  });
  const help = node(),
    status = node(),
    refresh = node(),
    label = node();
  refresh.hidden = true;
  label.textContent = "Default: Heart";
  const scopes = [0, 1, 2].map(() => ({
    status: node(),
    audio: { ...node(), hidden: true },
    querySelector(selector: string) {
      return selector.includes("status") ? this.status : this.audio;
    },
  }));
  const makeButton = (action: string, voice: string, scope: number) => ({
    ...node(),
    disabled: true,
    dataset: { localAction: action, voice } as Record<string, string>,
    closest(selector: string) {
      return selector === "[data-local-action]" ? this : scopes[scope];
    },
  });
  const audition = makeButton("voice-audition", "am_michael", 0);
  const heart = makeButton("voice-default", "af_heart", 1);
  heart.dataset.currentDefault = "true";
  const michael = makeButton("voice-default", "am_michael", 0);
  const install = makeButton("voice-install", "af_bella", 2);
  const bellaDefault = makeButton("voice-default", "af_bella", 2);
  bellaDefault.dataset.needsInstall = "true";
  const buttons = [audition, heart, michael, install, bellaDefault];
  const badges = [
    { ...node(), dataset: { defaultVoice: "af_heart" } },
    { ...node(), dataset: { defaultVoice: "am_michael" }, hidden: true },
  ];
  const listeners = new Map<string, (event: unknown) => Promise<void>>();
  const requests: { path: string; action?: string; voice?: string }[] = [];
  let current = {
    id: "sample-job",
    action: "voice-audition",
    voice: "am_michael",
    state: "RUNNING",
  };
  const response = (data: unknown, ok = true) => ({
    ok,
    json: async () => data,
    blob: async () => "audio fixture",
  });
  runInNewContext(script, {
    document: {
      querySelectorAll: (selector: string) =>
        selector === "[data-local-action]" ? buttons : badges,
      getElementById: (id: string) =>
        ({
          "local-actions-help": help,
          "local-actions-status": status,
          "local-actions-refresh": refresh,
          "default-voice-label": label,
        })[id],
      addEventListener: (name: string, handler: (event: unknown) => Promise<void>) =>
        listeners.set(name, handler),
    },
    window: { addEventListener() {}, dispatchEvent() {} },
    CustomEvent: class {
      constructor(
        readonly type: string,
        readonly init: unknown,
      ) {}
    },
    URL: { createObjectURL: () => "blob:saved-sample", revokeObjectURL() {} },
    setTimeout: (done: () => void) => queueMicrotask(done),
    fetch: async (path: string, init?: { body?: string }) => {
      if (options.offline) return response({ error: "Open the local studio" }, false);
      if (init?.body) {
        const input = JSON.parse(init.body);
        requests.push({ path, ...input });
        if (options.fail) return response({ error: "Model is busy" }, false);
        current = { id: "sample-job", state: "RUNNING", ...input };
        return response(current);
      }
      requests.push({ path });
      if (path.endsWith("/audio")) return response({});
      if (path.endsWith("/session")) return response({ local: true });
      if (path === "/api/local-actions") return response({ job: options.resume ? current : null });
      return response({
        ...current,
        state: "SUCCEEDED",
        message: "Saved",
        result: {
          libraryUpdated: true,
          ...(current.action === "voice-audition"
            ? { audioUrl: "/api/local-actions/sample-job/audio", durationSeconds: 2 }
            : {}),
          ...(current.action === "voice-default" ? { selected: current.voice } : {}),
        },
      });
    },
  });
  await new Promise(setImmediate);
  return {
    buttons,
    audition,
    heart,
    michael,
    install,
    bellaDefault,
    label,
    badges,
    scopes,
    requests,
    refresh,
    status,
    help,
    click: async (button: typeof audition) => {
      await listeners.get("click")?.({ target: button });
    },
  };
}

test("sample button plays saved audio and never changes the default narrator", async () => {
  const ui = await page();
  assert.equal(ui.audition.disabled, false);
  assert.equal(ui.heart.disabled, true);
  await ui.click(ui.audition);
  assert.deepEqual(
    ui.requests.filter((r) => r.action),
    [{ path: "/api/local-actions", action: "voice-audition", voice: "am_michael" }],
  );
  assert.equal(ui.scopes[0]?.audio.src, "blob:saved-sample");
  assert.equal(ui.scopes[0]?.audio.hidden, false);
  assert.equal(ui.label.textContent, "Default: Heart");
  assert.equal(ui.refresh.hidden, false);
  assert.equal(ui.audition.disabled, false);
});

test("default selection is explicit; installing a voice enables audition and selection without selecting it", async () => {
  const ui = await page();
  assert.equal(ui.bellaDefault.disabled, true);
  await ui.click(ui.install);
  assert.equal(ui.install.dataset.localAction, "voice-audition");
  assert.equal(ui.bellaDefault.disabled, false);
  assert.equal(ui.label.textContent, "Default: Heart");
  await ui.click(ui.michael);
  assert.equal(ui.label.textContent, "Default: am_michael");
  assert.equal(ui.michael.disabled, true);
  assert.equal(ui.heart.disabled, false);
  assert.deepEqual(
    ui.badges.map((b) => b.hidden),
    [true, false],
  );
});

test("action errors restore controls; static copies stay disabled; navigation resumes an active sample", async () => {
  const failed = await page({ fail: true });
  await failed.click(failed.audition);
  assert.match(failed.status.textContent, /Model is busy/u);
  assert.equal(failed.audition.disabled, false);
  const offline = await page({ offline: true });
  assert.ok(offline.buttons.every((b) => b.disabled));
  await offline.click(offline.audition);
  assert.equal(offline.requests.length, 0);
  const resumed = await page({ resume: true });
  assert.equal(resumed.requests.filter((r) => r.action).length, 0);
  assert.equal(resumed.scopes[0]?.audio.hidden, false);
});
