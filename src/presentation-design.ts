/** Model-authored data only: no HTML, JavaScript, URLs, paths or evidence values. */
export interface PresentationDesign {
  schemaVersion: 1;
  theme: "electric" | "ocean" | "sunset";
  motion: "snappy" | "smooth" | "minimal";
  scenes: { id: string; headline: string; emphasis: "balanced" | "headline" | "evidence" }[];
}

export function parsePresentationDesign(value: unknown, sceneIds: string[]): PresentationDesign {
  const item = value as PresentationDesign;
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.keys(item).some(
      (key) => !["schemaVersion", "theme", "motion", "scenes"].includes(key),
    ) ||
    item.schemaVersion !== 1 ||
    !["electric", "ocean", "sunset"].includes(item.theme) ||
    !["snappy", "smooth", "minimal"].includes(item.motion) ||
    !Array.isArray(item.scenes) ||
    item.scenes.length !== sceneIds.length
  )
    throw new Error("Presentation design needs a supported theme, motion and every scene.");
  const scenes = item.scenes.map((scene, index) => {
    if (
      !scene ||
      typeof scene !== "object" ||
      Array.isArray(scene) ||
      Object.keys(scene).some((key) => !["id", "headline", "emphasis"].includes(key)) ||
      scene.id !== sceneIds[index] ||
      typeof scene.headline !== "string" ||
      !scene.headline.trim() ||
      scene.headline.length > 48 ||
      /[<>\p{Cc}]/u.test(scene.headline) ||
      !["balanced", "headline", "evidence"].includes(scene.emphasis)
    )
      throw new Error(
        "Presentation scenes need ordered IDs, short plain headlines and supported emphasis.",
      );
    return { id: scene.id, headline: scene.headline.trim(), emphasis: scene.emphasis };
  });
  return { schemaVersion: 1, theme: item.theme, motion: item.motion, scenes };
}
