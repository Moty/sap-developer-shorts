import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../templates/voice-profiles.js", import.meta.url), "utf8");
const a = {
  engine: "qwen",
  profileId: "12345678-1234-4234-8234-123456789abc",
  revision: "a".repeat(64),
};
const b = { ...a, profileId: "12345678-1234-4234-8234-123456789abd" };
const key = (voice: typeof a) => `qwen:${voice.profileId}:${voice.revision}`;
class Element {
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  src = "";
  tagName = "DIV";
  options: Element[] = [];
  listeners = new Map<string, () => unknown>();
  addEventListener(name: string, callback: () => unknown) {
    this.listeners.set(name, callback);
  }
  replaceChildren() {
    this.options = [];
    this.value = "";
  }
  append(element: Element) {
    this.options.push(element);
  }
  async click() {
    return this.listeners.get("click")?.();
  }
  change() {
    return this.listeners.get("change")?.();
  }
}
async function ui(options: { microphone?: () => Promise<unknown>; audioContext?: unknown } = {}) {
  const elements = new Map<string, Element>();
  const get = (id: string) => {
    let element = elements.get(id);
    if (!element) {
      element = new Element();
      elements.set(id, element);
    }
    if (id === "my-voice-saved" || id === "speaker-voice-0") element.tagName = "SELECT";
    return element;
  };
  let finish: ((value: unknown) => void) | undefined;
  const auditions: unknown[] = [];
  const response = (value: unknown) => ({ ok: true, json: async () => value });
  runInNewContext(script, {
    document: {
      getElementById: get,
      createElement: () => new Element(),
      querySelectorAll: () => [get("speaker-voice-0")],
    },
    fetch: async (path: string, init?: { body?: string }) => {
      if (path.endsWith("/session")) return response({ local: true });
      if (path.endsWith("/audition")) {
        auditions.push(JSON.parse(init?.body ?? "{}"));
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return response({
        runtime: { ready: true },
        profiles: [
          { voice: a, name: "A", accepted: true, durationSeconds: 10 },
          { voice: b, name: "B", accepted: true, durationSeconds: 10 },
        ],
      });
    },
    navigator: { mediaDevices: { getUserMedia: options.microphone } },
    AudioContext: options.audioContext,
    MediaRecorder: class {},
    structuredClone,
    URL,
    Blob,
    Date,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return {
    get,
    auditions,
    finish: () => {
      assert.ok(finish);
      finish(response({ durationSeconds: 5 }));
    },
  };
}
test("an audition finishing for A cannot display or enable acceptance of B", async () => {
  const runtime = await ui();
  runtime.get("my-voice-saved").value = key(a);
  runtime.get("my-voice-saved").change();
  const pending = runtime.get("my-voice-generate").click();
  await new Promise((resolve) => setImmediate(resolve));
  runtime.get("my-voice-saved").value = key(b);
  runtime.get("my-voice-saved").change();
  runtime.finish();
  await pending;
  assert.deepEqual(runtime.auditions, [{ voice: a }]);
  assert.equal(runtime.get("my-voice-audition").hidden, true);
  assert.equal(runtime.get("my-voice-accept").disabled, true);
});
test("microphone setup failure releases its stream and repeated permission clicks cannot open another", async () => {
  let calls = 0;
  let stopped = 0;
  let allow: ((value: unknown) => void) | undefined;
  const runtime = await ui({
    microphone: () => {
      calls++;
      return new Promise((resolve) => {
        allow = resolve;
      });
    },
    audioContext: class {
      constructor() {
        throw new Error("Audio unavailable");
      }
    },
  });
  const pending = runtime.get("my-voice-record").click();
  await runtime.get("my-voice-record").click();
  assert.equal(calls, 1);
  assert.ok(allow);
  allow({
    getTracks: () => [
      {
        stop: () => {
          stopped++;
        },
      },
    ],
  });
  await pending;
  assert.equal(stopped, 1);
  assert.equal(runtime.get("my-voice-record").disabled, false);
  assert.match(runtime.get("my-voice-status").textContent, /upload a recording/);
});
