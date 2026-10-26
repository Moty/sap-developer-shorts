const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  sha,
  safeRelative,
  installWorkspace,
  desktopEnvironment,
  workerInput,
  allowedExternal,
} = require("../core.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(resolve(tmpdir(), "sap-desktop-unit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payload = resolve(root, "payload"),
    workspace = resolve(root, "workspace");
  await fs.mkdir(resolve(payload, "node_modules"), { recursive: true });
  const entries = [
    { path: "dist/src/app.js", policy: "runtime", text: "runtime-v1" },
    { path: "content/episodes/CAP-01.json", policy: "seed", text: "public-script" },
    { path: "config/production.json", policy: "seed", text: "default-heart" },
  ];
  const manifest = {
    schemaVersion: 1,
    version: "0.1.0",
    revision: "fixture",
    files: entries.map(({ path, policy, text }) => ({ path, policy, sha256: sha(text) })),
  };
  for (const { path, text } of entries) {
    const target = resolve(payload, "seed", path);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }
  const save = () => fs.writeFile(resolve(payload, "manifest.json"), JSON.stringify(manifest));
  await save();
  return { root, payload, workspace, manifest, save };
}
test("desktop installation seeds an independent workspace and repairs only application files on update", async (t) => {
  const f = await fixture(t);
  await installWorkspace(f.payload, f.workspace);
  await fs.writeFile(resolve(f.workspace, "content/episodes/CAP-01.json"), "my-edited-script");
  await fs.writeFile(resolve(f.workspace, "config/production.json"), "my-narrator-choice");
  await fs.mkdir(resolve(f.workspace, ".state/voice-profiles"), { recursive: true });
  await fs.writeFile(resolve(f.workspace, ".state/voice-profiles/private.txt"), "private-voice");
  await fs.writeFile(resolve(f.workspace, "dist/src/app.js"), "incomplete-update");
  await installWorkspace(f.payload, f.workspace);
  assert.equal(await fs.readFile(resolve(f.workspace, "dist/src/app.js"), "utf8"), "runtime-v1");
  assert.equal(
    await fs.readFile(resolve(f.workspace, "content/episodes/CAP-01.json"), "utf8"),
    "my-edited-script",
  );
  assert.equal(
    await fs.readFile(resolve(f.workspace, "config/production.json"), "utf8"),
    "my-narrator-choice",
  );
  assert.equal(
    await fs.readFile(resolve(f.workspace, ".state/voice-profiles/private.txt"), "utf8"),
    "private-voice",
  );
  assert.equal(
    await fs.realpath(resolve(f.workspace, "node_modules")),
    await fs.realpath(resolve(f.payload, "node_modules")),
  );
});
test("payload verification completes before creating or modifying workspace content", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(resolve(f.payload, "seed/content/episodes/CAP-01.json"), "tampered");
  await assert.rejects(installWorkspace(f.payload, f.workspace), /checksum failed/);
  await assert.rejects(fs.access(f.workspace), { code: "ENOENT" });
});
test("workspace setup rejects occupied folders and redirected application directories without removing their contents", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.workspace);
  await fs.writeFile(resolve(f.workspace, "keep.txt"), "existing");
  await assert.rejects(installWorkspace(f.payload, f.workspace), /empty desktop workspace/);
  assert.equal(await fs.readFile(resolve(f.workspace, "keep.txt"), "utf8"), "existing");
  const second = resolve(f.root, "second");
  await installWorkspace(f.payload, second);
  await fs.rm(resolve(second, "dist"), { recursive: true });
  const outside = resolve(f.root, "outside");
  await fs.mkdir(outside);
  await fs.symlink(outside, resolve(second, "dist"));
  await assert.rejects(installWorkspace(f.payload, second), /symbolic link/);
  assert.deepEqual(await fs.readdir(outside), []);
});
test("manifest paths and policies cannot smuggle private state or escape the workspace", async (t) => {
  for (const value of [
    "../escape",
    "/tmp/escape",
    "src/../../escape",
    "src\\escape",
    ".state/voice",
    "credentials/key.json",
    "artifacts/movie",
    "node_modules/private",
    "src//x",
  ])
    assert.throws(() => safeRelative(value));
  const f = await fixture(t);
  f.manifest.files.push({ ...f.manifest.files[0] });
  await f.save();
  await assert.rejects(installWorkspace(f.payload, f.workspace), /Invalid desktop payload entry/);
});
test("the packaged environment selects bundled tools and separates desktop data from checkout state", () => {
  const env = desktopEnvironment("/app/payload", "/data/workspace", "/data", {
    PATH: "/opt/homebrew/bin",
    NODE_OPTIONS: "--require injected.js",
    NODE_PATH: "/private",
    PYTHONPATH: "/custom",
    HOST: "0.0.0.0",
    GOOGLE_APPLICATION_CREDENTIALS: "/private/key.json",
    HTTPS_PROXY: "https://proxy.example",
  });
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(env.HOST, undefined);
  assert.ok(!env.PATH.includes("homebrew"));
  assert.ok(env.PATH.startsWith("/data/workspace/.desktop-bin:/app/payload/bin:"));
  assert.equal(env.SHORTS_WORKER_DATA_ROOT, "/data/worker");
  assert.equal(env.UV_PYTHON_PREFERENCE, "only-managed");
  assert.equal(env.HTTPS_PROXY, "https://proxy.example");
});
test("device pairing validates an origin and name without accepting arbitrary command arguments", () => {
  assert.deepEqual(workerInput({ origin: "https://studio.example/", name: " My Mac " }), {
    origin: "https://studio.example",
    name: "My Mac",
  });
  assert.equal(
    workerInput({ origin: "http://127.0.0.1:5890", name: "Local test" }).origin,
    "http://127.0.0.1:5890",
  );
  for (const origin of [
    "http://remote.example",
    "file:///private",
    "https://u:p@studio.example",
    "https://studio.example/path",
    "https://studio.example?token=secret",
  ])
    assert.throws(() => workerInput({ origin, name: "Mac" }));
  assert.throws(() => workerInput({ origin: "https://studio.example", name: "bad\nname" }));
  assert.equal(allowedExternal("https://cap.cloud.sap/docs"), true);
  assert.equal(allowedExternal("file:///private"), false);
  assert.equal(allowedExternal("javascript:alert(1)"), false);
});
test("public release packaging stops before building when signing and review configuration is absent", () => {
  const env = { ...process.env };
  for (const name of [
    "DESKTOP_SIGN_IDENTITY",
    "DESKTOP_NOTARY_PROFILE",
    "DESKTOP_REDISTRIBUTION_REVIEWED",
  ])
    delete env[name];
  const result = spawnSync(
    process.execPath,
    [resolve(__dirname, "../scripts/build.mjs"), "--release"],
    { env, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Developer ID identity/);
});
