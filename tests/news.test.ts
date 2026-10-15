import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readContentEpisode, validateEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { isNewsEpisode } from "../src/domain.js";
import { FakeProvider } from "../src/media/providers.js";
import { MediaStore } from "../src/media/store.js";
import {
  advanceMediaJob,
  createMediaJob,
  loadVerifiedRun,
  productionSettings,
} from "../src/media/worker.js";
import { readNewsEpisode, validateNewsEpisode } from "../src/news/contracts.js";
import { createNewsReview } from "../src/news/review.js";
import { prepareContentEpisode } from "../src/pipeline.js";

const pilot = await readNewsEpisode("NEWS-01");

function currentPilot() {
  const episode = structuredClone(pilot);
  const today = new Date().toISOString().slice(0, 10);
  episode.news.asOf = today;
  for (const source of episode.sources) source.retrievedOn = today;
  for (const claim of episode.claims) claim.checkedOn = today;
  return episode;
}

async function temporary(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-news-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("news is an explicit format with source reviews instead of invented demo checks", async () => {
  const episode = await readContentEpisode("NEWS-01");
  assert.ok(isNewsEpisode(episode));
  assert.throws(() => validateEpisode(episode), /Episode schema/);
  assert.throws(
    () => validateNewsEpisode({ ...episode, demo: { id: "cap-inventory" } }),
    /News schema/,
  );
  await assert.rejects(readNewsEpisode("../../.env"), /Invalid news episode ID/);
  const invalid = structuredClone(pilot);
  const claim = invalid.claims[0];
  assert.ok(claim);
  claim.sourceIds = ["invented"];
  assert.throws(() => validateNewsEpisode(invalid), /unknown source invented/);
  claim.sourceIds = ["connect-release"];
  claim.support = [];
  assert.throws(() => validateNewsEpisode(invalid), /News schema/);
});

test("news production rejects stale, future, and inconsistent review dates", () => {
  assert.doesNotThrow(() =>
    validateNewsEpisode(pilot, { requireFresh: true, now: new Date("2026-10-21T12:00:00Z") }),
  );
  assert.throws(
    () => validateNewsEpisode(pilot, { requireFresh: true, now: new Date("2026-10-22T12:00:00Z") }),
    /stale/,
  );
  assert.throws(
    () => validateNewsEpisode(pilot, { now: new Date("2026-10-13T12:00:00Z") }),
    /future/,
  );
  const invalid = currentPilot();
  const claim = invalid.claims[0];
  assert.ok(claim);
  claim.checkedOn = "2026-01-01";
  assert.throws(() => validateNewsEpisode(invalid), /as-of date/);
  claim.checkedOn = invalid.news.asOf;
  const source = invalid.sources[0];
  assert.ok(source);
  source.url = "https://sap.com.attacker.example/news";
  assert.throws(() => validateNewsEpisode(invalid), /official SAP source/);
  source.url = pilot.sources[0]?.url ?? "";
  source.publishedOn = "2099-01-01";
  assert.throws(() => validateNewsEpisode(invalid), /chronology/);
});

test("every news headline must point to one known announcement with a source support note", () => {
  const invalid = structuredClone(pilot);
  const scene = invalid.scenes[2];
  const claim = invalid.claims[0];
  assert.ok(scene && claim);
  scene.claimIds = ["unknown"];
  assert.throws(() => validateNewsEpisode(invalid), /unknown claim/);
  scene.claimIds = [];
  assert.throws(() => validateNewsEpisode(invalid), /one sourced announcement/);
  scene.claimIds = [claim.id];
  claim.support[0] = { sourceId: "connect-guide", locator: "wrong", summary: "undeclared" };
  assert.throws(() => validateNewsEpisode(invalid), /needs a support note/);
});

test("news previews retain dated availability and escape editorial input", async () => {
  const episode = structuredClone(pilot);
  const claim = episode.claims[0];
  assert.ok(claim);
  claim.text = '<img src=x onerror="alert(1)">';
  const files = await createNewsReview(episode);
  const html = files["review.html"] ?? "";
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("Planned release"));
  assert.ok(html.includes("General availability planned for Q1 2027"));
  assert.ok(html.includes("Sources checked 2026-10-14"));
  assert.ok(html.includes("No product behavior was tested"));
  assert.ok(!html.includes("Live checks passed"));
  assert.ok(!html.includes("Technical demo verified"));
});

test("news prepares hashed source evidence and enters the existing media workflow without executing CAP", async (t) => {
  const root = await temporary(t);
  const run = await prepareContentEpisode(currentPilot(), {
    preview: true,
    artifactRoot: root,
    verifier: async () => {
      throw new Error("News must not execute a demo");
    },
  });
  assert.deepEqual(
    run.manifest.history.map((entry) => entry.stage),
    ["VALIDATED", "VERIFYING", "SOURCES_CHECKED", "PREVIEW_READY"],
  );
  assert.ok(!run.manifest.artifactHashes["demo-evidence.json"]);
  assert.ok(run.manifest.artifactHashes["news-evidence.json"]);
  assert.ok(run.manifest.runtimeHashes["src/news/contracts.ts"]);
  assert.ok(run.manifest.runtimeHashes["src/domain.ts"]);
  assert.ok(run.manifest.sourceHashes["schemas/news-episode.schema.json"]);
  for (const [file, expected] of Object.entries(run.manifest.artifactHashes))
    assert.equal(hash(await readFile(resolve(run.directory, file))), expected);
  const loaded = await loadVerifiedRun(run.directory);
  assert.ok(isNewsEpisode(loaded.episode));
  const store = await MediaStore.open(resolve(root, "media.sqlite"));
  t.after(() => store.close());
  const provider = new FakeProvider(store);
  let job = await createMediaJob(store, run.directory, provider, await productionSettings());
  for (let step = 0; step < 5 && job.phase !== "SIMULATED"; step++)
    job = await advanceMediaJob(store, job.id, provider);
  assert.equal(job.phase, "SIMULATED");
  assert.equal(job.request.episode.id, "NEWS-01");
  await writeFile(resolve(run.directory, "news-evidence.json"), "{}");
  await assert.rejects(loadVerifiedRun(run.directory), /Verified artifact changed/);
});
