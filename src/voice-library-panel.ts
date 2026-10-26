import { localActionButton, localActionFeedback } from "./local-action-controls.js";
import { escapeHtml as esc } from "./review.js";
import { voiceReadingScripts } from "./voice-reading-scripts.js";
import { voiceStyles } from "./voice-styles.js";

export function voiceLibraryPanel(options: {
  context: "library" | "editor";
  speakers?: { name: string }[];
}) {
  const library = options.context === "library";
  const speakers = options.speakers ?? [];
  const payload = JSON.stringify({
    voicePanelContext: "library",
    voiceReadingScripts,
    voiceStyles,
  }).replaceAll("<", "\\u003c");
  return `<details id="my-voice-panel" class="my-voice-panel personal-voice-panel"${library ? " open" : ""}>
<summary>${library ? "My voice styles" : "My voice · record or upload a sample"}</summary>
<p>Save a separate take for each delivery. Record in the style you want Qwen to use, then listen to its audition before using it in an episode.</p>
<p id="my-voice-runtime" role="status">Checking personal voice tools…</p>
<details class="personal-voice-setup"><summary>Personal voice tools</summary><div data-local-action-scope>${localActionButton("clone-setup", "Set up personal voice tools")}${localActionFeedback()}</div></details>
<div id="my-voice-controls" hidden><div class="voice-panel-layout">
<section class="saved-personal-voices" aria-labelledby="saved-personal-heading"><h3 id="saved-personal-heading">Saved recordings</h3>
<div${library ? " hidden" : ""}><label for="my-voice-speaker">Use for speaker</label><select id="my-voice-speaker">${speakers.length ? speakers.map((speaker, index) => `<option value="${index}">${esc(speaker.name)}</option>`).join("") : '<option value="0">Voice library</option>'}</select></div>
<label for="my-voice-query">Find a personal recording</label><input id="my-voice-query" type="search" maxlength="80" placeholder="Search speaker or style…" autocomplete="off">
<label for="my-voice-filter">Filter by delivery style</label><select id="my-voice-filter"><option value="all">All styles</option>${voiceStyles.map((style) => `<option value="${style.id}">${esc(style.label)}</option>`).join("")}<option value="unlabelled">Original / unlabelled recordings</option></select>
<label for="my-voice-saved">Saved personal voices</label><select id="my-voice-saved"><option value="">Choose a saved voice</option></select>
<p id="my-voice-count" class="voice-help"></p><p id="my-voice-style-summary" class="voice-help"></p>
<label for="my-voice-reference">Original recording</label><audio id="my-voice-reference" controls hidden></audio>
<div class="my-voice-actions"><button type="button" id="my-voice-generate" disabled>Generate audition</button><button type="button" id="my-voice-accept" disabled>${library ? "I listened · make available" : "I listened · use this voice"}</button><button type="button" id="my-voice-delete" class="secondary-btn" disabled>Delete voice sample</button></div>
<label for="my-voice-audition">Generated audition</label><audio id="my-voice-audition" controls hidden></audio>
<p class="voice-help">${library ? "Accepted recordings appear as My voice choices in episode editors on this Mac. Select a recording for each speaker in Voice &amp; portrait." : "Accepting a recording selects it for the speaker above. Save your draft to keep that choice."}</p>
</section>
<details id="my-voice-enrollment" class="voice-enrollment"><summary>Add a voice style</summary>
<div class="voice-recording-identity"><div><label for="my-voice-name">Speaker name</label><input id="my-voice-name" maxlength="40" autocomplete="off" placeholder="e.g. Moty"></div><div><label for="my-voice-style">Recording style</label><select id="my-voice-style">${voiceStyles.map((style) => `<option value="${style.id}">${esc(style.label)}</option>`).join("")}</select></div></div>
<p id="my-voice-style-guidance" class="voice-help">Use your own delivery for each style. Each saved take has its own audition.</p>
<div id="my-voice-record-pane"><section class="reading-card" aria-labelledby="my-voice-reading-heading"><h3 id="my-voice-reading-heading">Read a short passage</h3><label for="my-voice-reading-choice">Sample text</label><select id="my-voice-reading-choice">${voiceReadingScripts.map((passage) => `<option value="${passage.id}">${esc(passage.label)}</option>`).join("")}</select><p id="my-voice-reading-text" class="reading-text"></p><p id="my-voice-reading-guidance" class="voice-help"></p><button type="button" id="my-voice-reading-script">Use this text as transcript</button></section>
<p class="voice-help">Aim for 10–20 seconds in a quiet room. Read naturally with no music or other speakers. Recording stops at 29 seconds.</p><div class="my-voice-actions"><button type="button" id="my-voice-record">Record sample</button><meter id="my-voice-meter" min="0" max="1" value="0" aria-label="Microphone level"></meter></div><label for="my-voice-file">Or upload audio (up to two minutes / 30 MiB)</label><input id="my-voice-file" type="file" accept="audio/*"><button type="button" id="my-voice-review-next" disabled>Review recording</button></div>
<div id="my-voice-review-pane" hidden><h3>Review and save this take</h3><audio id="my-voice-upload-preview" controls hidden></audio><details class="voice-excerpt"><summary>Choose an excerpt</summary><div class="my-voice-trim"><label>Excerpt start (seconds)<input id="my-voice-start" type="number" min="0" step="0.01" value="0"></label><label>Excerpt end (seconds)<input id="my-voice-end" type="number" min="3" step="0.01" value="15"></label><button id="my-voice-preview-trim" type="button">Preview excerpt</button></div><p class="voice-help">Save 3–30 seconds. Short recordings keep their complete audio unless you choose an excerpt.</p></details><label for="my-voice-transcript">Exact words in the selected excerpt</label><textarea id="my-voice-transcript" maxlength="2000" rows="4" autocomplete="off" placeholder="Use the reading text or enter exactly what the recording says."></textarea><label class="my-voice-consent"><input id="my-voice-consent" type="checkbox">This is my voice, or the speaker has agreed to its use.</label><div class="my-voice-actions"><button type="button" id="my-voice-save">Save this voice style</button><button type="button" id="my-voice-review-back" class="secondary-btn">Back to recording</button></div></div>
</details></div></div><p id="my-voice-status" role="status" aria-live="polite"></p></details>${library ? `<script type="application/json" id="voice-library-data">${payload}</script>` : ""}`;
}
