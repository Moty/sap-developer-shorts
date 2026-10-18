import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type Capability, digest, type Job, matches, type RecordData } from "../cloud/contracts.js";
import { inside, repositoryRoot } from "../paths.js";
import { detectCapabilities, modelBusy } from "./capabilities.js";
import type { WorkerClient } from "./client.js";
import { stageInputs, stageRuntime } from "./workspace.js";

export async function executeAssignment(
  client: WorkerClient,
  assignment: { job: Job; lease: string },
  capabilities: Capability[],
  signal: AbortSignal,
) {
  const { job, lease } = assignment;
  const home = resolve(homedir(), "Library/Application Support/SAP Shorts/worker/attempts");
  await mkdir(home, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(resolve(home, `${job.id}-`));
  const abort = new AbortController();
  let stage = "INPUT_TRANSFER";
  let renewalFailed: Error | null = null;
  const parentAbort = () => abort.abort();
  signal.addEventListener("abort", parentAbort, { once: true });
  const maintain = (async () => {
    while (!abort.signal.aborted) {
      try {
        await client.request(`/v1/worker/jobs/${job.id}/progress`, { stage }, lease);
        await delay(20_000, undefined, { signal: abort.signal });
      } catch (error) {
        if (!abort.signal.aborted) {
          renewalFailed = error as Error;
          abort.abort();
        }
      }
    }
  })();
  try {
    if (!matches(capabilities, job.requirements))
      throw new Error("The selected rendering runtime is no longer installed.");
    const manifest = await client.request(`/v1/worker/jobs/${job.id}/manifest`, undefined, lease);
    const voices = (manifest.snapshot as RecordData).voices as { approval: RecordData | null }[];
    for (const voice of voices)
      if (
        voice.approval &&
        !capabilities.some(
          (runtime) =>
            runtime.engine === voice.approval?.engine &&
            runtime.digest === voice.approval.runtimeDigest,
        )
      )
        throw new Error("Audition and accept this voice with the installed runtime first.");
    const inputs = new Map<string, Buffer>();
    for (const asset of manifest.assets as RecordData[]) {
      const bytes = await client.download(job.id, String(asset.id), lease);
      if (digest(bytes) !== asset.sha256) throw new Error("Input checksum verification failed.");
      inputs.set(String(asset.id), bytes);
    }
    abort.signal.throwIfAborted();
    await stageRuntime(directory);
    await stageInputs(directory, manifest, inputs);
    stage = "PREFLIGHT";
    await new Promise<void>((done, reject) => {
      const child = spawn(
        process.execPath,
        import.meta.url.endsWith(".js")
          ? [resolve(directory, "dist/src/worker/child.js")]
          : ["--import", "tsx", resolve(directory, "src/worker/child.ts")],
        {
          cwd: directory,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            SHORTS_WORKSPACE_ROOT: directory,
            SHORTS_MODEL_STATE_ROOT: resolve(repositoryRoot, ".state"),
          },
        },
      );
      let stderr = "",
        pending = "";
      let timingIssue: string | null = null;
      const kill = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {}
      };
      abort.signal.addEventListener("abort", kill, { once: true });
      if (abort.signal.aborted) kill();
      child.stdout.on("data", (data: Buffer) => {
        pending += data.toString();
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            if (typeof item.stage === "string" && /^[A-Z_]+$/u.test(item.stage)) stage = item.stage;
            if (
              item.blocked === "TIMING_REVIEW_REQUIRED" &&
              Number.isFinite(item.durationSeconds) &&
              Number.isFinite(item.hookSeconds)
            )
              timingIssue = `Narration measured ${Number(item.durationSeconds).toFixed(1)}s; opening ${Number(item.hookSeconds).toFixed(1)}s. Aim for 45–60s total and at most 3s for the opening. Revise the spoken script, save, and produce again.`;
          } catch {}
        }
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-50_000);
      });
      child.on("error", reject);
      child.on("close", async (code) => {
        abort.signal.removeEventListener("abort", kill);
        if (code === 0 && !abort.signal.aborted) done();
        else {
          const diagnosticRoot = resolve(repositoryRoot, ".state/registered-worker");
          await mkdir(diagnosticRoot, { recursive: true, mode: 0o700 });
          let redacted = stderr
            .replaceAll(lease, "[lease]")
            .replaceAll(client.credential, "[credential]");
          for (const voice of voices) {
            const transcript = String(
              (voice as unknown as { profile: RecordData }).profile?.transcript ?? "",
            );
            if (transcript) redacted = redacted.replaceAll(transcript, "[reference transcript]");
          }
          await writeFile(resolve(diagnosticRoot, "last-error.log"), redacted, { mode: 0o600 });
          reject(
            new Error(
              abort.signal.aborted
                ? "Rendering stopped because its lease or device access was lost."
                : (timingIssue ??
                    "Rendering failed. Check this device's installed models and try a short audition."),
            ),
          );
        }
      });
    });
    abort.signal.throwIfAborted();
    stage = "OUTPUT_TRANSFER";
    const result = JSON.parse(await readFile(resolve(directory, "worker-result.json"), "utf8")) as {
      files: { kind: string; path: string }[];
      metrics: RecordData;
    };
    const outputIds: string[] = [];
    for (const file of result.files) {
      abort.signal.throwIfAborted();
      const bytes = await readFile(inside(directory, file.path));
      const asset = await client.upload(job.id, lease, file.kind, bytes);
      outputIds.push(String(asset.id));
    }
    stage = "VERIFY";
    await client.request(
      `/v1/worker/jobs/${job.id}/complete`,
      { outputIds, metrics: result.metrics },
      lease,
    );
    console.log(`Completed ${job.kind} ${job.id}.`);
  } catch (error) {
    try {
      await client.request(
        `/v1/worker/jobs/${job.id}/fail`,
        { message: error instanceof Error ? error.message.slice(0, 300) : "Rendering failed." },
        lease,
      );
    } catch {}
    throw renewalFailed ?? error;
  } finally {
    abort.abort();
    await maintain;
    signal.removeEventListener("abort", parentAbort);
    await client.request(`/v1/worker/jobs/${job.id}/release`, {}, lease).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
export async function runMacWorker(client: WorkerClient, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const capabilities = await detectCapabilities();
      await client.request("/v1/worker/heartbeat", { capabilities, busy: await modelBusy() });
      const assignment = await client.request("/v1/worker/claim", {});
      if (assignment) {
        console.log(`Rendering ${String((assignment.job as Job).kind)} on this Mac.`);
        await executeAssignment(
          client,
          assignment as unknown as { job: Job; lease: string },
          capabilities,
          signal,
        );
      }
    } catch (error) {
      console.error((error as Error).message);
    }
    await delay(10_000, undefined, { signal }).catch(() => {});
  }
}
