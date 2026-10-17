import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { startPreviewServer } from "../src/serve.js";
import { updateWorkflow, type WorkflowManifest, workflowState } from "../src/workflow.js";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-workflow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = resolve(directory, "state");
  const videoPath = "episodes/CAP-01/video/short.mp4";
  const bytes = Buffer.from("isolated video fixture");
  await mkdir(resolve(directory, "episodes/CAP-01/video"), { recursive: true });
  await writeFile(resolve(directory, videoPath), bytes);
  const entry = {
    selector: "CAP-01",
    inputHash: hash(JSON.stringify(await readContentEpisode("CAP-01"))),
    sourceReviewExpired: false,
    video: { renderKey: hash("render A") },
  };
  const manifest: WorkflowManifest = {
    episodes: [entry],
    artifactHashes: { [videoPath]: hash(bytes) },
  };
  const saveManifest = () =>
    writeFile(resolve(directory, "library-manifest.json"), JSON.stringify(manifest));
  await saveManifest();
  const request = { selector: entry.selector, renderKey: entry.video.renderKey };
  return {
    directory,
    root,
    videoPath,
    entry,
    manifest,
    saveManifest,
    request,
    videoHash: hash(bytes),
  };
}

test("produced, reviewed and published are durable distinct states tied to the exact video", async (t) => {
  const f = await fixture(t);
  assert.equal((await workflowState(f.root, f.entry, f.videoHash)).stage, "review");
  await assert.rejects(
    updateWorkflow(f.directory, f.root, {
      ...f.request,
      action: "publish",
      url: "https://example.com/post",
    }),
    /Review and approve/,
  );
  await assert.rejects(
    updateWorkflow(f.directory, f.root, { ...f.request, action: "approve" }),
    /Confirm/,
  );
  assert.equal(
    (await updateWorkflow(f.directory, f.root, { ...f.request, action: "approve", reviewed: true }))
      .stage,
    "publish",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "data:text/html,test",
  ]) {
    await assert.rejects(
      updateWorkflow(f.directory, f.root, { ...f.request, action: "publish", url }),
    );
  }
  const published = await updateWorkflow(f.directory, f.root, {
    ...f.request,
    action: "publish",
    url: "https://example.com/post/1",
  });
  assert.equal(published.stage, "published");
  assert.equal(
    (await workflowState(f.root, f.entry, f.videoHash)).record?.publication?.url,
    "https://example.com/post/1",
  );
  assert.equal(
    (
      await workflowState(
        f.root,
        { ...f.entry, video: { renderKey: hash("render B") } },
        f.videoHash,
      )
    ).stage,
    "review",
  );
  assert.equal((await workflowState(f.root, f.entry, hash("replaced bytes"))).stage, "review");
  assert.equal(
    (await updateWorkflow(f.directory, f.root, { ...f.request, action: "reopen" })).stage,
    "review",
  );
});

test("review rejects stale render identities, edited scripts, expired sources and changed MP4 bytes", async (t) => {
  const f = await fixture(t);
  const approve = { ...f.request, action: "approve", reviewed: true };
  await assert.rejects(
    updateWorkflow(f.directory, f.root, { ...approve, renderKey: "old" }),
    /changed or is unavailable/,
  );
  f.entry.inputHash = hash("edited script");
  await f.saveManifest();
  await assert.rejects(updateWorkflow(f.directory, f.root, approve), /script changed/);
  f.entry.inputHash = hash(JSON.stringify(await readContentEpisode("CAP-01")));
  f.entry.sourceReviewExpired = true;
  await f.saveManifest();
  await assert.rejects(updateWorkflow(f.directory, f.root, approve), /source review has expired/);
  f.entry.sourceReviewExpired = false;
  await f.saveManifest();
  await writeFile(resolve(f.directory, f.videoPath), "modified");
  await assert.rejects(updateWorkflow(f.directory, f.root, approve), /MP4 is missing or changed/);
});

test("studio API persists approval through a server restart without changing media", async (t) => {
  const f = await fixture(t);
  let running = await startPreviewServer(f.directory, 0, "127.0.0.1", {
    artifactRoot: f.directory,
  });
  const close = async () => {
    running.server.closeAllConnections();
    await new Promise<void>((done) => running.server.close(() => done()));
  };
  t.after(close);
  const response = await fetch(new URL("/api/workflow", running.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...f.request, action: "approve", reviewed: true }),
  });
  assert.equal(response.status, 200);
  await close();
  running = await startPreviewServer(f.directory, 0, "127.0.0.1", { artifactRoot: f.directory });
  const status = (await (await fetch(new URL("/api/workflow", running.url))).json()) as {
    episodes: { stage: string }[];
  };
  assert.equal(status.episodes[0]?.stage, "publish");
  assert.equal(hash(await readFile(resolve(f.directory, f.videoPath))), f.videoHash);
});

test("interrupted jobs need attention and a different browser origin cannot approve a video", async (t) => {
  const f = await fixture(t);
  const reportDirectory = resolve(f.directory, "productions/12345678-1234-1234-1234-123456789abc");
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, "production.json"),
    JSON.stringify({
      schemaVersion: 1,
      selector: "CAP-01",
      stage: "RENDER",
      startedAt: new Date().toISOString(),
      issue: null,
    }),
  );
  const running = await startPreviewServer(f.directory, 0, "127.0.0.1", {
    artifactRoot: f.directory,
  });
  t.after(async () => {
    running.server.closeAllConnections();
    await new Promise<void>((done) => running.server.close(() => done()));
  });
  const response = await fetch(new URL("/api/workflow", running.url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://unrelated.example" },
    body: JSON.stringify({ ...f.request, action: "approve", reviewed: true }),
  });
  assert.equal(response.status, 403);
  const status = (await (await fetch(new URL("/api/workflow", running.url))).json()) as {
    episodes: { stage: string; attention: boolean; issue: string }[];
  };
  assert.equal(status.episodes[0]?.stage, "review");
  assert.equal(status.episodes[0]?.attention, true);
  assert.match(status.episodes[0]?.issue ?? "", /interrupted/);
});
