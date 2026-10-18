import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Job } from "../../src/cloud/contracts.js";
import { auditionPhrase } from "../../src/media/voice-audition.js";
import { detectCapabilities, modelBusy } from "../../src/worker/capabilities.js";
import { WorkerClient } from "../../src/worker/client.js";
import { executeAssignment } from "../../src/worker/runner.js";

const fixture = JSON.parse(await readFile(resolve(".state/private-tests/session.json"), "utf8"));
if (fixture.origin !== "http://127.0.0.1:5890")
  throw new Error("Smoke tests only run against the loopback demo studio.");
const publicConfig = await (await fetch(`${fixture.origin}/v1/config`)).json();
if (publicConfig.projectId !== "demo-sap-shorts-private")
  throw new Error("Smoke tests cannot target a live Firebase project.");
async function request(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${fixture.origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${fixture.owner}`,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
if (await modelBusy())
  throw new Error("A local model is busy. Retry this explicit smoke test later.");
const referenceText =
  "Let's make SAP feel a little simpler. We will build an API and check the result together.";
const reference = await auditionPhrase(referenceText, "af_heart", 0.96, {
  SAP: "S A P",
  API: "A P I",
});
const pairing = await request("/v1/worker-pairings", { name: "M5 · personal-voice integration" });
await request(`/v1/workspaces/${fixture.tenantId}/pairings/${pairing.pairingId}/approve`, {
  code: pairing.code,
});
const device = await request(`/v1/worker-pairings/${pairing.pairingId}/redeem`, {
  pollingSecret: pairing.pollingSecret,
});
const client = new WorkerClient(fixture.origin, device.credential);
try {
  const capabilities = await detectCapabilities();
  await client.request("/v1/worker/heartbeat", { capabilities, busy: false });
  const metadata = {
    name: "Synthetic Heart reference · integration test",
    transcript: referenceText,
    consent: true,
    allowMac: true,
    allowCloud: false,
    trustedMacPool: true,
    endSeconds: reference.durationSeconds,
  };
  const response = await fetch(`${fixture.origin}/v1/workspaces/${fixture.tenantId}/voices`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${fixture.owner}`,
      "content-type": "application/octet-stream",
      "x-voice-metadata": Buffer.from(JSON.stringify(metadata)).toString("base64"),
    },
    body: new Uint8Array(reference.audio),
  });
  const profile = await response.json();
  assert.equal(response.status, 201, JSON.stringify(profile));
  const job = await request(`/v1/workspaces/${fixture.tenantId}/jobs`, {
    kind: "audition",
    profileId: profile.id,
    target: { mode: "device", workerId: device.workerId },
  });
  const assignment = await client.request("/v1/worker/claim", {});
  assert.ok(assignment);
  assert.equal((assignment.job as Job).id, job.id);
  await executeAssignment(
    client,
    assignment as unknown as { job: Job; lease: string },
    capabilities,
    new AbortController().signal,
  );
  const accepted = await request(`/v1/workspaces/${fixture.tenantId}/jobs/${job.id}/accept`, {});
  assert.equal(accepted.engine, "qwen-mlx");
  let episodeJobId: string | null = null;
  if (process.env.SHORTS_TEST_VOICE_EPISODE === "1") {
    const templatesResponse = await fetch(`${fixture.origin}/v1/templates`, {
      headers: { authorization: `Bearer ${fixture.owner}` },
    });
    assert.ok(templatesResponse.ok);
    const templates = await templatesResponse.json();
    const episode = structuredClone(
      templates.find((item: { selector: string }) => item.selector === "CAP-01@casual-v2").episode,
    );
    episode.title = "Synthetic Qwen voice · full workflow test";
    // Qwen speaks technical acronyms more slowly than Heart. Keep the opening concise.
    episode.scenes[0].narration = "Missing service?";
    episode.scenes[2].narration += " These fields describe the records returned by our service.";
    episode.presentation.speakers[0].voice = {
      kind: "workspace-voice",
      tenantId: fixture.tenantId,
      profileId: profile.id,
      revision: profile.revision,
    };
    const draft = await request(`/v1/workspaces/${fixture.tenantId}/episodes`, {
      episode,
      expectedRevision: null,
    });
    await client.request("/v1/worker/heartbeat", { capabilities, busy: false });
    const production = await request(`/v1/workspaces/${fixture.tenantId}/jobs`, {
      episodeId: draft.id,
      revision: draft.revision,
      target: { mode: "device", workerId: device.workerId },
    });
    const assigned = await client.request("/v1/worker/claim", {});
    assert.equal((assigned?.job as Job)?.id, production.id);
    await executeAssignment(
      client,
      assigned as unknown as { job: Job; lease: string },
      capabilities,
      new AbortController().signal,
    );
    episodeJobId = production.id;
  }
  await writeFile(
    resolve(".state/private-tests/voice.json"),
    JSON.stringify({
      jobId: job.id,
      episodeJobId,
      profileId: profile.id,
      runtime: accepted.runtimeDigest,
    }),
    { mode: 0o600 },
  );
  console.log(
    "PASS: synthetic enrollment, private Storage, real Qwen audition, server output verification, and exact-runtime acceptance.",
  );
} finally {
  await client.request("/v1/worker/unregister", {});
  await request(
    `/v1/workspaces/${fixture.tenantId}/workers/${device.workerId}`,
    { archived: true },
    "PATCH",
  );
}
