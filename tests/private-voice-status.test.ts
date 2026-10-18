import assert from "node:assert/strict";
import test from "node:test";
import { voiceAudition, voiceReadiness } from "../src/web/private/voice-status.js";

const approval = {
  engine: "qwen-mlx",
  runtimeDigest: "runtime-1",
  revision: "revision-1",
  auditionJobId: "accepted-job",
};
const voice = {
  id: "voice-1",
  revision: "revision-1",
  status: "active",
  allowMac: true,
  allowCloud: false,
  trustedMacPool: false,
  trustedWorkerIds: ["mac-1"],
  acceptedAuditions: [approval],
};
const worker = {
  id: "mac-1",
  status: "active",
  capabilities: [{ engine: "qwen-mlx", digest: "runtime-1" }],
};
const workers = [worker];
const audition = {
  id: "accepted-job",
  kind: "audition",
  voiceProfileId: "voice-1",
  voiceRevision: "revision-1",
  createdAt: 10,
  state: "SUCCEEDED",
  requirements: [{ engine: "qwen-mlx", digest: "" }],
  runtimes: [{ engine: "qwen-mlx", digest: "runtime-1" }],
};

test("voice readiness requires current sample approval on a trusted compatible destination", () => {
  assert.equal(voiceReadiness(voice, { mode: "mac-pool" }, workers).ready, true);
  assert.equal(
    voiceReadiness({ ...voice, acceptedAuditions: [] }, { mode: "mac-pool" }, workers).ready,
    false,
  );
  assert.equal(
    voiceReadiness({ ...voice, revision: "new-sample" }, { mode: "mac-pool" }, workers).ready,
    false,
  );
  assert.equal(
    voiceReadiness(voice, { mode: "device", workerId: "other-mac" }, workers).ready,
    false,
  );
  assert.equal(
    voiceReadiness(voice, { mode: "mac-pool" }, [{ ...worker, status: "revoked" }]).ready,
    false,
  );
  assert.equal(
    voiceReadiness(voice, { mode: "mac-pool" }, [
      { ...worker, capabilities: [{ engine: "qwen-mlx", digest: "updated-runtime" }] },
    ]).message,
    "New engine audition needed",
  );
  assert.equal(voiceReadiness(voice, { mode: "cloud" }, workers).ready, false);
  const cloud = {
    ...voice,
    allowCloud: true,
    acceptedAuditions: [{ ...approval, engine: "qwen-cuda" }],
  };
  assert.equal(voiceReadiness(cloud, { mode: "cloud" }, workers, "runtime-1").ready, true);
  assert.equal(voiceReadiness(cloud, { mode: "cloud" }, workers, "other-runtime").ready, false);
});
test("auditions match profile, revision and engine rather than similar names or accepted job stamps", () => {
  const unaccepted = { ...voice, acceptedAuditions: [] };
  const newerWrongVoice = {
    ...audition,
    id: "other",
    voiceProfileId: "other-voice",
    createdAt: 30,
  };
  const newerWrongRevision = { ...audition, id: "old", voiceRevision: "old-sample", createdAt: 40 };
  const newerWrongRuntime = {
    ...audition,
    id: "wrong-runtime",
    createdAt: 50,
    runtimes: [{ engine: "qwen-mlx", digest: "outdated" }],
  };
  assert.equal(
    voiceAudition(
      unaccepted,
      [newerWrongVoice, newerWrongRevision, newerWrongRuntime, audition],
      { mode: "mac-pool" },
      workers,
    )?.id,
    "accepted-job",
  );
  assert.equal(
    voiceAudition(unaccepted, [newerWrongRuntime], { mode: "mac-pool" }, workers),
    undefined,
  );
  assert.equal(
    voiceAudition(unaccepted, [audition], { mode: "cloud" }, workers, "runtime-1"),
    undefined,
  );
  assert.equal(voiceReadiness(unaccepted, { mode: "mac-pool" }, workers).ready, false);
});
test("pending and failed auditions remain actionable without suggesting an incompatible successful one", () => {
  const unaccepted = { ...voice, acceptedAuditions: [] };
  const queued = { ...audition, id: "queued", state: "QUEUED", runtimes: [] };
  const failed = { ...audition, id: "failed", state: "FAILED", runtimes: [] };
  assert.equal(voiceAudition(unaccepted, [queued], { mode: "mac-pool" }, workers)?.state, "QUEUED");
  assert.equal(voiceAudition(unaccepted, [failed], { mode: "mac-pool" }, workers)?.state, "FAILED");
});

test("a new audition stays visible even when an older audition is approved", () => {
  const pending = { ...audition, id: "new-job", state: "RUNNING", createdAt: 20, runtimes: [] };
  assert.equal(
    voiceAudition(voice, [audition, pending], { mode: "mac-pool" }, workers)?.id,
    "new-job",
  );
  const completed = { ...pending, state: "SUCCEEDED", runtimes: audition.runtimes };
  assert.equal(
    voiceAudition(voice, [audition, completed], { mode: "mac-pool" }, workers)?.id,
    "new-job",
  );
});
