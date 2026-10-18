import type { Target } from "../../cloud/contracts.js";

interface Approval {
  engine: string;
  runtimeDigest: string;
  revision: string;
  auditionJobId: string;
  acceptedAt?: number;
}
interface Voice {
  id: string;
  revision: string;
  status: string;
  allowMac: boolean;
  allowCloud: boolean;
  trustedMacPool: boolean;
  trustedWorkerIds: string[];
  acceptedAuditions?: Approval[];
}
interface Device {
  id: string;
  status: string;
  archivedAt?: number;
  capabilities: { engine: string; digest: string }[];
}
interface Audition {
  id: string;
  kind: string;
  voiceProfileId?: string;
  voiceRevision?: string;
  createdAt: number;
  state: string;
  requirements: { engine: string; digest: string }[];
  runtimes?: { engine: string; digest: string }[];
}
export function voiceReadiness(
  voice: Voice,
  target: Target,
  workers: Device[],
  cloudDigest?: string,
) {
  const engine = target.mode === "cloud" ? "qwen-cuda" : "qwen-mlx";
  if (voice.status !== "active") return { ready: false, message: "Voice unavailable", engine };
  if (target.mode === "cloud" ? !voice.allowCloud : !voice.allowMac)
    return { ready: false, message: "Voice is not permitted on this destination", engine };
  const devices = workers.filter(
    (worker) =>
      !["revoked", "disabled"].includes(worker.status) &&
      !worker.archivedAt &&
      (target.mode !== "device" || target.workerId === worker.id) &&
      (voice.trustedMacPool || voice.trustedWorkerIds.includes(worker.id)),
  );
  if (target.mode === "device" && !devices.length)
    return { ready: false, message: "Choose a Mac trusted for this voice", engine };
  const approvals = (voice.acceptedAuditions ?? []).filter(
    (approval) => approval.engine === engine && approval.revision === voice.revision,
  );
  const approval = approvals.find((approval) =>
    target.mode === "cloud"
      ? approval.runtimeDigest === cloudDigest
      : devices.some((worker) =>
          worker.capabilities.some(
            (cap) => cap.engine === engine && cap.digest === approval.runtimeDigest,
          ),
        ),
  );
  return {
    ready: !!approval,
    message: approval
      ? "Ready to produce"
      : approvals.length
        ? "New engine audition needed"
        : "Audition approval needed",
    engine,
    ...(approval ? { approval } : {}),
  };
}
export function voiceAudition<T extends Audition>(
  voice: Voice,
  jobs: T[],
  target: Target,
  workers: Device[],
  cloudDigest?: string,
): T | undefined {
  const { engine } = voiceReadiness(voice, target, workers, cloudDigest);
  const compatible = (job: T) => {
    if (job.state !== "SUCCEEDED") return true;
    const runtime = job.runtimes?.find((cap) => cap.engine === engine);
    return (
      !!runtime &&
      (target.mode === "cloud"
        ? runtime.digest === cloudDigest
        : workers.some(
            (worker) =>
              !["revoked", "disabled"].includes(worker.status) &&
              !worker.archivedAt &&
              (target.mode !== "device" || worker.id === target.workerId) &&
              (voice.trustedMacPool || voice.trustedWorkerIds.includes(worker.id)) &&
              worker.capabilities.some(
                (cap) => cap.engine === engine && cap.digest === runtime.digest,
              ),
          ))
    );
  };
  const matching = jobs
    .filter(
      (job) =>
        job.kind === "audition" &&
        job.voiceProfileId === voice.id &&
        job.voiceRevision === voice.revision &&
        job.requirements.some((cap) => cap.engine === engine),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    matching.find(
      (job) =>
        (job.state === "SUCCEEDED" && compatible(job)) ||
        !["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state),
    ) ?? matching.find((job) => ["FAILED", "CANCELLED"].includes(job.state))
  );
}
