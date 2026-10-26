/** Labels describe the user's recorded delivery; they do not transform an existing sample. */
export const voiceStyles = [
  { id: "conversational", label: "Conversational", readingScript: "conversational" },
  { id: "professional", label: "Professional", readingScript: "professional" },
  { id: "calm", label: "Calm", readingScript: "calm" },
  { id: "comic", label: "Comic", readingScript: "comic" },
  { id: "upbeat", label: "Upbeat", readingScript: "upbeat" },
  { id: "sad", label: "Sad / reflective", readingScript: "sad" },
  { id: "casual", label: "Casual", readingScript: "story" },
  { id: "news", label: "News presenter", readingScript: "news" },
] as const;
export type VoiceStyleId = (typeof voiceStyles)[number]["id"];

export function voiceStyleRecording(speaker: unknown, style: unknown) {
  const speakerName = typeof speaker === "string" ? speaker.trim() : "";
  const selected = voiceStyles.find((option) => option.id === style);
  if (!speakerName || speakerName.length > 40 || /[<>\r\n]/u.test(speakerName) || !selected)
    throw new Error("Enter a speaker name up to 40 characters and choose a recording style.");
  return {
    speakerName,
    style: selected.id,
    styleLabel: selected.label,
    name: `${speakerName} · ${selected.label}`,
  };
}
