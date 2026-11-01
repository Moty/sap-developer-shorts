import type { NewsEpisode, Presentation } from "../domain.js";
import { kokoroVoices } from "../media/voices.js";
import { presentationFormats } from "../presentation.js";
import { validateNewsEpisode } from "./contracts.js";

export interface NewShortDelivery {
  format: Presentation["format"];
  tone: Presentation["tone"];
  targetDurationSeconds: number;
  narrator: string;
  secondaryNarrator?: string;
}

/** Validate the entire optional delivery before fetching a story or writing a draft. */
export function parseNewShortDelivery(
  value: unknown,
  availableStockIds: readonly string[],
  defaultNarrator = "af_heart",
): NewShortDelivery | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose valid delivery settings for the new short.");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        !["format", "tone", "targetDurationSeconds", "narrator", "secondaryNarrator"].includes(key),
    ) ||
    !presentationFormats.some((format) => format.id === data.format) ||
    !["professional", "casual", "comic"].includes(String(data.tone)) ||
    typeof data.targetDurationSeconds !== "number" ||
    !Number.isFinite(data.targetDurationSeconds) ||
    data.targetDurationSeconds < 15 ||
    data.targetDurationSeconds > 90
  )
    throw new Error("Choose a supported format, tone and target length from 15 to 90 seconds.");
  const available = (voice: unknown): voice is string =>
    typeof voice === "string" &&
    availableStockIds.includes(voice) &&
    kokoroVoices.some((item) => item.id === voice);
  const useDefault = data.narrator === undefined || data.narrator === "default";
  const narrator = useDefault ? defaultNarrator : data.narrator;
  if (
    typeof narrator !== "string" ||
    !kokoroVoices.some((voice) => voice.id === narrator) ||
    ((!useDefault || data.format === "dialogue") && !available(narrator))
  )
    throw new Error(
      "Choose an installed stock narrator. Personal voices can be selected in the editor.",
    );
  if (
    data.format === "dialogue" &&
    (!available(data.secondaryNarrator) || data.secondaryNarrator === narrator)
  )
    throw new Error("A conversation needs two distinct installed narrators.");
  if (data.format !== "dialogue" && data.secondaryNarrator !== undefined)
    throw new Error("A second narrator is only used for a two-person conversation.");
  return {
    format: data.format as Presentation["format"],
    tone: data.tone as Presentation["tone"],
    targetDurationSeconds: data.targetDurationSeconds,
    narrator,
    ...(data.format === "dialogue" ? { secondaryNarrator: data.secondaryNarrator as string } : {}),
  };
}

/** Delivery metadata and provisional timing only: never rewrite narration, claims or evidence. */
export function applyNewShortDelivery(
  episode: NewsEpisode,
  delivery: NewShortDelivery,
): NewsEpisode {
  const draft = structuredClone(episode);
  const originalDuration = episode.targetDurationSeconds;
  const conversation = delivery.format === "dialogue";
  draft.targetDurationSeconds = delivery.targetDurationSeconds;
  draft.presentation = {
    format: delivery.format,
    tone: delivery.tone,
    humor: "none",
    speakers: conversation
      ? [
          { id: "host", name: "Host", voice: delivery.narrator },
          { id: "colleague", name: "Colleague", voice: delivery.secondaryNarrator as string },
        ]
      : [{ id: "narrator", name: "Narrator", voice: delivery.narrator }],
  };
  for (const [index, scene] of draft.scenes.entries()) {
    const scale = (seconds: number) =>
      Math.round((seconds / originalDuration) * delivery.targetDurationSeconds * 1000) / 1000;
    scene.startSeconds = scale(scene.startSeconds);
    scene.endSeconds = scale(scene.endSeconds);
    if (conversation)
      scene.dialogue = [{ speakerId: index % 2 ? "colleague" : "host", text: scene.narration }];
  }
  return validateNewsEpisode(draft);
}
