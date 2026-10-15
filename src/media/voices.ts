// English voices in the pinned Kokoro v1.0 release. Other languages need their own text pipeline.
const voiceGroups = {
  af: [
    "heart",
    "alloy",
    "aoede",
    "bella",
    "jessica",
    "kore",
    "nicole",
    "nova",
    "river",
    "sarah",
    "sky",
  ],
  am: ["adam", "echo", "eric", "fenrir", "liam", "michael", "onyx", "puck", "santa"],
  bf: ["alice", "emma", "isabella", "lily"],
  bm: ["daniel", "fable", "george", "lewis"],
};

export const kokoroVoices = Object.entries(voiceGroups).flatMap(([prefix, names]) =>
  names.map((name) => ({
    id: `${prefix}_${name}`,
    name: name[0]?.toUpperCase() + name.slice(1),
    accent: prefix[0] === "a" ? "American English" : "British English",
    gender: prefix[1] === "f" ? "Female" : "Male",
  })),
);

export function kokoroVoice(id: string) {
  const voice = kokoroVoices.find((candidate) => candidate.id === id);
  if (!voice) throw new Error(`Unsupported Kokoro voice: ${id}. Run npm run shorts -- voices.`);
  return voice;
}

export function supportsKokoroVoice(id: string): boolean {
  return kokoroVoices.some((voice) => voice.id === id);
}
