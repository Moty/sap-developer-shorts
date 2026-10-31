import { readdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { inside } from "./paths.js";

export type GenerationStage = "PREFLIGHT" | "NARRATION" | "RENDER";
export interface GenerationTiming {
  totalMs: number;
  completedAt?: string;
  stages: Partial<
    Record<GenerationStage, { startedAt: string; completedAt?: string; elapsedMs: number }>
  >;
}

export interface GenerationSummary {
  totalMs: number;
  basis: "generation" | "legacy-run";
  stages?: { preparationMs: number; audioMs: number; videoMs: number };
  reusedAudio: boolean;
  reusedVideo: boolean;
}

interface RecordedProduction {
  schemaVersion: number;
  selector: string;
  stage: string;
  startedAt: string;
  updatedAt: string;
  inputHash: string | null;
  mediaJobId: string | null;
  videoDirectory: string | null;
  generationTiming?: GenerationTiming;
  reusedAudio?: boolean;
  audioReusedFrom?: string | null;
  reusedVideo: boolean;
}

const validMs = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function formatGenerationTime(milliseconds: number): string {
  if (!validMs(milliseconds)) return "Unavailable";
  if (milliseconds < 1000) return "<1s";
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", rest ? `${rest}s` : ""]
    .filter(Boolean)
    .join(" ");
}

export function summarizeGeneration(report: RecordedProduction): GenerationSummary | null {
  const timing = report.generationTiming;
  const preparation = timing?.stages?.PREFLIGHT;
  const audio = timing?.stages?.NARRATION;
  const video = timing?.stages?.RENDER;
  if (
    timing?.completedAt &&
    Number.isFinite(Date.parse(timing.completedAt)) &&
    validMs(timing.totalMs) &&
    preparation?.completedAt &&
    audio?.completedAt &&
    video?.completedAt &&
    validMs(preparation.elapsedMs) &&
    validMs(audio.elapsedMs) &&
    validMs(video.elapsedMs)
  )
    return {
      totalMs: timing.totalMs,
      basis: "generation",
      stages: {
        preparationMs: preparation.elapsedMs,
        audioMs: audio.elapsedMs,
        videoMs: video.elapsedMs,
      },
      reusedAudio: report.reusedAudio === true || !!report.audioReusedFrom,
      reusedVideo: report.reusedVideo === true,
    };
  // Older reports contain only overall timestamps. Do not invent a phase breakdown.
  if (report.stage !== "READY") return null;
  const totalMs = Date.parse(report.updatedAt) - Date.parse(report.startedAt);
  return validMs(totalMs)
    ? {
        totalMs,
        basis: "legacy-run",
        reusedAudio: report.reusedAudio === true || !!report.audioReusedFrom,
        reusedVideo: report.reusedVideo === true,
      }
    : null;
}

export async function readGenerationReports(artifactRoot: string): Promise<RecordedProduction[]> {
  const directory = resolve(artifactRoot, "productions");
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return [];
    },
  );
  const reports: RecordedProduction[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(entry.name))
      continue;
    try {
      const path = inside(
        await realpath(directory),
        await realpath(resolve(directory, entry.name, "production.json")),
      );
      const report = JSON.parse(await readFile(path, "utf8")) as RecordedProduction;
      if (
        report.schemaVersion === 1 &&
        ["READY", "LIBRARY"].includes(report.stage) &&
        typeof report.startedAt === "string" &&
        Number.isFinite(Date.parse(report.startedAt))
      ) {
        const videoDirectory = report.videoDirectory;
        if (typeof videoDirectory === "string")
          report.videoDirectory = await realpath(videoDirectory).catch(() => videoDirectory);
        reports.push(report);
      }
    } catch {
      // Interrupted or unavailable reports must not hide otherwise verified media.
    }
  }
  return reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function generationForOutput(
  reports: RecordedProduction[],
  output: { selector: string; inputHash: string; mediaJobId: string; videoDirectory: string },
): GenerationSummary | null {
  for (const report of reports) {
    if (
      report.selector === output.selector &&
      report.inputHash === output.inputHash &&
      report.mediaJobId === output.mediaJobId &&
      report.videoDirectory === output.videoDirectory
    ) {
      const summary = summarizeGeneration(report);
      if (summary) return summary;
    }
  }
  return null;
}

export function generationTimingHtml(summary: GenerationSummary | undefined): string {
  if (!summary)
    return '<section aria-label="Generation time"><h2>Generation time</h2><p>Timing was not recorded for this output.</p></section>';
  const detail = summary.stages;
  return `<section aria-label="Generation time"><h2>Generation time</h2><p><strong>${summary.basis === "generation" ? "Total to MP4" : "Total recorded run"}: ${formatGenerationTime(summary.totalMs)}</strong></p>${detail ? `<dl><dt>Preparation</dt><dd>${formatGenerationTime(detail.preparationMs)}</dd><dt>Audio &amp; captions${summary.reusedAudio ? " · reused" : ""}</dt><dd>${formatGenerationTime(detail.audioMs)}</dd><dt>Video &amp; portrait${summary.reusedVideo ? " · reused" : ""}</dt><dd>${formatGenerationTime(detail.videoMs)}</dd></dl><p class="note">Measured on the machine that ran this production, through the verified MP4. Studio packaging is excluded. Audio includes caption alignment; video includes portrait animation, encoding and checks.</p>` : `<p class="note">This older run saved only overall start and finish times, including studio packaging. Audio and video times were not recorded separately.${summary.reusedAudio || summary.reusedVideo ? " This run reused saved media." : ""}</p>`}${detail && (summary.reusedAudio || summary.reusedVideo) ? '<p class="note">Reused stages show retrieval and verification time, rather than a fresh generation.</p>' : ""}</section>`;
}

/** Stacked bar and legend for the Review & publish details; the same totals as the text list. */
export function generationTimingBar(summary: GenerationSummary | undefined): string {
  const detail = summary?.stages;
  if (!summary || !detail) return generationTimingHtml(summary);
  const parts = [
    ["prep", "Preparation", detail.preparationMs, false],
    ["audio", "Audio &amp; captions", detail.audioMs, summary.reusedAudio],
    ["video", "Video &amp; portrait", detail.videoMs, summary.reusedVideo],
  ] as const;
  const total = parts.reduce((sum, [, , ms]) => sum + ms, 0) || 1;
  return `<section class="gen-time" aria-label="Generation time"><h3>Generation time</h3><p><strong>${summary.basis === "generation" ? "Total to MP4" : "Total recorded run"}: ${formatGenerationTime(summary.totalMs)}</strong></p><div class="gen-bar" aria-hidden="true">${parts.map(([key, , ms]) => `<i class="gen-${key}" style="flex-grow:${((ms / total) * 100).toFixed(2)}"></i>`).join("")}</div><ul class="gen-legend">${parts.map(([key, label, ms, reused]) => `<li><i class="gen-${key}" aria-hidden="true"></i>${label}${reused ? " · reused" : ""} <b>${formatGenerationTime(ms)}</b></li>`).join("")}</ul><p class="note">Measured on the machine that ran this production, through the verified MP4. Studio packaging is excluded. Audio includes caption alignment; video includes portrait animation, encoding and checks.</p>${summary.reusedAudio || summary.reusedVideo ? '<p class="note">Reused stages show retrieval and verification time, rather than a fresh generation.</p>' : ""}</section>`;
}
