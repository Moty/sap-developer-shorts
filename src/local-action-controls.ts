import type { LocalActionName } from "./local-actions.js";
import { kokoroVoice } from "./media/voices.js";
import { escapeHtml as esc } from "./review.js";

export function localActionButton(
  action: LocalActionName,
  label: string,
  voice?: string,
  currentDefault = false,
  needsInstall = false,
) {
  return `<button type="button" class="secondary-action local-action-button" data-local-action="${action}"${voice ? ` data-voice="${esc(voice)}" data-voice-label="${esc(kokoroVoice(voice).name)}"` : ""}${currentDefault ? ' data-current-default="true"' : ""}${needsInstall ? ' data-needs-install="true"' : ""} disabled>${esc(label)}</button>`;
}

export function localActionFeedback() {
  return '<p data-local-action-status role="status" aria-live="polite"></p><audio data-local-action-audio controls hidden></audio>';
}
