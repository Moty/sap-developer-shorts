import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { readEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import {
  encodePcmWav,
  pronounce,
  readPcmWav,
  sampleRate,
  splitNarration,
} from "../src/media/audio.js";
import type { MediaJob, MediaRequest } from "../src/media/model.js";
import {
  assembleNeuralNarration,
  kokoroSceneTimeoutMs,
  neuralRuntime,
  readNeuralScene,
  runNeuralProcess,
} from "../src/media/neural.js";
import { packageNarration, validateTiming } from "../src/media/package.js";
import { productionSettings, validateProductionSettings } from "../src/media/worker.js";

const episode = await readEpisode("CAP-01");

test("local renderer diagnostics distinguish failures, deadlines, and confirmed cancellation", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-neural-process-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const mode of ["error", "timeout", "abort", "pre-aborted", "missing-command"] as const) {
    const controller = new AbortController();
    const logPath = resolve(directory, `${mode}.log`);
    const marker = resolve(directory, `${mode}.ready`);
    if (mode === "pre-aborted") controller.abort();
    const pending = runNeuralProcess(
      mode === "missing-command" ? resolve(directory, "no-such-command") : process.execPath,
      [
        "-e",
        mode === "error"
          ? "process.stdout.write('test output');process.stderr.write('test error');process.exit(7)"
          : `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`,
      ],
      {
        signal: controller.signal,
        logPath,
        ...(mode === "timeout" ? { timeoutMs: 100 } : {}),
      },
    );
    // Attach the rejection handler before aborting, including already-aborted signals.
    const rejected = assert.rejects(pending, (error: Error) => error.message.includes(logPath));
    if (mode === "abort") {
      const until = Date.now() + 3000;
      while (true) {
        try {
          await access(marker);
          break;
        } catch {
          assert.ok(Date.now() < until, "child did not start");
          await delay(10);
        }
      }
      controller.abort();
    }
    await rejected;
    const log = JSON.parse(await readFile(logPath, "utf8"));
    assert.equal(log.timeoutMs, mode === "timeout" ? 100 : kokoroSceneTimeoutMs);
    assert.ok(log.elapsedMs >= 0);
    if (mode === "error") {
      assert.equal(log.reason, "process-error");
      assert.equal(log.code, 7);
      assert.equal(log.stdout, "test output");
      assert.equal(log.stderr, "test error");
    } else if (mode === "missing-command") assert.equal(log.code, "ENOENT");
    else {
      assert.equal(log.reason, mode === "timeout" ? "timeout" : "aborted");
      assert.equal(log.killed, true);
      assert.equal(log.signal, "SIGKILL");
    }
    if (log.pid) assert.throws(() => process.kill(log.pid, 0), { code: "ESRCH" });
  }
});

test("installing a cohost leaves existing voice fingerprints and pinned snapshots stable", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-voice-runtime-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = {
    schemaVersion: 1,
    engine: "kokoro",
    voice: "af_heart",
    files: { model: { sha256: hash("test model") } },
    packages: { kokoro: "test" },
    voices: { af_heart: { sha256: hash("test Heart") } },
  };
  const filename = resolve(directory, "runtime.json");
  await writeFile(filename, JSON.stringify(runtime));
  const first = await neuralRuntime(["af_heart"], directory);
  const withCohost = {
    ...runtime,
    voices: { ...runtime.voices, am_michael: { sha256: hash("test Michael") } },
  };
  await writeFile(filename, JSON.stringify(withCohost));
  assert.deepEqual(await neuralRuntime(["af_heart"], directory), first);
  const duo = await neuralRuntime(["af_heart", "am_michael"], directory);
  assert.notEqual(duo.hash, first.hash);
  await assert.rejects(neuralRuntime(["af_bella"], directory), /not installed/);
  const pinned = resolve(directory, "runtimes", `${first.hash}.json`);
  assert.equal(hash(await readFile(pinned)), first.hash);
  await writeFile(pinned, "changed snapshot");
  await assert.rejects(neuralRuntime(["af_heart"], directory), /snapshot changed/);
});

async function fixture(t: TestContext, voice?: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-neural-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const request: MediaRequest = {
    schemaVersion: 1,
    episode,
    settings: await productionSettings(),
    provider: "local-kokoro",
    scenario: "success",
    sourceDirectory: directory,
    sourceManifestHash: hash("source fixture"),
    voiceRuntimeHash: hash("model fixture"),
  };
  if (voice) request.settings.localPreview.voice = voice;
  let frames = 0;
  for (const [index, scene] of episode.scenes.entries()) {
    const text = scene.narration.trim().replace(/\s+/gu, " ");
    const phrases = splitNarration(text).map((phrase) => ({
      text: phrase,
      spokenText: pronounce(phrase, episode.pronunciation),
    }));
    const input = {
      schemaVersion: 1,
      sceneId: scene.id,
      text,
      spokenText: pronounce(text, episode.pronunciation),
      phrases,
      voice: request.settings.localPreview.voice,
      speed: request.settings.localPreview.speed ?? 0.96,
      voiceRuntimeHash: request.voiceRuntimeHash,
    };
    const sceneFrames = Math.round(sampleRate * (0.8 + index * 0.1));
    frames += sceneFrames;
    const wav = encodePcmWav(Buffer.alloc(sceneFrames * 2, 1));
    await writeFile(resolve(directory, `scene-${index}.wav`), wav);
    await writeFile(
      resolve(directory, `scene-${index}.json`),
      JSON.stringify({
        schemaVersion: 1,
        sceneId: scene.id,
        inputHash: hash(JSON.stringify(input)),
        wavHash: hash(wav),
        frames: sceneFrames,
        cues: phrases.map((phrase, position) => ({
          ...phrase,
          startSeconds: 0.02 + (position / phrases.length) * (sceneFrames / sampleRate - 0.04),
          endSeconds: 0.02 + ((position + 1) / phrases.length) * (sceneFrames / sampleRate - 0.04),
        })),
      }),
    );
  }
  return { directory, request, frames };
}

test("neural assembly preserves continuous scene audio with short pauses instead of padding the planned storyboard slots", async (t) => {
  const { directory, request, frames } = await fixture(t);
  const timing = await assembleNeuralNarration(request, directory);
  const wav = await readFile(resolve(directory, "narration.wav"));
  const actualFrames = readPcmWav(wav).length / 2;
  assert.equal(actualFrames, frames + Math.round(sampleRate * 0.18) * 6);
  assert.equal(timing.durationSeconds, actualFrames / sampleRate);
  assert.ok(timing.durationSeconds < episode.targetDurationSeconds);
  assert.equal(timing.engine, "kokoro");
  assert.equal(timing.alignment, "model-estimated-phrase-boundaries");
  assert.doesNotThrow(() => validateTiming(timing, episode, actualFrames));
  for (const scene of episode.scenes)
    assert.equal(
      timing.cues
        .filter((cue) => cue.sceneId === scene.id)
        .map((cue) => cue.text)
        .join(" "),
      scene.narration,
    );
});

test("saved neural scenes cannot be reused with another voice, runtime fingerprint, or modified audio", async (t) => {
  const { directory, request } = await fixture(t);
  await readNeuralScene(request, 0, directory);
  const changed = structuredClone(request);
  changed.settings.localPreview.voice = "af_bella";
  await assert.rejects(readNeuralScene(changed, 0, directory), /does not match/);
  changed.settings.localPreview.voice = request.settings.localPreview.voice;
  changed.voiceRuntimeHash = hash("different model");
  await assert.rejects(readNeuralScene(changed, 0, directory), /does not match/);
  const wav = readPcmWav(await readFile(resolve(directory, "scene-0.wav")));
  await writeFile(resolve(directory, "scene-0.wav"), encodePcmWav(Buffer.alloc(wav.length)));
  await assert.rejects(readNeuralScene(request, 0, directory), /does not match/);
});

test("model captions reject changed text and timestamps outside their continuous audio", async (t) => {
  const { directory, request } = await fixture(t);
  const filename = resolve(directory, "scene-0.json");
  const original = JSON.parse(await readFile(filename, "utf8"));
  const changed = structuredClone(original);
  changed.cues[0].text = "Unspoken words";
  await writeFile(filename, JSON.stringify(changed));
  await assert.rejects(readNeuralScene(request, 0, directory), /alignment is invalid/);
  changed.cues = original.cues;
  changed.cues[0].endSeconds = 99;
  await writeFile(filename, JSON.stringify(changed));
  await assert.rejects(readNeuralScene(request, 0, directory), /alignment is invalid/);
});

test("neural caption timing must retain its estimate disclosure", async (t) => {
  const { directory, request, frames } = await fixture(t);
  const timing = await assembleNeuralNarration(request, directory);
  delete timing.alignment;
  assert.throws(() => validateTiming(timing, episode, frames), /Narration timing/);
});

test("voice selection accepts American and British English male and female profiles and rejects unsupported IDs", async () => {
  const settings = await productionSettings();
  for (const voice of ["af_bella", "am_michael", "bf_emma", "bm_george"]) {
    const selected = structuredClone(settings);
    selected.localPreview.voice = voice;
    assert.equal(validateProductionSettings(selected).localPreview.voice, voice);
  }
  for (const voice of ["af_invented", "../../voice", "ff_siwis", "heart"]) {
    const selected = structuredClone(settings);
    selected.localPreview.voice = voice;
    assert.throws(() => validateProductionSettings(selected), /Invalid production settings/);
  }
  assert.throws(() => validateProductionSettings(null), /Invalid production settings/);
});

test("packaged neural previews name the recorded voice instead of always labeling it Heart", async (t) => {
  for (const [voice, name] of [
    ["af_bella", "Bella"],
    ["bm_george", "George"],
  ] as const) {
    const { directory, request } = await fixture(t, voice);
    await assembleNeuralNarration(request, directory);
    await writeFile(
      resolve(directory, "review.html"),
      "<!--MEDIA_PLAYER--><p>Local system voice preview. Captions follow measured phrase boundaries.</p><p>Local voice news preview. Captions follow measured phrase boundaries.</p>",
    );
    const at = new Date().toISOString();
    const job: MediaJob = {
      schemaVersion: 1,
      id: "voice-label-fixture",
      requestKey: hash(JSON.stringify(request)),
      requestHash: hash(JSON.stringify(request)),
      request,
      phase: "PACKAGE_PENDING",
      providerJobId: "voice-label-fixture",
      providerOutput: { kind: "narration", billedCents: 0, directory },
      quoteCents: 0,
      billedCents: 0,
      outputDirectory: null,
      error: null,
      progress: null,
      createdAt: at,
      updatedAt: at,
      history: [],
    };
    const output = await packageNarration(job);
    const html = await readFile(resolve(output, "review.html"), "utf8");
    assert.ok(html.includes(`Local AI voice (Kokoro / ${name})`));
    assert.ok(html.includes(`Local AI news voice (Kokoro / ${name})`));
    assert.ok(!html.includes("Kokoro / Heart"));
    const receipt = JSON.parse(await readFile(resolve(output, "media-manifest.json"), "utf8"));
    assert.equal(receipt.quality.narrator.voice, voice);
  }
});
