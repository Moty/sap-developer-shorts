import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { hash } from "./digest.js";
import { type ContentEpisode, type DemoEvidence, isNewsEpisode } from "./domain.js";
import type { NarrationTiming } from "./media/model.js";
import { availabilityLabels } from "./news/contracts.js";
import { sourceFile } from "./paths.js";
import { assertPresentation, episodeSelector } from "./presentation.js";
import { escapeHtml as esc } from "./review.js";
import { feedSceneDesign } from "./video/feed-design.js";
import { storySteps } from "./video/motion.js";
import {
  chartPlan,
  imagePlacement,
  sequenceGeometry,
  visualLabelLines,
} from "./video/visual-plan.js";
import { type ResolvedVisualAsset, resolveVisualAssets } from "./visual-assets.js";

export const presentationAssets = ["templates/presentation.css", "templates/presentation.js"];
export interface PresentationInput {
  previewOnly?: boolean;
  episode: ContentEpisode;
  code: Record<string, string>;
  evidence?: DemoEvidence;
  timing?: NarrationTiming;
  audioSrc?: "narration.wav" | "short.mp4";
  sourceReviewExpired?: boolean;
  workspaceHref?: "../../review.html#episodes";
  visualAssets?: Record<string, ResolvedVisualAsset>;
  allowMissingVisualAssets?: boolean;
}
/** Placeholder replaced by the shared episode header when the library copies the deck. */
export const deckShellMarker = "<!--EPISODE_SHELL-->";
const workspaceLink = (href: string) => `<a href="${href}">← Workspace</a>`;

/** Put a library deck inside the shared episode header; other decks are returned unchanged. */
export function withDeckShell(html: string, header: string, script: string): string {
  if (!html.includes(deckShellMarker)) return html;
  const closing = html.lastIndexOf("</body>");
  const withScript =
    closing < 0
      ? html
      : `${html.slice(0, closing)}<script>${script.replace(/<\/script/giu, "<\\/script")}</script>${html.slice(closing)}`;
  return withScript
    .replace(/<body\b([^>]*)>/u, (_body, attributes: string) =>
      /\bclass="/u.test(attributes)
        ? `<body data-episode-shell${attributes.replace(/\bclass="/u, 'class="ep-page ')}>`
        : `<body data-episode-shell class="ep-page"${attributes}>`,
    )
    .replace(deckShellMarker, () => header)
    .replace(workspaceLink("../../review.html#episodes"), "");
}
export function presentationPlan(input: PresentationInput) {
  const { episode, code, evidence, timing } = input;
  assertPresentation(episode);
  const scenes = episode.scenes.map((scene, index) => {
    const measured = timing?.scenes.find((item) => item.id === scene.id);
    if (timing && !measured) throw new Error(`Presentation timing is missing ${scene.id}`);
    const claims =
      isNewsEpisode(episode) && "claimIds" in scene
        ? scene.claimIds.map((id) => {
            const claim = episode.claims.find((item) => item.id === id);
            if (!claim) throw new Error(`Unknown presentation claim: ${id}`);
            return claim;
          })
        : [];
    const capture =
      scene.visual.kind === "output" && "captureKey" in scene.visual
        ? evidence?.captures[scene.visual.captureKey ?? ""]
        : undefined;
    const sourceCode = "codePath" in scene.visual ? code[scene.visual.codePath ?? ""] : undefined;
    return {
      design: feedSceneDesign(episode, index),
      id: scene.id,
      index,
      phase: scene.phase,
      title: feedSceneDesign(episode, index).headline,
      label: scene.visual.label,
      narration:
        scene.dialogue
          ?.map(
            (turn) =>
              `${episode.presentation?.speakers.find((speaker) => speaker.id === turn.speakerId)?.name ?? turn.speakerId}: ${turn.text}`,
          )
          .join("\n") ?? scene.narration,
      start: measured?.startSeconds ?? scene.startSeconds,
      end: measured?.endSeconds ?? scene.endSeconds,
      kind:
        scene.visual.kind === "code"
          ? "code"
          : capture && typeof capture !== "string"
            ? "results"
            : capture
              ? "capture"
              : claims.length
                ? "claim"
                : "story",
      ...(sourceCode ? { code: sourceCode } : {}),
      capture: typeof capture === "string" ? capture : undefined,
      rows:
        capture && typeof capture !== "string"
          ? capture.value.map((row) => ({ title: row.title, stock: row.stock }))
          : undefined,
      instructions: "instructions" in scene.visual ? (scene.visual.instructions ?? []) : [],
      claims: claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        status: availabilityLabels[claim.availability.status],
        timing: claim.availability.timing,
        scope: claim.availability.scope,
        sourceIds: claim.sourceIds,
      })),
    };
  });
  return {
    schemaVersion: 1,
    renderer: "reveal.js@6.0.2",
    selector: episodeSelector(episode),
    title: episode.title,
    width: 1080,
    height: 1920,
    duration: timing?.durationSeconds ?? episode.targetDurationSeconds,
    timing: timing ? "measured narration" : "planned script timing",
    design: episode.presentation?.design ?? null,
    basis: evidence
      ? `Captured local demo · ${evidence.verifiedAt}`
      : isNewsEpisode(episode)
        ? `SAP sources checked ${episode.news.asOf}`
        : "Script preview · no captured demo result",
    sourceReviewExpired: !!input.sourceReviewExpired,
    ...(input.audioSrc ? { audioSrc: input.audioSrc } : {}),
    cues:
      timing?.cues.map((cue) => ({
        start: cue.startSeconds,
        end: cue.endSeconds,
        text: cue.text,
        speaker: cue.speakerName ?? "Narrator",
      })) ?? [],
    steps: storySteps(episode),
    sources: episode.sources,
    claims: episode.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceIds: claim.sourceIds,
    })),
    scenes,
    missingVisuals:
      episode.presentation?.design?.scenes.some(
        (scene) => scene.image && !input.visualAssets?.[scene.image.assetId],
      ) ?? false,
    allowMissingVisualAssets: !!input.allowMissingVisualAssets,
    visualAssets: Object.fromEntries(
      Object.entries(input.visualAssets ?? {})
        .filter(([id]) =>
          episode.presentation?.design?.scenes.some((scene) => scene.image?.assetId === id),
        )
        .map(([id, { dataUrl, label, credit, width, height }]) => [
          id,
          { dataUrl, label, credit, width, height },
        ]),
    ),
    inputHash: hash(JSON.stringify(episode)),
  };
}
export type PresentationPlan = ReturnType<typeof presentationPlan>;
let vendor: Promise<{ js: string; css: string; license: string }> | undefined;
export function revealAssets() {
  vendor ??= (async () => {
    const directory = resolve(dirname(createRequire(import.meta.url).resolve("reveal.js")), "..");
    const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
    if (pkg.version !== "6.0.2")
      throw new Error("Install the pinned Reveal.js version with npm ci");
    const [js, css, license] = await Promise.all(
      ["dist/reveal.js", "dist/reveal.css", "LICENSE"].map((name) =>
        readFile(resolve(directory, name), "utf8"),
      ),
    );
    return { js: js as string, css: css as string, license: license as string };
  })();
  return vendor;
}
function sceneHtml(scene: PresentationPlan["scenes"][number], plan: PresentationPlan) {
  const steps = `<div class="story-flow">${plan.steps.map((step, index) => `<button type="button" class="flow-step transition-all duration-500 ease-out" data-jump="${step.index}" style="--order:${index}"><span class="step-index">0${index + 1}</span><strong>${esc(step.label)}</strong><span class="flow-arrow" aria-hidden="true">↓</span></button>`).join("")}</div>`;
  let content = steps;
  if (scene.design.kind === "hook" && scene.design.serviceBridge) {
    const target =
      plan.scenes.find((item) => item.id === "service")?.index ?? plan.steps[0]?.index ?? 0;
    content = `<p class="hook-topic">${esc(plan.title)}</p><div class="hook-bridge" role="group" aria-label="A data model needs a service to expose its API"><div class="bridge-node"><span class="bridge-glyph">{ }</span><strong>MODEL</strong></div><span class="bridge-link" aria-hidden="true">→</span><button type="button" class="bridge-node bridge-missing" data-jump="${target}"><span class="bridge-glyph">?</span><strong>SERVICE?</strong></button><span class="bridge-link" aria-hidden="true">→</span><div class="bridge-node"><span class="bridge-glyph">↗</span><strong>API</strong></div></div><p class="hook-insight">The missing connection</p>`;
  }
  if (scene.design.kind === "closing")
    content = `<blockquote class="closing-question">${esc(scene.design.question)}</blockquote>${plan.sources[0] ? `<a class="closing-action" href="${esc(plan.sources[0].url)}" target="_blank" rel="noreferrer">Open the official guide ↗</a>` : ""}`;
  if (scene.kind === "code")
    content = `<div class="code-window"><div class="window-label"><span class="window-dots" aria-hidden="true">● ● ●</span><span>${esc(scene.label)}</span></div><pre class="code-content"><code>${
      scene.code
        ? scene.code
            .split("\n")
            .map(
              (line, index) =>
                `<span class="code-line" data-line="${index}">${esc(line) || " "}</span>`,
            )
            .join("\n")
        : "Code is unavailable for this saved source."
    }</code></pre><div class="spoken-code-focus" hidden aria-live="off"></div></div><details class="code-interaction"><summary>Inspect source &amp; explanation</summary><label>Inspect a line<input type="range" min="0" max="${Math.max(0, (scene.code?.split("\n").length ?? 1) - 1)}" value="0" data-code-focus aria-label="Highlighted source line"></label><button type="button" data-show-story>What to notice</button><p class="story-explanation" hidden>${esc(scene.narration)}</p></details>`;
  if (scene.kind === "results")
    content = `<div class="result-head"><div><span class="data-count" data-counter="${scene.rows?.length ?? 0}">${scene.rows?.length ?? 0}</span><span class="metric-unit">captured rows</span></div><span class="response-state">200 OK</span></div>${scene.instructions.length ? `<details class="request-details"><summary>Request & command</summary><pre>${scene.instructions.map(esc).join("\n")}</pre></details>` : ""}<div class="result-tabs" role="group" aria-label="Captured result view"><button type="button" data-result-view="rows" aria-pressed="true">Results</button><button type="button" data-result-view="bars" aria-pressed="false">Stock chart</button></div><div class="result-rows" data-view="rows">${scene.rows?.map((row) => `<div class="result-row" data-stock="${row.stock}"><strong>${esc(row.title)}</strong><span>${row.stock}<small>in stock</small></span></div>`).join("")}</div><div class="result-bars" data-view="bars" hidden>${scene.rows?.map((row) => `<div class="stock-bar-row" data-stock="${row.stock}"><div><span>${esc(row.title)}</span><b>${row.stock}</b></div><div class="stock-track"><i style="--stock:${Math.max(0, row.stock) / Math.max(1, ...(scene.rows?.map((item) => item.stock) ?? []))}"></i></div></div>`).join("")}</div><label class="stock-filter">Explore saved rows: minimum stock <output>0</output><input type="range" data-stock-filter min="0" max="${Math.max(1, ...(scene.rows?.map((row) => row.stock) ?? []))}" value="0" aria-label="Minimum stock in captured rows"></label><p class="data-footnote">Explores this captured result. No live request is made.</p>`;
  if (scene.kind === "capture")
    content = `<div class="capture-window"><span class="response-state">CAPTURED RESPONSE</span><pre>${esc(scene.capture ?? "")}</pre><button type="button" data-show-story>Explain this response</button><p class="story-explanation" hidden>${esc(scene.narration)}</p></div>`;
  if (scene.kind === "claim")
    content = `<div class="claim-stack">${scene.claims
      .map(
        (claim) =>
          `<article class="sourced-claim transition-all duration-500 ease-out"><div class="availability" data-availability="${esc(claim.status)}"><span class="status-orbit" aria-hidden="true"></span>${esc(claim.status)}</div><h3>${esc(claim.text)}</h3><div class="availability-line"><span class="availability-dot" aria-hidden="true"></span><p>${esc(claim.timing)}</p></div><details><summary>Scope & sources</summary><p>${esc(claim.scope)}</p>${claim.sourceIds
            .map((id) => {
              const source = plan.sources.find((item) => item.id === id);
              return source
                ? `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a>`
                : "";
            })
            .join("")}</details></article>`,
      )
      .join("")}</div>`;
  if (scene.design.composition) {
    const composition = scene.design.composition;
    content = `<div class="story-composition composition-${composition.kind}" aria-label="${composition.kind} visual explanation">${composition.items
      .map((item, index) => {
        const evidence = plan.claims.find((claim) => claim.id === item.claimId);
        return `<details class="composition-card" data-composition-item="${index}"${index === 0 ? ' data-active="true"' : ""}><summary><span class="composition-index">${composition.kind === "comparison" ? (index === 0 ? "A" : "B") : String(index + 1).padStart(2, "0")}</span><strong>${esc(item.label)}</strong><span class="composition-arrow" aria-hidden="true">${composition.kind === "steps" ? "↓" : "+"}</span></summary><p>${esc(evidence?.text ?? scene.narration)}</p>${evidence ? `<small>Saved evidence · ${esc(evidence.id)}</small>` : ""}</details>`;
      })
      .join("")}</div>`;
  }
  if (scene.kind === "results" && scene.design.dataView !== "rows") {
    const chart = chartPlan(scene.rows ?? [], 1, true);
    content = `<div class="advanced-chart" data-chart-style="${scene.design.dataView}"><h3>Stock in captured results</h3>${scene.instructions.length ? `<details class="request-details"><summary>Request &amp; command</summary><pre>${scene.instructions.map(esc).join("\n")}</pre></details>` : ""}${chart.rows.map((row) => `<div class="advanced-chart-row"><div><strong>${esc(row.label)}</strong><b>${row.value}</b></div><div class="advanced-chart-track"><i data-chart-fraction="${row.fraction}" style="--fraction:${row.fraction}"></i></div></div>`).join("")}<p>Zero baseline · ${chart.rows.length} saved rows · stock units</p><details><summary>See captured data table</summary><table><thead><tr><th>Product</th><th>Stock</th></tr></thead><tbody>${chart.rows.map((row) => `<tr><td>${esc(row.label)}</td><td>${row.value}</td></tr>`).join("")}</tbody></table></details></div>`;
  }
  if (scene.design.composition && ["flow", "timeline"].includes(scene.design.composition.kind)) {
    const composition = scene.design.composition;
    const nodes = sequenceGeometry(composition.kind, composition.items.length, {
      x: 0,
      y: 10,
      width: 900,
      height: 680,
    });
    content = `<svg class="sequence-graphic" viewBox="0 0 900 700" role="img" aria-label="${esc(composition.items.map((item) => item.label).join(" → "))}">${composition.kind === "timeline" ? '<path d="M18 10V690" stroke="var(--scene-accent)" stroke-width="4"/>' : ""}${nodes
      .map((node, index) => {
        const item = composition.items[index];
        if (!item) return "";
        return `<g data-composition-item="${index}" data-active="${index === 0}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="24" fill="var(--scene-surface)" stroke="var(--scene-accent)" stroke-width="3"/>${composition.kind === "timeline" ? `<circle cx="${node.markerX}" cy="${node.markerY}" r="10" fill="var(--scene-accent)"/>` : ""}<text x="${node.x + 28}" y="${node.y + 32}" class="sequence-number">${String(index + 1).padStart(2, "0")}</text><text x="${node.x + 28}" y="${node.y + 78}">${visualLabelLines(
          item.label,
        )
          .map(
            (line, lineIndex) =>
              `<tspan x="${node.x + 28}" dy="${lineIndex ? 46 : 0}">${esc(line)}</tspan>`,
          )
          .join(
            "",
          )}</text>${composition.kind === "flow" && index < nodes.length - 1 ? `<path d="M${node.x + node.width / 2} ${node.y + node.height + 2}v23m-8-8 8 8 8-8" stroke="var(--scene-accent)" stroke-width="3" fill="none"/>` : ""}</g>`;
      })
      .join(
        "",
      )}</svg><p class="sequence-note">${composition.kind === "timeline" ? "Ordered milestones" : "Follow the mechanism from one step to the next."}</p>`;
  }
  const image = scene.design.image ? plan.visualAssets[scene.design.image.assetId] : undefined;
  let backdropImage = "";
  if (scene.design.image && !image) {
    if (!plan.allowMissingVisualAssets)
      throw new Error("Selected presentation image is unavailable.");
    const warning =
      '<p class="missing-visual" role="status">Restore the selected image in Advanced presentation to rebuild this design.</p>';
    if (scene.design.image.treatment === "card") content = warning;
    else backdropImage = warning;
  }
  if (scene.design.image && image) {
    const graphic = scene.design.image;
    if (graphic.treatment === "background")
      backdropImage = `<div class="visual-image-background" aria-hidden="true"><img src="${image.dataUrl}" alt="" style="object-fit:${graphic.fit};object-position:${graphic.focalX * 100}% ${graphic.focalY * 100}%"></div>${image.credit ? `<small class="background-image-credit">Image: ${esc(image.credit)}</small>` : ""}`;
    else {
      const placed = imagePlacement(
        image.width,
        image.height,
        { x: 0, y: 0, width: 800, height: 500 },
        graphic.fit,
        graphic.focalX,
        graphic.focalY,
      );
      content = `<figure class="visual-image-figure"><svg viewBox="0 0 800 500" role="img" aria-label="${esc(graphic.alt)}"><defs><clipPath id="image-clip-${scene.index}"><rect width="800" height="500" rx="20"/></clipPath></defs><image href="${image.dataUrl}" x="${placed.x}" y="${placed.y}" width="${placed.width}" height="${placed.height}" preserveAspectRatio="none" clip-path="url(#image-clip-${scene.index})"/></svg><figcaption>${esc(graphic.caption ?? "Illustration")}<small>${esc(image.credit)}</small></figcaption></figure>`;
    }
  }
  return `<section class="deck-slide scene-${scene.kind} feed-${scene.design.kind} emphasis-${scene.design.emphasis}${scene.design.custom ? " custom-design" : ""}" style="--motion-duration:${scene.design.entranceSeconds}s;--scene-accent:${scene.design.accent};--scene-secondary:${scene.design.secondary};--scene-surface:${scene.design.surface}" data-scene="${scene.index}" data-auto-animate data-transition="fade">${backdropImage}<div class="advanced-backdrop" aria-hidden="true"></div><div class="ambient-field" aria-hidden="true"></div><header class="slide-topline"><span>SAP DEVELOPER SHORTS</span><span>${String(scene.index + 1).padStart(2, "0")} / ${String(plan.scenes.length).padStart(2, "0")}</span></header><h2 data-id="headline">${esc(scene.title)}</h2><div class="slide-main">${content}</div><footer class="slide-footer"><span>${esc(scene.label)}</span><div class="narration-caption" aria-live="off"></div><div class="scene-progress"><i></i></div></footer></section>`;
}
export async function createPresentationDeck(input: PresentationInput) {
  const plan = presentationPlan({
    ...input,
    visualAssets:
      input.visualAssets ??
      (await resolveVisualAssets(input.episode, undefined, input.allowMissingVisualAssets)),
  });
  const [assets, css, js, visualJs] = await Promise.all([
    revealAssets(),
    readFile(await sourceFile("templates/presentation.css"), "utf8"),
    readFile(await sourceFile("templates/presentation.js"), "utf8"),
    readFile(await sourceFile("src/video/visual-plan.js"), "utf8"),
  ]);
  const data = JSON.stringify(plan).replaceAll("<", "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'"><title>${esc(plan.title)} · Interactive presentation</title><style>${assets.css}\n${css}</style></head><body${input.previewOnly ? ' class="design-preview"' : ""}>${input.workspaceHref ? deckShellMarker : ""}<main class="presentation-workspace"><header class="presentation-heading">${input.previewOnly ? "" : input.workspaceHref ? workspaceLink(input.workspaceHref) : `<a href="review.html">← Video review</a>`}<div><p>SAP SHORTS / INTERACTIVE PRESENTATION</p><h1>${esc(plan.title)}</h1><span>${esc(plan.basis)} · ${esc(plan.timing)}</span></div></header>${plan.missingVisuals ? '<p class="stale-source-warning" role="alert">A selected local image is unavailable. Restore it or choose another image before producing. Saved MP4s remain available.</p>' : ""}${plan.sourceReviewExpired ? '<p class="stale-source-warning">Saved source review has expired. Recheck official sources before producing or sharing current news.</p>' : ""}<div class="presentation-layout"><div class="presentation-stage"><div class="phone-stage"><div class="reveal"><div class="slides">${plan.scenes.map((scene) => sceneHtml(scene, plan)).join("")}</div></div></div><div class="playback-controls"><button type="button" id="deck-previous" aria-label="Previous scene">←</button><button type="button" id="deck-play">Play ${plan.audioSrc ? "with narration" : "silent preview"}</button><button type="button" id="deck-next" aria-label="Next scene">→</button><button type="button" id="deck-focus" aria-pressed="false">Focus view</button><output id="deck-time">0:00</output></div><label class="timeline-label">Presentation timeline<input id="deck-seek" type="range" min="0" max="${plan.duration}" step="0.01" value="0"></label><p class="playback-note" role="status" id="deck-status">Explore the controls inside each scene, or play the timed story. Interactions are available in this deck; exported videos use a fixed animation timeline.</p>${plan.audioSrc ? `<audio id="deck-audio" src="${plan.audioSrc}" preload="metadata"></audio>` : ""}</div><aside class="presentation-inspector"><h2>Story & evidence</h2><nav aria-label="Presentation scenes">${plan.scenes.map((scene) => `<button type="button" data-jump="${scene.index}"><span>${String(scene.index + 1).padStart(2, "0")}</span><strong>${esc(scene.title)}</strong><small>${scene.start.toFixed(1)}–${scene.end.toFixed(1)}s</small></button>`).join("")}</nav><details class="evidence-details"><summary>Read the script</summary>${plan.scenes.map((scene) => `<h3>${esc(scene.title)}</h3><p>${esc(scene.narration)}</p>`).join("")}</details><details class="evidence-details"><summary>Sources & claims</summary>${plan.sources.map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Read ${esc(source.retrievedOn)}</small>`).join("")}${plan.claims.map((claim) => `<p>${esc(claim.text)}</p><small>Sources: ${claim.sourceIds.map(esc).join(", ")}</small>`).join("")}</details>${input.workspaceHref ? '<a href="edit.html#presentation">Enhance presentation with a prompt ↗</a>' : ""}${input.previewOnly ? "" : '<a href="presentation.json" download>Download scene plan</a><a href="reveal-LICENSE.txt">Reveal.js license</a>'}</aside></div></main><script type="application/json" id="presentation-data">${data}</script><script>${assets.js.replace(/<\/script/giu, "<\\/script")}\n${visualJs.replace(/^export /gm, "")}\n${js}</script><noscript><p>This interactive presentation requires JavaScript. Read the script and sources above.</p></noscript></body></html>`;
  return {
    "presentation.html": html,
    "presentation.json": `${JSON.stringify(plan, null, 2)}\n`,
    "reveal-LICENSE.txt": assets.license,
  };
}
