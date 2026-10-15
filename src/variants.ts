import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readContentEpisode, validateEpisode } from "./contracts.js";
import { hash } from "./digest.js";
import { type ContentEpisode, isNewsEpisode } from "./domain.js";
import { validateNewsEpisode } from "./news/contracts.js";
import { projectRoot, sourceFile } from "./paths.js";
import { variantFile } from "./presentation.js";

export async function readPresentationVariant(selector: string): Promise<ContentEpisode> {
  const file = variantFile(selector);
  const value = JSON.parse(await readFile(await sourceFile(file), "utf8"));
  const [id, variant] = selector.split("@");
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "schemaVersion",
          "baseEpisodeId",
          "baseInputHash",
          "title",
          "presentation",
          "scenes",
          "publicationText",
        ].includes(key),
    ) ||
    value.schemaVersion !== 1 ||
    value.baseEpisodeId !== id ||
    value.presentation?.variant !== variant
  )
    throw new Error("Presentation variant metadata is invalid");
  const base = await readContentEpisode(value.baseEpisodeId);
  return applyPresentationVariant(base, value);
}

export function applyPresentationVariant(
  base: ContentEpisode,
  value: {
    baseInputHash: string;
    title: string;
    presentation: NonNullable<ContentEpisode["presentation"]>;
    scenes: {
      id: string;
      narration: string;
      overlay?: string;
      dialogue?: { speakerId: string; text: string }[];
    }[];
    publicationText?: string;
  },
): ContentEpisode {
  if (value.baseInputHash !== hash(JSON.stringify(base)))
    throw new Error("Presentation base changed; review and rebind the variant before production");
  if (!Array.isArray(value.scenes) || value.scenes.length !== base.scenes.length)
    throw new Error("Presentation must provide every scene exactly once");
  const episode = structuredClone(base);
  episode.title = value.title;
  episode.presentation = value.presentation;
  for (const [index, override] of value.scenes.entries()) {
    const scene = episode.scenes[index];
    if (
      !scene ||
      override.id !== scene.id ||
      Object.keys(override).some((key) => !["id", "narration", "overlay", "dialogue"].includes(key))
    )
      throw new Error("Presentation cannot change scene order, demo visuals, or evidence");
    Object.assign(scene, override);
  }
  if (value.publicationText !== undefined) episode.publication.text = value.publicationText;
  return isNewsEpisode(episode) ? validateNewsEpisode(episode) : validateEpisode(episode);
}

export async function readPresentationVariants(): Promise<ContentEpisode[]> {
  const files = await readdir(resolve(projectRoot, "content/presentations"));
  return Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => readPresentationVariant(name.slice(0, -5).replace("--", "@"))),
  );
}
