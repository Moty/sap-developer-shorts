import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { projectRoot } from "../src/paths.js";

type Kids = Record<string, El | El[]>;

class El {
  hidden = false;
  textContent = "";
  href = "";
  value = "";
  attributes = new Map<string, string>();
  classes = new Set<string>();
  childNodes: unknown[] = [];
  classList = {
    toggle: (name: string, on: boolean) =>
      on ? this.classes.add(name) : this.classes.delete(name),
  };
  constructor(
    public dataset: Record<string, string> = {},
    private kids: Kids = {},
  ) {}
  querySelector(selector: string) {
    const found = this.kids[selector];
    return Array.isArray(found) ? found[0] : found;
  }
  querySelectorAll(selector: string) {
    const found = this.kids[selector];
    return found === undefined ? [] : Array.isArray(found) ? found : [found];
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  addEventListener() {}
  focus() {}
  replaceChildren() {}
}

function versionRow(selector: string, label: string, stage: string, updated: string) {
  const badge = new El({ badge: stage });
  const action = new El();
  const issue = new El();
  const row = new El(
    {
      selector,
      stage,
      updated,
      attention: "false",
      label: stage === "review" ? "To review" : "Editing",
      next: "",
      issue: "",
      productionStage: "",
      actionLabel: "",
      shortLabel: "",
      actionHref: "",
      validThrough: "",
      sourcesExpired: "false",
      versionLabel: label,
      title: "Story",
      news: "false",
      search: selector.toLowerCase(),
    },
    {
      "[data-version-stage]": badge,
      "[data-version-action]": action,
      "[data-version-issue]": issue,
      "[data-row-extras]": new El(),
    },
  );
  return { row, badge, action };
}

function storyRow(id: string, rows: ReturnType<typeof versionRow>[]) {
  const parts = {
    badge: new El(),
    next: new El(),
    action: new El(),
    issue: new El(),
    extras: new El(),
  };
  const story = new El(
    { story: id, title: "Story", versions: String(rows.length), stages: "", attention: "false" },
    {
      "[data-version]": rows.map((item) => item.row),
      "[data-work-stage]": parts.badge,
      "[data-work-next]": parts.next,
      "[data-work-action]": parts.action,
      "[data-work-issue]": parts.issue,
      "[data-story-extras]": parts.extras,
      ".versions": new El(),
    },
  );
  return { story, ...parts };
}

test("a workflow poll updates story rows, versions, stages and stage counts, honouring superseded reviews", async () => {
  const old = versionRow("CAP-01", "v1", "review", "2026-10-01T10:00:00.000Z");
  const fresh = versionRow("CAP-01@next", "v2", "editing", "2026-10-02T10:00:00.000Z");
  const cap = storyRow("CAP-01", [old, fresh]);
  const busy = versionRow("NEWS-01", "v1", "editing", "2026-10-03T10:00:00.000Z");
  const news = storyRow("NEWS-01", [busy]);
  const quiet = versionRow("NEWS-02", "v1", "editing", "2026-10-04T10:00:00.000Z");
  const other = storyRow("NEWS-02", [quiet]);
  const stories = [cap.story, news.story, other.story];
  const counts = Object.fromEntries(
    ["all", "editing", "producing", "review", "publish", "published"].map((stage) => [
      stage,
      new El({ stageCount: stage }),
    ]),
  );
  const single = new Map<string, El>(
    [
      "#episode-search",
      "#clear-search",
      "#filter-status",
      "#no-episodes",
      "#reset-filters",
      "[data-enhancement-only]",
      "#workflow-sync",
    ].map((selector) => [selector, new El()]),
  );
  const all = [old, fresh, busy, quiet].map((item) => item.row);
  const context: Record<string, unknown> = {
    document: {
      hidden: true,
      querySelector: (selector: string) => single.get(selector),
      querySelectorAll: (selector: string) =>
        selector === ".story"
          ? stories
          : selector === "[data-version]"
            ? all
            : selector === "[data-stage-count]"
              ? Object.values(counts)
              : [],
      addEventListener() {},
    },
    window: { location: { hash: "" }, addEventListener() {} },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        activeJob: null,
        episodes: [
          // The newer version was approved: the older, unreviewed video is superseded.
          { selector: "CAP-01", stage: "review", label: "To review", attention: false },
          { selector: "CAP-01@next", stage: "publish", label: "To publish", attention: false },
          {
            selector: "NEWS-01",
            stage: "producing",
            label: "Producing",
            attention: false,
            productionStage: "RENDER",
          },
          {
            selector: "NEWS-02",
            stage: "editing",
            label: "Ready to retry",
            attention: true,
            issue: "Stopped on old timing limits.",
            productionStage: "BLOCKED",
          },
        ],
      }),
    }),
    setInterval() {},
    setTimeout() {},
  };
  runInNewContext(
    await readFile(resolve(projectRoot, "templates/library-stories.js"), "utf8"),
    context,
  );
  runInNewContext(await readFile(resolve(projectRoot, "templates/library.js"), "utf8"), context);
  await new Promise<void>((done) => setImmediate(done));
  await new Promise<void>((done) => setImmediate(done));

  // CAP-01: the superseded review loses to the approved version.
  assert.equal(cap.story.dataset.rep, "CAP-01@next");
  assert.equal(cap.badge.textContent, "To publish");
  assert.equal(cap.badge.dataset.badge, "publish");
  assert.equal(cap.action.textContent, "Finish publishing");
  assert.equal(cap.action.href, "episodes/CAP-01%40next/publish.html");
  assert.equal(cap.story.dataset.stages, "publish");
  assert.equal(cap.next.textContent, "Approved · ready to post");
  // Each version row keeps its own stage, short label and link.
  assert.equal(old.badge.textContent, "To review");
  assert.equal(old.action.textContent, "Review");
  assert.equal(old.action.href, "episodes/CAP-01/publish.html");
  assert.equal(fresh.badge.textContent, "To publish");
  assert.equal(fresh.action.textContent, "Finish");
  assert.equal(fresh.action.attributes.get("aria-label"), "Finish publishing · v2");
  // A running job points to the production banner.
  assert.equal(news.story.dataset.rep, "NEWS-01");
  assert.equal(news.badge.textContent, "Producing");
  assert.equal(news.action.textContent, "View progress");
  assert.equal(news.action.href, "#studio-produce-banner");
  assert.equal(news.story.dataset.stages, "producing");
  // A blocked editing version offers the fix, flags attention and shows its issue.
  assert.equal(other.action.textContent, "Fix saved version");
  assert.equal(other.action.href, "episodes/NEWS-02/edit.html");
  assert.equal(other.story.dataset.attention, "true");
  assert.equal(other.issue.hidden, false);
  assert.equal(other.issue.textContent, "Stopped on old timing limits.");
  assert.equal(quiet.action.textContent, "Fix");
  // Pipeline counts are stories with a version in the stage; the superseded review is not counted.
  assert.deepEqual(
    Object.fromEntries(Object.entries(counts).map(([stage, node]) => [stage, node.textContent])),
    { all: "3", editing: "1", producing: "1", review: "0", publish: "1", published: "0" },
  );
  assert.equal(single.get("#workflow-sync")?.textContent, "Live status · saved on this Mac");
});
