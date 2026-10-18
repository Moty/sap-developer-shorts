import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Capability, digest, type Job, matches } from "../cloud/contracts.js";
import { repositoryRoot } from "../paths.js";
import { WorkerClient } from "./client.js";
import { executeAssignment } from "./runner.js";

const origin = process.env.SHORTS_CLOUD_ORIGIN;
const credential = process.env.SHORTS_CLOUD_CREDENTIAL;
const jobId = process.env.SHORTS_CLOUD_JOB_ID;
const lease = process.env.SHORTS_CLOUD_LEASE;
if (!origin || !credential || !jobId || !lease) throw new Error("Missing cloud attempt binding.");
const runtimeBytes = await readFile(
  resolve(repositoryRoot, ".state/qwen-voice/runtime.json"),
  "utf8",
);
const runtime = JSON.parse(runtimeBytes);
const runtimeDigest = (
  await readFile(resolve(repositoryRoot, ".state/qwen-voice/compatibility.txt"), "utf8")
).trim();
if (
  digest(runtimeBytes.trimEnd()) !== runtimeDigest ||
  runtimeDigest !== process.env.SHORTS_CLOUD_RUNTIME_DIGEST ||
  runtime.engine !== "qwen-cuda"
)
  throw new Error("The cloud image does not match its approved provider runtime.");
const capabilities: Capability[] = [
  { engine: "qwen-cuda", digest: runtimeDigest },
  { engine: "video-compose", digest: runtimeDigest },
];
const client = new WorkerClient(origin, credential);
const manifest = await client.request(`/v1/worker/jobs/${jobId}/manifest`, undefined, lease);
const job = manifest.job as Job;
if (!matches(capabilities, job.requirements) || job.target.mode !== "cloud")
  throw new Error("This image cannot render the assigned job.");
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
process.env.SHORTS_QWEN_BACKEND = "cuda";
await executeAssignment(client, { job, lease }, capabilities, controller.signal);
