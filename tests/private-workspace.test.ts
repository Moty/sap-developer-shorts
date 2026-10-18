import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBlobs } from "../src/cloud/blobs.js";
import {
  ApiError,
  digest,
  matches,
  type RecordData,
  type Worker,
  workerAvailability,
} from "../src/cloud/contracts.js";
import { MemoryDatabase } from "../src/cloud/database.js";
import { defaultPresentation, workspaceSpeakers } from "../src/cloud/episodes.js";
import { WorkspaceService } from "../src/cloud/service.js";
import { readContentEpisode } from "../src/contracts.js";
import { encodePcmWav } from "../src/media/audio.js";

const hash = digest("test-runtime");
const alice = { uid: "alice", email: "alice@example.test", authTime: Date.now() };
const bob = { uid: "bob", email: "bob@example.test", authTime: Date.now() };
const fails = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;
async function fixture() {
  let now = Date.now();
  const db = new MemoryDatabase(),
    blobs = new MemoryBlobs();
  const service = new WorkspaceService(db, blobs, {
    pilotEmails: [alice.email, bob.email],
    isUserActive: async () => true,
    now: () => now,
  });
  const owner = await service.bootstrap(alice),
    other = await service.bootstrap(bob);
  const context = await service.context(alice, String(owner.tenantId));
  const second = await service.context(bob, String(other.tenantId));
  const register = async (name = "Mac mini") => {
    const pairing = await service.pairingStart({ name });
    await service.approvePairing(context, pairing.pairingId, pairing.code);
    const device = await service.redeemPairing(pairing.pairingId, pairing.pollingSecret);
    const worker = await service.workerAuth(String(device.credential));
    await service.heartbeat(
      worker,
      [
        { engine: "kokoro", digest: hash, voices: ["af_heart", "am_michael"] },
        { engine: "video-compose", digest: hash },
        { engine: "qwen-mlx", digest: hash },
      ],
      false,
    );
    return { ...device, actor: worker };
  };
  const draft = async () =>
    service.saveEpisode(context, {
      episode: defaultPresentation(await readContentEpisode("CAP-01")),
      expectedRevision: null,
    });
  return {
    service,
    db,
    blobs,
    context,
    second,
    register,
    draft,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
test("private accounts bootstrap once and cannot claim another user's workspace", async () => {
  const f = await fixture();
  const again = await f.service.bootstrap(alice);
  assert.equal(again.tenantId, f.context.tenantId);
  await assert.rejects(f.service.context(bob, f.context.tenantId), fails("WORKSPACE_UNAVAILABLE"));
  await assert.rejects(
    f.service.bootstrap({ ...bob, uid: "new-uninvited", email: "uninvited@example.test" }),
    fails("ACCESS_PENDING"),
  );
});
test("draft concurrency preserves revisions and rejects local cloned voice references", async () => {
  const f = await fixture(),
    saved = await f.draft();
  const episode = structuredClone(saved.episode);
  episode.title = "Changed";
  const revised = await f.service.saveEpisode(
    f.context,
    { episode, expectedRevision: saved.revision },
    saved.id,
  );
  await assert.rejects(
    f.service.saveEpisode(f.context, { episode, expectedRevision: saved.revision }, saved.id),
    fails("REVISION_CONFLICT"),
  );
  assert.notEqual(revised.revision, saved.revision);
  const bad = structuredClone(episode);
  const badSpeaker = workspaceSpeakers(bad)[0];
  assert.ok(badSpeaker);
  badSpeaker.voice = {
    engine: "qwen",
    profileId: "not-uploaded",
    revision: hash,
  };
  await assert.rejects(
    f.service.saveEpisode(f.context, { episode: bad }),
    fails("LOCAL_VOICE_PRIVATE"),
  );
});
test("pairing requires the polling secret, is single-use, and device revocation wins over heartbeat", async () => {
  const f = await fixture();
  const pairing = await f.service.pairingStart({ name: "MacBook Pro M5" });
  await assert.rejects(
    f.service.redeemPairing(pairing.pairingId, "wrong"),
    fails("PAIRING_EXPIRED"),
  );
  assert.equal(
    (await f.service.redeemPairing(pairing.pairingId, pairing.pollingSecret)).pending,
    true,
  );
  await f.service.approvePairing(f.context, pairing.pairingId, pairing.code);
  const device = await f.service.redeemPairing(pairing.pairingId, pairing.pollingSecret);
  await assert.rejects(
    f.service.redeemPairing(pairing.pairingId, pairing.pollingSecret),
    fails("PAIRING_EXPIRED"),
  );
  const actor = await f.service.workerAuth(String(device.credential));
  await f.service.updateWorker(f.context, actor.workerId, { status: "revoked" });
  await assert.rejects(f.service.workerAuth(String(device.credential)), fails("DEVICE_REVOKED"));
  await assert.rejects(f.service.heartbeat(actor, [], false), fails("DEVICE_REVOKED"));
});
test("two Macs claim independent jobs exactly once and cannot claim across workspaces", async () => {
  const f = await fixture(),
    mini = await f.register(),
    laptop = await f.register("M5 laptop"),
    draft = await f.draft();
  const input = { episodeId: draft.id, revision: draft.revision, target: { mode: "mac-pool" } };
  const first = await f.service.submit(f.context, input, "request-one");
  assert.equal((await f.service.submit(f.context, input, "request-one")).id, first.id);
  const secondDraft = await f.draft();
  await f.service.submit(
    f.context,
    { ...input, episodeId: secondDraft.id, revision: secondDraft.revision },
    "request-two",
  );
  const results = await Promise.all([
    f.service.claim(mini.actor),
    f.service.claim(laptop.actor),
    f.service.claim(mini.actor),
  ]);
  const claims = results.filter((item) => item !== null);
  assert.equal(claims.length, 2);
  assert.equal(new Set(claims.map((item) => item.job.id)).size, 2);
  assert.equal((await f.service.list(f.second, "jobs")).length, 0);
  await assert.rejects(
    f.service.manifest(
      { ...mini.actor, tenantId: f.second.tenantId },
      String(claims[0]?.job.id),
      String(claims[0]?.lease),
    ),
    fails("ATTEMPT_EXPIRED"),
  );
});
test("account revocation fences device authorization, active leases and pending claims", async () => {
  const f = await fixture();
  const mini = await f.register(),
    draft = await f.draft();
  await f.service.submit(
    f.context,
    {
      episodeId: draft.id,
      revision: draft.revision,
      target: { mode: "mac-pool" },
    },
    "before-revocation",
  );
  const assignment = await f.service.claim(mini.actor);
  assert.ok(assignment);
  const second = await f.register("M5"),
    secondDraft = await f.draft();
  await f.service.submit(
    f.context,
    {
      episodeId: secondDraft.id,
      revision: secondDraft.revision,
      target: { mode: "mac-pool" },
    },
    "pending-revocation",
  );
  f.service.options.isUserActive = async (uid) => uid !== alice.uid;
  await assert.rejects(f.service.workerAuth(String(mini.credential)), fails("DEVICE_REVOKED"));
  await assert.rejects(
    f.service.progress(mini.actor, assignment.job.id, assignment.lease, { stage: "NARRATION" }),
    fails("ACCOUNT_REVOKED"),
  );
  await assert.rejects(
    f.service.manifest(mini.actor, assignment.job.id, assignment.lease),
    fails("ACCOUNT_REVOKED"),
  );
  assert.equal(await f.service.claim(second.actor), null);
});
test("pinned devices wait, busy Macs do not claim, and paid fallback stays disabled", async () => {
  const f = await fixture(),
    mini = await f.register(),
    laptop = await f.register("M5 laptop"),
    saved = await f.draft();
  await f.service.submit(
    f.context,
    {
      episodeId: saved.id,
      revision: saved.revision,
      target: { mode: "device", workerId: mini.actor.workerId },
    },
    "pinned-job",
  );
  assert.equal(await f.service.claim(laptop.actor), null);
  await f.service.heartbeat(
    mini.actor,
    [
      { engine: "kokoro", digest: hash, voices: ["af_heart"] },
      { engine: "video-compose", digest: hash },
    ],
    true,
  );
  assert.equal(await f.service.claim(mini.actor), null);
  await assert.rejects(
    f.service.submit(
      f.context,
      { episodeId: saved.id, revision: saved.revision, target: { mode: "cloud" } },
      "cloud-job",
    ),
    fails("BUDGET_REQUIRED"),
  );
});
test("expired and cancelled attempts cannot renew, fetch inputs, or publish outputs", async () => {
  const f = await fixture(),
    device = await f.register(),
    draft = await f.draft();
  await f.service.submit(
    f.context,
    { episodeId: draft.id, revision: draft.revision, target: { mode: "mac-pool" } },
    "leased-job",
  );
  const claim = await f.service.claim(device.actor);
  assert.ok(claim);
  f.advance(121_000);
  await assert.rejects(
    f.service.progress(device.actor, String(claim.job.id), claim.lease, { stage: "NARRATION" }),
    fails("ATTEMPT_EXPIRED"),
  );
  assert.equal((await f.service.reconcile(f.context)).reconciled, 1);
  await assert.rejects(
    f.service.uploadOutput(
      device.actor,
      String(claim.job.id),
      claim.lease,
      "audio",
      Buffer.from("bad"),
      "audio/wav",
    ),
    fails("ATTEMPT_EXPIRED"),
  );
});
test("private reference audio is isolated by workspace and owner", async () => {
  const f = await fixture();
  const asset = await f.service.saveAsset(
    f.context,
    "sample",
    Buffer.from("private voice"),
    "audio/wav",
  );
  await assert.rejects(f.service.readAsset(f.second, asset.id), fails("NOT_FOUND"));
  const viewer = { ...f.context, uid: "viewer", role: "viewer" as const };
  await assert.rejects(f.service.readAsset(viewer, asset.id), fails("NOT_FOUND"));
  assert.equal((await f.service.readAsset(f.context, asset.id)).bytes.toString(), "private voice");
});
test("workspace voice audition acceptance binds runtime, owner, sample and job revision", async () => {
  const f = await fixture(),
    device = await f.register();
  const profileId = "b1dbcc37-bc26-4841-9b1c-2664701cc749";
  const profile = {
    id: profileId,
    name: "Synthetic test",
    revision: hash,
    transcript: "Synthetic test only",
    durationSeconds: 6,
    sampleHash: digest("sample"),
  };
  const saved = await f.service.saveVoice(
    f.context,
    { consent: true, allowMac: true, trustedMacPool: true },
    Buffer.from("sample"),
    profile,
  );
  const draft = await f.draft();
  const episode = structuredClone(draft.episode);
  const changedSpeaker = workspaceSpeakers(episode)[0];
  assert.ok(changedSpeaker);
  changedSpeaker.voice = {
    kind: "workspace-voice",
    tenantId: f.context.tenantId,
    profileId: saved.id,
    revision: hash,
  };
  const changed = await f.service.saveEpisode(
    f.context,
    { episode, expectedRevision: draft.revision },
    draft.id,
  );
  await assert.rejects(
    f.service.submit(
      f.context,
      { episodeId: draft.id, revision: changed.revision, target: { mode: "mac-pool" } },
      "not-accepted",
    ),
    fails("VOICE_APPROVAL_REQUIRED"),
  );
  const audition = await f.service.submit(
    f.context,
    { kind: "audition", profileId, target: { mode: "device", workerId: device.actor.workerId } },
    "audition-request",
  );
  const claim = await f.service.claim(device.actor);
  assert.ok(claim);
  const audio = await f.service.uploadOutput(
    device.actor,
    String(audition.id),
    claim.lease,
    "audition",
    encodePcmWav(Buffer.alloc(6 * 22050 * 2)),
    "audio/wav",
  );
  const metrics = { totalMs: 100, durationSeconds: 6 };
  const manifest = await f.service.uploadOutput(
    device.actor,
    String(audition.id),
    claim.lease,
    "manifest",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        metrics,
        outputs: [{ kind: "audition", sha256: audio.sha256 }],
      }),
    ),
    "application/json",
  );
  await f.service.complete(device.actor, String(audition.id), claim.lease, {
    outputIds: [audio.id, manifest.id],
    metrics,
  });
  await f.db.transaction(async (tx) => {
    tx.set(`tenants/${f.context.tenantId}/voiceProfiles/${profileId}/approvals/older-runtime`, {
      id: "older-runtime",
      engine: "qwen-mlx",
      revision: hash,
      accepted: true,
      runtimeDigest: digest("older-runtime"),
    });
  });
  const completed = (await f.service.list(f.context, "jobs")).find((job) => job.id === audition.id);
  assert.equal(completed?.voiceProfileId, profileId);
  assert.equal(completed?.voiceRevision, hash);
  const approval = await f.service.acceptAudition(f.context, String(audition.id));
  const listed = (await f.service.list(f.context, "voiceProfiles")).find(
    (voice) => voice.id === profileId,
  );
  assert.ok(listed);
  assert.ok(
    (listed.acceptedAuditions as RecordData[]).some(
      (item) => item.auditionJobId === audition.id && item.runtimeDigest === hash,
    ),
  );
  assert.deepEqual(await f.service.list(f.second, "voiceProfiles"), []);
  await f.db.transaction(async (tx) => {
    tx.set(`tenants/${f.context.tenantId}/voiceProfiles/${profileId}/approvals/stale-sample`, {
      id: "stale-sample",
      engine: "qwen-mlx",
      revision: "stale-sample",
      accepted: true,
      runtimeDigest: hash,
    });
  });
  const currentApprovals = (await f.service.list(f.context, "voiceProfiles")).find(
    (voice) => voice.id === profileId,
  )?.acceptedAuditions as RecordData[];
  assert.ok(currentApprovals.every((item) => item.revision === hash));
  assert.equal(approval.runtimeDigest, hash);
  assert.equal(approval.revision, hash);
  const submitted = await f.service.submit(
    f.context,
    { episodeId: draft.id, revision: changed.revision, target: { mode: "mac-pool" } },
    "accepted-job",
  );
  assert.equal(submitted.state, "QUEUED");
  assert.ok(
    (submitted.requirements as { engine: string; digest: string }[]).some(
      (cap) => cap.engine === "qwen-mlx" && cap.digest === hash,
    ),
  );
  await f.service.heartbeat(
    device.actor,
    [
      { engine: "qwen-mlx", digest: digest("updated-runtime") },
      { engine: "video-compose", digest: hash },
    ],
    false,
  );
  const reaudition = await f.service.submit(
    f.context,
    {
      kind: "audition",
      profileId,
      target: { mode: "device", workerId: device.actor.workerId },
    },
    "updated-runtime-audition",
  );
  assert.ok(
    (reaudition.requirements as { engine: string; digest: string }[]).some(
      (cap) => cap.engine === "qwen-mlx" && cap.digest === "",
    ),
  );
  const next = await f.service.claim(device.actor);
  assert.equal(next?.job.id, reaudition.id);
  const staged = await f.service.manifest(device.actor, String(reaudition.id), String(next?.lease));
  assert.equal((staged.snapshot as { voices: { approval: unknown }[] }).voices[0]?.approval, null);
  await f.service.deleteVoice(f.context, profileId);
  assert.equal(await f.service.claim(device.actor), null);
});
test("availability and capability matching distinguish offline devices and incompatible engines", () => {
  const worker = {
    status: "active",
    lastSeenAt: 1000,
    busy: false,
    activeJobId: null,
    capabilities: [{ engine: "kokoro", digest: hash, voices: ["af_heart"] }],
  } as Worker;
  assert.equal(workerAvailability(worker, 1001), "online");
  assert.equal(workerAvailability(worker, 100000), "stale");
  assert.equal(workerAvailability(worker, 130000), "offline");
  assert.equal(matches(worker.capabilities, [{ engine: "qwen-mlx", digest: hash }]), false);
  assert.equal(
    matches(worker.capabilities, [{ engine: "kokoro", digest: "", voices: ["am_michael"] }]),
    false,
  );
});

test("cloud dispatch reserves one execution, cannot duplicate an ambiguous launch, and restricts attempt credentials", async () => {
  const { dispatchCloud } = await import("../src/cloud/cloud-dispatch.js");
  const f = await fixture();
  Object.assign(f.service.options, {
    cloudEnabled: true,
    cloudRuntime: { engine: "qwen-cuda", digest: hash },
    cloudBudgetCents: 50,
    cloudAttemptCents: 50,
  });
  const profileId = "b1dbcc37-bc26-4841-9b1c-2664701cc749";
  await f.service.saveVoice(f.context, { consent: true, allowCloud: true }, Buffer.from("sample"), {
    id: profileId,
    name: "Synthetic cloud fixture",
    revision: hash,
    transcript: "No real voice",
    sampleHash: digest("sample"),
  });
  await f.service.submit(
    f.context,
    { kind: "audition", profileId, target: { mode: "cloud" } },
    "cloud-once",
  );
  let starts = 0;
  let environment: Record<string, string> = {};
  const config = {
    jobName: "projects/test/locations/us-central1/jobs/test",
    runtimeDigest: hash,
    budgetCents: 50,
    attemptCents: 50,
  };
  const launcher = {
    launch: async (env: Record<string, string>) => {
      starts++;
      environment = env;
      return "operations/test";
    },
    completed: async () => false,
  };
  assert.equal(
    (await dispatchCloud(f.service, config, "https://example.test", launcher)).status,
    "STARTED",
  );
  assert.equal(
    (await dispatchCloud(f.service, config, "https://example.test", launcher)).status,
    "BUSY",
  );
  assert.equal(starts, 1);
  const actor = await f.service.workerAuth(String(environment.SHORTS_CLOUD_CREDENTIAL));
  assert.equal(actor.allowedJobId, environment.SHORTS_CLOUD_JOB_ID);
  await assert.rejects(f.service.rotateCredential(actor), fails("ATTEMPT_SCOPE"));
  await assert.rejects(f.service.claim(actor), fails("ATTEMPT_SCOPE"));
  await assert.rejects(
    f.service.manifest(actor, "another-job", String(environment.SHORTS_CLOUD_LEASE)),
    fails("ATTEMPT_SCOPE"),
  );
  const ledger = await f.db.get("platformUsage/cloud");
  assert.equal(ledger?.reservedCents, 50);
  // Model a response lost after the cloud invocation. The durable permit must remain held.
  await f.db.transaction(async (tx) => {
    const outbox = await tx.get(`dispatchOutbox/${actor.allowedJobId}`);
    assert.ok(outbox);
    const { operation, ...remaining } = outbox;
    void operation;
    tx.set(`dispatchOutbox/${actor.allowedJobId}`, remaining);
  });
  assert.equal(
    (await dispatchCloud(f.service, config, "https://example.test", launcher)).status,
    "RECONCILIATION_REQUIRED",
  );
  assert.equal(starts, 1);
});

test("pairing locks after five wrong codes and unregistration revokes every device operation", async () => {
  const f = await fixture(),
    pairing = await f.service.pairingStart({ name: "Protected Mac" });
  for (let attempt = 0; attempt < 5; attempt++)
    await assert.rejects(
      f.service.approvePairing(f.context, pairing.pairingId, "wrong"),
      fails("PAIRING_CODE"),
    );
  await assert.rejects(
    f.service.approvePairing(f.context, pairing.pairingId, pairing.code),
    fails("PAIRING_EXPIRED"),
  );
  const device = await f.register();
  await f.service.unregisterWorker(device.actor);
  await assert.rejects(f.service.workerAuth(String(device.credential)), fails("DEVICE_AUTH"));
});
test("different submission keys do not duplicate the same active generation", async () => {
  const f = await fixture();
  await f.register();
  const draft = await f.draft();
  const input = { episodeId: draft.id, revision: draft.revision, target: { mode: "mac-pool" } };
  const [first, second] = await Promise.all([
    f.service.submit(f.context, input, "double-one"),
    f.service.submit(f.context, input, "double-two"),
  ]);
  assert.equal(first.id, second.id);
  assert.equal((await f.service.list(f.context, "jobs")).length, 1);
});
test("voice deletion erases reference transcripts from revisions and queued snapshots", async () => {
  const f = await fixture();
  await f.register();
  const profileId = "b1dbcc37-bc26-4841-9b1c-2664701cc749",
    transcript = "Private enrollment transcript should be erased";
  await f.service.saveVoice(
    f.context,
    { consent: true, allowMac: true, trustedMacPool: true },
    Buffer.from("sample"),
    {
      id: profileId,
      name: "Synthetic fixture",
      revision: hash,
      transcript,
      sampleHash: digest("sample"),
    },
  );
  const job = await f.service.submit(
    f.context,
    { kind: "audition", profileId, target: { mode: "mac-pool" } },
    "erase-reference",
  );
  await f.service.deleteVoice(f.context, profileId);
  const savedJob = await f.db.get(`tenants/${f.context.tenantId}/jobs/${job.id}`);
  const profile = await f.db.get(`tenants/${f.context.tenantId}/voiceProfiles/${profileId}`);
  assert.equal(savedJob?.state, "CANCELLED");
  assert.equal(JSON.stringify(savedJob).includes(transcript), false);
  assert.equal(JSON.stringify(profile).includes(transcript), false);
  assert.equal(
    (await f.db.list(`tenants/${f.context.tenantId}/voiceProfiles/${profileId}/revisions`)).length,
    0,
  );
  assert.equal((await f.db.list(`tenants/${f.context.tenantId}/assets`)).length, 0);
});

test("retired engines can be archived without losing job history or restoring credentials", async () => {
  const f = await fixture(),
    device = await f.register(),
    draft = await f.draft();
  await f.service.submit(
    f.context,
    {
      episodeId: draft.id,
      revision: draft.revision,
      target: { mode: "device", workerId: device.actor.workerId },
    },
    "archive-history",
  );
  await assert.rejects(
    f.service.updateWorker(f.context, device.actor.workerId, { archived: true }),
    fails("DEVICE_IN_USE"),
  );
  const assignment = await f.service.claim(device.actor);
  assert.ok(assignment);
  await f.service.updateWorker(f.context, device.actor.workerId, { status: "revoked" });
  await assert.rejects(
    f.service.updateWorker(f.context, device.actor.workerId, { archived: true }),
    fails("DEVICE_IN_USE"),
  );
  f.advance(120_001);
  await f.service.reconcile(f.context);
  const archived = await f.service.updateWorker(f.context, device.actor.workerId, {
    archived: true,
  });
  assert.ok(archived.archivedAt);
  assert.equal(archived.status, "revoked");
  assert.equal(
    ((await f.service.list(f.context, "jobs"))[0] as RecordData)?.workerId,
    device.actor.workerId,
  );
  assert.equal((await f.service.list(f.context, "workers"))[0]?.id, device.actor.workerId);
  await assert.rejects(f.service.workerAuth(String(device.credential)), fails("DEVICE_REVOKED"));
  await assert.rejects(
    f.service.updateWorker(f.second, device.actor.workerId, { archived: true }),
    fails("NOT_FOUND"),
  );
});

test("portrait names and recoverable archives preserve media and existing script choices", async () => {
  const f = await fixture();
  const asset = await f.service.saveAsset(
    f.context,
    "portrait",
    Buffer.from("synthetic-image"),
    "image/png",
  );
  const renamed = await f.service.updatePortrait(f.context, asset.id, {
    name: "Presenter · formal",
  });
  assert.equal(renamed.name, "Presenter · formal");
  assert.equal(renamed.sha256, asset.sha256);
  await assert.rejects(
    f.service.updatePortrait(f.second, asset.id, { name: "Wrong account" }),
    fails("NOT_FOUND"),
  );
  const draft = await f.draft();
  const episode = structuredClone(draft.episode);
  const speaker = workspaceSpeakers(episode)[0];
  assert.ok(speaker);
  speaker.avatar = { mode: "photo", imageId: `${asset.id}.png`, animation: "mouth-only" };
  const saved = await f.service.saveEpisode(
    f.context,
    { episode, expectedRevision: draft.revision },
    draft.id,
  );
  await f.service.updatePortrait(f.context, asset.id, { archived: true });
  assert.equal(
    (await f.service.readAsset(f.context, asset.id)).bytes.toString(),
    "synthetic-image",
  );
  const current = (await f.service.list(f.context, "episodes"))[0];
  assert.deepEqual((current as RecordData)?.episode, saved.episode);
  const restored = await f.service.updatePortrait(f.context, asset.id, { archived: false });
  assert.equal(restored.archivedAt, null);
  await assert.rejects(
    f.service.updatePortrait({ ...f.context, role: "viewer" }, asset.id, { archived: true }),
    fails("FORBIDDEN"),
  );
});

test("a voice links multiple workspace photos with a default without invalidating its audio approval", async () => {
  const f = await fixture();
  const first = await f.service.saveAsset(
    f.context,
    "portrait",
    Buffer.from("formal"),
    "image/png",
  );
  const second = await f.service.saveAsset(
    f.context,
    "portrait",
    Buffer.from("casual"),
    "image/png",
  );
  const other = await f.service.saveAsset(f.second, "portrait", Buffer.from("other"), "image/png");
  const profile = await f.service.saveVoice(
    f.context,
    { consent: true, allowMac: true, trustedMacPool: true },
    Buffer.from("reference"),
    { id: "photo-voice", revision: hash, name: "Test speaker", sampleHash: digest("reference") },
  );
  const path = `tenants/${f.context.tenantId}/voiceProfiles/${profile.id}`;
  await f.db.transaction(async (tx) => {
    tx.set(`${path}/approvals/qwen-mlx`, { id: "qwen-mlx", accepted: true, runtimeDigest: hash });
  });
  const input = {
    portraitIds: [first.id, second.id],
    defaultPortraitId: second.id,
    expectedPortraitRevision: null,
  };
  const linked = await f.service.updateVoicePortraits(f.context, String(profile.id), input);
  assert.deepEqual(linked.portraitIds, [first.id, second.id]);
  assert.equal(linked.defaultPortraitId, second.id);
  assert.equal(linked.revision, hash);
  assert.equal((await f.db.get(`${path}/approvals/qwen-mlx`))?.accepted, true);
  await assert.rejects(
    f.service.updateVoicePortraits(f.context, String(profile.id), input),
    fails("REVISION_CONFLICT"),
  );
  await assert.rejects(
    f.service.updateVoicePortraits(f.context, String(profile.id), {
      ...input,
      portraitIds: [first.id],
      defaultPortraitId: second.id,
      expectedPortraitRevision: linked.portraitRevision,
    }),
    fails("INVALID_PORTRAIT"),
  );
  await assert.rejects(
    f.service.updateVoicePortraits(f.context, String(profile.id), {
      ...input,
      portraitIds: [other.id],
      defaultPortraitId: null,
      expectedPortraitRevision: linked.portraitRevision,
    }),
    fails("INVALID_PORTRAIT"),
  );
  await assert.rejects(
    f.service.updateVoicePortraits(f.second, String(profile.id), input),
    fails("NOT_FOUND"),
  );
  await f.service.updatePortrait(f.context, second.id, { archived: true });
  await assert.rejects(
    f.service.updateVoicePortraits(f.context, String(profile.id), {
      ...input,
      expectedPortraitRevision: linked.portraitRevision,
    }),
    fails("INVALID_PORTRAIT"),
  );
  await f.service.updatePortrait(f.context, second.id, { archived: false });
  const kept = await f.db.get(path);
  assert.deepEqual(kept?.portraitIds, [first.id, second.id]);
  const cleared = await f.service.updateVoicePortraits(f.context, String(profile.id), {
    portraitIds: [],
    defaultPortraitId: null,
    expectedPortraitRevision: linked.portraitRevision,
  });
  assert.deepEqual(cleared.portraitIds, []);
  assert.equal(cleared.defaultPortraitId, null);
});
