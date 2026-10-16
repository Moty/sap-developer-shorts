import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { resetJobsForTest } from "../src/api.js";
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
      pronunciation: { CAP: "cap" },
    }),
  });
  assert.equal(goodAudition.status, 200);
  assert.equal(goodAudition.headers.get("content-type"), "audio/wav");
  assert.equal(goodAudition.headers.get("x-spoken-text"), encodeURIComponent("cap"));
  const audioBuf = await goodAudition.arrayBuffer();
  assert.ok(audioBuf.byteLength > 1000);
});
