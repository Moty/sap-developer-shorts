import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { voiceReadingScripts } from "../src/voice-reading-scripts.js";
import { voiceStyles } from "../src/voice-styles.js";

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
  open = false;
  checked = false;
  files: Blob[] = [];
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
  dispatchEvent(event: { type: string }) {
    return this.listeners.get(event.type)?.();
  }
}
interface ProfileFixture {
  voice: typeof a;
  name: string;
  accepted: boolean;
  durationSeconds: number;
  auditionReady?: boolean;
  audition?: { sha256: string };
  speakerName?: string;
  style?: string;
}
async function ui(
  options: {
    microphone?: () => Promise<unknown>;
    audioContext?: unknown;
    profiles?: ProfileFixture[];
    assigned?: typeof a;
    deferAcceptRefresh?: boolean;
    library?: boolean;
    styles?: boolean;
  } = {},
) {
  const elements = new Map<string, Element>();
  const pageEvents = new Map<string, () => void>();
  const get = (id: string) => {
    if (options.library && id.startsWith("speaker-voice-"))
      throw new Error("Library must not require an episode speaker");
    let element = elements.get(id);
    if (!element) {
      element = new Element();
      elements.set(id, element);
    }
    if (id === "my-voice-saved" || id === "speaker-voice-0") element.tagName = "SELECT";
    return element;
  };
  get(options.library ? "voice-library-data" : "editor-data").textContent = JSON.stringify({
    voiceReadingScripts,
    ...(options.library || options.styles ? { voiceStyles } : {}),
    ...(options.library ? { voicePanelContext: "library" } : {}),
  });
  get("my-voice-reading-choice").value = voiceReadingScripts[0].id;
  get("my-voice-style").value = voiceStyles[0].id;
  get("my-voice-filter").value = "all";
  let finish: ((value: unknown) => void) | undefined;
  let finishRefresh: ((value: unknown) => void) | undefined;
  let accepting = false;
  const auditions: unknown[] = [];
  const enrollments: Record<string, unknown>[] = [];
  const acceptances: unknown[] = [];
  const response = (value: unknown) => ({ ok: true, json: async () => value });
  let profiles = options.profiles ?? [
    { voice: a, name: "A", accepted: true, durationSeconds: 10 },
    { voice: b, name: "B", accepted: true, durationSeconds: 10 },
  ];
  const catalog = () => ({
    runtime: { ready: true },
    profiles,
  });
  if (options.assigned) {
    const choice = new Element();
    choice.value = key(options.assigned);
    get("speaker-voice-0").value = choice.value;
    get("speaker-voice-0").append(choice);
  }
  runInNewContext(script, {
    document: {
      getElementById: get,
      createElement: () => new Element(),
      querySelectorAll: () => (options.library ? [] : [get("speaker-voice-0")]),
    },
    fetch: async (path: string, init?: { body?: string }) => {
      if (path.endsWith("/session")) return response({ local: true });
      if (path.endsWith("/accept")) {
        const body = JSON.parse(init?.body ?? "{}");
        acceptances.push(body);
        if (options.library)
          profiles = profiles.map((profile) =>
            key(profile.voice) === key(body.voice) ? { ...profile, accepted: true } : profile,
          );
        accepting = true;
        return response({ accepted: true });
      }
      if (path.endsWith("/enroll")) {
        const body = JSON.parse(init?.body ?? "{}");
        enrollments.push(body);
        const voice = { ...b, revision: "c".repeat(64) };
        const style = voiceStyles.find((style) => style.id === body.style);
        const profile = {
          voice,
          name: `${body.speakerName} · ${style?.label}`,
          speakerName: body.speakerName,
          style: body.style,
          accepted: false,
          durationSeconds: 6,
          auditionReady: false,
        };
        profiles = [...profiles, profile];
        return response(profile);
      }
      if (path.endsWith("/audition")) {
        auditions.push(JSON.parse(init?.body ?? "{}"));
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      if (accepting && options.deferAcceptRefresh)
        return new Promise((resolve) => {
          finishRefresh = resolve;
        });
      return response(catalog());
    },
    navigator: { mediaDevices: { getUserMedia: options.microphone } },
    AudioContext: options.audioContext,
    MediaRecorder: class {},
    FileReader: class {
      result = "";
      onload?: () => void;
      readAsDataURL() {
        this.result = "data:audio/wav;base64,U1lOVEhFVElD";
        queueMicrotask(() => this.onload?.());
      }
    },
    structuredClone,
    URL,
    Blob,
    Event,
    Date,
    setTimeout,
    clearTimeout,
    addEventListener: (name: string, handler: () => void) => pageEvents.set(name, handler),
    requestAnimationFrame: () => 0,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return {
    get,
    auditions,
    enrollments,
    acceptances,
    pageEvent: (name: string) => pageEvents.get(name)?.(),
    finishRefresh: () => {
      assert.ok(finishRefresh);
      finishRefresh(response(catalog()));
    },
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
test("reopening a draft restores its saved audition without generating another or changing voices", async () => {
  const runtime = await ui({
    assigned: a,
    profiles: [
      {
        voice: a,
        name: "Personal reference",
        accepted: false,
        durationSeconds: 15,
        auditionReady: true,
        audition: { sha256: "c".repeat(64) },
      },
    ],
  });
  assert.equal(runtime.get("my-voice-saved").value, key(a));
  assert.equal(runtime.get("my-voice-audition").hidden, false);
  assert.match(runtime.get("my-voice-audition").src, /kind=audition&v=cccc/u);
  assert.equal(runtime.get("my-voice-accept").disabled, false);
  assert.equal(runtime.get("my-voice-accept").textContent, "I listened · use this voice");
  assert.match(
    runtime.get("speaker-voice-0").options[0]?.textContent ?? "",
    /Personal reference.*Audition needed/u,
  );
  assert.equal(runtime.get("speaker-voice-0").value, key(a));
  assert.deepEqual(runtime.auditions, []);
});

test("a saved audition that no longer matches the runtime cannot enable acceptance", async () => {
  const runtime = await ui({
    assigned: a,
    profiles: [
      { voice: a, name: "Reference", accepted: false, durationSeconds: 15, auditionReady: false },
    ],
  });
  assert.equal(runtime.get("my-voice-accept").disabled, true);
  assert.equal(runtime.get("my-voice-audition").hidden, true);
  assert.equal(runtime.get("my-voice-generate").disabled, false);
});

const auditionedProfiles = (): ProfileFixture[] => [
  { voice: a, name: "A", accepted: true, durationSeconds: 15, auditionReady: true },
  { voice: b, name: "B", accepted: true, durationSeconds: 15, auditionReady: true },
];
test("an acceptance refresh cannot restore A over a newer B selection", async () => {
  const runtime = await ui({
    assigned: a,
    profiles: auditionedProfiles(),
    deferAcceptRefresh: true,
  });
  const pending = runtime.get("my-voice-accept").click();
  await new Promise((resolve) => setImmediate(resolve));
  runtime.get("my-voice-saved").value = key(b);
  runtime.get("my-voice-saved").change();
  runtime.get("speaker-voice-0").value = key(b);
  runtime.get("speaker-voice-0").change();
  runtime.finishRefresh();
  await pending;
  assert.equal(runtime.get("my-voice-saved").value, key(b));
  assert.equal(runtime.get("speaker-voice-0").value, key(b));
});
test("acceptance stays bound to its original speaker when the target changes", async () => {
  const runtime = await ui({
    assigned: a,
    profiles: auditionedProfiles(),
    deferAcceptRefresh: true,
  });
  const pending = runtime.get("my-voice-accept").click();
  await new Promise((resolve) => setImmediate(resolve));
  runtime.get("my-voice-speaker").value = "1";
  runtime.get("my-voice-speaker").change();
  runtime.finishRefresh();
  await pending;
  assert.equal(runtime.get("speaker-voice-1").value, "");
});
test("a regenerated audition stays available when switching away and back and requires new acceptance", async () => {
  const runtime = await ui({ assigned: a, profiles: auditionedProfiles() });
  const pending = runtime.get("my-voice-generate").click();
  runtime.finish();
  await pending;
  runtime.get("my-voice-saved").value = key(b);
  runtime.get("my-voice-saved").change();
  runtime.get("my-voice-saved").value = key(a);
  runtime.get("my-voice-saved").change();
  assert.equal(runtime.get("my-voice-audition").hidden, false);
  assert.equal(runtime.get("my-voice-accept").disabled, false);
  assert.equal(runtime.get("my-voice-accept").textContent, "I listened · use this voice");
  assert.match(runtime.get("speaker-voice-0").options[0]?.textContent ?? "", /Audition needed/u);
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
  assert.equal(runtime.get("my-voice-reading-choice").disabled, true);
  assert.equal(runtime.get("my-voice-save").disabled, true);
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
  assert.equal(runtime.get("my-voice-reading-choice").disabled, false);
  assert.equal(runtime.get("my-voice-save").disabled, false);
  assert.match(runtime.get("my-voice-status").textContent, /upload a recording/);
});

test("reading choices preserve a custom transcript until the user explicitly selects its text", async () => {
  const runtime = await ui();
  const transcript = runtime.get("my-voice-transcript");
  transcript.value = "These are the words in my existing recording.";
  for (const passage of voiceReadingScripts) {
    runtime.get("my-voice-reading-choice").value = passage.id;
    runtime.get("my-voice-reading-choice").change();
    assert.equal(runtime.get("my-voice-reading-text").textContent, passage.text);
    assert.equal(transcript.value, "These are the words in my existing recording.");
  }
  await runtime.get("my-voice-reading-script").click();
  assert.equal(transcript.value, voiceReadingScripts.at(-1)?.text);
});

test("voice library filters independent recordings by style without requiring an episode", async () => {
  const runtime = await ui({
    library: true,
    profiles: [
      {
        voice: a,
        name: "Moty · Professional",
        speakerName: "Moty",
        style: "professional",
        accepted: true,
        auditionReady: true,
        durationSeconds: 12,
      },
      {
        voice: b,
        name: "Moty · Calm",
        speakerName: "Moty",
        style: "calm",
        accepted: false,
        durationSeconds: 11,
      },
    ],
  });
  runtime.get("my-voice-filter").value = "professional";
  runtime.get("my-voice-filter").change();
  assert.deepEqual(
    runtime.get("my-voice-saved").options.map((option) => option.textContent),
    ["Choose a saved voice", "Moty · Professional · Ready"],
  );
  runtime.get("my-voice-saved").value = key(a);
  runtime.get("my-voice-saved").change();
  assert.equal(runtime.get("my-voice-accept").disabled, true);
  assert.match(runtime.get("my-voice-style-summary").textContent, /Professional/u);
  runtime.get("my-voice-filter").value = "calm";
  runtime.get("my-voice-filter").change();
  assert.ok(
    runtime
      .get("my-voice-saved")
      .options.some((option) => option.textContent.includes("Moty · Calm")),
  );
  assert.equal(runtime.get("my-voice-reference").hidden, true);
});

test("library accepts only the audition explicitly selected and makes it available without assigning a speaker", async () => {
  const runtime = await ui({
    library: true,
    profiles: [
      {
        voice: a,
        name: "Moty · Upbeat",
        accepted: false,
        auditionReady: true,
        durationSeconds: 10,
      },
    ],
  });
  assert.equal(runtime.acceptances.length, 0);
  runtime.get("my-voice-saved").value = key(a);
  runtime.get("my-voice-saved").change();
  await runtime.get("my-voice-accept").click();
  assert.equal(runtime.acceptances.length, 1);
  assert.equal(runtime.get("my-voice-accept").disabled, true);
  assert.match(runtime.get("my-voice-status").textContent, /Choose this recording/u);
});

test("recording styles choose relevant reading text, preserve custom transcripts and save a distinct unaccepted take", async () => {
  const runtime = await ui({ library: true });
  runtime.get("my-voice-transcript").value = "My custom words.";
  for (const style of voiceStyles) {
    runtime.get("my-voice-style").value = style.id;
    runtime.get("my-voice-style").change();
    assert.equal(runtime.get("my-voice-reading-choice").value, style.readingScript);
    assert.equal(runtime.get("my-voice-transcript").value, "My custom words.");
  }
  runtime.get("my-voice-style").value = "upbeat";
  runtime.get("my-voice-style").change();
  runtime.get("my-voice-name").value = "Moty";
  runtime.get("my-voice-file").files = [new Blob(["Synthetic UI fixture, not a voice recording."])];
  runtime.get("my-voice-file").change();
  runtime.get("my-voice-consent").checked = true;
  assert.equal(runtime.get("my-voice-record-pane").hidden, true);
  assert.equal(runtime.get("my-voice-review-pane").hidden, false);
  await runtime.get("my-voice-save").click();
  assert.equal(runtime.enrollments[0]?.style, "upbeat");
  assert.equal(runtime.enrollments[0]?.speakerName, "Moty");
  assert.equal(runtime.enrollments[0]?.transcript, "My custom words.");
  assert.equal(runtime.enrollments[0]?.consent, true);
  assert.equal(
    runtime.get("my-voice-name").value,
    "Moty",
    "speaker name stays ready for another style",
  );
  assert.equal(runtime.get("my-voice-enrollment").open, false);
  assert.equal(runtime.get("my-voice-consent").checked, false);
  assert.equal(
    runtime.get("my-voice-accept").disabled,
    true,
    "a new recording needs its own audition",
  );
  assert.equal(runtime.acceptances.length, 0);
});

test("leaving the voice library cancels a pending microphone request before it can start recording", async () => {
  let resolveStream!: (stream: unknown) => void;
  let stopped = 0;
  const runtime = await ui({
    library: true,
    microphone: () =>
      new Promise((resolve) => {
        resolveStream = resolve;
      }),
  });
  const pending = runtime.get("my-voice-record").click();
  await new Promise(setImmediate);
  runtime.pageEvent("pagehide");
  runtime.pageEvent("pageshow");
  resolveStream({
    getTracks: () => [
      {
        stop: () => {
          stopped++;
        },
      },
    ],
  });
  await pending;
  assert.ok(stopped > 0);
  assert.match(runtime.get("my-voice-status").textContent, /Recording was stopped/u);
  assert.equal(runtime.get("my-voice-record").disabled, false);
});
