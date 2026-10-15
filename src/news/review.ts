import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NewsEpisode } from "../domain.js";
import { readLayout } from "../layout.js";
import { projectRoot } from "../paths.js";
import { presentationLabel } from "../presentation.js";
import { escapeHtml as esc } from "../review.js";
import { availabilityLabels } from "./contracts.js";

export async function createNewsReview(episode: NewsEpisode): Promise<Record<string, string>> {
  const { layout, text: layoutText } = await readLayout();
  const bounds = (box: {
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize?: number;
  }) =>
    `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;${box.fontSize ? `font-size:${box.fontSize}px;` : ""}`;
  const panels = episode.scenes.map((scene, index) => {
    const claim = episode.claims.find((item) => item.id === scene.claimIds[0]);
    let content = `<div class="news-intro"><span class="news-kicker">${esc(episode.news.event)}</span><strong>What changed.<br>Why it matters.<br>When it ships.</strong><p>Sources checked ${esc(episode.news.asOf)}</p><small>Editorial selection · draft</small></div>`;
    if (scene.visual.kind === "news-card" && claim) {
      const source = episode.sources.find((item) => item.id === claim.sourceIds[0]);
      content = `<div class="news-card"><span class="availability ${claim.availability.status}">${availabilityLabels[claim.availability.status]}</span><h3>${esc(claim.text)}</h3><div class="news-timing">${esc(claim.availability.timing)}</div><p>${esc(claim.availability.scope)}</p><small>Source: ${esc(source?.publisher ?? "SAP")} · checked ${esc(claim.checkedOn)}</small></div>`;
    }
    return `<section class="scene" data-index="${index}" data-start="${scene.startSeconds}" data-end="${scene.endSeconds}" ${index ? "hidden" : ""}><h2 style="${bounds(layout.headline)}">${esc(scene.overlay)}</h2><div class="demo-panel news-panel" style="${bounds(layout.demo)}"><div class="panel-label">${esc(scene.visual.label)}</div>${content}</div><div class="caption" style="${bounds(layout.captions)}">${esc(scene.overlay)}</div><div class="mini-presenter" ${episode.presentation?.format === "dialogue" ? `data-speakers="${esc(episode.presentation.speakers.map((speaker) => speaker.name).join(" + "))}"` : ""} style="${bounds(layout.presenter)}">${episode.presentation?.format === "dialogue" ? esc(episode.presentation.speakers.map((speaker) => speaker.name).join(" + ")) : "Avatar<br>pending"}</div></section>`;
  });
  const [css, player] = await Promise.all([
    readFile(resolve(projectRoot, "templates/review.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/review-player.js"), "utf8"),
  ]);
  const links = (ids: string[]) =>
    ids
      .map((id) => {
        const source = episode.sources.find((item) => item.id === id);
        if (!source) throw new Error(`Unknown news source: ${id}`);
        return `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)}</a>`;
      })
      .join("<br>");
  const wordCount = episode.scenes.flatMap((scene) => scene.narration.trim().split(/\s+/u)).length;
  const rows = episode.claims
    .map(
      (claim) =>
        `<tr><td>${esc(claim.text)}<br><strong>${availabilityLabels[claim.availability.status]}</strong><br>${esc(claim.availability.timing)}<br>${esc(claim.availability.scope)}</td><td>${links(claim.sourceIds)}</td><td>${claim.support.map((item) => `<p><strong>${esc(item.locator)}</strong><br>${esc(item.summary)}</p>`).join("")}<small>Checked ${esc(claim.checkedOn)}</small></td></tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(episode.id)} · SAP news review</title><style>${css}</style></head><body class="delivery-${episode.presentation?.tone ?? "professional"}">
<header><div class="brand"><i>S</i>SAP Shorts</div><div class="badge news-badge">News / editorial draft</div></header>
<main><div class="eyebrow">${esc(episode.id)} / Revision ${episode.version} / ${esc(episode.news.event)}</div><h1>${esc(episode.title)}</h1><p class="lede">${esc(episode.news.angle)} Sources checked ${esc(episode.news.asOf)}. This is an editorial selection from this event.</p>
${episode.presentation ? `<p class="delivery-note">${esc(presentationLabel(episode))} · ${episode.presentation.format === "dialogue" ? "Two AI voices; avatars pending" : "Local AI narration"}</p>` : ""}
<!--MEDIA_PLAYER-->
<div class="workspace"><div class="preview"><div class="phone"><div class="canvas" style="width:${layout.canvas.width}px;height:${layout.canvas.height}px"><div class="canvas-brand">SAP / NEWS SHORTS · ${esc(episode.news.asOf)}</div>${panels.join("")}<div class="canvas-footer">STORYBOARD · PLANNED TIMING</div></div></div><div class="controls"><button id="play" aria-label="Play silent storyboard">▶</button><input id="scrub" type="range" min="0" max="${episode.targetDurationSeconds}" value="0" step="0.1" aria-label="Storyboard time"><output id="time"></output></div><p class="note">Silent news storyboard. Announcement cards reflect the dated source review. Narration, avatar, and final editorial approval are pending.</p></div>
<aside><div class="eyebrow">Scene by scene</div><div class="scene-list">${episode.scenes.map((scene, index) => `<button class="scene-button" data-scene="${index}" aria-pressed="${index === 0}"><span class="scene-time">${scene.startSeconds}–${scene.endSeconds}s</span><span class="scene-title">${esc(scene.overlay)}</span><span class="scene-voice">${esc(scene.narration)}</span></button>`).join("")}</div><div class="facts"><div class="fact"><b>${episode.targetDurationSeconds}s</b><span>Planned duration</span></div><div class="fact"><b>${wordCount}</b><span>Spoken words</span></div><div class="fact"><b>${episode.claims.length}</b><span>Sourced announcements</span></div></div><div class="eyebrow">Dated source review</div><div class="checks"><span>As of ${esc(episode.news.asOf)}</span><span>Recheck within ${episode.news.maxAgeDays} days before production</span><span>Availability and scope recorded per announcement</span></div><div class="sources">${episode.sources.map((source) => `<p>${links([source.id])}<br><small>${source.publishedOn ? `Published ${esc(source.publishedOn)}` : "Publication date not supplied"} · read ${esc(source.retrievedOn)}</small></p>`).join("")}</div></aside></div>
<div class="lower"><section><div class="eyebrow">Companion post / draft</div><h2>Ready for editorial review</h2><div class="post">${esc(episode.publication.text)}</div></section><section><div class="eyebrow">News production</div><h2>Keep the dates in the story</h2><p>Confirm the feature, region, release window, and account eligibility before recording. Planned dates remain plans even when their calendar quarter has started.</p><h2>Next production step</h2><p>Measure narration and captions, recheck the source pages, and review the final news script before using a permitted avatar provider.</p><p class="small">These cards summarize SAP announcements. No product behavior was tested for this news episode. This preview sends no content to a provider and makes no publication decision.</p></section></div>
<section class="claim-review"><div class="eyebrow">Editorial evidence</div><h2>What supports each announcement</h2><p>Support notes were recorded during source review. Automated checks validate dates and references; an editor must judge whether each source supports the narration. Pages are not fetched automatically during rendering.</p><div class="table-scroll"><table><thead><tr><th>Announcement and availability</th><th>Official source</th><th>Review notes</th></tr></thead><tbody>${rows}</tbody></table></div></section>
</main><script>${player}</script></body></html>`;
  return {
    "review.html": html,
    "narration.md": `# ${episode.id}: ${episode.title}\n\nNews draft · sources checked ${episode.news.asOf} · ${episode.targetDurationSeconds}s planned · ${wordCount} words.\n\n${episode.scenes.map((scene) => `## ${scene.startSeconds}–${scene.endSeconds}s · ${scene.phase}\n\n${scene.narration}\n`).join("\n")}\n## Sources\n\n${episode.sources.map((source) => `- [${source.title}](${source.url}) — read ${source.retrievedOn}`).join("\n")}\n`,
    "linkedin.txt": `${episode.publication.text}\n`,
    "video-layout.json": layoutText,
  };
}
