import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { hash } from "../src/digest.js";
import { projectRoot } from "../src/paths.js";
import {
  acquireVideoGate,
  recoverVideoCache,
  releaseVideoLock,
  videoCacheDirectory,
} from "../src/video/cache.js";

const exec = promisify(execFile);

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "sap-video-cache-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = hash("current render inputs");
  const directory = await videoCacheDirectory(root, "CAP-01", key);
  const token = "current-lock-token";
  await writeFile(
    resolve(directory, "export.lock"),
    JSON.stringify({ pid: process.pid, host: hostname(), token }),
    { flag: "wx" },
  );
  const files = {
    "short.mp4": Buffer.from("0000ftyp-fixture-only"),
    "poster.png": Buffer.from("89504e470d0a1a0a", "hex"),
    "review.html": Buffer.from("player"),
    "captions.vtt": Buffer.from("captions"),
    "timing.json": Buffer.from("{}"),
    "publication-draft.txt": Buffer.from("draft"),
  };
  const receipt = {
    schemaVersion: 1,
    stage: "READY",
    renderKey: key,
    quality: { decoded: true, audioChecked: true, durationSeconds: 55 },
    artifactHashes: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
    ),
  };
  for (const [name, bytes] of Object.entries(files))
    await writeFile(resolve(directory, name), bytes);
  const manifestPath = resolve(directory, "video-manifest.json");
  await writeFile(manifestPath, JSON.stringify(receipt));
  return { root, key, directory, token, receipt, manifestPath };
}

test("a cache completed before lock acquisition is rechecked and reused without quarantine", async (t) => {
  const f = await fixture(t);
  const result = await recoverVideoCache(f.directory, f.key, f.token, 55);
  assert.equal(result.saved?.receipt.renderKey, f.key);
  assert.equal(result.recoveryDirectory, null);
  await releaseVideoLock(f.directory, f.token);
  assert.ok(!(await readdir(f.directory)).includes("export.lock"));
});

test("a damaged READY video is preserved and subsequent attempts retain earlier recovery bytes", async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.directory, "short.mp4"), "truncated recording");
  await writeFile(resolve(f.directory, "decode.log"), "original diagnostic");
  const result = await recoverVideoCache(f.directory, f.key, f.token, 55);
  assert.equal(result.saved, null);
  assert.ok(result.recoveryDirectory);
  assert.equal(
    await readFile(resolve(result.recoveryDirectory, "short.mp4"), "utf8"),
    "truncated recording",
  );
  assert.equal(
    await readFile(resolve(result.recoveryDirectory, "decode.log"), "utf8"),
    "original diagnostic",
  );
  assert.deepEqual(
    JSON.parse(await readFile(resolve(result.recoveryDirectory, "video-manifest.json"), "utf8")),
    f.receipt,
  );
  assert.match(
    await readFile(resolve(result.recoveryDirectory, "recovery.json"), "utf8"),
    /artifact changed/u,
  );
  assert.ok((await readdir(f.directory)).includes("export.lock"));
  await writeFile(resolve(f.directory, "partial.tmp"), "unfinished retry");
  const retry = await recoverVideoCache(f.directory, f.key, f.token, 55);
  assert.ok(retry.recoveryDirectory);
  assert.notEqual(retry.recoveryDirectory, result.recoveryDirectory);
  assert.equal(
    await readFile(resolve(result.recoveryDirectory, "short.mp4"), "utf8"),
    "truncated recording",
  );
  assert.equal(
    await readFile(resolve(retry.recoveryDirectory, "partial.tmp"), "utf8"),
    "unfinished retry",
  );
  await releaseVideoLock(f.directory, f.token);
});

test("corrupt metadata and mismatched measured duration are repairable without reusing a false READY result", async (t) => {
  const f = await fixture(t);
  const mismatch = await recoverVideoCache(f.directory, f.key, f.token, 54);
  assert.equal(mismatch.saved, null);
  assert.ok(mismatch.recoveryDirectory);
  await writeFile(f.manifestPath, '{"schemaVersion":1');
  const malformed = await recoverVideoCache(f.directory, f.key, f.token, 55);
  assert.ok(malformed.recoveryDirectory);
  assert.equal(
    await readFile(resolve(malformed.recoveryDirectory, "video-manifest.json"), "utf8"),
    '{"schemaVersion":1',
  );
});

test("a parsed foreign full key is left intact rather than treated as repair permission", async (t) => {
  const f = await fixture(t);
  const receipt = { ...f.receipt, renderKey: hash("a different render") };
  await writeFile(f.manifestPath, JSON.stringify(receipt));
  const before = await readdir(f.directory);
  await assert.rejects(recoverVideoCache(f.directory, f.key, f.token, 55), /left intact/u);
  assert.deepEqual(await readdir(f.directory), before);
  assert.deepEqual(JSON.parse(await readFile(f.manifestPath, "utf8")), receipt);
});

test("recovery and release refuse a lock owned by another attempt", async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.directory, "short.mp4"), "damaged");
  await assert.rejects(
    recoverVideoCache(f.directory, f.key, "wrong-token", 55),
    /no longer owned/u,
  );
  await assert.rejects(releaseVideoLock(f.directory, "wrong-token"), /no longer owned/u);
  assert.equal(await readFile(resolve(f.directory, "short.mp4"), "utf8"), "damaged");
  assert.ok((await readdir(f.directory)).includes("export.lock"));
});

test("repair moves an output symlink itself and leaves the outside target untouched", async (t) => {
  const f = await fixture(t);
  const target = resolve(f.root, "outside.mp4");
  await writeFile(target, "outside original");
  await rm(resolve(f.directory, "short.mp4"));
  await symlink(target, resolve(f.directory, "short.mp4"));
  const result = await recoverVideoCache(f.directory, f.key, f.token, 55);
  assert.ok(result.recoveryDirectory);
  assert.equal(await readlink(resolve(result.recoveryDirectory, "short.mp4")), target);
  assert.equal(await readFile(target, "utf8"), "outside original");
  await writeFile(resolve(f.directory, "short.mp4"), "new owned file");
  assert.equal(await readFile(target, "utf8"), "outside original");
});

test("cache creation refuses parent and final directory symlinks before writing through them", async (t) => {
  const f = await fixture(t);
  const outside = await realpath(await mkdtemp(resolve(tmpdir(), "sap-video-outside-")));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await rm(f.directory, { recursive: true });
  await symlink(outside, f.directory);
  await assert.rejects(videoCacheDirectory(f.root, "CAP-01", f.key), /symlink/u);
  assert.deepEqual(await readdir(outside), []);
  await rm(resolve(f.root, "videos"), { recursive: true });
  await symlink(outside, resolve(f.root, "videos"));
  await assert.rejects(videoCacheDirectory(f.root, "CAP-01", f.key), /symlink/u);
  assert.deepEqual(await readdir(outside), []);
});

test("quarantine preserves the SQLite gate and keeps competing workers excluded", async (t) => {
  const f = await fixture(t);
  const release = await acquireVideoGate(f.directory);
  try {
    await writeFile(resolve(f.directory, "short.mp4"), "damaged export");
    const result = await recoverVideoCache(f.directory, f.key, f.token, 55);
    assert.ok(result.recoveryDirectory);
    assert.ok((await readdir(f.directory)).includes("export-gate.sqlite"));
    assert.ok(!(await readdir(result.recoveryDirectory)).includes("export-gate.sqlite"));
    await assert.rejects(acquireVideoGate(f.directory), /cannot acquire/u);
  } finally {
    release();
  }
  const next = await acquireVideoGate(f.directory);
  next();
});

test("actual processes cannot share an export gate and a killed owner releases it", async (t) => {
  const f = await fixture(t);
  const importCode = `import {acquireVideoGate} from ${JSON.stringify(resolve(projectRoot, "src/video/cache.ts"))};`;
  const ownerCode = `${importCode}const release=await acquireVideoGate(${JSON.stringify(f.directory)});process.stdout.write('READY\\n');setInterval(()=>{},1000);`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", ownerCode],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  t.after(async () => {
    child.kill("SIGKILL");
    await closed;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((done, reject) => {
      timer = setTimeout(() => reject(new Error("Export gate owner did not start")), 10_000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Export gate owner exited before readiness")));
      child.stdout.on("data", (bytes) => {
        if (String(bytes).includes("READY")) done();
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const attempt = `${importCode}try{const release=await acquireVideoGate(${JSON.stringify(f.directory)});process.stdout.write('ACQUIRED');release();}catch{process.stdout.write('BLOCKED');}`;
  const run = () =>
    exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", attempt], {
      cwd: projectRoot,
      timeout: 10_000,
    });
  assert.equal((await run()).stdout, "BLOCKED");
  child.kill("SIGKILL");
  await closed;
  assert.equal((await run()).stdout, "ACQUIRED");
});
