import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ContentEpisode } from "./domain.js";
import { assertVoiceReference, isClonedVoice, voiceIdentity } from "./media/voice-reference.js";
import { projectRoot } from "./paths.js";
import { parsePresentationDesign, sceneSupportsCharts } from "./presentation-design.js";
import { parseStoryBrief } from "./story-brief.js";

export const presentationFormats = [
  {
    id: "explainer",
    name: "Clear explainer",
    description: "One useful idea, a working example, and a practical takeaway.",
  },
  {
    id: "dialogue",
    name: "Two-person conversation",
    description: "A curious developer and a helpful colleague, with two distinct voices.",
  },
  {
    id: "myth-fact",
    name: "Myth vs fact",
    description: "Open with a misconception, then demonstrate what actually happens.",
  },
  {
    id: "countdown",
    name: "Three quick takeaways",
    description: "A numbered roundup with a short payoff for each point.",
  },
  {
    id: "story",
    name: "Problem to solution",
    description: "Start with a familiar developer problem and show the turning point.",
  },
  {
    id: "quiz",
    name: "Quick challenge",
    description: "Ask viewers to predict a result, then reveal the verified answer.",
  },
];
export const toneLabels = { professional: "Professional", casual: "Casual", comic: "Comic" };
export const humorLabels = { none: "No jokes", light: "Light humor", "sap-geek": "SAP geek humor" };

export function episodeSelector(episode: ContentEpisode): string {
  return episode.presentation?.variant
    ? `${episode.id}@${episode.presentation.variant}`
    : episode.id;
}

export function variantFile(selector: string): string {
  if (!/^(ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}@[a-z][a-z0-9-]{0,31}$/u.test(selector))
    throw new Error("Invalid presentation variant selector");
  return `content/presentations/${selector.replace("@", "--")}.json`;
}

export function episodeSourceFiles(episode: ContentEpisode): string[] {
  const defaultPath = `content/episodes/${episode.id}.json`;
  const draftPath = `content/drafts/${episode.id}.json`;
  const episodePath = existsSync(resolve(projectRoot, defaultPath))
    ? defaultPath
    : existsSync(resolve(projectRoot, draftPath))
      ? draftPath
      : defaultPath;

  return [
    episodePath,
    ...(episode.presentation?.variant ? [variantFile(episodeSelector(episode))] : []),
  ];
}

export function presentationLabel(episode: ContentEpisode): string {
  const value = episode.presentation;
  if (!value) return "Professional · Clear explainer";
  return `${toneLabels[value.tone]} · ${presentationFormats.find((format) => format.id === value.format)?.name}${value.humor !== "none" ? ` · ${humorLabels[value.humor]}` : ""}`;
}

export function assertPresentation(episode: ContentEpisode): void {
  const value = episode.presentation;
  if (!value) {
    if (episode.scenes.some((scene) => scene.dialogue))
      throw new Error("Dialogue needs a presentation and declared speakers");
    return;
  }
  const count = value.format === "dialogue" ? 2 : 1;
  if (value.brief !== undefined) parseStoryBrief(value.brief);
  if (value.design !== undefined)
    parsePresentationDesign(
      value.design,
      episode.scenes.map((scene) => scene.id),
      episode.claims.map((claim) => claim.id),
    );
  for (const [index, direction] of (value.design?.scenes ?? []).entries())
    if (direction.composition && episode.scenes[index]?.visual.kind !== "presenter")
      throw new Error(
        "Use custom visual compositions on presenter/explanation scenes; verified code, result and news cards retain their evidence layout.",
      );
  for (const [index, direction] of (value.design?.scenes ?? []).entries()) {
    const kind = episode.scenes[index]?.visual.kind;
    if (
      direction.dataView &&
      !sceneSupportsCharts(episode.scenes[index] as ContentEpisode["scenes"][number])
    )
      throw new Error("Charts use captured product/stock rows; choose a captured output scene.");
    if (direction.image?.treatment === "card" && kind !== "presenter")
      throw new Error(
        "Framed illustrations belong on explanation scenes; code and source cards retain their evidence.",
      );
  }
  if (
    value.speakers.length !== count ||
    new Set(value.speakers.map((speaker) => speaker.id)).size !== count
  )
    throw new Error(`This presentation needs ${count} unique speaker IDs`);
  for (const speaker of value.speakers) {
    assertVoiceReference(speaker.voice);
    if (isClonedVoice(speaker.voice) && episode.schemaVersion !== 2)
      throw new Error("Cloned voice definitions require schemaVersion 2.");
    if (speaker.avatar?.mode === "photo" && !speaker.avatar.imageId)
      throw new Error(`Photo avatar mode requires an imageId for speaker ${speaker.id}`);
  }
  if (
    count === 2 &&
    new Set(value.speakers.map((speaker) => voiceIdentity(speaker.voice))).size !== 2
  )
    throw new Error(
      value.speakers.some((speaker) => isClonedVoice(speaker.voice))
        ? "Two-person dialogue needs two distinct voices"
        : "Two-person dialogue needs two distinct Kokoro voices",
    );
  const used = new Set<string>();
  for (const scene of episode.scenes) {
    if (count === 1 && scene.dialogue)
      throw new Error("Solo formats cannot contain dialogue turns");
    if (count === 2) {
      if (!scene.dialogue?.length)
        throw new Error(`Dialogue scene ${scene.id} needs speaker turns`);
      if (scene.dialogue.map((turn) => turn.text.trim()).join(" ") !== scene.narration.trim())
        throw new Error(`Dialogue text must exactly cover narration in ${scene.id}`);
      for (const turn of scene.dialogue) {
        if (!value.speakers.some((speaker) => speaker.id === turn.speakerId))
          throw new Error(`Unknown dialogue speaker: ${turn.speakerId}`);
        used.add(turn.speakerId);
      }
    }
  }
  if (count === 2 && used.size !== 2) throw new Error("Both speakers must have spoken turns");
}
