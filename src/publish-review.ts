import { isNewsEpisode } from "./domain.js";
import { generationTimingHtml } from "./generation-timing.js";
import type { LibraryEntry } from "./library.js";
import { newsReviewNotice } from "./news/freshness.js";
import { episodeSelector, presentationLabel } from "./presentation.js";
import { escapeHtml as esc } from "./review.js";

export function publishReview(entry: LibraryEntry, css: string, script: string, head: string) {
  const { episode } = entry;
  return `<!doctype html><html lang="en"><head>${head}<title>Review & publish · ${esc(episode.title)}</title><style>${css}</style></head><body class="release-page"><main id="release-review" data-selector="${esc(episodeSelector(episode))}" data-render-key="${esc(entry.video?.renderKey ?? "")}">
<a class="back-link" href="../../review.html#episodes">← Workspace</a>
<header class="release-header"><div><p class="eyebrow">${esc(episodeSelector(episode))} · ${esc(presentationLabel(episode))}</p><h1>Review & publish</h1><p>${esc(episode.title)}</p></div><span class="stage-badge" id="release-state">To review</span></header>
<ol class="release-steps" aria-label="Publishing journey"><li>1. Review video</li><li>2. Download & post</li><li>3. Record publication</li></ol>
<div class="release-layout"><section class="release-player" aria-label="Produced video"><video controls playsinline preload="metadata" poster="video/poster.png" src="video/short.mp4"><track kind="captions" src="captions.vtt" srclang="en" label="English">Your browser does not support video.</video><a href="video/review.html">Open video details</a></section>
<div class="release-controls"><p id="release-message" role="status" aria-live="polite">Connecting to the local studio…</p>
<section class="release-card" id="release-approval"><span class="eyebrow">STEP 1</span><h2>Give this video a final check</h2><p>Watch the whole short. Check speech, face movement, captions and factual accuracy.</p><label class="review-confirmation"><input type="checkbox" id="review-confirmed"> I reviewed this video, its captions and sources.</label><button type="button" class="primary-action" id="approve-video" disabled>Approve video</button><a class="text-action" href="edit.html">Needs changes? Edit a new version</a></section>
<section class="release-card"><span class="eyebrow">STEP 2</span><h2>Download & post</h2><p>Post the approved video on your channel, then copy the live post link below. This studio does not upload to social platforms.</p><div class="release-downloads"><a class="secondary-action" href="video/short.mp4" download>Download MP4</a>${entry.download ? '<a class="secondary-action" href="episode-package.zip" download>Download full package</a>' : ""}</div><label for="release-post">Companion post</label><textarea id="release-post" readonly rows="5">${esc(episode.publication.text)}</textarea><button type="button" class="text-action" id="copy-post">Copy post text</button></section>
<section class="release-card" id="release-publication"><span class="eyebrow">STEP 3</span><h2>Keep track of where it’s live</h2><label for="publication-url">Published post URL</label><input type="url" id="publication-url" placeholder="https://…" autocomplete="off"><button type="button" class="primary-action" id="record-publication" disabled>Record publication</button><p class="field-help">Available after approval. Saving a link records publication; it does not publish the video.</p><p id="publication-record" hidden></p><button type="button" class="text-action" id="reopen-review" hidden>Return to review / clear publication record</button></section>
<div class="release-card">${generationTimingHtml(entry.generation)}</div>
<details class="release-card"><summary>Sources & production details</summary>${isNewsEpisode(episode) ? newsReviewNotice(episode.news, entry.sourceReviewExpired) : ""}<p>${entry.video?.durationSeconds.toFixed(1)} seconds · ${esc(episodeSelector(episode))}</p><ul>${episode.sources.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)}</a></li>`).join("")}</ul></details>
</div></div></main><script>${script}</script></body></html>`;
}
