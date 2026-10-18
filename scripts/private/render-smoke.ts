import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Job } from "../../src/cloud/contracts.js";
import { detectCapabilities, modelBusy } from "../../src/worker/capabilities.js";
import { WorkerClient } from "../../src/worker/client.js";
import { executeAssignment as executeSource } from "../../src/worker/runner.js";

const executeAssignment: typeof executeSource =
  process.env.SHORTS_TEST_COMPILED === "1"
    ? (await import(pathToFileURL(resolve("dist/src/worker/runner.js")).href)).executeAssignment
    : executeSource;

const fixture = JSON.parse(await readFile(resolve(".state/private-tests/session.json"), "utf8"));
if (fixture.origin !== "http://127.0.0.1:5890")
  throw new Error("Smoke tests only run against the loopback demo studio.");
const publicConfig = await (await fetch(`${fixture.origin}/v1/config`)).json();
if (publicConfig.projectId !== "demo-sap-shorts-private")
  throw new Error("Smoke tests cannot target a live Firebase project.");
const base = fixture.origin;
async function request(path: string, body: unknown, token = fixture.owner, method = "POST") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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
const pairing = await request("/v1/worker-pairings", {
  name: "MacBook Pro M5 · local integration",
});
await request(`/v1/workspaces/${fixture.tenantId}/pairings/${pairing.pairingId}/approve`, {
  code: pairing.code,
});
const device = await request(`/v1/worker-pairings/${pairing.pairingId}/redeem`, {
  pollingSecret: pairing.pollingSecret,
});
const client = new WorkerClient(base, device.credential);
try {
  const capabilities = await detectCapabilities();
  console.log("Installed engines:", capabilities.map((item) => item.engine).join(", "));
  await client.request("/v1/worker/heartbeat", { capabilities, busy: false });
  const job = await request(`/v1/workspaces/${fixture.tenantId}/jobs`, {
    episodeId: fixture.episodeId,
    revision: fixture.revision,
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
  await writeFile(
    resolve(".state/private-tests/render.json"),
    JSON.stringify({ jobId: job.id, workerId: device.workerId, capabilities }, null, 2),
    { mode: 0o600 },
  );
  console.log(`PASS: real isolated worker completed ${job.id} through Firebase emulators.`);
} finally {
  await client.request("/v1/worker/unregister", {});
  await request(
    `/v1/workspaces/${fixture.tenantId}/workers/${device.workerId}`,
    { archived: true },
    fixture.owner,
    "PATCH",
  );
}
