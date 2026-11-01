/** Model-authored data only: no HTML, JavaScript, URLs, paths or evidence values. */
export interface SceneComposition {
  kind: "callout" | "steps" | "comparison" | "flow" | "timeline";
  items: { label: string; claimId?: string }[];
}
export const backgroundStyles = [
  "classic",
  "aurora",
  "blueprint",
  "spotlight",
  "editorial",
] as const;
export const visualEffects = ["none", "drift", "particles"] as const;
export interface PresentationImage {
  assetId: string;
  fit: "contain" | "cover";
  treatment: "card" | "background";
  focalX: number;
  focalY: number;
  alt: string;
  caption?: string;
}
export function parsePresentationImage(value: unknown): PresentationImage {
  const item = value as PresentationImage;
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.keys(item).some(
      (key) => !["assetId", "fit", "treatment", "focalX", "focalY", "alt", "caption"].includes(key),
    ) ||
    !/^[a-f0-9]{64}$/u.test(item.assetId) ||
    !["contain", "cover"].includes(item.fit) ||
    !["card", "background"].includes(item.treatment) ||
    ![item.focalX, item.focalY].every(
      (number) => Number.isFinite(number) && number >= 0 && number <= 1,
    ) ||
    typeof item.alt !== "string" ||
    !item.alt.trim() ||
    item.alt.length > 160 ||
    /[<>\p{Cc}]/u.test(item.alt) ||
    (item.caption !== undefined &&
      (typeof item.caption !== "string" ||
        item.caption.length > 96 ||
        /[<>\p{Cc}]/u.test(item.caption)))
  )
    throw new Error("Use an existing local image, plain alt text and valid crop settings.");
  return structuredClone(item);
}
export interface PresentationDesign {
  schemaVersion: 1;
  theme: "electric" | "ocean" | "sunset";
  motion: "snappy" | "smooth" | "minimal";
  background?: (typeof backgroundStyles)[number];
  effect?: (typeof visualEffects)[number];
  scenes: {
    id: string;
    headline: string;
    emphasis: "balanced" | "headline" | "evidence";
    composition?: SceneComposition;
    dataView?: "rows" | "bars" | "dots";
    image?: PresentationImage;
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
    !["callout", "steps", "comparison", "flow", "timeline"].includes(item.kind) ||
    !Array.isArray(item.items) ||
    (item.kind === "callout"
      ? item.items.length !== 1
      : item.kind === "comparison"
        ? item.items.length !== 2
        : item.items.length < 2 ||
          item.items.length > (["flow", "timeline"].includes(item.kind) ? 4 : 3))
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
      (key) =>
        !["schemaVersion", "theme", "motion", "scenes", "background", "effect"].includes(key),
    ) ||
    item.schemaVersion !== 1 ||
    !["electric", "ocean", "sunset"].includes(item.theme) ||
    !["snappy", "smooth", "minimal"].includes(item.motion) ||
    (item.background !== undefined && !backgroundStyles.includes(item.background)) ||
    (item.effect !== undefined && !visualEffects.includes(item.effect)) ||
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
        (key) => !["id", "headline", "emphasis", "composition", "dataView", "image"].includes(key),
      ) ||
      scene.id !== sceneIds[index] ||
      typeof scene.headline !== "string" ||
      !scene.headline.trim() ||
      scene.headline.length > 48 ||
      /[<>\p{Cc}]/u.test(scene.headline) ||
      !["balanced", "headline", "evidence"].includes(scene.emphasis) ||
      (scene.dataView !== undefined && !["rows", "bars", "dots"].includes(scene.dataView)) ||
      (scene.image?.treatment === "card" && scene.composition !== undefined)
    )
      throw new Error(
        "Presentation scenes need ordered IDs, short plain headlines and supported emphasis.",
      );
    return {
      id: scene.id,
      headline: scene.headline.trim(),
      emphasis: scene.emphasis,
      ...(scene.dataView !== undefined ? { dataView: scene.dataView } : {}),
      ...(scene.image !== undefined ? { image: parsePresentationImage(scene.image) } : {}),
      ...(scene.composition !== undefined
        ? { composition: parseSceneComposition(scene.composition, claimIds) }
        : {}),
    };
  });
  return {
    schemaVersion: 1,
    theme: item.theme,
    motion: item.motion,
    ...(item.background !== undefined ? { background: item.background } : {}),
    ...(item.effect !== undefined ? { effect: item.effect } : {}),
    scenes,
  };
}

export function sceneSupportsCharts(scene: { visual: { kind: string } }) {
  return (
    scene.visual.kind === "output" &&
    "captureKey" in scene.visual &&
    ["products", "filtered"].includes(String(scene.visual.captureKey))
  );
}
