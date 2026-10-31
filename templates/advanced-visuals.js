(() => {
  const root = document.querySelector(".advanced-visual-controls");
  const editor = globalThis.shortsWritingEditor;
  if (!root || !editor) return;
  const data = JSON.parse(document.getElementById("editor-data").textContent);
  const node = (name) => document.getElementById(`visual-${name}`);
  const status = node("status");
  let assets = [];
  let assetsLoaded = false;
  let panelSnapshot = "";
  let workingDesign;
  let editingScene = 0;
  let uploadBusy = false;
  let rendering = false;
  let revision = 0;
  let timer;
  let applying = false;
  let edited = false;
  const snapshot = () => editor.snapshot();
  const designFor = (current) =>
    current.design
      ? structuredClone(current.design)
      : {
          schemaVersion: 1,
          theme: "electric",
          motion: "smooth",
          scenes: current.scenes.map((scene) => ({
            id: scene.id,
            headline: scene.overlay,
            emphasis: "balanced",
          })),
        };
  for (const [index, scene] of data.seed.scenes.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1}. ${scene.id}`;
    node("scene").append(option);
  }
  function imageChoices(selected = node("image").value) {
    node("image").replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No image";
    node("image").append(none);
    for (const asset of assets) {
      const option = document.createElement("option");
      option.value = asset.id;
      option.textContent = asset.label;
      node("image").append(option);
    }
    if (selected && !assets.some((asset) => asset.id === selected)) {
      const missing = document.createElement("option");
      missing.value = selected;
      missing.textContent = "Saved image · unavailable in this library";
      node("image").append(missing);
    }
    node("image").value = selected;
  }
  function visibility() {
    node("labels-field").hidden = node("layout").disabled || node("layout").value === "automatic";
    node("image-fields").hidden = !node("image").value;
    node("focus-fields").hidden = node("image-fit").value !== "cover";
    for (const button of root.querySelectorAll("[data-visual-background]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.visualBackground === node("background").value),
      );
  }
  function sceneFields() {
    const scene = workingDesign.scenes[editingScene];
    const explanation = data.compositionSceneIds.includes(scene.id);
    const output = data.visualOutputSceneIds.includes(scene.id);
    node("scene-title").textContent = `Scene ${editingScene + 1} · ${scene.id}`;
    node("layout").disabled = !explanation;
    for (const option of node("image-treatment").options)
      if (option.value === "card") option.disabled = !explanation;
    node("layout-note").textContent = explanation
      ? "Use a short visual explanation. Your headline and narration stay unchanged."
      : "This scene preserves code or source evidence. Try changing its background or adding a background image.";
    node("layout").value = scene.composition?.kind ?? "automatic";
    node("labels").value = scene.composition?.items.map((item) => item.label).join("\n") ?? "";
    node("data-field").hidden = !output;
    node("data-view").value = scene.dataView ?? "rows";
    imageChoices(scene.image?.assetId ?? "");
    node("image-treatment").value = scene.image?.treatment ?? (explanation ? "card" : "background");
    node("image-fit").value = scene.image?.fit ?? "contain";
    node("image-x").value = String(scene.image?.focalX ?? 0.5);
    node("image-y").value = String(scene.image?.focalY ?? 0.5);
    node("image-alt").value = scene.image?.alt ?? "";
    node("image-caption").value = scene.image?.caption ?? "";
    visibility();
  }
  function collect() {
    if (!workingDesign) return;
    workingDesign.theme = node("theme").value;
    workingDesign.background = node("background").value;
    workingDesign.motion = node("motion").value;
    workingDesign.effect = node("effect").value;
    const scene = workingDesign.scenes[editingScene];
    if (data.compositionSceneIds.includes(scene.id)) {
      const kind = node("layout").value;
      if (kind === "automatic") delete scene.composition;
      else {
        const existing = scene.composition?.items ?? [];
        scene.composition = {
          kind,
          items: node("labels")
            .value.split(/\n/u)
            .map((label) => label.trim())
            .filter(Boolean)
            .map((label, index) => ({
              label,
              ...(existing[index]?.label === label && existing[index]?.claimId
                ? { claimId: existing[index].claimId }
                : {}),
            })),
        };
      }
    }
    if (data.visualOutputSceneIds.includes(scene.id)) {
      if (node("data-view").value === "rows") delete scene.dataView;
      else scene.dataView = node("data-view").value;
    }
    const selected = node("image").value;
    if (!selected) delete scene.image;
    else
      scene.image = {
        assetId: selected,
        fit: node("image-fit").value,
        treatment: node("image-treatment").value,
        focalX: Number(node("image-x").value),
        focalY: Number(node("image-y").value),
        alt: node("image-alt").value.trim(),
        ...(node("image-caption").value.trim()
          ? { caption: node("image-caption").value.trim() }
          : {}),
      };
    visibility();
  }
  function candidate() {
    collect();
    const before = snapshot();
    if (JSON.stringify(before) !== panelSnapshot)
      throw new Error("Your draft changed elsewhere. Reset to draft to load its latest design.");
    const result = editor.previewDesign(hasChanges() ? workingDesign : before.design, before);
    const problems = [...(result.issues?.script ?? []), ...(result.issues?.post ?? [])];
    if (problems.length) throw new Error(problems.join(" "));
    return result;
  }
  function hasChanges() {
    const original = JSON.parse(panelSnapshot);
    if (!original.design) return edited;
    const saved = designFor(original);
    // Optional defaults are equivalent to omitted fields on existing designs.
    const canonical = (value) =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
            )
          : value;
    const normalized = (design) =>
      JSON.stringify(
        canonical({
          ...design,
          background: design.background ?? "classic",
          effect: design.effect ?? "none",
          scenes: design.scenes.map((scene) => ({ ...scene, dataView: scene.dataView ?? "rows" })),
        }),
      );
    return normalized(workingDesign) !== normalized(saved);
  }
  function dirtyState() {
    const dirty = hasChanges();
    node("draft-state").textContent = dirty
      ? "Preview only · not applied"
      : JSON.parse(panelSnapshot).design
        ? "Current draft"
        : "Automatic draft style";
    node("apply").disabled = !dirty;
  }
  function refresh() {
    const current = snapshot();
    panelSnapshot = JSON.stringify(current);
    edited = false;
    workingDesign = designFor(current);
    node("theme").value = workingDesign.theme;
    node("background").value = workingDesign.background ?? "classic";
    node("motion").value = workingDesign.motion;
    node("effect").value = workingDesign.effect ?? "none";
    editingScene = Number(node("scene").value || 0);
    sceneFields();
    dirtyState();
  }
  async function request(path, body) {
    const session = await fetch("/api/local-voices/session");
    if (!session.ok) throw new Error("Open the current local studio for visual tools.");
    const response = await fetch(
      `/api/creator/${path}`,
      body
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {},
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Visual action failed.");
    return result;
  }
  function pending() {
    node("frame-preview").setAttribute("aria-busy", "true");
    node("render-state").hidden = false;
    node("render-state").textContent = "Updating…";
    node("preview-status").textContent = "Updating the local preview…";
  }
  function queuePreview(delay = 450) {
    revision++;
    clearTimeout(timer);
    if (!root.open) return;
    pending();
    timer = setTimeout(renderPreview, delay);
  }
  async function renderPreview() {
    if (rendering || !root.open) return;
    const turn = revision;
    rendering = true;
    try {
      const result = candidate();
      dirtyState();
      const signature = JSON.stringify(result.draft);
      const preview = await request("visual-preview", {
        definition: result.draft,
        selector: editor.context.selector,
        sceneIndex: editingScene,
        progress: Number(node("progress").value),
      });
      if (turn !== revision || !root.open) return;
      if (JSON.stringify(candidate().draft) !== signature)
        throw new Error("Your draft changed. Refresh the preview.");
      node("frame-image").src = preview.imageDataUrl;
      node("frame-image").hidden = false;
      node("frame-empty").hidden = true;
      node("frame-note").textContent =
        `${preview.note} Scrub to inspect motion; this is not a finished video.`;
      node("preview-status").textContent = "Preview up to date · no AI request";
      node("render-state").hidden = true;
    } catch (error) {
      if (turn !== revision) return;
      node("preview-status").textContent = error.message;
      node("render-state").textContent = "Preview needs attention";
      node("render-state").hidden = false;
    } finally {
      rendering = false;
      if (turn !== revision && root.open) {
        clearTimeout(timer);
        timer = setTimeout(renderPreview, 80);
      } else node("frame-preview").setAttribute("aria-busy", "false");
    }
  }
  async function loadImages() {
    const result = await request("visual-assets");
    assets = result.assets;
    assetsLoaded = true;
    imageChoices();
  }
  function activate() {
    if (!root.open) return;
    try {
      if (!panelSnapshot) refresh();
      queuePreview(0);
      if (!assetsLoaded)
        loadImages().catch((error) => {
          status.textContent = error.message;
        });
    } catch (error) {
      node("preview-status").textContent = error.message;
    }
  }
  root.addEventListener("toggle", () => {
    if (root.open) activate();
    else {
      revision++;
      clearTimeout(timer);
    }
  });
  if (typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) activate();
    }).observe(root);
  } else activate();
  root.addEventListener("input", (event) => {
    const id = event.target.id;
    if (!id?.startsWith("visual-") || id.startsWith("visual-upload-")) return;
    if (id === "visual-scene") return;
    status.textContent = "";
    if (id === "visual-image" && node("image").value) {
      node("image-alt").value =
        assets.find((asset) => asset.id === node("image").value)?.label ?? node("image-alt").value;
      if (node("image-treatment").value === "card") {
        node("layout").value = "automatic";
        status.textContent = "The framed image replaces the diagram in this preview.";
      }
    }
    if (
      id === "visual-image-treatment" &&
      node("image").value &&
      node("image-treatment").value === "card"
    ) {
      node("layout").value = "automatic";
      status.textContent = "The framed image replaces the diagram in this preview.";
    }
    if (
      id === "visual-layout" &&
      node("layout").value !== "automatic" &&
      node("image-treatment").value === "card" &&
      node("image").value
    ) {
      node("image").value = "";
      status.textContent = "The diagram replaces the framed image in this preview.";
    }
    if (id === "visual-progress") {
      node("progress-label").textContent = `${Math.round(Number(node("progress").value) * 100)}%`;
    } else {
      edited = true;
      collect();
      dirtyState();
    }
    queuePreview();
  });
  root.addEventListener("change", (event) => {
    if (event.target.id === "visual-scene") {
      collect();
      editingScene = Number(node("scene").value);
      sceneFields();
      queuePreview(0);
    }
  });
  for (const button of root.querySelectorAll("[data-visual-background]"))
    button.addEventListener("click", () => {
      status.textContent = "";
      edited = true;
      node("background").value = button.dataset.visualBackground;
      collect();
      dirtyState();
      queuePreview();
    });
  const tabs = Array.from(root.querySelectorAll("[data-visual-tab]"));
  function selectTab(button) {
    for (const tab of tabs) {
      const selected = tab === button;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      node(`panel-${tab.dataset.visualTab}`).hidden = !selected;
    }
  }
  for (const [index, button] of tabs.entries()) {
    button.addEventListener("click", () => selectTab(button));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const position =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[position]);
      tabs[position].focus();
    });
  }
  node("refresh").addEventListener("click", () => {
    try {
      refresh();
      status.textContent = "Preview settings reset to your draft.";
      queuePreview(0);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  node("preview").addEventListener("click", () => queuePreview(0));
  node("apply").addEventListener("click", () => {
    try {
      const result = candidate();
      applying = true;
      editor.applyDesign(result.draft.presentation.design, JSON.parse(panelSnapshot));
      refresh();
      status.textContent =
        "Applied to the draft. Save draft to keep a new version for the deck and MP4.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      applying = false;
    }
  });
  globalThis.addEventListener("shorts:design-applied", () => {
    if (applying || !panelSnapshot) return;
    try {
      refresh();
      if (root.open) queuePreview(0);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.getElementById("editor-fields").addEventListener("input", (event) => {
    if (!root.contains(event.target) && panelSnapshot && root.open) queuePreview();
  });
  node("assets-load").addEventListener("click", async () => {
    try {
      await loadImages();
      status.textContent = `${assets.length} local images available.`;
    } catch (error) {
      status.textContent = error.message;
    }
  });
  node("upload").addEventListener("click", async () => {
    if (uploadBusy) return;
    const file = node("upload-file").files?.[0];
    if (
      !file ||
      file.size > 8 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      status.textContent = "Select PNG, JPEG or WebP up to 8 MB.";
      return;
    }
    uploadBusy = true;
    node("upload").disabled = true;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Image could not be read."));
        reader.readAsDataURL(file);
      });
      const result = await request("visual-assets", {
        label: node("upload-label").value.trim() || file.name.slice(0, 80),
        credit: node("upload-credit").value.trim(),
        dataUrl,
      });
      assets = result.assets;
      assetsLoaded = true;
      imageChoices();
      status.textContent = `Saved “${result.asset.label}”. Select it in Image to preview; your draft has not changed.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      uploadBusy = false;
      node("upload").disabled = false;
    }
  });
})();
