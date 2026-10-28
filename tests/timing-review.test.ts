import assert from "node:assert/strict";
import test from "node:test";
import { narrationTimingReview } from "../src/cloud/timing-review.js";

const diagnostic = (total: string, hook: string) =>
  `Narration measured ${total}s; opening ${hook}s. Aim for 45–60s total and at most 3s for the opening. Revise the spoken script, save, and produce again.`;
test("existing narration diagnostics distinguish an overlong opening from overall timing", () => {
  assert.deepEqual(narrationTimingReview(diagnostic("51.0", "3.4")), {
    durationSeconds: 51,
    hookSeconds: 3.4,
    hookTooLong: true,
    totalWithinRange: true,
    canRetryWithoutEdit: true,
  });
  assert.deepEqual(narrationTimingReview(diagnostic("43.6", "1.0")), {
    durationSeconds: 43.6,
    hookSeconds: 1,
    hookTooLong: false,
    totalWithinRange: true,
    canRetryWithoutEdit: true,
  });
});
test("unrelated failures and incomplete or invalid diagnostics keep normal retry behavior", () => {
  for (const issue of [
    null,
    "Rendering failed. Check models.",
    "Narration measured 51s",
    diagnostic("NaN", "3.4"),
    diagnostic("Infinity", "3.4"),
  ])
    assert.equal(narrationTimingReview(issue), null);
});
