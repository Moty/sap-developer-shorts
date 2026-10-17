import type { ContentEpisode } from "../domain.js";
import { supportsKokoroVoice } from "./voices.js";

export interface ClonedVoice {
  engine: "qwen";
  profileId: string;
  revision: string;
}
export type VoiceReference = string | ClonedVoice;
export function isClonedVoice(value: unknown): value is ClonedVoice {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === "engine,profileId,revision" &&
    (value as ClonedVoice).engine === "qwen" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      (value as ClonedVoice).profileId,
    ) &&
    /^[a-f0-9]{64}$/u.test((value as ClonedVoice).revision)
  );
}
export function assertVoiceReference(value: unknown): asserts value is VoiceReference {
  if (!(typeof value === "string" && supportsKokoroVoice(value)) && !isClonedVoice(value))
    throw new Error("Choose a supported stock voice or a valid local voice profile.");
}
export function voiceKey(value: VoiceReference): string {
  return typeof value === "string" ? value : `qwen:${value.profileId}:${value.revision}`;
}
export function voiceIdentity(value: VoiceReference): string {
  return typeof value === "string" ? value : `qwen:${value.profileId}`;
}
export function voiceLabel(value: VoiceReference): string {
  return typeof value === "string" ? value : "My voice (Qwen)";
}
export function hasClonedVoices(episode: ContentEpisode): boolean {
  return episode.presentation?.speakers.some((speaker) => isClonedVoice(speaker.voice)) ?? false;
}
export function assertCloudVoiceAllowed(episode: ContentEpisode): void {
  if (hasClonedVoices(episode))
    throw new Error("This voice version is local-only. Open the studio on its Mac.");
}
