import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Ajv } from "ajv";
import type { FormatsPlugin } from "ajv-formats";
import { clonedEpisodeSchema } from "./clone-contracts.js";
import { demos } from "./demos.js";
import type { ContentEpisode, DemoEvidence, Episode, NewsTopic, Topic } from "./domain.js";
import { projectRoot } from "./paths.js";
import { assertPresentation } from "./presentation.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const addFormats = createRequire(import.meta.url)("ajv-formats") as FormatsPlugin;
addFormats(ajv);
const episodeSchema = JSON.parse(
  await readFile(resolve(projectRoot, "schemas/episode.schema.json"), "utf8"),
);
const topicSchema = JSON.parse(
  await readFile(resolve(projectRoot, "schemas/topics.schema.json"), "utf8"),
);
const episodeValidator = ajv.compile<Episode>(episodeSchema);
const episodeValidatorV2 = ajv.compile<Episode>(clonedEpisodeSchema(episodeSchema));
const topicValidator = ajv.compile<Topic[]>(topicSchema);
const evidenceValidator = ajv.compile<DemoEvidence>(
  JSON.parse(await readFile(resolve(projectRoot, "schemas/demo-evidence.schema.json"), "utf8")),
);

export function validateEvidence(value: unknown): DemoEvidence {
  if (!evidenceValidator(value)) {
    throw new Error(
      `Demo evidence is incomplete or invalid: ${ajv.errorsText(evidenceValidator.errors, { separator: "; " })}`,
    );
  }
  if (Date.parse(value.verifiedAt) > Date.now()) {
    throw new Error("Demo evidence has a future verification time");
  }
  return value;
}

export const words = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length;

function unique(ids: string[], label: string, errors: string[]) {
  if (new Set(ids).size !== ids.length) errors.push(`${label} must be unique`);
}

export function validateEpisode(value: unknown): Episode {
  const validator = (value as Episode)?.schemaVersion === 2 ? episodeValidatorV2 : episodeValidator;
  if (!validator(value)) {
    throw new Error(`Episode schema: ${ajv.errorsText(validator.errors, { separator: "; " })}`);
  }
  const errors: string[] = [];
  assertPresentation(value);
  unique(
    value.sources.map((source) => source.id),
    "Source IDs",
    errors,
  );
  unique(
    value.claims.map((claim) => claim.id),
    "Claim IDs",
    errors,
  );
  unique(
    value.scenes.map((scene) => scene.id),
    "Scene IDs",
    errors,
  );
  const sourceIds = new Set(value.sources.map((source) => source.id));
  const checks = new Set<string>(demos[value.demo.id].checks);
  for (const check of value.demo.expectedChecks) {
    if (!checks.has(check)) errors.push(`Unknown demo check: ${check}`);
  }
  for (const check of checks) {
    if (!value.demo.expectedChecks.includes(check)) errors.push(`Missing demo check: ${check}`);
  }
  for (const claim of value.claims) {
    for (const id of claim.sourceIds) {
      if (!sourceIds.has(id)) errors.push(`Claim ${claim.id} references unknown source ${id}`);
    }
    for (const check of claim.evidenceChecks) {
      if (!checks.has(check)) errors.push(`Claim ${claim.id} references unknown check ${check}`);
    }
  }
  let end = 0;
  for (const scene of value.scenes) {
    if (scene.startSeconds !== end) errors.push(`Scene ${scene.id} has a gap or overlap`);
    if (scene.endSeconds <= scene.startSeconds) errors.push(`Scene ${scene.id} has no duration`);
    if (words(scene.narration) / (scene.endSeconds - scene.startSeconds) > 3) {
      errors.push(`Scene ${scene.id} exceeds the draft limit of 180 spoken words/minute`);
    }
    if (
      scene.visual.codePath &&
      !demos[value.demo.id].files.some((file) => file === scene.visual.codePath)
    ) {
      errors.push(`Scene ${scene.id} must use a registered demo source file`);
    }
    end = scene.endSeconds;
  }
  if (end !== value.targetDurationSeconds) errors.push("Scenes must cover the target duration");
  if (
    value.scenes.map((scene) => scene.phase).join(",") !== "hook,context,demo,demo,demo,payoff,cta"
  ) {
    errors.push("Expected hook, context, three demo steps, payoff, and CTA in order");
  }
  if ((value.scenes[0]?.endSeconds ?? 0) > 3) errors.push("Hook must finish within three seconds");
  if (words(value.scenes[0]?.narration ?? "") > 7) errors.push("Hook must use at most seven words");
  for (const source of value.sources) {
    if (Date.parse(source.retrievedOn) > Date.now())
      errors.push(`Future source date: ${source.id}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return value;
}

export function validateTopics(value: unknown): Topic[] {
  if (!topicValidator(value)) {
    throw new Error(`Topic schema: ${ajv.errorsText(topicValidator.errors, { separator: "; " })}`);
  }
  const errors: string[] = [];
  unique(
    value.map((topic) => topic.id),
    "Topic IDs",
    errors,
  );
  for (const topic of value) {
    if (topic.id.split("-")[0] !== topic.pillar) errors.push(`Pillar mismatch: ${topic.id}`);
    if (
      topic.status === "pilot-ready" &&
      (!topic.sources.length || !topic.supportedRelease || !topic.verifiedOn)
    ) {
      errors.push(`Pilot-ready topic ${topic.id} needs sources, release, and verification date`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return value;
}

export async function readEpisode(id: string): Promise<Episode> {
  if (!/^(ABAP|CAP|RAP|BTP|AI)-\d{2}$/u.test(id)) throw new Error(`Invalid episode ID: ${id}`);
  const data: unknown = JSON.parse(
    await readFile(resolve(projectRoot, "content/episodes", `${id}.json`), "utf8"),
  );
  const episode = validateEpisode(data);
  if (episode.id !== id) throw new Error(`Episode filename and ID differ: ${id}`);
  return episode;
}

export async function readContentEpisode(id: string): Promise<ContentEpisode> {
  if (id.endsWith(".json")) {
    const raw: unknown = JSON.parse(await readFile(resolve(projectRoot, id), "utf8"));
    if (typeof raw === "object" && raw !== null && "format" in raw && (raw as { format: unknown }).format === "news") {
      const { validateNewsEpisode } = await import("./news/contracts.js");
      return validateNewsEpisode(raw);
    }
    return validateEpisode(raw);
  }
  if (id.includes("@")) return (await import("./variants.js")).readPresentationVariant(id);
  if (id.startsWith("NEWS-")) {
    return (await import("./news/contracts.js")).readNewsEpisode(id);
  }
  return readEpisode(id);
}

export async function validateContent(): Promise<{
  topics: Topic[];
  newsTopics: NewsTopic[];
  episodes: ContentEpisode[];
  variants: ContentEpisode[];
}> {
  const topics = validateTopics(
    JSON.parse(await readFile(resolve(projectRoot, "content/topics/backlog.json"), "utf8")),
  );
  const filenames = (await readdir(resolve(projectRoot, "content/episodes")))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const episodes = await Promise.all(
    filenames.map((name) => readContentEpisode(name.slice(0, -5))),
  );
  const { readNewsTopics } = await import("./news/contracts.js");
  const newsTopics = await readNewsTopics();
  for (const episode of episodes) {
    if ("format" in episode && episode.format === "news") {
      if (newsTopics.find((item) => item.id === episode.id)?.status !== "draft-ready") {
        throw new Error(`News episode ${episode.id} needs a draft-ready news backlog entry`);
      }
      continue;
    }
    const topic = topics.find((item) => item.id === episode.id);
    if (topic?.status !== "pilot-ready") {
      throw new Error(`Episode ${episode.id} needs a pilot-ready backlog entry`);
    }
  }
  const variants = await (await import("./variants.js")).readPresentationVariants();
  return { topics, newsTopics, episodes, variants };
}
