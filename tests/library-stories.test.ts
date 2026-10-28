import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readContentEpisode } from "../src/contracts.js";
import type { LibraryEntry } from "../src/library.js";
import { createLibraryPages } from "../src/library-review.js";
import {
  activeVersions,
  chronologicalVersions,
  groupStories,
  pickRepresentative,
  type StoryVersion,
  stageCounts,
  versionLabels,
  type WorkStage,
  workAction,
} from "../src/library-stories.js";
import { readNewsEpisode } from "../src/news/contracts.js";
import { projectRoot } from "../src/paths.js";

const version = (
  id: string,
  selector: string,
  stage: WorkStage,
  updatedAt: string,
  attention = false,
): StoryVersion => ({ id, selector, stage, updatedAt, attention });

const fixture: StoryVersion[] = [
  version("CAP-01", "CAP-01", "review", "2026-10-01T10:00:00.000Z"),
  version("NEWS-01", "NEWS-01", "editing", "2026-10-05T10:00:00.000Z"),
  version("CAP-01", "CAP-01@casual", "editing", "2026-10-03T10:00:00.000Z", true),
  version("CAP-01", "CAP-01@casual-edit", "review", "2026-10-04T10:00:00.000Z"),
  version("NEWS-01", "NEWS-01@my-edit", "published", "2026-10-06T10:00:00.000Z"),
  version("CAP-02", "CAP-02", "producing", "2026-09-01T10:00:00.000Z"),
];

test("versions are grouped into one story per episode id, newest version first", () => {
  const stories = groupStories(fixture);
  assert.deepEqual(
    stories.map((story) => story.id),
    ["CAP-01", "NEWS-01", "CAP-02"],
  );
  assert.deepEqual(
    stories[0]?.versions.map((item) => item.selector),
    ["CAP-01@casual-edit", "CAP-01@casual", "CAP-01"],
  );
  assert.equal(stories[0]?.latest.selector, "CAP-01@casual-edit");
  assert.equal(stories[0]?.attention, true);
  assert.equal(stories[1]?.attention, false);
  assert.deepEqual(stories[0]?.stages, ["editing", "review"]);
});

test("versions are labelled v1…vN by update time with the unvarianted original first on a tie", () => {
  const tied = [
    version("CAP-01", "CAP-01@b", "editing", "2026-10-01T10:00:00.000Z"),
    version("CAP-01", "CAP-01@a", "editing", "2026-10-01T10:00:00.000Z"),
    version("CAP-01", "CAP-01", "editing", "2026-10-01T10:00:00.000Z"),
    version("CAP-01", "CAP-01@late", "editing", "2026-10-09T10:00:00.000Z"),
    version("CAP-01", "CAP-01@early", "editing", "2026-09-09T10:00:00.000Z"),
  ];
  assert.deepEqual(Object.fromEntries(versionLabels(tied)), {
    "CAP-01@early": "v1",
    "CAP-01": "v2",
    "CAP-01@a": "v3",
    "CAP-01@b": "v4",
    "CAP-01@late": "v5",
  });
  assert.deepEqual(
    chronologicalVersions(tied).map((item) => item.selector),
    ["CAP-01@early", "CAP-01", "CAP-01@a", "CAP-01@b", "CAP-01@late"],
  );
  assert.deepEqual(Object.fromEntries(versionLabels([])), {});
});

test("the representative is the most advanced actionable version: Producing > To review > To publish > Editing > Published", () => {
  const at = (day: number) => `2026-10-0${day}T10:00:00.000Z`;
  const pick = (...stages: WorkStage[]) =>
    pickRepresentative(
      stages.map((stage, index) => version("X-01", `X-01@v${index}`, stage, at(index + 1))),
    ).selector;
  assert.equal(pick("editing", "review", "published", "producing", "publish"), "X-01@v3");
  // A review older than an approval is superseded; one newer than it still wins.
  assert.equal(pick("editing", "review", "published", "publish"), "X-01@v3");
  assert.equal(pick("editing", "published", "publish", "review"), "X-01@v3");
  assert.equal(pick("editing", "published", "publish", "editing"), "X-01@v2");
  assert.equal(pick("published", "editing", "published"), "X-01@v1");
  assert.equal(pick("published", "published"), "X-01@v1");
  // Ties go to the most recent update, not to list order.
  assert.equal(
    pickRepresentative([
      version("X-01", "X-01@new", "review", at(5)),
      version("X-01", "X-01@old", "review", at(2)),
    ]).selector,
    "X-01@new",
  );
  assert.equal(
    pickRepresentative([
      version("X-01", "X-01@old", "editing", at(2)),
      version("X-01", "X-01@new", "editing", at(7)),
      version("X-01", "X-01@mid", "editing", at(4)),
    ]).selector,
    "X-01@new",
  );
  assert.equal(pickRepresentative([version("X-01", "X-01", "editing", at(1))]).selector, "X-01");
  assert.throws(() => pickRepresentative([]), /at least one version/u);
  assert.equal(groupStories(fixture)[2]?.representative.selector, "CAP-02");
  assert.equal(groupStories(fixture)[0]?.representative.selector, "CAP-01@casual-edit");
  assert.equal(groupStories(fixture)[1]?.representative.selector, "NEWS-01");
});

test("stage counts are numbers of stories with at least one version in the stage", () => {
  const counts = stageCounts(groupStories(fixture));
  assert.deepEqual(counts, {
    all: 3,
    editing: 2,
    producing: 1,
    review: 1,
    publish: 0,
    published: 1,
  });
});

test("actions follow the stage and keep the existing labels", () => {
  assert.deepEqual(workAction("editing", "NEWS-01@a b"), {
    label: "Continue editing",
    shortLabel: "Edit",
    href: "episodes/NEWS-01%40a%20b/edit.html",
  });
  assert.equal(workAction("editing", "X", { blocked: true }).label, "Fix saved version");
  assert.equal(workAction("review", "X").label, "Review video");
  assert.equal(workAction("publish", "X").label, "Finish publishing");
  assert.equal(workAction("published", "X").label, "View publication");
  assert.deepEqual(workAction("producing", "X"), {
    label: "View progress",
    shortLabel: "Progress",
    href: "#studio-produce-banner",
  });
});

type Shared = {
  pickRepresentative(versions: unknown[]): { selector: string };
  versionLabels(versions: unknown[]): Map<string, string>;
  workAction(stage: string, selector: string, options?: object): object;
  needsYou(stories: unknown[], options?: object): Card[];
  chronological(versions: unknown[]): { selector: string }[];
  activeVersions(versions: unknown[]): { selector: string }[];
};
type Card = {
  kind: string;
  story?: string;
  title: string;
  detail: string;
  action: { label: string; href: string };
};

async function browserModule(): Promise<Shared> {
  const context: { shortsStories?: Shared } = {};
  runInNewContext(
    await readFile(resolve(projectRoot, "templates/library-stories.js"), "utf8"),
    context,
  );
  assert.ok(context.shortsStories);
  return context.shortsStories;
}

test("the browser mirror agrees with the server rules for the same versions", async () => {
  const mirror = await browserModule();
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  const sets: StoryVersion[][] = [
    fixture.filter((item) => item.id === "CAP-01"),
    fixture.filter((item) => item.id === "NEWS-01"),
    [
      version("A-01", "A-01@z", "editing", "2026-10-01T10:00:00.000Z"),
      version("A-01", "A-01", "editing", "2026-10-01T10:00:00.000Z"),
      version("A-01", "A-01@a", "published", "2026-10-02T10:00:00.000Z"),
      version("A-01", "A-01@b", "publish", "2026-10-02T10:00:00.000Z"),
    ],
  ];
  for (const set of sets) {
    assert.deepEqual(mirror.pickRepresentative(set).selector, pickRepresentative(set).selector);
    assert.deepEqual(
      Object.fromEntries(mirror.versionLabels(set)),
      Object.fromEntries(versionLabels(set)),
    );
    assert.deepEqual(
      json(mirror.chronological(set).map((item) => item.selector)),
      chronologicalVersions(set).map((item) => item.selector),
    );
  }
  for (const stage of ["editing", "producing", "review", "publish", "published"] as const)
    for (const blocked of [false, true])
      assert.deepEqual(
        json(mirror.workAction(stage, "CAP-01@x y", { blocked })),
        workAction(stage, "CAP-01@x y", { blocked }),
      );
});

type Row = {
  selector: string;
  stage: string;
  updatedAt: string;
  versionLabel: string;
  actionHref: string;
  actionLabel: string;
  productionStage: string;
  label: string;
  issue: string;
  news: boolean;
  sourcesExpired: boolean;
  validThrough: string;
};
const row = (
  selector: string,
  stage: string,
  updatedAt: string,
  extra: Partial<Row> = {},
): Row => ({
  selector,
  stage,
  updatedAt,
  versionLabel: "v1",
  actionHref: `episodes/${selector}/publish.html`,
  actionLabel: "Review video",
  productionStage: "",
  label: "",
  issue: "",
  news: false,
  sourcesExpired: false,
  validThrough: "",
  ...extra,
});

test("Needs you lists at most three cards drawn from live version data", async () => {
  const mirror = await browserModule();
  const now = new Date("2026-10-20T12:00:00Z");
  const cards = (stories: unknown[], options: object = {}) =>
    JSON.parse(JSON.stringify(mirror.needsYou(stories, { now, ...options }))) as Card[];
  assert.deepEqual(cards([]), []);
  assert.deepEqual(
    cards([{ id: "A-01", title: "A", versions: [row("A-01", "editing", "2026-10-01T00:00:00Z")] }]),
    [],
  );

  const review = (id: string, day: string) => ({
    id,
    title: id,
    versions: [row(id, "review", `2026-10-${day}T00:00:00Z`)],
  });
  // Oldest waiting first.
  assert.deepEqual(
    cards([review("A-03", "09"), review("A-01", "02"), review("A-02", "05")]).map(
      (card) => card.story,
    ),
    ["A-01", "A-02", "A-03"],
  );

  // A newer approved version supersedes an old unreviewed video.
  assert.deepEqual(
    cards([
      {
        id: "A-01",
        title: "A",
        versions: [
          row("A-01", "review", "2026-10-01T00:00:00Z"),
          row("A-01@done", "published", "2026-10-03T00:00:00Z"),
        ],
      },
    ]),
    [],
  );

  const retry = {
    id: "B-01",
    title: "Retry me",
    versions: [
      row("B-01", "editing", "2026-10-04T00:00:00Z", {
        productionStage: "BLOCKED",
        label: "Ready to retry",
        issue: "Stopped on old timing limits.",
      }),
    ],
  };
  const expiring = {
    id: "NEWS-01",
    title: "Expiring news",
    versions: [
      row("NEWS-01", "editing", "2026-10-04T00:00:00Z", { news: true, validThrough: "2026-10-22" }),
    ],
  };
  const expired = {
    id: "NEWS-02",
    title: "Expired news",
    versions: [
      row("NEWS-02", "review", "2026-10-02T00:00:00Z", { news: true, validThrough: "2026-10-10" }),
    ],
  };
  const later = {
    id: "NEWS-03",
    title: "Far away",
    versions: [
      row("NEWS-03", "editing", "2026-10-04T00:00:00Z", { news: true, validThrough: "2026-10-30" }),
    ],
  };
  const picked = cards(
    [review("A-01", "02"), review("A-02", "03"), retry, expiring, expired, later],
    {
      ideas: 2,
    },
  );
  // One card per kind before any kind gets a second card; ideas lose to the three older kinds.
  assert.deepEqual(
    picked.map((card) => [card.title, card.action.label]),
    [
      ["Review “A-01”", "Review video"],
      ["Retry “Retry me”", "Open to retry"],
      ["Recheck sources for “Expiring news”", "Open to recheck"],
    ],
  );
  assert.match(picked[2]?.detail ?? "", /ends in 2 days \(2026-10-22\)/u);
  // Expired sources replace the review card: the video cannot be approved until rechecked.
  const onlyExpired = cards([expired]);
  assert.equal(onlyExpired.length, 1);
  assert.equal(onlyExpired[0]?.title, "Recheck sources for “Expired news”");
  assert.match(onlyExpired[0]?.detail ?? "", /window has ended/u);
  // The stories-without-a-short count appears when there is room, and only when positive.
  assert.deepEqual(
    cards([], { ideas: 3 }).map((card) => [card.title, card.action.href]),
    [["3 official SAP stories without a short", "#ideas"]],
  );
  assert.deepEqual(cards([], { ideas: 0 }), []);
  assert.equal(
    cards([review("A-01", "01"), review("A-02", "02"), review("A-03", "03"), review("A-04", "04")])
      .length,
    3,
  );
});

async function entries(): Promise<LibraryEntry[]> {
  const news = await readNewsEpisode("NEWS-01");
  const originals = [
    await readContentEpisode("CAP-01"),
    await readContentEpisode("CAP-01@casual"),
    await readContentEpisode("CAP-01@duo"),
    news,
  ];
  return originals.map((episode, index) => ({
    episode,
    preview: null,
    sourceReviewExpired: false,
    updatedAt: `2026-10-0${index + 1}T10:00:00.000Z`,
  }));
}

test("the workspace renders one story row per episode with every version reachable without JavaScript", async () => {
  const files = await createLibraryPages({
    entries: await entries(),
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  const html = String(files["review.html"]);
  assert.equal((html.match(/<article class="story"/gu) ?? []).length, 2);
  assert.equal((html.match(/<div class="vrow" role="row" data-version/gu) ?? []).length, 4);
  assert.match(html, /2 stories · 4 versions/u);
  assert.match(html, /data-stage-count="all">2</u);
  assert.match(html, /data-stage-count="editing">2</u);
  assert.match(html, /data-stage-count="review">0</u);
  // Drawers are rendered open and without the hidden attribute; scripts collapse them.
  assert.doesNotMatch(html, /<div class="versions"[^>]*hidden/u);
  assert.match(
    html,
    /<button type="button" class="ver-btn"[^>]*aria-expanded="true"[^>]*aria-controls="versions-CAP-01"[^>]*hidden/u,
  );
  assert.match(html, /<span class="ver-static">3 versions<\/span>/u);
  // The real selectors stay visible beside the friendly labels, newest first.
  assert.match(
    html,
    /<b>v3<\/b><span class="latest-chip">Latest<\/span>[\s\S]*?<code class="vsel" title="CAP-01@duo">CAP-01@duo<\/code>/u,
  );
  assert.match(html, /<code class="vsel" title="CAP-01">CAP-01<\/code>/u);
  assert.match(html, /<code class="vsel" title="CAP-01@casual">CAP-01@casual<\/code>/u);
  assert.ok(html.indexOf("CAP-01@duo</code>") < html.indexOf("CAP-01@casual</code>"));
  // One primary action per story: Continue editing for a story with no video.
  assert.equal(
    (html.match(/data-work-action href="episodes\/[^"]+\/edit\.html">Continue editing</gu) ?? [])
      .length,
    2,
  );
  assert.match(html, /<section id="needs-you"[^>]*hidden>/u);
  assert.doesNotMatch(html, /pipeline-tabs|class="episode-card/u);
});

test("a review that a newer approved or published version supersedes no longer wins the story", async () => {
  const mirror = await browserModule();
  const at = (day: number) => `2026-10-0${day}T10:00:00.000Z`;
  const set = [
    version("X-01", "X-01", "review", at(1)),
    version("X-01", "X-01@approved", "publish", at(3)),
    version("X-01", "X-01@draft", "editing", at(4)),
    version("X-01", "X-01@fresh", "review", at(5)),
  ];
  // The v1 review is older than the approval; the v4 review is newer and stays actionable.
  assert.deepEqual(
    activeVersions(set).map((item) => item.selector),
    ["X-01@approved", "X-01@draft", "X-01@fresh"],
  );
  assert.equal(pickRepresentative(set).selector, "X-01@fresh");
  const superseded = [set[0], set[1], set[2]] as StoryVersion[];
  assert.equal(pickRepresentative(superseded).selector, "X-01@approved");
  const [story] = groupStories(superseded);
  assert.deepEqual(story?.stages, ["editing", "publish"]);
  assert.deepEqual(stageCounts(groupStories(superseded)).review, 0);
  assert.equal(stageCounts(groupStories(set)).review, 1);
  // Labels still cover every saved version.
  assert.equal(story?.labels.size, 3);
  assert.equal(mirror.pickRepresentative(superseded).selector, "X-01@approved");
  assert.equal(mirror.pickRepresentative(set).selector, "X-01@fresh");
  assert.deepEqual(
    JSON.parse(JSON.stringify(mirror.activeVersions(set).map((item) => item.selector))),
    ["X-01@approved", "X-01@draft", "X-01@fresh"],
  );
  // A story whose only versions are old reviews and a published one shows the publication.
  assert.equal(
    pickRepresentative([
      version("X-02", "X-02", "review", at(1)),
      version("X-02", "X-02@live", "published", at(2)),
    ]).selector,
    "X-02@live",
  );
});
