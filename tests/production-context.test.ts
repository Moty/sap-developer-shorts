import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { resetJobsForTest } from "../src/api.js";
import { readContentEpisode } from "../src/contracts.js";
import { type ProductionReport, productionReceipt } from "../src/production.js";
import { productionHistory, productionKind } from "../src/production-ui.js";
import { startPreviewServer } from "../src/serve.js";

test("recovery reads an exact persisted job after restart without exposing paths or resubmitting", async (t) => {
  resetJobsForTest();
  const root = await mkdtemp(resolve(tmpdir(), "shorts-production-context-"));
  const id = "11111111-1111-4111-8111-111111111111";
  await writeFile(resolve(root, "review.html"), "Fixture");
  const directory = resolve(root, "productions", id);
  await mkdir(directory, { recursive: true });
  const report: ProductionReport = {
    schemaVersion: 1,
    id,
    selector: "CAP-02",
    stage: "NARRATION",
    failedAt: null,
    startedAt: "2026-10-28T10:00:00.000Z",
    updatedAt: "2026-10-28T10:01:00.000Z",
    directory: "/private/local-path",
    mediaJobId: null,
    inputHash: null,
    voices: [],
    presentation: null,
    narrationDirectory: null,
    audioReusedFrom: null,
    durationSeconds: null,
    hookSeconds: null,
    videoDirectory: null,
    libraryDirectory: null,
    reusedVideo: false,
    issue: null,
  };
  const file = resolve(directory, "production.json");
  await writeFile(file, JSON.stringify(report));
  let productionCalls = 0;
  const { server, url } = await startPreviewServer(root, 0, "127.0.0.1", {
    artifactRoot: root,
    production: async () => {
      productionCalls++;
      throw new Error("No rendering in this test");
    },
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
    resetJobsForTest();
  });
  const origin = new URL(url).origin;
  const response = await fetch(`${origin}/api/production-context?selector=CAP-02&jobId=${id}`);
  assert.equal(response.status, 200);
  const value = (await response.json()) as {
    stage: string;
    active: boolean;
    report: { id: string };
  };
  assert.equal(value.stage, "INTERRUPTED");
  assert.equal(value.active, false);
  assert.equal(value.report.id, id);
  assert.doesNotMatch(JSON.stringify(value), /private\/local-path/u);
  report.stage = "READY";
  await writeFile(file, JSON.stringify(report));
  const done = (await (
    await fetch(`${origin}/api/production-context?selector=CAP-02&jobId=${id}`)
  ).json()) as { stage: string };
  assert.equal(done.stage, "READY");
  assert.equal(productionCalls, 0);
  assert.equal(
    (await fetch(`${origin}/api/production-context?selector=CAP-02&jobId=../../secret`)).status,
    400,
  );
  await assert.rejects(productionReceipt("CAP-01", id, root), /does not match/u);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), report);
});

test("timing references exclude reused and legacy runs and contain no personal identifiers", async () => {
  const episode = await readContentEpisode("CAP-01");
  const fresh = {
    episode,
    preview: null,
    sourceReviewExpired: false,
    generation: {
      basis: "generation" as const,
      totalMs: 60000,
      reusedAudio: false,
      reusedVideo: false,
    },
  };
  const history = productionHistory([
    fresh,
    { ...fresh, generation: { ...fresh.generation, reusedAudio: true } },
    { ...fresh, generation: { ...fresh.generation, basis: "legacy-run" } },
  ]);
  assert.deepEqual(history, [{ kind: productionKind(episode), totalMs: 60000 }]);
  assert.doesNotMatch(JSON.stringify(history), /profileId|imageId/u);
});

test("a completed render stays in Update workspace until the server serves it and retains the API job identity", async (t) => {
  resetJobsForTest();
  const root = await mkdtemp(resolve(tmpdir(), "shorts-production-index-"));
  await writeFile(resolve(root, "review.html"), "Fixture");
  let release!: () => void;
  const indexing = new Promise<void>((done) => {
    release = done;
  });
  let refreshing = false;
  let observedId: string | undefined;
  const { server, url } = await startPreviewServer(root, 0, "127.0.0.1", {
    artifactRoot: root,
    rebuildLibrary: async () => {
      refreshing = true;
      await indexing;
      return { directory: root };
    },
    production: async (selector, options) => {
      observedId = options?.jobId;
      assert.ok(observedId);
      const now = new Date().toISOString();
      return {
        schemaVersion: 1,
        id: observedId,
        selector,
        stage: "READY",
        failedAt: null,
        startedAt: now,
        updatedAt: now,
        directory: root,
        mediaJobId: null,
        inputHash: null,
        voices: [],
        presentation: null,
        narrationDirectory: null,
        audioReusedFrom: null,
        durationSeconds: 55,
        hookSeconds: 3,
        videoDirectory: root,
        libraryDirectory: null,
        reusedVideo: false,
        issue: null,
      };
    },
  });
  t.after(async () => {
    release();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
    resetJobsForTest();
  });
  const origin = new URL(url).origin;
  const accepted = await fetch(`${origin}/api/produce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selector: "CAP-02" }),
  });
  assert.equal(accepted.status, 202);
  const { jobId } = (await accepted.json()) as { jobId: string };
  for (let i = 0; i < 100 && !refreshing; i++) await setTimeout(5);
  assert.equal(refreshing, true);
  assert.equal(observedId, jobId);
  const contextUrl = `${origin}/api/production-context?selector=CAP-02&jobId=${jobId}`;
  const pending = (await (await fetch(contextUrl)).json()) as { stage: string; active: boolean };
  assert.equal(pending.stage, "LIBRARY");
  assert.equal(pending.active, true);
  release();
  for (let i = 0; i < 100; i++) {
    const result = (await (await fetch(contextUrl)).json()) as {
      stage: string;
      libraryUpdated: boolean;
    };
    if (result.stage === "READY") {
      assert.equal(result.libraryUpdated, true);
      return;
    }
    await setTimeout(5);
  }
  assert.fail("The indexing completion was not exposed");
});
