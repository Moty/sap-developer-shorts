import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Ajv } from "ajv";
import type { FormatsPlugin } from "ajv-formats";
import { clonedEpisodeSchema, clonedNewsSchema } from "../clone-contracts.js";
import type { NewsEpisode, NewsEvidence, NewsTopic } from "../domain.js";
import { projectRoot } from "../paths.js";
import { assertPresentation } from "../presentation.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const addFormats = createRequire(import.meta.url)("ajv-formats") as FormatsPlugin;
addFormats(ajv);
ajv.addSchema(
  JSON.parse(await readFile(resolve(projectRoot, "schemas/episode.schema.json"), "utf8")),
);
const episodeValidator = ajv.compile<NewsEpisode>(
  JSON.parse(await readFile(resolve(projectRoot, "schemas/news-episode.schema.json"), "utf8")),
);
ajv.addSchema(
  clonedEpisodeSchema(
    JSON.parse(await readFile(resolve(projectRoot, "schemas/episode.schema.json"), "utf8")),
  ),
);
const episodeValidatorV2 = ajv.compile<NewsEpisode>(
  clonedNewsSchema(
    JSON.parse(await readFile(resolve(projectRoot, "schemas/news-episode.schema.json"), "utf8")),
  ),
);
const topicsValidator = ajv.compile<NewsTopic[]>(
  JSON.parse(await readFile(resolve(projectRoot, "schemas/news-topics.schema.json"), "utf8")),
);

export function validateNewsEpisode(
  value: unknown,
  options: { requireFresh?: boolean; now?: Date } = {},
): NewsEpisode {
  const validator =
    (value as NewsEpisode)?.schemaVersion === 2 ? episodeValidatorV2 : episodeValidator;
  if (!validator(value)) {
    throw new Error(`News schema: ${ajv.errorsText(validator.errors, { separator: "; " })}`);
  }
  const errors: string[] = [];
  assertPresentation(value);
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const asOf = value.news.asOf;
  if (asOf > today) errors.push("News cannot have a future as-of date");
  if (
    options.requireFresh &&
    Date.parse(today) - Date.parse(asOf) > value.news.maxAgeDays * 86400000
  ) {
    errors.push(
      "News source review is stale; re-read the sources and update the claims before production",
    );
  }
  for (const [label, items] of [
    ["Source", value.sources],
    ["Claim", value.claims],
    ["Scene", value.scenes],
  ] as const) {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      errors.push(`${label} IDs must be unique`);
  }
  const sourceIds = new Set(value.sources.map((source) => source.id));
  const claimIds = new Set(value.claims.map((claim) => claim.id));
  for (const source of value.sources) {
    const url = new URL(source.url);
    if (url.hostname !== "sap.com" && !url.hostname.endsWith(".sap.com"))
      errors.push(`News requires an official SAP source: ${source.id}`);
    if (
      source.retrievedOn !== asOf ||
      (source.publishedOn && source.publishedOn > source.retrievedOn)
    )
      errors.push(`Invalid source chronology: ${source.id}`);
  }
  for (const claim of value.claims) {
    if (claim.checkedOn !== asOf)
      errors.push(`Claim ${claim.id} must be checked on the as-of date`);
    for (const id of claim.sourceIds) {
      if (!sourceIds.has(id)) errors.push(`Claim ${claim.id} references unknown source ${id}`);
      if (!claim.support.some((item) => item.sourceId === id))
        errors.push(`Claim ${claim.id} needs a support note for ${id}`);
    }
    for (const support of claim.support) {
      if (!claim.sourceIds.includes(support.sourceId))
        errors.push(`Claim ${claim.id} has undeclared source support`);
    }
  }
  let end = 0;
  for (const scene of value.scenes) {
    const duration = scene.endSeconds - scene.startSeconds;
    if (scene.startSeconds !== end || duration <= 0)
      errors.push(`Scene ${scene.id} has a gap, overlap, or no duration`);
    for (const id of scene.claimIds) {
      if (!claimIds.has(id)) errors.push(`Scene ${scene.id} references unknown claim ${id}`);
    }
    if (
      scene.phase === "headline" &&
      (scene.visual.kind !== "news-card" || scene.claimIds.length !== 1)
    )
      errors.push(`Headline ${scene.id} needs one sourced announcement card`);
    if (scene.visual.kind === "news-card" && scene.claimIds.length !== 1)
      errors.push(`News card ${scene.id} needs one claim`);
    end = scene.endSeconds;
  }
  for (const id of claimIds) {
    if (
      !value.scenes.some(
        (scene) => scene.visual.kind === "news-card" && scene.claimIds.includes(id),
      )
    )
      errors.push(`Claim ${id} needs an announcement card`);
  }
  if (end !== value.targetDurationSeconds) errors.push("Scenes must cover the target duration");
  if (
    value.scenes.map((scene) => scene.phase).join(",") !==
    "hook,context,headline,headline,headline,payoff,cta"
  )
    errors.push("News needs hook, context, three headlines, takeaway, and CTA");
  if (errors.length) throw new Error(errors.join("\n"));
  return value;
}

export async function readNewsEpisode(id: string): Promise<NewsEpisode> {
  if (!/^NEWS-\d{2}$/u.test(id)) throw new Error(`Invalid news episode ID: ${id}`);
  const episodePath = resolve(projectRoot, "content/episodes", `${id}.json`);
  let content: string;
  try {
    content = await readFile(episodePath, "utf8");
  } catch {
    const draftPath = resolve(projectRoot, "content/drafts", `${id}.json`);
    content = await readFile(draftPath, "utf8");
  }
  const episode = validateNewsEpisode(JSON.parse(content));
  if (episode.id !== id) throw new Error("News filename and ID differ");
  return episode;
}

export async function readNewsTopics(): Promise<NewsTopic[]> {
  const value: unknown = JSON.parse(
    await readFile(resolve(projectRoot, "content/news/backlog.json"), "utf8"),
  );
  if (!topicsValidator(value))
    throw new Error(`News backlog: ${ajv.errorsText(topicsValidator.errors)}`);
  if (
    new Set(value.map((topic) => topic.id)).size !== value.length ||
    new Set(value.map((topic) => topic.priority)).size !== value.length
  )
    throw new Error("News backlog IDs and editorial priorities must be unique");
  return value;
}

export function newsEvidence(episode: NewsEpisode): NewsEvidence {
  return {
    schemaVersion: 1,
    kind: "news-source-review",
    asOf: episode.news.asOf,
    event: episode.news.event,
    editorialStatus: "draft",
    sources: structuredClone(episode.sources),
    claimReviews: structuredClone(episode.claims),
  };
}

export function assertNewsEvidence(
  value: unknown,
  episode: NewsEpisode,
): asserts value is NewsEvidence {
  if (JSON.stringify(value) !== JSON.stringify(newsEvidence(episode)))
    throw new Error("News evidence differs from the saved source review");
}

export const availabilityLabels = {
  "generally-available": "Available now",
  rollout: "Rollout starting",
  "early-access": "Early access",
  planned: "Planned release",
  announced: "Announced",
} as const;
