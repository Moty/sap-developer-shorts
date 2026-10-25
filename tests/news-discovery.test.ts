import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { readNewsEpisode, validateNewsEpisode } from "../src/news/contracts.js";
import { fetchStoryDetail, type SapStoryDetail } from "../src/news/fetcher.js";
import { buildNewsEpisodeFromStory, getNextNewsId } from "../src/news/generator.js";

test("news discovery rejects non-SAP domains", async () => {
  await assert.rejects(
    () => fetchStoryDetail("https://example.com/not-sap-story"),
    /must be an official SAP domain/u,
  );
});

test("news generator creates a schema-valid episode passing all constraints", async () => {
  const mockStory: SapStoryDetail = {
    id: "test-story",
    title: "SAP Introduces New Generative AI Capabilities for Enterprise Architecture",
    link: "https://news.sap.com/2026/10/test-story-ai-btp/",
    pubDate: "Fri, 23 Oct 2026 10:00:00 +0000",
    publishedIso: new Date().toISOString().slice(0, 10),
    categories: ["Artificial Intelligence", "Business Technology Platform"],
    relevanceScore: 45,
    angleSuggestion: "Examine the technical capability and separate current access from roadmaps.",
    paragraphs: [
      "SAP introduced new AI-powered tools designed to help enterprise architects model complex systems.",
      "According to recent benchmarks, structured enterprise processes require specialized tabular reasoning.",
      "The new capabilities will be available across SAP Business Technology Platform environments.",
    ],
    fullText: "Full article text here...",
    keyQuotes: [
      "Eighty percent of professionals report personal productivity gains from AI adoption.",
      "Tabular data requires models that understand relationships across rows and columns.",
      "Enterprise architecture requires explainable predictions alongside generative language models.",
    ],
  };

  const episode = buildNewsEpisodeFromStory(mockStory, "NEWS-99");

  // Must validate successfully with 0 errors
  const validated = validateNewsEpisode(episode);
  assert.equal(validated.id, "NEWS-99");
  assert.equal(validated.targetDurationSeconds, 55);
  assert.equal(validated.scenes.length, 7);
  assert.equal(validated.scenes[0]?.phase, "hook");
  assert.equal(validated.scenes[0]?.endSeconds, 3);
  assert.ok((validated.scenes[0]?.narration.trim().split(/\s+/u).length ?? 0) <= 7);
  assert.equal(validated.scenes[6]?.phase, "cta");
  assert.equal(validated.claims.length, 3);
  assert.equal(validated.publication.channel, "linkedin");
  assert.ok(validated.publication.text.includes("#SAP"));
});

test("getNextNewsId returns sequential NEWS ID", async () => {
  const nextId = await getNextNewsId();
  assert.match(nextId, /^NEWS-\d{2}$/u);
});

test("readNewsEpisode resolves draft from content/drafts if not in content/episodes", async () => {
  const episode = await readNewsEpisode("NEWS-03");
  assert.equal(episode.id, "NEWS-03");
  assert.equal(episode.format, "news");
});

test("readContentEpisode resolves direct json draft path", async () => {
  const episode = await readContentEpisode("content/drafts/NEWS-03.json");
  assert.equal(episode.id, "NEWS-03");
});

test("news API endpoints return drafts and reject invalid inputs", async (t) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const { startPreviewServer } = await import("../src/serve.js");

  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-news-api-"));
  await writeFile(resolve(directory, "review.html"), "Review");

  const { server, url } = await startPreviewServer(directory, 0, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>((res, rej) => {
      server.close((err) => (err ? rej(err) : res()));
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });

  const base = new URL(url).origin;

  // GET /api/news/drafts
  const draftsRes = await fetch(`${base}/api/news/drafts`);
  assert.equal(draftsRes.status, 200);
  const draftsData = (await draftsRes.json()) as { drafts: { id: string }[] };
  assert.ok(Array.isArray(draftsData.drafts));
  assert.ok(draftsData.drafts.some((d) => d.id === "NEWS-03"));

  // POST /api/news/create without URL fails with 400
  const createFail = await fetch(`${base}/api/news/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(createFail.status, 400);

  // POST /api/news/promote without ID fails with 400
  const promoteFail = await fetch(`${base}/api/news/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(promoteFail.status, 400);
});
