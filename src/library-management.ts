import { readFile, realpath } from "node:fs/promises";
import { readContentEpisode } from "./contracts.js";
import { updateCreatorRecord } from "./creator-store.js";
import { hash } from "./digest.js";
import { inside } from "./paths.js";
import { presentationLabel } from "./presentation.js";
import { feedSceneDesign } from "./video/feed-design.js";
import { readWorkflowManifest, workflowState } from "./workflow.js";

export interface StoryMetadata {
  favorite: boolean;
  archived: boolean;
  series: string;
}
export const defaultStoryMetadata: StoryMetadata = { favorite: false, archived: false, series: "" };
export function parseStoryMetadata(value: unknown): StoryMetadata {
  const item = value as StoryMetadata;
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.keys(item).some((key) => !["favorite", "archived", "series"].includes(key)) ||
    typeof item.favorite !== "boolean" ||
    typeof item.archived !== "boolean" ||
    typeof item.series !== "string" ||
    item.series.length > 60 ||
    /[<>\p{Cc}]/u.test(item.series)
  )
    throw new Error("Use valid story organization preferences.");
  return { favorite: item.favorite, archived: item.archived, series: item.series.trim() };
}
export function libraryMetadataMatch(
  meta: StoryMetadata,
  view: string,
  favorite: boolean,
  series: string,
) {
  return (
    (view === "all" || (view === "archived" ? meta.archived : !meta.archived)) &&
    (!favorite || meta.favorite) &&
    (!series || meta.series === series)
  );
}
export async function saveStoryMetadata(
  root: string,
  directory: string,
  id: unknown,
  value: unknown,
) {
  const manifest = await readWorkflowManifest(directory);
  if (
    typeof id !== "string" ||
    !manifest.episodes.some((entry) => entry.selector.split("@")[0] === id)
  )
    throw new Error("Choose a story in the current library.");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["favorite", "archived", "series"].includes(key))
  )
    throw new Error("Use valid story organization preferences.");
  return updateCreatorRecord(root, "library", (previous) => {
    const records = (previous as Record<string, StoryMetadata> | null) ?? {};
    return {
      ...records,
      [id]: parseStoryMetadata({ ...defaultStoryMetadata, ...records[id], ...value }),
    };
  });
}
export async function compareLibraryVersions(
  directory: string,
  workflowRoot: string,
  selectors: string[],
) {
  if (selectors.length !== 2 || new Set(selectors).size !== 2)
    throw new Error("Choose two different saved versions.");
  directory = await realpath(directory);
  const manifest = await readWorkflowManifest(directory);
  return Promise.all(
    selectors.map(async (selector) => {
      const entry = manifest.episodes.find((item) => item.selector === selector);
      if (!entry) throw new Error("Version is not in the current library.");
      const episode = await readContentEpisode(selector);
      if (hash(JSON.stringify(episode)) !== entry.inputHash)
        throw new Error("A script changed. Rebuild the library before comparing.");
      let video = null;
      let videoHash: string | undefined;
      if (entry.video) {
        const path = `episodes/${selector}/video/short.mp4`;
        videoHash = manifest.artifactHashes[path];
        if (
          !videoHash ||
          hash(await readFile(inside(directory, await realpath(inside(directory, path))))) !==
            videoHash
        )
          throw new Error("A video changed. Rebuild the library before comparing.");
        video = {
          href: `/api/creator/video?selector=${encodeURIComponent(selector)}&renderKey=${encodeURIComponent(entry.video.renderKey)}&videoHash=${videoHash}`,
          hash: videoHash,
          renderKey: entry.video.renderKey,
        };
      }
      const state = await workflowState(workflowRoot, entry, videoHash);
      return {
        selector,
        title: episode.title,
        style: presentationLabel(episode),
        plannedSeconds: episode.targetDurationSeconds,
        measuredSeconds:
          entry.preview?.kind === "narrated"
            ? ((entry.preview as { durationSeconds?: number }).durationSeconds ?? null)
            : null,
        stage: state.label,
        video,
        speakers: episode.presentation?.speakers.map(({ id, name, voice, avatar }) => ({
          id,
          name,
          voice,
          portrait: avatar?.mode === "photo" ? avatar.imageId : "Illustrated",
        })) ?? [
          {
            id: "narrator",
            name: "Default narrator",
            voice: "Default stock voice",
            portrait: "Illustrated",
          },
        ],
        scenes: episode.scenes.map((scene, index) => ({
          id: scene.id,
          narration: scene.narration,
          visualHeadline: feedSceneDesign(episode, index).headline,
          composition: feedSceneDesign(episode, index).composition ?? null,
        })),
        companionPost: episode.publication.text,
      };
    }),
  );
}

export async function verifiedLibraryVideo(
  directory: string,
  selector: string,
  renderKey: string,
  videoHash: string,
) {
  directory = await realpath(directory);
  const manifest = await readWorkflowManifest(directory);
  const entry = manifest.episodes.find((item) => item.selector === selector);
  const path = `episodes/${selector}/video/short.mp4`;
  if (
    !entry?.video ||
    entry.video.renderKey !== renderKey ||
    !/^[a-f0-9]{64}$/u.test(videoHash) ||
    manifest.artifactHashes[path] !== videoHash
  )
    throw new Error("This video changed. Compare the current versions again.");
  const bytes = await readFile(inside(directory, await realpath(inside(directory, path))));
  if (hash(bytes) !== videoHash)
    throw new Error("This video changed. Compare the current versions again.");
  return bytes;
}
