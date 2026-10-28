/** Studio editorial policy, not a claim about every platform's upload limits. */
export const shortTiming = {
  minimum: 15,
  maximum: 90,
  recommendedMinimum: 45,
  recommendedMaximum: 60,
  recommendedHook: 3,
} as const;

export function shortDurationAllowed(seconds: number, tolerance = 0) {
  return (
    Number.isFinite(seconds) &&
    seconds >= shortTiming.minimum &&
    seconds <= shortTiming.maximum + tolerance
  );
}

export function timingGuidance(seconds: number, hookSeconds: number) {
  const notes: string[] = [];
  if (seconds < shortTiming.recommendedMinimum || seconds > shortTiming.recommendedMaximum)
    notes.push("45–60 seconds is the recommended target; 15–90 seconds is accepted.");
  if (hookSeconds > shortTiming.recommendedHook)
    notes.push(
      "A shorter opening may hold attention better; three seconds is a guide, not a production limit.",
    );
  return notes;
}
