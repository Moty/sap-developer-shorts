import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { hash } from "../src/digest.js";
import { verifiedKokoroVoices } from "../src/media/voice-assets.js";
import { sourceFile } from "../src/paths.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), "sap-voice-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const spec = JSON.parse(await readFile(await sourceFile("config/neural-voice.json"), "utf8"));
  async function asset(name: string, bytes: Buffer | string) {
    await writeFile(resolve(root, name), bytes);
    return { path: name, sha256: hash(bytes) };
  }
  const runtime = {
    schemaVersion: 1,
    engine: "kokoro",
    repository: spec.repository,
    revision: spec.revision,
    voice: "af_heart",
    packages: { kokoro: "0.9.4" },
    files: {
      model: await asset("model.bin", Buffer.alloc(200_000, 7)),
      config: await asset("config.json", "{}"),
    },
    voices: {
      am_michael: await asset("michael.bin", "Michael fixture"),
      af_heart: await asset("heart.bin", "Heart fixture"),
    },
  };
  const save = (value: unknown = runtime) =>
    writeFile(resolve(root, "runtime.json"), JSON.stringify(value));
  await save();
  return { root, runtime, save };
}

test("voice inventory hashes shared and per-voice assets without writing runtime snapshots", async (t) => {
  const { root } = await fixture(t);
  const names = await readdir(root);
  const before = await Promise.all(names.map((name) => readFile(resolve(root, name))));
  assert.deepEqual(await verifiedKokoroVoices(root), ["af_heart", "am_michael"]);
  assert.deepEqual(await readdir(root), names);
  assert.deepEqual(await Promise.all(names.map((name) => readFile(resolve(root, name)))), before);
});

test("missing, malformed, oversized, or unpinned runtime metadata offers no voice choices", async (t) => {
  const { root, runtime, save } = await fixture(t);
  for (const changed of [
    null,
    [],
    { ...runtime, schemaVersion: 2 },
    { ...runtime, engine: "other" },
    { ...runtime, repository: "other/model" },
    { ...runtime, revision: "a".repeat(40) },
    { ...runtime, voice: "unknown" },
    { ...runtime, packages: { kokoro: "" } },
    { ...runtime, voices: [] },
  ]) {
    await save(changed);
    assert.deepEqual(await verifiedKokoroVoices(root), []);
  }
  await writeFile(resolve(root, "runtime.json"), "{");
  assert.deepEqual(await verifiedKokoroVoices(root), []);
  await writeFile(resolve(root, "runtime.json"), " ".repeat(1024 * 1024 + 1));
  assert.deepEqual(await verifiedKokoroVoices(root), []);
  await rm(resolve(root, "runtime.json"));
  assert.deepEqual(await verifiedKokoroVoices(root), []);
  assert.deepEqual(await verifiedKokoroVoices(resolve(root, "absent")), []);
});

test("bad shared model or configuration excludes every voice", async (t) => {
  const { root, runtime, save } = await fixture(t);
  for (const name of ["model", "config"] as const) {
    const original = runtime.files[name];
    for (const bad of [
      { ...original, path: "missing" },
      { ...original, sha256: "0".repeat(64) },
      { ...original, sha256: "not-a-digest" },
      { ...original, path: "." },
    ]) {
      runtime.files[name] = bad;
      await save();
      assert.deepEqual(await verifiedKokoroVoices(root), []);
    }
    runtime.files[name] = original;
  }
});

test("a damaged or absent voice excludes only that voice and unknown IDs are ignored", async (t) => {
  const { root, runtime, save } = await fixture(t);
  await save({ ...runtime, voices: { ...runtime.voices, xx_unknown: runtime.voices.af_heart } });
  await writeFile(resolve(root, "heart.bin"), "Damaged bytes");
  assert.deepEqual(await verifiedKokoroVoices(root), ["am_michael"]);
  await rm(resolve(root, "heart.bin"));
  assert.deepEqual(await verifiedKokoroVoices(root), ["am_michael"]);
  await save({ ...runtime, voices: { af_heart: null, am_michael: runtime.voices.am_michael } });
  assert.deepEqual(await verifiedKokoroVoices(root), ["am_michael"]);
});

test("asset paths cannot escape via traversal, absolute paths, or symlink redirects", async (t) => {
  const { root, runtime, save } = await fixture(t);
  const outside = await mkdtemp(resolve(tmpdir(), "sap-voice-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(resolve(outside, "voice.bin"), "Heart fixture");
  await symlink(outside, resolve(root, "redirect"));
  await symlink(resolve(outside, "voice.bin"), resolve(root, "voice-link"));
  for (const path of [
    resolve(outside, "voice.bin"),
    relative(root, resolve(outside, "voice.bin")),
    "redirect/voice.bin",
    "voice-link",
  ]) {
    runtime.voices.af_heart.path = path;
    await save();
    assert.deepEqual(await verifiedKokoroVoices(root), ["am_michael"]);
  }
  runtime.files.config.path = "redirect/voice.bin";
  runtime.files.config.sha256 = hash("Heart fixture");
  await save();
  assert.deepEqual(await verifiedKokoroVoices(root), []);
});

test("resolved regular assets within the runtime remain usable and directories are excluded", async (t) => {
  const { root, runtime, save } = await fixture(t);
  await symlink("heart.bin", resolve(root, "heart-link"));
  runtime.voices.af_heart.path = "heart-link";
  await save();
  assert.deepEqual(await verifiedKokoroVoices(root), ["af_heart", "am_michael"]);
  await mkdir(resolve(root, "not-a-file"));
  runtime.voices.af_heart.path = "not-a-file";
  await save();
  assert.deepEqual(await verifiedKokoroVoices(root), ["am_michael"]);
});

test("legacy single-voice manifests use files.voice without inventing additional installed voices", async (t) => {
  const { root, runtime, save } = await fixture(t);
  const { voices, ...legacy } = runtime;
  await save({ ...legacy, files: { ...legacy.files, voice: voices.af_heart } });
  assert.deepEqual(await verifiedKokoroVoices(root), ["af_heart"]);
  await writeFile(resolve(root, "heart.bin"), "Changed legacy voice");
  assert.deepEqual(await verifiedKokoroVoices(root), []);
});
