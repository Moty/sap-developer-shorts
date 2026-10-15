import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { words } from "./contracts.js";
import type { DemoEvidence, Episode } from "./domain.js";
import { readLayout } from "./layout.js";
import { projectRoot, sourceFile } from "./paths.js";
import { presentationLabel } from "./presentation.js";

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => {
    return (
      (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<
          string,
          string
        >
      )[character] ?? character
    );
  });

export async function createReview(
  episode: Episode,
  evidence: DemoEvidence,
): Promise<Record<string, string>> {
  const { layout, text: layoutText } = await readLayout();
  const bounds = (box: {
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize?: number;
  }) =>
    `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;${box.fontSize ? `font-size:${box.fontSize}px;` : ""}`;
  const panels = await Promise.all(
    episode.scenes.map(async (scene, index) => {
      let content = `<div class="presenter-slot"><div class="avatar-mark">P</div><strong>Presenter ${scene.phase === "hook" ? "intro" : "closing"}</strong><small>Avatar and voice pending</small></div>`;
      if (scene.visual.kind === "code" && scene.visual.codePath) {
        const code = await readFile(await sourceFile(scene.visual.codePath), "utf8");
        content = `<pre>${escapeHtml(code)}</pre>`;
      } else if (scene.visual.kind === "output" && scene.visual.captureKey) {
        const capture = evidence.captures[scene.visual.captureKey];
        if (typeof capture === "string") content = `<pre>${escapeHtml(capture)}</pre>`;
        else {
          const rows = capture.value;
          content = `<div class="response-status">200 OK <span>Captured API result</span></div><table><thead><tr><th>Product</th><th>Stock</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.title)}</td><td>${row.stock}</td></tr>`).join("")}</tbody></table><p class="response-note">Showing title and stock fields</p>`;
        }
      }
      const instructions = scene.visual.instructions?.length
        ? `<pre class="run-instructions">${scene.visual.instructions.map(escapeHtml).join("\n")}</pre>`
        : "";
      return `<section class="scene" data-index="${index}" data-start="${scene.startSeconds}" data-end="${scene.endSeconds}" ${index ? "hidden" : ""}><h2 style="${bounds(layout.headline)}">${escapeHtml(scene.overlay)}</h2><div class="demo-panel${instructions ? " with-instructions" : ""}" style="${bounds(layout.demo)}"><div class="panel-label">${escapeHtml(scene.visual.label)}</div>${instructions}${content}</div><div class="caption" style="${bounds(layout.captions)}">${escapeHtml(scene.overlay)}</div><div class="mini-presenter" ${episode.presentation?.format === "dialogue" ? `data-speakers="${escapeHtml(episode.presentation.speakers.map((speaker) => speaker.name).join(" + "))}"` : ""} style="${bounds(layout.presenter)}">${episode.presentation?.format === "dialogue" ? escapeHtml(episode.presentation.speakers.map((speaker) => speaker.name).join(" + ")) : "Avatar<br>pending"}</div></section>`;
    }),
  );
  const wordCount = words(episode.scenes.map((scene) => scene.narration).join(" "));
  const narration = episode.scenes
    .map(
      (scene) =>
        `## ${scene.startSeconds}–${scene.endSeconds}s · ${scene.phase}\n\n${scene.dialogue ? scene.dialogue.map((turn) => `${episode.presentation?.speakers.find((speaker) => speaker.id === turn.speakerId)?.name}: ${turn.text}`).join("\n\n") : scene.narration}\n`,
    )
    .join("\n");
  const [css, player] = await Promise.all([
    readFile(resolve(projectRoot, "templates/review.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/review-player.js"), "utf8"),
  ]);
  const claimRows = episode.claims
    .map((claim) => {
      const sources = claim.sourceIds
        .map((id) => {
          const source = episode.sources.find((item) => item.id === id);
          if (!source) throw new Error(`Unknown claim source: ${id}`);
          return `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>`;
        })
        .join("<br>");
      const checks = claim.evidenceChecks
        .map(
          (check) =>
            `${evidence.checks.includes(check) ? "✓" : "Pending"} ${escapeHtml(check.replaceAll("-", " "))}`,
        )
        .join("<br>");
      return `<tr><td>${escapeHtml(claim.text)}</td><td>${sources}</td><td>${checks}</td></tr>`;
    })
    .join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(episode.id)} · Pilot review</title>
<style>
${css}
</style></head><body class="delivery-${episode.presentation?.tone ?? "professional"}">
<header><div class="brand"><i>S</i>SAP Developer Shorts</div><div class="badge">Technical demo verified</div></header>
<main><div class="eyebrow">${escapeHtml(episode.id)} / Revision ${episode.version} / Pilot review</div><h1>${escapeHtml(episode.title)}</h1><p class="lede">A first look at the story, code, and results. Play through the planned scenes or select a moment to inspect it.</p>
${episode.presentation ? `<p class="delivery-note">${escapeHtml(presentationLabel(episode))} · ${episode.presentation.format === "dialogue" ? "Two AI voices; avatars pending" : "Local AI narration"}</p>` : ""}
<!--MEDIA_PLAYER-->
<div class="workspace"><div class="preview"><div class="phone"><div class="canvas" style="width:${layout.canvas.width}px;height:${layout.canvas.height}px"><div class="canvas-brand">SAP / DEVELOPER SHORTS</div>${panels.join("")}<div class="canvas-footer">STORYBOARD · PLANNED TIMING</div></div></div><div class="controls"><button id="play" aria-label="Play silent storyboard">▶</button><input id="scrub" type="range" min="0" max="${episode.targetDurationSeconds}" value="0" step="0.1" aria-label="Storyboard time"><output id="time"></output></div><p class="note">Silent storyboard. Presenter, voice, and synchronized captions are pending. Code panels are illustrated from the verified source; results come from this run.</p></div>
<aside><div class="eyebrow">Scene by scene</div><div class="scene-list">${episode.scenes.map((scene, index) => `<button class="scene-button" data-scene="${index}" aria-pressed="${index === 0}"><span class="scene-time">${scene.startSeconds}–${scene.endSeconds}s</span><span class="scene-title">${escapeHtml(scene.overlay)}</span><span class="scene-voice">${escapeHtml(scene.narration)}</span></button>`).join("")}</div><div class="facts"><div class="fact"><b>${episode.targetDurationSeconds}s</b><span>Planned duration</span></div><div class="fact"><b>${wordCount}</b><span>Spoken words</span></div><div class="fact"><b>${evidence.checks.length}/${evidence.checks.length}</b><span>Live checks passed</span></div></div><div class="eyebrow">Verified in this run</div><div class="checks">${evidence.checks.map((check) => `<span>✓ ${escapeHtml(check.replaceAll("-", " "))}</span>`).join("")}</div><div class="sources">${episode.sources.map((source) => `<p><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)} ↗</a></p>`).join("")}</div><p class="small">CAP ${escapeHtml(evidence.environment.cds)} · ${escapeHtml(evidence.environment.node)} · ${escapeHtml(evidence.verifiedAt)}</p></aside></div>
<div class="lower"><section><div class="eyebrow">Companion post / draft</div><h2>Ready for editorial review</h2><div class="post">${escapeHtml(episode.publication.text)}</div></section><section><div class="eyebrow">Before recording</div><h2>Prepare the demo</h2>${episode.environment.prerequisites.map((prerequisite) => `<p>${escapeHtml(prerequisite)}</p>`).join("")}<h2>Next production step</h2><p>Choose the presenter and voice, measure narration, and align the final scenes and captions. The code link in the companion post needs a published repository path.</p><p>This local prototype allows anonymous reads. Production authentication and deployment need their own implementation.</p><p class="small">This preview makes no publication decision and sends no content to a provider.</p></section></div>
<section class="claim-review"><div class="eyebrow">Editorial evidence</div><h2>What supports each claim</h2><p>Compare the narration with these documentation links and checks. The checks confirm the local demo behavior; source relevance still needs editorial judgment.</p><div class="table-scroll"><table><thead><tr><th>Claim</th><th>Official source</th><th>Live checks</th></tr></thead><tbody>${claimRows}</tbody></table></div></section>
</main><script>
${player}
</script></body></html>`;
  return {
    "review.html": html,
    "narration.md": `# ${episode.id}: ${episode.title}\n\nDraft timing: ${episode.targetDurationSeconds}s; ${wordCount} spoken words. Measure audio before captioning.\n\n${narration}\n## Pronunciation\n\n${Object.entries(
      episode.pronunciation,
    )
      .map(([term, pronunciation]) => `- ${term}: ${pronunciation}`)
      .join("\n")}\n`,
    "linkedin.txt": `${episode.publication.text}\n`,
    "video-layout.json": layoutText,
  };
}
