import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { hash } from "../src/digest.js";
import { projectRoot } from "../src/paths.js";

const exec = promisify(execFile);

test("worker export verifies installed portrait models outside its private workspace and rejects changes", async (t) => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "sap-worker-render-sources-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = resolve(root, "job");
  const modelState = resolve(root, "installed-models");
  const runtimeRoot = resolve(modelState, "portrait-runtime");
  await mkdir(resolve(workspace, "config"), { recursive: true });
  await cp(resolve(projectRoot, "schemas"), resolve(workspace, "schemas"), { recursive: true });
  await mkdir(resolve(runtimeRoot, "venv/bin"), { recursive: true });
  await mkdir(resolve(runtimeRoot, "source"));
  const spec = await readFile(resolve(projectRoot, "config/portrait-runtime.json"));
  await writeFile(resolve(workspace, "config/portrait-runtime.json"), spec);
  await writeFile(resolve(workspace, "renderer.txt"), "verified renderer");
  await writeFile(resolve(runtimeRoot, "venv/bin/python"), "fixture; not executed");
  const engine = resolve(runtimeRoot, "source/engine.py");
  await writeFile(engine, "verified engine");
  const runtime = JSON.stringify({
    schemaVersion: 2,
    engine: "ditto",
    accelerator: "cpu",
    specSha256: hash(spec),
    sourceHashes: { "engine.py": hash("verified engine") },
  });
  const runtimeFile = resolve(runtimeRoot, "runtime.json");
  await writeFile(runtimeFile, runtime);
  const manifest = {
    "renderer.txt": hash("verified renderer"),
    ".state/portrait-runtime/runtime.json": hash(runtime),
  };
  const verify = () =>
    exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { verifyRenderSources } from ${JSON.stringify(new URL("../src/video/export.js", import.meta.url).href.replace(/\.js$/u, import.meta.url.endsWith(".ts") ? ".ts" : ".js"))}; await verifyRenderSources(${JSON.stringify(manifest)});`,
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          SHORTS_WORKSPACE_ROOT: workspace,
          SHORTS_MODEL_STATE_ROOT: modelState,
        },
        timeout: 20_000,
      },
    );

  // No model runtime exists inside the job. This is the registered worker layout.
  await verify();
  await writeFile(runtimeFile, `${runtime}\n`);
  await assert.rejects(verify, /Renderer input changed: .state\/portrait-runtime\/runtime.json/u);
  await writeFile(runtimeFile, runtime);
  await writeFile(engine, "changed engine");
  await assert.rejects(verify, /Renderer input changed/u);
  await writeFile(engine, "verified engine");
  await writeFile(resolve(workspace, "renderer.txt"), "changed renderer");
  await assert.rejects(verify, /Renderer input changed: renderer.txt/u);
  await writeFile(resolve(workspace, "renderer.txt"), "verified renderer");
  await rm(runtimeFile);
  await assert.rejects(verify, /Renderer input changed/u);
});
