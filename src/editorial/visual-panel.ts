/** Local visual workbench. Controls stay mounted while its panels are switched. */
export function advancedVisualPanel(): string {
  const backgrounds = [
    ["classic", "Classic"],
    ["aurora", "Aurora"],
    ["blueprint", "Blueprint"],
    ["spotlight", "Spotlight"],
    ["editorial", "Editorial"],
  ];
  return `<details class="advanced-visual-controls" open>
<summary id="visual-studio-heading">Presentation studio <span class="visual-summary-tag">Live preview</span></summary>
<p class="writing-help">Explore a look, see it on your scene, then apply it to your draft. Previews run locally without an AI request.</p>
<div class="visual-studio-container"><div class="visual-studio">
<aside class="visual-preview-pane" aria-label="Scene preview">
<div class="visual-preview-heading"><strong id="visual-scene-title">Scene preview</strong><span id="visual-draft-state">Current draft</span></div>
<figure class="visual-frame-preview" id="visual-frame-preview" aria-busy="false">
<div class="visual-phone"><img id="visual-frame-image" alt="Representative frame rendered from the preview settings" hidden><div id="visual-frame-empty">Your scene appears here</div><span id="visual-render-state" hidden>Updating…</span></div>
<figcaption id="visual-preview-status" role="status">Choose a look to preview it.</figcaption>
</figure>
<label class="visual-scrub-label" for="visual-progress">Scene position <output id="visual-progress-label">50%</output></label><input type="range" id="visual-progress" min="0.05" max="0.95" step="0.05" value="0.5" aria-describedby="visual-frame-note">
<div class="visual-preview-actions"><button type="button" id="visual-preview">Refresh preview</button><button type="button" id="visual-apply">Apply to draft</button></div>
<details class="visual-preview-info"><summary>About this preview</summary><p class="writing-help" id="visual-frame-note">A representative frame at planned timing. Scrub to inspect motion; narration and animated portraits are generated during production.</p></details>
</aside>
<div class="visual-settings-pane">
<label class="visual-scene-select">Preview scene<select id="visual-scene"></select></label>
<div class="visual-tabs" role="tablist" aria-label="Presentation controls">${[
    ["look", "Look & motion"],
    ["layout", "Scene layout"],
    ["image", "Image"],
  ]
    .map(
      ([id, label], index) =>
        `<button type="button" role="tab" id="visual-tab-${id}" aria-controls="visual-panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-visual-tab="${id}">${label}</button>`,
    )
    .join("")}</div>
<section id="visual-panel-look" role="tabpanel" aria-labelledby="visual-tab-look" data-visual-panel="look">
<p class="visual-scope">Applies to every scene</p><label>Color palette<select id="visual-theme"><option value="electric">Electric · lime &amp; violet</option><option value="ocean">Ocean · cyan &amp; teal</option><option value="sunset">Sunset · coral &amp; gold</option></select></label>
<p class="visual-field-label">Background</p><input type="hidden" id="visual-background" value="classic"><div class="visual-backgrounds" role="group" aria-label="Background">${backgrounds.map(([id, label]) => `<button type="button" class="visual-background-choice" data-visual-background="${id}" aria-pressed="${id === "classic"}"><span class="visual-background-sample is-${id}" aria-hidden="true"><i></i><i></i></span><span>${label}</span></button>`).join("")}</div>
<div class="visual-control-grid"><label>Motion<select id="visual-motion"><option value="smooth">Smooth</option><option value="snappy">Snappy</option><option value="minimal">Minimal / static</option></select></label><label>Background effect<select id="visual-effect"><option value="none">None</option><option value="drift">Gentle drift</option><option value="particles">Subtle particles</option></select></label></div><p class="writing-help">Minimal freezes decorative motion. Scrub the preview to compare positions.</p>
</section>
<section id="visual-panel-layout" role="tabpanel" aria-labelledby="visual-tab-layout" data-visual-panel="layout" hidden>
<p class="visual-scope">This scene only</p><label>Explanatory layout<select id="visual-layout"><option value="automatic">Automatic</option><option value="callout">Hero callout</option><option value="steps">Step cards</option><option value="comparison">Comparison</option><option value="flow">Connected flow</option><option value="timeline">Milestone sequence</option></select></label><p id="visual-layout-note" class="writing-help"></p><label id="visual-labels-field">Layout labels · one per line<textarea id="visual-labels" rows="4" maxlength="180" placeholder="Define the data&#10;Expose the service&#10;Query the endpoint"></textarea><small>Up to 32 characters each. Flows/milestones take 2–4 labels.</small></label><label id="visual-data-field">Captured data display<select id="visual-data-view"><option value="rows">Data rows</option><option value="bars">Horizontal bars</option><option value="dots">Dot plot</option></select></label><p class="writing-help">Code and source cards keep their evidence layout. Charts use captured values and are offered only on supported output scenes.</p>
</section>
<section id="visual-panel-image" role="tabpanel" aria-labelledby="visual-tab-image" data-visual-panel="image" hidden>
<p class="visual-scope">This scene only · separate from presenter photos</p><label>Selected image<select id="visual-image"><option value="">No image</option></select></label><button type="button" id="visual-assets-load">Refresh image library</button>
<div id="visual-image-fields" hidden><div class="visual-control-grid"><label>Placement<select id="visual-image-treatment"><option value="card">Framed illustration</option><option value="background">Dimmed background</option></select></label><label>Fit<select id="visual-image-fit"><option value="contain">Contain · whole image</option><option value="cover">Cover · crop to fill</option></select></label></div><div id="visual-focus-fields" class="visual-control-grid" hidden><label>Horizontal focus<input type="range" id="visual-image-x" min="0" max="1" step="0.05" value="0.5"></label><label>Vertical focus<input type="range" id="visual-image-y" min="0" max="1" step="0.05" value="0.5"></label></div><label>Alt text<input id="visual-image-alt" maxlength="160" placeholder="Describe the illustration"></label><label>Caption<input id="visual-image-caption" maxlength="96" placeholder="Optional short explanation"></label></div>
<details class="visual-upload-panel"><summary>Add an image</summary><label>Upload label<input id="visual-upload-label" maxlength="80" placeholder="Architecture diagram"></label><label>Credit / attribution<input id="visual-upload-credit" maxlength="120" placeholder="Optional creator or source credit"></label><label>Image file<input type="file" id="visual-upload-file" accept="image/png,image/jpeg,image/webp"></label><button type="button" id="visual-upload">Save image locally</button><p class="writing-help">PNG/JPEG/WebP up to 8 MB. Uploading adds it to the library; select it to preview it in this scene. Image bytes stay on this Mac.</p></details>
</section>
<div class="visual-controls-footer"><p id="visual-status" role="status"></p><button type="button" id="visual-refresh">Reset to draft</button></div>
</div></div></div></details>`;
}
