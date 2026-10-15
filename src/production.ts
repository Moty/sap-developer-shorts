import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { readContentEpisode } from "./contracts.js";
import { hash } from "./digest.js";
import { isNewsEpisode } from "./domain.js";
import { buildLibrary } from "./library.js";
import type { MediaJob } from "./media/model.js";
import { neuralRuntime } from "./media/neural.js";
import { readCompletedNarration } from "./media/package.js";
import { reuseCompletedNarration } from "./media/reuse.js";
import { mediaNextAction } from "./media/status.js";
import { MediaStore } from "./media/store.js";
import {
  advanceMediaJob,
  mediaDatabase,
  planMediaEpisode,
  productionSettings,
  providerForJob,
} from "./media/worker.js";
import { validateNewsEpisode } from "./news/contracts.js";
import { inside, projectRoot } from "./paths.js";
import { episodeSelector, presentationLabel } from "./presentation.js";
import { renderVideo } from "./video/export.js";

const exec = promisify(execFile);
type Stage = "PREFLIGHT" | "NARRATION" | "RENDER" | "LIBRARY";
export interface ProductionReport {
  schemaVersion: 1;
  id: string;
  selector: string;
  stage: Stage | "READY" | "BLOCKED" | "FAILED";
  failedAt: Stage | null;
  startedAt: string;
  updatedAt: string;
  directory: string;
  mediaJobId: string | null;
  inputHash: string | null;
  voices: string[];
  presentation: string | null;
  narrationDirectory: string | null;
  audioReusedFrom: string | null;
  durationSeconds: number | null;
  hookSeconds: number | null;
  videoDirectory: string | null;
  libraryDirectory: string | null;
  reusedVideo: boolean;
  issue: { code: string; message: string; nextAction: string } | null;
}

export class ProductionBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextAction: string,
  ) {
    super(message);
  }
}

interface ProductionStages {
  preflight(): Promise<void>;
  narration(
    checkpoint: (job: MediaJob) => Promise<void>,
  ): Promise<{ job: MediaJob; durationSeconds: number; hookSeconds: number }>;
  render(mediaJobId: string): Promise<{ directory: string; mediaJobId: string; reused: boolean }>;
  library(mediaJobId: string): Promise<{ directory: string; mediaJobId: string }>;
}

function localStages(
  selector: string,
  artifactRoot: string,
  progress: (message: string) => void,
): ProductionStages {
  return {
    async preflight() {
      const episode = await readContentEpisode(selector);
      if (isNewsEpisode(episode)) {
        try {
          validateNewsEpisode(episode, { requireFresh: true });
        } catch (error) {
          throw new ProductionBlocked(
            "NEWS_REVIEW_REQUIRED",
            (error as Error).message,
            "Re-read the official sources and update the dated claim review; see docs/NEWS_WORKFLOW.md.",
          );
        }
      }
      const settings = await productionSettings();
      if (settings.localPreview.engine === "kokoro") {
        const voices = episode.presentation?.speakers.map((speaker) => speaker.voice) ?? [
          settings.localPreview.voice,
        ];
        try {
          await neuralRuntime(voices);
        } catch (error) {
          throw new ProductionBlocked(
            "VOICE_SETUP_REQUIRED",
            (error as Error).message,
            `npm run shorts -- voice-setup ${[...new Set(voices)].join(" ")}`,
          );
        }
      } else if (process.platform !== "darwin") {
        throw new ProductionBlocked(
          "VOICE_SETUP_REQUIRED",
          "The selected system narrator needs macOS.",
          "Select the local Kokoro engine and run voice-setup; see docs/VOICE_OPTIONS.md.",
        );
      }
      for (const binary of ["ffmpeg", "ffprobe"]) {
        try {
          await exec(binary, ["-version"], { timeout: 5000 });
        } catch {
          throw new ProductionBlocked(
            "VIDEO_TOOLS_REQUIRED",
            `${binary} is required before generating narration for an MP4.`,
            "Install FFmpeg and FFprobe, then rerun the same produce command.",
          );
        }
      }
    },
    async narration(checkpoint) {
      let job = await planMediaEpisode(selector, "local", "success", { artifactRoot });
      await checkpoint(job);
      const store = await MediaStore.open(mediaDatabase);
      try {
        job = await reuseCompletedNarration(store, job.id);
        if (job.audioReuse) progress("Reusing verified completed speech in a new package.");
        const provider = providerForJob(store, job);
        for (let step = 0; step < 200; step++) {
          if (job.phase === "SUCCEEDED") break;
          job = await advanceMediaJob(store, job.id, provider);
          await checkpoint(job);
          progress(`${job.phase}${job.progress ? `: ${job.progress}` : ""}`);
          if (
            [
              "SUCCEEDED",
              "FAILED",
              "SUBMISSION_UNKNOWN",
              "POLL_TIMEOUT",
              "PACKAGE_FAILED",
            ].includes(job.phase)
          )
            break;
        }
        if (job.phase !== "SUCCEEDED")
          throw new ProductionBlocked(
            `MEDIA_${job.phase}`,
            job.error ?? `Narration stopped at ${job.phase}.`,
            mediaNextAction(job),
          );
        const recorded = await readCompletedNarration(job);
        return {
          job,
          durationSeconds: recorded.timing.durationSeconds,
          hookSeconds: recorded.timing.scenes[0]?.speechSeconds ?? Infinity,
        };
      } finally {
        store.close();
      }
    },
    async render(mediaJobId) {
      const output = await renderVideo(selector, { artifactRoot, mediaJobId, progress });
      return {
        directory: output.directory,
        mediaJobId: output.receipt.mediaJobId as string,
        reused: output.reused,
      };
    },
    async library(mediaJobId) {
      const output = await buildLibrary({
        artifactRoot,
        selectedMediaJobs: { [selector]: mediaJobId },
      });
      const selected = output.manifest.episodes.find((entry) => entry.selector === selector);
      if (!selected?.video || selected.preview?.mediaJobId !== mediaJobId)
        throw new Error("The studio does not contain the selected narration and matching MP4");
      return { directory: output.directory, mediaJobId: selected.preview.mediaJobId };
    },
  };
}

export async function produce(
  selector: string,
  options: {
    artifactRoot?: string;
    progress?: (message: string) => void;
    stages?: Partial<ProductionStages>;
  } = {},
): Promise<ProductionReport> {
  if (!/^(ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}(?:@[a-z][a-z0-9-]{0,31})?$/u.test(selector))
    throw new Error("Invalid episode selector");
  const root = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );
  const id = randomUUID();
  const directory = inside(root, `productions/${id}`);
  await mkdir(directory, { recursive: true });
  const report: ProductionReport = {
    schemaVersion: 1,
    id,
    selector,
    stage: "PREFLIGHT",
    failedAt: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    directory,
    mediaJobId: null,
    inputHash: null,
    voices: [],
    presentation: null,
    narrationDirectory: null,
    audioReusedFrom: null,
    durationSeconds: null,
    hookSeconds: null,
    videoDirectory: null,
    libraryDirectory: null,
    reusedVideo: false,
    issue: null,
  };
  const save = async () => {
    report.updatedAt = new Date().toISOString();
    await writeFile(resolve(directory, "production.tmp"), `${JSON.stringify(report, null, 2)}\n`);
    await rename(resolve(directory, "production.tmp"), resolve(directory, "production.json"));
  };
  const progress = options.progress ?? (() => {});
  const stages = { ...localStages(selector, root, progress), ...options.stages };
  let current: Stage = "PREFLIGHT";
  const enter = async (stage: Stage) => {
    current = stage;
    report.stage = stage;
    await save();
    progress(stage);
  };
  try {
    await enter("PREFLIGHT");
    await stages.preflight();
    await enter("NARRATION");
    const narration = await stages.narration(async (job) => {
      report.mediaJobId = job.id;
      report.inputHash = hash(JSON.stringify(job.request.episode));
      report.voices = job.request.episode.presentation?.speakers.map(
        (speaker) => speaker.voice,
      ) ?? [job.request.settings.localPreview.voice];
      report.presentation = presentationLabel(job.request.episode);
      report.narrationDirectory = job.outputDirectory;
      report.audioReusedFrom = job.audioReuse?.jobId ?? null;
      await save();
    });
    const job = narration.job;
    if (
      job.phase !== "SUCCEEDED" ||
      episodeSelector(job.request.episode) !== selector ||
      job.request.provider === "fake"
    )
      throw new Error("Production requires completed local narration for the chosen episode");
    report.mediaJobId = job.id;
    report.inputHash = hash(JSON.stringify(job.request.episode));
    report.voices = job.request.episode.presentation?.speakers.map((speaker) => speaker.voice) ?? [
      job.request.settings.localPreview.voice,
    ];
    report.presentation = presentationLabel(job.request.episode);
    report.narrationDirectory = job.outputDirectory;
    report.audioReusedFrom = job.audioReuse?.jobId ?? null;
    report.durationSeconds = narration.durationSeconds;
    report.hookSeconds = narration.hookSeconds;
    await save();
    if (
      !Number.isFinite(narration.durationSeconds) ||
      narration.durationSeconds < 45 ||
      narration.durationSeconds > 60 ||
      !Number.isFinite(narration.hookSeconds) ||
      narration.hookSeconds <= 0 ||
      narration.hookSeconds > 3
    )
      throw new ProductionBlocked(
        "TIMING_REVIEW_REQUIRED",
        "The narration must run 45–60 seconds with an opening no longer than three seconds.",
        "Revise the spoken script or selected speed, then rerun produce; the saved recording remains available.",
      );
    await enter("RENDER");
    const video = await stages.render(job.id);
    if (video.mediaJobId !== job.id)
      throw new Error("MP4 uses a different narrator job than the production selected");
    report.videoDirectory = video.directory;
    report.reusedVideo = video.reused;
    await enter("LIBRARY");
    const library = await stages.library(job.id);
    if (library.mediaJobId !== job.id)
      throw new Error("Studio uses a different narrator job than the production selected");
    report.libraryDirectory = library.directory;
    report.stage = "READY";
    await save();
  } catch (error) {
    report.failedAt = current;
    report.stage = error instanceof ProductionBlocked ? "BLOCKED" : "FAILED";
    report.issue =
      error instanceof ProductionBlocked
        ? { code: error.code, message: error.message, nextAction: error.nextAction }
        : {
            code: `${current}_FAILED`,
            message: error instanceof Error ? error.message : "Production failed",
            nextAction: `Restore the reported prerequisite or inspect the saved logs, then run: npm run shorts -- produce ${selector}`,
          };
    await save();
  }
  return report;
}

export async function latestProduction(
  selector: string,
  artifactRoot?: string,
): Promise<ProductionReport | null> {
  await readContentEpisode(selector);
  const root = resolve(
    projectRoot,
    artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
    "productions",
  );
  const directories = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return [];
    },
  );
  let latest: ProductionReport | null = null;
  for (const item of directories) {
    if (!item.isDirectory() || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(item.name))
      continue;
    try {
      const record = JSON.parse(
        await readFile(resolve(root, item.name, "production.json"), "utf8"),
      ) as ProductionReport;
      if (
        record.schemaVersion === 1 &&
        record.selector === selector &&
        (!latest || record.startedAt > latest.startedAt)
      )
        latest = record;
    } catch {
      /* A stopped worker may not have finished its first atomic report. */
    }
  }
  return latest;
}
