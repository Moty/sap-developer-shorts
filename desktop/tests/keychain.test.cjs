const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, readFile, chmod, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
test("desktop registration uses the compiled-helper interface and its own config directory without Swift", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "sap-desktop-keychain-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = resolve(root, "helper");
  await writeFile(
    helper,
    `#!${process.execPath}\nconst fs=require('node:fs');const[action,id]=process.argv.slice(2);fs.appendFileSync(process.env.TEST_AUDIT,JSON.stringify({action,id})+'\\n');if(action==='get')process.stdout.write('synthetic-secret');if(action==='put')process.stdin.resume();`,
  );
  await chmod(helper, 0o700);
  const code = `const m=await import('./src/worker/credentials.ts');await m.saveDevice({origin:'https://studio.example',workerId:'synthetic-worker',tenantId:'fixture',expiresAt:9999999999999},'synthetic-secret');const saved=await m.loadDevice();if(saved.credential!=='synthetic-secret')throw new Error('Credential did not round-trip');await m.removeDevice();`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    {
      cwd: resolve(__dirname, "../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        SHORTS_KEYCHAIN_HELPER: helper,
        SHORTS_WORKER_DATA_ROOT: resolve(root, "worker"),
        TEST_AUDIT: resolve(root, "calls.jsonl"),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes("synthetic-secret"));
  const calls = (await readFile(resolve(root, "calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(calls[0].action, "put");
  assert.equal(calls.at(-1).action, "delete");
  assert.ok(calls.some((call) => call.action === "get"));
  assert.ok(calls.every((call) => call.id === "synthetic-worker"));
});
