import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isNewsEpisode, type NewsEpisode } from "./domain.js";
import { writingPanel } from "./editorial/panel.js";
import {
  type EpisodeShellOptions,
  episodeShell,
  episodeShellAssets,
  episodeStepSubs,
  shellIcons,
} from "./episode-shell.js";
import { formatGenerationTime, generationTimingHtml } from "./generation-timing.js";
import type { LibraryContent, LibraryEntry } from "./library.js";
import {
  groupStories,
  type Story,
  type StoryVersion,
  stageCounts,
  type WorkStage,
  workAction,
} from "./library-stories.js";
import { localActionButton, localActionFeedback } from "./local-action-controls.js";
import { auditionText, voiceSampleCard } from "./media/voice-audition.js";
import { kokoroVoice, kokoroVoices } from "./media/voices.js";
import {
  decorateNewsReviewHtml,
  enhanceNewsReviewHtml,
  newsReviewNotice,
} from "./news/freshness.js";
import {
  findExistingShort,
  indexExistingShorts,
  type ShortSummary,
  storyCardHtml,
} from "./news/story-fit.js";
import { projectRoot } from "./paths.js";
import { episodeSelector, presentationFormats, presentationLabel } from "./presentation.js";
import { withDeckShell } from "./presentation-deck.js";
import { productionHistory } from "./production-ui.js";
import { publishReview } from "./publish-review.js";
import { escapeHtml as esc } from "./review.js";
import { createScriptEditor } from "./script-editor.js";
import {
  capComparisonSelectors,
  comparisonId,
  comparisonLabel,
  recordedNarrator,
  studioReadiness,
  studioReturnFragment,
} from "./studio.js";
import { voiceLibraryPanel } from "./voice-library-panel.js";
import { newShortSheet, presenterWorkspace } from "./workspace-panels.js";

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
const linkFor = (entry: LibraryEntry) =>
  `episodes/${encodeURIComponent(episodeSelector(entry.episode))}/watch.html`;

const videoLinkFor = (entry: LibraryEntry) =>
  `episodes/${encodeURIComponent(episodeSelector(entry.episode))}/video/review.html`;

function collectionPages(id: string, label: string, position: string) {
  return `<nav class="collection-pages" data-collection-pages="${id}" aria-label="${esc(label)} pages (${position})" hidden><button type="button" data-page="previous" aria-label="Previous ${esc(label)} page">← Previous</button><label>Page <select aria-label="${esc(label)} page (${position})"><option value="1">1 of 1</option></select></label><button type="button" data-page="next" aria-label="Next ${esc(label)} page">Next →</button></nav>`;
}
function collectionTools(
  id: string,
  label: string,
  sorts: [string, string][],
  options: { search?: boolean; size?: number } = {},
) {
  const size = options.size ?? 6;
  return `<div class="collection-tools" data-collection-tools hidden>${options.search === false ? "" : `<label class="collection-search">Search ${esc(label)}<input type="search" id="${id}-search" maxlength="200" placeholder="Search ${esc(label)}…" autocomplete="off"></label>`}<label>Sort by<select id="${id}-sort">${sorts.map(([value, text]) => `<option value="${value}">${esc(text)}</option>`).join("")}</select></label><label>Per page<select id="${id}-size">${[size, size * 2, size * 4].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></label>${collectionPages(id, label, "top")}</div>`;
}
function collectionEnd(id: string, label: string) {
  return `<p id="${id}-status" class="collection-status" role="status" aria-live="polite"></p><div id="${id}-empty" class="collection-empty" hidden>No matching ${esc(label)}. <button type="button" id="${id}-reset">Clear search</button></div>${collectionPages(id, label, "bottom")}`;
}

function formatOption(format: (typeof presentationFormats)[number], entries: LibraryEntry[]) {
  const score = (entry: LibraryEntry) =>
    (entry.sourceReviewExpired ? 0 : 10) + (entry.video ? 3 : entry.preview ? 2 : 1);
  const candidates = entries
    .filter((entry) => (entry.episode.presentation?.format ?? "explainer") === format.id)
    .sort((a, b) => score(b) - score(a));
  const example = candidates[0];
  const otherConversation =
    format.id === "dialogue" && example
      ? candidates.find(
          (entry) =>
            entry.preview && isNewsEpisode(entry.episode) !== isNewsEpisode(example.episode),
        )
      : undefined;
  const status = !example
    ? "Script needed"
    : !example.preview
      ? "Script prepared · preview pending"
      : studioReadiness(example).label;
  const action = example?.preview
    ? `<a class="format-example" href="${example.video ? videoLinkFor(example) : linkFor(example)}">${example.video ? (example.sourceReviewExpired ? "Watch saved example" : "Watch example") : "Review example"} <span aria-hidden="true">↗</span></a><small>${esc(example.episode.title)}</small>`
    : "";
  const additional = otherConversation
    ? `<a class="format-example" href="${otherConversation.video ? videoLinkFor(otherConversation) : linkFor(otherConversation)}">${otherConversation.video ? (otherConversation.sourceReviewExpired ? "Watch saved" : "Watch") : "Review"} ${isNewsEpisode(otherConversation.episode) ? "news" : "tutorial"} conversation <span aria-hidden="true">↗</span></a><small>${esc(otherConversation.episode.title)} · ${esc(studioReadiness(otherConversation).label)}</small>`
    : "";
  return `<article class="style-option" data-story-format="${esc(format.id)}"><span class="style-icon" aria-hidden="true">${format.id === "dialogue" ? "↔" : format.id === "quiz" ? "?" : "✦"}</span><h3>${esc(format.name)}</h3><p>${esc(format.description)}</p><small>${esc(status)}</small><div class="format-use"><button type="button" class="primary-action" data-new-short-format="${esc(format.id)}" hidden>Use format</button>${action}</div>${additional}</article>`;
}

interface WorkVersion extends StoryVersion {
  entry: LibraryEntry;
}

const workVersion = (entry: LibraryEntry): WorkVersion => ({
  id: entry.episode.id,
  selector: episodeSelector(entry.episode),
  stage: entry.video ? "review" : "editing",
  updatedAt: entry.updatedAt ?? entry.preview?.updatedAt ?? "",
  attention: studioReadiness(entry).attention,
  ordinal: entry.ordinal,
  entry,
});

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const stageLabel = (stage: WorkStage) => (stage === "review" ? "To review" : "Editing");
const stageHint = (entry: LibraryEntry) =>
  entry.video ? "Video produced · awaiting your review" : "Script saved · video not produced";
const lengthLabel = (entry: LibraryEntry) =>
  entry.preview?.kind === "narrated"
    ? `${entry.preview.durationSeconds.toFixed(1)}s recorded`
    : `${entry.episode.targetDurationSeconds}s planned`;
const shortDate = (iso: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
};
const timeTag = (iso: string, className: string) =>
  `<time class="${className}" datetime="${esc(iso)}" title="${esc(iso)}">${esc(shortDate(iso))}</time>`;
const validThrough = (episode: LibraryEntry["episode"]) => {
  if (!isNewsEpisode(episode)) return "";
  const through = new Date(
    Date.parse(`${episode.news.asOf}T00:00:00Z`) + episode.news.maxAgeDays * 86400000,
  );
  return Number.isFinite(through.getTime()) ? through.toISOString().slice(0, 10) : "";
};
const chevron =
  '<svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';

/** Presentation link and More menu for one saved version. */
function workExtras(entry: LibraryEntry) {
  const { episode, preview } = entry;
  const selector = episodeSelector(episode);
  const prefix = `episodes/${encodeURIComponent(selector)}`;
  return `${entry.deck ? `<a class="presentation-action" href="${prefix}/presentation.html">Presentation ↗</a>` : ""}<details class="work-more"><summary aria-label="More actions for ${esc(selector)}">More</summary><div>${entry.deck ? `<a href="${prefix}/presentation.html">Interactive presentation</a>` : ""}<a href="${prefix}/edit.html">Edit a new version</a>${entry.video ? `<a href="${videoLinkFor(entry)}">Watch MP4</a>` : ""}${preview ? `<a href="${linkFor(entry)}">Review preview</a>` : ""}<button type="button" class="produce-card-btn" data-selector="${esc(selector)}">${entry.video ? "Re-render MP4" : "Produce saved script"}</button>${entry.download ? `<a href="${prefix}/episode-package.zip" download="${esc(entry.download.filename)}">Download ${entry.download.savedNews ? "saved package" : "episode package"} · ZIP</a>` : ""}<span>${esc(recordedNarrator(entry))}</span>${!preview ? "<span>No matching preview yet · No recording yet</span>" : ""}${isNewsEpisode(episode) ? newsReviewNotice(episode.news, entry.sourceReviewExpired) : ""}</div></details>`;
}

function versionRow(version: WorkVersion, label: string, latest: boolean) {
  const { entry } = version;
  const { episode, preview } = entry;
  const selector = version.selector;
  const action = workAction(version.stage, selector);
  const status = studioReadiness(entry);
  const search = [
    selector,
    episode.title,
    presentationLabel(episode),
    recordedNarrator(entry),
    ...episode.scenes.map((scene) => scene.narration),
  ]
    .join(" ")
    .toLowerCase();
  return `<div class="vrow" role="row" data-version data-selector="${esc(selector)}" data-stage="${version.stage}" data-attention="${version.attention}" data-updated="${esc(version.updatedAt)}" data-label="${stageLabel(version.stage)}" data-next="${esc(stageHint(entry))}" data-issue="${esc(version.attention ? status.label : "")}" data-production-stage="" data-action-label="${esc(action.label)}" data-short-label="${esc(action.shortLabel)}" data-action-href="${esc(action.href)}" data-valid-through="${validThrough(episode)}" data-sources-expired="${entry.sourceReviewExpired}" data-version-label="${label}" data-version-ordinal="${version.ordinal ?? ""}" data-title="${esc(episode.title)}" data-news="${isNewsEpisode(episode)}" data-search="${esc(search)}">
<span class="vn" role="cell"><b>${label}</b>${latest ? '<span class="latest-chip">Latest</span>' : ""}</span>
<span class="vdetail" role="cell"><span class="vtitle">${esc(episode.title)}</span><span class="vsub"><code class="vsel" title="${esc(selector)}">${esc(selector)}</code><span>${esc(presentationLabel(episode))}</span></span><small class="work-issue" data-version-issue ${version.attention ? "" : "hidden"}>${version.attention ? esc(status.label) : ""}</small>${entry.generation ? `<small class="vgen">Generated in ${formatGenerationTime(entry.generation.totalMs)}${entry.generation.reusedAudio || entry.generation.reusedVideo ? " · reused media" : ""}</small>` : ""}</span>
<span class="vstage" role="cell"><span class="stage-badge" data-version-stage data-badge="${version.stage}">${stageLabel(version.stage)}</span></span>
<span class="vlen" role="cell" title="${preview?.kind === "narrated" ? "Measured narration" : "Planned length"}">${esc(lengthLabel(entry))}</span>
<span class="vvoice" role="cell">${esc(recordedNarrator(entry))}</span>
<span class="vupd" role="cell">${timeTag(version.updatedAt, "")}</span>
<span class="vact" role="cell"><a class="vrow-primary" data-version-action href="${esc(action.href)}" aria-label="${esc(action.label)} · ${label}">${esc(action.shortLabel)}</a><span class="row-extras" data-row-extras>${workExtras(entry)}</span></span>
</div>`;
}

function storyRow(story: Story<WorkVersion>) {
  const { latest, representative } = story;
  const { episode } = latest.entry;
  const activity = story.versions.reduce(
    (newest, version) => (version.updatedAt > newest ? version.updatedAt : newest),
    "",
  );
  const news = isNewsEpisode(episode);
  const withVideo = story.versions.find((version) => version.entry.video);
  const thumbnail = withVideo
    ? `<img src="episodes/${encodeURIComponent(withVideo.selector)}/video/poster.png" alt="" width="54" height="96" loading="lazy">`
    : `<span>${esc(episode.id.split("-")[0] ?? "SAP")}</span>`;
  const action = workAction(representative.stage, representative.selector);
  const flagged = story.versions.find((version) => version.attention);
  const drawer = `versions-${story.id}`;
  const count = plural(story.versions.length, "version");
  return `<article class="story" data-story="${esc(story.id)}" data-title="${esc(episode.title)}" data-updated="${esc(activity)}" data-selector="${esc(story.id)}" data-kind="${news ? "news" : "tutorial"}" data-stages="${story.stages.join(" ")}" data-attention="${story.attention}" data-rep="${esc(representative.selector)}" data-versions="${story.versions.length}">
<div class="story-main">
<div class="work-thumbnail">${thumbnail}</div>
<div class="work-title"><h3>${esc(episode.title)}</h3><div class="work-meta"><code class="chip">${esc(episode.id)}</code><span>${news ? "News" : "Tutorial"}</span><span class="sep" aria-hidden="true">·</span><span>${esc(lengthLabel(latest.entry))}</span><span class="sep" aria-hidden="true">·</span><span class="ver-static">${count}</span><button type="button" class="ver-btn" data-versions-toggle aria-expanded="true" aria-controls="${esc(drawer)}" hidden>${count} ${chevron}</button></div><details class="story-organize"><summary>Organize story</summary><div><button type="button" data-story-favorite aria-pressed="false">☆ Favorite</button><button type="button" data-story-archive>Archive story</button><label>Series<input data-story-series maxlength="60" placeholder="e.g. CAP essentials"></label><button type="button" data-story-series-save>Save series</button><button type="button" data-compare-story>Compare versions</button><small data-story-meta-label></small></div></details><p class="work-issue" data-work-issue ${flagged ? "" : "hidden"}>${flagged ? `${story.versions.length > 1 ? `${story.labels.get(flagged.selector)}: ` : ""}${esc(studioReadiness(flagged.entry).label)}` : ""}</p></div>
<div class="work-state"><span class="stage-badge" data-work-stage data-badge="${representative.stage}">${stageLabel(representative.stage)}</span><small data-work-next>${esc(stageHint(representative.entry))}</small></div>
${timeTag(activity, "story-updated")}
<div class="work-actions"><a class="primary-action" data-work-action href="${esc(action.href)}">${esc(action.label)}</a><span class="row-extras" data-story-extras>${workExtras(representative.entry)}</span></div>
</div>
<div class="versions" id="${esc(drawer)}" role="table" aria-label="Versions of ${esc(story.id)}, newest first">
<div class="vrow head" role="row"><span role="columnheader">Version</span><span role="columnheader">Details</span><span role="columnheader">Stage</span><span role="columnheader">Length</span><span role="columnheader">Voice</span><span role="columnheader">Updated</span><span role="columnheader"><span class="sr-only">Actions</span></span></div>
${story.versions.map((version, index) => versionRow(version, story.labels.get(version.selector) ?? "", index === 0)).join("\n")}
</div></article>`;
}

function comparisonSection(entries: LibraryEntry[]) {
  const examples = entries
    .filter((entry) => capComparisonSelectors.includes(episodeSelector(entry.episode)))
    .sort(
      (a, b) =>
        capComparisonSelectors.indexOf(episodeSelector(a.episode)) -
        capComparisonSelectors.indexOf(episodeSelector(b.episode)),
    );
  return `<section id="styles" class="styles-section" data-workspace-view="styles"><div class="section-heading"><div><p class="eyebrow">FIND YOUR DELIVERY</p><h2>Compare the CAP pilot</h2></div><a class="format-guide-link" href="#formats">More storytelling formats ↓</a></div><p class="styles-intro">Same working demo. Compare presentation styles and the revised casual script, including recorded voices, pacing, and SAP geek humor.</p>${
    examples.length
      ? `<nav class="style-choices" aria-label="CAP pilot presentation style">${examples.map((entry) => `<a href="#${comparisonId(entry)}" data-style-choice>${esc(comparisonLabel(entry))}</a>`).join("")}</nav><div class="comparison-panels">${examples
          .map((entry) => {
            const status = studioReadiness(entry);
            const preview = entry.preview;
            const selector = episodeSelector(entry.episode);
            return `<article id="${comparisonId(entry)}" class="style-panel${entry.video ? "" : " no-poster"}" data-comparison-panel aria-labelledby="${comparisonId(entry)}-title"><div class="comparison-copy"><p class="delivery-label">${esc(presentationLabel(entry.episode))}</p><h3 id="${comparisonId(entry)}-title">${esc(entry.episode.title)}</h3><dl class="comparison-facts"><div><dt>Recorded voice</dt><dd>${esc(recordedNarrator(entry))}</dd></div><div><dt>Duration</dt><dd>${preview?.kind === "narrated" ? `${preview.durationSeconds.toFixed(1)} seconds · measured` : "Not recorded"}</dd></div></dl><p class="state${status.attention ? " attention" : ""}">${esc(status.label)}</p>${entry.sourceReviewExpired ? '<p class="recheck-note">Saved media only. Recheck the sources before producing a new version.</p>' : preview?.kind === "narrated" && !preview.timingReady ? '<p class="recheck-note">Revise the duration or opening before exporting a video.</p>' : ""}<div class="comparison-actions">${entry.video ? `<a class="primary-action" href="${videoLinkFor(entry)}">Watch MP4 <span aria-hidden="true">↗</span></a>` : ""}${preview ? `<a class="secondary-action" href="${linkFor(entry)}">${preview.kind === "narrated" ? "Review narration" : "Review storyboard"}</a>` : ""}</div><details class="production-command"><summary>Production details</summary><p><a class="secondary-action" href="episodes/${encodeURIComponent(selector)}/edit.html">Edit &amp; produce this version</a></p><p>Terminal alternative:</p><code tabindex="0">npm run shorts -- produce ${esc(selector)}</code></details></div>${entry.video ? `<img class="comparison-poster" src="episodes/${encodeURIComponent(selector)}/video/poster.png" width="1080" height="1920" loading="lazy" alt="Opening frame of the ${esc(comparisonLabel(entry))} short">` : ""}</article>`;
          })
          .join("")}</div>`
      : "<p>No prepared style comparison yet. Add a presentation script to start a comparison.</p>"
  }<p class="comparison-note">AI narration · captions use model timing estimates. The conversation uses animated hosts Mira and Max with synchronized mouth shapes.</p></section>`;
}

function voiceSection(catalog: LibraryContent["voiceCatalog"]) {
  if (!catalog) return "";
  const defaultVoice = kokoroVoices.find((voice) => voice.id === catalog.selected);
  const missingSamples = catalog.installed.filter(
    (id) => !catalog.samples.some((sample) => sample.identity.voice === id),
  );
  return `<section id="voices" class="voices-section" data-workspace-view="voices"><div class="section-heading"><div><p class="eyebrow">FIND YOUR NARRATOR</p><h2>Choose who speaks</h2></div><span id="default-voice-label" class="section-note">Default: ${esc(defaultVoice?.name ?? catalog.selected)}</span></div><p class="styles-intro">Compare the same short passage at the same speed. Voice samples help you choose; existing recordings keep their recorded voices.</p>${voiceLibraryPanel({ context: "library" })}<h3>Stock voices</h3><p id="local-actions-help" class="voice-help">Connect to the running local studio to use these buttons.</p><p id="local-actions-status" role="status" aria-live="polite"></p><a id="local-actions-refresh" class="secondary-action" href="review.html#voices" hidden>Refresh voice library</a><blockquote class="audition-transcript">${esc(auditionText)}</blockquote>${collectionTools(
    "samples",
    "saved stock voices",
    [
      ["original", "Catalog order"],
      ["title", "Name A–Z"],
    ],
  )}<div class="voice-grid" id="saved-stock-voice-list">${catalog.samples.map((sample) => voiceSampleCard(sample, catalog.selected, "voices/")).join("")}${missingSamples.map((id) => `<article class="voice-card" data-local-action-scope><h3>${esc(kokoroVoice(id).name)}</h3><p class="voice-meta">Installed but no current sample: ${esc(kokoroVoice(id).name)}</p>${localActionButton("voice-audition", "Generate voice sample", id)}${localActionButton("voice-default", id === catalog.selected ? "Default narrator" : "Set as default narrator", id, id === catalog.selected)}${localActionFeedback()}</article>`).join("")}</div>${collectionEnd("samples", "saved stock voices")}<p class="voice-scope">Episodes without custom speaker settings use the default narrator. Casual, comic, and conversation scripts have their own speaker assignments. Choose Voice &amp; portrait in a script's editor to change its narrator.</p><details class="voice-options"><summary>Explore ${kokoroVoices.length} supported English voices</summary><p>Install a voice, generate a sample, then choose it. Model setup downloads the requested files. Listening keeps your current default.</p>${collectionTools(
    "stock",
    "stock voices",
    [
      ["original", "Catalog order"],
      ["title", "Name A–Z"],
    ],
  )}<div class="voice-options-grid" id="stock-voice-list">${kokoroVoices.map((voice) => `<article data-local-action-scope><strong class="voice-option-name">${esc(voice.name)}</strong><span class="voice-option-meta">${esc(voice.accent)} · ${esc(voice.gender)}${catalog.installed.includes(voice.id) ? " · Installed" : " · Setup needed"}</span>${localActionButton(catalog.installed.includes(voice.id) ? "voice-audition" : "voice-install", catalog.installed.includes(voice.id) ? "Generate voice sample" : "Install voice", voice.id)}${localActionButton("voice-default", voice.id === catalog.selected ? "Default narrator" : "Set as default narrator", voice.id, voice.id === catalog.selected, !catalog.installed.includes(voice.id))}${localActionFeedback()}</article>`).join("")}</div>${collectionEnd("stock", "stock voices")}</details>${missingSamples.length ? `<details class="production-command"><summary>Terminal alternatives</summary>${missingSamples.map((id) => `<code class="voice-missing-command" tabindex="0">npm run shorts -- voice-audition ${esc(id)}</code>`).join(" ")}</details>` : ""}</section>`;
}

export async function createLibraryPages(
  content: LibraryContent,
): Promise<Record<string, string | Buffer>> {
  const { entries, topics, newsTopics } = content;
  const [
    css,
    script,
    localActionsScript,
    voiceProfilesScript,
    voicePanelCss,
    browserCss,
    collectionsScript,
    storiesScript,
    navigationScript,
    writingCss,
    writingScript,
    workspaceCss,
    workspaceScript,
  ] = await Promise.all([
    readFile(resolve(projectRoot, "templates/library.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/library.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/local-actions.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/voice-profiles.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/voice-library.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/library-browser.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/library-collections.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/library-stories.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/library-navigation.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/writing-assistant.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/writing-assistant.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/workspace-panels.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/workspace-panels.js"), "utf8"),
  ]);
  const stories = groupStories(entries.map(workVersion));
  const counts = stageCounts(stories);
  const newsStories = stories.filter((story) => isNewsEpisode(story.latest.entry.episode)).length;
  const tutorialStories = stories.length - newsStories;
  const newsIdeas = newsTopics
    .filter((topic) => topic.status === "needs-research")
    .sort((a, b) => a.priority - b.priority);
  const tutorialIdeas = topics.filter(
    (topic) => !entries.some((entry) => entry.episode.id === topic.id),
  );

  let stagedDrafts: NewsEpisode[] = [];
  try {
    const draftsDir = resolve(projectRoot, "content/drafts");
    const draftFiles = (await readdir(draftsDir)).filter((f) => f.endsWith(".json"));
    stagedDrafts = (
      await Promise.all(
        draftFiles.map(async (file) => {
          try {
            const raw = JSON.parse(await readFile(resolve(draftsDir, file), "utf8"));
            return raw as NewsEpisode;
          } catch {
            return null;
          }
        }),
      )
    ).filter((item): item is NewsEpisode => Boolean(item));
  } catch {}

  let initialStories: import("./news/fetcher.js").SapNewsItem[] = [];
  try {
    const { fetchTopSapStories } = await import("./news/fetcher.js");
    initialStories = await fetchTopSapStories({ limit: 6 });
  } catch {}

  const latestByEpisode = new Map<string, { entry: LibraryEntry; versions: number }>();
  for (const entry of entries) {
    if (!isNewsEpisode(entry.episode)) continue;
    const known = latestByEpisode.get(entry.episode.id);
    const stamp = (item: LibraryEntry) => item.updatedAt ?? item.preview?.updatedAt ?? "";
    latestByEpisode.set(entry.episode.id, {
      entry: known && stamp(known.entry) > stamp(entry) ? known.entry : entry,
      versions: (known?.versions ?? 0) + 1,
    });
  }
  const existingShorts = indexExistingShorts([
    ...[...latestByEpisode.values()]
      .sort((a, b) => a.entry.episode.id.localeCompare(b.entry.episode.id, "en", { numeric: true }))
      .map(({ entry, versions }): ShortSummary => {
        const prefix = `episodes/${encodeURIComponent(episodeSelector(entry.episode))}`;
        return {
          id: entry.episode.id,
          title: entry.episode.title,
          sourceUrls: entry.episode.sources.map((source) => source.url),
          versions,
          href: `${prefix}/${entry.video ? "publish.html" : "edit.html"}`,
          kind: "short",
        };
      }),
    ...stagedDrafts.map(
      (draft): ShortSummary => ({
        id: draft.id,
        title: draft.title,
        sourceUrls: draft.sources.map((source) => source.url),
        versions: 1,
        href: `#draft-${draft.id}`,
        kind: "draft",
      }),
    ),
  ]);

  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'">`;
  const html = `<!doctype html><html lang="en"><head>${head}<title>SAP Shorts · Workspace</title><style>${css}\n${voicePanelCss}\n${browserCss}\n${writingCss}\n${workspaceCss}</style></head><body class="workflow-studio">
<a class="skip-link" href="#episodes">Skip to workspace</a>
<div class="studio"><aside class="studio-nav"><a href="review.html" class="studio-brand"><i>S</i><span>SAP Shorts<small>CREATOR STUDIO</small></span></a><a class="new-short-button" data-new-short href="#ideas"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg><span>New short</span></a><div class="nav-caption">WORKSPACE</div><nav aria-label="Studio"><a class="nav-current" data-workspace-link="episodes" href="#episodes">My shorts <small>${stories.length}</small></a><a data-workspace-link="ideas" href="#ideas">Ideas <small>${newsIdeas.length + tutorialIdeas.length + stagedDrafts.length}</small></a><a data-workspace-link="styles" href="#formats"><em class="nav-full">Formats</em><em class="nav-short">Formats</em></a><a data-workspace-link="voices" href="#voices"><em class="nav-full">Voices &amp; presenters</em><em class="nav-short">Voices</em></a><a data-workspace-link="writing" href="#settings">Settings</a></nav><div class="nav-bottom"><span class="local-dot"></span>On this Mac<small>Pictures, narration and production stay local.</small></div></aside>
<main class="studio-main"><header class="workspace-heading"><div><h1 id="workspace-title">My shorts</h1><p id="workspace-description">Find a draft, review a video, or pick up where you left off.</p></div></header>
<aside id="studio-produce-banner" class="studio-produce-banner" hidden aria-live="polite"><div class="banner-content"><strong id="studio-produce-title">Producing video…</strong><p id="studio-produce-message"></p><div class="studio-progress-bar"><div id="studio-produce-progress" class="studio-progress-fill"></div></div><a id="studio-job-link" href="#episodes">Open working version</a></div></aside>
<section id="episodes" class="episodes-section" data-workspace-view="episodes"><section id="needs-you" class="needs-you" aria-labelledby="needs-you-title" hidden><h2 id="needs-you-title" class="sect-h">Needs you</h2><div class="attn" data-needs-list></div></section>
<div class="shorts-controls" data-enhancement-only hidden><div class="pipe" role="group" aria-label="Filter by stage">${[
    ["all", "All"],
    ["editing", "Editing"],
    ["producing", "Producing"],
    ["review", "To review"],
    ["publish", "To publish"],
    ["published", "Published"],
  ]
    .map(
      ([stage, label]) =>
        `<button type="button" class="pipe-btn" data-stage-filter="${stage}" aria-pressed="${stage === "all"}">${stage === "all" ? "" : `<i class="dot" data-badge="${stage}" aria-hidden="true"></i>`}${label} <b data-stage-count="${stage}">${counts[stage as WorkStage | "all"]}</b></button>`,
    )
    .join("")}</div>
<div class="creator-library-filters"><label>Library view<select id="creator-library-view"><option value="active">Active stories</option><option value="archived">Archived stories</option><option value="all">All stories</option></select></label><label><input type="checkbox" id="creator-favorites">Favorites only</label><label>Series<select id="creator-series"><option value="">All series</option></select></label><button type="button" id="creator-compare-open">Compare versions</button><span id="creator-library-status" role="status"></span></div><div class="shorts-toolbar"><div class="library-tools"><div class="episode-search"><label for="episode-search"><span class="sr-only">Search shorts</span></label><input id="episode-search" type="search" placeholder="Search titles, versions or scripts…" autocomplete="off" maxlength="200"><button type="button" id="clear-search" aria-label="Clear search" hidden>×</button></div><div class="format-filters" role="group" aria-label="Episode format"><button type="button" data-format="all" aria-pressed="true">All types</button><button type="button" data-format="tutorial" aria-pressed="false">Tutorials <span>${tutorialStories}</span></button><button type="button" data-format="news" aria-pressed="false">News <span>${newsStories}</span></button></div><label class="attention-filter"><input type="checkbox" id="attention-filter"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>Needs attention</label></div>
${collectionTools(
  "shorts",
  "stories",
  [
    ["recent", "Recently updated"],
    ["oldest", "Oldest updated"],
    ["title", "Title A–Z"],
    ["id", "Episode ID"],
  ],
  { search: false, size: 10 },
)}</div></div>
<div class="list-caption"><p id="filter-status" role="status">${stories.length} stories · ${entries.length} versions</p><span id="workflow-sync" role="status">Saved library · connecting to live status…</span></div><div class="episode-grid" id="shorts-list">${stories.map(storyRow).join("\n")}</div><div id="no-episodes" class="empty-library" ${entries.length ? "hidden" : ""}><h3>No shorts in this view</h3><p>Choose another stage or clear your filters. Open Ideas in the sidebar to explore the backlog.</p><button type="button" id="reset-filters">Show all shorts</button></div>${collectionPages("shorts", "stories", "bottom")}</section>
<div class="workspace-resources"><section id="formats" class="formats-section" data-workspace-view="styles"><div class="section-heading"><div><p class="eyebrow">MORE WAYS TO TELL IT</p><h2>Choose a storytelling format</h2></div></div><p class="styles-intro">Choose a structure for your next short, then review its script. Format and tone settings do not rewrite source text. Compare saved examples below.</p><div class="style-grid">${presentationFormats.map((format) => formatOption(format, entries)).join("")}</div></section><section id="ideas" class="ideas-section" data-workspace-view="ideas"><nav class="idea-tabs" aria-label="Idea collections"><a href="#ideas" data-idea-tab="stories">Official stories</a><a href="#staged-drafts-section" data-idea-tab="drafts">Staged drafts <span id="drafts-count">${stagedDrafts.length}</span></a><a href="#curated-ideas" data-idea-tab="curated">News backlog</a><a href="#tutorial-ideas" data-idea-tab="tutorials">Tutorial ideas</a></nav><div class="news-hub-card" data-idea-panel="stories"><div class="news-hub-header"><div><div class="news-live-tag"><span class="live-pulse"></span> LIVE SAP SCANNER</div><p class="news-hub-sub">Stories from news.sap.com, scored for short-video fit. Starting a short drafts 7 scenes with dated claims and companion LinkedIn copy.</p></div><div class="news-hub-actions"><button type="button" id="scan-news-btn" class="secondary-action">↻ Refresh Top Stories</button></div></div><form id="custom-news-form" class="custom-news-bar" action="javascript:void(0);"><label for="custom-news-url" class="sr-only">SAP article URL</label><input type="url" id="custom-news-url" placeholder="Paste any official SAP article URL (e.g. https://news.sap.com/2026/10/...)" required /><button type="submit" id="custom-news-submit" class="primary-action">Draft Short from URL</button></form><div id="news-status-msg" class="news-status-banner" hidden></div>${collectionTools(
    "stories",
    "stories",
    [
      ["score", "Most relevant"],
      ["recent", "Newest first"],
      ["title", "Title A–Z"],
    ],
  )}<div id="live-news-grid" class="live-news-grid" data-existing-shorts="${esc(JSON.stringify(existingShorts))}">${initialStories
    .map((story) => storyCardHtml(story, findExistingShort(existingShorts, story)))
    .join(
      "",
    )}</div>${collectionEnd("stories", "stories")}</div><div id="staged-drafts-section" class="staged-drafts-section" data-idea-panel="drafts"><div class="section-heading"><div><p class="eyebrow">READY TO PRODUCE</p><h2>Staged News Drafts</h2></div><span class="section-note">Drafts in content/drafts/ ready for review, LinkedIn copy, or production</span></div>${collectionTools(
    "drafts",
    "drafts",
    [
      ["id", "Episode ID"],
      ["title", "Title A–Z"],
    ],
  )}<div id="staged-drafts-grid" class="staged-drafts-grid">${stagedDrafts.map((draft) => `<article class="staged-draft-card" id="draft-${esc(draft.id)}"><div class="draft-header"><span class="draft-badge">${esc(draft.id)} · Staged Draft</span><span class="draft-duration">${draft.targetDurationSeconds}s · ${draft.scenes.length} scenes</span></div><h4>${esc(draft.title)}</h4><p class="draft-hook"><strong>Hook:</strong> "${esc(draft.scenes[0]?.narration ?? "")}"</p><details class="draft-linkedin-details"><summary>View companion LinkedIn post copy <span aria-hidden="true">+</span></summary><pre class="draft-linkedin-text">${esc(draft.publication?.text ?? "")}</pre></details><div class="draft-actions"><button type="button" class="copy-linkedin-btn secondary-action" data-post="${encodeURIComponent(draft.publication?.text ?? "")}">📋 Copy LinkedIn Post</button><button type="button" class="promote-draft-btn primary-action" data-draft-id="${esc(draft.id)}">Promote to Backlog</button></div></article>`).join("")}</div>${collectionEnd("drafts", "drafts")}</div><div id="curated-ideas" data-idea-panel="curated"><div class="section-heading"><div><p class="eyebrow">EDITORIAL SELECTION</p><h2>Curated story backlog</h2></div><span class="section-note">Research pending</span></div>${collectionTools(
    "curated",
    "news ideas",
    [
      ["original", "Editorial order"],
      ["title", "Title A–Z"],
    ],
  )}<div class="ideas-list" id="curated-list">${newsIdeas.map((topic, index) => `<details class="idea"><summary><span class="idea-number">${String(index + 1).padStart(2, "0")}</span><span><strong>${esc(topic.title)}</strong><small>${esc(topic.event)}</small></span><span class="research-tag">Research needed</span><span aria-hidden="true">+</span></summary><div class="idea-body"><p>${esc(topic.angle)}</p><p class="idea-sources">Start with ${topic.sourceUrls.map((url, i) => `<a href="${esc(url)}" target="_blank" rel="noreferrer">SAP source ${i + 1} ↗</a>`).join(" · ")}</p></div></details>`).join("")}</div>${collectionEnd("curated", "news ideas")}</div><section id="tutorial-ideas" data-idea-panel="tutorials"><h3>More tutorial ideas</h3>${collectionTools(
    "tutorials",
    "tutorial ideas",
    [
      ["original", "Editorial order"],
      ["title", "Title A–Z"],
    ],
  )}<div class="tutorial-idea-grid" id="tutorial-list">${tutorialIdeas.map((topic) => `<article><span>${esc(topic.pillar)}</span><h3>${esc(topic.title)}</h3><p>Research and environment verification needed.</p></article>`).join("")}</div>${collectionEnd("tutorials", "tutorial ideas")}</section></section>
${comparisonSection(entries)}${voiceSection(content.voiceCatalog)}${presenterWorkspace(entries)}<section id="writing" data-workspace-view="writing"><span id="settings"></span>${writingPanel()}</section></div><footer class="studio-footer"><span>SAP Shorts / Local creator studio</span><span>Produced videos need review. Publication is recorded with a post link.</span></footer></main></div>${newShortSheet(content, initialStories)}<dialog id="creator-compare-dialog" aria-labelledby="creator-compare-title"><form method="dialog"><button class="secondary-action" aria-label="Close version comparison">Close</button></form><h2 id="creator-compare-title">Compare saved versions</h2><p>Compare real saved scripts and outputs. Approval stays with each exact MP4.</p><div class="creator-compare-selects">${["left", "right"].map((side) => `<label>${side === "left" ? "Version A" : "Version B"}<select id="creator-compare-${side}">${entries.map((entry) => `<option value="${esc(episodeSelector(entry.episode))}">${esc(episodeSelector(entry.episode))} · ${esc(entry.episode.title)}</option>`).join("")}</select></label>`).join("")}<button type="button" class="primary-action" id="creator-compare-run">Compare</button></div><p id="creator-compare-status" role="status"></p><div class="creator-compare-results" id="creator-compare-results"></div></dialog><script>${collectionsScript}\n${storiesScript}\n${localActionsScript}\n${voiceProfilesScript}\n${script}\n${navigationScript}\n${writingScript}\n${workspaceScript}</script></body></html>`;
  const files: Record<string, string | Buffer> = { "review.html": enhanceNewsReviewHtml(html) };
  for (const sample of content.voiceCatalog?.samples ?? [])
    files[`voices/${sample.key}/sample.wav`] = sample.audio;
  const shellAssets = await episodeShellAssets();
  const storyBySelector = new Map<string, Story<WorkVersion>>();
  for (const story of stories)
    for (const version of story.versions) storyBySelector.set(version.selector, story);
  /** Shared episode header context for one version, seen from a page `root` levels deep. */
  const shellFor = (entry: LibraryEntry, root: string): EpisodeShellOptions => {
    const selector = episodeSelector(entry.episode);
    const story = storyBySelector.get(selector);
    const poster = entry.video
      ? selector
      : story?.versions.find((version) => version.entry.video)?.selector;
    return {
      root,
      title: entry.episode.title,
      id: entry.episode.id,
      selector,
      meta: presentationLabel(entry.episode),
      ...(poster ? { thumbnail: `episodes/${encodeURIComponent(poster)}/video/poster.png` } : {}),
      versions: (story?.versions ?? []).map((version, index) => ({
        selector: version.selector,
        label: story?.labels.get(version.selector) ?? "",
        stage: version.stage,
        latest: index === 0,
      })),
      step: null,
      hasVideo: Boolean(entry.video),
      stepSubs: episodeStepSubs(entry.episode, entry.preview?.durationSeconds),
    };
  };
  const shellButton = (
    href: string,
    label: string,
    options: { primary?: boolean; className?: string; icon?: string; download?: boolean } = {},
  ) =>
    `<a class="ep-btn${options.primary ? " primary" : ""}${options.className ? ` ${options.className}` : ""}" href="${esc(href)}"${options.download ? " download" : ""}>${options.icon ?? ""}<span class="ep-label">${esc(label)}</span></a>`;
  for (const entry of entries) {
    const prefix = `episodes/${episodeSelector(entry.episode)}`;
    const back = `../../review.html${studioReturnFragment(entry)}`;
    for (const [name, bytes] of Object.entries(entry.deck ?? {}))
      files[`${prefix}/${name}`] =
        name === "presentation.html" && typeof bytes === "string"
          ? withDeckShell(
              bytes,
              `<style>${shellAssets.css}</style>${episodeShell({
                ...shellFor(entry, "../../"),
                backHref: back,
                actions: `${entry.video ? shellButton("publish.html", "Review & publish", { className: "ghost ep-desk" }) : ""}${shellButton("edit.html", "Edit script", { primary: true, icon: shellIcons.edit })}`,
              })}`,
              shellAssets.script,
            )
          : bytes;
    files[`${prefix}/edit.html`] = await createScriptEditor(entry.episode, {
      productionHistory: productionHistory(entries),
      defaultVoice: content.voiceCatalog?.selected ?? "af_heart",
      availableVoices: content.voiceCatalog?.available ?? [],
      reservedNames: entries
        .filter((other) => other.episode.id === entry.episode.id)
        .flatMap((other) =>
          other.episode.presentation?.variant ? [other.episode.presentation.variant] : [],
        ),
      sourceReviewExpired: entry.sourceReviewExpired,
      shell: { ...shellFor(entry, "../../"), deck: Boolean(entry.deck) },
    });
    if (!entry.preview) continue;
    if (entry.download) files[`${prefix}/episode-package.zip`] = entry.download.bytes;
    for (const [name, bytes] of Object.entries(entry.preview.files))
      files[`${prefix}/${name}`] =
        name === "review.html" && isNewsEpisode(entry.episode)
          ? decorateNewsReviewHtml(
              bytes.toString("utf8"),
              entry.episode.news,
              entry.sourceReviewExpired,
            )
          : bytes;
    if (entry.video) {
      files[`${prefix}/publish.html`] = enhanceNewsReviewHtml(
        publishReview(entry, css, script, head, {
          header: episodeShell({
            ...shellFor(entry, "../../"),
            step: "review",
            actions: `${entry.deck ? shellButton("presentation.html", "Deck preview", { className: "ghost ep-desk", icon: shellIcons.eye }) : ""}${shellButton("../../review.html#episodes", "Back to Shorts", { primary: true, className: "ep-desk" })}${shellButton("edit.html", "Needs changes", { className: "ep-phone" }).replace("<a ", '<a data-when="review" ')}<button type="button" class="ep-btn primary ep-phone" data-when="review" id="mbar-approve" disabled>${shellIcons.check}<span class="ep-label">Approve</span></button><button type="button" class="ep-btn ep-phone" data-when="publish" id="mbar-copy">${shellIcons.copy}<span class="ep-label">Copy post</span></button>${shellButton("video/short.mp4", "Download MP4", { primary: true, className: "ep-phone", icon: shellIcons.download, download: true }).replace("<a ", '<a data-when="publish" ')}${shellButton("../../review.html#episodes", "Back to Shorts", { primary: true, className: "ep-phone" }).replace("<a ", '<a data-when="none published" ')}`,
          }),
          css: shellAssets.css,
          script: shellAssets.script,
        }),
      );
      const videoShell = episodeShell({
        ...shellFor(entry, "../../../"),
        episodeDir: "../",
        backHref: `../${back}`,
        actions: shellButton("../publish.html", "Open Review & publish", {
          primary: true,
          icon: shellIcons.arrow,
        }),
      });
      const seconds = entry.preview.durationSeconds.toFixed(1);
      for (const [name, bytes] of Object.entries(entry.video.files)) {
        const text = name === "review.html" ? bytes.toString("utf8") : "";
        // Exports without a <body> (older fixtures) keep the header where the back link was.
        const hasBody = /<body\b[^>]*>/iu.test(text);
        const copied =
          name === "review.html"
            ? text
                .replace(
                  /<\/head\s*>/iu,
                  (closing) => `<style>${shellAssets.css}</style>${closing}`,
                )
                .replace(/<body\b([^>]*)>/iu, (_body, attributes: string) =>
                  /\bclass=/iu.test(attributes)
                    ? `<body${attributes.replace(/\bclass=(["'])/iu, "class=$1ep-page ")}>${videoShell}`
                    : `<body${attributes} class="ep-page">${videoShell}`,
                )
                .replace(
                  "<!--LIBRARY_BACK-->",
                  () =>
                    `${hasBody ? "" : videoShell}<p class="note">${esc(comparisonLabel(entry))} · ${esc(recordedNarrator(entry))} · ${seconds} seconds · <a href="../publish.html">Open Review &amp; publish</a></p>${entry.sourceReviewExpired ? '<p class="note"><strong>Saved export · sources need rechecking.</strong> Re-read the official sources before producing or sharing a current news brief.</p>' : ""}`,
                )
                .replace(
                  '<div class="links">',
                  `${generationTimingHtml(entry.generation)}<div class="links">${entry.download ? `<a href="../episode-package.zip" download="${esc(entry.download.filename)}">Download ${entry.download.savedNews ? "saved package" : "episode package"} · ZIP</a>` : ""}`,
                )
            : bytes;
        files[`${prefix}/video/${name}`] =
          name === "review.html" && isNewsEpisode(entry.episode)
            ? decorateNewsReviewHtml(String(copied), entry.episode.news, entry.sourceReviewExpired)
            : copied;
      }
    }
    // The framed review.html already carries the dated source notice; do not repeat it here.
    const watchShell = episodeShell({
      ...shellFor(entry, "../../"),
      backHref: back,
      liveStages: true,
      actions: `${entry.video ? shellButton("video/review.html", "Watch MP4", { className: "ghost ep-desk", icon: shellIcons.film }) : ""}<a class="ep-btn ghost ep-desk" href="review.html" target="_blank" rel="noreferrer"><span class="ep-label">Open full preview ↗</span></a>${entry.video ? shellButton("publish.html", "Open Review & publish", { primary: true, icon: shellIcons.arrow }) : shellButton("edit.html", "Edit script", { primary: true, icon: shellIcons.edit })}`,
    });
    files[`${prefix}/watch.html`] =
      `<!doctype html><html lang="en"><head>${head}<title>${esc(entry.episode.title)} · SAP Shorts</title><style>${css}\n${shellAssets.css}</style></head><body class="watch-page ep-page">${watchShell}<p class="watch-context"><span>${esc(presentationLabel(entry.episode))} · ${isNewsEpisode(entry.episode) ? `News · sources checked ${dateLabel(entry.episode.news.asOf)}` : "Tutorial · local demo evidence"}${entry.sourceReviewExpired ? " · source recheck needed" : ""}</span><span class="watch-narrator">${esc(recordedNarrator(entry))}${entry.preview.kind === "narrated" ? ` · ${entry.preview.durationSeconds.toFixed(1)}s` : ""}</span></p><iframe class="episode-frame" src="review.html" title="${esc(entry.episode.title)} episode review"></iframe><script>${shellAssets.script}</script></body></html>`;
  }
  return files;
}
