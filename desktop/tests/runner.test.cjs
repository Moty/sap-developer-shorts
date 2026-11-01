const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, resolve, delimiter } = require("node:path");
const test = require("node:test");

test("a content startup failure retains engine status and can retry after repair", {
  timeout: 15000,
}, async (t) => {
  const root = await fs.mkdtemp(resolve(tmpdir(), "sap-runner-recovery-"));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGTERM");
      await closed;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  async function file(name, text, mode) {
    const path = resolve(root, name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, text, { mode });
  }
  await file("package.json", '{"type":"module"}');
  await file("blocked", "saved content mismatch");
  await file(
    "dist/src/library.js",
    `import { access, appendFile } from 'node:fs/promises';
     export async function buildLibrary() {
       await appendFile(${JSON.stringify(resolve(root, "builds"))}, 'build\\n');
       if (await access(${JSON.stringify(resolve(root, "blocked"))}).then(() => true, () => false))
         throw new Error('News episode NEWS-10 needs a draft-ready news backlog entry');
       return { directory: ${JSON.stringify(root)} };
     }`,
  );
  await file(
    "dist/src/serve.js",
    `import { createServer } from 'node:http';
     export async function startPreviewServer(_directory, port, host) {
       const server = createServer((_request, response) => response.end('{}'));
       await new Promise(resolve => server.listen(port, host, resolve));
       return { server, url: 'http://127.0.0.1:' + server.address().port };
     }`,
  );
  await file("dist/src/media/neural.js", "export async function neuralRuntime() { return {}; }");
  await file("dist/src/media/qwen.js", "export async function qwenRuntime() { return {}; }");
  await file(
    "dist/src/media/talking-head.js",
    "export async function talkingHeadRuntime() { return { installed: false }; }",
  );
  await file(
    "dist/src/media/face-assets.js",
    "export async function faceAsset() { throw new Error('not installed'); }",
  );
  for (const binary of ["ffmpeg", "ffprobe", "uv"])
    await file(`bin/${binary}`, "#!/bin/sh\necho 'fixture tool'\n", 0o755);
  const states = [];
  const waiters = new Set();
  child = fork(resolve(__dirname, "../runner.cjs"), [], {
    env: {
      ...process.env,
      SHORTS_WORKSPACE_ROOT: root,
      SHORTS_DESKTOP_DATA_ROOT: root,
      PATH: `${resolve(root, "bin")}${delimiter}/usr/bin${delimiter}/bin`,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.resume();
  child.stderr.resume();
  child.on("message", (message) => {
    if (message.type !== "state") return;
    states.push(message.state);
    for (const check of waiters) check();
  });
  function waitFor(predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error("Runner did not reach expected state"));
      }, 7000);
      function check() {
        const state = states.find(predicate);
        if (!state) return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve(state);
      }
      waiters.add(check);
      check();
    });
  }
  const failed = await waitFor((state) => state.error && !state.task);
  assert.equal(failed.ready, false);
  assert.equal(failed.canRetryStartup, true);
  assert.equal(failed.studioUrl, null);
  assert.match(failed.error, /NEWS-10/u);
  assert.deepEqual(failed.engines, { kokoro: true, qwen: true, portrait: false, face: false });
  await fs.rm(resolve(root, "blocked"));
  child.send({ type: "action", id: "retry", input: { action: "retry-startup" } });
  const ready = await waitFor((state) => state.ready && !state.task);
  assert.equal(ready.error, null);
  assert.equal((await fetch(ready.studioUrl)).status, 200);
  assert.equal((await fs.readFile(resolve(root, "builds"), "utf8")).trim().split("\n").length, 2);
});
