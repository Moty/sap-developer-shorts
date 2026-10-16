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
  const voiceFields = `<section class="draft-details voice-editor" aria-labelledby="voice-heading"><h2 id="voice-heading">Choose the voices</h2><p>These choices apply to your new version. The project default and existing recordings stay as they are.</p>${speakers
    .map(
      (speaker, index) =>
        `<label for="speaker-voice-${index}">${esc(speaker.name)} voice</label><select id="speaker-voice-${index}" aria-describedby="speaker-voice-${index}-help">${kokoroVoices
          .filter((voice) => availableVoices.includes(voice.id) || voice.id === speaker.voice)
          .map(
            (voice) =>
              `<option value="${voice.id}"${voice.id === speaker.voice ? " selected" : ""}>${esc(voice.name)} · ${esc(voice.accent)} · ${esc(voice.gender)}${availableVoices.includes(voice.id) ? "" : " · Setup needed"}</option>`,
          )
          .join(
            "",
          )}</select><p class="voice-help" id="speaker-voice-${index}-help">${availableVoices.includes(speaker.voice) ? "Local voice assets checked when this studio was built." : "Original voice retained. Its local assets need setup before production."}</p>`,
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
            .map((turn, position) =>
              field(
                `turn-${index}-${position}`,
                `${speakers.find((speaker) => speaker.id === turn.speakerId)?.name ?? turn.speakerId} · turn ${position + 1}`,
                turn.text,
              ),
            )
            .join("")
        : field(`narration-${index}`, "Narration", scene.narration);
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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Revise script · ${esc(episode.title)}</title><style>${css}</style></head><body><main><a class="back" href="../../review.html#episodes">← All episodes and styles</a><header><p class="eyebrow">SAP SHORTS · SCRIPT WORKSHOP</p><h1>Make this delivery your own.</h1><p>Choose voices and revise the wording, headlines, and companion post. Save a new version, then produce its narration and video.</p><p class="delivery">${esc(episodeSelector(episode))} · ${esc(presentationLabel(episode))}</p></header><noscript><p class="notice">Script revision needs JavaScript. The original script and sources remain readable below.</p></noscript><section id="draft-recovery" class="draft-recovery" aria-label="Draft recovery" hidden><p id="draft-recovery-message" role="status" aria-live="polite"></p><div class="recovery-actions"><button id="resume-draft" type="button" hidden>Resume saved draft</button><button id="discard-draft" type="button" hidden>Start with original</button></div><p class="recovery-help">Recovery stays in this browser tab at this address. Download your revised script to keep a portable copy. Closing the tab or changing the address may lose recovery.</p></section><div class="editor-layout"><div><fieldset id="editor-fields" disabled><legend class="sr-only">Revised script</legend><section class="draft-details"><label for="variant-name">New version name</label><input id="variant-name" value="${esc(seed.presentation.variant ?? "")}" maxlength="32" autocomplete="off" spellcheck="false" aria-describedby="variant-help"><p id="variant-help">Use lowercase letters, numbers, and hyphens, starting with a letter. Existing versions are kept.</p><label for="draft-title">Short title</label><input id="draft-title" value="${esc(seed.title)}" maxlength="60"></section>${voiceFields}${sceneFields}<section class="draft-details"><label for="publication-text">Companion post draft</label><textarea id="publication-text" rows="12" maxlength="3000">${esc(seed.publicationText ?? "")}</textarea></section></fieldset><section id="download-controls" class="download-panel" hidden><h2>Save your revised script</h2><p id="draft-count" aria-live="polite"></p><p>Draft timing is a writing guide. Audio duration and caption timing are measured during production.</p><p id="draft-errors" role="status"></p><details id="review-changes" class="change-review"><summary id="review-changes-summary">Review changes</summary><p id="review-changes-count" role="status" aria-live="polite"></p><div id="review-changes-list"></div><p class="change-review-help">Review compares this draft with its starting script. Restoring a section keeps your version name and other edits.</p></details><button id="download-script" type="button">Download revised script</button><p id="download-status" role="status"></p><details><summary>Use the downloaded file</summary><p>From the project folder, import the file you downloaded:</p><code tabindex="0">npm run shorts -- script-import /path/to/downloaded-script.json</code><p>Then create the new version:</p><code id="produce-command" tabindex="0"></code><p>Import checks the current base and preserves existing versions. Review the revised wording against the sources before sharing.</p></details></section></div><aside aria-label="Revision context"><h2>Keep the evidence in view</h2><p>Delivery format, speaker names, scene order, planned timing, visuals, claims, and source dates stay fixed. To try another delivery, start with another prepared example.</p><h3>Starting voices</h3><p>${speakers.map((speaker) => `${esc(speaker.name)} · ${esc(voiceName(speaker.voice))}`).join("<br>")}</p><p>Existing recordings keep their recorded voices. This revision needs its own verified production result.</p>${dated}<h3>Official sources</h3><ul>${episode.sources.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Read ${esc(source.retrievedOn)}</small></li>`).join("")}</ul><details><summary>Claims to preserve</summary><ul>${episode.claims.map((claim) => `<li>${esc(claim.text)}</li>`).join("")}</ul></details></aside></div><details class="original-script"><summary>Read the original script</summary><pre>${esc(original)}</pre></details><footer>Saved studio · download your revised script to keep it. Where supported, this tab can recover edits after a reload; closing the tab or changing the address may lose them.</footer></main><script type="application/json" id="editor-data">${payload}</script><script>${script}</script></body></html>`;
  return enhanceNewsReviewHtml(html);
}
