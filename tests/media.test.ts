import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { readEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import {
  encodePcmWav,
  pronounce,
  readPcmWav,
  sampleRate,
  splitNarration,
  vttTimestamp,
} from "../src/media/audio.js";
import { currentNarrationGeneratorHash, narrationGeneratorHash } from "../src/media/fingerprint.js";
import type {
  MediaProvider,
  MediaRequest,
  NarrationTiming,
  ProductionSettings,
} from "../src/media/model.js";
import { validateTiming } from "../src/media/package.js";
import { FakeProvider } from "../src/media/providers.js";
import { listMediaJobs, mediaNextAction, narrationSettingsMatch } from "../src/media/status.js";
import { MediaStore } from "../src/media/store.js";
import {
  advanceMediaJob,
  createMediaJob,
  mediaOperationTimeoutMs,
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

test("only Kokoro polling gets the longer local scene budget", () => {
  for (const provider of ["fake", "local-speech", "local-kokoro"] as const)
    for (const operation of ["lookup", "submit", "poll"] as const) {
      assert.equal(
        mediaOperationTimeoutMs(provider, operation),
        provider === "local-kokoro" && operation === "poll" ? 65_000 : 25_000,
      );
      assert.equal(mediaOperationTimeoutMs(provider, operation, 10), 10);
    }
});

test("Kokoro holds the lease through cancellation cleanup and resumes the same scene", async (t) => {
  const { run, store, settings } = await fixture(t);
  const backend = new CountingProvider(store);
  const job = await createMediaJob(store, run.directory, backend, settings);
  const owner = store.acquire(job.id);
  job.request.provider = "local-kokoro";
  job.request.generatorHash = await currentNarrationGeneratorHash("local-kokoro");
  job.requestHash = hash(JSON.stringify(job.request));
  store.save(job, owner);
  store.release(job.id, owner);
  let interrupted = true;
  let cleaned = false;
  let progress = 0;
  const provider: MediaProvider = {
    id: "local-kokoro",
    billing: "free",
    quote: () => 0,
    submit: (request, key) => backend.submit(request, key),
    lookup: (key) => backend.lookup(key),
    poll: async (_id, _request, signal) => {
      if (interrupted) {
        await new Promise<void>((done) =>
          signal.addEventListener(
            "abort",
            () => {
              assert.throws(() => store.acquire(job.id), /already being processed/);
              setTimeout(() => {
                cleaned = true;
                done();
              }, 20);
            },
            { once: true },
          ),
        );
        // Even a late successful result cannot turn a fired deadline into success.
        return { state: "processing", progress: "Late result" };
      }
      progress++;
      return { state: "processing", progress: `Recorded scene ${progress}` };
    },
  };
  const submitted = await advanceMediaJob(store, job.id, provider);
  const stopped = await advanceMediaJob(store, job.id, provider, 10);
  assert.equal(stopped.phase, "POLL_TIMEOUT");
  assert.equal(stopped.progress, null);
  assert.equal(progress, 0);
  assert.equal(cleaned, true);
  const released = store.acquire(job.id);
  store.release(job.id, released);
  interrupted = false;
  const resumed = await advanceMediaJob(store, job.id, provider);
  assert.equal(resumed.phase, "PROCESSING");
  assert.equal(resumed.providerJobId, submitted.providerJobId);
  assert.equal(resumed.progress, "Recorded scene 1");
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
  await rm(resolve(rebuilt.outputDirectory as string, "narration.wav"));
  const recovered = await createMediaJob(store, run.directory, provider, settings);
  assert.notEqual(recovered.id, job.id);
  assert.equal(recovered.retryOf, job.id);
  assert.equal(store.get(job.id).phase, "SUCCEEDED", "historical record stays intact");
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

test("job discovery is read-only, filters selectors, and gives conservative recovery actions", async (t) => {
  const { directory, database, run, store, settings } = await fixture(t);
  const missing = resolve(directory, "missing/jobs.sqlite");
  assert.deepEqual(await MediaStore.readJobs(missing), []);
  await assert.rejects(readFile(missing), { code: "ENOENT" });
  const job = await createMediaJob(store, run.directory, new CountingProvider(store), settings);
  const before = store.get(job.id);
  const listed = await listMediaJobs("CAP-01", database);
  assert.equal(listed[0]?.id, job.id);
  assert.equal(listed[0]?.scriptMatches, true);
  assert.equal(listed[0]?.settingsMatch, false, "simulation does not match real narrator settings");
  assert.deepEqual(await listMediaJobs("CAP-01@duo", database), []);
  assert.deepEqual(store.get(job.id), before);
  job.phase = "SUBMISSION_UNKNOWN";
  assert.match(mediaNextAction(job), /Reconcile without resubmitting/);
  job.phase = "PACKAGE_FAILED";
  assert.match(mediaNextAction(job), /media-package/);
  job.request.provider = "local-kokoro";
  assert.equal(narrationSettingsMatch(job, episode, settings), true);
  assert.equal(
    narrationSettingsMatch(job, episode, {
      ...settings,
      localPreview: { ...settings.localPreview, voice: "af_bella" },
    }),
    false,
  );
});

test("local attempts recover deleted source artifacts without mutating the old job", async (t) => {
  const { directory, run, store, settings } = await fixture(t);
  const provider: MediaProvider = {
    id: "local-speech",
    billing: "free",
    quote: () => 0,
    submit: async () => "test-local-job",
    lookup: async () => ({ state: "unknown" }),
    poll: async () => ({ state: "processing", progress: "fixture" }),
  };
  const old = await createMediaJob(store, run.directory, provider, settings);
  const evidence = JSON.parse(await readFile(resolve(run.directory, "demo-evidence.json"), "utf8"));
  const fresh = await prepareEpisode(episode, {
    artifactRoot: directory,
    preview: true,
    verifier: async () => evidence,
  });
  await rm(run.directory, { recursive: true });
  const recovered = await createMediaJob(store, fresh.directory, provider, settings);
  assert.notEqual(recovered.id, old.id);
  assert.equal(recovered.retryOf, old.id);
  assert.equal(recovered.request.sourceDirectory, fresh.directory);
  assert.deepEqual(store.get(old.id), old);
  assert.equal((await advanceMediaJob(store, recovered.id, provider)).phase, "SUBMITTED");
  assert.equal((await createMediaJob(store, fresh.directory, provider, settings)).id, recovered.id);
  const owner = store.acquire(recovered.id);
  const failed = store.get(recovered.id);
  failed.phase = "FAILED";
  store.save(failed, owner);
  store.release(failed.id, owner);
  const retry = await createMediaJob(store, fresh.directory, provider, settings);
  assert.equal(retry.retryOf, failed.id);
  assert.notEqual(retry.id, failed.id);
});

test("narration fingerprints change with synthesis code, preserve visual-only reuse, and reject mixed recovery", async (t) => {
  const files = {
    "src/media/audio.ts": Buffer.from("audio one"),
    "src/media/neural.ts": Buffer.from("neural one"),
    "src/media/kokoro-runner.py": Buffer.from("runner one"),
    "src/video/frames.ts": Buffer.from("visual one"),
  };
  const first = narrationGeneratorHash("local-kokoro", files);
  assert.notEqual(
    first,
    narrationGeneratorHash("local-kokoro", {
      ...files,
      "src/media/kokoro-runner.py": Buffer.from("runner two"),
    }),
  );
  assert.equal(
    first,
    narrationGeneratorHash("local-kokoro", {
      ...files,
      "src/video/frames.ts": Buffer.from("visual two"),
    }),
  );
  assert.notEqual(
    first,
    narrationGeneratorHash("local-kokoro", {
      "dist/src/media/audio.js": files["src/media/audio.ts"],
      "dist/src/media/neural.js": files["src/media/neural.ts"],
      "src/media/kokoro-runner.py": files["src/media/kokoro-runner.py"],
    }),
  );
  const { run, store, settings } = await fixture(t);
  const provider = new CountingProvider(store);
  const job = await createMediaJob(store, run.directory, provider, settings);
  const owner = store.acquire(job.id);
  job.request.generatorHash = hash("older generator");
  job.requestHash = hash(JSON.stringify(job.request));
  store.save(job, owner);
  store.release(job.id, owner);
  const blocked = await advanceMediaJob(store, job.id, provider);
  assert.equal(blocked.phase, "FAILED");
  assert.match(blocked.error ?? "", /generator changed/);
  assert.equal(provider.submissions, 0);
  const legacyProvider: MediaProvider = {
    id: "local-speech",
    billing: "free",
    quote: () => 0,
    submit: async () => {
      throw new Error("Legacy synthesis must not start");
    },
    lookup: async () => ({ state: "unknown" }),
    poll: async () => {
      throw new Error("Legacy synthesis must not continue");
    },
  };
  const legacy = await createMediaJob(store, run.directory, legacyProvider, settings);
  const legacyOwner = store.acquire(legacy.id);
  delete legacy.request.generatorHash;
  legacy.requestHash = hash(JSON.stringify(legacy.request));
  store.save(legacy, legacyOwner);
  store.release(legacy.id, legacyOwner);
  const stopped = await advanceMediaJob(store, legacy.id, legacyProvider);
  assert.equal(stopped.phase, "FAILED");
  assert.match(stopped.error ?? "", /unfinished legacy recording/);
});

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
