import { randomInt } from "node:crypto";
import type { BlobStore } from "./blobs.js";
import {
  type Actor,
  type Asset,
  type Capability,
  type Context,
  digest,
  equalSecret,
  fail,
  id,
  identifier,
  type Job,
  matches,
  object,
  permit,
  type RecordData,
  secret,
  type Target,
  terminal,
  text,
  type Worker,
  workerAvailability,
} from "./contracts.js";
import type { Database, DatabaseReader } from "./database.js";
import { validateWorkspaceEpisode, workspaceSpeakers } from "./episodes.js";
import { verifyOutputs } from "./verify-output.js";

const leaseMs = 120_000;
const root = (tenantId: string) => `tenants/${identifier(tenantId)}`;
const child = (context: Pick<Context, "tenantId">, collection: string, key?: string) =>
  `${root(context.tenantId)}/${collection}${key ? `/${identifier(key)}` : ""}`;
export interface ServiceOptions {
  now?: () => number;
  pilotEmails: string[];
  isUserActive: (uid: string, authorizedAt: number) => Promise<boolean>;
  cloudEnabled?: boolean;
  cloudRuntime?: Capability;
  cloudBudgetCents?: number;
  cloudAttemptCents?: number;
}
export interface WorkerActor {
  allowedJobId?: string;
  tenantId: string;
  workerId: string;
  credentialId: string;
}
export class WorkspaceService {
  readonly now: () => number;
  constructor(
    readonly db: Database,
    readonly blobs: BlobStore,
    readonly options: ServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }
  async bootstrap(actor: Actor) {
    return this.db.transaction(async (tx) => {
      const existing = await tx.get(`users/${identifier(actor.uid)}`);
      if (existing) return existing;
      if (
        !this.options.pilotEmails
          .map((email) => email.toLowerCase())
          .includes(actor.email.toLowerCase())
      )
        fail(
          403,
          "ACCESS_PENDING",
          "Your account is verified. Workspace access is awaiting an invitation.",
        );

      const tenantId = id();
      const user = { uid: actor.uid, email: actor.email, tenantId, createdAt: this.now() };
      tx.set(`users/${actor.uid}`, user);
      tx.set(root(tenantId), {
        id: tenantId,
        name: "My workspace",
        ownerId: actor.uid,
        createdAt: this.now(),
        status: "active",
      });
      tx.set(`${root(tenantId)}/members/${actor.uid}`, {
        uid: actor.uid,
        role: "owner",
        status: "active",
      });
      return user;
    });
  }
  async context(
    actor: Actor,
    tenantId: string,
    reader: DatabaseReader = this.db,
  ): Promise<Context> {
    const [workspace, member] = await Promise.all([
      reader.get(root(tenantId)),
      reader.get(`${root(tenantId)}/members/${identifier(actor.uid)}`),
    ]);
    if (
      workspace?.status !== "active" ||
      member?.status !== "active" ||
      !["owner", "admin", "editor", "viewer"].includes(String(member?.role))
    )
      fail(404, "WORKSPACE_UNAVAILABLE", "Workspace unavailable.");
    return { ...actor, tenantId, role: member.role as Context["role"] };
  }
  async me(actor: Actor) {
    const user = await this.db.get(`users/${identifier(actor.uid)}`);
    if (!user) return { ...actor, workspace: null };
    const context = await this.context(actor, String(user.tenantId));
    return {
      uid: actor.uid,
      email: actor.email,
      workspace: { id: context.tenantId, role: context.role },
    };
  }
  async list(
    context: Context,
    collection: "episodes" | "jobs" | "assets" | "workers" | "voiceProfiles",
  ): Promise<RecordData[]> {
    const records = await this.db.list(child(context, collection));
    const visible = records
      .filter(
        (item) =>
          (collection !== "voiceProfiles" || item.ownerId === context.uid) &&
          (collection !== "assets" ||
            !["sample", "audition"].includes(String(item.kind)) ||
            item.ownerId === context.uid),
      )
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    return Promise.all(
      visible.map(async (item) => {
        if (collection === "workers") return this.workerView(item as Worker);
        if (collection === "jobs") return this.jobView(item as Job);
        const safe = this.safeRecord(item);
        if (collection !== "voiceProfiles") return safe;
        const approvals = await this.db.list(
          `${child(context, "voiceProfiles", String(item.id))}/approvals`,
        );
        return {
          ...safe,
          acceptedAuditions: approvals
            .filter((approval) => approval.accepted === true && approval.revision === item.revision)
            .map(({ engine, runtimeDigest, revision, auditionJobId, acceptedAt }) => ({
              engine,
              runtimeDigest,
              revision,
              auditionJobId,
              acceptedAt,
            })),
        };
      }),
    );
  }
  private safeRecord(item: RecordData) {
    const { path, leaseHash, credentialHash, transcript, ...safe } = item;
    void path;
    void leaseHash;
    void credentialHash;
    void transcript;
    return safe;
  }
  jobView(job: Job) {
    const { leaseHash, snapshot, ...safe } = job;
    void leaseHash;
    void snapshot;
    const episode = job.snapshot.episode as RecordData;
    const speakers = (episode.presentation as { speakers?: RecordData[] })?.speakers ?? [];
    const profiles = job.snapshot.voices as { profile: RecordData; speakerId: string }[];
    return {
      ...safe,
      ...(job.kind === "audition" && profiles[0]
        ? {
            voiceProfileId: profiles[0].profile.id,
            voiceRevision: profiles[0].profile.revision,
          }
        : {}),
      title:
        job.kind === "audition"
          ? `Audition: ${profiles[0]?.profile.name ?? "My voice"}`
          : String(episode.title ?? "Episode production"),
      speakers: speakers.map((speaker) => ({
        name: speaker.name ?? "Narrator",
        voice:
          typeof speaker.voice === "string"
            ? speaker.voice
            : (profiles.find((voice) => voice.speakerId === speaker.id)?.profile.name ??
              "Personal voice"),
      })),
    };
  }
  workerView(worker: Worker) {
    return { ...worker, availability: workerAvailability(worker, this.now()) };
  }
  async saveEpisode(context: Context, input: RecordData, key: string = id()) {
    permit(context);
    const episode = validateWorkspaceEpisode(input.episode, context.tenantId);
    const revision = digest(JSON.stringify(episode));
    const path = child(context, "episodes", key);
    return this.db.transaction(async (tx) => {
      const existing = await tx.get(path);
      const episodes = await tx.list(child(context, "episodes"));
      if (!existing && episodes.length >= 200)
        fail(409, "WORKSPACE_LIMIT", "This pilot workspace has reached its 200-script limit.");
      if ((existing?.revision ?? null) !== (input.expectedRevision ?? null))
        fail(
          409,
          "REVISION_CONFLICT",
          "This script changed in another window. Reload or save a new copy.",
        );
      const record = {
        id: key,
        tenantId: context.tenantId,
        episode,
        title: String(episode.title),
        revision,
        createdAt: existing?.createdAt ?? this.now(),
        updatedAt: this.now(),
        createdBy: context.uid,
      };
      tx.set(path, record);
      tx.set(`${path}/revisions/${revision}`, record);
      return record;
    });
  }
  async pairingStart(input: RecordData) {
    const pairingId = id(),
      pollingSecret = secret();
    const code = `${randomInt(100000, 999999)}`;
    const record = {
      id: pairingId,
      codeHash: digest(code),
      pollingHash: digest(pollingSecret),
      name: text(input.name, "device name", 64),
      createdAt: this.now(),
      expiresAt: this.now() + 600_000,
      tenantId: null,
      approvedBy: null,
      redeemed: false,
      tries: 0,
    };
    await this.db.transaction(async (tx) => {
      tx.set(`workerPairings/${pairingId}`, record);
    });
    return { pairingId, pollingSecret, code, expiresAt: record.expiresAt };
  }
  async approvePairing(context: Context, pairingId: string, code: string) {
    permit(context, ["owner", "admin"]);
    const result = await this.db.transaction(async (tx) => {
      const path = `workerPairings/${identifier(pairingId)}`;
      const pairing = await tx.get(path);
      if (
        !pairing ||
        Number(pairing.expiresAt) < this.now() ||
        pairing.approvedBy ||
        pairing.redeemed ||
        Number(pairing.tries) >= 5
      )
        fail(409, "PAIRING_EXPIRED", "Start a new pairing on the device.");
      if (!equalSecret(String(pairing.codeHash), digest(code))) {
        tx.set(path, { ...pairing, tries: Number(pairing.tries) + 1 });
        return { rejected: true };
      }
      tx.set(path, {
        ...pairing,
        tenantId: context.tenantId,
        approvedBy: context.uid,
        approvedAuthTime: context.authTime,
      });
      return { approved: true, name: pairing.name };
    });
    if ("rejected" in result) fail(403, "PAIRING_CODE", "The pairing code does not match.");
    return result;
  }
  async redeemPairing(pairingId: string, pollingSecret: string) {
    return this.db.transaction(async (tx) => {
      const path = `workerPairings/${identifier(pairingId)}`;
      const pairing = await tx.get(path);
      if (
        !pairing ||
        pairing.pollingHash !== digest(pollingSecret) ||
        Number(pairing.expiresAt) < this.now() ||
        pairing.redeemed
      )
        fail(403, "PAIRING_EXPIRED", "Pairing unavailable or expired.");
      if (!pairing.approvedBy) return { pending: true };
      const workerId = id(),
        credentialId = id(),
        credentialSecret = secret();
      const credential = `${credentialId}.${credentialSecret}`;
      const tenantId = String(pairing.tenantId);
      const worker: Worker = {
        id: workerId,
        tenantId,
        name: String(pairing.name),
        providerId: "mac",
        registeredBy: String(pairing.approvedBy),
        registeredAuthTime: Number(pairing.approvedAuthTime ?? pairing.createdAt),
        status: "active",
        lastSeenAt: 0,
        capabilities: [],
        busy: false,
        activeJobId: null,
        platform: "darwin",
        architecture: "arm64",
        createdAt: this.now(),
      };
      tx.set(`${root(tenantId)}/workers/${workerId}`, worker);
      tx.set(`workerCredentials/${credentialId}`, {
        tenantId,
        workerId,
        hash: digest(credential),
        expiresAt: this.now() + 30 * 86400_000,
        revoked: false,
      });
      tx.set(path, { ...pairing, redeemed: true });
      return { tenantId, workerId, credential, expiresAt: this.now() + 30 * 86400_000 };
    });
  }
  async workerAuth(credential: string): Promise<WorkerActor> {
    const credentialId = credential.split(".")[0];
    if (!credentialId || !/^[a-f0-9-]{36}$/u.test(credentialId))
      fail(401, "DEVICE_AUTH", "Register this rendering device.");
    const stored = await this.db.get(`workerCredentials/${credentialId}`);
    if (
      !stored ||
      stored.revoked ||
      Number(stored.expiresAt) <= this.now() ||
      !equalSecret(String(stored.hash), digest(credential))
    )
      fail(401, "DEVICE_AUTH", "Device authorization expired or was revoked. Register again.");
    const worker = await this.db.get(
      `${root(String(stored.tenantId))}/workers/${identifier(stored.workerId)}`,
    );
    if (!worker || worker.status === "revoked")
      fail(401, "DEVICE_REVOKED", "This device was revoked.");
    if (
      !stored.allowedJobId &&
      !(await this.options.isUserActive(
        String(worker.registeredBy),
        Number(worker.registeredAuthTime ?? worker.createdAt),
      ))
    )
      fail(401, "DEVICE_REVOKED", "The registering account no longer has rendering access.");
    const workspace = await this.db.get(root(String(stored.tenantId)));
    const registeringMember = stored.allowedJobId
      ? null
      : await this.db.get(
          `${root(String(stored.tenantId))}/members/${identifier(worker.registeredBy)}`,
        );
    if (
      workspace?.status !== "active" ||
      (!stored.allowedJobId && registeringMember?.status !== "active")
    )
      fail(401, "DEVICE_REVOKED", "Workspace or device access was revoked.");
    return {
      tenantId: String(stored.tenantId),
      workerId: String(stored.workerId),
      credentialId,
      ...(stored.allowedJobId ? { allowedJobId: String(stored.allowedJobId) } : {}),
    };
  }
  async rotateCredential(actor: WorkerActor) {
    if (actor.allowedJobId)
      fail(403, "ATTEMPT_SCOPE", "Cloud attempt credentials cannot be extended.");
    const credentialId = id(),
      credential = `${credentialId}.${secret()}`;
    const expiresAt = this.now() + 30 * 86400_000;
    await this.db.transaction(async (tx) => {
      const old = await tx.get(`workerCredentials/${actor.credentialId}`);
      if (!old || old.revoked) fail(401, "DEVICE_REVOKED", "This device was revoked.");
      tx.set(`workerCredentials/${credentialId}`, {
        tenantId: actor.tenantId,
        workerId: actor.workerId,
        hash: digest(credential),
        expiresAt,
        revoked: false,
      });
      tx.set(`workerCredentials/${actor.credentialId}`, {
        ...old,
        expiresAt: Math.min(Number(old.expiresAt), this.now() + 300_000),
      });
    });
    return { credential, expiresAt };
  }
  async unregisterWorker(actor: WorkerActor) {
    if (actor.allowedJobId)
      fail(403, "ATTEMPT_SCOPE", "Cloud execution credentials cannot manage providers.");
    await this.db.transaction(async (tx) => {
      const workerPath = `${root(actor.tenantId)}/workers/${actor.workerId}`;
      const worker = await tx.get<Worker>(workerPath);
      const credential = await tx.get(`workerCredentials/${actor.credentialId}`);
      const job = worker?.activeJobId
        ? await tx.get<Job>(`${root(actor.tenantId)}/jobs/${worker.activeJobId}`)
        : null;
      if (worker) tx.set(workerPath, { ...worker, status: "revoked", revokedAt: this.now() });
      if (credential)
        tx.set(`workerCredentials/${actor.credentialId}`, { ...credential, revoked: true });
      if (job && !terminal(job.state))
        tx.set(`${root(actor.tenantId)}/jobs/${job.id}`, {
          ...job,
          state: "CANCELLED",
          stage: "DEVICE_REMOVED",
          leaseHash: null,
          leaseUntil: 0,
          updatedAt: this.now(),
          completedAt: this.now(),
        });
    });
    return { revoked: true };
  }
  async deviceStatus(actor: WorkerActor) {
    const worker = await this.db.get<Worker>(`${root(actor.tenantId)}/workers/${actor.workerId}`);
    if (!worker) fail(404, "NOT_FOUND", "Device unavailable.");
    return this.workerView(worker);
  }
  async updateWorker(context: Context, workerId: string, input: RecordData) {
    permit(context, ["owner", "admin"]);
    return this.db.transaction(async (tx) => {
      const path = child(context, "workers", workerId);
      const worker = await tx.get<Worker>(path);
      if (!worker) fail(404, "NOT_FOUND", "Rendering device unavailable.");
      if (input.archived === true) {
        if (worker.status !== "revoked" || worker.activeJobId)
          fail(
            409,
            "DEVICE_IN_USE",
            "Revoke the device and let its current attempt stop before archiving it.",
          );
        const archived = { ...worker, archivedAt: this.now() };
        tx.set(path, archived);
        return this.workerView(archived);
      }
      if (worker.status === "revoked")
        fail(409, "DEVICE_REVOKED", "Register the device again to restore access.");
      const status =
        input.status === undefined ? worker.status : text(input.status, "device status", 16);
      if (!["active", "draining", "disabled", "revoked"].includes(status))
        fail(400, "INVALID_INPUT", "Invalid device state.");
      const updated = {
        ...worker,
        status: status as Worker["status"],
        name: input.name === undefined ? worker.name : text(input.name, "device name", 64),
      };
      tx.set(path, updated);
      return this.workerView(updated);
    });
  }
  async heartbeat(actor: WorkerActor, capabilities: Capability[], busy: boolean) {
    return this.db.transaction(async (tx) => {
      const path = `${root(actor.tenantId)}/workers/${actor.workerId}`;
      const worker = await tx.get<Worker>(path);
      if (!worker || worker.status === "revoked")
        fail(401, "DEVICE_REVOKED", "This device was revoked.");
      const updated = { ...worker, capabilities, busy, lastSeenAt: this.now() };
      tx.set(path, updated);
      return this.workerView(updated);
    });
  }
  private async checkStorageQuota(tx: DatabaseReader, tenantId: string, additionalBytes: number) {
    const assets = await tx.list<Asset>(`${root(tenantId)}/assets`);
    if (
      assets.length >= 500 ||
      assets.reduce((sum, asset) => sum + asset.size, additionalBytes) > 512 * 1024 * 1024
    )
      fail(
        409,
        "STORAGE_LIMIT",
        "This pilot workspace has reached its 512 MiB or 500-file storage limit.",
      );
  }
  async saveAsset(
    context: Context,
    kind: Asset["kind"],
    bytes: Buffer,
    contentType: string,
    key = id(),
    jobId: string | null = null,
  ) {
    const path = `${root(context.tenantId)}/assets/${key}/data`;
    const asset: Asset = {
      id: key,
      tenantId: context.tenantId,
      ownerId: context.uid,
      kind,
      path,
      sha256: digest(bytes),
      size: bytes.length,
      contentType,
      createdAt: this.now(),
      jobId,
    };
    await this.blobs.put(path, bytes, contentType);
    try {
      await this.db.transaction(async (tx) => {
        await this.checkStorageQuota(tx, context.tenantId, bytes.length);
        tx.set(child(context, "assets", key), asset);
      });
    } catch (error) {
      await this.blobs.delete(path);
      throw error;
    }
    return asset;
  }
  async readAsset(context: Context, assetId: string) {
    const asset = await this.db.get<Asset>(child(context, "assets", assetId));
    if (!asset || (["sample", "audition"].includes(asset.kind) && asset.ownerId !== context.uid))
      fail(404, "NOT_FOUND", "Media unavailable.");
    if (asset.jobId) {
      const job = await this.db.get<Job>(child(context, "jobs", asset.jobId));
      if (job?.state !== "SUCCEEDED" || !job.outputIds.includes(asset.id))
        fail(404, "NOT_FOUND", "Media is not ready for review.");
    }
    const bytes = await this.blobs.get(asset.path);
    if (digest(bytes) !== asset.sha256) fail(409, "ASSET_CHANGED", "Media integrity check failed.");
    return { asset, bytes };
  }
  async updatePortrait(context: Context, assetId: string, input: RecordData) {
    permit(context);
    return this.db.transaction(async (tx) => {
      const path = child(context, "assets", assetId);
      const asset = await tx.get<Asset>(path);
      if (
        asset?.kind !== "portrait" ||
        (asset.ownerId !== context.uid && !["owner", "admin"].includes(context.role))
      )
        fail(404, "NOT_FOUND", "Portrait unavailable.");
      const updated = {
        ...asset,
        name:
          input.name === undefined
            ? (asset.name ?? "Portrait")
            : text(input.name, "portrait name", 64),
        archivedAt:
          input.archived === true
            ? this.now()
            : input.archived === false
              ? null
              : (asset.archivedAt ?? null),
        updatedAt: this.now(),
      };
      tx.set(path, updated);
      return this.safeRecord(updated);
    });
  }
  async updateVoicePortraits(context: Context, profileId: string, input: RecordData) {
    permit(context);
    if (!Array.isArray(input.portraitIds) || input.portraitIds.length > 20)
      fail(400, "INVALID_INPUT", "Choose up to 20 portraits for this voice.");
    const portraitIds = [...new Set(input.portraitIds.map(identifier))];
    const defaultPortraitId =
      input.defaultPortraitId === null ? null : identifier(input.defaultPortraitId);
    if (defaultPortraitId && !portraitIds.includes(defaultPortraitId))
      fail(400, "INVALID_PORTRAIT", "The default photo must be linked to this voice.");
    return this.db.transaction(async (tx) => {
      const path = child(context, "voiceProfiles", profileId);
      const profile = await tx.get(path);
      if (profile?.status !== "active" || profile.ownerId !== context.uid)
        fail(404, "NOT_FOUND", "Voice unavailable.");
      if ((profile.portraitRevision ?? null) !== (input.expectedPortraitRevision ?? null))
        fail(
          409,
          "REVISION_CONFLICT",
          "These photo links changed in another window. Refresh and try again.",
        );
      const portraits = await Promise.all(
        portraitIds.map((key) => tx.get<Asset>(child(context, "assets", key))),
      );
      if (portraits.some((asset) => asset?.kind !== "portrait" || asset.archivedAt))
        fail(404, "INVALID_PORTRAIT", "Choose active photos from this workspace.");
      const updated = {
        ...profile,
        portraitIds,
        defaultPortraitId,
        portraitRevision: digest(JSON.stringify({ portraitIds, defaultPortraitId })),
        updatedAt: this.now(),
      };
      // Presentation preferences do not change the audio revision or invalidate auditions.
      tx.set(path, updated);
      return this.safeRecord(updated);
    });
  }
  async saveVoice(context: Context, input: RecordData, sample: Buffer, profile: RecordData) {
    permit(context);
    if (input.consent !== true || (input.allowMac !== true && input.allowCloud !== true))
      fail(400, "CONSENT_REQUIRED", "Confirm storage and permitted processing destinations.");
    const profileId = identifier(profile.id),
      revision = text(profile.revision, "voice revision", 64);
    const trustedIds = Array.isArray(input.trustedWorkerIds)
      ? input.trustedWorkerIds.map(identifier)
      : [];
    if (input.allowMac === true && input.trustedMacPool !== true && !trustedIds.length)
      fail(
        400,
        "CONSENT_REQUIRED",
        "Choose a trusted rendering device or approve your registered Mac pool.",
      );
    for (const workerId of trustedIds)
      if (!(await this.db.get(child(context, "workers", workerId))))
        fail(400, "INVALID_TARGET", "Choose a device registered to this workspace.");
    const sampleAsset = await this.saveAsset(context, "sample", sample, "audio/wav");
    const record = {
      id: profileId,
      tenantId: context.tenantId,
      ownerId: context.uid,
      name: text(profile.name, "voice name", 64),
      revision,
      transcript: profile.transcript,
      sampleAssetId: sampleAsset.id,
      profile,
      allowMac: input.allowMac === true,
      allowCloud: input.allowCloud === true,
      trustedWorkerIds: Array.isArray(input.trustedWorkerIds)
        ? input.trustedWorkerIds.map(identifier)
        : [],
      trustedMacPool: input.trustedMacPool === true,
      consentAt: this.now(),
      status: "active",
      createdAt: this.now(),
    };
    if (record.allowMac && !record.trustedMacPool && !record.trustedWorkerIds.length)
      fail(
        400,
        "CONSENT_REQUIRED",
        "Choose a trusted rendering device or approve your registered Mac pool.",
      );
    await this.db.transaction(async (tx) => {
      tx.set(child(context, "voiceProfiles", profileId), record);
      tx.set(`${child(context, "voiceProfiles", profileId)}/revisions/${revision}`, record);
    });
    return this.safeRecord(record);
  }
  private async approvedVoices(
    reader: DatabaseReader,
    context: Context,
    episode: RecordData,
    target: Target,
    audition = false,
  ) {
    const engine = target.mode === "cloud" ? "qwen-cuda" : "qwen-mlx";
    const voices: {
      profile: RecordData;
      accepted: RecordData[];
      approval: RecordData | null;
      speakerId: unknown;
    }[] = [];
    for (const speaker of workspaceSpeakers(episode)) {
      if (typeof speaker.voice === "string") continue;
      const ref = object(speaker.voice);
      const profile = await reader.get(child(context, "voiceProfiles", identifier(ref.profileId)));
      if (
        profile?.status !== "active" ||
        profile.ownerId !== context.uid ||
        profile.revision !== ref.revision ||
        (target.mode === "cloud" ? !profile.allowCloud : !profile.allowMac)
      )
        fail(
          403,
          "VOICE_UNAVAILABLE",
          "This voice is unavailable for the selected processing destination.",
        );
      if (
        target.mode === "device" &&
        !profile.trustedMacPool &&
        !(profile.trustedWorkerIds as string[]).includes(String(target.workerId))
      )
        fail(403, "VOICE_DEVICE_DENIED", "This voice has not been approved for that device.");
      const approvals = await reader.list(
        `${child(context, "voiceProfiles", String(profile.id))}/approvals`,
      );
      const accepted = approvals.filter(
        (item) =>
          item.engine === engine && item.revision === ref.revision && item.accepted === true,
      );
      if (!audition && !accepted.length)
        fail(
          409,
          "VOICE_APPROVAL_REQUIRED",
          `Open My voices and listen to the audition for "${profile.name}", then accept it before producing.`,
        );
      voices.push({
        profile,
        accepted,
        approval: null as RecordData | null,
        speakerId: speaker.id,
      });
    }
    if (!audition && voices.length) {
      if (target.mode === "cloud") {
        for (const voice of voices) {
          voice.approval =
            voice.accepted.find(
              (item) => item.runtimeDigest === this.options.cloudRuntime?.digest,
            ) ?? null;
        }
      } else {
        const stock = workspaceSpeakers(episode)
          .map((speaker) => speaker.voice)
          .filter((voice): voice is string => typeof voice === "string");
        const needs: Capability[] = [{ engine: "video-compose", digest: "" }];
        if (stock.length) needs.push({ engine: "kokoro", digest: "", voices: stock });
        if (
          workspaceSpeakers(episode).some(
            (speaker) => (speaker.avatar as RecordData)?.animation === "neural",
          )
        )
          needs.push({ engine: "ditto-mps", digest: "" });
        const candidates = (await reader.list<Worker>(child(context, "workers")))
          .filter(
            (worker) =>
              worker.status !== "revoked" &&
              worker.status !== "disabled" &&
              (!target.workerId || worker.id === target.workerId) &&
              matches(worker.capabilities, needs),
          )
          .sort((a, b) => Number(b.lastSeenAt) - Number(a.lastSeenAt));
        const compatible = candidates.find((worker) =>
          voices.every(
            (voice) =>
              (voice.profile.trustedMacPool ||
                (voice.profile.trustedWorkerIds as string[]).includes(worker.id)) &&
              voice.accepted.some((approval) =>
                worker.capabilities.some(
                  (cap) => cap.engine === engine && cap.digest === approval.runtimeDigest,
                ),
              ),
          ),
        );
        if (compatible)
          for (const voice of voices) {
            voice.approval =
              voice.accepted.find((approval) =>
                compatible.capabilities.some(
                  (cap) => cap.engine === engine && cap.digest === approval.runtimeDigest,
                ),
              ) ?? null;
          }
      }
      if (voices.some((voice) => !voice.approval))
        fail(
          409,
          "VOICE_APPROVAL_REQUIRED",
          "Open My voices to generate and accept an audition on the selected rendering engine for each personal voice.",
        );
    }
    // Re-auditions deliberately use the installed runtime, never an earlier approval.
    return voices.map(({ accepted, ...voice }) => {
      void accepted;
      return voice;
    });
  }
  async submit(context: Context, input: RecordData, idempotencyKey: string) {
    permit(context);
    identifier(idempotencyKey);
    const targetInput = object(input.target);
    if (!["mac-pool", "device", "cloud"].includes(String(targetInput.mode)))
      fail(400, "INVALID_TARGET", "Choose a rendering engine.");
    const target: Target = { mode: targetInput.mode as Target["mode"] };
    if (target.mode === "device") target.workerId = identifier(targetInput.workerId);
    if (
      target.mode === "cloud" &&
      (!this.options.cloudEnabled || !this.options.cloudRuntime || !this.options.cloudBudgetCents)
    )
      fail(409, "BUDGET_REQUIRED", "Cloud GPU rendering is not enabled with an approved budget.");
    const requestHash = digest(JSON.stringify({ input, uid: context.uid }));
    return this.db.transaction(async (tx) => {
      const current = await this.context(context, context.tenantId, tx);
      permit(current);
      const requestPath = child(context, "requests", idempotencyKey);
      const previous = await tx.get(requestPath);
      if (previous) {
        if (previous.requestHash !== requestHash || previous.createdBy !== context.uid)
          fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This submission key already belongs to another request.",
          );
        const job = await tx.get<Job>(child(context, "jobs", String(previous.jobId)));
        if (!job) fail(409, "JOB_UNAVAILABLE", "This request is unavailable.");
        return this.jobView(job);
      }
      const jobs = await tx.list<Job>(child(context, "jobs"));
      if (jobs.length >= 500)
        fail(
          409,
          "WORKSPACE_LIMIT",
          "This pilot workspace has reached its 500-job history limit. Export and archive it before continuing.",
        );
      if (jobs.filter((job) => !terminal(job.state)).length >= 10)
        fail(429, "QUEUE_FULL", "Finish or cancel an existing job first.");
      const duplicate = jobs.find(
        (job) =>
          !terminal(job.state) && job.requestHash === requestHash && job.createdBy === context.uid,
      );
      if (duplicate) {
        tx.set(requestPath, { jobId: duplicate.id, createdBy: context.uid, requestHash });
        return this.jobView(duplicate);
      }
      const workers = await tx.list<Worker>(child(context, "workers"));
      if (
        target.workerId &&
        !workers.some((worker) => worker.id === target.workerId && worker.status !== "revoked")
      )
        fail(400, "INVALID_TARGET", "Choose a registered workspace device.");
      const audition = input.kind === "audition";
      let episode: RecordData;
      let revision: string;
      if (audition) {
        const profileId = identifier(input.profileId);
        const profile = await tx.get(child(context, "voiceProfiles", profileId));
        if (!profile || profile.ownerId !== context.uid)
          fail(404, "VOICE_UNAVAILABLE", "Voice unavailable.");
        revision = String(profile.revision);
        episode = {
          presentation: {
            speakers: [
              {
                id: "narrator",
                voice: { kind: "workspace-voice", tenantId: context.tenantId, profileId, revision },
              },
            ],
          },
        };
      } else {
        const saved = await tx.get(child(context, "episodes", identifier(input.episodeId)));
        if (!saved || saved.revision !== input.revision)
          fail(409, "REVISION_CONFLICT", "Save and reload this script before producing.");
        episode = validateWorkspaceEpisode(saved.episode, context.tenantId, true);
        revision = String(saved.revision);
      }
      const voices = await this.approvedVoices(tx, context, episode, target, audition);
      const requirements: Capability[] = [];
      const stock = workspaceSpeakers(episode)
        .map((speaker) => speaker.voice)
        .filter((voice): voice is string => typeof voice === "string");
      if (stock.length)
        requirements.push({ engine: "kokoro", digest: "", voices: [...new Set(stock)] });
      for (const voice of voices) {
        const engine = target.mode === "cloud" ? "qwen-cuda" : "qwen-mlx";
        const runtime =
          voice.approval?.runtimeDigest ??
          (target.mode === "cloud" ? this.options.cloudRuntime?.digest : "");
        const requirement = { engine, digest: String(runtime ?? "") };
        if (
          !requirements.some((item) => item.engine === engine && item.digest === requirement.digest)
        )
          requirements.push(requirement);
      }
      const assetIds = new Set<string>();
      for (const speaker of workspaceSpeakers(episode)) {
        const avatar = speaker.avatar ? object(speaker.avatar) : null;
        if (avatar?.mode === "photo") {
          const assetId = identifier(String(avatar.imageId).replace(/\.png$/u, ""));
          const asset = await tx.get<Asset>(child(context, "assets", assetId));
          if (asset?.kind !== "portrait")
            fail(404, "PORTRAIT_UNAVAILABLE", "Upload the portrait to this workspace first.");
          assetIds.add(assetId);
          if (avatar.animation === "neural") requirements.push({ engine: "ditto-mps", digest: "" });
        }
      }
      if (!audition) requirements.push({ engine: "video-compose", digest: "" });
      if (
        target.mode === "cloud" &&
        requirements.some((item) => ["ditto-mps", "kokoro"].includes(item.engine))
      )
        fail(
          409,
          "UNSUPPORTED_CLOUD_ENGINE",
          "This cloud provider currently supports Qwen narration with illustrated presenters. Choose a registered Mac for this combination.",
        );
      if (
        target.mode !== "cloud" &&
        !workers.some(
          (worker) =>
            worker.status !== "revoked" &&
            (!target.workerId || worker.id === target.workerId) &&
            matches(worker.capabilities, requirements) &&
            voices.every(
              (voice) =>
                voice.profile.trustedMacPool ||
                (voice.profile.trustedWorkerIds as string[]).includes(worker.id),
            ),
        )
      )
        fail(
          409,
          "NO_COMPATIBLE_WORKER",
          "Register a compatible Mac and approve this voice for it before submitting.",
        );
      const jobId = id();
      const snapshot = {
        episodeId: audition ? null : input.episodeId,
        episode,
        revision,
        voices,
        assetIds: [...assetIds],
        auditionText:
          "Let's make S A P simpler. Your cap A P I exposes oh data. Type N P M run demo.",
      };
      const job: Job = {
        id: jobId,
        tenantId: context.tenantId,
        createdBy: context.uid,
        kind: audition ? "audition" : "episode",
        requestHash,
        authTime: context.authTime,
        createdAt: this.now(),
        updatedAt: this.now(),
        state: "QUEUED",
        stage: "QUEUED",
        target,
        requirements,
        snapshot,
        attempt: 0,
        workerId: null,
        leaseHash: null,
        leaseUntil: 0,
        startedAt: null,
        completedAt: null,
        outputIds: [],
        issue: null,
      };
      tx.set(child(context, "jobs", jobId), job);
      tx.set(requestPath, { jobId, createdBy: context.uid, requestHash });
      if (target.mode === "cloud")
        tx.set(`dispatchOutbox/${jobId}`, {
          id: jobId,
          tenantId: context.tenantId,
          state: "PENDING",
          createdAt: this.now(),
        });
      return this.jobView(job);
    });
  }
  async claim(actor: WorkerActor) {
    if (actor.allowedJobId)
      fail(403, "ATTEMPT_SCOPE", "Cloud credentials cannot claim other jobs.");
    return this.db.transaction(async (tx) => {
      const workerPath = `${root(actor.tenantId)}/workers/${actor.workerId}`;
      const worker = await tx.get<Worker>(workerPath);
      const workspace = await tx.get(root(actor.tenantId));
      const jobs = await tx.list<Job>(`${root(actor.tenantId)}/jobs`);
      if (
        worker?.status !== "active" ||
        workspace?.status !== "active" ||
        worker.busy ||
        worker.activeJobId
      )
        return null;
      if (workerAvailability(worker, this.now()) !== "online") return null;
      if (jobs.filter((job) => job.state === "RUNNING" && job.target.mode !== "cloud").length >= 2)
        return null;
      const eligible = jobs
        .filter(
          (job) =>
            job.state === "QUEUED" &&
            job.target.mode !== "cloud" &&
            (!job.target.workerId || job.target.workerId === worker.id) &&
            matches(worker.capabilities, job.requirements),
        )
        .sort((a, b) => a.createdAt - b.createdAt);
      let selected: Job | undefined;
      for (const job of eligible) {
        const member = await tx.get(`${root(actor.tenantId)}/members/${identifier(job.createdBy)}`);
        if (
          member?.status !== "active" ||
          !["owner", "admin", "editor"].includes(String(member.role))
        )
          continue;
        if (
          !(await this.options.isUserActive(job.createdBy, Number(job.authTime ?? job.createdAt)))
        )
          continue;
        let valid = true;
        for (const saved of job.snapshot.voices as { profile: RecordData }[]) {
          const profile = await tx.get(
            `${root(actor.tenantId)}/voiceProfiles/${identifier(saved.profile.id)}`,
          );
          if (
            profile?.status !== "active" ||
            profile.revision !== saved.profile.revision ||
            !profile.allowMac ||
            (!profile.trustedMacPool && !(profile.trustedWorkerIds as string[]).includes(worker.id))
          )
            valid = false;
        }
        if (valid) {
          selected = job;
          break;
        }
      }
      if (!selected) return null;
      const lease = secret();
      const job = {
        ...selected,
        state: "RUNNING",
        stage: "PREFLIGHT",
        attempt: selected.attempt + 1,
        workerId: worker.id,
        leaseHash: digest(lease),
        leaseUntil: this.now() + leaseMs,
        updatedAt: this.now(),
        startedAt: selected.startedAt ?? this.now(),
        attemptStartedAt: this.now(),
        runtimes: worker.capabilities.filter((cap) =>
          selected.requirements.some((need) => need.engine === cap.engine),
        ),
      };
      tx.set(`${root(actor.tenantId)}/jobs/${job.id}`, job);
      tx.set(workerPath, { ...worker, activeJobId: job.id });
      return { job: this.jobView(job), lease };
    });
  }
  private async attempt(tx: DatabaseReader, actor: WorkerActor, jobId: string, lease: string) {
    if (actor.allowedJobId && actor.allowedJobId !== jobId)
      fail(403, "ATTEMPT_SCOPE", "This credential is restricted to one cloud execution.");
    const [job, worker, workspace] = await Promise.all([
      tx.get<Job>(`${root(actor.tenantId)}/jobs/${identifier(jobId)}`),
      tx.get<Worker>(`${root(actor.tenantId)}/workers/${actor.workerId}`),
      tx.get(root(actor.tenantId)),
    ]);
    if (
      !job ||
      !worker ||
      worker.status === "revoked" ||
      worker.status === "disabled" ||
      workspace?.status !== "active" ||
      job.workerId !== actor.workerId ||
      job.leaseHash !== digest(lease) ||
      job.leaseUntil <= this.now() ||
      job.state !== "RUNNING"
    )
      fail(409, "ATTEMPT_EXPIRED", "Stop rendering: this attempt was cancelled or lost its lease.");
    const member = await tx.get(`${root(actor.tenantId)}/members/${identifier(job.createdBy)}`);
    if (member?.status !== "active" || !["owner", "admin", "editor"].includes(String(member.role)))
      fail(409, "ATTEMPT_EXPIRED", "Workspace access was revoked.");
    if (!(await this.options.isUserActive(job.createdBy, Number(job.authTime ?? job.createdAt))))
      fail(
        409,
        "ACCOUNT_REVOKED",
        "The authorizing account was disabled or signed out by an administrator.",
      );
    for (const saved of job.snapshot.voices as { profile: RecordData }[]) {
      const profile = await tx.get(
        `${root(actor.tenantId)}/voiceProfiles/${identifier(saved.profile.id)}`,
      );
      const allowed =
        job.target.mode === "cloud"
          ? profile?.allowCloud
          : profile?.allowMac &&
            (profile.trustedMacPool ||
              (profile.trustedWorkerIds as string[]).includes(actor.workerId));
      if (
        profile?.status !== "active" ||
        profile.revision !== saved.profile.revision ||
        profile.ownerId !== job.createdBy ||
        !allowed
      )
        fail(409, "VOICE_REVOKED", "This voice was removed or changed.");
    }
    return { job, worker };
  }
  async progress(actor: WorkerActor, jobId: string, lease: string, input: RecordData) {
    return this.db.transaction(async (tx) => {
      const { job, worker } = await this.attempt(tx, actor, jobId, lease);
      const stage = text(input.stage ?? job.stage, "stage", 32);
      if (!/^[A-Z_]+$/u.test(stage)) fail(400, "INVALID_INPUT", "Invalid progress stage.");
      const next = { ...job, stage, updatedAt: this.now(), leaseUntil: this.now() + leaseMs };
      tx.set(`${root(actor.tenantId)}/jobs/${job.id}`, next);
      tx.set(`${root(actor.tenantId)}/workers/${worker.id}`, { ...worker, lastSeenAt: this.now() });
      return this.jobView(next);
    });
  }
  async manifest(actor: WorkerActor, jobId: string, lease: string) {
    const { job } = await this.attempt(this.db, actor, jobId, lease);
    const assets: Asset[] = [];
    for (const assetId of job.snapshot.assetIds as string[]) {
      const asset = await this.db.get<Asset>(
        `${root(actor.tenantId)}/assets/${identifier(assetId)}`,
      );
      if (!asset) fail(409, "ASSET_UNAVAILABLE", "A required asset was removed.");
      assets.push(asset);
    }
    for (const voice of job.snapshot.voices as {
      profile: RecordData;
      approval: RecordData | null;
    }[]) {
      for (const assetId of [voice.profile.sampleAssetId, voice.approval?.assetId].filter(
        Boolean,
      )) {
        const asset = await this.db.get<Asset>(
          `${root(actor.tenantId)}/assets/${identifier(assetId)}`,
        );
        if (!asset) fail(409, "VOICE_UNAVAILABLE", "A required voice asset was removed.");
        assets.push(asset);
      }
    }
    return {
      job: this.jobView(job),
      snapshot: job.snapshot,
      assets: assets.map((asset) => this.safeRecord(asset)),
    };
  }
  async workerAsset(actor: WorkerActor, jobId: string, lease: string, assetId: string) {
    const manifest = await this.manifest(actor, jobId, lease);
    if (!manifest.assets.some((asset) => asset.id === assetId))
      fail(404, "NOT_FOUND", "Asset unavailable for this attempt.");
    const asset = await this.db.get<Asset>(`${root(actor.tenantId)}/assets/${identifier(assetId)}`);
    if (!asset) fail(404, "NOT_FOUND", "Asset unavailable.");
    const bytes = await this.blobs.get(asset.path);
    if (digest(bytes) !== asset.sha256) fail(409, "ASSET_CHANGED", "Input integrity check failed.");
    return { asset, bytes };
  }
  async uploadOutput(
    actor: WorkerActor,
    jobId: string,
    lease: string,
    kind: Asset["kind"],
    bytes: Buffer,
    contentType: string,
  ) {
    const { job } = await this.attempt(this.db, actor, jobId, lease);
    if (!["video", "audio", "captions", "package", "manifest", "audition"].includes(kind))
      fail(400, "INVALID_OUTPUT", "Invalid output type.");
    const assetId = id();
    const path = `${root(actor.tenantId)}/jobs/${job.id}/attempts/${job.attempt}/${assetId}`;
    const asset: Asset = {
      id: assetId,
      tenantId: actor.tenantId,
      ownerId: job.createdBy,
      kind,
      path,
      sha256: digest(bytes),
      size: bytes.length,
      contentType,
      createdAt: this.now(),
      jobId: job.id,
      attempt: job.attempt,
    };
    await this.blobs.put(path, bytes, contentType);
    try {
      await this.db.transaction(async (tx) => {
        await this.attempt(tx, actor, jobId, lease);
        await this.checkStorageQuota(tx, actor.tenantId, bytes.length);
        tx.set(`${root(actor.tenantId)}/assets/${assetId}`, asset);
      });
    } catch (error) {
      await this.blobs.delete(path);
      throw error;
    }
    return this.safeRecord(asset);
  }
  async complete(actor: WorkerActor, jobId: string, lease: string, input: RecordData) {
    const active = await this.attempt(this.db, actor, jobId, lease);
    if (!Array.isArray(input.outputIds) || input.outputIds.length > 10)
      fail(400, "INVALID_OUTPUT", "Invalid output manifest.");
    const candidates = await Promise.all(
      input.outputIds.map(async (key) =>
        this.db.get<Asset>(`${root(actor.tenantId)}/assets/${identifier(key)}`),
      ),
    );
    if (
      candidates.some(
        (asset) => !asset || asset.jobId !== jobId || asset.attempt !== active.job.attempt,
      )
    )
      fail(409, "INVALID_OUTPUT", "Outputs do not belong to this attempt.");
    await verifyOutputs(this.blobs, active.job, candidates as Asset[], object(input.metrics));
    return this.db.transaction(async (tx) => {
      const { job, worker } = await this.attempt(tx, actor, jobId, lease);
      if (!Array.isArray(input.outputIds) || input.outputIds.length > 10)
        fail(400, "INVALID_OUTPUT", "Invalid output manifest.");
      const assets = await Promise.all(
        input.outputIds.map(async (key) =>
          tx.get<Asset>(`${root(actor.tenantId)}/assets/${identifier(key)}`),
        ),
      );
      if (assets.some((asset) => !asset || asset.jobId !== job.id || asset.attempt !== job.attempt))
        fail(409, "INVALID_OUTPUT", "Outputs do not belong to this attempt.");
      const required =
        job.kind === "audition"
          ? ["audition", "manifest"]
          : ["video", "audio", "captions", "manifest", "package"];
      if (required.some((kind) => !assets.some((asset) => asset?.kind === kind)))
        fail(409, "INCOMPLETE_OUTPUT", "Required output files are missing.");
      const metrics = object(input.metrics);
      if (
        typeof metrics.totalMs !== "number" ||
        !Number.isFinite(metrics.totalMs) ||
        metrics.totalMs < 0 ||
        typeof metrics.durationSeconds !== "number" ||
        !Number.isFinite(metrics.durationSeconds) ||
        metrics.durationSeconds <= 0 ||
        metrics.durationSeconds > 180
      )
        fail(400, "INVALID_METRICS", "Invalid generation measurements.");
      const next = {
        ...job,
        state: "SUCCEEDED",
        stage: "READY",
        completedAt: this.now(),
        updatedAt: this.now(),
        outputIds: assets.map((asset) => (asset as Asset).id),
        leaseHash: null,
        leaseUntil: 0,
        metrics,
        elapsedMs: this.now() - job.createdAt,
        queueMs: Number(job.attemptStartedAt) - job.createdAt,
      };
      tx.set(`${root(actor.tenantId)}/jobs/${job.id}`, next);
      tx.set(`${root(actor.tenantId)}/workers/${worker.id}`, { ...worker, activeJobId: null });
      return this.jobView(next);
    });
  }
  async finishFailure(actor: WorkerActor, jobId: string, lease: string, message: string) {
    return this.db.transaction(async (tx) => {
      const { job, worker } = await this.attempt(tx, actor, jobId, lease);
      const next = {
        ...job,
        state: "FAILED",
        issue: text(message, "failure reason", 300),
        updatedAt: this.now(),
        completedAt: this.now(),
        leaseHash: null,
        leaseUntil: 0,
      };
      tx.set(`${root(actor.tenantId)}/jobs/${job.id}`, next);
      tx.set(`${root(actor.tenantId)}/workers/${worker.id}`, { ...worker, activeJobId: null });
      return this.jobView(next);
    });
  }
  async retry(context: Context, jobId: string, input: RecordData, requestId: string) {
    permit(context);
    const job = await this.db.get<Job>(child(context, "jobs", jobId));
    if (!job || !["FAILED", "CANCELLED"].includes(job.state))
      fail(409, "RETRY_UNAVAILABLE", "Retry a failed or cancelled job.");
    const target = input.target ?? job.target;
    if (job.kind === "audition") {
      const voice = (job.snapshot.voices as { profile: RecordData }[])[0];
      return this.submit(
        context,
        { kind: "audition", profileId: voice?.profile.id, target },
        requestId,
      );
    }
    if (!job.snapshot.episodeId)
      fail(409, "RETRY_UNAVAILABLE", "Open the saved script and produce its current version.");
    return this.submit(
      context,
      {
        kind: "episode",
        episodeId: job.snapshot.episodeId,
        revision: job.snapshot.revision,
        target,
      },
      requestId,
    );
  }
  async cancel(context: Context, jobId: string) {
    permit(context);
    return this.db.transaction(async (tx) => {
      const path = child(context, "jobs", jobId);
      const job = await tx.get<Job>(path);
      const worker = job?.workerId
        ? await tx.get<Worker>(child(context, "workers", job.workerId))
        : null;
      if (!job) fail(404, "NOT_FOUND", "Job unavailable.");
      if (terminal(job.state)) return this.jobView(job);
      const next = {
        ...job,
        state: "CANCELLED",
        completedAt: this.now(),
        updatedAt: this.now(),
        leaseHash: null,
        leaseUntil: 0,
      };
      tx.set(path, next);
      // Keep the slot occupied until the process has acknowledged termination or lease reconciliation.
      if (worker)
        tx.set(child(context, "workers", worker.id), { ...worker, cancelRequested: true });
      return this.jobView(next);
    });
  }
  async release(actor: WorkerActor, jobId: string) {
    return this.db.transaction(async (tx) => {
      const path = `${root(actor.tenantId)}/workers/${actor.workerId}`;
      const worker = await tx.get<Worker>(path);
      const job = await tx.get<Job>(`${root(actor.tenantId)}/jobs/${identifier(jobId)}`);
      if (
        worker?.activeJobId === jobId &&
        job &&
        (terminal(job.state) || job.leaseUntil <= this.now())
      )
        tx.set(path, { ...worker, activeJobId: null, busy: false, cancelRequested: false });
      return { released: true };
    });
  }
  async reconcile(context: Context) {
    permit(context);
    return this.db.transaction(async (tx) => {
      const jobs = await tx.list<Job>(child(context, "jobs"));
      const workers = await tx.list<Worker>(child(context, "workers"));
      let count = 0;
      for (const job of jobs) {
        if (job.state !== "RUNNING" || job.leaseUntil > this.now()) continue;
        const worker = workers.find((item) => item.id === job.workerId);
        tx.set(child(context, "jobs", job.id), {
          ...job,
          state: "FAILED",
          stage: "INTERRUPTED",
          issue: "The rendering device lost its lease. Retry when an engine is available.",
          completedAt: this.now(),
          updatedAt: this.now(),
          leaseHash: null,
          leaseUntil: 0,
        });
        if (worker) tx.set(child(context, "workers", worker.id), { ...worker, activeJobId: null });
        count++;
      }
      return { reconciled: count };
    });
  }
  async acceptAudition(context: Context, jobId: string) {
    permit(context);
    return this.db.transaction(async (tx) => {
      const job = await tx.get<Job>(child(context, "jobs", jobId));
      if (
        !job ||
        job.createdBy !== context.uid ||
        job.kind !== "audition" ||
        job.state !== "SUCCEEDED"
      )
        fail(409, "AUDITION_REQUIRED", "Listen to a completed audition before accepting.");
      const saved = (job.snapshot.voices as { profile: RecordData }[])[0];
      if (!saved) fail(409, "AUDITION_REQUIRED", "Voice audition missing.");
      const profile = await tx.get(child(context, "voiceProfiles", String(saved.profile.id)));
      const outputs = await Promise.all(
        job.outputIds.map((assetId) => tx.get<Asset>(child(context, "assets", assetId))),
      );
      const asset = outputs.find((item) => item?.kind === "audition");
      const runtime = (job.runtimes as Capability[]).find((item) =>
        item.engine.startsWith("qwen-"),
      );
      if (
        profile?.status !== "active" ||
        profile.revision !== saved.profile.revision ||
        !asset ||
        !runtime
      )
        fail(409, "AUDITION_CHANGED", "Generate a new audition for this voice.");
      const approval = {
        id: runtime.engine,
        engine: runtime.engine,
        runtimeDigest: runtime.digest,
        revision: profile.revision,
        auditionJobId: job.id,
        assetId: asset.id,
        auditionHash: asset.sha256,
        accepted: true,
        acceptedBy: context.uid,
        acceptedAt: this.now(),
      };
      tx.set(
        `${child(context, "voiceProfiles", String(profile.id))}/approvals/${runtime.engine}`,
        approval,
      );
      tx.set(child(context, "jobs", jobId), {
        ...job,
        voiceAcceptedAt: this.now(),
        updatedAt: this.now(),
      });
      return approval;
    });
  }
  async deleteVoice(context: Context, profileId: string) {
    permit(context);
    const path = child(context, "voiceProfiles", profileId);
    const profile = await this.db.get(path);
    if (!profile || (profile.ownerId !== context.uid && !["owner", "admin"].includes(context.role)))
      fail(404, "NOT_FOUND", "Voice unavailable.");
    await this.db.transaction(async (tx) => {
      const current = await tx.get(path);
      const revisions = await tx.list(`${path}/revisions`);
      const approvals = await tx.list(`${path}/approvals`);
      const jobs = await tx.list<Job>(child(context, "jobs"));
      if (!current) return;
      tx.set(path, {
        id: profileId,
        tenantId: context.tenantId,
        ownerId: current.ownerId,
        name: current.name,
        revision: current.revision,
        status: "deleted",
        deletedAt: this.now(),
      });
      for (const revision of revisions)
        tx.delete(`${path}/revisions/${identifier(revision.revision)}`);
      for (const approval of approvals) tx.delete(`${path}/approvals/${identifier(approval.id)}`);
      for (const job of jobs) {
        const used = job.snapshot.voices as {
          profile: RecordData;
          approval: RecordData | null;
          speakerId: string;
        }[];
        if (!used.some((voice) => voice.profile.id === profileId)) continue;
        const snapshot = {
          ...job.snapshot,
          voices: used.map((voice) =>
            voice.profile.id === profileId
              ? {
                  ...voice,
                  profile: { id: profileId, revision: voice.profile.revision, status: "deleted" },
                  approval: null,
                }
              : voice,
          ),
        };
        tx.set(child(context, "jobs", job.id), {
          ...job,
          snapshot,
          ...(!terminal(job.state)
            ? {
                state: "CANCELLED",
                stage: "VOICE_REMOVED",
                completedAt: this.now(),
                updatedAt: this.now(),
                leaseHash: null,
                leaseUntil: 0,
              }
            : {}),
        });
      }
    });
    const assets = await this.db.list<Asset>(child(context, "assets"));
    const auditions = await this.db.list<Job>(child(context, "jobs"));
    const auditionIds = new Set(
      auditions
        .filter(
          (job) =>
            job.kind === "audition" &&
            (job.snapshot.voices as { profile: RecordData }[]).some(
              (voice) => voice.profile.id === profileId,
            ),
        )
        .map((job) => job.id),
    );
    for (const asset of assets) {
      if (asset.id !== profile.sampleAssetId && !(asset.jobId && auditionIds.has(asset.jobId)))
        continue;
      await this.blobs.delete(asset.path);
      await this.db.transaction(async (tx) => {
        tx.delete(child(context, "assets", asset.id));
      });
    }
    return { deleted: true };
  }
}
