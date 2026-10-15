import assert from "node:assert/strict";
import test from "node:test";
import { assertVideoQuality } from "../src/video/receipt.js";

test("receipt quality requires actual successful flags and preserves the existing duration tolerance", () => {
  const quality = { decoded: true, audioChecked: true, durationSeconds: 55 };
  for (const durationSeconds of [45, 55, 60, 60.1])
    assert.doesNotThrow(() => assertVideoQuality({ ...quality, durationSeconds }));
  assert.doesNotThrow(() => assertVideoQuality({ ...quality, durationSeconds: 55.1 }, 55));
  for (const invalid of [
    null,
    {},
    { ...quality, decoded: "false" },
    { ...quality, audioChecked: "true" },
    { ...quality, durationSeconds: NaN },
    { ...quality, durationSeconds: Infinity },
    { ...quality, durationSeconds: 44.999 },
    { ...quality, durationSeconds: 60.101 },
  ])
    assert.throws(() => assertVideoQuality(invalid), /quality metadata/);
  assert.throws(() => assertVideoQuality(quality, 55.101), /selected narration duration/);
  assert.throws(() => assertVideoQuality(quality, NaN), /selected narration duration/);
});
