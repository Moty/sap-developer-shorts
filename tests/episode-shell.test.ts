import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readContentEpisode } from "../src/contracts.js";
import {
  type EpisodeShellOptions,
  episodeShell,
  episodeStepper,
  episodeStepStates,
  reviewLockReason,
} from "../src/episode-shell.js";
import type { LibraryEntry } from "../src/library.js";
import { createLibraryPages } from "../src/library-review.js";
import { projectRoot } from "../src/paths.js";
import { withDeckShell } from "../src/presentation-deck.js";

const base: EpisodeShellOptions = {
  root: "../../",
  title: "Follow <the> money",
  id: "NEWS-10",
  selector: "NEWS-10@quality-review",
  meta: "Professional · Clear explainer",
  versions: [
    { selector: "NEWS-10@quality-review", label: "v2", stage: "review", latest: true },
    { selector: "NEWS-10", label: "v1", stage: "editing" },
  ],
  step: "review",
  hasVideo: true,
};

const steps = (html: string) =>
  [...html.matchAll(/<(a|span) class="ep-stp"([^>]*)>/gu)].map(([, tag, attributes = ""]) => ({
    tag,
    step: /data-step="([^"]+)"/u.exec(attributes)?.[1],
    state: /data-step-state="([^"]+)"/u.exec(attributes)?.[1],
    href: /href="([^"]+)"/u.exec(attributes)?.[1],
    current: attributes.includes('aria-current="step"'),
    editor: /data-editor-step="([^"]+)"/u.exec(attributes)?.[1],
  }));

test("step states follow the current step and lock Review & publish until an MP4 exists", () => {
  assert.deepEqual(episodeStepStates("script", false), {
    script: "current",
    voice: "todo",
    produce: "todo",
    review: "locked",
  });
  assert.deepEqual(episodeStepStates("produce", true), {
    script: "done",
    voice: "done",
    produce: "current",
    review: "todo",
  });
  assert.deepEqual(episodeStepStates("review", true), {
    script: "done",
    voice: "done",
    produce: "done",
    review: "current",
  });
  // Watch, video and deck pages have no current step.
  assert.deepEqual(episodeStepStates(null, true), {
    script: "done",
    voice: "done",
    produce: "done",
    review: "todo",
  });
  assert.deepEqual(episodeStepStates(null, false), {
    script: "todo",
    voice: "todo",
    produce: "todo",
    review: "locked",
  });
});

test("the stepper links to editor anchors and publish.html, marks the current step and explains locks", () => {
  const publish = steps(episodeStepper(base));
  assert.deepEqual(
    publish.map(({ step, state, href, current }) => [step, state, href, current]),
    [
      ["script", "done", "edit.html#scene-0-heading", false],
      ["voice", "done", "edit.html#voice-heading", false],
      ["produce", "done", "edit.html#companion-post-heading", false],
      ["review", "current", "publish.html", true],
    ],
  );
  const editor = episodeStepper({ ...base, step: "script", hasVideo: false, inPageEditor: true });
  const parsed = steps(editor);
  assert.deepEqual(
    parsed.map(({ tag, editor: pane, href, current }) => [tag, pane, href, current]),
    [
      ["a", "script", "#scene-0-heading", true],
      ["a", "voice", "#voice-heading", false],
      ["a", "review", "#companion-post-heading", false],
      ["span", undefined, undefined, false],
    ],
  );
  assert.match(
    editor,
    /<span class="ep-stp"[^>]*aria-disabled="true" title="Produce the video first">/u,
  );
  assert.ok(editor.includes(reviewLockReason));
  assert.match(editor, /<nav class="ep-steps" aria-label="Episode steps"><ol>/u);
  const video = steps(episodeStepper({ ...base, step: null, episodeDir: "../" }));
  assert.deepEqual(
    video.map(({ href }) => href),
    [
      "../edit.html#scene-0-heading",
      "../edit.html#voice-heading",
      "../edit.html#companion-post-heading",
      "../publish.html",
    ],
  );
});

test("the version switcher lists the story's versions as plain links and degrades without scripts", () => {
  const html = episodeShell(base);
  assert.match(html, /<header class="ep-shell">/u);
  assert.match(
    html,
    /<a class="ep-back" href="\.\.\/\.\.\/review\.html#episodes" aria-label="Back to Shorts">/u,
  );
  assert.match(html, /Follow &lt;the&gt; money/u);
  assert.doesNotMatch(html, /<the>/u);
  const menu = /<details class="ep-versions" data-version-menu>([\s\S]*?)<\/details>/u.exec(
    html,
  )?.[1];
  assert.ok(menu, "a native disclosure works without scripts");
  const links = [
    ...menu.matchAll(
      /<a href="([^"]+)" data-version-selector="([^"]+)"([^>]*)><b>(v\d+)<\/b>[\s\S]*?data-badge="([a-z]+)"/gu,
    ),
  ].map(([, href, selector, rest = "", label, stage]) => ({
    href,
    selector,
    label,
    stage,
    current: rest.includes("aria-current"),
  }));
  assert.deepEqual(links, [
    {
      href: "../../episodes/NEWS-10%40quality-review/publish.html",
      selector: "NEWS-10@quality-review",
      label: "v2",
      stage: "review",
      current: true,
    },
    {
      href: "../../episodes/NEWS-10/edit.html",
      selector: "NEWS-10",
      label: "v1",
      stage: "editing",
      current: false,
    },
  ]);
  assert.match(
    menu,
    /<summary class="ep-ver-chip"><span class="ep-sr">Version <\/span><b>v2<\/b> · <span data-version-current-stage data-selector="NEWS-10@quality-review">Video produced<\/span>/u,
  );
  const lone = episodeShell({
    ...base,
    versions: [{ selector: "NEWS-10@quality-review", label: "v1", stage: "editing" }],
  });
  assert.doesNotMatch(lone, /data-version-menu/u);
  assert.match(lone, /<span class="ep-ver-chip"/u);
});

test("the version menu closes with Escape and returns focus to its toggle", async () => {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  let focused = "";
  const summary = { focus: () => (focused = "summary") };
  const menu = {
    open: true,
    addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) =>
      listeners.set(name, callback),
    querySelector: () => summary,
    querySelectorAll: () => [],
    contains: () => false,
  };
  const context = {
    document: {
      querySelectorAll: (selector: string) => (selector === "[data-version-menu]" ? [menu] : []),
      addEventListener() {},
    },
    globalThis: {} as Record<string, unknown>,
  };
  context.globalThis = context as unknown as Record<string, unknown>;
  runInNewContext(
    await readFile(resolve(projectRoot, "templates/episode-shell.js"), "utf8"),
    context,
  );
  let prevented = false;
  listeners.get("keydown")?.({
    key: "Escape",
    preventDefault: () => (prevented = true),
    stopPropagation() {},
  });
  assert.equal(menu.open, false);
  assert.equal(prevented, true);
  assert.equal(focused, "summary");
});

async function shellScript(live: boolean, protocol = "http:") {
  const requests: string[] = [];
  const badge = {
    dataset: { badge: "review" } as Record<string, string>,
    textContent: "Video produced",
  };
  const link = {
    dataset: { versionSelector: "NEWS-10@quality-review" },
    querySelector: () => badge,
  };
  const chip = { dataset: { selector: "NEWS-10@quality-review" }, textContent: "Video produced" };
  const header = {
    hasAttribute: (name: string) => live && name === "data-live-stages",
    getBoundingClientRect: () => ({ height: 120 }),
    querySelector: () => null,
  };
  const context = {
    document: {
      querySelector: (selector: string) => (selector === ".ep-shell" ? header : null),
      querySelectorAll: (selector: string) =>
        selector === "[data-version-selector]"
          ? [link]
          : selector === "[data-version-current-stage]"
            ? [chip]
            : [],
      addEventListener() {},
      documentElement: { style: { setProperty() {} } },
    },
    location: { protocol },
    addEventListener() {},
    getComputedStyle: () => ({ position: "static" }),
    fetch: async (url: string, init?: { method?: string }) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      return {
        ok: true,
        json: async () => ({
          episodes: [{ selector: "NEWS-10@quality-review", stage: "publish", label: "To publish" }],
        }),
      };
    },
    globalThis: {} as Record<string, unknown>,
  };
  context.globalThis = context as unknown as Record<string, unknown>;
  runInNewContext(
    await readFile(resolve(projectRoot, "templates/episode-shell.js"), "utf8"),
    context,
  );
  for (let index = 0; index < 4; index++) await new Promise<void>((done) => setImmediate(done));
  return { requests, badge, chip };
}

test("live stages replace neutral build-time labels only where the page opts in", async () => {
  const live = await shellScript(true);
  assert.deepEqual(live.requests, ["GET /api/workflow"], "one read-only request");
  assert.equal(live.badge.textContent, "To publish");
  assert.equal(live.badge.dataset.badge, "publish");
  assert.equal(live.chip.textContent, "To publish");
  const deck = await shellScript(false);
  assert.deepEqual(deck.requests, [], "pages without connect-src 'self' never fetch");
  assert.equal(deck.badge.textContent, "Video produced");
  const offline = await shellScript(true, "file:");
  assert.deepEqual(offline.requests, []);
});

async function entry(selector: string, video = false): Promise<LibraryEntry> {
  const value: LibraryEntry = {
    episode: await readContentEpisode(selector),
    sourceReviewExpired: false,
    updatedAt: video ? "2026-10-28T10:00:00.000Z" : "2026-10-20T10:00:00.000Z",
    preview: {
      kind: "narrated",
      durationSeconds: 55,
      timingReady: true,
      sourceRunId: "fixture",
      sourceManifestHash: "fixture",
      mediaJobId: "fixture",
      updatedAt: new Date().toISOString(),
      files: {
        "review.html": Buffer.from("Narration player fixture"),
        "timing.json": Buffer.from(JSON.stringify({ engine: "kokoro", voice: "af_heart" })),
      },
    },
  };
  if (video)
    value.video = {
      renderKey: "a".repeat(64),
      durationSeconds: 55,
      files: {
        "review.html": Buffer.from(
          '<!doctype html><html><head><title>x</title></head><body><main><!--LIBRARY_BACK--><div class="links"></div></main></body></html>',
        ),
      },
    };
  return value;
}

test("every page of a version shares the header, the story's versions and the stepper", async () => {
  const produced = await entry("CAP-01@casual", true);
  const original = await entry("CAP-01");
  const deck =
    '<!doctype html><html><head></head><body><!--EPISODE_SHELL--><main><header class="presentation-heading"><a href="../../review.html#episodes">← Workspace</a><h1>Deck</h1></header><a href="edit.html#presentation">Enhance presentation with a prompt ↗</a></main></body></html>';
  produced.deck = { "presentation.html": deck };
  const pages = await createLibraryPages({
    entries: [produced, original],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  const prefix = "episodes/CAP-01@casual/";
  for (const name of [
    "edit.html",
    "publish.html",
    "watch.html",
    "video/review.html",
    "presentation.html",
  ]) {
    const html = String(pages[prefix + name]);
    assert.equal((html.match(/<header class="ep-shell/gu) ?? []).length, 1, name);
    assert.match(
      html,
      /data-version-selector="CAP-01@casual"[^>]*aria-current="true"><b>v2<\/b>/u,
      name,
    );
    assert.match(html, /data-version-selector="CAP-01"><b>v1<\/b>/u, name);
    assert.match(html, /<nav class="ep-steps" aria-label="Episode steps">/u, name);
  }
  // Build time cannot know approval or production, so static labels stay neutral.
  assert.match(String(pages[`${prefix}video/review.html`]), /data-version-stage>Video produced</u);
  assert.match(
    String(pages[`${prefix}presentation.html`]),
    /data-version-selector="CAP-01">[\s\S]*?data-version-stage>Draft</u,
  );
  for (const name of ["edit.html", "watch.html"])
    assert.match(
      String(pages[prefix + name]),
      /<header class="ep-shell[^"]*" data-live-stages>/u,
      name,
    );
  for (const name of ["publish.html", "video/review.html", "presentation.html"])
    assert.doesNotMatch(String(pages[prefix + name]), /<header [^>]*data-live-stages/u, name);
  const publish = String(pages[`${prefix}publish.html`]);
  assert.match(publish, /data-step="review"[^>]*data-step-state="current" aria-current="step"/u);
  assert.match(publish, /href="edit\.html#voice-heading"/u);
  const edit = String(pages[`${prefix}edit.html`]);
  assert.match(
    edit,
    /data-step="script"[^>]*data-step-state="current" aria-current="step" data-editor-step="script" href="#scene-0-heading"/u,
  );
  assert.match(edit, /data-step="review"[^>]*href="publish\.html"/u, "an MP4 unlocks step 4");
  const unproduced = String(pages["episodes/CAP-01/edit.html"]);
  assert.match(
    unproduced,
    /data-step="review"[^>]*data-step-state="locked"[^>]*aria-disabled="true"/u,
  );
  const watch = String(pages[`${prefix}watch.html`]);
  assert.match(
    watch,
    /href="publish\.html"><svg[^>]*>.*?<\/svg><span class="ep-label">Open Review &amp; publish/su,
  );
  assert.match(watch, /<iframe class="episode-frame" src="review.html"/u);
  const video = String(pages[`${prefix}video/review.html`]);
  assert.match(video, /<body class="ep-page"><header class="ep-shell">/u);
  assert.match(video, /href="\.\.\/publish\.html"/u);
  assert.doesNotMatch(video, /<script/u, "the copied player keeps its script-free CSP");
  const presentation = String(pages[`${prefix}presentation.html`]);
  assert.match(presentation, /<body data-episode-shell class="ep-page"><style>/u);
  assert.doesNotMatch(presentation, /← Workspace/u);
  assert.match(presentation, /Enhance presentation with a prompt/u);
  assert.equal(withDeckShell("<body>no marker</body>", "<header>", ""), "<body>no marker</body>");
});
