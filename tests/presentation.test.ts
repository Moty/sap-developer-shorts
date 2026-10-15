import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { readContentEpisode, readEpisode, validateEpisode } from "../src/contracts.js";
import { pronounce, sampleRate, splitNarration } from "../src/media/audio.js";
import type { NarrationTiming } from "../src/media/model.js";
import { validateTiming } from "../src/media/package.js";
import { projectRoot } from "../src/paths.js";
import { episodeSelector, variantFile } from "../src/presentation.js";
import { applyPresentationVariant } from "../src/variants.js";

test("delivery variants inherit technical sources, checks, and visuals, and reject a changed base or structural overrides", async () => {
  const base = await readEpisode("CAP-01");
  const file = JSON.parse(
    await readFile(resolve(projectRoot, variantFile("CAP-01@comic")), "utf8"),
  );
  const version = applyPresentationVariant(base, file);
  assert.deepEqual(version.claims, base.claims);
  assert.deepEqual(version.sources, base.sources);
  assert.ok("demo" in version);
  assert.deepEqual(version.demo, base.demo);
  assert.deepEqual(
    version.scenes.map((scene) => scene.visual),
    base.scenes.map((scene) => scene.visual),
  );
  assert.equal(episodeSelector(version), "CAP-01@comic");
  const edited = structuredClone(base);
  edited.version++;
  assert.throws(() => applyPresentationVariant(edited, file), /base changed/);
  const invalid = structuredClone(file);
  invalid.scenes[0].visual = { kind: "presenter", label: "Discard the demo" };
  assert.throws(() => applyPresentationVariant(base, invalid), /cannot change/);
});

test("dialogue rejects missing, unknown, duplicate-voice, and text-mismatched speakers", async () => {
  const value = await readContentEpisode("CAP-01@duo");
  assert.ok("demo" in value && value.presentation && value.scenes[0]?.dialogue?.[0]);
  validateEpisode(value);
  const missing = structuredClone(value);
  delete missing.scenes[0]?.dialogue;
  assert.throws(() => validateEpisode(missing), /needs speaker turns/);
  const unknown = structuredClone(value);
  const turn = unknown.scenes[0]?.dialogue?.[0];
  assert.ok(turn);
  turn.speakerId = "undeclared";
  assert.throws(() => validateEpisode(unknown), /Unknown dialogue speaker/);
  turn.speakerId = "mira";
  turn.text = "Not the approved narration.";
  assert.throws(() => validateEpisode(unknown), /exactly cover narration/);
  const duplicate = structuredClone(value);
  const other = duplicate.presentation?.speakers[1];
  assert.ok(other);
  other.voice = "af_heart";
  assert.throws(() => validateEpisode(duplicate), /two distinct Kokoro voices/);
});

test("speaker captions are bound to the exact dialogue turns rather than only their combined text", async () => {
  const episode = await readContentEpisode("CAP-01@duo");
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    engine: "kokoro",
    alignment: "model-estimated-phrase-boundaries",
    speed: 0.96,
    voice: "af_heart",
    rate: 180,
    durationSeconds: episode.targetDurationSeconds,
    sampleRate,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      speechSeconds: scene.endSeconds - scene.startSeconds,
    })),
    cues: episode.scenes.flatMap((scene) => {
      const phrases =
        scene.dialogue?.flatMap((turn) =>
          splitNarration(turn.text).map((text) => ({
            text,
            speaker: episode.presentation?.speakers.find(
              (speaker) => speaker.id === turn.speakerId,
            ),
          })),
        ) ?? [];
      return phrases.map((phrase, index) => ({
        sceneId: scene.id,
        text: phrase.text,
        spokenText: pronounce(phrase.text, episode.pronunciation),
        speakerId: phrase.speaker?.id ?? "",
        speakerName: phrase.speaker?.name ?? "",
        startSeconds:
          scene.startSeconds + ((scene.endSeconds - scene.startSeconds) * index) / phrases.length,
        endSeconds:
          scene.startSeconds +
          ((scene.endSeconds - scene.startSeconds) * (index + 1)) / phrases.length,
      }));
    }),
  };
  validateTiming(timing, episode, sampleRate * episode.targetDurationSeconds);
  const cue = timing.cues[0];
  assert.ok(cue);
  cue.speakerId = "max";
  assert.throws(
    () => validateTiming(timing, episode, sampleRate * episode.targetDurationSeconds),
    /declared speaker turns/,
  );
  delete cue.speakerId;
  delete cue.speakerName;
  assert.throws(
    () => validateTiming(timing, episode, sampleRate * episode.targetDurationSeconds),
    /declared speaker turns/,
  );
});
