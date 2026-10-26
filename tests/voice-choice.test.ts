import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { createLibraryPages } from "../src/library-review.js";
import { encodePcmWav } from "../src/media/audio.js";
import { neuralRuntime, type synthesizeNeuralScene } from "../src/media/neural.js";
import {
  auditionIdentity,
  auditionKey,
  buildAuditionPage,
  collectVoiceSamples,
  createVoiceAudition,
  readVoiceSample,
} from "../src/media/voice-audition.js";
import { effectiveNarrators, selectNarrator } from "../src/media/voice-selection.js";
import { productionSettings } from "../src/media/worker.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), "sap-voice-choice-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = await productionSettings();
  const generatorHash = hash("sample generator fixture");
  const runtime = {
    schemaVersion: 1,
    engine: "kokoro",
    voice: "af_heart",
    files: { model: { sha256: hash("model") } },
    packages: { kokoro: "test" },
    voices: { af_heart: { sha256: hash("voice") }, am_michael: { sha256: hash("cohost") } },
  };
  await writeFile(resolve(root, "runtime.json"), JSON.stringify(runtime));
  const pinned = await neuralRuntime(["af_heart"], root);
  let recordings = 0;
  const synthesize: typeof synthesizeNeuralScene = async (request, _index, directory) => {
    assert.equal(request.episode.scenes.length, 1);
    assert.equal(request.settings.localPreview.voice, "af_heart");
    assert.equal(
      "sourceDirectory" in request,
      false,
      "sample must not invent verified episode evidence",
    );
    recordings++;
    await writeFile(
      resolve(directory, "scene-0.wav"),
      encodePcmWav(Buffer.alloc(22050 * 2 * 2, 1)),
    );
  };
  const options = { artifactRoot: root, runtime: pinned, generatorHash, synthesize };
  return { root, settings, options, recordings: () => recordings };
}

test("voice selection updates only the default and leaves explicit variant and dialogue speakers effective", async (t) => {
  const { root, settings } = await fixture(t);
  const config = resolve(root, "production.json");
  await writeFile(config, JSON.stringify(settings));
  const original = await readFile(config, "utf8");
  await assert.rejects(selectNarrator("../../voice", config), /Unsupported/);
  assert.equal(await readFile(config, "utf8"), original);
  assert.deepEqual(await selectNarrator("am_michael", config), {
    previous: "af_heart",
    selected: "am_michael",
  });
  const updated = JSON.parse(await readFile(config, "utf8"));
  const expected = structuredClone(settings);
  expected.localPreview.voice = "am_michael";
  assert.deepEqual(updated, expected);
  assert.equal(
    effectiveNarrators(await readContentEpisode("CAP-01"), updated).speakers[0]?.voice,
    "am_michael",
  );
  const casual = effectiveNarrators(await readContentEpisode("CAP-01@casual"), updated);
  assert.equal(casual.source, "presentation");
  assert.equal(casual.speakers[0]?.voice, "af_heart");
  assert.equal(casual.configurationFile, "content/presentations/CAP-01--casual.json");
  assert.deepEqual(
    effectiveNarrators(await readContentEpisode("CAP-01@duo"), updated).speakers.map(
      (speaker) => speaker.voice,
    ),
    ["af_heart", "am_michael"],
  );
});

test("auditions preserve defaults, reuse valid audio, and bind speed, voice, runtime, generator and text", async (t) => {
  const { root, settings, options, recordings } = await fixture(t);
  const before = JSON.stringify(settings);
  const first = await createVoiceAudition("af_heart", settings, options);
  assert.equal(first.reused, false);
  assert.equal(first.sample.durationSeconds, 2);
  assert.equal(JSON.stringify(settings), before);
  assert.equal((await createVoiceAudition("af_heart", settings, options)).reused, true);
  assert.equal(recordings(), 1);
  const identity = first.sample.identity;
  for (const changed of [
    { ...identity, speed: 1.02 },
    { ...identity, voice: "am_michael" },
    { ...identity, voiceRuntimeHash: hash("other runtime") },
    { ...identity, generatorHash: hash("other code") },
    { ...identity, text: "Different words" },
    { ...identity, pronunciation: { SAP: "sap" } },
  ]) {
    assert.notEqual(auditionKey(changed), first.sample.key);
    await assert.rejects(readVoiceSample(first.sample.directory, changed), /does not match/);
  }
  const page = await buildAuditionPage([first.sample], "af_heart", root);
  const html = await readFile(resolve(page, "review.html"), "utf8");
  assert.match(html, /Default narrator/);
  assert.match(html, /not episode recordings/);
  assert.match(html, /<audio controls preload="metadata"/);
  assert.doesNotMatch(html, /autoplay/);
  assert.equal(
    hash(await readFile(resolve(page, first.sample.key, "sample.wav"))),
    first.sample.audioHash,
  );
});

test("current sample discovery excludes changed, incomplete and outdated audio; failed recording never publishes", async (t) => {
  const { root, settings, options, recordings } = await fixture(t);
  const { sample } = await createVoiceAudition("af_heart", settings, options);
  const discovery = { runtimeRoot: root, generatorHash: options.generatorHash };
  assert.equal((await collectVoiceSamples(root, settings, discovery)).samples.length, 1);
  const newer = { ...discovery, generatorHash: hash("newer code") };
  assert.equal((await collectVoiceSamples(root, settings, newer)).samples.length, 0);
  await writeFile(
    resolve(sample.directory, "sample.wav"),
    encodePcmWav(Buffer.alloc(22050 * 2 * 2)),
  );
  assert.equal((await collectVoiceSamples(root, settings, discovery)).samples.length, 0);
  await assert.rejects(
    readVoiceSample(sample.directory, sample.identity),
    /audio is incomplete or changed/,
  );
  const repaired = await createVoiceAudition("af_heart", settings, options);
  assert.equal(repaired.reused, false);
  assert.equal(recordings(), 2);
  await rm(resolve(repaired.sample.directory, "sample-manifest.json"));
  assert.equal((await collectVoiceSamples(root, settings, discovery)).samples.length, 0);
  const interrupted: typeof synthesizeNeuralScene = async (_request, _index, directory) => {
    await writeFile(resolve(directory, "scene-0.log"), "Actual model failure details");
    throw new Error("Interrupted");
  };
  const brokenOptions = {
    ...options,
    generatorHash: hash("interrupted generation"),
    synthesize: interrupted,
  };
  await assert.rejects(
    createVoiceAudition("af_heart", settings, brokenOptions),
    /could not finish\. Diagnostics:/,
  );
  assert.deepEqual(
    (await readdir(resolve(root, "voice-auditions"))).filter((name) => name.startsWith(".")),
    [".failures"],
  );
  const failures = await readdir(resolve(root, "voice-auditions/.failures"));
  assert.equal(failures.length, 1);
  assert.equal(
    await readFile(
      resolve(root, "voice-auditions/.failures", failures[0] ?? "", "scene-0.log"),
      "utf8",
    ),
    "Actual model failure details",
  );
  assert.equal((await collectVoiceSamples(root, settings, newer)).samples.length, 0);
});

test("studio embeds portable verified voice samples with native audio and clear scope", async (t) => {
  const { settings, options } = await fixture(t);
  const { sample } = await createVoiceAudition("af_heart", settings, options);
  const pages = await createLibraryPages({
    entries: [],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
    voiceCatalog: {
      selected: "af_heart",
      installed: ["af_heart", "am_michael"],
      samples: [sample],
    },
  });
  const html = String(pages["review.html"]);
  assert.match(html, /media-src 'self'/);
  assert.match(html, /href="#voices"/);
  assert.match(html, /Listen to the voices/);
  assert.match(html, /Installed but no current sample: Michael/);
  assert.match(html, /voice-select af_heart/);
  assert.match(html, /data-local-action="voice-default"[^>]*data-voice="af_heart"[^>]*disabled/u);
  assert.match(
    html,
    /data-local-action="voice-audition"[^>]*data-voice="am_michael"[^>]*disabled/u,
  );
  assert.match(html, /data-local-action="voice-install"[^>]*data-voice="af_bella"[^>]*disabled/u);
  assert.match(html, /<summary>Terminal alternatives<\/summary>/u);
  assert.match(html, /Casual, comic, and conversation scripts have their own speaker assignments/);
  assert.equal(hash(pages[`voices/${sample.key}/sample.wav`] as Buffer), sample.audioHash);
  assert.throws(
    () => auditionIdentity("invalid", 0.96, hash("runtime"), hash("code")),
    /Unsupported/,
  );
});

test("missing voice samples always offer runnable commands even with more than three installed profiles", async () => {
  const installed = ["af_heart", "am_michael", "af_bella", "bf_emma"];
  const files = await createLibraryPages({
    entries: [],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
    voiceCatalog: { selected: "af_heart", installed, samples: [] },
  });
  const html = String(files["review.html"]);
  const commands = [...html.matchAll(/class="voice-missing-command"[^>]*>([^<]+)</gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    commands,
    installed.map((id) => `npm run shorts -- voice-audition ${id}`),
  );
});
