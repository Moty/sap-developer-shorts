import assert from "node:assert/strict";
import test from "node:test";
import {
  existingShortLabel,
  findExistingShort,
  indexExistingShorts,
  normalizeStoryTitle,
  normalizeStoryUrl,
  type ShortSummary,
  storyCardHtml,
  storyFit,
} from "../src/news/story-fit.js";

const story = {
  link: "https://news.sap.com/2026/10/joule-assistants-agents/",
  title: "SAP Expands Joule: Assistants & Agents",
  publishedIso: "2026-10-08",
  categories: ["Artificial Intelligence", "Customers"],
  relevanceScore: 113,
  angleSuggestion: "Explain the capability.",
};

const short = (overrides: Partial<ShortSummary>): ShortSummary => ({
  id: "NEWS-06",
  title: "Something else",
  sourceUrls: [story.link],
  versions: 8,
  href: "episodes/NEWS-06/edit.html",
  kind: "short",
  ...overrides,
});

test("scores map to a five-step fit meter with plain labels", () => {
  assert.deepEqual(
    [181, 160, 149, 125, 113, 99, 90, 89, 50, 49, -10].map((score) => storyFit(score).steps),
    [5, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1],
  );
  assert.deepEqual(
    [181, 147, 99, 60, 12].map((score) => storyFit(score).label),
    ["High", "Good", "Good", "Low", "Low"],
  );
});

test("story URLs and titles are compared without protocol, query, slash or punctuation noise", () => {
  assert.equal(
    normalizeStoryUrl("http://www.news.sap.com/2026/10/story/?utm=x#top"),
    normalizeStoryUrl("https://news.sap.com/2026/10/story"),
  );
  assert.equal(
    normalizeStoryTitle("SAP  Expands Joule: Assistants & Agents!"),
    "sap expands joule assistants agents",
  );
});

test("an existing short is matched by sole source URL, falling back to title", () => {
  const index = indexExistingShorts([
    short({}),
    short({ id: "NEWS-01", sourceUrls: [story.link, "https://www.sap.com/guide"], versions: 12 }),
  ]);
  assert.equal(findExistingShort(index, story)?.id, "NEWS-06");
  assert.equal(
    findExistingShort(index, { link: "https://news.sap.com/other", title: "x" }),
    undefined,
  );
  const byTitle = indexExistingShorts([
    short({ id: "NEWS-02", title: "SAP expands Joule - assistants & agents?", sourceUrls: [] }),
  ]);
  assert.equal(
    findExistingShort(byTitle, { link: "https://news.sap.com/changed", title: story.title })?.id,
    "NEWS-02",
  );
  assert.equal(
    findExistingShort(byTitle, { link: "https://news.sap.com/changed", title: "Different" }),
    undefined,
  );
});

test("an identical title beats a shared source and the first summary wins ties", () => {
  const index = indexExistingShorts([
    short({ id: "NEWS-09", title: story.title }),
    short({ id: "NEWS-10", title: "SAP finance: follow the money" }),
  ]);
  assert.equal(findExistingShort(index, story)?.id, "NEWS-09");
  assert.equal(findExistingShort(index, { ...story, title: "Renamed" })?.id, "NEWS-09");
});

test("a saved title shortened from the story title still matches", () => {
  const long = {
    ...story,
    title:
      "SAP Advances Finance Operations with Embedded Payments, New Consolidation Capabilities, and Expanded AI",
  };
  const index = indexExistingShorts([
    short({ id: "NEWS-10", title: "SAP finance: follow the money" }),
    short({ id: "NEWS-09", title: "SAP Advances Finance Operations with Embedded Payments, New" }),
  ]);
  assert.equal(findExistingShort(index, long)?.id, "NEWS-09");
  assert.equal(
    findExistingShort(indexExistingShorts([short({ title: "Short title", sourceUrls: [] })]), {
      link: "https://news.sap.com/x",
      title: "Short title with more words",
    }),
    undefined,
  );
});

test("a hand-written title never matches a longer headline that merely starts with it", () => {
  const headline = {
    link: "https://news.sap.com/2026/09/bdc-connect-databricks/",
    title: "SAP Business Data Cloud Connect for Databricks Now Generally Available",
  };
  const index = indexExistingShorts([
    short({
      id: "NEWS-11",
      title: "SAP Business Data Cloud",
      sourceUrls: ["https://news.sap.com/2026/09/bdc-a/"],
    }),
    short({ id: "NEWS-12", title: "SAP Business Data Cloud", sourceUrls: [] }),
  ]);
  assert.equal(findExistingShort(index, headline), undefined);
});

test("a different single source URL blocks title matching", () => {
  const index = indexExistingShorts([
    short({
      id: "NEWS-13",
      title: story.title,
      sourceUrls: ["https://news.sap.com/2026/10/other/"],
    }),
  ]);
  assert.equal(findExistingShort(index, story), undefined);
  const same = indexExistingShorts([short({ id: "NEWS-13", title: story.title })]);
  assert.equal(findExistingShort(same, story)?.id, "NEWS-13");
});

test("ellipsis-truncated titles match on a word boundary only", () => {
  const index = indexExistingShorts([
    short({ id: "NEWS-14", title: "How Joule Work and SAP Business AI…", sourceUrls: [] }),
  ]);
  assert.equal(
    findExistingShort(index, {
      link: "https://news.sap.com/z",
      title: "How Joule Work and SAP Business AI Platform Power the Next Generation",
    })?.id,
    "NEWS-14",
  );
  assert.equal(
    findExistingShort(index, {
      link: "https://news.sap.com/z",
      title: "How Joule Work and SAP Business AIX Platform",
    }),
    undefined,
  );
});

test("story cards offer one primary action only when no short exists", () => {
  const fresh = storyCardHtml(story);
  assert.match(fresh, /class="create-short-from-news-btn primary-action"[^>]*>.*Start short/u);
  assert.doesNotMatch(fresh, /story-existing|New angle|Score:/u);
  assert.match(fresh, /title="Fit score 113"/u);
  assert.match(fresh, /aria-label="Good fit for a short \(score 113\)"/u);
  assert.equal((fresh.match(/<i class="on">/gu) ?? []).length, 3);

  const existing = storyCardHtml(story, {
    id: "NEWS-06",
    versions: 8,
    href: "episodes/NEWS-06/edit.html",
    kind: "short",
  });
  assert.match(existing, /Already a short · NEWS-06 · 8 versions/u);
  assert.match(existing, /<a href="episodes\/NEWS-06\/edit\.html">Open<\/a>/u);
  assert.match(existing, /class="create-short-from-news-btn secondary-action"[^>]*>New angle/u);
  assert.doesNotMatch(existing, /primary-action/u);
  assert.match(
    existing,
    /data-url="https:\/\/news\.sap\.com\/2026\/10\/joule-assistants-agents\/"/u,
  );
});

test("labels distinguish versions from staged drafts and escape story text", () => {
  assert.equal(
    existingShortLabel({ id: "NEWS-07", versions: 1, href: "#", kind: "short" }),
    "Already a short · NEWS-07 · 1 version",
  );
  assert.equal(
    existingShortLabel({ id: "NEWS-05", versions: 1, href: "#draft-NEWS-05", kind: "draft" }),
    "Already a short · NEWS-05 · staged draft",
  );
  assert.ok(storyCardHtml({ ...story, title: "<b>x</b>" }).includes("&lt;b&gt;x&lt;/b&gt;"));
});
