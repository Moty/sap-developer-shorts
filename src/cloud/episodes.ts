import { readContentEpisode, validateEpisode } from "../contracts.js";
import type { ContentEpisode } from "../domain.js";
import { isNewsEpisode } from "../domain.js";
import { kokoroVoices } from "../media/voices.js";
import { validateNewsEpisode } from "../news/contracts.js";
import { fail, identifier, object, type RecordData } from "./contracts.js";

export const templateSelectors = [
  "CAP-01",
  "CAP-01@casual-v2",
  "CAP-01@duo",
  "CAP-02@quiz",
  "NEWS-02@myth-fact",
];
export async function publicTemplates() {
  return Promise.all(
    templateSelectors.map(async (selector) => ({
      selector,
      episode: await readContentEpisode(selector),
    })),
  );
}
export function workspaceSpeakers(episode: RecordData) {
  const presentation = object(episode.presentation);
  if (!Array.isArray(presentation.speakers))
    fail(400, "INVALID_SCRIPT", "Choose at least one presenter.");
  return presentation.speakers.map(object);
}
export function validateWorkspaceEpisode(
  value: unknown,
  tenantId: string,
  fresh = false,
): RecordData {
  const original = structuredClone(object(value));
  const candidate = structuredClone(original);
  const speakers = workspaceSpeakers(candidate);
  for (const speaker of speakers) {
    if (typeof speaker.voice === "string") {
      if (!kokoroVoices.some((voice) => voice.id === speaker.voice))
        fail(400, "INVALID_VOICE", "Choose a supported stock voice.");
    } else {
      const voice = object(speaker.voice);
      if (
        voice.kind !== "workspace-voice" ||
        voice.tenantId !== tenantId ||
        typeof voice.profileId !== "string" ||
        typeof voice.revision !== "string" ||
        !/^[a-f0-9]{64}$/u.test(voice.revision)
      )
        fail(
          400,
          "LOCAL_VOICE_PRIVATE",
          "Enroll a private workspace voice before remote production.",
        );
      identifier(voice.profileId);
      speaker.voice = { engine: "qwen", profileId: voice.profileId, revision: voice.revision };
      candidate.schemaVersion = 2;
    }
  }
  try {
    if (isNewsEpisode(candidate as unknown as ContentEpisode))
      validateNewsEpisode(candidate, { requireFresh: fresh });
    else validateEpisode(candidate);
  } catch (error) {
    fail(400, "INVALID_SCRIPT", (error as Error).message);
  }
  return original;
}
export function defaultPresentation(episode: ContentEpisode): RecordData {
  const copy = structuredClone(episode);
  if (!copy.presentation)
    copy.presentation = {
      variant: "workspace",
      tone: "casual",
      format: "explainer",
      humor: "none",
      speakers: [
        { id: "narrator", name: "Narrator", voice: "af_heart", avatar: { mode: "illustrated" } },
      ],
    } as NonNullable<ContentEpisode["presentation"]>;
  return copy as unknown as RecordData;
}
