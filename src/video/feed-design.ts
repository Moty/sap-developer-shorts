import { type ContentEpisode, isNewsEpisode } from "../domain.js";

/** Editorial hierarchy only. Facts and numbers still come from the saved script/capture. */
export function feedSceneDesign(episode: ContentEpisode, sceneIndex: number) {
  const scene = episode.scenes[sceneIndex];
  if (!scene) throw new Error("Missing feed scene");
  const kind =
    scene.visual.kind === "code"
      ? "code"
      : scene.visual.kind === "output"
        ? "result"
        : scene.visual.kind === "news-card"
          ? "news"
          : scene.phase === "hook"
            ? "hook"
            : scene.phase === "cta"
              ? "closing"
              : isNewsEpisode(episode)
                ? "news"
                : "story";
  const automaticPalette = {
    hook: { accent: "#dcff66", secondary: "#9c82ff", surface: "#1c2f70" },
    code: { accent: "#58e7ff", secondary: "#9c82ff", surface: "#102247" },
    result: { accent: "#dcff66", secondary: "#58e7ff", surface: "#143a39" },
    news: { accent: "#ffcb77", secondary: "#b19aff", surface: "#30265e" },
    closing: { accent: "#b7a4ff", secondary: "#58e7ff", surface: "#30265e" },
    story: { accent: "#58e7ff", secondary: "#dcff66", surface: "#102247" },
  }[kind];
  const custom = episode.presentation?.design;
  const direction = custom?.scenes[sceneIndex];
  const palette = !custom
    ? automaticPalette
    : {
        electric: { accent: "#dcff66", secondary: "#9c82ff", surface: "#1c2f70" },
        ocean: { accent: "#58e7ff", secondary: "#5ef0ba", surface: "#103d50" },
        sunset: { accent: "#ffcb77", secondary: "#ff8e9e", surface: "#502542" },
      }[custom.theme];
  const question = scene.narration
    .match(/[^.!?]*\?/gu)
    ?.at(-1)
    ?.trim();
  const bridge =
    !isNewsEpisode(episode) && episode.claims.some((claim) => claim.id === "explicit-service");
  return {
    kind,
    ...palette,
    compilerVersion: "feed-design-v2",
    custom: !!custom,
    headline: direction?.headline ?? scene.overlay,
    emphasis: direction?.emphasis ?? "balanced",
    ...(direction?.composition ? { composition: direction.composition } : {}),
    motion: custom?.motion ?? "smooth",
    entranceSeconds: !custom
      ? 0.5
      : custom.motion === "snappy"
        ? 0.3
        : custom.motion === "minimal"
          ? 0
          : 0.8,
    topic: episode.id.split("-")[0] ?? "SAP",
    question: question ?? scene.overlay,
    serviceBridge: bridge,
  };
}

export function cueIdentifiers(source: string, narration: string) {
  const ignored = new Set(["the", "and", "with", "from", "this", "that", "for", "you", "your"]);
  const words = new Set(
    (narration.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? [])
      .map((word) => word.toLowerCase())
      .filter((word) => (word.length >= 3 || word === "id") && !ignored.has(word)),
  );
  return [
    ...new Set(
      (source.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? []).filter((word) =>
        words.has(word.toLowerCase()),
      ),
    ),
  ];
}
