import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { updateCreatorRecord } from "./creator-store.js";
import { hash } from "./digest.js";
import type { ContentEpisode } from "./domain.js";
import { resolveAvatarPath } from "./media/avatar.js";
import { type PresentationDefinition, validatePresentationDefinition } from "./variants.js";

type Presentation = NonNullable<ContentEpisode["presentation"]>;
export interface ProductionPreset {
  id: string;
  name: string;
  updatedAt: string;
  settings: {
    tone: Presentation["tone"];
    format: Presentation["format"];
    humor: Presentation["humor"];
    speakers: Pick<Presentation["speakers"][number], "voice" | "avatar">[];
    targetSeconds: number;
    pronunciation: Record<string, string>;
    design?: Pick<NonNullable<Presentation["design"]>, "theme" | "motion">;
  };
}
export async function presetFromDefinition(
  name: unknown,
  value: unknown,
): Promise<ProductionPreset> {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 60 ||
    /[<>\p{Cc}]/u.test(name)
  )
    throw new Error("Use a short plain preset name.");
  const { definition, episode } = await validatePresentationDefinition(value);
  const presentation = definition.presentation;
  return {
    id: randomUUID(),
    name: name.trim(),
    updatedAt: new Date().toISOString(),
    settings: {
      tone: presentation.tone,
      format: presentation.format,
      humor: presentation.humor,
      speakers: presentation.speakers.map(({ voice, avatar }) => ({
        voice: structuredClone(voice),
        ...(avatar ? { avatar: structuredClone(avatar) } : {}),
      })),
      targetSeconds: Math.round(
        definition.plannedDurationSeconds ??
          presentation.brief?.targetSeconds ??
          episode.targetDurationSeconds,
      ),
      pronunciation: structuredClone(episode.pronunciation),
      ...(presentation.design
        ? { design: { theme: presentation.design.theme, motion: presentation.design.motion } }
        : {}),
    },
  };
}
export async function saveProductionPreset(root: string, name: unknown, value: unknown) {
  const preset = await presetFromDefinition(name, value);
  return updateCreatorRecord(root, "presets", (previous) => {
    const presets = (Array.isArray(previous) ? previous : []) as ProductionPreset[];
    const existing = presets.find((item) => item.name.toLowerCase() === preset.name.toLowerCase());
    if (existing) preset.id = existing.id;
    if (!existing && presets.length >= 40)
      throw new Error("Use an existing name to update one of your 40 presets.");
    return [...presets.filter((item) => item.id !== preset.id), preset];
  });
}
export async function applyProductionPreset(preset: ProductionPreset, value: unknown) {
  const { definition } = await validatePresentationDefinition(value);
  const settings = preset.settings;
  if (settings.speakers.length !== definition.presentation.speakers.length)
    throw new Error(
      "This preset needs a different number of presenters. Start with a matching format.",
    );
  const draft: PresentationDefinition = structuredClone(definition);
  draft.presentation.tone = settings.tone;
  draft.presentation.format = settings.format;
  draft.presentation.humor = settings.humor;
  draft.presentation.speakers = draft.presentation.speakers.map((speaker, index) => ({
    ...speaker,
    voice: structuredClone(settings.speakers[index]?.voice ?? speaker.voice),
    avatar: structuredClone(settings.speakers[index]?.avatar ?? { mode: "illustrated" }),
  }));
  if (draft.presentation.speakers.some((speaker) => typeof speaker.voice !== "string"))
    draft.schemaVersion = 2;
  draft.plannedDurationSeconds = settings.targetSeconds;
  if (draft.presentation.brief) draft.presentation.brief.targetSeconds = settings.targetSeconds;
  draft.pronunciation = { ...draft.pronunciation, ...settings.pronunciation };
  if (settings.design)
    draft.presentation.design = {
      schemaVersion: 1,
      ...settings.design,
      scenes:
        draft.presentation.design?.scenes ??
        draft.scenes.map((scene) => ({
          id: scene.id,
          headline: (scene.overlay ?? scene.id).slice(0, 84),
          emphasis: "balanced",
        })),
    };
  const validated = (await validatePresentationDefinition(draft)).definition;
  for (const speaker of validated.presentation.speakers) {
    if (speaker.avatar?.mode === "photo") {
      try {
        const image = await readFile(await resolveAvatarPath(speaker.avatar.imageId ?? ""));
        if (speaker.avatar.calibration && hash(image) !== speaker.avatar.calibration.imageSha256)
          throw new Error("Photo changed since calibration.");
      } catch {
        throw new Error(
          "A preset photo is missing or changed. Restore it and recalibrate it before applying.",
        );
      }
    }
  }
  return validated;
}

/** Recheck mutable voice assets at Apply time, rather than trusting a saved UI catalog. */
export async function assertPresetVoiceAssets(
  definition: PresentationDefinition,
  checks?: { stock(): Promise<string[]>; personal(episode: ContentEpisode): Promise<unknown> },
) {
  const { episode } = await validatePresentationDefinition(definition);
  const stock = checks?.stock ?? (await import("./media/voice-assets.js")).verifiedKokoroVoices;
  const personal = checks?.personal ?? (await import("./media/local-voices.js")).resolveVoicePlan;
  const available = await stock();
  if (
    episode.presentation?.speakers.some(
      (speaker) => typeof speaker.voice === "string" && !available.includes(speaker.voice),
    )
  )
    throw new Error(
      "A preset voice is no longer installed. Restore it before applying this preset.",
    );
  if (episode.presentation?.speakers.some((speaker) => typeof speaker.voice !== "string"))
    await personal(episode);
}
