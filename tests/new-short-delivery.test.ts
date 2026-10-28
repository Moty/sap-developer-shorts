import assert from "node:assert/strict";
import test from "node:test";
import { readNewsEpisode } from "../src/news/contracts.js";
import { applyNewShortDelivery, parseNewShortDelivery } from "../src/news/new-short-delivery.js";
import { assertPresentation, presentationFormats } from "../src/presentation.js";

const voices = ["af_heart", "am_michael"];
const choice = {
  format: "explainer",
  tone: "casual",
  targetDurationSeconds: 45,
  narrator: "af_heart",
};

test("new-short delivery rejects unsupported or unavailable choices before story creation", () => {
  assert.equal(parseNewShortDelivery(undefined, []), undefined);
  assert.deepEqual(parseNewShortDelivery(choice, voices), choice);
  for (const invalid of [
    null,
    [],
    { ...choice, format: "invented" },
    { ...choice, tone: "invented" },
    { ...choice, targetDurationSeconds: 14 },
    { ...choice, targetDurationSeconds: 91 },
    { ...choice, targetDurationSeconds: Number.NaN },
    { ...choice, targetDurationSeconds: "45" },
    { ...choice, narrator: "bf_emma" },
    { ...choice, narrator: { engine: "qwen" } },
    { ...choice, unexpected: true },
    { ...choice, secondaryNarrator: "am_michael" },
    { ...choice, format: "dialogue" },
    { ...choice, format: "dialogue", secondaryNarrator: "af_heart" },
  ])
    assert.throws(() => parseNewShortDelivery(invalid, voices));
  assert.throws(() => parseNewShortDelivery(choice, []), /installed stock narrator/u);
});

test("default or deferred solo narration allows drafting before stock assets are installed", () => {
  assert.deepEqual(parseNewShortDelivery({ ...choice, narrator: "default" }, []), choice);
  const deferred = { format: "explainer", tone: "casual", targetDurationSeconds: 45 };
  assert.deepEqual(parseNewShortDelivery(deferred, []), choice);
  assert.deepEqual(parseNewShortDelivery(deferred, [], "am_michael"), {
    ...choice,
    narrator: "am_michael",
  });
  assert.throws(() => parseNewShortDelivery({ ...choice, narrator: "am_michael" }, []));
  assert.throws(() =>
    parseNewShortDelivery({ ...deferred, format: "dialogue", secondaryNarrator: "am_michael" }, []),
  );
});

test("every supported format retains complete source facts and spoken text at both timing limits", async () => {
  const original = await readNewsEpisode("NEWS-01");
  const before = structuredClone(original);
  for (const format of presentationFormats)
    for (const targetDurationSeconds of [15, 45, 90]) {
      const delivery = parseNewShortDelivery(
        {
          ...choice,
          format: format.id,
          targetDurationSeconds,
          ...(format.id === "dialogue" ? { secondaryNarrator: "am_michael" } : {}),
        },
        voices,
      );
      assert.ok(delivery);
      const draft = applyNewShortDelivery(original, delivery);
      assert.equal(draft.targetDurationSeconds, targetDurationSeconds);
      assert.equal(draft.presentation?.format, format.id);
      assert.equal(draft.presentation?.tone, "casual");
      assert.equal(draft.presentation?.speakers[0]?.voice, "af_heart");
      assert.deepEqual(draft.claims, original.claims);
      assert.deepEqual(draft.sources, original.sources);
      assert.deepEqual(draft.news, original.news);
      assert.deepEqual(draft.publication, original.publication);
      let end = 0;
      for (const [index, scene] of draft.scenes.entries()) {
        const source = original.scenes[index];
        assert.ok(source);
        assert.equal(scene.narration, source.narration);
        assert.equal(scene.overlay, source.overlay);
        assert.deepEqual(scene.claimIds, source.claimIds);
        assert.deepEqual(scene.visual, source.visual);
        assert.equal(scene.startSeconds, end);
        assert.ok(scene.endSeconds > scene.startSeconds);
        end = scene.endSeconds;
        if (format.id === "dialogue") assert.equal(scene.dialogue?.[0]?.text, source.narration);
      }
      assert.equal(end, targetDurationSeconds);
      assert.doesNotThrow(() => assertPresentation(draft));
    }
  assert.deepEqual(original, before, "the source episode remains unchanged");
});
