import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readContentEpisode, validateContent } from "./contracts.js";
import { hash } from "./digest.js";
import { type ContentEpisode, isNewsEpisode, type NewsTopic, type Topic } from "./domain.js";
import {
  assertPackageReceipt,
  buildEpisodePackage,
  type EpisodeDownload,
  type PackageVideoReceipt,
} from "./episode-package.js";
import {
  type GenerationSummary,
  generationForOutput,
  readGenerationReports,
} from "./generation-timing.js";
import { createLibraryPages } from "./library-review.js";
import { buildVtt, readPcmWav } from "./media/audio.js";
import { validateTiming } from "./media/package.js";
import { verifiedKokoroVoices } from "./media/voice-assets.js";
import { collectVoiceSamples, type VoiceSample } from "./media/voice-audition.js";
import { episodeVoiceDescription } from "./media/voice-display.js";
import { hasClonedVoices } from "./media/voice-reference.js";
import { loadVerifiedRun, productionSettings } from "./media/worker.js";
import { inside, projectRoot, sourceFile } from "./paths.js";
import { episodeSelector, episodeSourceFiles } from "./presentation.js";
import { readRuntimeFiles } from "./provenance.js";
import { assertVideoQuality, readVideoReceipt } from "./video/receipt.js";

export interface LibraryPreview {
  kind: "narrated" | "storyboard";
  durationSeconds: number;
  timingReady: boolean;
  sourceRunId: string;
  sourceManifestHash: string;
  mediaJobId: string | null;
  updatedAt: string;
  files: Record<string, Buffer>;
}

export interface LibraryEntry {
  episode: ContentEpisode;
  preview: LibraryPreview | null;
  sourceReviewExpired: boolean;
  video?: {
    directory?: string;
    renderKey: string;
    durationSeconds: number;
    files: Record<string, Buffer>;
    receipt?: PackageVideoReceipt;
  };
  download?: EpisodeDownload;
  recordedVoiceLabel?: string;
  generation?: GenerationSummary;
}

export interface LibraryContent {
  entries: LibraryEntry[];
  topics: Topic[];
  newsTopics: NewsTopic[];
  budgetCents: number;
  voiceCatalog?: {
    selected: string;
    installed: string[];
    available?: string[];
    samples: VoiceSample[];
  };
}

async function readConfined(directory: string, name: string) {
  const artifactDirectory = await realpath(directory);
  return readFile(inside(artifactDirectory, await realpath(inside(artifactDirectory, name))));
}

async function readHashed(directory: string, name: string, expected: unknown) {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected))
    throw new Error("Missing artifact digest");
  const bytes = await readConfined(directory, name);
  if (hash(bytes) !== expected) throw new Error("Artifact digest differs");
  return bytes;
}

export async function collectLibrary(
  episodes: ContentEpisode[],
  artifactRoot: string,
  now = new Date(),
  selectedMediaJobs: Record<string, string> = {},
): Promise<{ entries: LibraryEntry[]; excludedRuns: number }> {
  const entries: LibraryEntry[] = episodes.map((episode) => ({
    episode: structuredClone(episode),
    preview: null,
    sourceReviewExpired:
      isNewsEpisode(episode) &&
      Date.parse(now.toISOString().slice(0, 10)) - Date.parse(episode.news.asOf) >
        episode.news.maxAgeDays * 86400000,
  }));
  let directories: Dirent[];
  try {
    directories = await readdir(artifactRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries, excludedRuns: 0 };
    throw error;
  }
  let excludedRuns = 0;
  const generationReports = await readGenerationReports(artifactRoot);
  for (const candidate of directories) {
    if (
      !candidate.isDirectory() ||
      !/^(ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}-v\d+-[a-f0-9-]+$/u.test(candidate.name)
    )
      continue;
    const directory = await realpath(resolve(artifactRoot, candidate.name));
    try {
      const run = await loadVerifiedRun(directory, { requireFreshNews: false });
      const entry = entries.find(
        (item) => episodeSelector(item.episode) === episodeSelector(run.episode),
      );
      if (
        !entry ||
        run.manifest.episodeId !== entry.episode.id ||
        run.manifest.episodeVersion !== entry.episode.version ||
        run.manifest.inputHash !== hash(JSON.stringify(entry.episode)) ||
        !Number.isFinite(Date.parse(run.manifest.updatedAt))
      )
        continue;
      const previews: LibraryPreview[] = [
        {
          kind: "storyboard",
          durationSeconds: entry.episode.targetDurationSeconds,
          timingReady: false,
          sourceRunId: candidate.name,
          sourceManifestHash: run.manifestHash,
          mediaJobId: null,
          updatedAt: run.manifest.updatedAt,
          files: {
            "review.html": await readHashed(
              directory,
              "review.html",
              run.manifest.artifactHashes["review.html"],
            ),
          },
        },
      ];
      const media = resolve(directory, "media");
      const jobs = await readdir(media, { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return [];
        },
      );
      for (const job of jobs) {
        if (!job.isDirectory() || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(job.name))
          continue;
        const selectedJob = selectedMediaJobs[episodeSelector(entry.episode)];
        if (selectedJob && job.name !== selectedJob) continue;
        try {
          const output = inside(directory, await realpath(resolve(media, job.name)));
          const receipt = JSON.parse(
            (await readConfined(output, "media-manifest.json")).toString("utf8"),
          );
          if (
            receipt.schemaVersion !== 1 ||
            receipt.jobId !== job.name ||
            receipt.sourceManifestHash !== run.manifestHash ||
            receipt.mode !== "local-narration-preview"
          )
            throw new Error("Media receipt does not match this run");
          const files: Record<string, Buffer> = {};
          for (const name of ["review.html", "narration.wav", "timing.json", "captions.vtt"])
            files[name] = await readHashed(output, name, receipt.artifactHashes?.[name]);
          const timing = validateTiming(
            JSON.parse(files["timing.json"]?.toString("utf8") ?? "null"),
            entry.episode,
            readPcmWav(files["narration.wav"] ?? Buffer.alloc(0)).length / 2,
          );
          if (files["captions.vtt"]?.toString("utf8") !== buildVtt(timing.cues))
            throw new Error("Narration captions differ from the timing");
          const hook = timing.scenes[0]?.speechSeconds ?? Infinity;
          previews.push({
            kind: "narrated",
            durationSeconds: timing.durationSeconds,
            timingReady: timing.durationSeconds >= 45 && timing.durationSeconds <= 60 && hook <= 3,
            sourceRunId: candidate.name,
            sourceManifestHash: run.manifestHash,
            mediaJobId: job.name,
            updatedAt: run.manifest.updatedAt,
            files,
          });
        } catch {
          excludedRuns++;
        }
      }
      for (const preview of previews) {
        if (selectedMediaJobs[episodeSelector(entry.episode)] && preview.kind !== "narrated")
          continue;
        const current = entry.preview;
        if (
          !current ||
          (preview.kind === "narrated" && current.kind === "storyboard") ||
          (preview.kind === current.kind && preview.updatedAt > current.updatedAt)
        )
          entry.preview = preview;
      }
    } catch {
      excludedRuns++;
    }
  }
  entries.sort(
    (a, b) =>
      (b.preview?.updatedAt ?? "").localeCompare(a.preview?.updatedAt ?? "") ||
      a.episode.id.localeCompare(b.episode.id),
  );
  for (const entry of entries) {
    if (entry.preview?.kind !== "narrated") continue;
    const directory = resolve(
      artifactRoot,
      "videos",
      episodeSelector(entry.episode).replace("@", "--"),
    );
    const exports = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return [];
      },
    );
    let latest = "";
    for (const candidate of exports) {
      if (!candidate.isDirectory() || !/^video-[a-f0-9]{16}$/u.test(candidate.name)) continue;
      try {
        const videoRoot = inside(
          await realpath(artifactRoot),
          await realpath(resolve(directory, candidate.name)),
        );
        const { receipt, files } = await readVideoReceipt(videoRoot);
        assertPackageReceipt(receipt);
        assertVideoQuality(receipt.quality, entry.preview.durationSeconds);
        if (
          receipt.selector !== episodeSelector(entry.episode) ||
          receipt.inputHash !== hash(JSON.stringify(entry.episode)) ||
          receipt.mediaJobId !== entry.preview.mediaJobId ||
          receipt.sourceManifestHash !== entry.preview.sourceManifestHash ||
          receipt.sourceAudioHash !== hash(entry.preview.files["narration.wav"] as Buffer) ||
          receipt.artifactHashes["timing.json"] !==
            hash(entry.preview.files["timing.json"] as Buffer) ||
          receipt.artifactHashes["captions.vtt"] !==
            hash(entry.preview.files["captions.vtt"] as Buffer) ||
          typeof receipt.updatedAt !== "string" ||
          !Number.isFinite(Date.parse(receipt.updatedAt)) ||
          receipt.updatedAt <= latest
        )
          continue;
        entry.video = {
          directory: videoRoot,
          renderKey: receipt.renderKey,
          durationSeconds: receipt.quality.durationSeconds,
          files,
          receipt,
        };
        latest = receipt.updatedAt;
      } catch {
        excludedRuns++;
      }
    }
    if (entry.video?.directory && entry.preview.mediaJobId) {
      const summary = generationForOutput(generationReports, {
        selector: episodeSelector(entry.episode),
        inputHash: hash(JSON.stringify(entry.episode)),
        mediaJobId: entry.preview.mediaJobId,
        videoDirectory: entry.video.directory,
      });
      if (summary) entry.generation = summary;
    }
  }
  return { entries, excludedRuns };
}

export async function buildLibrary(
  options: {
    artifactRoot?: string;
    now?: Date;
    selectedMediaJobs?: Record<string, string>;
    stockOnly?: boolean;
  } = {},
) {
  const now = options.now ?? new Date();
  const artifactRoot = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );
  const content = await validateContent();
  const episodes = [...content.episodes, ...content.variants].filter(
    (episode) => !options.stockOnly || !hasClonedVoices(episode),
  );
  const library = await collectLibrary(episodes, artifactRoot, now, options.selectedMediaJobs);
  for (const [selector, id] of Object.entries(options.selectedMediaJobs ?? {}))
    if (
      library.entries.find((entry) => episodeSelector(entry.episode) === selector)?.preview
        ?.mediaJobId !== id
    )
      throw new Error(
        `Selected narration ${id} for ${selector} is unavailable; rebuild after restoring the package`,
      );
  const settings = await productionSettings();
  const voiceCatalog = await collectVoiceSamples(artifactRoot, settings);
  const availableVoices =
    settings.localPreview.engine === "kokoro" ? await verifiedKokoroVoices() : [];
  for (const entry of library.entries) {
    if (entry.preview?.kind === "narrated" && hasClonedVoices(entry.episode))
      entry.recordedVoiceLabel = await episodeVoiceDescription(entry.episode);
    const download = buildEpisodePackage(entry, now);
    if (download) entry.download = download;
  }
  const sourceHashes: Record<string, string> = {};
  for (const name of [
    "templates/library.css",
    "templates/library.js",
    "templates/script-editor.css",
    "templates/script-editor.js",
    "templates/voice-profiles.js",
    "config/production.json",
    "content/topics/backlog.json",
    "content/news/backlog.json",
    ...episodes.flatMap(episodeSourceFiles),
  ])
    sourceHashes[name] = hash(await readFile(await sourceFile(name)));
  for (const episode of episodes) {
    const current = await readContentEpisode(episodeSelector(episode));
    if (hash(JSON.stringify(current)) !== hash(JSON.stringify(episode)))
      throw new Error("Editorial input changed while building the library; run again");
  }
  const files = await createLibraryPages({
    ...library,
    topics: content.topics,
    newsTopics: content.newsTopics,
    budgetCents: settings.pilotBudgetCents,
    voiceCatalog: {
      ...voiceCatalog,
      selected: settings.localPreview.voice,
      available: availableVoices,
    },
  });
  const runtimeHashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(await readRuntimeFiles()))
    runtimeHashes[name] = hash(bytes);
  const id = `library-${randomUUID()}`;
  const temporary = resolve(artifactRoot, `.${id}`);
  const directory = resolve(artifactRoot, id);
  await mkdir(temporary, { recursive: true });
  const artifactHashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    const destination = inside(temporary, name);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
    artifactHashes[name] = hash(bytes);
  }
  for (const [name, expected] of Object.entries({ ...sourceHashes, ...runtimeHashes })) {
    if (hash(await readFile(await sourceFile(name))) !== expected)
      throw new Error(`Library input changed: ${name}; run again`);
  }
  const manifest = {
    schemaVersion: 1,
    kind: "review-library",
    ...(episodes.some(hasClonedVoices) ? { localOnly: true } : {}),
    builtAt: now.toISOString(),
    sourceHashes,
    runtimeHashes,
    artifactHashes,
    excludedRuns: library.excludedRuns,
    episodePackages: library.entries
      .filter((entry) => entry.download)
      .map((entry) => ({
        selector: episodeSelector(entry.episode),
        filename: entry.download?.filename,
        sha256: entry.download?.sha256,
      })),
    voiceSamples: voiceCatalog.samples.map(({ key, identity, audioHash, durationSeconds }) => ({
      key,
      identity,
      audioHash,
      durationSeconds,
    })),
    episodes: library.entries.map(
      ({ episode, preview, sourceReviewExpired, video, generation }) => ({
        id: episode.id,
        selector: episodeSelector(episode),
        ...(hasClonedVoices(episode) ? { localOnly: true } : {}),
        ...(generation ? { generation } : {}),
        ...(video
          ? { video: { renderKey: video.renderKey, durationSeconds: video.durationSeconds } }
          : {}),
        version: episode.version,
        inputHash: hash(JSON.stringify(episode)),
        sourceReviewExpired,
        preview: preview
          ? {
              kind: preview.kind,
              sourceRunId: preview.sourceRunId,
              sourceManifestHash: preview.sourceManifestHash,
              mediaJobId: preview.mediaJobId,
              durationSeconds: preview.durationSeconds,
              timingReady: preview.timingReady,
            }
          : null,
      }),
    ),
  };
  await writeFile(
    resolve(temporary, "library-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rename(temporary, directory);
  return { directory, manifest };
}
