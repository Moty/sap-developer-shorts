import type { ContentEpisode } from "../domain.js";
import { readVoiceProfile } from "./voice-profiles.js";
import { isClonedVoice, type VoiceReference } from "./voice-reference.js";
import { kokoroVoices } from "./voices.js";

// Display metadata only. Never substitutes a voice or changes its acoustic identity.
export async function voiceDisplayName(voice: VoiceReference): Promise<string> {
  if (!isClonedVoice(voice)) return kokoroVoices.find((item) => item.id === voice)?.name ?? voice;
  try {
    return `${(await readVoiceProfile(voice, { accepted: false })).profile.name} (Qwen)`;
  } catch {
    return "Saved personal voice (Qwen; profile unavailable)";
  }
}

export async function episodeVoiceDescription(episode: ContentEpisode): Promise<string> {
  return (
    await Promise.all(
      (episode.presentation?.speakers ?? []).map(
        async (speaker) => `${speaker.name}: ${await voiceDisplayName(speaker.voice)}`,
      ),
    )
  ).join(" · ");
}
