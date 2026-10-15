import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isNewsEpisode } from "./domain.js";
import type { LibraryContent, LibraryEntry } from "./library.js";
import { availabilityLabels } from "./news/contracts.js";
import { projectRoot } from "./paths.js";
import { episodeSelector, presentationFormats, presentationLabel } from "./presentation.js";
import { escapeHtml as esc } from "./review.js";

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

function card(entry: LibraryEntry) {
  const { episode, preview } = entry;
  const news = isNewsEpisode(episode);
  const kind = news ? "news" : "tutorial";
  const description = news ? episode.news.angle : episode.audience;
  const status = entry.sourceReviewExpired
    ? "Sources need rechecking"
    : entry.video
      ? "MP4 ready"
      : preview?.kind === "narrated"
        ? preview.timingReady
          ? "Narration timed"
          : "Timing needs review"
        : preview
          ? "Storyboard ready"
          : "Preview pending";
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
    ...episode.claims.map((claim) => claim.text),
    ...episode.scenes.map((scene) => scene.narration),
  ]
    .join(" ")
    .toLowerCase();
  return `<article class="episode-card" data-kind="${kind}" data-search="${esc(search)}"><div class="episode-art ${kind}"><div class="art-label">${news ? esc(episode.news.event) : "BUILD · RUN · VERIFY"}<span>${news ? "NEWS BRIEF" : "DEVELOPER TUTORIAL"}</span></div>${visual}</div><div class="episode-body"><div class="card-topline"><span class="kind-label">${news ? "SAP news" : "Tutorial"}</span><span class="state ${entry.sourceReviewExpired || (preview?.kind === "narrated" && !preview.timingReady) ? "attention" : ""}">${status}</span></div><h3>${esc(episode.title)}</h3><p class="delivery-label">${esc(presentationLabel(episode))}</p><p class="episode-description">${esc(description)}</p><div class="episode-facts"><span>${preview ? `${preview.durationSeconds.toFixed(1)}s ${preview.kind === "narrated" ? "measured" : "planned"}` : `${episode.targetDurationSeconds}s planned`}</span><span>${episode.sources.length} sources</span><span>${news ? `Checked ${dateLabel(episode.news.asOf)}` : preview ? `${episode.demo.expectedChecks.length} live demo checks` : "Demo check pending"}</span></div>${entry.sourceReviewExpired ? '<p class="recheck-note">Saved preview only. Re-read the sources before producing this news short.</p>' : ""}<div class="card-actions">${entry.video ? `<a class="review-link" href="${videoLinkFor(entry)}">Watch MP4 <span aria-hidden="true">↗</span></a>` : ""}${preview ? `<a class="review-link" href="${linkFor(entry)}">Review preview <span aria-hidden="true">↗</span></a>` : '<span class="preview-pending">No matching preview yet</span>'}<span class="avatar-note">Avatar pending</span></div><details class="source-details"><summary>Official sources <span>${episode.sources.length}</span></summary><ul>${episode.sources.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Read ${dateLabel(source.retrievedOn)}</small></li>`).join("")}</ul></details></div></article>`;
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
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'">`;
  const html = `<!doctype html><html lang="en"><head>${head}<title>SAP Shorts · Review studio</title><style>${css}</style></head><body>
<a class="skip-link" href="#episodes">Skip to episodes</a>
<div class="studio"><aside class="studio-nav"><a href="review.html" class="studio-brand"><i>S</i><span>SAP Shorts<small>REVIEW STUDIO</small></span></a><div class="nav-caption">YOUR WORKSPACE</div><nav aria-label="Studio"><a class="nav-current" href="#episodes"><span aria-hidden="true">▦</span> Episodes <small>${entries.length}</small></a><a href="#styles"><span aria-hidden="true">✦</span> Delivery styles</a><a href="#ideas"><span aria-hidden="true">✧</span> Next ideas <small>${newsIdeas.length + tutorialIdeas.length}</small></a><a href="#production"><span aria-hidden="true">◷</span> Production</a></nav><div class="nav-bottom"><span class="local-dot"></span>Local previews<small>Review the story before the final video.</small></div></aside>
<main class="studio-main"><header class="studio-header"><span>Your content workspace</span><span class="workspace-status"><i></i> Editorial drafts</span></header><section class="studio-intro"><div><p class="eyebrow">SAP KNOWLEDGE, ONE SHORT AT A TIME</p><h1>Demos and news.<br>One place to review.</h1><p>Turn a useful SAP topic into a clear story. Review the narration, sources, and timing before the final video.</p>${latestNews ? `<a class="hero-link" href="${linkFor(latestNews)}">Review the SAP news brief <span aria-hidden="true">↗</span></a>` : ""}</div><div class="studio-summary"><span class="eyebrow">ON YOUR DESK</span><div><b>${ready}</b><span>episode previews</span></div><div><b>${narrated}</b><span>with timed narration</span></div><p>${videos ? `${videos} verified MP4 export${videos === 1 ? "" : "s"}<br>Stock avatar animation pending` : "Local voice · timed captions<br>Stock avatar and video export pending"}</p></div></section>
<section id="episodes" class="episodes-section"><div class="section-heading"><div><p class="eyebrow">YOUR EPISODES</p><h2>Ready for a closer look</h2></div><span class="section-note">${entries.length} editorial drafts</span></div><div class="library-tools"><div class="format-filters" role="group" aria-label="Episode format"><button type="button" data-format="all" aria-pressed="true">All <span>${entries.length}</span></button><button type="button" data-format="tutorial" aria-pressed="false">Tutorials <span>${entries.length - newsCount}</span></button><button type="button" data-format="news" aria-pressed="false">News <span>${newsCount}</span></button></div><div class="episode-search"><label for="episode-search"><span aria-hidden="true">⌕</span><span class="sr-only">Search episodes</span></label><input id="episode-search" type="search" placeholder="Search episodes…" autocomplete="off"><button type="button" id="clear-search" aria-label="Clear search" hidden>×</button></div></div><p class="sr-only" id="filter-status" role="status">${entries.length} episodes</p><div class="episode-grid">${entries.map(card).join("")}</div><div id="no-episodes" class="empty-library" ${entries.length ? "hidden" : ""}><h3>No matching episodes</h3><p>Try another search or choose All.</p><button type="button" id="reset-filters">Reset filters</button></div></section>
<section id="styles" class="styles-section"><div class="section-heading"><div><p class="eyebrow">MAKE IT YOURS</p><h2>Same knowledge. Different delivery.</h2></div></div><p class="styles-intro">Choose a storytelling format, then set the tone to professional, casual, or comic. Add light humor or SAP geek jokes when they fit the audience.</p><div class="style-grid">${presentationFormats.map((format) => `<article class="style-option"><span class="style-icon" aria-hidden="true">${format.id === "dialogue" ? "↔" : format.id === "quiz" ? "?" : "✦"}</span><h3>${esc(format.name)}</h3><p>${esc(format.description)}</p><small>${format.id === "explainer" || format.id === "dialogue" ? "Prepared CAP examples below" : "Available writing format · script needed"}</small></article>`).join("")}</div><div class="style-examples"><h3>Compare the CAP pilot</h3><p>These versions keep the same demo and technical evidence. The conversation uses Mira and Max, with separate Kokoro voices. Humor is scripted. The MP4 uses speaker labels; stock avatar animation is pending.</p><div class="style-example-links">${entries
    .filter((entry) => entry.episode.id === "CAP-01")
    .map((entry) =>
      entry.preview
        ? `<a href="${entry.video ? videoLinkFor(entry) : linkFor(entry)}">${esc(entry.episode.presentation?.variant ? presentationLabel(entry.episode) : "Professional original")} <span aria-hidden="true">↗</span></a>`
        : `<span>${esc(presentationLabel(entry.episode))} · preview pending</span>`,
    )
    .join(
      "",
    )}</div></div></section><section id="ideas" class="ideas-section"><div class="section-heading"><div><p class="eyebrow">THE NEXT CONVERSATION</p><h2>Ideas to explore next</h2></div><span class="section-note">Editorial selection · research pending</span></div><div class="ideas-list">${newsIdeas.map((topic, index) => `<details class="idea"><summary><span class="idea-number">${String(index + 1).padStart(2, "0")}</span><span><strong>${esc(topic.title)}</strong><small>${esc(topic.event)}</small></span><span class="research-tag">Research needed</span><span aria-hidden="true">+</span></summary><div class="idea-body"><p>${esc(topic.angle)}</p><p class="idea-sources">Start with ${topic.sourceUrls.map((url, i) => `<a href="${esc(url)}" target="_blank" rel="noreferrer">SAP source ${i + 1} ↗</a>`).join(" · ")}</p></div></details>`).join("")}</div><details class="tutorial-backlog"><summary>Explore ${tutorialIdeas.length} more tutorial ideas <span aria-hidden="true">+</span></summary><div>${tutorialIdeas.map((topic) => `<article><span>${esc(topic.pillar)}</span><h3>${esc(topic.title)}</h3><p>Research and environment verification needed.</p></article>`).join("")}</div></details></section>
<section id="production" class="production-section"><div><p class="eyebrow">THE NEXT PRODUCTION STEP</p><h2>From a strong preview<br>to a finished short.</h2><p>Review the script and sources, then produce the stock presenter and final video through a permitted provider.</p></div><div class="production-facts"><div><span>Presenter</span><strong>Stock AI presenter</strong></div><div><span>First-video limit</span><strong>$${(content.budgetCents / 100).toFixed(2)}</strong></div><div><span>Current output</span><strong>${videos ? "Local voice + MP4 exports" : "Local voice previews"}</strong></div><p>${videos ? "Stock avatar animation and publication are pending." : "Final avatar, MP4, and publication are pending."}</p></div></section><footer class="studio-footer"><span>SAP Shorts / Your review workspace</span><span>Saved library · rebuild to include new episodes</span></footer></main></div><script>${script}</script></body></html>`;
  const files: Record<string, string | Buffer> = { "review.html": html };
  for (const entry of entries) {
    if (!entry.preview) continue;
    const prefix = `episodes/${episodeSelector(entry.episode)}`;
    for (const [name, bytes] of Object.entries(entry.preview.files))
      files[`${prefix}/${name}`] = bytes;
    if (entry.video) {
      for (const [name, bytes] of Object.entries(entry.video.files)) {
        files[`${prefix}/video/${name}`] =
          name === "review.html"
            ? bytes
                .toString("utf8")
                .replace(
                  "<!--LIBRARY_BACK-->",
                  '<p><a href="../../../review.html#styles">← All episodes and styles</a></p>',
                )
            : bytes;
      }
    }
    files[`${prefix}/watch.html`] =
      `<!doctype html><html lang="en"><head>${head}<title>${esc(entry.episode.title)} · SAP Shorts</title><style>${css}</style></head><body class="watch-page"><header class="watch-header"><a href="../../review.html" class="back-link">← All episodes</a><div><strong>${esc(entry.episode.title)}</strong><span>${esc(presentationLabel(entry.episode))} · ${isNewsEpisode(entry.episode) ? `News · sources checked ${dateLabel(entry.episode.news.asOf)}` : "Tutorial · local demo evidence"}${entry.sourceReviewExpired ? " · source recheck needed" : ""}</span></div><a class="full-preview" href="review.html" target="_blank" rel="noreferrer">Open full preview ↗</a></header><iframe class="episode-frame" src="review.html" title="${esc(entry.episode.title)} episode review"></iframe></body></html>`;
  }
  return files;
}
