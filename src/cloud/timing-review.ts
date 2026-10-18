/** Recognize the existing worker diagnostic, including jobs saved by older builds. */
export function narrationTimingReview(issue: unknown) {
  if (typeof issue !== "string") return null;
  const match =
    /^Narration measured (\d+(?:\.\d+)?)s; opening (\d+(?:\.\d+)?)s\. Aim for 45–60s total and at most 3s for the opening\./u.exec(
      issue,
    );
  if (!match) return null;
  const durationSeconds = Number(match[1]),
    hookSeconds = Number(match[2]);
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(hookSeconds)) return null;
  return {
    durationSeconds,
    hookSeconds,
    hookTooLong: hookSeconds > 3,
    totalWithinRange: durationSeconds >= 45 && durationSeconds <= 60,
  };
}
