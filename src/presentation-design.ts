/** Model-authored data only: no HTML, JavaScript, URLs, paths or evidence values. */
export interface SceneComposition {
  kind: "callout" | "steps" | "comparison";
  items: { label: string; claimId?: string }[];
}
export interface PresentationDesign {
  schemaVersion: 1;
  theme: "electric" | "ocean" | "sunset";
  motion: "snappy" | "smooth" | "minimal";
  scenes: {
    id: string;
    headline: string;
    emphasis: "balanced" | "headline" | "evidence";
    composition?: SceneComposition;
  }[];
}

export function parseSceneComposition(
  value: unknown,
  claimIds?: readonly string[],
): SceneComposition {
  const item = value as SceneComposition;
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.keys(item).some((key) => !["kind", "items"].includes(key)) ||
    !["callout", "steps", "comparison"].includes(item.kind) ||
    !Array.isArray(item.items) ||
    (item.kind === "callout"
      ? item.items.length !== 1
      : item.kind === "comparison"
        ? item.items.length !== 2
        : item.items.length < 2 || item.items.length > 3)
  )
    throw new Error("Choose a callout, two comparison panels or two to three steps.");
  const items = item.items.map((part) => {
    if (
      !part ||
      typeof part !== "object" ||
      Array.isArray(part) ||
      Object.keys(part).some((key) => !["label", "claimId"].includes(key)) ||
      typeof part.label !== "string" ||
      !part.label.trim() ||
      part.label.length > 32 ||
      /[<>\p{Cc}\p{N}]|https?:|[/\\]/u.test(part.label) ||
      (part.claimId !== undefined &&
        (typeof part.claimId !== "string" ||
          !/^[a-z][a-z0-9-]*$/u.test(part.claimId) ||
          (claimIds && !claimIds.includes(part.claimId))))
    )
      throw new Error(
        "Visual labels need short plain words and existing claim references; factual values stay in saved evidence.",
      );
    return { label: part.label.trim(), ...(part.claimId ? { claimId: part.claimId } : {}) };
  });
  return { kind: item.kind, items };
}

export function parsePresentationDesign(
  value: unknown,
  sceneIds: string[],
  claimIds?: readonly string[],
): PresentationDesign {
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
      Object.keys(scene).some(
        (key) => !["id", "headline", "emphasis", "composition"].includes(key),
      ) ||
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
    return {
      id: scene.id,
      headline: scene.headline.trim(),
      emphasis: scene.emphasis,
      ...(scene.composition !== undefined
        ? { composition: parseSceneComposition(scene.composition, claimIds) }
        : {}),
    };
  });
  return { schemaVersion: 1, theme: item.theme, motion: item.motion, scenes };
}
