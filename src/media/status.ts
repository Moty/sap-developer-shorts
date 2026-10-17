import { readContentEpisode } from "../contracts.js";
import { hash } from "../digest.js";
import type { ContentEpisode } from "../domain.js";
import { episodeSelector, presentationLabel } from "../presentation.js";
import type { MediaJob, ProductionSettings } from "./model.js";
import { MediaStore } from "./store.js";
import { hasClonedVoices, voiceKey, voiceLabel } from "./voice-reference.js";
import { mediaDatabase, productionSettings } from "./worker.js";

export function narrationSettingsMatch(
  job: MediaJob,
  episode: ContentEpisode,
  settings: ProductionSettings,
): boolean {
  const provider = hasClonedVoices(episode)
    ? "local-voices"
    : settings.localPreview.engine === "kokoro"
      ? "local-kokoro"
      : "local-speech";
  const voice = episode.presentation?.speakers[0]?.voice ?? settings.localPreview.voice;
  return (
    job.request.provider === provider &&
    (provider === "local-voices"
      ? job.request.schemaVersion === 2 &&
        JSON.stringify(job.request.voicePlan.map((item) => voiceKey(item.voice))) ===
          JSON.stringify(episode.presentation?.speakers.map((item) => voiceKey(item.voice)))
      : job.request.settings.localPreview.voice === voice) &&
    (provider === "local-kokoro"
      ? job.request.settings.localPreview.speed === settings.localPreview.speed
      : job.request.settings.localPreview.wordsPerMinute === settings.localPreview.wordsPerMinute)
  );
}

export function mediaNextAction(job: MediaJob): string {
  const selector = episodeSelector(job.request.episode);
  if (job.phase === "SIMULATED") return "Simulation complete; no narration was generated.";
  if (job.phase === "SUCCEEDED") return `npm run shorts -- render ${selector}`;
  if (job.phase === "FAILED")
    return `Inspect the saved failure with: npm run shorts -- media-status ${job.id}`;
  if (job.phase === "PACKAGE_PENDING" || job.phase === "PACKAGE_FAILED")
    return `npm run shorts -- media-package ${job.id}`;
  if (job.phase === "SUBMISSION_UNKNOWN" || job.phase === "SUBMITTING")
    return `Reconcile without resubmitting: npm run shorts -- media-step ${job.id}`;
  return `Resume the saved job: npm run shorts -- media-step ${job.id}`;
}

export async function listMediaJobs(selector?: string, database = mediaDatabase) {
  // Resolve the selector before touching the database so typos do not hide saved jobs.
  const selected = selector ? await readContentEpisode(selector) : undefined;
  const settings = await productionSettings();
  const current = new Map<string, ContentEpisode | null>();
  if (selected) current.set(episodeSelector(selected), selected);
  const jobs = await MediaStore.readJobs(database);
  const result = [];
  for (const job of jobs) {
    const key = episodeSelector(job.request.episode);
    if (selected && key !== episodeSelector(selected)) continue;
    if (!current.has(key)) {
      try {
        current.set(key, await readContentEpisode(key));
      } catch {
        current.set(key, null);
      }
    }
    const episode = current.get(key);
    const scriptMatches =
      !!episode && hash(JSON.stringify(episode)) === hash(JSON.stringify(job.request.episode));
    result.push({
      id: job.id,
      selector: key,
      phase: job.phase,
      provider: job.request.provider,
      voices: job.request.episode.presentation?.speakers.map((speaker) =>
        voiceLabel(speaker.voice),
      ) ?? [job.request.settings.localPreview.voice],
      style: presentationLabel(job.request.episode),
      updatedAt: job.updatedAt,
      scriptMatches,
      settingsMatch: !!episode && narrationSettingsMatch(job, episode, settings),
      generatorFingerprint: job.request.generatorHash ? "recorded" : "legacy-unrecorded",
      retryOf: job.retryOf ?? null,
      billedCents: job.billedCents,
      outputDirectory: job.outputDirectory,
      error: job.error,
      nextAction: !episode
        ? "Restore the saved draft before producing another video."
        : !scriptMatches
          ? `Current draft changed: npm run shorts -- narrate ${key}`
          : mediaNextAction(job),
    });
  }
  return result;
}
