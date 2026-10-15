import type { LibraryEntry } from "./library.js";
import type { NarrationTiming } from "./media/model.js";
import { kokoroVoices } from "./media/voices.js";
import { episodeSelector, presentationLabel, toneLabels } from "./presentation.js";

export const capComparisonSelectors: readonly string[] = [
  "CAP-01",
  "CAP-01@casual",
  "CAP-01@comic",
  "CAP-01@duo",
];

export function studioReadiness(entry: LibraryEntry) {
  if (entry.sourceReviewExpired)
    return {
      label: entry.video
        ? "Saved export · sources need rechecking"
        : "Saved preview · sources need rechecking",
      attention: true,
    };
  if (entry.preview?.kind === "narrated" && !entry.preview.timingReady)
    return { label: "Timing needs review", attention: true };
  if (entry.video) return { label: "MP4 ready", attention: false };
  if (entry.preview?.kind === "narrated")
    return { label: "Narration ready · MP4 pending", attention: false };
  return { label: "No recording yet", attention: false };
}

export function recordedNarrator(entry: LibraryEntry): string {
  if (entry.preview?.kind !== "narrated") return "No recorded voice yet";
  const timing = JSON.parse(
    entry.preview.files["timing.json"]?.toString("utf8") ?? "null",
  ) as NarrationTiming;
  if (!timing?.voice) throw new Error("Recorded narration is missing its voice metadata");
  if (timing.engine !== "kokoro") return `System voice · ${timing.voice}`;
  const name = (voice: string) => kokoroVoices.find((item) => item.id === voice)?.name ?? voice;
  const speakers = entry.episode.presentation?.speakers;
  if (entry.episode.presentation?.format === "dialogue" && speakers)
    return `Kokoro · ${speakers.map((speaker, index) => `${speaker.name} (${name(index === 0 ? timing.voice : speaker.voice)})`).join(" + ")}`;
  return `Kokoro · ${name(timing.voice)}`;
}

export function comparisonId(entry: LibraryEntry): string {
  return `compare-${episodeSelector(entry.episode).replace("@", "--")}`;
}

export function comparisonLabel(entry: LibraryEntry): string {
  const value = entry.episode.presentation;
  if (value?.format === "dialogue") return "Conversation";
  if (!value || value.format === "explainer") return toneLabels[value?.tone ?? "professional"];
  return presentationLabel(entry.episode);
}

export function studioReturnFragment(entry: LibraryEntry): string {
  return capComparisonSelectors.includes(episodeSelector(entry.episode))
    ? `#${comparisonId(entry)}`
    : "#episodes";
}
