import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readContentEpisode } from "./contracts.js";
import { hash } from "./digest.js";
import { type ContentEpisode, isNewsEpisode } from "./domain.js";
import { inside, projectRoot } from "./paths.js";

export type WorkflowStage = "editing" | "producing" | "review" | "publish" | "published";
export const workflowLabels: Record<WorkflowStage, string> = {
  editing: "Editing",
  producing: "Producing",
  review: "To review",
  publish: "To publish",
  published: "Published",
};
export function workflowSourcesExpired(episode: ContentEpisode, now = new Date()) {
  if (!isNewsEpisode(episode)) return false;
  const today = now.toISOString().slice(0, 10);
  const through = new Date(
    Date.parse(`${episode.news.asOf}T00:00:00Z`) + episode.news.maxAgeDays * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  return today < episode.news.asOf || today > through;
}
export interface WorkflowRecord {
  selector: string;
  renderKey: string;
  inputHash: string;
  videoHash: string;
  reviewedAt: string | null;
  publication: { url: string; recordedAt: string } | null;
}
export interface WorkflowEpisode {
  selector: string;
  inputHash: string;
  sourceReviewExpired: boolean;
  video?: { renderKey: string };
  preview?: { timingReady: boolean; kind: string } | null;
}
export interface WorkflowManifest {
  episodes: WorkflowEpisode[];
  artifactHashes: Record<string, string>;
}
export function workflowDirectory(artifactRoot?: string) {
  return resolve(
    projectRoot,
    artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
    ".studio-workflow",
  );
}
export async function readWorkflowManifest(directory: string): Promise<WorkflowManifest> {
  return JSON.parse(await readFile(resolve(directory, "library-manifest.json"), "utf8"));
}
function recordFile(root: string, selector: string, renderKey: string) {
  return resolve(root, `${hash(`${selector}:${renderKey}`)}.json`);
}
export async function workflowState(root: string, entry: WorkflowEpisode, videoHash?: string) {
  let record: WorkflowRecord | null = null;
  if (entry.video) {
    try {
      const saved = JSON.parse(
        await readFile(recordFile(root, entry.selector, entry.video.renderKey), "utf8"),
      ) as WorkflowRecord;
      if (
        saved.selector === entry.selector &&
        saved.inputHash === entry.inputHash &&
        saved.renderKey === entry.video.renderKey &&
        saved.videoHash === videoHash
      )
        record = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const stage: WorkflowStage = record?.publication
    ? "published"
    : record?.reviewedAt
      ? "publish"
      : entry.video
        ? "review"
        : "editing";
  return { stage, label: workflowLabels[stage], record };
}
let writes: Promise<unknown> = Promise.resolve();
export function updateWorkflow(directory: string, root: string, value: unknown) {
  const update = writes.catch(() => {}).then(() => writeWorkflow(directory, root, value));
  writes = update;
  return update;
}
async function writeWorkflow(directory: string, root: string, value: unknown) {
  const body = value as {
    selector?: string;
    renderKey?: string;
    action?: string;
    url?: string;
    reviewed?: boolean;
  };
  if (
    !body ||
    typeof body.selector !== "string" ||
    !["approve", "publish", "reopen"].includes(body.action ?? "")
  )
    throw new Error("Choose a video and a valid review action.");
  const manifest = await readWorkflowManifest(directory);
  const entry = manifest.episodes.find((item) => item.selector === body.selector);
  if (!entry?.video || entry.video.renderKey !== body.renderKey)
    throw new Error(
      "This video changed or is unavailable. Reload the studio and review the current video.",
    );
  const episode = await readContentEpisode(entry.selector);
  if (hash(JSON.stringify(episode)) !== entry.inputHash)
    throw new Error(
      "The script changed after this video was made. Produce and review the new version.",
    );
  if (body.action !== "reopen" && (entry.sourceReviewExpired || workflowSourcesExpired(episode)))
    throw new Error(
      "The news source review has expired. Recheck sources before approving or publishing.",
    );
  const relative = `episodes/${entry.selector}/video/short.mp4`;
  const videoHash = manifest.artifactHashes[relative];
  if (!videoHash || hash(await readFile(inside(directory, relative))) !== videoHash)
    throw new Error("The saved MP4 is missing or changed. Rebuild the studio before reviewing.");
  const previous = await workflowState(root, entry, videoHash);
  const record: WorkflowRecord = previous.record ?? {
    selector: entry.selector,
    renderKey: entry.video.renderKey,
    inputHash: entry.inputHash,
    videoHash,
    reviewedAt: null,
    publication: null,
  };
  if (body.action === "approve") {
    if (body.reviewed !== true)
      throw new Error("Confirm that you reviewed the video, captions, and sources.");
    record.reviewedAt ??= new Date().toISOString();
  } else if (body.action === "publish") {
    if (!record.reviewedAt)
      throw new Error("Review and approve this video before recording publication.");
    if (typeof body.url !== "string" || body.url.length > 2048)
      throw new Error("Enter the published post URL.");
    const url = new URL(body.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Use an HTTP or HTTPS post URL without credentials.");
    record.publication = { url: url.href, recordedAt: new Date().toISOString() };
  } else {
    record.reviewedAt = null;
    record.publication = null;
  }
  await mkdir(root, { recursive: true });
  const file = recordFile(root, entry.selector, entry.video.renderKey);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, file);
  return workflowState(root, entry, videoHash);
}
