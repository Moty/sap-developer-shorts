import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { hash } from "./digest.js";
import { type ContentEpisode, type DemoEvidence, isNewsEpisode } from "./domain.js";
import type { NarrationTiming } from "./media/model.js";
import { availabilityLabels } from "./news/contracts.js";
import { sourceFile } from "./paths.js";
import { episodeSelector } from "./presentation.js";
import { escapeHtml as esc } from "./review.js";
import { storySteps } from "./video/motion.js";

export const presentationAssets = ["templates/presentation.css", "templates/presentation.js"];
export interface PresentationInput {
  episode: ContentEpisode;
  code: Record<string, string>;
  evidence?: DemoEvidence;
  timing?: NarrationTiming;
  audioSrc?: "narration.wav" | "short.mp4";
  sourceReviewExpired?: boolean;
  workspaceHref?: "../../review.html#episodes";
}
export function presentationPlan(input: PresentationInput) {
  const { episode, code, evidence, timing } = input;
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
      id: scene.id,
      index,
      phase: scene.phase,
      title: scene.overlay,
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
    claims: episode.claims.map((claim) => ({ text: claim.text, sourceIds: claim.sourceIds })),
    scenes,
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
    }</code></pre></div><div class="code-interaction"><label>Inspect a line<input type="range" min="0" max="${Math.max(0, (scene.code?.split("\n").length ?? 1) - 1)}" value="0" data-code-focus aria-label="Highlighted source line"></label><button type="button" data-show-story>What to notice</button><p class="story-explanation" hidden>${esc(scene.narration)}</p></div>`;
  if (scene.kind === "results")
    content = `<div class="result-head"><div><span class="data-count" data-counter="${scene.rows?.length ?? 0}">${scene.rows?.length ?? 0}</span><span class="metric-unit">captured rows</span></div><span class="response-state">200 OK</span></div>${scene.instructions.length ? `<details class="request-details"><summary>Request & command</summary><pre>${scene.instructions.map(esc).join("\n")}</pre></details>` : ""}<div class="result-tabs" role="group" aria-label="Captured result view"><button type="button" data-result-view="rows" aria-pressed="true">Results</button><button type="button" data-result-view="bars" aria-pressed="false">Stock chart</button></div><div class="result-rows" data-view="rows">${scene.rows?.map((row) => `<div class="result-row" data-stock="${row.stock}"><strong>${esc(row.title)}</strong><span>${row.stock}<small>in stock</small></span></div>`).join("")}</div><div class="result-bars" data-view="bars" hidden>${scene.rows?.map((row) => `<div class="stock-bar-row" data-stock="${row.stock}"><div><span>${esc(row.title)}</span><b>${row.stock}</b></div><div class="stock-track"><i style="--stock:${Math.max(0, row.stock) / Math.max(1, ...(scene.rows?.map((item) => item.stock) ?? []))}"></i></div></div>`).join("")}</div><label class="stock-filter">Explore saved rows: minimum stock <output>0</output><input type="range" data-stock-filter min="0" max="${Math.max(1, ...(scene.rows?.map((row) => row.stock) ?? []))}" value="0" aria-label="Minimum stock in captured rows"></label><p class="data-footnote">Explores this captured result. No live request is made.</p>`;
  if (scene.kind === "capture")
    content = `<div class="capture-window"><span class="response-state">CAPTURED RESPONSE</span><pre>${esc(scene.capture ?? "")}</pre><button type="button" data-show-story>Explain this response</button><p class="story-explanation" hidden>${esc(scene.narration)}</p></div>`;
  if (scene.kind === "claim")
    content = `<div class="claim-stack">${scene.claims
      .map(
        (claim) =>
          `<article class="sourced-claim transition-all duration-500 ease-out"><div class="availability"><span class="status-orbit" aria-hidden="true"></span>${esc(claim.status)}</div><h3>${esc(claim.text)}</h3><div class="availability-line"><span class="availability-dot" aria-hidden="true"></span><p>${esc(claim.timing)}</p></div><details><summary>Scope & sources</summary><p>${esc(claim.scope)}</p>${claim.sourceIds
            .map((id) => {
              const source = plan.sources.find((item) => item.id === id);
              return source
                ? `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a>`
                : "";
            })
            .join("")}</details></article>`,
      )
      .join("")}</div>`;
  return `<section class="deck-slide scene-${scene.kind}" data-scene="${scene.index}" data-auto-animate data-transition="fade"><div class="ambient-field" aria-hidden="true"></div><header class="slide-topline"><span>SAP DEVELOPER SHORTS</span><span>${String(scene.index + 1).padStart(2, "0")} / ${String(plan.scenes.length).padStart(2, "0")}</span></header><h2 data-id="headline">${esc(scene.title)}</h2><div class="slide-main">${content}</div><footer class="slide-footer"><span>${esc(scene.label)}</span><div class="narration-caption" aria-live="off"></div><div class="scene-progress"><i></i></div></footer></section>`;
}
export async function createPresentationDeck(input: PresentationInput) {
  const plan = presentationPlan(input);
  const [assets, css, js] = await Promise.all([
    revealAssets(),
    readFile(await sourceFile("templates/presentation.css"), "utf8"),
    readFile(await sourceFile("templates/presentation.js"), "utf8"),
  ]);
  const data = JSON.stringify(plan).replaceAll("<", "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'"><title>${esc(plan.title)} · Interactive presentation</title><style>${assets.css}\n${css}</style></head><body><main class="presentation-workspace"><header class="presentation-heading">${input.workspaceHref ? `<a href="${input.workspaceHref}">← Workspace</a>` : `<a href="review.html">← Video review</a>`}<div><p>SAP SHORTS / INTERACTIVE PRESENTATION</p><h1>${esc(plan.title)}</h1><span>${esc(plan.basis)} · ${esc(plan.timing)}</span></div></header>${plan.sourceReviewExpired ? '<p class="stale-source-warning">Saved source review has expired. Recheck official sources before producing or sharing current news.</p>' : ""}<div class="presentation-layout"><div class="presentation-stage"><div class="phone-stage"><div class="reveal"><div class="slides">${plan.scenes.map((scene) => sceneHtml(scene, plan)).join("")}</div></div></div><div class="playback-controls"><button type="button" id="deck-previous" aria-label="Previous scene">←</button><button type="button" id="deck-play">Play ${plan.audioSrc ? "with narration" : "silent preview"}</button><button type="button" id="deck-next" aria-label="Next scene">→</button><button type="button" id="deck-focus" aria-pressed="false">Focus view</button><output id="deck-time">0:00</output></div><label class="timeline-label">Presentation timeline<input id="deck-seek" type="range" min="0" max="${plan.duration}" step="0.01" value="0"></label><p class="playback-note" role="status" id="deck-status">Explore the controls inside each scene, or play the timed story. Interactions are available in this deck; exported videos use a fixed animation timeline.</p>${plan.audioSrc ? `<audio id="deck-audio" src="${plan.audioSrc}" preload="metadata"></audio>` : ""}</div><aside class="presentation-inspector"><h2>Story & evidence</h2><nav aria-label="Presentation scenes">${plan.scenes.map((scene) => `<button type="button" data-jump="${scene.index}"><span>${String(scene.index + 1).padStart(2, "0")}</span><strong>${esc(scene.title)}</strong><small>${scene.start.toFixed(1)}–${scene.end.toFixed(1)}s</small></button>`).join("")}</nav><details class="evidence-details"><summary>Read the script</summary>${plan.scenes.map((scene) => `<h3>${esc(scene.title)}</h3><p>${esc(scene.narration)}</p>`).join("")}</details><details class="evidence-details"><summary>Sources & claims</summary>${plan.sources.map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Read ${esc(source.retrievedOn)}</small>`).join("")}${plan.claims.map((claim) => `<p>${esc(claim.text)}</p><small>Sources: ${claim.sourceIds.map(esc).join(", ")}</small>`).join("")}</details><a href="presentation.json" download>Download scene plan</a><a href="reveal-LICENSE.txt">Reveal.js license</a></aside></div></main><script type="application/json" id="presentation-data">${data}</script><script>${assets.js.replace(/<\/script/giu, "<\\/script")}\n${js}</script><noscript><p>This interactive presentation requires JavaScript. Read the script and sources above.</p></noscript></body></html>`;
  return {
    "presentation.html": html,
    "presentation.json": `${JSON.stringify(plan, null, 2)}\n`,
    "reveal-LICENSE.txt": assets.license,
  };
}
