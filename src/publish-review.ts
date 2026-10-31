import { isNewsEpisode } from "./domain.js";
import { shellIcons } from "./episode-shell.js";
import { generationTimingBar } from "./generation-timing.js";
import type { LibraryEntry } from "./library.js";
import { newsReviewNotice, validThrough } from "./news/freshness.js";
import { episodeSelector, presentationLabel } from "./presentation.js";
import { escapeHtml as esc } from "./review.js";
import { recordedNarrator } from "./studio.js";

export interface ReleaseShell {
  /** The shared episode header (episodeShell). */
  header: string;
  css: string;
  script: string;
}

/** Companion posts are written for LinkedIn, which accepts 3,000 characters. */
export const postCharacterLimit = 3000;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

interface SceneWindow {
  start: number;
  end: number;
}

/** Measured scene windows from the saved narration timing, or null when unavailable. */
export function measuredScenes(entry: LibraryEntry): SceneWindow[] | null {
  try {
    const timing = JSON.parse(entry.preview?.files["timing.json"]?.toString("utf8") ?? "null");
    if (!Array.isArray(timing?.scenes)) return null;
    const windows: SceneWindow[] = [];
    for (const scene of entry.episode.scenes) {
      const measured = timing.scenes.find((item: { id?: unknown }) => item?.id === scene.id);
      const start = Number(measured?.startSeconds);
      const end = Number(measured?.endSeconds);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
        return null;
      windows.push({ start, end });
    }
    return windows;
  } catch {
    return null;
  }
}

/** The four concrete checks behind "Approve video"; all must be ticked. */
export function reviewChecks(entry: LibraryEntry): { id: string; label: string; hint: string }[] {
  const { episode } = entry;
  const sources = `${episode.sources.length} ${episode.sources.length === 1 ? "source" : "sources"}`;
  return [
    {
      id: "speech",
      label: "Speech sounds natural",
      hint: "Pronunciation, pacing and pauses across the whole short",
    },
    {
      id: "face",
      label: "Face and lip movement look right",
      hint: "The presenter moves with the voice in every scene",
    },
    {
      id: "captions",
      label: "Captions match what is said",
      hint: `Wording and timing in all ${episode.scenes.length} scenes`,
    },
    {
      id: "facts",
      label: "Facts match the sources",
      hint: isNewsEpisode(episode)
        ? `${sources} · review valid through ${validThrough(episode.news) ?? "unknown"} (UTC)`
        : `Verified local demo and ${sources}`,
    },
  ];
}

function chapterList(entry: LibraryEntry, windows: SceneWindow[] | null) {
  if (!windows) return "";
  const items = entry.episode.scenes.map((scene, index) => {
    const { start, end } = windows[index] as SceneWindow;
    return `<li style="flex-grow:${(end - start).toFixed(2)}"><button type="button" data-seek="${start.toFixed(3)}" data-label="${esc(scene.overlay)}" title="${clock(start)} · ${esc(scene.overlay)}"><span class="ep-sr">Chapter ${index + 1}, ${clock(start)}: ${esc(scene.overlay)}</span></button></li>`;
  });
  return `<ol class="rv-chapters" data-chapters hidden aria-label="Chapters">${items.join("")}</ol><p class="rv-chapter-now" data-chapter-now hidden></p>`;
}

export function publishReview(
  entry: LibraryEntry,
  css: string,
  script: string,
  head: string,
  shell?: ReleaseShell,
) {
  const { episode } = entry;
  const selector = episodeSelector(episode);
  const windows = measuredScenes(entry);
  const duration = entry.video?.durationSeconds ?? entry.preview?.durationSeconds ?? 0;
  const post = episode.publication.text;
  const speaker = (id: string) =>
    episode.presentation?.speakers.find((item) => item.id === id)?.name ?? id;
  const transcript = `<ol class="rv-transcript">${episode.scenes
    .map((scene, index) => {
      const start = windows?.[index]?.start ?? scene.startSeconds;
      const lines = scene.dialogue
        ? scene.dialogue
            .map((turn) => `<p><b>${esc(speaker(turn.speakerId))}:</b> ${esc(turn.text)}</p>`)
            .join("")
        : `<p>${esc(scene.narration)}</p>`;
      return `<li><span class="rv-time" title="${windows ? "Measured start" : "Planned start"}">${clock(start)}</span><div><b>${esc(scene.overlay)}</b>${lines}</div></li>`;
    })
    .join("")}</ol>`;
  // The only source-review notice on this page (the copied player keeps its own).
  const sources = `${isNewsEpisode(episode) ? newsReviewNotice(episode.news, entry.sourceReviewExpired) : ""}<ul class="rv-sources">${episode.sources.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} <span aria-hidden="true">↗</span></a><small>Read ${esc(source.retrievedOn)}</small></li>`).join("")}</ul>`;
  const quality = entry.video?.receipt?.quality;
  const measurements = quality
    ? `<dl class="rv-facts"><div><dt>Decode / audio checks</dt><dd>${quality.decoded && quality.audioChecked ? "Passed at export" : "Unavailable"}</dd></div>${[
        [
          "Resolution",
          quality.width && quality.height ? `${quality.width} × ${quality.height}` : null,
        ],
        ["Frame rate", quality.fps],
        ["Integrated loudness (LUFS)", quality.integratedLufs],
        ["True peak (dB)", quality.truePeakDb],
        ["Caption alignment", quality.captions],
      ]
        .filter(([, value]) => value != null)
        .map(
          ([label, value]) =>
            `<div><dt>${esc(String(label))}</dt><dd>${esc(String(value))}</dd></div>`,
        )
        .join("")}</dl>`
    : "<p>No saved technical measurements for this export.</p>";
  const outputReview = `<section class="rv-card" id="output-review"><h2>Finished-video review</h2>${measurements}<p>Export checks measure file integrity and audio format. Naturalness, lip sync and visual quality still need watching and listening.</p><details><summary>Get an external AI review (Gemini or another video reviewer)</summary><p>Download this exact MP4 and its review kit, then upload them yourself to your chosen reviewer. The kit contains transcript, source links and companion text; no voice samples or photo originals. Nothing is uploaded automatically.</p><button type="button" class="secondary-action" id="review-kit-download">Download review kit</button> <a href="video/short.mp4" download>Download exact MP4</a><label for="output-review-json">Paste the reviewer’s JSON response</label><textarea id="output-review-json" rows="5" placeholder="Use the responseTemplate in the kit"></textarea><button type="button" class="secondary-action" id="output-review-import">Save advisory review</button></details><p id="output-review-status" role="status"></p><div id="output-review-findings"></div></section>`;
  let reuseNote = "";
  try {
    const reuse = JSON.parse(
      entry.preview?.files["timing.json"]?.toString("utf8") ?? "null",
    )?.sceneReuse;
    if (reuse && [reuse.reused, reuse.generated, reuse.checkpoint].every(Number.isInteger))
      reuseNote = `<p>Original stock recording provenance: ${reuse.reused} scenes reused from verified cache · ${reuse.generated} generated · ${reuse.checkpoint} resumed checkpoints. These counts describe the saved recording, including when a later job reuses the whole track.</p>`;
  } catch {
    /* Older exports have no scene-cache measurements. */
  }
  const details = `${generationTimingBar(entry.generation)}${reuseNote}<dl class="rv-facts"><div><dt>Length</dt><dd>${duration.toFixed(1)} seconds</dd></div><div><dt>Version</dt><dd><code>${esc(selector)}</code></dd></div><div><dt>Style</dt><dd>${esc(presentationLabel(episode))}</dd></div><div><dt>Voice</dt><dd>${esc(recordedNarrator(entry))}</dd></div></dl>`;
  const panels = [
    ["transcript", "Transcript", transcript],
    ["sources", "Sources", sources],
    ["details", "Details", details],
  ] as const;
  // Without scripts the tab list stays hidden and all three panels are shown in order.
  const tabs = `<section class="rv-card rv-info" aria-label="About this video" data-release-tabs><div class="rv-tablist" role="tablist" aria-label="About this video" hidden>${panels.map(([id, label], index) => `<button type="button" role="tab" id="release-tab-${id}" aria-controls="release-panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join("")}</div>${panels.map(([id, label, body]) => `<section class="rv-panel" id="release-panel-${id}" aria-labelledby="release-heading-${id}"><h2 class="rv-panel-heading" id="release-heading-${id}">${label}</h2>${body}</section>`).join("")}</section>`;
  const checks = reviewChecks(entry)
    .map(
      (check) =>
        `<label class="rcheck"><input type="checkbox" data-review-check="${check.id}"><span>${esc(check.label)}<small>${esc(check.hint)}</small></span></label>`,
    )
    .join("");
  const stepNumber = (index: number) =>
    `<span class="pub-n" aria-hidden="true"><span class="pub-n-num">${index}</span><span class="pub-n-check">${shellIcons.check}</span><span class="pub-n-lock">${shellIcons.lock}</span></span>`;
  const characters = `${[...post].length.toLocaleString("en-US")} / ${postCharacterLimit.toLocaleString("en-US")} characters`;
  return `<!doctype html><html lang="en"><head>${head}<title>Review & publish · ${esc(episode.title)}</title><style>${css}${shell ? `\n${shell.css}` : ""}</style></head><body class="release-page ep-page">${shell?.header ?? '<a class="back-link" href="../../review.html#episodes">← Workspace</a>'}<main id="release-review" data-selector="${esc(selector)}" data-render-key="${esc(entry.video?.renderKey ?? "")}">
<h1 class="ep-sr">Review &amp; publish · ${esc(episode.title)}</h1>
<div class="rv">
<div class="rv-media"><section class="release-player" aria-label="Produced video"><video id="release-video" controls playsinline preload="metadata" poster="video/poster.png" src="video/short.mp4"><track kind="captions" src="captions.vtt" srclang="en" label="English">Your browser does not support video.</video>${chapterList(entry, windows)}<a href="video/review.html">Open video details</a></section>
${tabs}${outputReview}</div>
<section class="rv-card release-controls" aria-labelledby="release-steps-title"><h2 class="ep-sr" id="release-steps-title">Publishing steps</h2><p id="release-message" role="status" aria-live="polite">Connecting to the local studio…</p>
<ol class="pub-steps">
<li class="pub-step" id="release-approval">${stepNumber(1)}<div class="pub-head"><h3>Final check</h3><span class="stage-badge" id="release-state">To review</span></div><div class="pub-body"><p class="pub-hint">Watch the whole short, then confirm each point. Approval applies to this exact MP4, script and source-review window.</p><fieldset class="rchecks"><legend class="ep-sr">Confirm each point before approving</legend>${checks}</fieldset><div class="pub-actions"><button type="button" class="primary-action" id="approve-video" disabled>${shellIcons.check}Approve video</button><a class="text-action" href="edit.html">${shellIcons.edit}Needs changes · edit as new version</a></div></div><p class="pub-approved" data-approved-note hidden>${shellIcons.check}Approved for this exact MP4.</p><button type="button" class="text-action" id="reopen-review" hidden>Return to review / clear publication record</button></li>
<li class="pub-step" id="release-post-step">${stepNumber(2)}<div class="pub-head"><h3>Download &amp; post</h3></div><p class="pub-locked-note">Unlocks after approval.</p><div class="pub-body"><p class="pub-hint">Post the approved video on your channel, then copy the live post link below. This studio does not upload to social platforms.</p><div class="release-downloads"><a class="secondary-action" href="video/short.mp4" download>${shellIcons.download}Download MP4</a>${entry.download ? `<a class="secondary-action" href="episode-package.zip" download>${shellIcons.download}Download full package</a>` : ""}</div><div class="post-prev"><div class="post-who"><span class="post-avatar" aria-hidden="true">${esc((episode.presentation?.speakers[0]?.name ?? "S").slice(0, 1))}</span><div><label for="release-post">Companion post</label><small id="release-post-count">Social post preview · ${characters}</small></div><button type="button" class="secondary-action" id="copy-post">${shellIcons.copy}Copy post text</button></div><textarea id="release-post" readonly rows="8" aria-describedby="release-post-count">${esc(post)}</textarea><a class="text-action" href="edit.html#companion-post-heading">Edit the post in a new version</a></div></div></li>
<li class="pub-step" id="release-publication">${stepNumber(3)}<div class="pub-head"><h3>Record where it’s live</h3></div><p class="pub-locked-note">Unlocks after approval.</p><div class="pub-body"><label for="publication-url">Published post URL</label><div class="pub-url-row"><input type="url" id="publication-url" placeholder="https://…" autocomplete="off"><button type="button" class="primary-action" id="record-publication" disabled>Record publication</button></div><p class="field-help">Available after approval. Saving a link records publication; it does not publish the video.</p><p id="publication-record" hidden></p></div></li>
</ol></section>
</div></main><script>${shell ? `${shell.script}\n` : ""}${script}</script></body></html>`;
}
