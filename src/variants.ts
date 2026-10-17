import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readContentEpisode, validateEpisode } from "./contracts.js";
import { hash } from "./digest.js";
import { type ContentEpisode, isNewsEpisode } from "./domain.js";
import { validateNewsEpisode } from "./news/contracts.js";
import { projectRoot, sourceFile } from "./paths.js";
import { variantFile } from "./presentation.js";

export type PresentationDefinition = {
  schemaVersion: 1 | 2;
  baseEpisodeId: string;
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
  pronunciation?: Record<string, string>;
};

function assertPronunciations(glossary: unknown): asserts glossary is Record<string, string> {
  if (
    !glossary ||
    typeof glossary !== "object" ||
    Array.isArray(glossary) ||
    Object.keys(glossary).length > 64 ||
    Object.entries(glossary).some(
      ([term, spoken]) =>
        !term.trim() ||
        term.length > 80 ||
        typeof spoken !== "string" ||
        !spoken.trim() ||
        spoken.length > 160 ||
        /[[\]<>\r\n]/u.test(term + spoken),
    )
  )
    throw new Error("Presentation pronunciations need short terms and plain spoken text");
}

export async function validatePresentationDefinition(value: unknown, expectedSelector?: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Presentation variant metadata is invalid");
  const definition = value as PresentationDefinition;
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
          "pronunciation",
        ].includes(key),
    ) ||
    ![1, 2].includes(definition.schemaVersion) ||
    typeof definition.baseEpisodeId !== "string" ||
    !/^(ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}$/u.test(definition.baseEpisodeId) ||
    typeof definition.baseInputHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(definition.baseInputHash) ||
    typeof definition.title !== "string" ||
    typeof definition.presentation?.variant !== "string" ||
    (Object.hasOwn(definition, "publicationText") && typeof definition.publicationText !== "string")
  )
    throw new Error("Presentation variant metadata is invalid");
  if (Object.hasOwn(definition, "pronunciation")) assertPronunciations(definition.pronunciation);
  const selector = `${definition.baseEpisodeId}@${definition.presentation.variant}`;
  const file = variantFile(selector);
  if (expectedSelector !== undefined && expectedSelector !== selector)
    throw new Error("Presentation variant metadata does not match its selector");
  const base = await readContentEpisode(definition.baseEpisodeId);
  if (
    definition.schemaVersion === 1 &&
    definition.presentation.speakers.some((speaker) => typeof speaker.voice !== "string")
  )
    throw new Error("Cloned voice definitions require schemaVersion 2.");
  const episode = applyPresentationVariant(base, definition);
  return { definition: structuredClone(definition), episode, selector, file };
}

export async function readPresentationVariant(selector: string): Promise<ContentEpisode> {
  const file = variantFile(selector);
  const value: unknown = JSON.parse(await readFile(await sourceFile(file), "utf8"));
  return (await validatePresentationDefinition(value, selector)).episode;
}

export function applyPresentationVariant(
  base: ContentEpisode,
  value: Pick<
    PresentationDefinition,
    "baseInputHash" | "title" | "presentation" | "scenes" | "publicationText" | "pronunciation"
  >,
): ContentEpisode {
  if (value.baseInputHash !== hash(JSON.stringify(base)))
    throw new Error("Presentation base changed; review and rebind the variant before production");
  if (!Array.isArray(value.scenes) || value.scenes.length !== base.scenes.length)
    throw new Error("Presentation must provide every scene exactly once");
  if (Object.hasOwn(value, "pronunciation")) assertPronunciations(value.pronunciation);
  const episode = structuredClone(base);
  episode.title = value.title;
  episode.presentation = value.presentation;
  if (value.presentation.speakers.some((speaker) => typeof speaker.voice !== "string"))
    episode.schemaVersion = 2;
  for (const [index, override] of value.scenes.entries()) {
    const scene = episode.scenes[index];
    if (
      !scene ||
      !override ||
      typeof override !== "object" ||
      Array.isArray(override) ||
      override.id !== scene.id ||
      typeof override.narration !== "string" ||
      Object.keys(override).some((key) => !["id", "narration", "overlay", "dialogue"].includes(key))
    )
      throw new Error("Presentation cannot change scene order, demo visuals, or evidence");
    Object.assign(scene, override);
  }
  if (value.publicationText !== undefined) episode.publication.text = value.publicationText;
  if (value.pronunciation !== undefined)
    episode.pronunciation = { ...episode.pronunciation, ...value.pronunciation };
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
