import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { voiceStyleRecording } from "../voice-styles.js";
import { atomicJson, profileDirectory } from "./voice-profiles.js";
import type { ClonedVoice } from "./voice-reference.js";

/** Optional library labels are separate from the immutable audio and approval identity. */
export async function saveVoiceStyleMetadata(
  voice: ClonedVoice,
  speaker: unknown,
  style: unknown,
  root?: string,
) {
  const labels = voiceStyleRecording(speaker, style);
  const directory = await profileDirectory(voice, root);
  await atomicJson(resolve(directory, "library.json"), { schemaVersion: 1, voice, ...labels });
  return labels;
}

export async function readVoiceStyleMetadata(voice: ClonedVoice, root?: string) {
  try {
    const directory = await profileDirectory(voice, root);
    const path = resolve(directory, "library.json");
    if (!(await lstat(path)).isFile() || (await realpath(path)) !== path) return null;
    const metadata = JSON.parse(await readFile(path, "utf8"));
    if (
      metadata.schemaVersion !== 1 ||
      metadata.voice?.profileId !== voice.profileId ||
      metadata.voice?.revision !== voice.revision
    )
      return null;
    return voiceStyleRecording(metadata.speakerName, metadata.style);
  } catch {
    // Older recordings have no style label. They remain available unchanged.
    return null;
  }
}
