import { ExecutionsClient, JobsClient } from "@google-cloud/run";
import {
  digest,
  fail,
  id,
  type Job,
  type RecordData,
  secret,
  terminal,
  type Worker,
} from "./contracts.js";
import type { WorkspaceService } from "./service.js";

export interface CloudProviderConfig {
  jobName: string;
  runtimeDigest: string;
  budgetCents: number;
  attemptCents: number;
}
export interface CloudLauncher {
  launch(environment: Record<string, string>): Promise<string>;
  completed(operation: string): Promise<boolean>;
}
export class RunJobsLauncher implements CloudLauncher {
  private readonly client = new JobsClient();
  private readonly executions = new ExecutionsClient();
  constructor(private readonly name: string) {}
  async launch(environment: Record<string, string>) {
    const [operation] = await this.client.runJob(
      {
        name: this.name,
        overrides: {
          taskCount: 1,
          timeout: { seconds: 900 },
          containerOverrides: [
            { env: Object.entries(environment).map(([name, value]) => ({ name, value })) },
          ],
        },
      },
      { retry: null, timeout: 30_000 },
    );
    if (!operation.name) throw new Error("Cloud execution did not return an operation identity.");
    return operation.name;
  }
  async completed(operation: string) {
    const status = await this.client.checkRunJobProgress(operation);
    const metadata = status.metadata as { name?: string } | null;
    const result = status.result as { name?: string } | null;
    const name = result?.name ?? metadata?.name;
    if (name) {
      const [execution] = await this.executions.getExecution({ name });
      return Boolean(execution.completionTime);
    }
    return status.done === true && Boolean(status.error);
  }
}
/** One bounded dispatch/reconciliation pass. A durable permit spans all executions. */
export async function dispatchCloud(
  service: WorkspaceService,
  config: CloudProviderConfig,
  origin: string,
  launcher: CloudLauncher,
) {
  if (!service.options.cloudEnabled || !service.options.cloudBudgetCents)
    fail(409, "CLOUD_DISABLED", "Cloud execution is disabled.");
  const ledger = await service.db.get("platformUsage/cloud");
  if (ledger?.activeJobId) {
    const outbox = await service.db.get(`dispatchOutbox/${ledger.activeJobId}`);
    if (!outbox?.operation) return { status: "RECONCILIATION_REQUIRED", jobId: ledger.activeJobId };
    if (!(await launcher.completed(String(outbox.operation)))) return { status: "BUSY" };
    await service.db.transaction(async (tx) => {
      const current = await tx.get("platformUsage/cloud");
      const job = await tx.get<Job>(`tenants/${ledger.tenantId}/jobs/${ledger.activeJobId}`);
      if (!current || current.activeJobId !== ledger.activeJobId) return;
      tx.set("platformUsage/cloud", {
        activeJobId: null,
        tenantId: null,
        reservedCents: 0,
        allocatedCents: Number(current.allocatedCents ?? 0) + Number(current.reservedCents ?? 0),
      });
      if (job && !terminal(job.state))
        tx.set(`tenants/${job.tenantId}/jobs/${job.id}`, {
          ...job,
          state: "FAILED",
          stage: "CLOUD_EXECUTION_ENDED",
          leaseHash: null,
          leaseUntil: 0,
          completedAt: service.now(),
          updatedAt: service.now(),
          issue: "The cloud execution ended without a verified result.",
        });
      tx.set(`dispatchOutbox/${String(ledger.activeJobId)}`, { ...outbox, state: "DONE" });
    });
  }
  const launch = await service.db.transaction(async (tx) => {
    const ledger = await tx.get("platformUsage/cloud");
    const outboxes = await tx.list("dispatchOutbox");
    if (ledger?.activeJobId) return null;
    const pending = outboxes
      .filter((entry) => entry.state === "PENDING")
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))[0];
    if (!pending) return null;
    const tenantId = String(pending.tenantId),
      jobId = String(pending.id);
    const prefix = `tenants/${tenantId}`;
    const job = await tx.get<Job>(`${prefix}/jobs/${jobId}`);
    const member = job ? await tx.get(`${prefix}/members/${job.createdBy}`) : null;
    const workspace = await tx.get(prefix);
    let permitted = Boolean(
      job &&
        job.state === "QUEUED" &&
        job.target.mode === "cloud" &&
        member?.status === "active" &&
        ["owner", "admin", "editor"].includes(String(member.role)) &&
        workspace?.status === "active",
    );
    if (
      job &&
      !(await service.options.isUserActive(job.createdBy, Number(job.authTime ?? job.createdAt)))
    )
      permitted = false;
    for (const entry of (job?.snapshot.voices ?? []) as {
      profile: RecordData;
      approval: RecordData | null;
    }[]) {
      const current = await tx.get(`${prefix}/voiceProfiles/${entry.profile.id}`);
      if (
        current?.status !== "active" ||
        current.revision !== entry.profile.revision ||
        !current.allowCloud ||
        current.ownerId !== job?.createdBy ||
        (job?.kind !== "audition" && entry.approval?.runtimeDigest !== config.runtimeDigest)
      )
        permitted = false;
    }
    if (!job || !permitted) {
      tx.set(`dispatchOutbox/${jobId}`, { ...pending, state: "BLOCKED" });
      if (job)
        tx.set(`${prefix}/jobs/${jobId}`, {
          ...job,
          state: "FAILED",
          issue: "Cloud inputs or voice permissions changed. Review and submit again.",
          updatedAt: service.now(),
        });
      return null;
    }
    const allocated = Number(ledger?.allocatedCents ?? 0);
    if (allocated + config.attemptCents > config.budgetCents) {
      tx.set(`dispatchOutbox/${jobId}`, { ...pending, state: "BUDGET_BLOCKED" });
      tx.set(`${prefix}/jobs/${jobId}`, {
        ...job,
        state: "FAILED",
        issue: "The approved cloud compute allocation is exhausted.",
        updatedAt: service.now(),
      });
      return null;
    }
    const workerId = id(),
      credentialId = id(),
      credential = `${credentialId}.${secret()}`,
      lease = secret();
    const capabilities = [
      { engine: "qwen-cuda", digest: config.runtimeDigest },
      { engine: "video-compose", digest: config.runtimeDigest },
    ];
    const worker: Worker = {
      id: workerId,
      tenantId,
      name: "Google Cloud GPU",
      providerId: "cloud-run",
      registeredBy: "platform",
      status: "active",
      lastSeenAt: service.now(),
      capabilities,
      busy: true,
      activeJobId: jobId,
      platform: "linux",
      architecture: "x64",
    };
    tx.set(`${prefix}/workers/${workerId}`, worker);
    tx.set(`workerCredentials/${credentialId}`, {
      tenantId,
      workerId,
      allowedJobId: jobId,
      hash: digest(credential),
      expiresAt: service.now() + 3600_000,
      revoked: false,
    });
    tx.set(`${prefix}/jobs/${jobId}`, {
      ...job,
      state: "RUNNING",
      stage: "DISPATCHING",
      attempt: job.attempt + 1,
      workerId,
      leaseHash: digest(lease),
      leaseUntil: service.now() + 600_000,
      startedAt: service.now(),
      attemptStartedAt: service.now(),
      updatedAt: service.now(),
      runtimes: capabilities,
    });
    tx.set("platformUsage/cloud", {
      activeJobId: jobId,
      tenantId,
      allocatedCents: allocated,
      reservedCents: config.attemptCents,
    });
    tx.set(`dispatchOutbox/${jobId}`, { ...pending, state: "LAUNCHING", launchAt: service.now() });
    return {
      jobId,
      environment: {
        SHORTS_CLOUD_ORIGIN: origin,
        SHORTS_CLOUD_CREDENTIAL: credential,
        SHORTS_CLOUD_JOB_ID: jobId,
        SHORTS_CLOUD_LEASE: lease,
        SHORTS_CLOUD_RUNTIME_DIGEST: config.runtimeDigest,
      },
    };
  });
  if (!launch) return { status: "IDLE" };
  // An ambiguous invocation retains the permit; it is never blindly resubmitted.
  const operation = await launcher.launch(launch.environment);
  await service.db.transaction(async (tx) => {
    const outbox = await tx.get(`dispatchOutbox/${launch.jobId}`);
    if (outbox)
      tx.set(`dispatchOutbox/${launch.jobId}`, { ...outbox, operation, state: "STARTED" });
  });
  return { status: "STARTED", jobId: launch.jobId };
}
