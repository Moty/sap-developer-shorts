import { zipSync } from "fflate";
import { hash } from "./digest.js";
import { isNewsEpisode } from "./domain.js";
import type { LibraryEntry } from "./library.js";
import type { NarrationTiming } from "./media/model.js";
import { episodeSelector } from "./presentation.js";
import { recordedNarrator } from "./studio.js";

export interface PackageVideoReceipt {
  selector: string;
  inputHash: string;
  renderKey: string;
  mediaJobId: string;
  sourceManifestHash: string;
  sourceAudioHash: string;
  sourceCodeCommit?: string | null;
  updatedAt: string;
  artifactHashes: Record<string, string>;
  quality: { durationSeconds: number; decoded: boolean; audioChecked: boolean };
}

export interface EpisodeDownload {
  filename: string;
  bytes: Buffer;
  sha256: string;
  savedNews: boolean;
}

export function assertPackageReceipt(receipt: PackageVideoReceipt): void {
  const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  if (
    ![
      receipt.renderKey,
      receipt.inputHash,
      receipt.sourceManifestHash,
      receipt.sourceAudioHash,
    ].every(digest) ||
    !Number.isFinite(Date.parse(receipt.updatedAt)) ||
    !receipt.quality?.decoded ||
    !receipt.quality.audioChecked ||
    !Number.isFinite(receipt.quality.durationSeconds) ||
    receipt.quality.durationSeconds <= 0 ||
    (receipt.sourceCodeCommit != null &&
      (typeof receipt.sourceCodeCommit !== "string" ||
        !/^[a-f0-9]{40}$/u.test(receipt.sourceCodeCommit)))
  )
    throw new Error("Video receipt has invalid package provenance or quality metadata.");
}

export function buildEpisodePackage(entry: LibraryEntry, now = new Date()): EpisodeDownload | null {
  const video = entry.video;
  const preview = entry.preview;
  const receipt = video?.receipt;
  if (!video || !receipt || preview?.kind !== "narrated") return null;
  assertPackageReceipt(receipt);
  const selector = episodeSelector(entry.episode);
  const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  if (
    receipt.selector !== selector ||
    receipt.inputHash !== hash(JSON.stringify(entry.episode)) ||
    receipt.mediaJobId !== preview.mediaJobId ||
    receipt.sourceManifestHash !== preview.sourceManifestHash ||
    receipt.sourceAudioHash !== hash(preview.files["narration.wav"] ?? Buffer.alloc(0))
  )
    throw new Error("Episode package must match the selected verified video and narration.");

  const files: Record<string, Buffer> = {};
  for (const name of [
    "short.mp4",
    "poster.png",
    "captions.vtt",
    "publication-draft.txt",
    "review.html",
    "timing.json",
  ]) {
    const bytes = video.files[name];
    if (
      !bytes ||
      !digest(receipt.artifactHashes[name]) ||
      hash(bytes) !== receipt.artifactHashes[name]
    )
      throw new Error(`Episode package video artifact changed: ${name}`);
    files[name] = Buffer.from(bytes);
  }
  for (const name of ["captions.vtt", "timing.json"])
    if (hash(preview.files[name] ?? Buffer.alloc(0)) !== receipt.artifactHashes[name])
      throw new Error("Episode package captions and timing differ from the selected narration.");
  const timing: NarrationTiming = JSON.parse(files["timing.json"]?.toString("utf8") ?? "null");
  const news = isNewsEpisode(entry.episode) ? entry.episode : null;
  const validThrough = news
    ? new Date(Date.parse(`${news.news.asOf}T00:00:00Z`) + news.news.maxAgeDays * 86400000)
        .toISOString()
        .slice(0, 10)
    : null;
  const expired = news ? now.toISOString().slice(0, 10) > (validThrough as string) : false;
  const freshness = news
    ? `SOURCE REVIEW: ${news.news.asOf} (UTC date). Valid through ${validThrough} (UTC date).\n${expired ? "SOURCE RECHECK REQUIRED. Saved media only; re-read official sources before presenting this as current news." : "Re-read the official sources before sharing current news, especially after the review expires."}`
    : "Tutorial results refer to the frozen local demo verification used for this export.";
  const transcript = entry.episode.scenes
    .map((scene) => {
      const sceneTiming = timing.scenes.find((item) => item.id === scene.id);
      const words = scene.dialogue
        ? scene.dialogue
            .map(
              (turn) =>
                `${entry.episode.presentation?.speakers.find((speaker) => speaker.id === turn.speakerId)?.name}: ${turn.text}`,
            )
            .join("\n")
        : scene.narration;
      return `${sceneTiming?.startSeconds.toFixed(3)}–${sceneTiming?.endSeconds.toFixed(3)} seconds · ${scene.overlay}\n${words}`;
    })
    .join("\n\n");
  files["transcript.txt"] = Buffer.from(
    `${entry.episode.title}\n${selector} · revision ${entry.episode.version}\n\n${transcript}\n`,
  );
  files["sources.txt"] = Buffer.from(
    `${entry.episode.title}\n\n${freshness}\n\n${entry.episode.sources.map((source) => `${source.title}\n${source.url}\nReviewed: ${source.retrievedOn}`).join("\n\n")}\n\n${isNewsEpisode(entry.episode) ? entry.episode.claims.map((claim) => `${claim.text}\nAvailability: ${claim.availability.status}; ${claim.availability.timing}; ${claim.availability.scope}\nChecked: ${claim.checkedOn}`).join("\n\n") : entry.episode.claims.map((claim) => `${claim.text}\nLive evidence checks: ${claim.evidenceChecks.join(", ")}`).join("\n\n")}\n`,
  );
  files["README.txt"] = Buffer.from(
    `${entry.episode.title}\n${selector} · revision ${entry.episode.version}\n\nOpen short.mp4 in a media player. The review.html page provides a browser preview, transcript, and source links; serve it locally if your browser restricts local media files.\nNarrator: ${recordedNarrator(entry)}\nMeasured narration: ${timing.durationSeconds.toFixed(3)} seconds\nMP4 duration: ${receipt.quality.durationSeconds.toFixed(3)} seconds\nNarration engine: ${timing.engine ?? "system"}\nCaption alignment: ${timing.alignment ?? "measured system phrase boundaries"}\nAI-generated narration. ${entry.episode.presentation?.format === "dialogue" ? "Fictional AI hosts. " : ""}Stock avatar animation is pending.\nUNPUBLISHED. The companion text is a draft.\n\n${freshness}\n\nExport verified: ${receipt.updatedAt}\nPackage built: ${now.toISOString()}\nSee sources.txt, transcript.txt, timing.json and package-manifest.json for the saved details.\n`,
  );
  const notice = news
    ? `<p class="note"><strong>${expired ? "Saved export · source recheck required." : "Dated SAP news export."}</strong> Sources reviewed ${news.news.asOf}; valid through ${validThrough} (UTC dates). Re-read official sources before sharing current news.</p>`
    : "";
  files["review.html"] = Buffer.from(
    (files["review.html"] as Buffer).toString("utf8").replace("<!--LIBRARY_BACK-->", notice),
  );
  const artifactHashes = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
  );
  files["package-manifest.json"] = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "episode-download",
        selector,
        episodeVersion: entry.episode.version,
        inputHash: receipt.inputHash,
        renderKey: receipt.renderKey,
        mediaJobId: receipt.mediaJobId,
        sourceManifestHash: receipt.sourceManifestHash,
        sourceAudioHash: receipt.sourceAudioHash,
        sourceCodeCommit: receipt.sourceCodeCommit ?? null,
        exportVerifiedAt: receipt.updatedAt,
        packagedAt: now.toISOString(),
        narrator: recordedNarrator(entry),
        engine: timing.engine ?? "system",
        captionAlignment: timing.alignment ?? "measured-system-phrase-boundaries",
        sourceReview: news
          ? { asOf: news.news.asOf, validThrough, expiredAtPackageBuild: expired }
          : null,
        stockAvatar: "pending",
        published: false,
        artifactHashes,
      },
      null,
      2,
    )}\n`,
  );
  const prefix = `${selector.replace("@", "--")}-v${entry.episode.version}`;
  const total = Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0);
  if (total > 512 * 1024 * 1024)
    throw new Error("Episode package exceeds the supported 512 MiB size.");
  const archive = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [`${prefix}/${name}`, bytes]),
  );
  // Video and poster are already compressed. Fixed ZIP dates keep identical inputs reproducible.
  const bytes = Buffer.from(zipSync(archive, { level: 0, mtime: new Date(2000, 0, 1) }));
  return {
    filename: `${prefix}-${receipt.renderKey.slice(0, 8)}.zip`,
    bytes,
    sha256: hash(bytes),
    savedNews: expired,
  };
}
