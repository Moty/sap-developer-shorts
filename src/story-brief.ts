export const storyAudiences = ["developer", "architect", "consultant", "business"] as const;
export interface StoryBrief {
  audience: (typeof storyAudiences)[number];
  viewerProblem: string;
  takeaway: string;
  angle: string;
  targetSeconds: number;
}
export const defaultStoryBrief: StoryBrief = {
  audience: "developer",
  viewerProblem: "",
  takeaway: "",
  angle: "",
  targetSeconds: 55,
};
export function parseStoryBrief(value: unknown): StoryBrief {
  const item = value as StoryBrief;
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.keys(item).some((key) => !Object.keys(defaultStoryBrief).includes(key)) ||
    !storyAudiences.includes(item.audience) ||
    !Number.isInteger(item.targetSeconds) ||
    item.targetSeconds < 15 ||
    item.targetSeconds > 90 ||
    [item.viewerProblem, item.takeaway, item.angle].some(
      (text) => typeof text !== "string" || text.length > 240 || /[<>\p{Cc}]/u.test(text),
    )
  )
    throw new Error("Story brief needs an audience, short plain text and a 15–90 second target.");
  return {
    audience: item.audience,
    viewerProblem: item.viewerProblem.trim(),
    takeaway: item.takeaway.trim(),
    angle: item.angle.trim(),
    targetSeconds: item.targetSeconds,
  };
}
