import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { LocalActionManager, parseLocalAction } from "../src/local-actions.js";
import { startPreviewServer } from "../src/serve.js";

test("local action inputs allow named operations and known voices only", () => {
  for (const action of ["voice-audition", "voice-install", "voice-default"])
    assert.deepEqual(parseLocalAction({ action, voice: "af_heart" }), {
      action,
      voice: "af_heart",
    });
  for (const action of ["clone-setup", "portrait-setup", "face-setup"])
    assert.deepEqual(parseLocalAction({ action }), { action });
  for (const input of [
    null,
    [],
    { action: "run", command: "anything" },
    { action: "voice-audition", voice: "af_heart; echo nope" },
    { action: "voice-audition" },
    { action: "clone-setup", voice: "af_heart" },
    { action: "voice-install", voice: "af_heart", command: "anything" },
  ])
    assert.throws(() => parseLocalAction(input));
});

test("actions deduplicate repeat clicks, reject competing work, retain results and recover after failure", async () => {
  let complete!: () => void;
  let calls = 0;
  const manager = new LocalActionManager(async (input, progress) => {
    calls++;
    progress("Generating sample…");
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
    if (input.action === "face-setup") throw new Error("Download unavailable. Retry setup.");
    return { message: "Saved", audio: Buffer.from("audio fixture"), durationSeconds: 2 };
  });
  const input = parseLocalAction({ action: "voice-audition", voice: "af_heart" });
  const first = manager.start(input);
  assert.equal(first.state, "RUNNING");
  assert.equal(manager.start(input).id, first.id);
  assert.throws(() => manager.start({ action: "face-setup" }), /Another studio action/);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(manager.latest()?.message, "Generating sample…");
  complete();
  await new Promise(setImmediate);
  assert.equal(manager.busy, false);
  assert.equal(manager.get(first.id)?.state, "SUCCEEDED");
  assert.equal(manager.get(first.id)?.result?.audioUrl, `/api/local-actions/${first.id}/audio`);
  assert.equal(JSON.stringify(manager.get(first.id)).includes("audio fixture"), false);
  assert.equal(manager.audio(first.id)?.toString(), "audio fixture");
  const second = manager.start({ action: "face-setup" });
  await new Promise(setImmediate);
  complete();
  await new Promise(setImmediate);
  assert.equal(manager.get(second.id)?.state, "FAILED");
  assert.match(manager.get(second.id)?.message ?? "", /Download unavailable/);
  assert.equal(manager.audio(second.id), undefined);
  assert.equal(manager.get(first.id)?.state, "SUCCEEDED", "earlier results remain available");
  assert.equal(manager.start(input).state, "RUNNING", "a failed action can be retried");
  await new Promise(setImmediate);
  complete();
  await new Promise(setImmediate);
});

test("local action HTTP controls require a loopback session and same-origin JSON, and block production while busy", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-local-actions-api-"));
  await writeFile(resolve(directory, "review.html"), "Studio");
  let complete!: () => void;
  let calls = 0;
  const manager = new LocalActionManager(async () => {
    calls++;
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
    return {
      message: "Sample saved",
      audio: Buffer.from("RIFF-audio-fixture"),
      durationSeconds: 1,
    };
  });
  const { server, url } = await startPreviewServer(directory, 0, "127.0.0.1", {
    localActions: manager,
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = new URL(url).origin;
  const actionPath = `${origin}/api/local-actions`;
  const body = JSON.stringify({ action: "voice-audition", voice: "af_heart" });
  assert.equal(
    (
      await fetch(actionPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
    ).status,
    403,
  );
  const session = await fetch(`${origin}/api/local-voices/session`);
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const headers = { cookie, origin, "content-type": "application/json" };
  for (const extra of [
    { origin: "https://foreign.example" },
    { origin: "https://[invalid" },
    { "content-type": "text/plain" },
  ])
    assert.equal(
      (await fetch(actionPath, { method: "POST", headers: { ...headers, ...extra }, body })).status,
      403,
    );
  const aliasStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      actionPath,
      { method: "POST", headers: { ...headers, host: "alias.example" } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
  assert.equal(aliasStatus, 403);
  assert.equal(calls, 0);
  assert.equal(
    (
      await fetch(actionPath, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "run", command: "anything" }),
      })
    ).status,
    400,
  );
  const response = await fetch(actionPath, { method: "POST", headers, body });
  assert.equal(response.status, 202);
  const job = (await response.json()) as { id: string };
  assert.equal((await (await fetch(actionPath, { headers })).json()).job.id, job.id);
  assert.equal(
    (await (await fetch(actionPath, { method: "POST", headers, body })).json()).id,
    job.id,
  );
  assert.equal(calls, 1);
  assert.equal((await fetch(`${actionPath}/${job.id}/audio`, { headers })).status, 404);
  assert.equal(
    (
      await fetch(`${origin}/api/produce`, {
        method: "POST",
        headers,
        body: '{"selector":"CAP-01"}',
      })
    ).status,
    409,
  );
  assert.equal(
    (await fetch(`${origin}/api/audition`, { method: "POST", headers, body: '{"text":"Test"}' }))
      .status,
    409,
  );
  complete();
  await new Promise(setImmediate);
  assert.equal(
    (await (await fetch(`${actionPath}/${job.id}`, { headers })).json()).state,
    "SUCCEEDED",
  );
  assert.equal(
    await (await fetch(`${actionPath}/${job.id}/audio`, { headers })).text(),
    "RIFF-audio-fixture",
  );
  assert.equal((await fetch(`${actionPath}/${job.id}/audio`)).status, 403);
});
