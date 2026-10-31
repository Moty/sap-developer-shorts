// One header and step navigation for every page of an episode version: the editor, Review &
// publish, the watch/video pages and the deck. Pure string rendering; templates/episode-shell.js
// only enhances the version menu, so every link keeps working without scripts.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContentEpisode } from "./domain.js";
import { type WorkStage, workAction } from "./library-stories.js";
import { projectRoot } from "./paths.js";
import { escapeHtml as esc } from "./review.js";
import { workflowLabels } from "./workflow.js";

export type EpisodeStep = "script" | "voice" | "produce" | "review";
export type StepState = "done" | "current" | "todo" | "locked";

/** Steps 1–3 are editor panes (data-editor-step keeps the editor's own step names). */
export const episodeSteps: readonly {
  id: EpisodeStep;
  label: string;
  sub: string;
  editorStep?: "script" | "voice" | "review";
  fragment?: string;
}[] = [
  {
    id: "script",
    label: "Script",
    sub: "Scenes, details & visuals",
    editorStep: "script",
    fragment: "scene-0-heading",
  },
  {
    id: "voice",
    label: "Voice & presenter",
    sub: "Voice & portrait",
    editorStep: "voice",
    fragment: "voice-heading",
  },
  {
    id: "produce",
    label: "Produce",
    sub: "Post · AI review · MP4",
    editorStep: "review",
    fragment: "companion-post-heading",
  },
  { id: "review", label: "Review & publish", sub: "Approve · post · record" },
];

export const reviewLockReason = "Produce the video first";

/**
 * Steps before the current one are done. Without a current step (watch, video and deck pages),
 * a verified MP4 marks steps 1–3 done. Review & publish is locked until this version has an MP4.
 */
export function episodeStepStates(
  current: EpisodeStep | null,
  hasVideo: boolean,
): Record<EpisodeStep, StepState> {
  const position = current ? episodeSteps.findIndex((step) => step.id === current) : -1;
  return Object.fromEntries(
    episodeSteps.map((step, index): [EpisodeStep, StepState] => {
      if (step.id === "review" && !hasVideo) return [step.id, "locked"];
      if (index === position) return [step.id, "current"];
      if (position >= 0) return [step.id, index < position ? "done" : "todo"];
      return [step.id, hasVideo && step.id !== "review" ? "done" : "todo"];
    }),
  ) as Record<EpisodeStep, StepState>;
}

export interface ShellVersion {
  selector: string;
  /** Friendly label, v1 = oldest. */
  label: string;
  stage: WorkStage;
  /** Newest version of the story. */
  latest?: boolean;
}

export interface EpisodeShellOptions {
  /** Relative path from the page to the library root, ending in "/". */
  root: string;
  /** Relative path from the page to its episode directory ("" or "../"). */
  episodeDir?: string;
  /** Defaults to the Shorts list. */
  backHref?: string;
  title: string;
  id: string;
  selector: string;
  meta?: string;
  /** Library-relative poster path, or undefined for an initials tile. */
  thumbnail?: string;
  /** Newest first; includes the current selector. */
  versions: ShellVersion[];
  /** Prefix for the current version chip, for example "From " in the editor. */
  versionPrefix?: string;
  step: EpisodeStep | null;
  hasVideo: boolean;
  /** Steps 1–3 switch panes in place (edit.html) instead of linking to the editor. */
  inPageEditor?: boolean;
  /** Extra classes for the <header>. */
  className?: string;
  /** HTML placed before the actions (for example the editor's save status). */
  status?: string;
  /** HTML for the action group; on phones it becomes the fixed bottom action bar. */
  actions?: string;
  /** HTML placed right after the back link (for example the editor's outline toggle). */
  lead?: string;
  /**
   * Fetch live stages from /api/workflow (read-only). Only for pages whose CSP allows
   * connect-src 'self' and that do not already fetch the workflow themselves.
   */
  liveStages?: boolean;
  /** Episode-specific step summaries, for example "7 scenes · 55s". */
  stepSubs?: Partial<Record<EpisodeStep, string>>;
}

/** Short summaries shown beside each step on wide screens. */
export function episodeStepSubs(
  episode: Pick<ContentEpisode, "scenes" | "targetDurationSeconds" | "presentation">,
  durationSeconds?: number,
): Partial<Record<EpisodeStep, string>> {
  const speakers = episode.presentation?.speakers.map((speaker) => speaker.name) ?? [];
  return {
    script: `${episode.scenes.length} scenes · ${Math.round(durationSeconds ?? episode.targetDurationSeconds)}s`,
    voice: speakers.length ? speakers.join(" + ") : "Default narrator",
  };
}

const svg = (body: string, size = 16) =>
  `<svg class="ep-ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
export const shellIcons = {
  back: svg('<path d="m15 18-6-6 6-6"/>', 18),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', 14),
  check: svg('<path d="m5 12 4.5 4.5L19 7"/>', 14),
  lock: svg(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    13,
  ),
  eye: svg(
    '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  ),
  arrow: svg('<path d="m9 18 6-6-6-6"/>', 16),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  download: svg('<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>'),
  copy: svg(
    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  ),
  film: svg(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  ),
};

export const stageLabel = (stage: WorkStage) => workflowLabels[stage];

/**
 * Build time only knows whether a verified MP4 exists, not whether it was approved or is being
 * produced, so static labels stay neutral; pages that can reach /api/workflow replace them live.
 */
export const builtStageLabel = (stage: WorkStage) =>
  stage === "review" ? "Video produced" : stage === "editing" ? "Draft" : workflowLabels[stage];

/** Library-relative URL of the most useful page for one version. */
export const versionHref = (version: Pick<ShellVersion, "selector" | "stage">) =>
  workAction(version.stage, version.selector).href;

function versionSwitcher(options: EpisodeShellOptions) {
  const current = options.versions.find((version) => version.selector === options.selector);
  const label = current?.label ?? "v1";
  const stage = current?.stage ?? "editing";
  const chip = `<span class="ep-sr">Version </span>${esc(options.versionPrefix ?? "")}<b>${esc(label)}</b> · <span data-version-current-stage data-selector="${esc(options.selector)}">${esc(builtStageLabel(stage))}</span>`;
  if (options.versions.length < 2)
    return `<span class="ep-ver-chip" data-version-selector="${esc(options.selector)}">${chip}</span>`;
  const items = options.versions
    .map((version) => {
      const isCurrent = version.selector === options.selector;
      return `<li><a href="${esc(options.root + versionHref(version))}" data-version-selector="${esc(version.selector)}"${isCurrent ? ' aria-current="true"' : ""}><b>${esc(version.label)}</b><span class="ep-ver-sel">${esc(version.selector)}</span>${version.latest ? '<span class="ep-ver-tag">Latest</span>' : ""}${isCurrent ? '<span class="ep-ver-tag">This version</span>' : ""}<span class="ep-ver-stage" data-badge="${version.stage}" data-version-stage>${esc(builtStageLabel(version.stage))}</span></a></li>`;
    })
    .join("");
  return `<details class="ep-versions" data-version-menu><summary class="ep-ver-chip">${chip}<span class="ep-sr">, switch between ${options.versions.length} versions</span>${shellIcons.chevron}</summary><div class="ep-ver-menu"><p class="ep-ver-caption">${options.versions.length} versions · newest first</p><ul>${items}</ul></div></details>`;
}

function thumbnail(options: EpisodeShellOptions) {
  return options.thumbnail
    ? `<img class="ep-thumb" src="${esc(options.root + options.thumbnail)}" alt="" width="30" height="53">`
    : `<span class="ep-thumb" aria-hidden="true">${esc(options.id.split("-")[0] ?? "SAP")}</span>`;
}

/** The ordered step list. Locked steps are not links and explain why. */
export function episodeStepper(options: EpisodeShellOptions) {
  const states = episodeStepStates(options.step, options.hasVideo);
  const episodeDir = options.episodeDir ?? "";
  const items = episodeSteps.map((step, index) => {
    const state = states[step.id];
    const number = `<span class="ep-n" aria-hidden="true"><span class="ep-n-num">${index + 1}</span><span class="ep-n-check">${shellIcons.check}</span><span class="ep-n-lock">${shellIcons.lock}</span></span>`;
    const sub = state === "locked" ? reviewLockReason : (options.stepSubs?.[step.id] ?? step.sub);
    const text = `<span class="ep-stp-text"><span class="ep-stp-label">${esc(step.label)}</span><span class="ep-stp-sub"> · ${esc(sub)}</span></span><span class="ep-sr ep-stp-done">, completed</span>`;
    const common = `class="ep-stp" data-step="${step.id}" data-step-index="${index + 1}" data-step-state="${state}"${state === "current" ? ' aria-current="step"' : ""}`;
    if (state === "locked")
      return `<li><span ${common} aria-disabled="true" title="${esc(reviewLockReason)}">${number}${text}<span class="ep-sr">, locked</span></span></li>`;
    const href = step.fragment
      ? options.inPageEditor
        ? `#${step.fragment}`
        : `${episodeDir}edit.html#${step.fragment}`
      : `${episodeDir}publish.html`;
    const editor =
      options.inPageEditor && step.editorStep ? ` data-editor-step="${step.editorStep}"` : "";
    return `<li><a ${common}${editor} href="${esc(href)}">${number}${text}</a></li>`;
  });
  return `<nav class="ep-steps" aria-label="Episode steps"><ol>${items.join("")}</ol></nav>`;
}

/** Back link, story thumbnail, title, id, version switcher, status and the step's actions. */
export function episodeShellTop(options: EpisodeShellOptions) {
  const back = options.backHref ?? `${options.root}review.html#episodes`;
  return `<div class="ep-top"><a class="ep-back" href="${esc(back)}" aria-label="Back to Shorts">${shellIcons.back}<span class="ep-back-text">Shorts</span></a>${options.lead ?? ""}${thumbnail(options)}<div class="ep-id"><span class="ep-title" title="${esc(options.title)}">${esc(options.title)}</span><span class="ep-sub"><code class="ep-chip">${esc(options.id)}</code>${versionSwitcher(options)}${options.meta ? `<span class="ep-meta">${esc(options.meta)}</span>` : ""}</span></div><span class="ep-spacer"></span>${options.status ?? ""}${options.actions ? `<div class="ep-actions">${options.actions}</div>` : ""}</div>`;
}

export function episodeShell(options: EpisodeShellOptions) {
  return `<header class="ep-shell${options.className ? ` ${options.className}` : ""}"${options.liveStages ? " data-live-stages" : ""}>${episodeShellTop(options)}${episodeStepper(options)}</header>`;
}

export const episodeShellTemplates = [
  "templates/episode-shell.css",
  "templates/episode-shell.js",
] as const;

export async function episodeShellAssets() {
  const [css, script] = await Promise.all(
    episodeShellTemplates.map((name) => readFile(resolve(projectRoot, name), "utf8")),
  );
  return { css: css as string, script: script as string };
}
