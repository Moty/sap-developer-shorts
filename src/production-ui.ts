import type { ContentEpisode } from "./domain.js";
import type { LibraryEntry } from "./library.js";

export interface ProductionHistorySample {
  kind: string;
  totalMs: number;
}

/** Comparable local pipeline shape, without personal voice/photo identifiers. */
export function productionKind(episode: ContentEpisode): string {
  return (episode.presentation?.speakers ?? [{ voice: "af_heart", avatar: undefined }])
    .map(
      (speaker) =>
        `${typeof speaker.voice === "string" ? "stock" : "personal"}:${speaker.avatar?.mode === "photo" ? (speaker.avatar.animation === "neural" ? "ditto" : "photo") : "illustrated"}`,
    )
    .sort()
    .join("+");
}

export function productionHistory(entries: LibraryEntry[]): ProductionHistorySample[] {
  return entries.flatMap((entry) =>
    entry.generation?.basis === "generation" &&
    !entry.generation.reusedAudio &&
    !entry.generation.reusedVideo &&
    entry.generation.totalMs > 0
      ? [{ kind: productionKind(entry.episode), totalMs: entry.generation.totalMs }]
      : [],
  );
}

export function productionWorkspace(companion: string, review: string, controls: string): string {
  const rows = [
    ["script", "Script", "script", "Edit script"],
    ["voice", "Voice", "voice", "Change voice"],
    ["presenter", "Presenter", "voice", "Change presenter"],
    ["sources", "Sources", "sources", "View sources"],
    ["post", "Companion post", "post", "Edit post"],
    ["ai", "AI content review", "ai", "Review content"],
  ];
  return `<section id="production-workspace" data-editor-pane="review" data-workspace-pane="produce" aria-labelledby="production-heading"><div class="production-heading"><p class="eyebrow">STEP 3 · PRODUCTION</p><h2 id="production-heading">One last look. Then bring it to life.</h2><p>Check this draft, then create the narration, captions and vertical video on this Mac.</p></div><div class="production-grid"><div class="production-main"><section class="production-checklist" aria-label="Production checklist">${rows.map(([id, label, target, action]) => `<div class="production-check" data-production-check="${id}"><span class="production-check-icon" aria-hidden="true">·</span><div><strong>${label}${id === "ai" ? "<small>Optional</small>" : ""}</strong><p id="production-check-${id}" role="status">Checking…</p></div><button type="button" data-production-go="${target}">${action}</button></div>`).join("")}</section><details id="production-post" class="production-detail"><summary>Companion post</summary>${companion}</details><details id="production-ai" class="production-detail"><summary>Optional AI content review</summary>${review}</details><section id="production-live" class="production-live" aria-labelledby="production-run-title" hidden><p class="eyebrow">GENERATION PROGRESS</p><h2 id="production-run-title">Producing your video</h2><p id="production-run-target"></p><p id="production-run-message" role="status"></p><p id="production-run-elapsed"></p><ol class="production-stages">${[
    ["PREFLIGHT", "Preparation"],
    ["NARRATION", "Audio & captions"],
    ["RENDER", "Portrait & MP4"],
    ["LIBRARY", "Update workspace"],
  ]
    .map(
      ([id, label]) =>
        `<li data-production-stage="${id}"><span aria-hidden="true">·</span><strong>${label}</strong><small></small></li>`,
    )
    .join(
      "",
    )}</ol><div id="production-run-actions" class="production-run-actions"></div><p class="production-note">You can leave this page. An active job keeps running on this Mac; returning reconnects to its saved status.</p></section></div><div class="production-summary"><section class="production-estimate"><p class="eyebrow">PLAN YOUR TIME</p><strong id="production-estimate">No comparable history yet</strong><p id="production-estimate-basis">Generation time depends on voice, portrait, hardware and model caches.</p></section>${controls}</div></div></section>`;
}
