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

  const portraitRes = await fetch(`${base}/api/portrait-status`);
  assert.equal(portraitRes.status, 200);
  assert.equal(typeof ((await portraitRes.json()) as { installed: boolean }).installed, "boolean");

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

  // Avatars upload, list, and fetch endpoints
  const { createCanvas } = await import("@napi-rs/canvas");
  const { resolveAvatarPath } = await import("../src/media/avatar.js");
  const avatarCanvas = createCanvas(128, 128);
  const actx = avatarCanvas.getContext("2d");
  actx.fillStyle = "#245d4b";
  actx.fillRect(0, 0, 128, 128);
  const avatarDataUrl = `data:image/png;base64,${avatarCanvas.toBuffer("image/png").toString("base64")}`;

  const uploadRes = await fetch(`${base}/api/avatars`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "api-test-avatar", dataUrl: avatarDataUrl }),
  });
  assert.equal(uploadRes.status, 201);
  const uploadData = (await uploadRes.json()) as { imageId: string; url: string };
  assert.equal(uploadData.imageId, "api-test-avatar.png");
  t.after(async () => {
    const savedPath = await resolveAvatarPath("api-test-avatar.png");
    await rm(savedPath, { force: true });
  });

  const listRes = await fetch(`${base}/api/avatars`);
  assert.equal(listRes.status, 200);
  const listData = (await listRes.json()) as { avatars: string[] };
  assert.ok(listData.avatars.includes("api-test-avatar.png"));

  const imgRes = await fetch(`${base}/api/avatars/api-test-avatar.png`);
  assert.equal(imgRes.status, 200);
  assert.equal(imgRes.headers.get("content-type"), "image/png");
  const imgBuf = await imgRes.arrayBuffer();
  assert.ok(imgBuf.byteLength > 500);
});

test("Studio API applies one same-origin JSON policy to every mutation route", async (t) => {
  resetJobsForTest();
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-api-policy-"));
  await writeFile(resolve(directory, "review.html"), "Studio Review");
  const audio = encodePcmWav(Buffer.alloc(sampleRate * 2, 1));
  let auditionCalls = 0;
  const { server, url } = await startPreviewServer(directory, 0, "127.0.0.1", {
    audition: async (text) => {
      auditionCalls++;
      return { audio, durationSeconds: 1, spokenText: text };
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
  for (const path of [
    "/api/workflow",
    "/api/scripts",
    "/api/avatars",
    "/api/audition",
    "/api/produce",
    "/api/local-voices/audition",
  ]) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://unrelated.example" },
      body: "{}",
    });
    assert.equal(response.status, 403, path);
  }
  const crossOriginText = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://unrelated.example" },
    body: JSON.stringify({ text: "must not run" }),
  });
  assert.equal(crossOriginText.status, 403);
  const sameOriginText = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: base },
    body: JSON.stringify({ text: "must not run" }),
  });
  assert.equal(sameOriginText.status, 403);
  const misleadingJson = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: { "content-type": "application/json-p", origin: base },
    body: JSON.stringify({ text: "must not run" }),
  });
  assert.equal(misleadingJson.status, 403);
  const malformedOrigin = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "not a valid origin" },
    body: JSON.stringify({ text: "must not run" }),
  });
  assert.equal(malformedOrigin.status, 403);
  const wrongScheme = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base.replace("http://", "https://"),
    },
    body: JSON.stringify({ text: "must not run" }),
  });
  assert.equal(wrongScheme.status, 403);
  assert.equal(auditionCalls, 0);

  const allowed = await fetch(`${base}/api/audition`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ text: "ordinary same-origin request" }),
  });
  assert.equal(allowed.status, 200);
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
