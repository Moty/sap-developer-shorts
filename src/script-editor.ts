import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readContentEpisode } from "./contracts.js";
import { hash } from "./digest.js";
import { type ContentEpisode, isNewsEpisode } from "./domain.js";
import { finalReviewPanel, writingPanel } from "./editorial/panel.js";
import {
  type EpisodeShellOptions,
  episodeShell,
  episodeShellAssets,
  episodeStepSubs,
  shellIcons,
} from "./episode-shell.js";
import { localActionButton, localActionFeedback } from "./local-action-controls.js";
import { faceDetectorVersion, faceModelSha } from "./media/face-assets.js";
import { type VoiceReference, voiceKey, voiceLabel } from "./media/voice-reference.js";
import { kokoroVoices } from "./media/voices.js";
import { enhanceNewsReviewHtml, newsReviewNotice } from "./news/freshness.js";
import { projectRoot } from "./paths.js";
import { episodeSelector, presentationLabel } from "./presentation.js";
import { sceneSupportsCharts } from "./presentation-design.js";
import { type ProductionHistorySample, productionWorkspace } from "./production-ui.js";
import { escapeHtml as esc } from "./review.js";
import { defaultStoryBrief } from "./story-brief.js";
import type { PresentationDefinition } from "./variants.js";
import { voiceLibraryPanel } from "./voice-library-panel.js";
import { voiceReadingScripts } from "./voice-reading-scripts.js";
import { voiceStyles } from "./voice-styles.js";

export async function scriptEditorSeed(episode: ContentEpisode, defaultVoice = "af_heart") {
  const base = await readContentEpisode(episode.id);
  const presentation = structuredClone(
    episode.presentation ?? {
      tone: "professional" as const,
      format: "explainer" as const,
      humor: "none" as const,
      speakers: [{ id: "narrator", name: "Narrator", voice: defaultVoice }],
    },
  );
  const stem = (presentation.variant ?? "draft").split(/-edit|-revision/u)[0] ?? "draft";
  presentation.variant = `${stem.slice(0, 23)}-revision`;
  const pronunciation = Object.fromEntries(
    Object.entries(episode.pronunciation).filter(
      ([term, spoken]) => base.pronunciation[term] !== spoken,
    ),
  );
  const definition: PresentationDefinition = {
    schemaVersion: episode.schemaVersion,
    baseEpisodeId: base.id,
    baseInputHash: hash(JSON.stringify(base)),
    title: episode.title,
    ...(episode.targetDurationSeconds !== base.targetDurationSeconds
      ? { plannedDurationSeconds: episode.targetDurationSeconds }
      : {}),
    presentation,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      narration: scene.narration,
      overlay: scene.overlay,
      ...(scene.dialogue ? { dialogue: structuredClone(scene.dialogue) } : {}),
    })),
    publicationText: episode.publication.text,
    ...(Object.keys(pronunciation).length ? { pronunciation } : {}),
  };
  return definition;
}

export async function createScriptEditor(
  episode: ContentEpisode,
  options: {
    defaultVoice?: string;
    availableVoices?: string[];
    reservedNames?: string[];
    sourceReviewExpired?: boolean;
    /** Shared episode header context (versions, poster, MP4); defaults to a lone version. */
    productionHistory?: ProductionHistorySample[];
    shell?: Omit<EpisodeShellOptions, "step"> & { deck?: boolean };
  } = {},
) {
  const seed = await scriptEditorSeed(episode, options.defaultVoice);
  const shell = options.shell ?? {
    root: "../../",
    title: episode.title,
    id: episode.id,
    selector: episodeSelector(episode),
    meta: presentationLabel(episode),
    versions: [{ selector: episodeSelector(episode), label: "v1", stage: "editing" as const }],
    hasVideo: false,
  };
  const name = seed.presentation.variant ?? "my-edit";
  let suffix = 2;
  while (options.reservedNames?.includes(seed.presentation.variant ?? "")) {
    seed.presentation.variant = `${name.slice(0, 27)}-${suffix++}`;
  }
  const availableVoices = kokoroVoices
    .filter((voice) => options.availableVoices?.includes(voice.id))
    .map((voice) => voice.id);
  const [
    css,
    script,
    photoTexture,
    portraitMotion,
    profileScript,
    localActionsScript,
    voicePanelCss,
    writingCss,
    writingScript,
    finalReviewScript,
    workspaceCss,
    workspaceScript,
    productionCss,
    productionScript,
    advancedVisualsScript,
  ] = await Promise.all([
    readFile(resolve(projectRoot, "templates/script-editor.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/script-editor.js"), "utf8"),
    readFile(new URL("./media/photo-texture.js", import.meta.url), "utf8"),
    readFile(new URL("./media/portrait-motion.js", import.meta.url), "utf8"),
    readFile(resolve(projectRoot, "templates/voice-profiles.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/local-actions.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/voice-library.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/writing-assistant.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/writing-assistant.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/final-review.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/editor-workspace.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/editor-workspace.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/production-workspace.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/production-workspace.js"), "utf8"),
    readFile(resolve(projectRoot, "templates/advanced-visuals.js"), "utf8"),
  ]);
  const shellAssets = await episodeShellAssets();
  const editorData = {
    seed,
    faceDetector: { version: faceDetectorVersion, modelSha256: faceModelSha },
    availableVoices,
    reservedNames: options.reservedNames ?? [],
    scenes: episode.scenes.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })),
    pronunciation: episode.pronunciation,
  };
  const payload = JSON.stringify({
    ...editorData,
    writingContext: {
      selector: episodeSelector(episode),
      sourceHash: hash(JSON.stringify(episode)),
    },
    productionHistory: options.productionHistory ?? [],
    compositionClaimIds: episode.claims.map((claim) => claim.id),
    visualOutputSceneIds: episode.scenes.filter(sceneSupportsCharts).map((scene) => scene.id),
    compositionSceneIds: episode.scenes
      .filter((scene) => scene.visual.kind === "presenter")
      .map((scene) => scene.id),
    voiceReadingScripts,
    voiceStyles,
    recoveryId: hash(JSON.stringify(editorData)),
  })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const actionIcon = (path: string) =>
    `<svg class="action-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
  const speakerIcon = actionIcon(
    '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  );
  const playIcon = actionIcon('<path fill="currentColor" d="M7 4.5v15l12-7.5z"/>');
  const closeIcon = actionIcon('<path d="M6 6l12 12M18 6 6 18"/>');
  const voiceName = (id: VoiceReference) =>
    typeof id === "string"
      ? (kokoroVoices.find((voice) => voice.id === id)?.name ?? id)
      : voiceLabel(id);
  const speakers = seed.presentation.speakers;
  const enrollment = voiceLibraryPanel({ context: "editor", speakers });
  const voiceFields = `<section class="draft-details voice-editor" data-editor-pane="voice" aria-labelledby="voice-heading"><h2 id="voice-heading">Voice & portrait</h2><p>Choose a local voice and how your presenter appears. Photo portraits run entirely on this Mac.</p><p id="local-actions-help" class="voice-help">Connect to the running local studio to use setup buttons.</p><p id="local-actions-status" role="status" aria-live="polite"></p>${enrollment}${speakers
    .map(
      (speaker, index) =>
        `<div class="speaker-config-row"><div class="speaker-avatar-preview"><div class="avatar-icon avatar-${esc(speaker.id)}">${esc(speaker.name.slice(0, 1))}</div><span class="avatar-name-label">${esc(speaker.name)}</span></div><div class="speaker-input-wrap"><label for="speaker-voice-${index}">${esc(speaker.name)} voice</label><select id="speaker-voice-${index}" aria-describedby="speaker-voice-${index}-help">${typeof speaker.voice !== "string" ? `<option value="${esc(voiceKey(speaker.voice))}" selected>My voice · checking local profile</option>` : ""}${kokoroVoices
          .filter((voice) => availableVoices.includes(voice.id) || voice.id === speaker.voice)
          .map(
            (voice) =>
              `<option value="${voice.id}"${voice.id === speaker.voice ? " selected" : ""}>${esc(voice.name)} · ${esc(voice.accent)} · ${esc(voice.gender)}${availableVoices.includes(voice.id) ? "" : " · Setup needed"}</option>`,
          )
          .join(
            "",
          )}</select><p class="voice-help" id="speaker-voice-${index}-help">${availableVoices.includes(voiceKey(speaker.voice)) ? "Local voice assets checked when this studio was built." : "Original voice retained. Its local assets need setup before production."}</p>${typeof speaker.voice === "string" ? `<div id="speaker-voice-setup-${index}" data-local-action-scope${availableVoices.includes(speaker.voice) ? " hidden" : ""}>${localActionButton("voice-install", "Install selected voice", speaker.voice)}${localActionFeedback()}</div>` : ""}<div class="avatar-mode-config"><label for="speaker-avatar-mode-${index}">${esc(speaker.name)} avatar style</label><select id="speaker-avatar-mode-${index}"><option value="illustrated"${(speaker.avatar?.mode ?? "illustrated") === "illustrated" ? " selected" : ""}>Illustrated presenter</option><option value="photo"${speaker.avatar?.mode === "photo" ? " selected" : ""}>Photo portrait</option></select><div id="speaker-avatar-photo-panel-${index}" class="avatar-photo-panel"${speaker.avatar?.mode === "photo" ? "" : " hidden"}><div class="avatar-photo-layout"><div class="avatar-canvas-wrap"><canvas id="speaker-avatar-canvas-${index}" width="256" height="256" class="avatar-lipsync-canvas"></canvas><button type="button" id="speaker-avatar-test-${index}" class="avatar-test-btn" data-speaker-index="${index}">${playIcon}<span>Preview alignment &amp; gentle motion</span></button></div><div class="avatar-photo-fields"><label for="speaker-avatar-image-${index}">Saved photo portrait</label><div class="avatar-upload-row"><select id="speaker-avatar-image-${index}" data-initial-value="${esc(speaker.avatar?.imageId ?? "")}"><option value="">— Select or upload an image —</option>${speaker.avatar?.imageId ? `<option value="${esc(speaker.avatar.imageId)}" selected>${esc(speaker.avatar.imageId)}</option>` : ""}</select><label class="avatar-upload-btn" for="speaker-avatar-upload-${index}">Upload Photo<input type="file" id="speaker-avatar-upload-${index}" class="avatar-upload-input" accept="image/png,image/jpeg,image/webp" data-speaker-index="${index}" hidden></label></div><span id="speaker-avatar-upload-status-${index}" class="audition-status" role="status"></span><label for="speaker-avatar-animation-${index}">Portrait rendering</label><select id="speaker-avatar-animation-${index}"><option value="full-face"${(speaker.avatar?.animation ?? "full-face") === "full-face" ? " selected" : ""}>Lightweight photo animation</option><option value="neural"${speaker.avatar?.animation === "neural" ? " selected" : ""}>Realistic local portrait (Ditto)</option><option value="mouth-only"${speaker.avatar?.animation === "mouth-only" ? " selected" : ""}>Mouth only (stationary portrait)</option></select><label for="speaker-avatar-motion-style-${index}">Delivery</label><select id="speaker-avatar-motion-style-${index}">${["calm", "conversational", "expressive"].map((style) => `<option value="${style}"${(speaker.avatar?.motion?.style ?? "conversational") === style ? " selected" : ""}>${style[0]?.toUpperCase()}${style.slice(1)}</option>`).join("")}</select><label for="speaker-avatar-motion-intensity-${index}">Movement amount</label><input type="range" id="speaker-avatar-motion-intensity-${index}" min="0" max="1" step="0.05" value="${speaker.avatar?.motion?.intensity ?? 0.7}"><p class="voice-help" id="speaker-avatar-runtime-${index}">Checking the local portrait renderer…</p><details class="local-setup-tools"><summary>Local portrait tools</summary><div data-local-action-scope>${localActionButton("portrait-setup", "Set up realistic portraits")}${localActionFeedback()}</div><div data-local-action-scope>${localActionButton("face-setup", "Set up face alignment")}${localActionFeedback()}</div></details><button type="button" id="speaker-avatar-detect-${index}" class="avatar-test-btn">Detect face &amp; mouth automatically</button><span id="speaker-avatar-detect-status-${index}" class="audition-status" role="status"></span><input type="hidden" id="speaker-avatar-geometry-${index}" value="${esc(JSON.stringify({ animation: speaker.avatar?.animation, motion: speaker.avatar?.motion, mouthAngle: speaker.avatar?.mouthAngle, mouthAspect: speaker.avatar?.mouthAspect, faceLandmarks: speaker.avatar?.faceLandmarks, calibration: speaker.avatar?.calibration }))}"><p class="voice-help">The silent preview checks alignment with a lightweight photo effect. Realistic mode generates a new talking face from the photo and narration during production, entirely on this Mac. Lower movement keeps the delivery restrained; review a generated sample before sharing.</p><details class="manual-calibration"><summary>Fine-tune mouth alignment</summary><div class="avatar-calibration-grid"><div><label for="speaker-avatar-mouth-y-${index}">Mouth vertical (<span id="speaker-avatar-mouth-y-val-${index}">${Math.round((speaker.avatar?.mouthY ?? 0.68) * 100)}%</span>)</label><input type="range" id="speaker-avatar-mouth-y-${index}" min="0.4" max="0.9" step="0.001" value="${speaker.avatar?.mouthY ?? 0.68}"></div><div><label for="speaker-avatar-mouth-x-${index}">Mouth horizontal (<span id="speaker-avatar-mouth-x-val-${index}">${Math.round((speaker.avatar?.mouthX ?? 0.5) * 100)}%</span>)</label><input type="range" id="speaker-avatar-mouth-x-${index}" min="0.2" max="0.8" step="0.001" value="${speaker.avatar?.mouthX ?? 0.5}"></div><div><label for="speaker-avatar-mouth-scale-${index}">Mouth size (<span id="speaker-avatar-mouth-scale-val-${index}">${Math.round((speaker.avatar?.mouthScale ?? 1) * 100)}%</span>)</label><input type="range" id="speaker-avatar-mouth-scale-${index}" min="0.5" max="2" step="0.001" value="${speaker.avatar?.mouthScale ?? 1}"></div></div></details></div></div></div></div></div></div>`,
    )
    .join(
      "",
    )}<p><a href="../../review.html#voices" target="_blank" rel="noopener">Listen to saved voice samples ↗</a> <small>(opens in a new tab)</small></p><p class="voice-help">Choices reflect this saved studio. Production checks the selected voices again. Use the voice library to install another profile. Return here after setup to choose it.</p></section>`;
  const sceneFields = episode.scenes
    .map((scene, index) => {
      const field = (id: string, label: string, value: string, attributes = "") =>
        `<label for="${id}">${esc(label)}</label><textarea id="${id}" ${attributes} aria-describedby="scene-${index}-count scene-${index}-warning">${esc(value)}</textarea>`;
      const narration = scene.dialogue
        ? scene.dialogue
            .map((turn, position) => {
              const fieldId = `turn-${index}-${position}`;
              const speakerIndex = speakers.findIndex((speaker) => speaker.id === turn.speakerId);
              const idx = speakerIndex >= 0 ? speakerIndex : 0;
              return `${field(
                fieldId,
                `${speakers[speakerIndex]?.name ?? turn.speakerId} · turn ${position + 1}`,
                turn.text,
              )}<div class="narration-actions"><button type="button" class="audition-btn" data-target="${fieldId}" data-speaker-index="${idx}">${speakerIcon}<span>Hear this line</span></button><span id="audition-status-${fieldId}" class="audition-status" role="status"></span></div><audio id="audio-${fieldId}" class="audition-player" controls hidden></audio>`;
            })
            .join("")
        : `${field(`narration-${index}`, "Narration", scene.narration)}<div class="narration-actions"><button type="button" class="audition-btn" data-target="narration-${index}" data-speaker-index="0">${speakerIcon}<span>Hear this scene</span></button><span id="audition-status-narration-${index}" class="audition-status" role="status"></span></div><audio id="audio-narration-${index}" class="audition-player" controls hidden></audio>`;
      return `<section class="scene-editor" data-editor-pane="script" data-scene-index="${index}" aria-labelledby="scene-${index}-heading"><div class="scene-heading"><h2 id="scene-${index}-heading">${index + 1}. ${esc(scene.id)}</h2><span>${scene.startSeconds}–${scene.endSeconds}s planned</span></div><p class="scene-visual">Visual: ${esc(scene.visual.label)} · fixed</p>${field(`overlay-${index}`, "On-screen headline", scene.overlay, 'maxlength="48" rows="2"')}${narration}<p class="scene-count" id="scene-${index}-count"></p><p class="field-warning" id="scene-${index}-warning" hidden></p></section>`;
    })
    .join("");
  const news = isNewsEpisode(episode);
  const dated = news
    ? `${newsReviewNotice(episode.news, options.sourceReviewExpired)}<p class="source-date">This revision keeps the source-review dates; production checks their age again.</p>`
    : "";
  const original = episode.scenes
    .map(
      (scene) =>
        `${scene.id} (${scene.startSeconds}–${scene.endSeconds}s planned)\n${scene.narration}`,
    )
    .join("\n\n");
  const pronunciationEntries = Object.entries(episode.pronunciation);
  const pronunciationSection = `<section class="glossary-section" aria-labelledby="glossary-heading"><div class="glossary-header"><h3 id="glossary-heading">Pronunciation glossary (<span id="glossary-count">${pronunciationEntries.length}</span>)</h3></div><p class="voice-help">Technical terms mapped to natural phonetic speech. Edit spoken values, audition changes, or add new mappings:</p><ul id="glossary-list" class="glossary-list">${pronunciationEntries.map(([term, spoken]) => `<li class="glossary-item" data-term="${esc(term)}"><span class="glossary-term-badge">${esc(term)}</span><span class="glossary-arrow">→</span><input type="text" class="glossary-spoken-input" data-term="${esc(term)}" value="${esc(spoken)}" maxlength="80" aria-label="Pronunciation for ${esc(term)}"><button type="button" class="audition-term-btn" data-term="${esc(term)}" title="Audition this term" aria-label="Audition this term">${speakerIcon}</button><button type="button" class="remove-term-btn" data-term="${esc(term)}" title="Remove this term" aria-label="Remove this term">${closeIcon}</button></li>`).join("")}</ul><div class="glossary-add-row"><input type="text" id="new-term-key" placeholder="Term (e.g. SQLite)" maxlength="40" aria-label="New term"><span class="glossary-arrow">→</span><input type="text" id="new-term-val" placeholder="Spoken as (e.g. S Q Lite)" maxlength="80" aria-label="Spoken as"><button type="button" id="add-term-btn" class="add-term-btn">+ Add</button></div><p id="glossary-add-error" class="field-warning" hidden></p></section>`;
  const sandboxSection = `<div class="audition-sandbox"><h3>Pronunciation Sandbox</h3><p class="voice-help">Test any term or phrase in the selected voice:</p><div class="sandbox-input-row"><input id="sandbox-text" placeholder="e.g. OData v4 with CAP" maxlength="120"><button id="sandbox-audition-btn" type="button">Audition</button></div><span id="sandbox-status" class="audition-status" role="status"></span><audio id="sandbox-player" class="audition-player" controls hidden></audio></div>`;
  const sceneNames: Record<string, string> = {
    hook: "Hook",
    context: "Context",
    model: "Data model",
    service: "Service",
    query: "Run & query",
    payoff: "Payoff",
    cta: "Call to action",
    "headline-1": "Headline 1",
    "headline-2": "Headline 2",
    "headline-3": "Headline 3",
  };
  const svg = (path: string) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const icons = {
    story: svg("M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5"),
    details: svg("M12 4v16 M4 8h16 M4 16h16"),
    magic: svg("m15 4 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3 M7 13l4 4-6 5-3-3 5-6 M19 14v6 M16 17h6"),
    voice: svg("M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 10v1a7 7 0 0 0 14 0v-1 M12 18v4 M8 22h8"),
    check: svg("m5 12 4 4L19 6 M4 4h16v16H4"),
    save: svg("M5 3h12l4 4v14H3V3h2 M7 3v6h10V3 M7 21v-8h10v8"),
    menu: svg("M4 6h16 M4 12h16 M4 18h16"),
    source: svg("M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"),
  };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob: data:; base-uri 'none'; form-action 'none'"><title>Revise script · ${esc(episode.title)}</title><style>${css}
${voicePanelCss}
${writingCss}
${workspaceCss}
${shellAssets.css}
${productionCss}</style></head>
<body class="guided-editor workspace-editor ep-page" data-editor-workspace>
${episodeShell({
  ...shell,
  step: "script",
  inPageEditor: true,
  liveStages: true,
  versionPrefix: "From ",
  className: "studio-topbar editor-actionbar",
  stepSubs: shell.stepSubs ?? episodeStepSubs(episode),
  lead: `<button type="button" id="editor-outline-toggle" class="studio-icon-button" aria-label="Episode sections" aria-controls="editor-outline" aria-expanded="false">${icons.menu}</button>`,
  status:
    '<div class="studio-save-state"><span id="editor-save-state" role="status">Unsaved new version</span><small id="editor-validation-state"></small></div>',
  actions: `${shell.deck ? `<a class="ep-btn ghost ep-icon-phone" href="presentation.html">${shellIcons.eye}<span class="ep-label">Saved deck</span></a>` : ""}<button type="button" id="save-draft" class="ep-btn secondary-btn studio-save-button" aria-label="Save draft">${icons.save}<span class="action-label">Save draft</span></button><button type="button" id="editor-next" class="ep-btn primary produce-btn" data-short-label="Voice">Next: Voice &amp; portrait</button>`,
})}
<main class="studio-main">
  <div class="workspace-grid">
    <nav id="editor-outline" class="workspace-outline" aria-label="Episode sections">
      <p class="outline-caption">STEP 1 · SCRIPT</p>
      <button type="button" class="workspace-nav-link" data-editor-target="details">${icons.details}<span>Episode details</span></button>
      <button type="button" class="workspace-nav-link workspace-step-link" data-editor-target="scene">${icons.story}<span>Scenes</span><small>${episode.scenes.length} scenes</small></button>
      <div class="workspace-scene-list">${episode.scenes.map((scene, index) => `<button type="button" class="workspace-scene-link" data-editor-scene="${index}" aria-label="Scene ${index + 1}: ${esc(sceneNames[scene.id] ?? scene.id)}"><span class="scene-nav-number">${String(index + 1).padStart(2, "0")}</span><span>${esc(sceneNames[scene.id] ?? scene.id)}</span><small>${scene.endSeconds - scene.startSeconds}s</small></button>`).join("")}</div>
      <button type="button" class="workspace-nav-link" data-editor-target="writing">${icons.magic}<span>Writing &amp; visuals</span><small>AI</small></button>
      <p class="outline-note"><span></span>Local workspace<br><small>Each save keeps a new version.</small></p>
    </nav>
    <div class="workspace-content">
  <div class="workspace-heading"><div><p class="eyebrow">EPISODE EDITOR</p><h1 id="workspace-title">${esc(episode.title)}</h1><div class="workspace-meta"><span class="workspace-version" id="workspace-version">New version · ${esc(seed.presentation.variant ?? "")}</span><span>${esc(presentationLabel(episode))}</span><span id="workspace-total-words"></span></div></div><button id="editor-evidence-toggle" type="button" class="workspace-evidence-button" aria-controls="editor-evidence" aria-expanded="false">${icons.source}Sources <span>${episode.sources.length}</span></button></div>
  <noscript><p class="notice">Script revision needs JavaScript. The original script and sources remain readable below.</p></noscript>
  <section id="draft-recovery" class="draft-recovery" aria-label="Draft recovery" hidden><p id="draft-recovery-message" role="status" aria-live="polite"></p><div class="recovery-actions"><button id="resume-draft" type="button" hidden>Resume saved draft</button><button id="discard-draft" type="button" hidden>Start with original</button></div><p class="recovery-help">Recovery stays in this tab. Use Save draft to keep a version on this Mac, or download a portable copy.</p></section>

      <fieldset id="editor-fields" disabled><legend class="sr-only">Revised script</legend>
        <section id="editor-script-start" class="draft-details" data-editor-pane="script" data-workspace-pane="details" aria-label="Version and title"><label for="variant-name">New version name</label><input id="variant-name" value="${esc(seed.presentation.variant ?? "")}" maxlength="32" autocomplete="off" spellcheck="false" aria-describedby="variant-help"><p id="variant-help">Use lowercase letters, numbers, and hyphens, starting with a letter. Existing versions are kept.</p><label for="draft-title">Short title</label><input id="draft-title" value="${esc(seed.title)}" maxlength="60"><input type="hidden" id="preset-preferences" value=""><details class="production-command"><summary>Production presets</summary><p>Save voices, portraits, delivery, theme, pronunciation and planned length. Applying keeps your script and sources; unavailable assets must be restored first.</p><label for="preset-name">Preset name</label><input id="preset-name" maxlength="60" placeholder="My upbeat SAP explainer"><button type="button" class="secondary-btn" id="preset-save">Save current preferences</button><button type="button" class="secondary-btn" id="preset-load">Load my presets</button><label for="preset-choice">Saved preset</label><select id="preset-choice"><option value="">Load presets first</option></select><button type="button" class="secondary-btn" id="preset-apply">Apply to this draft</button><p id="preset-status" role="status"></p></details><input type="hidden" id="presentation-design" value="${esc(seed.presentation.design ? JSON.stringify(seed.presentation.design) : "")}"><p id="presentation-design-status" class="delivery"></p><div class="design-reset-row"><button type="button" id="presentation-design-reset" class="secondary-btn" aria-describedby="presentation-design-reset-hint">Use automatic presentation design</button><small id="presentation-design-reset-hint" class="design-reset-hint">Only needed after a custom design has been applied; the automatic design is in use now.</small></div></section>
        <details id="presentation" class="writing-editor-disclosure" data-editor-pane="script" data-workspace-pane="writing"><summary>Writing &amp; presentation assistant</summary>${writingPanel(true, seed.presentation.brief ?? { ...defaultStoryBrief, targetSeconds: Math.min(90, Math.max(15, Math.round(episode.targetDurationSeconds))) })}</details>
        <section id="scene-focus" data-editor-pane="script" data-workspace-pane="scene" class="scene-focus" aria-label="Focused scene editor">
          <div class="scene-workspace-toolbar"><span id="workspace-scene-position">SCENE 01 OF ${String(episode.scenes.length).padStart(2, "0")}</span><div><button type="button" id="workspace-scene-previous" aria-label="Previous scene">← <span>Previous</span></button><button type="button" id="workspace-scene-next" aria-label="Next scene"><span>Next scene</span> →</button></div></div>
          <div class="scene-focus-layout"><div class="scene-focus-fields">${sceneFields}</div><aside class="scene-text-preview" aria-label="On-screen text preview"><div class="preview-label">ON-SCREEN CUE<span id="workspace-preview-number">01 / 07</span></div><div class="preview-phone"><div class="preview-brand">SAP / SHORTS</div><div class="preview-decoration" aria-hidden="true"></div><strong id="workspace-preview-headline"></strong><p id="workspace-preview-caption"></p><div class="preview-progress" aria-hidden="true"><i></i></div></div><p class="preview-help">Text preview. The full deck updates when you save.</p><a href="presentation.html" target="_blank" rel="noopener">Open saved deck ↗</a></aside></div>
        </section>
        ${voiceFields}
        <details class="pronunciation-tools" data-editor-pane="voice"><summary>Pronunciation & voice tests</summary>${pronunciationSection}${sandboxSection}</details>
        ${productionWorkspace(`        <section class="draft-details"><h2 id="companion-post-heading">Prepare the companion post</h2><label for="publication-text">Companion post draft</label><textarea id="publication-text" rows="12" maxlength="3000">${esc(seed.publicationText ?? "")}</textarea></section>`, finalReviewPanel(), `      <section id="download-controls" class="download-panel" data-editor-pane="review" hidden><h2>Produce on this Mac</h2><p id="draft-errors" role="status"></p><div class="save-actions"><button id="produce-script" type="button" class="produce-btn">Save &amp; produce</button><button id="download-script" type="button" class="secondary-btn">Download script</button></div><details class="production-guidance"><summary>Voice &amp; timing details</summary><p>Production creates narration, captions and an MP4 on this Mac. Realistic portraits may take several minutes. You can return to the workspace while it runs.</p><p id="production-voice-summary" role="status"></p><p id="draft-count" aria-live="polite"></p><p>Aim for 45–60 seconds; 15–90 seconds of measured audio is accepted. Opening and section timings are flexible. Captions and scenes follow the actual speech.</p></details><details id="review-changes" class="change-review"><summary id="review-changes-summary">Review changes</summary><p id="review-changes-count" role="status" aria-live="polite"></p><div id="review-changes-list"></div><p class="change-review-help">Review compares this draft with its starting script. Restoring a section keeps your version name and other edits.</p></details><div id="produce-progress-box" class="produce-progress-box" hidden aria-live="polite"><div class="progress-bar"><div id="produce-progress-bar" class="progress-fill"></div></div><p id="produce-progress-text"></p><div id="produce-result" hidden></div></div><p id="download-status" role="status"></p><details><summary>Use the downloaded file</summary><p>From the project folder, import the file you downloaded:</p><code tabindex="0">npm run shorts -- script-import /path/to/downloaded-script.json</code><p>Then create the new version:</p><code id="produce-command" tabindex="0"></code><p>Import checks the current base and preserves existing versions. Review the revised wording against the sources before sharing.</p></details></section>`)}
      </fieldset>
      <details class="original-script"><summary>Read the original script</summary><pre>${esc(original)}</pre></details>
    </div>
  </div>
  <aside id="editor-evidence" class="workspace-evidence" aria-label="Saved evidence" hidden><div class="evidence-drawer-heading"><strong>Saved evidence</strong><button type="button" id="editor-evidence-close" aria-label="Close sources">×</button></div><details class="editor-reference"><summary>Sources & writing guidance</summary><h2>Keep the evidence in view</h2><p>Scene order, evidence, claims, and source dates stay fixed. Presets can change compatible delivery preferences while keeping speaker identities. Scene timings are guides; measured audio sets the final pace. Presentation designs can change headlines and visual emphasis. To try another delivery, start with another prepared example.</p><h3>Starting voices</h3><p>${speakers.map((speaker) => `${esc(speaker.name)} · ${esc(voiceName(speaker.voice))}`).join("<br>")}</p><p>Existing recordings keep their recorded voices. This revision needs its own verified production result.</p>${dated}<h3>Official sources</h3><ul>${episode.sources.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Read ${esc(source.retrievedOn)}</small></li>`).join("")}</ul><details><summary>Claims to preserve</summary><ul>${episode.claims.map((claim) => `<li>${esc(claim.text)}</li>`).join("")}</ul></details></details></aside>
</main>
<script type="application/json" id="editor-data">${payload}</script><script>${localActionsScript}
${profileScript}
${photoTexture.replace(/^export /gm, "")}
${portraitMotion.replace(/^export /gm, "")}
${script}
${advancedVisualsScript}
${workspaceScript}
${productionScript}
${shellAssets.script}
${writingScript}
${finalReviewScript}</script></body></html>`;
  return enhanceNewsReviewHtml(html);
}
