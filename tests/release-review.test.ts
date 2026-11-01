import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readContentEpisode } from "../src/contracts.js";
import type { LibraryEntry } from "../src/library.js";
import { projectRoot } from "../src/paths.js";
import { publishReview, reviewChecks } from "../src/publish-review.js";

class Node {
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  textContent = "";
  tabIndex = 0;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  constructor(readonly id = "") {}
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback);
  }
  click() {
    if (!this.disabled) this.listeners.get("click")?.();
  }
  tick() {
    this.checked = true;
    this.listeners.get("change")?.();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  reportValidity() {
    return true;
  }
  focus() {}
  scrollIntoView() {}
  querySelector() {
    return null;
  }
  select() {}
  replaceChildren() {}
}

async function releasePage() {
  const ids = [
    "release-state",
    "approve-video",
    "mbar-approve",
    "record-publication",
    "reopen-review",
    "publication-record",
    "publication-url",
    "release-message",
    "copy-post",
    "release-post",
    "release-approval",
    "release-post-step",
    "release-publication",
  ];
  const nodes = new Map(ids.map((id) => [id, new Node(id)]));
  const checks = ["speech", "face", "captions", "facts"].map(() => new Node());
  const note = new Node();
  const release = Object.assign(new Node("release-review"), {
    dataset: { selector: "NEWS-10@quality-review", renderKey: "f".repeat(64) } as Record<
      string,
      string
    >,
    querySelectorAll: (selector: string) => (selector === "[data-review-check]" ? checks : []),
    querySelector: (selector: string) => (selector === "[data-approved-note]" ? note : null),
  });
  const requests: { method: string; body?: unknown }[] = [];
  const state = {
    selector: release.dataset.selector,
    renderKey: release.dataset.renderKey,
    stage: "review",
    label: "To review",
    record: null,
    reviewBlocked: false,
  };
  const body = { dataset: {} as Record<string, string> };
  const context = {
    document: {
      body,
      querySelector: (selector: string) => (selector === "#release-review" ? release : null),
      getElementById: (id: string) => nodes.get(id) ?? null,
      createElement: () => new Node(),
      createTextNode: () => ({}),
    },
    fetch: async (_url: string, init?: { method?: string; body?: string }) => {
      requests.push({
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(init.body) } : {}),
      });
      const json =
        init?.method === "POST"
          ? {
              ...state,
              stage: "publish",
              label: "To publish",
              record: { reviewedAt: "2026-10-28" },
            }
          : { episodes: [state] };
      return { ok: true, json: async () => json };
    },
    navigator: {},
    globalThis: {} as Record<string, unknown>,
  };
  context.globalThis = context as unknown as Record<string, unknown>;
  runInNewContext(await readFile(resolve(projectRoot, "templates/library.js"), "utf8"), context);
  const settle = async () => {
    for (let index = 0; index < 4; index++) await new Promise<void>((done) => setImmediate(done));
  };
  await settle();
  return { node: (id: string) => nodes.get(id) as Node, checks, requests, body, settle };
}

test("Approve video stays disabled until all four checks are ticked and sends the unchanged request", async () => {
  const page = await releasePage();
  assert.equal(page.body.dataset.releaseStage, "review");
  assert.equal(page.node("approve-video").disabled, true);
  for (const check of page.checks.slice(0, 3)) {
    check.tick();
    assert.equal(page.node("approve-video").disabled, true, "every check is required");
    assert.equal(page.node("mbar-approve").disabled, false, "phone action reaches the checks");
    page.node("mbar-approve").click();
    assert.equal(page.requests.filter((request) => request.method === "POST").length, 0);
  }
  assert.equal(page.node("release-post-step").dataset.stepState, "locked");
  assert.equal(page.node("release-publication").dataset.stepState, "locked");
  page.checks[3]?.tick();
  assert.equal(page.node("approve-video").disabled, false);
  assert.equal(page.node("mbar-approve").disabled, false, "the phone action mirrors the gate");
  page.node("mbar-approve").click();
  await page.settle();
  const posts = page.requests.filter((request) => request.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0]?.body, {
    selector: "NEWS-10@quality-review",
    renderKey: "f".repeat(64),
    action: "approve",
    reviewed: true,
    url: "",
  });
  // Approval unlocks the following steps exactly as the workflow state allows.
  assert.equal(page.body.dataset.releaseStage, "publish");
  assert.equal(page.node("release-approval").dataset.stepState, "done");
  assert.equal(page.node("release-post-step").dataset.stepState, "current");
  assert.equal(page.node("release-publication").dataset.stepState, "todo");
  assert.equal(page.node("record-publication").disabled, false);
  assert.equal(page.node("reopen-review").hidden, false);
});

test("Review & publish renders four concrete checks, the dated source window, tabs and locked steps", async () => {
  const episode = await readContentEpisode("NEWS-02@duo");
  const entry: LibraryEntry = {
    episode,
    sourceReviewExpired: false,
    preview: {
      kind: "narrated",
      durationSeconds: 47.6,
      timingReady: true,
      sourceRunId: "fixture",
      sourceManifestHash: "fixture",
      mediaJobId: "fixture",
      updatedAt: "2026-10-28T10:00:00.000Z",
      files: {
        "timing.json": Buffer.from(
          JSON.stringify({
            engine: "kokoro",
            voice: "af_heart",
            scenes: episode.scenes.map((scene) => ({
              id: scene.id,
              startSeconds: scene.startSeconds,
              endSeconds: scene.endSeconds,
              speechSeconds: 1,
            })),
          }),
        ),
      },
    },
    video: { renderKey: "f".repeat(64), durationSeconds: 47.6, files: {} },
  };
  const html = publishReview(entry, "", "", "");
  assert.deepEqual(
    [...html.matchAll(/data-review-check="([a-z]+)"/gu)].map(([, id]) => id),
    ["speech", "face", "captions", "facts"],
  );
  assert.doesNotMatch(html, /id="review-confirmed"/u);
  assert.match(
    html,
    /Facts match the sources<small>\d+ sources? · review valid through 2026-10-22 \(UTC\)/u,
  );
  assert.equal(reviewChecks(entry).length, 4);
  assert.match(html, /<button type="button" class="primary-action" id="approve-video" disabled>/u);
  assert.match(
    html,
    /<a class="text-action" href="edit.html">.*?Needs changes · edit as new version<\/a>/su,
  );
  assert.match(html, /id="reopen-review" hidden>Return to review \/ clear publication record/u);
  assert.match(
    html,
    /<div class="rv-tablist" role="tablist" aria-label="About this video" hidden>/u,
  );
  for (const panel of ["transcript", "sources", "details"])
    assert.match(html, new RegExp(`<section class="rv-panel" id="release-panel-${panel}"`, "u"));
  assert.equal((html.match(/<section[^>]*data-news-review-notice/gu) ?? []).length, 1);
  assert.equal((html.match(/data-seek="/gu) ?? []).length, episode.scenes.length);
  assert.match(html, /<ol class="rv-chapters" data-chapters hidden aria-label="Chapters">/u);
  assert.match(html, /id="release-post-count">Social post preview · [\d,]+ \/ 3,000 characters/u);
  assert.match(html, /<button type="button" class="secondary-action" id="copy-post">/u);
  assert.match(html, /<input type="url" id="publication-url"/u);
  // Without scripts no step is marked locked, so downloads and the URL field stay reachable.
  assert.doesNotMatch(html, /data-step-state=/u);
});
