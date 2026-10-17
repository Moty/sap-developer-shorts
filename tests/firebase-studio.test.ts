import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { renderFirebaseBridgeScript } from "../src/firebase/client-bridge.js";
import { loadFirebaseConfig, resolveWorkerIdentity } from "../src/firebase/config.js";
import { patchHtmlForFirebaseStudio } from "../src/firebase/export-studio.js";
import {
  fromFirestoreFields,
  InMemoryFirebaseCloudStore,
  toFirestoreFields,
} from "../src/firebase/rest-client.js";
import {
  processNextPendingProductionJob,
  processPendingAuditions,
  publishWorkerHeartbeat,
} from "../src/firebase/worker.js";
import type { ProductionReport } from "../src/production.js";

test("Firebase config and host-aware Mac worker identity resolve cleanly", async () => {
  const config = await loadFirebaseConfig();
  assert.equal(config.projectId, "sap-shorts-160871");
  assert.equal(config.storageBucket, "sap-shorts-160871.firebasestorage.app");

  const identity = resolveWorkerIdentity("macbook-pro-m5-arm64");
  assert.equal(identity.workerId, "macbook-pro-m5-arm64");
  assert.ok(identity.hostname.length > 0);
  assert.ok(identity.arch.length > 0);
});

test("Firestore value marshalling roundtrips nested objects, arrays, numbers, and nulls", () => {
  const input = {
    schemaVersion: 1,
    selector: "CAP-01@duo",
    durationSeconds: 54.25,
    published: false,
    issue: null,
    omitted: undefined,
    speakers: [
      {
        id: "mira",
        voice: "af_heart",
        avatar: {
          mode: "photo",
          imageId: "moty-profile.png",
          animation: "neural",
          motion: { style: "conversational", intensity: 0.7, seed: 42 },
        },
      },
    ],
  };

  const fields = toFirestoreFields(input);
  assert.equal("omitted" in fields, false);
  const output = fromFirestoreFields(fields);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.selector, "CAP-01@duo");
  assert.equal(output.durationSeconds, 54.25);
  assert.equal(output.published, false);
  assert.equal(output.issue, null);
  assert.deepEqual(output.speakers, input.speakers);
});

test("patchHtmlForFirebaseStudio widens CSP for Firebase only in exported HTML and injects bridge", async () => {
  const sampleHtml = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'self';">
  </head>
  <body>
    <script src="/library.js"></script>
  </body>
</html>`;

  const patched = patchHtmlForFirebaseStudio(sampleHtml);
  assert.match(patched, /https:\/\/\*\.googleapis\.com/u);
  assert.match(patched, /https:\/\/\*\.firebasestorage\.app/u);
  assert.match(
    patched,
    /<script src="\/firebase-bridge\.js"><\/script>\s*<script src="\/library\.js"><\/script>/u,
  );

  // Verify generated client bridge script is syntactically valid JS
  const config = await loadFirebaseConfig();
  const scriptSource = renderFirebaseBridgeScript(config);
  assert.doesNotThrow(() => new Function(scriptSource));
});

test("Mac worker claims PENDING production job, streams progress, uploads MP4, and marks READY", async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), "shorts-fb-worker-"));
  try {
    const store = new InMemoryFirebaseCloudStore();
    const config = await loadFirebaseConfig();
    const identity = resolveWorkerIdentity("mac-m5-test");

    await publishWorkerHeartbeat(store, identity, "ONLINE", null);
    const workerDoc = await store.getDocument("workers", "mac-m5-test");
    assert.equal(workerDoc?.status, "ONLINE");

    // Queue a voice audition request
    await store.setDocument("auditions", "aud-1", {
      id: "aud-1",
      text: "Welcome to SAP Developer Shorts.",
      voice: "af_heart",
      speed: 1.0,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const processedAuditions = await processPendingAuditions(store, async (text) => ({
      audio: Buffer.from("RIFF-fake-wav"),
      spokenText: text,
      durationSeconds: 2.4,
    }));
    assert.equal(processedAuditions, 1);
    const readyAudition = await store.getDocument("auditions", "aud-1");
    assert.equal(readyAudition?.status, "READY");
    assert.equal(readyAudition?.durationSeconds, 2.4);
    assert.ok(String(readyAudition?.audioDataUrl).startsWith("data:audio/wav;base64,"));

    // Create dummy rendered video artifacts
    const fakeVideoDir = resolve(tempDir, "video-out");
    await writeFile(resolve(tempDir, "short.mp4"), Buffer.from("fake-mp4-bytes"));
    await mkdir(fakeVideoDir, { recursive: true });
    await writeFile(resolve(fakeVideoDir, "short.mp4"), Buffer.from("fake-mp4-bytes"));
    await writeFile(resolve(fakeVideoDir, "poster.png"), Buffer.from("fake-png-bytes"));
    await writeFile(
      resolve(fakeVideoDir, "captions.vtt"),
      "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n",
    );

    const now = new Date().toISOString();
    await store.setDocument("productions", "job-123", {
      schemaVersion: 1,
      id: "job-123",
      selector: "CAP-01",
      stage: "PENDING",
      progressMessage: "Queued from Firebase Studio UI",
      startedAt: now,
      updatedAt: now,
    });

    const fakeProduce = async (
      selector: string,
      opts?: { progress?: (msg: string) => void },
    ): Promise<ProductionReport> => {
      opts?.progress?.("PREFLIGHT");
      opts?.progress?.("NARRATION");
      opts?.progress?.("RENDER");
      opts?.progress?.("LIBRARY");
      return {
        schemaVersion: 1,
        id: "prod-123",
        selector,
        stage: "READY",
        failedAt: null,
        startedAt: now,
        updatedAt: new Date().toISOString(),
        directory: tempDir,
        mediaJobId: "job-1",
        inputHash: "abc123",
        voices: ["af_heart"],
        presentation: "explainer",
        narrationDirectory: tempDir,
        audioReusedFrom: null,
        durationSeconds: 45.2,
        hookSeconds: 3.1,
        videoDirectory: fakeVideoDir,
        libraryDirectory: null,
        reusedVideo: false,
        issue: null,
      };
    };

    const report = await processNextPendingProductionJob({
      store,
      config,
      workerIdentity: identity,
      artifactRoot: tempDir,
      produceImpl: fakeProduce,
      logger: () => {},
    });

    assert.equal(report?.stage, "READY");
    const completedJob = await store.getDocument("productions", "job-123");
    assert.equal(completedJob?.stage, "READY");
    assert.equal(completedJob?.workerId, "mac-m5-test");
    const assets = completedJob?.assets as Record<string, string> | undefined;
    assert.ok(assets?.videoUrl?.includes("short.mp4"));
    assert.ok(assets?.posterUrl?.includes("poster.png"));
    assert.ok(assets?.captionsUrl?.includes("captions.vtt"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
