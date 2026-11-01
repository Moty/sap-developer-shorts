import type { LibraryContent, LibraryEntry } from "./library.js";
import { kokoroVoices } from "./media/voices.js";
import type { SapNewsItem } from "./news/fetcher.js";
import { episodeSelector, presentationFormats } from "./presentation.js";
import { escapeHtml as esc } from "./review.js";

export function presenterWorkspace(entries: LibraryEntry[]) {
  const uses = entries.flatMap((entry) =>
    (entry.episode.presentation?.speakers ?? [])
      .filter((speaker) => speaker.avatar?.mode === "photo" && speaker.avatar.imageId)
      .map((speaker) => ({
        imageId: speaker.avatar?.imageId,
        speaker: speaker.name,
        aligned: Boolean(speaker.avatar?.calibration),
        title: entry.episode.title,
        href: `episodes/${encodeURIComponent(episodeSelector(entry.episode))}/edit.html#voice-heading`,
      })),
  );
  const editor = entries[0]
    ? `episodes/${encodeURIComponent(episodeSelector(entries[0].episode))}/edit.html#voice-heading`
    : "";
  const payload = JSON.stringify({ uses, editor }).replaceAll("<", "\\u003c");
  return `<section class="presenter-workspace" data-workspace-view="voices" aria-labelledby="presenters-title"><div class="section-heading"><div><p class="eyebrow">WHO APPEARS</p><h2 id="presenters-title">Presenters</h2></div><label class="secondary-action presenter-upload" hidden>Upload photo<input id="presenter-upload" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only"></label></div><p>Saved photos stay on this Mac. Alignment belongs to each script; open its Voice &amp; presenter step to check the mouth and preview motion.</p><p id="presenter-status" class="voice-help" role="status">Connect to the local studio to see your saved photos. Existing script editors keep their presenter settings.</p><div id="presenter-gallery" class="presenter-gallery"></div><script id="presenter-workspace-data" type="application/json">${payload}</script></section>`;
}

export function newShortSheet(content: LibraryContent, stories: SapNewsItem[]) {
  const available = content.voiceCatalog?.available ?? content.voiceCatalog?.installed ?? [];
  const voices = kokoroVoices.filter((voice) => available.includes(voice.id));
  const selected = kokoroVoices.find((voice) => voice.id === content.voiceCatalog?.selected);
  const options = voices
    .map(
      (voice) =>
        `<option value="${esc(voice.id)}">${esc(voice.name)} · ${esc(voice.accent)}</option>`,
    )
    .join("");
  return `<dialog id="new-short-dialog" class="workspace-sheet" aria-labelledby="new-short-title"><form id="new-short-form"><header class="sheet-header"><div><p class="eyebrow">NEW SHORT</p><h2 id="new-short-title">What’s the story?</h2></div><button type="button" class="sheet-close" data-close-sheet aria-label="Close New short">×</button></header><div class="sheet-body">
<fieldset><legend>1 · Start from</legend><div class="new-source-choices"><label><input type="radio" name="new-source" value="story"${stories.length ? " checked" : ""}>Scanned SAP story</label><label><input type="radio" name="new-source" value="url"${stories.length ? "" : " checked"}>Official article URL</label></div><div id="new-story-field"><label for="new-short-story">SAP story</label><select id="new-short-story">${stories.map((story) => `<option value="${esc(story.link)}">${esc(story.title)}</option>`).join("")}</select></div><div id="new-url-field"><label for="new-short-url">Official SAP article URL</label><input type="url" id="new-short-url" placeholder="https://news.sap.com/…" maxlength="2000"></div><p class="sheet-help">Start with a sourced SAP announcement. For tutorials, open a prepared script from My shorts; unresearched backlog ideas need research first.</p></fieldset>
<fieldset><legend>2 · Format</legend><div class="new-format-choices">${presentationFormats.map((format, index) => `<label><input type="radio" name="new-format" value="${format.id}"${index === 0 ? " checked" : ""}><span><strong>${esc(format.name)}</strong><small>${esc(format.description)}</small></span></label>`).join("")}</div></fieldset>
<div class="new-delivery-grid"><div><label for="new-short-tone">3 · Tone</label><select id="new-short-tone"><option value="professional">Professional</option><option value="casual">Casual</option><option value="comic">Comic</option></select></div><div><label for="new-short-length">4 · Planned length <output id="new-short-length-label" for="new-short-length">60s</output></label><input type="range" id="new-short-length" min="15" max="90" step="5" value="60"><p class="sheet-help">Provisional scene timing. Recorded speech must still fit 15–90 seconds.</p></div></div>
<label for="new-short-narrator">5 · Narrator</label><select id="new-short-narrator"><option value="default" selected>Default / decide later · ${esc(selected?.name ?? "Heart")}</option>${options}</select><div id="new-secondary-field" hidden><label for="new-short-secondary">Second narrator</label><select id="new-short-secondary">${options}</select><p class="sheet-help">Choose a different voice for the colleague’s turns.</p></div><p class="sheet-help">You can draft before setting up narration. Default uses your configured stock narrator; install its assets or choose a personal voice later in Voice &amp; presenter. <a href="#voices" data-sheet-link>Open voice tools</a></p>
<aside class="new-short-explainer"><strong>Source-based draft · no writing-model request</strong><p>Copies complete source excerpts into seven scenes with dated claims and a companion post. Format and tone are saved delivery settings; they do not rewrite the words. A conversation assigns complete scenes to alternating speakers. Review and edit the draft before producing.</p></aside></div><footer class="sheet-footer"><p id="new-short-status" role="status" aria-live="polite">Creates an editable draft. Narration setup can wait until you produce.</p><button type="button" class="secondary-action" data-close-sheet>Cancel</button><button id="new-short-submit" type="submit" class="primary-action">Create draft</button><a id="new-short-refresh" class="primary-action" href="review.html?refresh=workspace#episodes" hidden>Refresh My shorts</a></footer></form></dialog>`;
}
