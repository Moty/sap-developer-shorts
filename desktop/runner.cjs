const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const { workerInput } = require("./core.cjs");
const { preparePhonemes } = require("./phonemes.cjs");
const phonemeAliases = [];
async function phonemes() {
  const prepared = await preparePhonemes(root, process.env.SHORTS_DESKTOP_DATA_ROOT);
  if (prepared) {
    phonemeAliases.push(prepared);
    process.env.ESPEAK_DATA_PATH = prepared.dataPath;
  }
}
const exec = promisify(execFile);
const root = process.env.SHORTS_WORKSPACE_ROOT;
const load = (name) => import(pathToFileURL(resolve(root, "dist/src", name)).href);
const servers = [],
  children = new Set();
const state = {
  ready: false,
  studioUrl: null,
  task: null,
  error: null,
  logs: [],
  engines: {},
  busy: false,
  worker: "stopped",
  workspace: root,
};
const publish = () => process.send?.({ type: "state", state });
function log(value) {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");
  for (const text of String(value).replace(ansi, "").split(/\r?\n/u)) {
    const line = text.trim().slice(0, 1600);
    if (!line) continue;
    process.stdout.write(`${line}\n`);
    state.logs.push(line);
  }
  state.logs = state.logs.slice(-100);
  publish();
}
function run(binary, args, { worker = false } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    children.add(child);
    if (worker) workerProcess = child;
    child.stdout.on("data", (data) => log(data.toString()));
    child.stderr.on("data", (data) => {
      diagnostics = (diagnostics + data.toString()).slice(-2400);
      log(data.toString());
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      children.delete(child);
      if (worker) {
        workerProcess = null;
        state.worker = "stopped";
        publish();
      }
      if (code === 0) done();
      else
        reject(
          new Error(
            `Operation ${signal ? `interrupted (${signal})` : `failed (exit ${code})`}. ${diagnostics.trim().slice(-1400) || "See the setup log below."}`,
          ),
        );
    });
  });
}
async function engines() {
  const [stock, qwen, portrait] = await Promise.all([
    load("media/neural.js")
      .then((m) => m.neuralRuntime())
      .then(() => true)
      .catch(() => false),
    load("media/qwen.js")
      .then((m) => m.qwenRuntime())
      .then(() => true)
      .catch(() => false),
    load("media/talking-head.js")
      .then((m) => m.talkingHeadRuntime())
      .then((r) => r.installed)
      .catch(() => false),
  ]);
  let face = false;
  try {
    await (await load("media/face-assets.js")).faceAsset("face_landmarker.task");
    face = true;
  } catch {
    /* optional */
  }
  state.engines = { kokoro: stock, qwen, portrait, face };
}
async function studio() {
  const built = await (await load("library.js")).buildLibrary();
  const server = await (await load("serve.js")).startPreviewServer(built.directory, 0, "127.0.0.1");
  servers.push(server.server);
  state.studioUrl = server.url;
}
async function busy() {
  for (const server of servers) {
    const port = server.address()?.port;
    if (!port) continue;
    const origin = `http://127.0.0.1:${port}`;
    const job = await (await fetch(`${origin}/api/status`)).json();
    if (job.writingJob?.local) return true;
    if (job.activeJob && !["READY", "FAILED", "BLOCKED"].includes(job.activeJob.stage)) return true;
    const session = await fetch(`${origin}/api/local-voices/session`);
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    const action = await (
      await fetch(`${origin}/api/local-actions`, { headers: { cookie } })
    ).json();
    if (action.job && action.job.state === "RUNNING") return true;
  }
  return false;
}
async function python() {
  log("Preparing managed Python 3.12. No system Python or Homebrew is used.");
  await run("uv", ["python", "install", "3.12"]);
  const { stdout } = await exec("uv", ["python", "find", "3.12"], { cwd: root });
  const path = stdout.trim();
  if (!path.startsWith(`${resolve(process.env.UV_PYTHON_INSTALL_DIR)}/`))
    throw new Error("Managed Python resolved outside the app's data folder");
  await fs.mkdir(resolve(root, ".desktop-bin"), { recursive: true, mode: 0o700 });
  const target = resolve(root, ".desktop-bin/python3");
  try {
    await fs.symlink(path, target);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await fs.lstat(target)).isSymbolicLink())
      throw new Error("The managed Python shortcut is occupied");
    await fs.unlink(target);
    await fs.symlink(path, target);
  }
}
let workerProcess = null;
let pausingWorker = false;
async function action(input) {
  if (!state.ready) throw new Error("Wait for the desktop workspace to finish preparing.");
  if (input?.action === "worker-stop") {
    pausingWorker = true;
    workerProcess?.kill("SIGTERM");
    return;
  }
  if (input?.action === "refresh") {
    if (!state.task) {
      await engines();
      state.busy = await busy();
    }
    return;
  }
  const occupied = await busy();
  if (state.task || workerProcess || occupied)
    throw new Error("Finish the current render or pause the worker before changing engines.");
  const kind = input?.action;
  if (
    !["kokoro", "qwen", "portrait", "face", "test", "worker-register", "worker-start"].includes(
      kind,
    )
  )
    throw new Error("Unknown desktop action");
  const pairing = kind === "worker-register" ? workerInput(input) : null;
  if (kind === "test" && !state.engines.kokoro)
    throw new Error("Install stock narration before running the test video.");
  state.task = { action: kind, startedAt: new Date().toISOString() };
  state.error = null;
  publish();
  void (async () => {
    try {
      if (["kokoro", "qwen", "portrait"].includes(kind)) await python();
      if (pairing)
        await run(process.execPath, [
          resolve(root, "dist/src/worker/cli.js"),
          "register",
          pairing.origin,
          pairing.name,
        ]);
      else if (kind === "worker-start") {
        state.worker = "running";
        state.task = null;
        publish();
        await run(process.execPath, [resolve(root, "dist/src/worker/cli.js"), "start"], {
          worker: true,
        });
        return;
      } else await run(process.execPath, [resolve(root, "desktop-runtime/engine.cjs"), kind]);
      if (!pairing) {
        await phonemes();
        if (kind === "kokoro")
          await run(resolve(root, ".state/neural-voice/venv/bin/python"), [
            "-c",
            "from misaki.espeak import EspeakFallback; assert EspeakFallback(False).backend.phonemize(['CAP API']); print('Portable phoneme data verified.')",
          ]);
        log("Refreshing your local studio…");
        await studio();
      }
      await engines();
      log(
        pairing
          ? "Device paired. Start the worker when you are ready."
          : "Ready. Open the studio to continue.",
      );
    } catch (error) {
      if (kind === "worker-start" && pausingWorker) log("Worker paused.");
      else {
        state.error = error.message;
        log(error.message);
      }
    } finally {
      pausingWorker = false;
      state.task = null;
      publish();
    }
  })();
}
process.on("message", async (request) => {
  if (request?.type !== "action") return;
  try {
    await action(request.input);
    process.send?.({ type: "reply", id: request.id, ok: true });
  } catch (error) {
    process.send?.({ type: "reply", id: request.id, ok: false, error: error.message });
  }
  publish();
});
(async () => {
  log("Checking bundled tools and preparing your workspace…");
  for (const [binary, args] of [
    [process.execPath, ["--version"]],
    ["ffmpeg", ["-version"]],
    ["ffprobe", ["-version"]],
    ["uv", ["--version"]],
  ]) {
    const { stdout } = await exec(binary, args, { cwd: root, timeout: 10000 });
    log(stdout.split("\n")[0]);
  }
  state.tools = { node: process.execPath };
  for (const binary of ["ffmpeg", "ffprobe", "uv"])
    state.tools[binary] = (await exec("/usr/bin/which", [binary])).stdout.trim();
  await phonemes();
  await studio();
  await engines();
  state.ready = true;
  publish();
  const timer = setInterval(async () => {
    try {
      const next = await busy();
      if (next !== state.busy) {
        state.busy = next;
        publish();
      }
    } catch {
      /* retain last known status */
    }
  }, 3000);
  timer.unref();
})().catch((error) => {
  state.error = error.message;
  log(error.stack);
  publish();
});
process.on("SIGTERM", () => {
  for (const child of children) child.kill("SIGTERM");
  for (const alias of phonemeAliases) void alias.cleanup();
  for (const server of servers) server.close();
  setTimeout(() => process.exit(0), 250).unref();
});
