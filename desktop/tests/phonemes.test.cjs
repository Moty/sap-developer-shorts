const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { preparePhonemes } = require("../phonemes.cjs");
test("deep Python installations get a short phoneme path without changing the voice environment", async (t) => {
  const root = await fs.mkdtemp(resolve(tmpdir(), "sap-phoneme-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = resolve(root, "deep-workspace-name-".repeat(4));
  const source = resolve(
    workspace,
    ".state/neural-voice/venv/lib/python3.12/site-packages/espeakng_loader/espeak-ng-data",
  );
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(resolve(source, "phontab"), "synthetic-phoneme-table");
  const prepared = await preparePhonemes(workspace, root);
  t.after(() => prepared.cleanup());
  assert.ok(prepared.dataPath.length < 150);
  assert.equal(
    await fs.readFile(resolve(prepared.dataPath, "phontab"), "utf8"),
    "synthetic-phoneme-table",
  );
  assert.equal(await fs.readFile(resolve(source, "phontab"), "utf8"), "synthetic-phoneme-table");
  await prepared.cleanup();
  assert.equal(
    await fs.readFile(resolve(root, "phonemes/phontab"), "utf8"),
    "synthetic-phoneme-table",
  );
});
test("no phoneme cache is manufactured before stock voices are installed", async (t) => {
  const root = await fs.mkdtemp(resolve(tmpdir(), "sap-no-phonemes-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal(await preparePhonemes(resolve(root, "workspace"), root), null);
  assert.deepEqual(await fs.readdir(root), []);
});
