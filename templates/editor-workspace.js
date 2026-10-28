(() => {
  const root = document.querySelector?.("[data-editor-workspace]");
  if (!root) return;
  const { seed } = JSON.parse(document.getElementById("editor-data").textContent);
  const bridge = globalThis.shortsWritingEditor;
  const byId = (id) => document.getElementById(id);
  const all = (selector) => [...root.querySelectorAll(selector)];
  const state = { step: "script", view: "scene", scene: 0, outline: false, evidence: false };
  const views = {
    details: "script",
    writing: "script",
    scene: "script",
    voice: "voice",
    companion: "review",
    "ai-review": "review",
    produce: "review",
  };
  const destinations = {
    details: "editor-script-start",
    writing: "presentation",
    voice: "voice-heading",
    companion: "companion-post-heading",
    "ai-review": "final-review-heading",
    produce: "download-controls",
  };
  const get = (id, fallback = "") => byId(id)?.value ?? fallback;
  const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
  const sceneText = (index) =>
    seed.scenes[index].dialogue
      ? seed.scenes[index].dialogue
          .map((_turn, position) => get(`turn-${index}-${position}`))
          .join(" ")
      : get(`narration-${index}`);
  function measure() {
    const height = Math.ceil(
      document.querySelector(".studio-topbar").getBoundingClientRect().height,
    );
    document.documentElement.style.setProperty("--studio-bar-height", `${height}px`);
    document.documentElement.style.setProperty("--editor-nav-offset", `${height + 20}px`);
  }
  function focus(id) {
    const target = byId(id);
    if (!target) return;
    measure();
    if (!target.matches("input, select, textarea, button, a[href], summary, [tabindex]"))
      target.setAttribute("tabindex", "-1");
    const scrollTarget = /^scene-\d+-heading$/u.test(id) ? byId("scene-focus") : target;
    scrollTarget.scrollIntoView({ block: "start", behavior: "instant" });
    target.focus({ preventScroll: true });
  }
  function refresh() {
    byId("workspace-title").textContent = get("draft-title").trim() || "Untitled episode";
    byId("workspace-version").textContent = `New version · ${get("variant-name")}`;
    byId("workspace-total-words").textContent =
      `${seed.scenes.reduce((count, _scene, index) => count + words(sceneText(index)), 0)} draft words`;
    byId("workspace-scene-position").textContent =
      `SCENE ${String(state.scene + 1).padStart(2, "0")} OF ${String(seed.scenes.length).padStart(2, "0")}`;
    byId("workspace-preview-number").textContent =
      `${String(state.scene + 1).padStart(2, "0")} / ${String(seed.scenes.length).padStart(2, "0")}`;
    let design;
    try {
      design = JSON.parse(get("presentation-design") || "null");
    } catch {
      /* The existing editor reports malformed designs. */
    }
    const current = seed.scenes[state.scene];
    byId("workspace-preview-headline").textContent =
      design?.scenes?.find((scene) => scene.id === current.id)?.headline ||
      get(`overlay-${state.scene}`) ||
      "Your on-screen headline";
    byId("workspace-preview-caption").textContent =
      sceneText(state.scene) || "Your narration appears here.";
    byId("workspace-preview-headline").closest(".preview-phone").dataset.theme = [
      "electric",
      "ocean",
      "sunset",
    ].includes(design?.theme)
      ? design.theme
      : "electric";
    byId("workspace-scene-previous").disabled = state.scene === 0;
    byId("workspace-scene-next").disabled = state.scene === seed.scenes.length - 1;
  }
  function render(moveFocus = false, updateUrl = true) {
    bridge.syncStep(state.step);
    root.dataset.editorStep = state.step;
    root.dataset.workspaceView = state.view;
    root.dataset.outlineOpen = String(state.outline);
    for (const pane of all("[data-editor-pane]"))
      pane.hidden = pane.dataset.editorPane !== state.step;
    for (const pane of all("[data-workspace-pane]"))
      pane.hidden = pane.dataset.workspacePane !== state.view;
    for (const card of all(".scene-editor[data-scene-index]"))
      card.hidden = state.view !== "scene" || Number(card.dataset.sceneIndex) !== state.scene;
    for (const button of all("[data-editor-step]")) {
      if (button.dataset.editorStep === state.step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    for (const button of all("[data-editor-target]")) {
      if (button.dataset.editorTarget === state.view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    for (const button of all("[data-editor-scene]")) {
      if (state.view === "scene" && Number(button.dataset.editorScene) === state.scene)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    const next = byId("editor-next");
    const label =
      state.step === "script"
        ? "Next: Voice & portrait"
        : state.step === "voice"
          ? "Next: Review & produce"
          : state.view === "companion"
            ? "Next: AI content review"
            : state.view === "ai-review"
              ? "Next: Produce"
              : "Back to script";
    next.textContent = label;
    next.dataset.shortLabel =
      state.step === "script"
        ? "Voice"
        : state.step === "voice"
          ? "Review"
          : state.view === "companion"
            ? "AI review"
            : state.view === "ai-review"
              ? "Produce"
              : "Script";
    next.setAttribute("aria-label", label);
    byId("editor-outline-toggle").setAttribute("aria-expanded", String(state.outline));
    byId("editor-evidence").hidden = !state.evidence;
    byId("editor-evidence-toggle").setAttribute("aria-expanded", String(state.evidence));
    if (state.view === "writing") byId("presentation").open = true;
    refresh();
    const target =
      state.view === "scene" ? `scene-${state.scene}-heading` : destinations[state.view];
    if (updateUrl && target) history.replaceState(null, "", `#${target}`);
    if (state.step === "review") globalThis.shortsFinalReview?.refresh();
    if (moveFocus && target) focus(target);
    measure();
  }
  function activate(view, index = state.scene, moveFocus = true, updateUrl = true) {
    if (
      !Object.hasOwn(views, view) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= seed.scenes.length
    )
      return;
    state.step = views[view];
    state.view = view;
    state.scene = index;
    state.outline = false;
    render(moveFocus, updateUrl);
  }
  function showStep(step, moveFocus = false) {
    activate(
      step === "script" ? "scene" : step === "voice" ? "voice" : "companion",
      state.scene,
      moveFocus,
    );
  }
  function jumpTo(id) {
    const scene = /^(?:scene-(\d+)-heading|narration-(\d+)|overlay-(\d+)|turn-(\d+)-\d+)$/u.exec(
      id,
    );
    if (scene) activate("scene", Number(scene[1] ?? scene[2] ?? scene[3] ?? scene[4]), false);
    else if (["editor-script-start", "variant-name", "draft-title"].includes(id))
      activate("details", state.scene, false);
    else if (["presentation", "presentation-design"].includes(id))
      activate("writing", state.scene, false);
    else if (id === "voice-heading" || id.startsWith("speaker-"))
      activate("voice", state.scene, false);
    else if (id === "companion-post-heading" || id === "publication-text")
      activate("companion", state.scene, false);
    else if (id === "final-review-heading" || id === "final-review-panel")
      activate("ai-review", state.scene, false);
    else if (["download-controls", "draft-errors", "produce-script"].includes(id))
      activate("produce", state.scene, false);
    else return false;
    const target = id === "presentation-design" ? "presentation" : id;
    focus(target);
    return true;
  }
  for (const button of all("[data-editor-scene]"))
    button.addEventListener("click", () => activate("scene", Number(button.dataset.editorScene)));
  for (const button of all("[data-editor-target]"))
    button.addEventListener("click", () => activate(button.dataset.editorTarget));
  for (const button of all("[data-editor-step]"))
    button.addEventListener("click", () => showStep(button.dataset.editorStep, true));
  byId("workspace-scene-previous").addEventListener("click", () =>
    activate("scene", state.scene - 1),
  );
  byId("workspace-scene-next").addEventListener("click", () => activate("scene", state.scene + 1));
  byId("editor-next").addEventListener("click", () => {
    activate(
      state.step === "script"
        ? "voice"
        : state.step === "voice"
          ? "companion"
          : state.view === "companion"
            ? "ai-review"
            : state.view === "ai-review"
              ? "produce"
              : "scene",
    );
  });
  byId("editor-outline-toggle").addEventListener("click", () => {
    state.outline = !state.outline;
    state.evidence = false;
    render();
    if (state.outline) {
      const outline = byId("editor-outline");
      (
        outline.querySelector("[aria-current=page]") || outline.querySelector("[aria-current=step]")
      )?.focus();
    }
  });
  function evidence(open, restoreFocus = false) {
    state.evidence = open;
    state.outline = false;
    render();
    if (open) {
      byId("editor-evidence").querySelector(".editor-reference").open = true;
      byId("editor-evidence-close").focus();
    } else if (restoreFocus) byId("editor-evidence-toggle").focus();
  }
  byId("editor-evidence-toggle").addEventListener("click", () => evidence(!state.evidence));
  byId("editor-evidence-close").addEventListener("click", () => evidence(false, true));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.evidence) evidence(false, true);
    else if (state.outline) {
      state.outline = false;
      render();
      byId("editor-outline-toggle").focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      state.evidence &&
      !byId("editor-evidence").contains(event.target) &&
      !byId("editor-evidence-toggle").contains(event.target)
    )
      evidence(false);
    if (
      state.outline &&
      !byId("editor-outline").contains(event.target) &&
      !byId("editor-outline-toggle").contains(event.target)
    ) {
      state.outline = false;
      render();
    }
  });
  addEventListener("resize", measure);
  if (typeof ResizeObserver === "function")
    new ResizeObserver(measure).observe(document.querySelector(".studio-topbar"));
  globalThis.shortsWorkspace = { showStep, jumpTo, refresh, activate };
  // Compact the legacy startup status without changing the recovery or save state.
  const saveState = byId("editor-save-state");
  if (saveState.textContent === "Unsaved changes · Save draft to keep this version")
    saveState.textContent = "Unsaved changes";
  const validation = byId("editor-validation-state");
  if (validation.textContent === "Draft checked · timing measured during production")
    validation.textContent = "Draft checked";
  // The dot beside the status text mirrors the saved/unsaved state without changing the text.
  const statusLine = saveState.parentElement;
  function syncStatusDot() {
    if (!statusLine?.dataset) return;
    const text = saveState.textContent.trim();
    statusLine.dataset.saveState = /^Saved/u.test(text)
      ? "saved"
      : /^Unsaved/u.test(text)
        ? "unsaved"
        : /^Saving/u.test(text)
          ? "saving"
          : "other";
  }
  syncStatusDot();
  if (typeof MutationObserver === "function")
    new MutationObserver(syncStatusDot).observe(saveState, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  function navigateFragment() {
    let hash;
    try {
      hash = decodeURIComponent(location.hash.slice(1));
    } catch {
      // A malformed external fragment must not prevent the editor from opening.
    }
    return hash && byId(hash) && jumpTo(hash);
  }
  addEventListener("hashchange", navigateFragment);
  if (!navigateFragment()) render(false, false);
})();
