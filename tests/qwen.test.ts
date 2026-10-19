import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { readContentEpisode, validateEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { InMemoryFirebaseCloudStore } from "../src/firebase/rest-client.js";
import { processNextPendingProductionJob } from "../src/firebase/worker.js";
import { encodePcmWav, pronounce, splitNarration } from "../src/media/audio.js";
import { assertCloudLibrarySafe } from "../src/media/cloud-voice-safety.js";
import { narrationGeneratorHash } from "../src/media/fingerprint.js";
import {
  LocalVoicesProvider,
  localSceneIdentity,
  phraseCues,
  readLocalVoiceScene,
  timingSpeakers,
} from "../src/media/local-voices.js";
import type { LocalNarrationTiming, MediaRequest } from "../src/media/model.js";
import { withModelLock } from "../src/media/model-lock.js";
import { validateTiming } from "../src/media/package.js";
import { narrationIdentity } from "../src/media/reuse.js";
import { MediaStore } from "../src/media/store.js";
import {
  atomicJson,
  createVoiceProfile,
  deleteVoiceProfile,
  listVoiceProfiles,
  profileDirectory,
  readVoiceProfile,
} from "../src/media/voice-profiles.js";
import {
  assertCloudVoiceAllowed,
  assertVoiceReference,
  type ClonedVoice,
  hasClonedVoices,
  voiceIdentity,
} from "../src/media/voice-reference.js";
import { createMediaJob, productionSettings } from "../src/media/worker.js";
import { validateNewsEpisode } from "../src/news/contracts.js";
import { prepareContentEpisode } from "../src/pipeline.js";
import { startPreviewServer } from "../src/serve.js";

const voice: ClonedVoice = {
  engine: "qwen",
  profileId: "12345678-1234-4234-8234-123456789abc",
  revision: "a".repeat(64),
};
async function clonedEpisode() {
  const episode = await readContentEpisode("CAP-01@casual-v2");
  episode.schemaVersion = 2;
  const speaker = episode.presentation?.speakers[0];
  assert.ok(speaker);
  speaker.voice = voice;
  return episode;
}
test("cloned references are strict, structurally validated without private files, and require v2", async () => {
  const episode = await clonedEpisode();
  assert.equal(validateEpisode(episode), episode);
  assert.equal(hasClonedVoices(episode), true);
  assert.throws(() => assertCloudVoiceAllowed(episode), /local-only/);
  assert.throws(
    () => assertVoiceReference({ ...voice, samplePath: "/private/file" }),
    /valid local/,
  );
  assert.throws(() => assertVoiceReference({ ...voice, revision: "../secret" }), /valid local/);
  assert.equal(voiceIdentity(voice), voiceIdentity({ ...voice, revision: "b".repeat(64) }));
  episode.schemaVersion = 1;
  assert.throws(() => validateEpisode(episode), /schema/);
});
test("dialogue supports mixed engines and distinct profiles while rejecting revisions of one identity", async () => {
  const episode = await readContentEpisode("CAP-01@duo");
  episode.schemaVersion = 2;
  const first = episode.presentation?.speakers[0];
  const second = episode.presentation?.speakers[1];
  assert.ok(first && second);
  first.voice = voice;
  second.voice = "am_michael";
  assert.equal(validateEpisode(episode), episode);
  assert.deepEqual(
    timingSpeakers([
      { speakerId: first.id, voice, runtimeHash: "c".repeat(64) },
      { speakerId: second.id, voice: second.voice, runtimeHash: "d".repeat(64), speed: 0.96 },
    ]).map((speaker) => speaker.engine),
    ["qwen", "kokoro"],
  );
  second.voice = { ...voice, revision: "b".repeat(64) };
  assert.throws(() => validateEpisode(episode), /distinct voices/);
  second.voice = { ...voice, profileId: "12345678-1234-4234-8234-123456789abd" };
  assert.equal(validateEpisode(episode), episode);
});
test("personal narration preserves dated news evidence and accepts v2 without local profile access", async () => {
  const episode = await readContentEpisode("NEWS-02@duo");
  const evidence = JSON.stringify({ sources: episode.sources, claims: episode.claims });
  episode.schemaVersion = 2;
  const speaker = episode.presentation?.speakers[0];
  assert.ok(speaker);
  speaker.voice = voice;
  assert.equal(validateNewsEpisode(episode), episode);
  assert.equal(JSON.stringify({ sources: episode.sources, claims: episode.claims }), evidence);
});
test("Qwen alignment maps pronunciation-expanded words to original caption phrases and rejects drift", () => {
  const text = "Your API exposes OData. Type npm run demo.";
  const glossary = { API: "A P I", OData: "oh data", npm: "N P M" };
  const spoken = pronounce(text, glossary);
  const words = spoken
    .split(/\s+/u)
    .map((text, index) => ({ text, startSeconds: index * 0.2, endSeconds: (index + 1) * 0.2 }));
  const cues = phraseCues(text, glossary, words, words.length * 0.2);
  assert.equal(cues.map((cue) => cue.text).join(" "), text);
  assert.equal(cues.map((cue) => cue.spokenText).join(" "), spoken);
  assert.throws(() => phraseCues(text, glossary, words.slice(1), words.length), /cover/);
  const bad = structuredClone(words);
  const first = bad[0];
  assert.ok(first);
  first.startSeconds = -1;
  assert.throws(() => phraseCues(text, glossary, bad, words.length), /invalid caption/);
  const middle = structuredClone(words);
  const word = middle[2];
  assert.ok(word);
  word.startSeconds = Number.NaN;
  assert.throws(() => phraseCues(text, glossary, middle, words.length), /invalid caption/);
  const zero = structuredClone(words);
  const letter = zero[2];
  assert.ok(letter);
  letter.endSeconds = letter.startSeconds;
  assert.equal(phraseCues(text, glossary, zero, words.length).length, cues.length);
});
test("v2 timing covers exact scenes and display text without inventing a Kokoro root voice", async () => {
  const episode = await clonedEpisode();
  const plan = [{ speakerId: "narrator", voice, runtimeHash: "c".repeat(64) }];
  const timing: LocalNarrationTiming = {
    schemaVersion: 2,
    mode: "local-preview",
    engine: "local-voices",
    alignment: "local-per-speaker-phrase-boundaries",
    alignmentRuntimeHash: "c".repeat(64),
    speakers: timingSpeakers(plan),
    sampleRate: 22050,
    durationSeconds: episode.targetDurationSeconds,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      speechSeconds: scene.endSeconds - scene.startSeconds,
    })),
    cues: episode.scenes.flatMap((scene) => {
      const phrases = splitNarration(scene.narration);
      const step = (scene.endSeconds - scene.startSeconds) / phrases.length;
      return phrases.map((text, index) => ({
        text,
        spokenText: pronounce(text, episode.pronunciation),
        sceneId: scene.id,
        startSeconds: scene.startSeconds + step * index,
        endSeconds: scene.startSeconds + step * (index + 1),
      }));
    }),
  };
  assert.equal(validateTiming(timing, episode, timing.durationSeconds * 22050), timing);
  assert.throws(
    () => validateTiming({ ...timing, voice: "af_heart" }, episode, timing.durationSeconds * 22050),
    /timing/,
  );
  const missing = structuredClone(timing);
  missing.cues.pop();
  assert.throws(
    () => validateTiming(missing, episode, timing.durationSeconds * 22050),
    /Caption text/,
  );
});
test("Qwen-only files do not invalidate the Kokoro generator and profile/runtime changes invalidate clone reuse", async () => {
  const files = {
    "src/media/audio.ts": Buffer.from("audio"),
    "src/media/providers.ts": Buffer.from("providers"),
    "schemas/narration-timing.schema.json": Buffer.from("v1"),
    "src/media/qwen.ts": Buffer.from("qwen v1"),
  };
  const before = narrationGeneratorHash("local-kokoro", files);
  files["src/media/qwen.ts"] = Buffer.from("qwen v2");
  assert.equal(narrationGeneratorHash("local-kokoro", files), before);
  const episode = await clonedEpisode();
  const request: MediaRequest = {
    schemaVersion: 2,
    provider: "local-voices",
    episode,
    voicePlan: [{ speakerId: "narrator", voice, runtimeHash: "c".repeat(64) }],
    generatorHash: "d".repeat(64),
    scenario: "success",
    sourceDirectory: "/local",
    sourceManifestHash: "e".repeat(64),
    settings: {
      schemaVersion: 1,
      presenter: "stock",
      currency: "USD",
      pilotBudgetCents: 500,
      liveProvider: null,
      localPreview: {
        engine: "kokoro",
        voice: "af_heart",
        speed: 0.96,
        wordsPerMinute: 180,
        sampleRate: 22050,
      },
    },
  };
  const identity = narrationIdentity(request);
  const first = request.voicePlan[0];
  assert.ok(first);
  first.runtimeHash = "f".repeat(64);
  assert.notEqual(narrationIdentity(request), identity);
});
test("a cloud selector-only job cannot use an existing private voice or invoke production", async () => {
  const store = new InMemoryFirebaseCloudStore();
  await store.setDocument("productions", "private-test", {
    selector: "CAP-01@private",
    stage: "PENDING",
  });
  let profileReads = 0;
  const episode = await clonedEpisode();
  const report = await processNextPendingProductionJob({
    store,
    readEpisodeImpl: async () => episode,
    produceImpl: async () => {
      profileReads++;
      throw new Error("Must not read a profile or render");
    },
    logger: () => {},
  });
  assert.equal(report, null);
  assert.equal(profileReads, 0);
  assert.equal((await store.getDocument("productions", "private-test"))?.stage, "FAILED");
});
test("export classifies saved timing before copying even when the current episode uses Heart", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "qwen-export-"));
  try {
    const names = {
      "episodes/CAP-01/video/short.mp4": Buffer.from("private audio bytes"),
      "episodes/CAP-01/video/timing.json": Buffer.from(
        JSON.stringify({ schemaVersion: 2, engine: "local-voices" }),
      ),
      "episode.json": Buffer.from(JSON.stringify({ voice: "af_heart" })),
    };
    for (const [name, bytes] of Object.entries(names)) {
      await mkdir(resolve(root, name, ".."), { recursive: true });
      await writeFile(resolve(root, name), bytes);
    }
    await writeFile(
      resolve(root, "library-manifest.json"),
      JSON.stringify({
        artifactHashes: Object.fromEntries(
          Object.entries(names).map(([name, bytes]) => [name, hash(bytes)]),
        ),
      }),
    );
    await assert.rejects(assertCloudLibrarySafe(root), /local-only/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("private voice endpoints require a localhost session and same-origin requests", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "qwen-api-"));
  await writeFile(resolve(root, "review.html"), "studio");
  const { server, url } = await startPreviewServer(root, 0);
  const base = new URL(url).origin;
  try {
    assert.equal((await fetch(`${base}/api/local-voices`)).status, 400);
    const session = await fetch(`${base}/api/local-voices/session`);
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    assert.equal(
      (
        await fetch(`${base}/api/local-voices/session`, {
          headers: { origin: "https://elsewhere.example" },
        })
      ).status,
      400,
    );
    const denied = await fetch(`${base}/api/local-voices/enroll`, {
      method: "POST",
      headers: { cookie, origin: "https://elsewhere.example", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
test("profile revisions verify sample bytes, require audition acceptance, reject redirects and delete their enrollment data", {
  skip: spawnSync("ffmpeg", ["-version"]).status !== 0,
}, async () => {
  const root = await mkdtemp(resolve(tmpdir(), "qwen-profile-"));
  const pcm = Buffer.alloc(22050 * 4 * 2);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i * 0.03) * 3000), i * 2);
  const audio = encodePcmWav(pcm);
  try {
    await assert.rejects(
      createVoiceProfile(
        audio,
        { name: "Fixture", transcript: "A controlled audio fixture.", consent: false },
        root,
      ),
      /agreed/,
    );
    const result = await createVoiceProfile(
      audio,
      { name: "Fixture", transcript: "A controlled audio fixture.", consent: true, endSeconds: 4 },
      root,
    );
    await assert.rejects(readVoiceProfile(result.voice, { root }), /accept/);
    const saved = await readVoiceProfile(result.voice, { root, accepted: false });
    await writeFile(resolve(saved.directory, "audition.wav"), audio);
    await atomicJson(resolve(saved.directory, "audition.json"), {
      auditionHash: hash(audio),
      runtimeHash: "c".repeat(64),
    });
    assert.equal((await listVoiceProfiles(root))[0]?.audition?.sha256, hash(audio));
    await writeFile(resolve(saved.directory, "audition.wav"), "partial");
    assert.equal((await listVoiceProfiles(root))[0]?.audition, undefined);
    assert.equal((await listVoiceProfiles(root))[0]?.name, "Fixture");
    await writeFile(resolve(saved.directory, "audition.wav"), audio);
    await atomicJson(resolve(saved.directory, "accepted.json"), {
      auditionHash: hash(audio),
      runtimeHash: "c".repeat(64),
    });
    assert.equal((await listVoiceProfiles(root))[0]?.accepted, true);
    const replacement = await createVoiceProfile(
      audio,
      {
        name: "Renamed",
        transcript: "A different confirmed transcript.",
        consent: true,
        endSeconds: 4,
        profileId: result.voice.profileId,
      },
      root,
    );
    assert.notEqual(replacement.voice.revision, result.voice.revision);
    assert.equal((await readVoiceProfile(result.voice, { root })).profile.name, "Fixture");
    await rm(resolve(saved.directory, "sample.wav"));
    const outside = resolve(root, "outside.wav");
    await writeFile(outside, audio);
    await symlink(outside, resolve(saved.directory, "sample.wav"));
    await assert.rejects(readVoiceProfile(result.voice, { root }), /regular files/);
    assert.equal((await lstat(resolve(saved.directory, "sample.wav"))).isSymbolicLink(), true);
    await withModelLock(() => deleteVoiceProfile(replacement.voice, root), await realpath(root));
    await assert.rejects(profileDirectory(replacement.voice, root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud policy is rechecked against the frozen source before private runtime/profile resolution", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "qwen-frozen-"));
  const store = await MediaStore.open(resolve(root, "jobs.sqlite"));
  try {
    const episode = await clonedEpisode();
    const prepared = await prepareContentEpisode(episode, { preview: true, artifactRoot: root });
    await assert.rejects(
      createMediaJob(
        store,
        prepared.directory,
        new LocalVoicesProvider(store, root),
        await productionSettings(),
        "success",
        { execution: "cloud" },
      ),
      /local-only/,
    );
    assert.equal(store.list().length, 0);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("completed scene recovery rejects truncated receipts and changed audio while keeping intact scenes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "qwen-scenes-"));
  try {
    const episode = await clonedEpisode();
    const request = {
      schemaVersion: 2 as const,
      provider: "local-voices" as const,
      episode,
      voicePlan: [{ speakerId: "narrator", voice, runtimeHash: "c".repeat(64) }],
      generatorHash: "d".repeat(64),
      settings: await productionSettings(),
      scenario: "success" as const,
      sourceDirectory: root,
      sourceManifestHash: "e".repeat(64),
    };
    const scene = episode.scenes[0];
    assert.ok(scene);
    const wav = encodePcmWav(Buffer.alloc(22050 * 2 * 2));
    const phrases = splitNarration(scene.narration);
    const cues = phrases.map((text, index) => ({
      sceneId: scene.id,
      text,
      spokenText: pronounce(text, episode.pronunciation),
      startSeconds: (index * 2) / phrases.length,
      endSeconds: ((index + 1) * 2) / phrases.length,
    }));
    const receipt = {
      inputHash: localSceneIdentity(request, 0),
      wavHash: hash(wav),
      frames: 44100,
      cues,
    };
    await writeFile(resolve(root, "scene-0.wav"), wav);
    await writeFile(resolve(root, "scene-0.json"), JSON.stringify(receipt));
    assert.ok(await readLocalVoiceScene(request, 0, root));
    await writeFile(resolve(root, "scene-0.json"), '{"inputHash":');
    assert.equal(await readLocalVoiceScene(request, 0, root), null);
    await writeFile(resolve(root, "scene-0.json"), JSON.stringify(receipt));
    assert.ok(await readLocalVoiceScene(request, 0, root));
    await writeFile(resolve(root, "scene-0.wav"), Buffer.from("partial"));
    assert.equal(await readLocalVoiceScene(request, 0, root), null);
    assert.equal(
      JSON.parse(await readFile(resolve(root, "scene-0.json"), "utf8")).inputHash,
      receipt.inputHash,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
