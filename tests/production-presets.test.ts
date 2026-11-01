import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { readCreatorRecord } from "../src/creator-store.js";
import {
  applyProductionPreset,
  assertPresetVoiceAssets,
  presetFromDefinition,
  saveProductionPreset,
} from "../src/production-presets.js";
import { scriptEditorSeed } from "../src/script-editor.js";
import { applyPresentationVariant } from "../src/variants.js";

test("presets persist preferences and apply without replacing story or evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "short-presets-"));
  try {
    const base = await readContentEpisode("CAP-01");
    const source = await scriptEditorSeed(base);
    source.presentation.tone = "casual";
    source.presentation.speakers[0] = { id: "narrator", name: "Narrator", voice: "am_michael" };
    source.plannedDurationSeconds = 65;
    source.pronunciation = { CAP: "cap" };
    const preset = await presetFromDefinition("My explainer", source);
    assert.equal("scenes" in preset.settings, false);
    assert.equal("sources" in preset.settings, false);
    const target = await scriptEditorSeed(base);
    target.title = "Keep this title";
    target.scenes[0] = {
      ...target.scenes[0],
      id: base.scenes[0]?.id ?? "hook",
      narration: "Keep my exact narration.",
    };
    const applied = await applyProductionPreset(preset, target);
    assert.equal(applied.title, target.title);
    assert.deepEqual(applied.scenes, target.scenes);
    assert.equal(applied.presentation.speakers[0]?.voice, "am_michael");
    await assert.rejects(
      () =>
        assertPresetVoiceAssets(applied, {
          stock: async () => ["af_heart"],
          personal: async () => {},
        }),
      /no longer installed/,
    );
    await assert.doesNotReject(() =>
      assertPresetVoiceAssets(applied, {
        stock: async () => ["am_michael"],
        personal: async () => {},
      }),
    );
    const episode = applyPresentationVariant(base, applied);
    assert.equal(episode.targetDurationSeconds, 65);
    assert.equal(episode.scenes.at(-1)?.endSeconds, 65);
    assert.deepEqual(episode.sources, base.sources);
    assert.deepEqual(episode.claims, base.claims);
    assert.equal(episode.scenes[1]?.startSeconds, episode.scenes[0]?.endSeconds);
    await Promise.all([
      saveProductionPreset(root, "First", source),
      saveProductionPreset(root, "Second", source),
    ]);
    assert.equal(((await readCreatorRecord(root, "presets")) as unknown[]).length, 2);
    await saveProductionPreset(root, "first", target);
    assert.equal(((await readCreatorRecord(root, "presets")) as unknown[]).length, 2);
    const wrong = structuredClone(preset);
    wrong.settings.speakers.push({ voice: "af_heart" });
    await assert.rejects(() => applyProductionPreset(wrong, target), /different number/);
    const missingPhoto = structuredClone(preset);
    assert.ok(missingPhoto.settings.speakers[0]);
    missingPhoto.settings.speakers[0].avatar = {
      mode: "photo",
      imageId: "missing-preset-photo.png",
    };
    await assert.rejects(() => applyProductionPreset(missingPhoto, target), /photo is missing/);
    await assert.rejects(() => presetFromDefinition("<script>", source), /preset name/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
