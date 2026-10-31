(() => {
  const root = document.querySelector(".advanced-visual-controls");
  const editor = globalThis.shortsWritingEditor;
  if (!root || !editor) return;
  const data = JSON.parse(document.getElementById("editor-data").textContent);
  const node = (name) => document.getElementById(`visual-${name}`);
  const status = node("status");
  let assets = [];
  let panelSnapshot = "";
  let busy = false;
  function snapshot() {
    return editor.snapshot();
  }
  function designFor(current) {
    return current.design
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
  }
  function sceneIndex() {
    return Number(node("scene").value || 0);
  }
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
      option.textContent = `${asset.label} · ${asset.width} × ${asset.height}`;
      node("image").append(option);
    }
    if (selected && !assets.some((asset) => asset.id === selected)) {
      const missing = document.createElement("option");
      missing.value = selected;
      missing.textContent = "Saved image reference · load library to verify";
      node("image").append(missing);
    }
    node("image").value = selected;
  }
  function sceneFields() {
    const current = snapshot();
    const index = sceneIndex();
    const scene = designFor(current).scenes[index];
    if (!scene) return;
    const explanation = data.compositionSceneIds.includes(scene.id);
    const output = data.visualOutputSceneIds.includes(scene.id);
    node("layout").disabled = !explanation;
    const framedOption = Array.from(node("image-treatment").options).find(
      (option) => option.value === "card",
    );
    if (framedOption) framedOption.disabled = !explanation;
    node("layout").title = explanation
      ? "Choose an explanatory layout"
      : "Source and code scenes keep their evidence; use a background image instead.";
    node("labels").disabled = !explanation;
    node("layout").value = scene.composition?.kind ?? "automatic";
    node("labels").value = scene.composition?.items.map((item) => item.label).join("\n") ?? "";
    node("data-view").disabled = !output;
    node("data-view").value = scene.dataView ?? "rows";
    imageChoices(scene.image?.assetId ?? "");
    node("image-treatment").value = scene.image?.treatment ?? (explanation ? "card" : "background");
    node("image-fit").value = scene.image?.fit ?? "contain";
    node("image-x").value = String(scene.image?.focalX ?? 0.5);
    node("image-y").value = String(scene.image?.focalY ?? 0.5);
    node("image-alt").value = scene.image?.alt ?? "";
    node("image-caption").value = scene.image?.caption ?? "";
  }
  function refresh() {
    const current = snapshot();
    const design = designFor(current);
    node("theme").value = design.theme;
    node("background").value = design.background ?? "classic";
    node("motion").value = design.motion;
    node("effect").value = design.effect ?? "none";
    panelSnapshot = JSON.stringify(current);
    sceneFields();
  }
  document.getElementById("editor-fields").addEventListener("input", () => {
    node("frame-preview").hidden = true;
  });
  globalThis.addEventListener("shorts:design-applied", () => {
    node("frame-preview").hidden = true;
    if (root.open) {
      try {
        refresh();
      } catch {
        /* The editor reports invalid fields. */
      }
    }
  });
  root.addEventListener("toggle", () => {
    if (root.open) {
      try {
        refresh();
      } catch (error) {
        status.textContent = error.message;
      }
    }
  });
  node("refresh").addEventListener("click", () => {
    try {
      refresh();
      status.textContent = "Controls refreshed from the current draft.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  node("scene").addEventListener("change", () => {
    node("frame-preview").hidden = true;
    try {
      sceneFields();
    } catch (error) {
      status.textContent = error.message;
    }
  });
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
  node("assets-load").addEventListener("click", async () => {
    try {
      const result = await request("visual-assets");
      assets = result.assets;
      imageChoices();
      status.textContent = `${assets.length} local images available.`;
    } catch (error) {
      status.textContent = error.message;
    }
  });
  node("upload").addEventListener("click", async () => {
    if (busy) return;
    const file = node("upload-file").files?.[0];
    if (
      !file ||
      file.size > 8 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      status.textContent = "Select PNG, JPEG or WebP up to 8 MB.";
      return;
    }
    busy = true;
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
      imageChoices();
      status.textContent = `Saved “${result.asset.label}” locally. Select it and apply to a scene; uploading does not change the draft.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      node("upload").disabled = false;
    }
  });
  function apply() {
    const before = snapshot();
    if (JSON.stringify(before) !== panelSnapshot)
      throw new Error(
        "The draft changed while these controls were open. Reload controls before applying.",
      );
    const design = designFor(before);
    const scene = design.scenes[sceneIndex()];
    design.theme = node("theme").value;
    design.motion = node("motion").value;
    design.background = node("background").value;
    design.effect = node("effect").value;
    if (!scene) throw new Error("Choose a scene.");
    if (data.compositionSceneIds.includes(scene.id)) {
      const kind = node("layout").value;
      if (kind === "automatic") delete scene.composition;
      else {
        const labels = node("labels")
          .value.split(/\n/u)
          .map((label) => label.trim())
          .filter(Boolean);
        const existing = scene.composition?.items ?? [];
        scene.composition = {
          kind,
          items: labels.map((label, index) => ({
            label,
            ...(existing[index]?.label === label && existing[index]?.claimId
              ? { claimId: existing[index].claimId }
              : {}),
          })),
        };
      }
    }
    if (data.visualOutputSceneIds.includes(scene.id)) scene.dataView = node("data-view").value;
    const selected = node("image").value;
    if (!selected) delete scene.image;
    else {
      if (!assets.some((asset) => asset.id === selected))
        throw new Error("Load the image library and choose an available image.");
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
    }
    editor.applyDesign(design, before);
    refresh();
    const result = editor.validate();
    if (!result || result.errors.length)
      throw new Error(result?.errors.join(" ") || "Finish draft recovery first.");
    return result;
  }
  node("apply").addEventListener("click", () => {
    try {
      apply();
      status.textContent =
        "Visuals applied to this draft. Save a version for the interactive deck and next MP4.";
      node("frame-preview").hidden = true;
    } catch (error) {
      status.textContent = error.message;
    }
  });
  node("preview").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    node("preview").disabled = true;
    try {
      const result = apply();
      const signature = JSON.stringify(result.draft);
      const index = sceneIndex();
      status.textContent = "Drawing a representative frame locally…";
      const preview = await request("visual-preview", {
        definition: result.draft,
        selector: editor.context.selector,
        sceneIndex: index,
        progress: 0.5,
      });
      if (JSON.stringify(editor.validate()?.draft) !== signature || sceneIndex() !== index)
        throw new Error("The draft changed. Preview the current scene again.");
      node("frame-image").src = preview.imageDataUrl;
      node("frame-note").textContent = preview.note;
      node("frame-preview").hidden = false;
      status.textContent =
        "Preview ready. These visual settings are in the editable draft; save a version when ready.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      node("preview").disabled = false;
    }
  });
})();
