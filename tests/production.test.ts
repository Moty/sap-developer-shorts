import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import type { Episode } from "../src/domain.js";
import { encodePcmWav, pronounce, sampleRate } from "../src/media/audio.js";
import type { MediaJob, MediaProvider, NarrationTiming } from "../src/media/model.js";
import { packageNarration, readCompletedNarration } from "../src/media/package.js";
import { narrationIdentity, reuseCompletedNarration } from "../src/media/reuse.js";
import { MediaStore } from "../src/media/store.js";
import { advanceMediaJob, createMediaJob, productionSettings } from "../src/media/worker.js";
import { prepareEpisode } from "../src/pipeline.js";
import { latestProduction, ProductionBlocked, produce } from "../src/production.js";

const episode = await readEpisode("CAP-01");
const provider: MediaProvider = {
  id: "local-speech",
  billing: "free",
  quote: () => 0,
  submit: async () => {
    throw new Error("Tests must not generate speech");
  },
  lookup: async () => ({ state: "unknown" }),
  poll: async () => {
    throw new Error("Tests must not generate speech");
  },
};

async function fixture(t: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), "sap-shorts-production-"));
  const store = await MediaStore.open(resolve(root, "jobs.sqlite"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const settings = await productionSettings();
  const source = async (input: Episode = episode) =>
    prepareEpisode(input, {
      artifactRoot: root,
      preview: true,
      verifier: async () => ({
        demoId: "cap-inventory",
        verifiedAt: new Date().toISOString(),
        environment: { node: process.version, cds: "10.1.1", database: "sqlite-memory" },
        checks: [...input.demo.expectedChecks],
        captures: {
          products: { value: [] },
          filtered: { value: [] },
          metadata: '<edmx:Edmx Version="4.0"></edmx:Edmx>',
        },
      }),
    });
  const run = await source();
  const job = await createMediaJob(store, run.directory, provider, settings);
  const output = resolve(root, `recorded-${job.id}`);
  await mkdir(output);
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: settings.localPreview.voice,
    rate: settings.localPreview.wordsPerMinute,
    sampleRate,
    durationSeconds: episode.targetDurationSeconds,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      speechSeconds: 0.1,
    })),
    cues: episode.scenes.map((scene) => ({
      sceneId: scene.id,
      text: scene.narration,
      spokenText: pronounce(scene.narration, episode.pronunciation),
      startSeconds: scene.startSeconds,
      endSeconds: scene.startSeconds + 0.1,
    })),
  };
  await writeFile(
    resolve(output, "narration.wav"),
    encodePcmWav(Buffer.alloc(sampleRate * 2 * timing.durationSeconds)),
  );
  await writeFile(resolve(output, "timing.json"), JSON.stringify(timing));
  job.providerOutput = { kind: "narration", billedCents: 0, directory: output };
  job.billedCents = 0;
  job.phase = "SUCCEEDED";
  job.outputDirectory = await packageNarration(job);
  const owner = store.acquire(job.id);
  store.settle(job, 0);
  store.save(job, owner);
  store.release(job.id, owner);
  return { root, store, settings, job, source };
}

test("visual-only production updates copy verified speech into an independent package without submitting", async (t) => {
  const { root, store, job, source, settings } = await fixture(t);
  const changed = structuredClone(episode);
  changed.title = "A clearer visual headline";
  const run = await source(changed);
  const planned = await createMediaJob(store, run.directory, provider, settings);
  assert.notEqual(planned.id, job.id);
  assert.equal(narrationIdentity(planned.request), narrationIdentity(job.request));
  const reused = await reuseCompletedNarration(store, planned.id, resolve(root, "copied"));
  assert.equal(reused.phase, "PACKAGE_PENDING");
  assert.equal(reused.audioReuse?.jobId, job.id);
  assert.equal(reused.providerJobId, null, "reuse must not pretend a submission occurred");
  assert.notEqual(reused.providerOutput?.directory, job.providerOutput?.directory);
  assert.equal(
    reused.audioReuse?.sourceAudioHash,
    hash(await readFile(resolve(job.outputDirectory as string, "narration.wav"))),
  );
  await writeFile(
    resolve(job.outputDirectory as string, "narration.wav"),
    "earlier package was removed or changed",
  );
  const completed = await advanceMediaJob(store, reused.id, provider);
  assert.equal(completed.phase, "SUCCEEDED");
  const recorded = await readCompletedNarration(completed);
  assert.equal(recorded.receipt.audioReuse.jobId, job.id);
  assert.equal(recorded.receipt.generatorHash, completed.request.generatorHash);
  assert.equal(hash(recorded.files["narration.wav"] as Buffer), reused.audioReuse?.sourceAudioHash);
});

test("copied speech recovers after a crash without its donor and refuses altered bytes before packaging", async (t) => {
  const { root, store, job, source, settings } = await fixture(t);
  const changed = structuredClone(episode);
  changed.title = "Revised visual title";
  const run = await source(changed);
  const planned = await createMediaJob(store, run.directory, provider, settings);
  const workRoot = resolve(root, "copied");
  const copied = await reuseCompletedNarration(store, planned.id, workRoot);
  const owner = store.acquire(planned.id);
  store.save(planned, owner); // crash after atomic file copy, before the DB transition
  store.release(planned.id, owner);
  await rm(job.outputDirectory as string, { recursive: true });
  const recovered = await reuseCompletedNarration(store, planned.id, workRoot);
  assert.equal(recovered.phase, "PACKAGE_PENDING");
  assert.deepEqual(recovered.audioReuse, copied.audioReuse);
  const path = resolve(recovered.providerOutput?.directory as string, "narration.wav");
  const original = await readFile(path);
  const altered = Buffer.from(original);
  altered[44] = 1;
  await writeFile(path, altered);
  const refused = await advanceMediaJob(store, recovered.id, provider);
  assert.equal(refused.phase, "PACKAGE_FAILED");
  assert.match(refused.error ?? "", /Copied audio reuse artifact changed/);
  await writeFile(path, original);
  const ready = await advanceMediaJob(store, recovered.id, provider);
  assert.equal(ready.phase, "SUCCEEDED");
  assert.equal(
    hash((await readCompletedNarration(ready)).files["narration.wav"] as Buffer),
    ready.audioReuse?.sourceAudioHash,
  );
});

test("separate artifact roots keep separate jobs and reuse verified speech into the requested root", async (t) => {
  const { root, store, job, settings } = await fixture(t);
  const evidence = JSON.parse(
    await readFile(resolve(job.request.sourceDirectory, "demo-evidence.json"), "utf8"),
  );
  const other = await prepareEpisode(episode, {
    artifactRoot: resolve(root, "another-root"),
    preview: true,
    verifier: async () => evidence,
  });
  const planned = await createMediaJob(store, other.directory, provider, settings);
  assert.notEqual(planned.id, job.id);
  assert.equal(planned.request.sourceDirectory, other.directory);
  const reused = await reuseCompletedNarration(store, planned.id, resolve(root, "copies"));
  assert.equal(reused.audioReuse?.jobId, job.id);
  const packaged = await advanceMediaJob(store, reused.id, provider);
  assert.equal(packaged.phase, "SUCCEEDED");
  assert.equal(packaged.outputDirectory, resolve(other.directory, "media", packaged.id));
});

test("avatar-only revisions preserve the narration identity while voice changes invalidate it", async (t) => {
  const { job } = await fixture(t);
  job.request.episode.presentation = {
    tone: "casual",
    format: "explainer",
    humor: "none",
    speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
  };
  const identity = narrationIdentity(job.request);
  const speaker = job.request.episode.presentation.speakers[0];
  assert.ok(speaker);
  speaker.avatar = {
    mode: "photo",
    imageId: "portrait.png",
    mouthX: 0.46,
    mouthY: 0.61,
    mouthAngle: 0.1,
  };
  assert.equal(narrationIdentity(job.request), identity);
  speaker.voice = "af_bella";
  assert.notEqual(narrationIdentity(job.request), identity);
});

test("speech reuse refuses changed speech, voices, generator versions, legacy requests, and altered donor bytes", async (t) => {
  const { root, store, job, source, settings } = await fixture(t);
  const identity = narrationIdentity(job.request);
  for (const change of [
    (copy: MediaJob) => {
      const scene = copy.request.episode.scenes[0];
      assert.ok(scene);
      scene.narration = "Different speech.";
    },
    (copy: MediaJob) => {
      copy.request.settings.localPreview.voice = "af_bella";
    },
    (copy: MediaJob) => {
      copy.request.generatorHash = hash("another generator");
    },
    (copy: MediaJob) => {
      const scene = copy.request.episode.scenes[0];
      assert.ok(scene);
      scene.endSeconds += 1;
    },
  ]) {
    const copy = structuredClone(job);
    change(copy);
    assert.notEqual(narrationIdentity(copy.request), identity);
  }
  const legacy = structuredClone(job.request);
  delete legacy.generatorHash;
  assert.equal(narrationIdentity(legacy), null);
  const changed = structuredClone(episode);
  changed.title = "Visual revision";
  const run = await source(changed);
  const planned = await createMediaJob(store, run.directory, provider, settings);
  await writeFile(resolve(job.outputDirectory as string, "narration.wav"), "changed donor");
  assert.equal(
    (await reuseCompletedNarration(store, planned.id, resolve(root, "copied"))).phase,
    "PLANNED",
  );
});

test("production persists blocked preflight and timing outcomes without invoking later stages", async (t) => {
  const { root, job } = await fixture(t);
  const blocked = await produce("CAP-01", {
    artifactRoot: root,
    stages: {
      preflight: async () => {
        throw new ProductionBlocked("VOICE_SETUP_REQUIRED", "Voice missing", "Run voice-setup");
      },
      narration: async () => {
        throw new Error("Must not generate");
      },
    },
  });
  assert.equal(blocked.stage, "BLOCKED");
  assert.equal(blocked.failedAt, "PREFLIGHT");
  assert.equal(blocked.issue?.nextAction, "Run voice-setup");
  assert.deepEqual(Object.keys(blocked.generationTiming?.stages ?? {}), ["PREFLIGHT"]);
  assert.ok(blocked.generationTiming?.stages.PREFLIGHT?.completedAt);
  assert.equal((await latestProduction("CAP-01", root))?.id, blocked.id);
  const timing = await produce("CAP-01", {
    artifactRoot: root,
    stages: {
      preflight: async () => {},
      narration: async (checkpoint) => {
        await checkpoint(job);
        return { job, durationSeconds: 62, hookSeconds: 2 };
      },
      render: async () => {
        throw new Error("Invalid timing must not be rendered");
      },
    },
  });
  assert.equal(timing.stage, "BLOCKED");
  assert.equal(timing.issue?.code, "TIMING_REVIEW_REQUIRED");
  assert.equal(timing.mediaJobId, job.id);
  assert.equal(timing.narrationDirectory, job.outputDirectory);
  assert.equal(timing.durationSeconds, 62);
  assert.equal(timing.videoDirectory, null);
});

test("production retains completed narration on export failure and rejects a different selected voice job", async (t) => {
  const { root, job } = await fixture(t);
  const narration = async () => ({ job, durationSeconds: 55, hookSeconds: 2 });
  const failed = await produce("CAP-01", {
    artifactRoot: root,
    stages: {
      preflight: async () => {},
      narration,
      render: async () => {
        throw new Error("Encoder stopped; saved audio remains complete");
      },
    },
  });
  assert.equal(failed.stage, "FAILED");
  assert.equal(failed.failedAt, "RENDER");
  assert.equal(failed.mediaJobId, job.id);
  assert.equal(failed.narrationDirectory, job.outputDirectory);
  assert.ok(failed.generationTiming?.stages.NARRATION?.completedAt);
  assert.ok(failed.generationTiming?.stages.RENDER?.completedAt);
  assert.ok(failed.generationTiming?.completedAt);
  const mismatch = await produce("CAP-01", {
    artifactRoot: root,
    stages: {
      preflight: async () => {},
      narration,
      render: async () => ({
        directory: "wrong-video",
        mediaJobId: "different-voice-job",
        reused: false,
      }),
      library: async () => {
        throw new Error("Must not build an inconsistent studio");
      },
    },
  });
  assert.equal(mismatch.stage, "FAILED");
  assert.match(mismatch.issue?.message ?? "", /different narrator job/);
});

test("ready production carries one explicit narration through MP4 and studio and records reusable output", async (t) => {
  const { root, job } = await fixture(t);
  let timingAtMp4: unknown;
  const report = await produce("CAP-01", {
    artifactRoot: root,
    stages: {
      preflight: async () => {},
      narration: async () => ({ job, durationSeconds: 55, hookSeconds: 2, reused: true }),
      render: async (id) => {
        assert.equal(id, job.id);
        return { directory: "saved-video", mediaJobId: id, reused: true };
      },
      library: async (id) => {
        assert.equal(id, job.id);
        const saved = await latestProduction("CAP-01", root);
        assert.equal(saved?.stage, "LIBRARY");
        assert.ok(saved?.generationTiming?.completedAt);
        for (const step of Object.values(saved.generationTiming.stages)) {
          assert.ok(step.completedAt);
          assert.ok(step.elapsedMs >= 0);
        }
        timingAtMp4 = saved.generationTiming;
        return { directory: "saved-library", mediaJobId: id };
      },
    },
  });
  assert.equal(report.stage, "READY");
  assert.equal(report.reusedVideo, true);
  assert.equal(report.reusedAudio, true);
  assert.deepEqual(
    report.generationTiming,
    timingAtMp4,
    "studio packaging must not change MP4 generation time",
  );
  assert.deepEqual(report.voices, [job.request.settings.localPreview.voice]);
  assert.equal(report.inputHash, hash(JSON.stringify(episode)));
  assert.deepEqual(
    JSON.parse(await readFile(resolve(report.directory, "production.json"), "utf8")),
    report,
  );
});
