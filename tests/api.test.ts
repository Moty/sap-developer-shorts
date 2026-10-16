import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { getActiveJob, resetJobsForTest } from "../src/api.js";
import { encodePcmWav, pronounce, sampleRate } from "../src/media/audio.js";
import { projectRoot } from "../src/paths.js";
import { startPreviewServer } from "../src/serve.js";

test("Studio API health and voices endpoints", async (t) => {
  resetJobsForTest();
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-api-"));
  await writeFile(resolve(directory, "review.html"), "Studio Review");
  const { server, url } = await startPreviewServer(directory, 0);

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
    resetJobsForTest();
  });

  const base = new URL(url).origin;

  // Health endpoint
  const healthRes = await fetch(`${base}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthData = (await healthRes.json()) as { status: string };
  assert.equal(healthData.status, "ok");

  // Status endpoint
  const statusRes = await fetch(`${base}/api/status`);
  assert.equal(statusRes.status, 200);
  const statusData = (await statusRes.json()) as { activeJob: unknown };
  assert.equal(statusData.activeJob, null);

  // Voices endpoint
  const voicesRes = await fetch(`${base}/api/voices`);
  assert.equal(voicesRes.status, 200);
  const voicesData = (await voicesRes.json()) as { voices: { id: string; installed: boolean }[] };
  assert.ok(Array.isArray(voicesData.voices));
  assert.ok(voicesData.voices.length > 0);
  const heart = voicesData.voices.find((v) => v.id === "af_heart");
  assert.ok(heart);
});

test("Studio API production validation and error handling", async (t) => {
  resetJobsForTest();
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-api-"));
  await writeFile(resolve(directory, "review.html"), "Studio Review");
  const audio = encodePcmWav(Buffer.alloc(sampleRate * 2, 1));
  let auditionCalls = 0;
  const { server, url } = await startPreviewServer(directory, 0, "127.0.0.1", {
    audition: async (text, options = {}) => {
      auditionCalls++;
      assert.equal(text, "CAP");
      assert.deepEqual(options, { voice: "af_heart", speed: 0.96, pronunciation: { CAP: "cap" } });
      return {
        audio,
        durationSeconds: 1,
        spokenText: pronounce(text, options.pronunciation ?? {}),
      };
    },
  });

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
    resetJobsForTest();
  });

  const base = new URL(url).origin;

  // Invalid selector
  const badRes = await fetch(`${base}/api/produce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selector: "INVALID-SELECTOR" }),
  });
  assert.equal(badRes.status, 400);

  // Unknown job status
  const notFoundRes = await fetch(`${base}/api/productions/unknown-job-id`);
  assert.equal(notFoundRes.status, 404);

  // Non-existent API route
  const unknownRoute = await fetch(`${base}/api/does-not-exist`);
  assert.equal(unknownRoute.status, 404);

  // Audition requires text
  const badAudition = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(badAudition.status, 400);

  // Audition synthesizes and returns WAV with headers
  const goodAudition = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: "CAP",
      voice: "af_heart",
      speed: 0.96,
      pronunciation: { CAP: "cap" },
    }),
  });
  assert.equal(goodAudition.status, 200);
  assert.equal(goodAudition.headers.get("content-type"), "audio/wav");
  assert.equal(goodAudition.headers.get("x-spoken-text"), encodeURIComponent("cap"));
  assert.equal(goodAudition.headers.get("x-duration-seconds"), "1.00");
  const audioBuf = await goodAudition.arrayBuffer();
  assert.deepEqual(Buffer.from(audioBuf), audio);
  assert.equal(auditionCalls, 1);
});

test("Studio API rejects a duplicate edited script before starting a different production", async (t) => {
  resetJobsForTest();
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-api-collision-"));
  await writeFile(resolve(directory, "review.html"), "Studio Review");
  const { server, url } = await startPreviewServer(directory, 0);
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
    resetJobsForTest();
  });
  const source = resolve(projectRoot, "content/presentations/CAP-01--casual-v2.json");
  const before = await readFile(source);
  const definition = JSON.parse(before.toString("utf8"));
  definition.title = "New wording with a duplicate version name";
  const response = await fetch(new URL("/api/produce", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selector: "CAP-02", definition }),
  });
  assert.equal(response.status, 409);
  assert.match(((await response.json()) as { error: string }).error, /choose a new version name/);
  assert.equal(getActiveJob(), null);
  assert.deepEqual(await readFile(source), before);
});
