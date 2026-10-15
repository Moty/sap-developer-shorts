import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { readEpisode } from "../src/contracts.js";
import {
  encodePcmWav,
  pronounce,
  readPcmWav,
  sampleRate,
  splitNarration,
  vttTimestamp,
} from "../src/media/audio.js";
import type {
  MediaProvider,
  MediaRequest,
  NarrationTiming,
  ProductionSettings,
} from "../src/media/model.js";
import { validateTiming } from "../src/media/package.js";
import { FakeProvider } from "../src/media/providers.js";
import { MediaStore } from "../src/media/store.js";
import {
  advanceMediaJob,
  createMediaJob,
  productionSettings,
  rebuildMediaPackage,
} from "../src/media/worker.js";
import { projectRoot } from "../src/paths.js";
import { prepareEpisode } from "../src/pipeline.js";

const exec = promisify(execFile);
const episode = await readEpisode("CAP-01");

function testTiming(): NarrationTiming {
  return {
    schemaVersion: 1,
    mode: "local-preview",
    voice: "test",
    rate: 180,
    sampleRate,
    durationSeconds: episode.targetDurationSeconds,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      speechSeconds: scene.endSeconds - scene.startSeconds,
    })),
    cues: episode.scenes.map((scene) => ({
      sceneId: scene.id,
      text: scene.narration,
      spokenText: pronounce(scene.narration, episode.pronunciation),
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
    })),
  };
}

test("a real provider deadline is bounded and leaves the saved job resumable", async (t) => {
  const { run, store, settings } = await fixture(t);
  const backend = new CountingProvider(store);
  let hang = true;
  const provider: MediaProvider = {
    id: "fake",
    billing: "simulated",
    quote: () => 0,
    submit: (request, key) => backend.submit(request, key),
    lookup: (key) => backend.lookup(key),
    poll: (id, request, signal) =>
      hang
        ? new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new Error("Aborted test poll")), {
              once: true,
            }),
          )
        : backend.poll(id, request),
  };
  const job = await createMediaJob(store, run.directory, provider, settings);
  await advanceMediaJob(store, job.id, provider);
  assert.equal((await advanceMediaJob(store, job.id, provider, 10)).phase, "POLL_TIMEOUT");
  hang = false;
  await advanceMediaJob(store, job.id, provider);
  assert.equal((await advanceMediaJob(store, job.id, provider)).phase, "SIMULATED");
  assert.equal(backend.submissions, 1);
});

test("packaging failures and rebuilds reuse completed audio without another submission", async (t) => {
  const { directory, run, store, settings } = await fixture(t);
  const output = resolve(directory, "provider-output");
  let submissions = 0;
  const provider: MediaProvider = {
    id: "local-speech",
    billing: "free",
    quote: () => 0,
    submit: async () => {
      submissions++;
      return "completed-test-audio";
    },
    lookup: async () => ({ state: "found", id: "completed-test-audio" }),
    poll: async () => ({
      state: "ready",
      output: { kind: "narration", billedCents: 0, directory: output },
    }),
  };
  const job = await createMediaJob(store, run.directory, provider, settings);
  await advanceMediaJob(store, job.id, provider);
  assert.equal((await advanceMediaJob(store, job.id, provider)).phase, "PACKAGE_PENDING");
  assert.equal((await advanceMediaJob(store, job.id, provider)).phase, "PACKAGE_FAILED");
  await mkdir(output);
  await writeFile(
    resolve(output, "narration.wav"),
    encodePcmWav(Buffer.alloc(sampleRate * 2 * episode.targetDurationSeconds)),
  );
  await writeFile(resolve(output, "timing.json"), JSON.stringify(testTiming()));
  const completed = await advanceMediaJob(store, job.id, provider);
  assert.equal(completed.phase, "SUCCEEDED");
  const rebuilt = await rebuildMediaPackage(store, job.id);
  assert.equal(rebuilt.phase, "SUCCEEDED");
  assert.equal(submissions, 1);
});

test("caption text and timing must match the audio and saved episode", () => {
  const timing = testTiming();
  validateTiming(timing, episode, sampleRate * episode.targetDurationSeconds);
  assert.throws(() => validateTiming(timing, episode, sampleRate), /audio samples/);
  const altered = structuredClone(timing);
  const cue = altered.cues[0];
  assert.ok(cue);
  cue.text = "Different words";
  assert.throws(
    () => validateTiming(altered, episode, sampleRate * episode.targetDurationSeconds),
    /differs/,
  );
});

async function fixture(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-media-"));
  const run = await prepareEpisode(episode, {
    artifactRoot: directory,
    preview: true,
    verifier: async () => ({
      demoId: "cap-inventory",
      verifiedAt: new Date().toISOString(),
      environment: { node: process.version, cds: "10.1.1", database: "sqlite-memory" },
      checks: [...episode.demo.expectedChecks],
      captures: {
        products: { value: [] },
        filtered: { value: [] },
        metadata: '<edmx:Edmx Version="4.0"></edmx:Edmx>',
      },
    }),
  });
  const database = resolve(directory, "jobs.sqlite");
  const store = await MediaStore.open(database);
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  return { directory, run, database, store, settings: await productionSettings() };
}

class CountingProvider extends FakeProvider {
  submissions = 0;
  override async submit(request: MediaRequest, key: string) {
    this.submissions++;
    return super.submit(request, key);
  }
}

test("a lost submission response reconciles the saved provider ID without resubmission", async (t) => {
  const { run, database, store, settings } = await fixture(t);
  const provider = new CountingProvider(store);
  const job = await createMediaJob(store, run.directory, provider, settings, "lost-submit");
  const uncertain = await advanceMediaJob(store, job.id, provider);
  assert.equal(uncertain.phase, "SUBMISSION_UNKNOWN");
  assert.equal(provider.submissions, 1);
  const reopened = await MediaStore.open(database);
  try {
    const resumed = new CountingProvider(reopened);
    const submitted = await advanceMediaJob(reopened, job.id, resumed);
    assert.equal(submitted.phase, "SUBMITTED");
    assert.ok(submitted.providerJobId);
    await advanceMediaJob(reopened, job.id, resumed);
    assert.equal((await advanceMediaJob(reopened, job.id, resumed)).phase, "SIMULATED");
    assert.equal(resumed.submissions, 0);
  } finally {
    reopened.close();
  }
});

test("unconfirmed submissions remain unknown and keep the budget reserved", async (t) => {
  const { run, store, settings } = await fixture(t);
  const provider = new CountingProvider(store, 100);
  const job = await createMediaJob(store, run.directory, provider, settings, "unknown-submit");
  await advanceMediaJob(store, job.id, provider);
  for (let index = 0; index < 3; index++)
    assert.equal((await advanceMediaJob(store, job.id, provider)).phase, "SUBMISSION_UNKNOWN");
  assert.equal(provider.submissions, 1);
  const duplicate = await createMediaJob(
    store,
    run.directory,
    provider,
    settings,
    "unknown-submit",
  );
  assert.equal(duplicate.id, job.id);
  for (let index = 0; index < 4; index++) {
    const variant: ProductionSettings = {
      ...settings,
      localPreview: { ...settings.localPreview, voice: `Simulation ${index}` },
    };
    await createMediaJob(store, run.directory, provider, variant);
  }
  await assert.rejects(
    createMediaJob(store, run.directory, provider, {
      ...settings,
      localPreview: { ...settings.localPreview, voice: "Exceeds limit" },
    }),
    /spending limit/,
  );
});

test("polling resumes the same provider job after a timeout", async (t) => {
  const { run, store, settings } = await fixture(t);
  const provider = new CountingProvider(store);
  const job = await createMediaJob(store, run.directory, provider, settings, "poll-timeout");
  const submitted = await advanceMediaJob(store, job.id, provider);
  const timedOut = await advanceMediaJob(store, job.id, provider);
  assert.equal(timedOut.phase, "POLL_TIMEOUT");
  const complete = await advanceMediaJob(store, job.id, provider);
  assert.equal(complete.phase, "SIMULATED");
  assert.equal(complete.providerJobId, submitted.providerJobId);
  assert.equal(provider.submissions, 1);
});

test("an active worker lease excludes other workers and a dead worker lease is recoverable", async (t) => {
  const { run, database, store, settings } = await fixture(t);
  const provider = new CountingProvider(store);
  const job = await createMediaJob(store, run.directory, provider, settings);
  const owner = store.acquire(job.id);
  await assert.rejects(advanceMediaJob(store, job.id, provider), /already being processed/);
  store.release(job.id, owner);
  const code = `import { MediaStore } from ${JSON.stringify(resolve(projectRoot, "src/media/store.ts"))}; const store=await MediaStore.open(${JSON.stringify(database)}); const owner=store.acquire(${JSON.stringify(job.id)}); const saved=store.get(${JSON.stringify(job.id)}); saved.phase="SUBMITTING"; store.save(saved,owner); const {FakeProvider}=await import(${JSON.stringify(resolve(projectRoot, "src/media/providers.ts"))}); await new FakeProvider(store).submit(saved.request,saved.requestKey); store.close();`;
  await exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    cwd: projectRoot,
    timeout: 10000,
  });
  assert.equal((await advanceMediaJob(store, job.id, provider)).phase, "SUBMITTED");
});

test("media cannot be planned from a modified verified preview", async (t) => {
  const { run, store, settings } = await fixture(t);
  const preview = resolve(run.directory, "review.html");
  await writeFile(preview, `${await readFile(preview, "utf8")}changed`);
  await assert.rejects(
    createMediaJob(store, run.directory, new FakeProvider(store), settings),
    /Verified artifact changed/,
  );
});

test("WAV sample counts and caption grouping preserve measured timing and text", () => {
  const pcm = Buffer.alloc(sampleRate * 2);
  const wav = encodePcmWav(pcm);
  assert.equal(readPcmWav(wav).length / 2 / sampleRate, 1);
  assert.throws(() => readPcmWav(wav.subarray(0, wav.length - 1)), /Incomplete WAV/);
  const narration = episode.scenes.map((scene) => scene.narration).join(" ");
  assert.equal(splitNarration(narration).join(" "), narration);
  assert.ok(splitNarration(narration).every((phrase) => phrase.length <= 70));
  assert.equal(vttTimestamp(57.46848), "00:00:57.468");
});
