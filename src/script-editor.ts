import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readContentEpisode } from "./contracts.js";
import { hash } from "./digest.js";
import { type ContentEpisode, isNewsEpisode } from "./domain.js";
import { kokoroVoices } from "./media/voices.js";
import { enhanceNewsReviewHtml, newsReviewNotice } from "./news/freshness.js";
import { projectRoot } from "./paths.js";
import { episodeSelector, presentationLabel } from "./presentation.js";
import { escapeHtml as esc } from "./review.js";
import type { PresentationDefinition } from "./variants.js";

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
  presentation.variant = `${(presentation.variant ?? "my").slice(0, 27)}-edit`;
  const pronunciation = Object.fromEntries(
    Object.entries(episode.pronunciation).filter(
      ([term, spoken]) => base.pronunciation[term] !== spoken,
    ),
  );
  const definition: PresentationDefinition = {
    schemaVersion: 1,
    baseEpisodeId: base.id,
    baseInputHash: hash(JSON.stringify(base)),
    title: episode.title,
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
  } = {},
) {
  const seed = await scriptEditorSeed(episode, options.defaultVoice);
  const availableVoices = kokoroVoices
    .filter((voice) => options.availableVoices?.includes(voice.id))
    .map((voice) => voice.id);
  const [css, script] = await Promise.all([
    readFile(resolve(projectRoot, "templates/script-editor.css"), "utf8"),
    readFile(resolve(projectRoot, "templates/script-editor.js"), "utf8"),
  ]);
  const editorData = {
    seed,
    availableVoices,
    reservedNames: options.reservedNames ?? [],
    scenes: episode.scenes.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })),
    pronunciation: episode.pronunciation,
  };
  const payload = JSON.stringify({
    ...editorData,
    recoveryId: hash(JSON.stringify(editorData)),
  })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const voiceName = (id: string) => kokoroVoices.find((voice) => voice.id === id)?.name ?? id;
  const speakers = seed.presentation.speakers;
  const voiceFields = `<section class="draft-details voice-editor" aria-labelledby="voice-heading"><h2 id="voice-heading">Choose the voices & presenters</h2><p>These choices apply to your new version. Each presenter features an animated talking-head avatar in the video — choose the built-in 3D illustrated character or animate a custom portrait photo.</p>${speakers
    .map(
      (speaker, index) =>
        `<div class="speaker-config-row"><div class="speaker-avatar-preview"><div class="avatar-icon avatar-${esc(speaker.id)}">🎭</div><span class="avatar-name-label">${esc(speaker.name)}</span></div><div class="speaker-input-wrap"><label for="speaker-voice-${index}">${esc(speaker.name)} voice</label><select id="speaker-voice-${index}" aria-describedby="speaker-voice-${index}-help">${kokoroVoices
          .filter((voice) => availableVoices.includes(voice.id) || voice.id === speaker.voice)
          .map(
            (voice) =>
              `<option value="${voice.id}"${voice.id === speaker.voice ? " selected" : ""}>${esc(voice.name)} · ${esc(voice.accent)} · ${esc(voice.gender)}${availableVoices.includes(voice.id) ? "" : " · Setup needed"}</option>`,
          )
          .join(
            "",
          )}</select><p class="voice-help" id="speaker-voice-${index}-help">${availableVoices.includes(speaker.voice) ? "Local voice assets checked when this studio was built." : "Original voice retained. Its local assets need setup before production."}</p><div class="avatar-mode-config"><label for="speaker-avatar-mode-${index}">${esc(speaker.name)} avatar style</label><select id="speaker-avatar-mode-${index}"><option value="illustrated"${(speaker.avatar?.mode ?? "illustrated") === "illustrated" ? " selected" : ""}>3D Illustrated Character (Built-in)</option><option value="photo"${speaker.avatar?.mode === "photo" ? " selected" : ""}>Custom Photo / Uploaded Portrait (Animated Lip-Sync)</option></select><div id="speaker-avatar-photo-panel-${index}" class="avatar-photo-panel"${speaker.avatar?.mode === "photo" ? "" : " hidden"}><div class="avatar-photo-layout"><div class="avatar-canvas-wrap"><canvas id="speaker-avatar-canvas-${index}" width="140" height="140" class="avatar-lipsync-canvas"></canvas><button type="button" id="speaker-avatar-test-${index}" class="avatar-test-btn" data-speaker-index="${index}">▶ Test Lip-Sync</button></div><div class="avatar-photo-fields"><label for="speaker-avatar-image-${index}">Saved photo portrait</label><div class="avatar-upload-row"><select id="speaker-avatar-image-${index}" data-initial-value="${esc(speaker.avatar?.imageId ?? "")}"><option value="">— Select or upload an image —</option>${speaker.avatar?.imageId ? `<option value="${esc(speaker.avatar.imageId)}" selected>${esc(speaker.avatar.imageId)}</option>` : ""}</select><label class="avatar-upload-btn" for="speaker-avatar-upload-${index}">Upload Photo<input type="file" id="speaker-avatar-upload-${index}" class="avatar-upload-input" accept="image/png,image/jpeg,image/webp" data-speaker-index="${index}" hidden></label></div><span id="speaker-avatar-upload-status-${index}" class="audition-status" role="status"></span><div class="avatar-calibration-grid"><div><label for="speaker-avatar-mouth-y-${index}">Mouth vertical (<span id="speaker-avatar-mouth-y-val-${index}">${Math.round((speaker.avatar?.mouthY ?? 0.68) * 100)}%</span>)</label><input type="range" id="speaker-avatar-mouth-y-${index}" min="0.4" max="0.9" step="0.01" value="${speaker.avatar?.mouthY ?? 0.68}"></div><div><label for="speaker-avatar-mouth-x-${index}">Mouth horizontal (<span id="speaker-avatar-mouth-x-val-${index}">${Math.round((speaker.avatar?.mouthX ?? 0.5) * 100)}%</span>)</label><input type="range" id="speaker-avatar-mouth-x-${index}" min="0.2" max="0.8" step="0.01" value="${speaker.avatar?.mouthX ?? 0.5}"></div><div><label for="speaker-avatar-mouth-scale-${index}">Mouth size (<span id="speaker-avatar-mouth-scale-val-${index}">${Math.round((speaker.avatar?.mouthScale ?? 1) * 100)}%</span>)</label><input type="range" id="speaker-avatar-mouth-scale-${index}" min="0.5" max="2" step="0.05" value="${speaker.avatar?.mouthScale ?? 1}"></div></div></div></div></div></div></div></div>`,
    )
    .join(
      "",
    )}<p><a href="../../review.html#voices" target="_blank" rel="noopener">Listen to saved voice samples ↗</a> <small>(opens in a new tab)</small></p><p class="voice-help">Choices reflect this saved studio. Production checks the selected voices again. Install another profile, then rebuild the studio to add it here.</p></section>`;
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
              )}<div class="narration-actions"><button type="button" class="audition-btn" data-target="${fieldId}" data-speaker-index="${idx}">🔊 Audition Line</button><span id="audition-status-${fieldId}" class="audition-status" role="status"></span></div><audio id="audio-${fieldId}" class="audition-player" controls hidden></audio>`;
            })
            .join("")
        : `${field(`narration-${index}`, "Narration", scene.narration)}<div class="narration-actions"><button type="button" class="audition-btn" data-target="narration-${index}" data-speaker-index="0">🔊 Audition Line</button><span id="audition-status-narration-${index}" class="audition-status" role="status"></span></div><audio id="audio-narration-${index}" class="audition-player" controls hidden></audio>`;
      return `<section class="scene-editor" aria-labelledby="scene-${index}-heading"><div class="scene-heading"><h2 id="scene-${index}-heading">${index + 1}. ${esc(scene.id)}</h2><span>${scene.startSeconds}–${scene.endSeconds}s planned</span></div><p class="scene-visual">Visual: ${esc(scene.visual.label)} · fixed</p>${field(`overlay-${index}`, "On-screen headline", scene.overlay, 'maxlength="48" rows="2"')}${narration}<p class="scene-count" id="scene-${index}-count"></p><p class="field-warning" id="scene-${index}-warning" hidden></p></section>`;
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
  const pronunciationSection = `<section class="glossary-section" aria-labelledby="glossary-heading"><div class="glossary-header"><h3 id="glossary-heading">Pronunciation glossary (<span id="glossary-count">${pronunciationEntries.length}</span>)</h3></div><p class="voice-help">Technical terms mapped to natural phonetic speech. Edit spoken values, audition changes, or add new mappings:</p><ul id="glossary-list" class="glossary-list">${pronunciationEntries.map(([term, spoken]) => `<li class="glossary-item" data-term="${esc(term)}"><span class="glossary-term-badge">${esc(term)}</span><span class="glossary-arrow">→</span><input type="text" class="glossary-spoken-input" data-term="${esc(term)}" value="${esc(spoken)}" maxlength="80" aria-label="Pronunciation for ${esc(term)}"><button type="button" class="audition-term-btn" data-term="${esc(term)}" title="Audition this term">🔊</button><button type="button" class="remove-term-btn" data-term="${esc(term)}" title="Remove this term">✕</button></li>`).join("")}</ul><div class="glossary-add-row"><input type="text" id="new-term-key" placeholder="Term (e.g. SQLite)" maxlength="40" aria-label="New term"><span class="glossary-arrow">→</span><input type="text" id="new-term-val" placeholder="Spoken as (e.g. S Q Lite)" maxlength="80" aria-label="Spoken as"><button type="button" id="add-term-btn" class="add-term-btn">+ Add</button></div><p id="glossary-add-error" class="field-warning" hidden></p></section>`;
  const sandboxSection = `<div class="audition-sandbox"><h3>Pronunciation Sandbox</h3><p class="voice-help">Test any term or phrase in the selected voice:</p><div class="sandbox-input-row"><input id="sandbox-text" placeholder="e.g. OData v4 with CAP" maxlength="120"><button id="sandbox-audition-btn" type="button">Audition</button></div><span id="sandbox-status" class="audition-status" role="status"></span><audio id="sandbox-player" class="audition-player" controls hidden></audio></div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; base-uri 'none'; form-action 'none'"><title>Revise script · ${esc(episode.title)}</title><style>${css}</style></head><body><main><a class="back" href="../../review.html#episodes">← All episodes and styles</a><header><p class="eyebrow">SAP SHORTS · SCRIPT WORKSHOP</p><h1>Make this delivery your own.</h1><p>Choose voices and revise the wording, headlines, and companion post. Save a new version, then produce its narration and video.</p><p class="delivery">${esc(episodeSelector(episode))} · ${esc(presentationLabel(episode))}</p></header><noscript><p class="notice">Script revision needs JavaScript. The original script and sources remain readable below.</p></noscript><section id="draft-recovery" class="draft-recovery" aria-label="Draft recovery" hidden><p id="draft-recovery-message" role="status" aria-live="polite"></p><div class="recovery-actions"><button id="resume-draft" type="button" hidden>Resume saved draft</button><button id="discard-draft" type="button" hidden>Start with original</button></div><p class="recovery-help">Recovery stays in this browser tab at this address. Download your revised script to keep a portable copy. Closing the tab or changing the address may lose recovery.</p></section><div class="editor-layout"><div><fieldset id="editor-fields" disabled><legend class="sr-only">Revised script</legend><section class="draft-details"><label for="variant-name">New version name</label><input id="variant-name" value="${esc(seed.presentation.variant ?? "")}" maxlength="32" autocomplete="off" spellcheck="false" aria-describedby="variant-help"><p id="variant-help">Use lowercase letters, numbers, and hyphens, starting with a letter. Existing versions are kept.</p><label for="draft-title">Short title</label><input id="draft-title" value="${esc(seed.title)}" maxlength="60"></section>${voiceFields}${sceneFields}<section class="draft-details"><label for="publication-text">Companion post draft</label><textarea id="publication-text" rows="12" maxlength="3000">${esc(seed.publicationText ?? "")}</textarea></section></fieldset><section id="download-controls" class="download-panel" hidden><h2>Save your revised script</h2><p id="draft-count" aria-live="polite"></p><p>Draft timing is a writing guide. Audio duration and caption timing are measured during production.</p><p id="draft-errors" role="status"></p><details id="review-changes" class="change-review"><summary id="review-changes-summary">Review changes</summary><p id="review-changes-count" role="status" aria-live="polite"></p><div id="review-changes-list"></div><p class="change-review-help">Review compares this draft with its starting script. Restoring a section keeps your version name and other edits.</p></details><div class="save-actions"><button id="produce-script" type="button" class="produce-btn">Save & Produce Video</button><button id="download-script" type="button" class="secondary-btn">Download script</button></div><div id="produce-progress-box" class="produce-progress-box" hidden aria-live="polite"><div class="progress-bar"><div id="produce-progress-bar" class="progress-fill"></div></div><p id="produce-progress-text"></p><div id="produce-result" hidden></div></div><p id="download-status" role="status"></p><details><summary>Use the downloaded file</summary><p>From the project folder, import the file you downloaded:</p><code tabindex="0">npm run shorts -- script-import /path/to/downloaded-script.json</code><p>Then create the new version:</p><code id="produce-command" tabindex="0"></code><p>Import checks the current base and preserves existing versions. Review the revised wording against the sources before sharing.</p></details></section></div><aside aria-label="Revision context"><h2>Keep the evidence in view</h2><p>Delivery format, speaker names, scene order, planned timing, visuals, claims, and source dates stay fixed. To try another delivery, start with another prepared example.</p><h3>Starting voices</h3><p>${speakers.map((speaker) => `${esc(speaker.name)} · ${esc(voiceName(speaker.voice))}`).join("<br>")}</p><p>Existing recordings keep their recorded voices. This revision needs its own verified production result.</p>${dated}${pronunciationSection}${sandboxSection}<h3>Official sources</h3><ul>${episode.sources.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Read ${esc(source.retrievedOn)}</small></li>`).join("")}</ul><details><summary>Claims to preserve</summary><ul>${episode.claims.map((claim) => `<li>${esc(claim.text)}</li>`).join("")}</ul></details></aside></div><details class="original-script"><summary>Read the original script</summary><pre>${esc(original)}</pre></details><footer>Saved studio · download your revised script to keep it. Where supported, this tab can recover edits after a reload; closing the tab or changing the address may lose them.</footer></main><script type="application/json" id="editor-data">${payload}</script><script>${script}</script></body></html>`;
  return enhanceNewsReviewHtml(html);
}
