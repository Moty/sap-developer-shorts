import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isNewsEpisode } from "./domain.js";
import type { LibraryContent, LibraryEntry } from "./library.js";
import { auditionText, voiceSampleCard } from "./media/voice-audition.js";
import { kokoroVoice, kokoroVoices } from "./media/voices.js";
import { availabilityLabels } from "./news/contracts.js";
import {
  decorateNewsReviewHtml,
  enhanceNewsReviewHtml,
  newsReviewNotice,
} from "./news/freshness.js";
import { projectRoot } from "./paths.js";
import { episodeSelector, presentationFormats, presentationLabel } from "./presentation.js";
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
  return `<article class="style-option" data-story-format="${esc(format.id)}"><span class="style-icon" aria-hidden="true">${format.id === "dialogue" ? "↔" : format.id === "quiz" ? "?" : "✦"}</span><h3>${esc(format.name)}</h3><p>${esc(format.description)}</p><small>${esc(status)}</small>${action}${additional}</article>`;
}

function card(entry: LibraryEntry) {
  const { episode, preview } = entry;
  const news = isNewsEpisode(episode);
  const kind = news ? "news" : "tutorial";
  const description = news ? episode.news.angle : episode.audience;
  const status = studioReadiness(entry);
  const visual = news
    ? episode.claims
        .slice(0, 3)
        .map(
          (claim, index) =>
            `<div class="story-line"><span class="story-number">0${index + 1}</span><span>${esc(claim.text)}</span><small class="availability-tag ${claim.availability.status}">${availabilityLabels[claim.availability.status]}</small></div>`,
        )
        .join("")
    : episode.scenes
        .filter((scene) => scene.phase === "demo")
        .map(
          (scene, index) =>
            `<div class="demo-line"><span>0${index + 1}</span><strong>${esc(scene.overlay)}</strong><i aria-hidden="true">↗</i></div>`,
        )
        .join("");
  const search = [
    episode.id,
    episode.title,
    presentationLabel(episode),
    description,
    episode.audience,
    recordedNarrator(entry),
    ...episode.claims.map((claim) => claim.text),
    ...episode.scenes.map((scene) => scene.narration),
  ].join(" ");
  const firstScene = episode.scenes[0];
  const hookSeconds = firstScene ? firstScene.endSeconds - firstScene.startSeconds : 0;
  const hookOk = hookSeconds <= 3.5;
  const pronunciationCount = Object.keys(episode.pronunciation ?? {}).length;
  const qualityBadges = `<div class="quality-badges"><span class="q-badge ${hookOk ? "" : "warning"}" title="Hook Retention Target: ≤ 3.5s">⚡ Hook ${hookSeconds.toFixed(1)}s${hookOk ? " (optimal)" : " (tighten)"}</span><span class="q-badge" title="EBU R128 Broadcast Normalization (-16 LUFS)">🔊 -16 LUFS</span><span class="q-badge" title="Phonetic glossary terms mapped for clean speech">📖 ${pronunciationCount} ${pronunciationCount === 1 ? "rule" : "rules"}</span></div>`;
  return `<article class="episode-card" data-kind="${kind}" data-search="${esc(search)}"><div class="episode-art ${kind}"><div class="art-label">${news ? esc(episode.news.event) : "BUILD · RUN · VERIFY"}<span>${news ? "NEWS BRIEF" : "DEVELOPER TUTORIAL"}</span></div>${visual}</div><div class="episode-body"><div class="card-topline"><span class="kind-label">${news ? "SAP news" : "Tutorial"}</span><span class="state ${status.attention ? "attention" : ""}">${esc(status.label)}</span></div><h3>${esc(episode.title)}</h3><p class="delivery-label">${esc(presentationLabel(episode))}</p><p class="recorded-voice">${esc(recordedNarrator(entry))}</p><p class="episode-description">${esc(description)}</p><div class="episode-facts"><span>${preview ? `${preview.durationSeconds.toFixed(1)}s ${preview.kind === "narrated" ? "measured" : "planned"}` : `${episode.targetDurationSeconds}s planned`}</span><span>${episode.sources.length} sources</span><span>${news ? `Checked ${dateLabel(episode.news.asOf)}` : preview ? `${episode.demo.expectedChecks.length} live demo checks` : "Demo check pending"}</span></div>${qualityBadges}${news ? newsReviewNotice(episode.news, entry.sourceReviewExpired) : ""}<div class="card-actions">${entry.video ? `<a class="review-link primary" href="${videoLinkFor(entry)}">Watch MP4 <span aria-hidden="true">↗</span></a>` : ""}<button type="button" class="review-link produce-card-btn" data-selector="${esc(episodeSelector(episode))}">${entry.video ? "Re-render MP4" : "Produce MP4"}</button>${preview ? `<a class="review-link" href="${linkFor(entry)}">Review preview <span aria-hidden="true">↗</span></a>` : '<span class="preview-pending">No matching preview yet</span>'}${entry.download ? `<a class="review-link" href="episodes/${encodeURIComponent(episodeSelector(episode))}/episode-package.zip" download="${esc(entry.download.filename)}">Download ${entry.download.savedNews ? "saved package" : "episode package"} · ZIP</a>` : ""}<a class="review-link" href="episodes/${encodeURIComponent(episodeSelector(episode))}/edit.html">Revise script</a><span class="avatar-note">Avatar pending</span></div><details class="source-details"><summary>Official sources <span>${episode.sources.length}</span></summary><ul>${episode.sources.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Read ${dateLabel(source.retrievedOn)}</small></li>`).join("")}</ul></details></div></article>`;
}

function comparisonSection(entries: LibraryEntry[]) {
  const examples = entries
    .filter((entry) => capComparisonSelectors.includes(episodeSelector(entry.episode)))
    .sort(
      (a, b) =>
        capComparisonSelectors.indexOf(episodeSelector(a.episode)) -
        capComparisonSelectors.indexOf(episodeSelector(b.episode)),
    );
  return `<section id="styles" class="styles-section"><div class="section-heading"><div><p class="eyebrow">FIND YOUR DELIVERY</p><h2>Compare the CAP pilot</h2></div><a class="format-guide-link" href="#formats">More storytelling formats ↓</a></div><p class="styles-intro">Same working demo. Compare presentation styles and the revised casual script, including recorded voices, pacing, and SAP geek humor.</p>${
    examples.length
      ? `<nav class="style-choices" aria-label="CAP pilot presentation style">${examples.map((entry) => `<a href="#${comparisonId(entry)}" data-style-choice>${esc(comparisonLabel(entry))}</a>`).join("")}</nav><div class="comparison-panels">${examples
          .map((entry) => {
            const status = studioReadiness(entry);
            const preview = entry.preview;
            const selector = episodeSelector(entry.episode);
            return `<article id="${comparisonId(entry)}" class="style-panel${entry.video ? "" : " no-poster"}" data-comparison-panel aria-labelledby="${comparisonId(entry)}-title"><div class="comparison-copy"><p class="delivery-label">${esc(presentationLabel(entry.episode))}</p><h3 id="${comparisonId(entry)}-title">${esc(entry.episode.title)}</h3><dl class="comparison-facts"><div><dt>Recorded voice</dt><dd>${esc(recordedNarrator(entry))}</dd></div><div><dt>Duration</dt><dd>${preview?.kind === "narrated" ? `${preview.durationSeconds.toFixed(1)} seconds · measured` : "Not recorded"}</dd></div></dl><p class="state${status.attention ? " attention" : ""}">${esc(status.label)}</p>${entry.sourceReviewExpired ? '<p class="recheck-note">Saved media only. Recheck the sources before producing a new version.</p>' : preview?.kind === "narrated" && !preview.timingReady ? '<p class="recheck-note">Revise the duration or opening before exporting a video.</p>' : ""}<div class="comparison-actions">${entry.video ? `<a class="primary-action" href="${videoLinkFor(entry)}">Watch MP4 <span aria-hidden="true">↗</span></a>` : ""}${preview ? `<a class="secondary-action" href="${linkFor(entry)}">${preview.kind === "narrated" ? "Review narration" : "Review storyboard"}</a>` : ""}</div><details class="production-command"><summary>Production details</summary><p>Prepare or resume this version from the project folder:</p><code tabindex="0">npm run shorts -- produce ${esc(selector)}</code></details></div>${entry.video ? `<img class="comparison-poster" src="episodes/${encodeURIComponent(selector)}/video/poster.png" width="1080" height="1920" loading="lazy" alt="Opening frame of the ${esc(comparisonLabel(entry))} short">` : ""}</article>`;
          })
          .join("")}</div>`
      : "<p>No prepared style comparison yet. Add a presentation script to start a comparison.</p>"
  }<p class="comparison-note">AI narration · captions use model timing estimates. The conversation uses fictional hosts Mira and Max. Stock avatar animation is pending.</p></section>`;
}

function voiceSection(catalog: LibraryContent["voiceCatalog"]) {
  if (!catalog) return "";
  const defaultVoice = kokoroVoices.find((voice) => voice.id === catalog.selected);
  const missingSamples = catalog.installed.filter(
    (id) => !catalog.samples.some((sample) => sample.identity.voice === id),
  );
  return `<section id="voices" class="voices-section"><div class="section-heading"><div><p class="eyebrow">FIND YOUR NARRATOR</p><h2>Listen to the voices</h2></div><span class="section-note">Default: ${esc(defaultVoice?.name ?? catalog.selected)}</span></div><p class="styles-intro">Compare the same short passage at the same speed. Voice samples help you choose; existing recordings keep their recorded voices.</p><blockquote class="audition-transcript">${esc(auditionText)}</blockquote><div class="voice-grid">${catalog.samples.map((sample) => voiceSampleCard(sample, catalog.selected, "voices/")).join("")}</div>${missingSamples.length ? `<p class="voice-meta">Installed but no current sample: ${missingSamples.map((id) => esc(kokoroVoice(id).name)).join(", ")}. Record samples with ${missingSamples.map((id) => `<code class="voice-missing-command" tabindex="0">npm run shorts -- voice-audition ${esc(id)}</code>`).join(" ")}.</p>` : ""}<p class="voice-scope">Episodes without custom speaker settings use the default narrator. Casual, comic, and conversation scripts have their own speaker assignments. Run <code>npm run shorts -- voices CAP-01@duo</code> to see where to change them.</p><details class="voice-options"><summary>Explore ${kokoroVoices.length} supported English voices</summary><p>Install a profile, record a sample, then choose it. Each setup adds only the requested voices. Listening does not change your default.</p><div class="voice-options-grid">${kokoroVoices.map((voice) => `<article><strong class="voice-option-name">${esc(voice.name)}</strong><span class="voice-option-meta">${esc(voice.accent)} · ${esc(voice.gender)}${catalog.installed.includes(voice.id) ? " · Installed" : " · Setup needed"}</span><code class="voice-option-command" tabindex="0">npm run shorts -- ${catalog.installed.includes(voice.id) ? "voice-audition" : "voice-setup"} ${esc(voice.id)}</code></article>`).join("")}</div></details></section>`;
}

export async function createLibraryPages(
  content: LibraryContent,
): Promise<Record<string, string | Buffer>> {
  const { entries, topics, newsTopics } = content;
  const [css, script] = await Promise.all([
    readFile(resolve(projectRoot, "templates/library.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/library.js"), "utf8"),
  ]);
  const narrated = entries.filter((entry) => entry.preview?.kind === "narrated").length;
  const ready = entries.filter((entry) => entry.preview).length;
  const videos = entries.filter((entry) => entry.video).length;
  const newsCount = entries.filter((entry) => isNewsEpisode(entry.episode)).length;
  const newsIdeas = newsTopics
    .filter((topic) => topic.status === "needs-research")
    .sort((a, b) => a.priority - b.priority);
  const tutorialIdeas = topics.filter(
    (topic) => !entries.some((entry) => entry.episode.id === topic.id),
  );
  const latestNews = entries.find((entry) => isNewsEpisode(entry.episode) && entry.preview);
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">`;
  const html = `<!doctype html><html lang="en"><head>${head}<title>SAP Shorts · Review studio</title><style>${css}</style></head><body>
<a class="skip-link" href="#episodes">Skip to episodes</a>
<aside id="studio-produce-banner" class="studio-produce-banner" hidden aria-live="polite"><div class="banner-content"><strong id="studio-produce-title">Producing video...</strong><p id="studio-produce-message"></p><div class="studio-progress-bar"><div id="studio-produce-progress" class="studio-progress-fill"></div></div></div></aside>
<div class="studio"><aside class="studio-nav"><a href="review.html" class="studio-brand"><i>S</i><span>SAP Shorts<small>REVIEW STUDIO</small></span></a><div class="nav-caption">YOUR WORKSPACE</div><nav aria-label="Studio"><a class="nav-current" href="#episodes"><span aria-hidden="true">▦</span> Episodes <small>${entries.length}</small></a><a href="#styles"><span aria-hidden="true">✦</span> Delivery styles</a><a href="#voices"><span aria-hidden="true">♫</span> Narrators</a><a href="#ideas"><span aria-hidden="true">✧</span> Next ideas <small>${newsIdeas.length + tutorialIdeas.length}</small></a><a href="#production"><span aria-hidden="true">◷</span> Production</a></nav><div class="nav-bottom"><span class="local-dot"></span>Local previews<small>Review the story before the final video.</small></div></aside>
<main class="studio-main"><header class="studio-header"><span>Your content workspace</span><span class="workspace-status"><i></i> Editorial drafts</span></header><section class="studio-intro"><div><p class="eyebrow">SAP KNOWLEDGE, ONE SHORT AT A TIME</p><h1>Demos and news.<br>One place to review.</h1><p>Compare each short, review its sources, and choose a delivery style for your audience.</p>${latestNews ? `<a class="hero-link" href="${linkFor(latestNews)}">Review the SAP news brief <span aria-hidden="true">↗</span></a>` : ""}</div><div class="studio-summary"><span class="eyebrow">ON YOUR DESK</span><div><b>${ready}</b><span>episode previews</span></div><div><b>${narrated}</b><span>with timed narration</span></div><p>${videos ? `${videos} verified MP4 export${videos === 1 ? "" : "s"}<br>Stock avatar animation pending` : "Local voice · timed captions<br>Stock avatar and video export pending"}</p></div></section>
${comparisonSection(entries)}${voiceSection(content.voiceCatalog)}\n<section id="episodes" class="episodes-section"><div class="section-heading"><div><p class="eyebrow">YOUR EPISODES</p><h2>Ready for a closer look</h2></div><span class="section-note">${entries.length} editorial drafts</span></div><div class="library-tools" data-enhancement-only hidden><div class="format-filters" role="group" aria-label="Episode format"><button type="button" data-format="all" aria-pressed="true">All <span>${entries.length}</span></button><button type="button" data-format="tutorial" aria-pressed="false">Tutorials <span>${entries.length - newsCount}</span></button><button type="button" data-format="news" aria-pressed="false">News <span>${newsCount}</span></button></div><div class="episode-search"><label for="episode-search"><span aria-hidden="true">⌕</span><span class="sr-only">Search episodes</span></label><input id="episode-search" type="search" placeholder="Search episodes…" autocomplete="off"><button type="button" id="clear-search" aria-label="Clear search" hidden>×</button></div></div><p class="sr-only" id="filter-status" role="status">${entries.length} episodes</p><div class="episode-grid">${entries.map(card).join("")}</div><div id="no-episodes" class="empty-library" ${entries.length ? "hidden" : ""}><h3>No matching episodes</h3><p>Try another search or choose All.</p><button type="button" id="reset-filters">Reset filters</button></div></section>
<section id="formats" class="formats-section"><div class="section-heading"><div><p class="eyebrow">MORE WAYS TO TELL IT</p><h2>Storytelling formats</h2></div></div><p class="styles-intro">Set the tone to professional, casual, or comic. Explore prepared examples below; new deliveries start with a reviewed script.</p><div class="style-grid">${presentationFormats.map((format) => formatOption(format, entries)).join("")}</div></section><section id="ideas" class="ideas-section"><div class="section-heading"><div><p class="eyebrow">THE NEXT CONVERSATION</p><h2>Ideas to explore next</h2></div><span class="section-note">Editorial selection · research pending</span></div><div class="ideas-list">${newsIdeas.map((topic, index) => `<details class="idea"><summary><span class="idea-number">${String(index + 1).padStart(2, "0")}</span><span><strong>${esc(topic.title)}</strong><small>${esc(topic.event)}</small></span><span class="research-tag">Research needed</span><span aria-hidden="true">+</span></summary><div class="idea-body"><p>${esc(topic.angle)}</p><p class="idea-sources">Start with ${topic.sourceUrls.map((url, i) => `<a href="${esc(url)}" target="_blank" rel="noreferrer">SAP source ${i + 1} ↗</a>`).join(" · ")}</p></div></details>`).join("")}</div><details class="tutorial-backlog"><summary>Explore ${tutorialIdeas.length} more tutorial ideas <span aria-hidden="true">+</span></summary><div>${tutorialIdeas.map((topic) => `<article><span>${esc(topic.pillar)}</span><h3>${esc(topic.title)}</h3><p>Research and environment verification needed.</p></article>`).join("")}</div></details></section>
<section id="production" class="production-section"><div><p class="eyebrow">YOUR NEXT SHORT</p><h2>Create, watch, refine.</h2><p>Local narration, captions, and MP4 export are available. Review the saved video and companion draft before sharing.</p></div><div class="production-facts"><div><span>Presenter</span><strong>Stock AI presenter</strong></div><div><span>First-video limit</span><strong>$${(content.budgetCents / 100).toFixed(2)}</strong></div><div><span>Current output</span><strong>${videos ? "Local voice + MP4 exports" : "Local voice previews"}</strong></div><p>${videos ? "Stock avatar animation and publication are pending." : "Final avatar, MP4, and publication are pending."}</p></div></section><footer class="studio-footer"><span>SAP Shorts / Your review workspace</span><span>Saved library · rebuild to include new episodes</span></footer></main></div><script>${script}</script></body></html>`;
  const files: Record<string, string | Buffer> = { "review.html": enhanceNewsReviewHtml(html) };
  for (const sample of content.voiceCatalog?.samples ?? [])
    files[`voices/${sample.key}/sample.wav`] = sample.audio;
  for (const entry of entries) {
    const prefix = `episodes/${episodeSelector(entry.episode)}`;
    files[`${prefix}/edit.html`] = await createScriptEditor(entry.episode, {
      defaultVoice: content.voiceCatalog?.selected ?? "af_heart",
      availableVoices: content.voiceCatalog?.available ?? [],
      reservedNames: entries
        .filter((other) => other.episode.id === entry.episode.id)
        .flatMap((other) =>
          other.episode.presentation?.variant ? [other.episode.presentation.variant] : [],
        ),
      sourceReviewExpired: entry.sourceReviewExpired,
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
      for (const [name, bytes] of Object.entries(entry.video.files)) {
        const copied =
          name === "review.html"
            ? bytes
                .toString("utf8")
                .replace(
                  "<!--LIBRARY_BACK-->",
                  `<p><a href="../../../review.html${studioReturnFragment(entry)}">← All episodes and styles</a></p><p class="note">${esc(comparisonLabel(entry))} · ${esc(recordedNarrator(entry))} · ${entry.preview.durationSeconds.toFixed(1)} seconds</p>${entry.sourceReviewExpired ? '<p class="note"><strong>Saved export · sources need rechecking.</strong> Re-read the official sources before producing or sharing a current news brief.</p>' : ""}`,
                )
                .replace(
                  '<div class="links">',
                  `<div class="links">${entry.download ? `<a href="../episode-package.zip" download="${esc(entry.download.filename)}">Download ${entry.download.savedNews ? "saved package" : "episode package"} · ZIP</a>` : ""}`,
                )
            : bytes;
        files[`${prefix}/video/${name}`] =
          name === "review.html" && isNewsEpisode(entry.episode)
            ? decorateNewsReviewHtml(String(copied), entry.episode.news, entry.sourceReviewExpired)
            : copied;
      }
    }
    files[`${prefix}/watch.html`] =
      `<!doctype html><html lang="en"><head>${head}<title>${esc(entry.episode.title)} · SAP Shorts</title><style>${css}</style></head><body class="watch-page"><header class="watch-header"><a href="../../review.html${studioReturnFragment(entry)}" class="back-link">← All episodes</a><div><strong>${esc(entry.episode.title)}</strong><span>${esc(presentationLabel(entry.episode))} · ${isNewsEpisode(entry.episode) ? `News · sources checked ${dateLabel(entry.episode.news.asOf)}` : "Tutorial · local demo evidence"}${entry.sourceReviewExpired ? " · source recheck needed" : ""}</span><span class="watch-narrator">${esc(recordedNarrator(entry))}${entry.preview.kind === "narrated" ? ` · ${entry.preview.durationSeconds.toFixed(1)}s` : ""}</span></div>${entry.video ? '<a class="watch-video-link" href="video/review.html">Watch MP4</a>' : ""}<a class="full-preview" href="review.html" target="_blank" rel="noreferrer">Open full preview ↗</a></header><iframe class="episode-frame" src="review.html" title="${esc(entry.episode.title)} episode review"></iframe></body></html>`;
    if (isNewsEpisode(entry.episode))
      files[`${prefix}/watch.html`] = decorateNewsReviewHtml(
        String(files[`${prefix}/watch.html`]),
        entry.episode.news,
        entry.sourceReviewExpired,
      );
  }
  return files;
}
