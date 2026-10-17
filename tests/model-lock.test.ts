import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

test("the model gate excludes another process and recovers when its owner is killed", async () => {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), "shorts-model-gate-")));
  const module = new URL("../src/media/model-lock.ts", import.meta.url).href;
  function worker(hold: boolean) {
    const code = `import { withModelLock } from ${JSON.stringify(module)}; try { await withModelLock(async () => { console.log('entered'); ${hold ? "await new Promise(resolve => setTimeout(resolve,30000));" : ""} }, ${JSON.stringify(directory)}); } catch(error) { console.error(error.message); process.exitCode=2; }`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
      child.on("close", (code) => resolve({ code, stdout, stderr })),
    );
    return {
      child,
      closed,
      entered: new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Model gate worker did not start")), 10000);
        child.once("close", () => {
          clearTimeout(timer);
          if (!stdout.includes("entered"))
            reject(new Error(stderr || "Worker exited before acquiring gate"));
        });
        child.stdout.on("data", () => {
          if (stdout.includes("entered")) {
            clearTimeout(timer);
            resolve();
          }
        });
      }),
    };
  }
  const owner = worker(true);
  try {
    await owner.entered;
    const contender = worker(false);
    contender.entered.catch(() => {});
    const denied = await contender.closed;
    assert.equal(denied.code, 2);
    assert.match(denied.stderr, /busy/);
    assert.equal(denied.stdout, "");
    owner.child.kill("SIGKILL");
    await owner.closed;
    const recovered = worker(false);
    await recovered.entered;
    assert.equal((await recovered.closed).code, 0);
  } finally {
    owner.child.kill("SIGKILL");
    await owner.closed;
    await rm(directory, { recursive: true, force: true });
  }
});
