(() => {
  const byId = (id) => document.getElementById(id);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const sheet = byId("new-short-dialog");
  if (!sheet || typeof sheet.showModal !== "function") return;
  let creating = false;
  let savedResult = false;
  const format = () => document.querySelector('input[name="new-format"]:checked')?.value;
  function fields() {
    if (savedResult) return;
    const story = document.querySelector('input[name="new-source"]:checked')?.value === "story";
    byId("new-story-field").hidden = !story;
    byId("new-url-field").hidden = story;
    byId("new-short-story").required = story;
    byId("new-short-url").required = !story;
    byId("new-short-story").disabled = !story;
    byId("new-short-url").disabled = story;
    const conversation = format() === "dialogue";
    byId("new-secondary-field").hidden = !conversation;
    byId("new-short-secondary").required = conversation;
    if (conversation && byId("new-short-secondary").value === byId("new-short-narrator").value) {
      const other = [...byId("new-short-secondary").options].find(
        (option) => option.value !== byId("new-short-narrator").value,
      );
      if (other) byId("new-short-secondary").value = other.value;
    }
    byId("new-short-length-label").textContent = `${byId("new-short-length").value}s`;
  }
  function open({ url, format: selectedFormat } = {}) {
    if (creating) return;
    if (savedResult) {
      if (!sheet.open) sheet.showModal();
      return;
    }
    if (url) {
      document.querySelector('input[name="new-source"][value="url"]').checked = true;
      byId("new-short-url").value = url;
    }
    if (selectedFormat) {
      const choice = [...document.querySelectorAll('input[name="new-format"]')].find(
        (item) => item.value === selectedFormat,
      );
      if (choice) choice.checked = true;
    }
    // Include the latest scan without another network request.
    const stories = byId("new-short-story");
    for (const card of document.querySelectorAll("#live-news-grid [data-url]")) {
      if ([...stories.options].some((option) => option.value === card.dataset.url)) continue;
      const option = make("option", "", card.querySelector(".story-title")?.textContent);
      option.value = card.dataset.url;
      stories.append(option);
    }
    fields();
    if (!sheet.open) sheet.showModal();
  }
  globalThis.shortsNewShort = { open };
  for (const button of document.querySelectorAll("[data-new-short], [data-new-short-format]")) {
    button.hidden = false;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open({ format: button.dataset.newShortFormat });
    });
  }
  byId("new-short-form").addEventListener("input", fields);
  byId("new-short-form").addEventListener("change", fields);
  for (const button of sheet.querySelectorAll("[data-close-sheet]"))
    button.addEventListener("click", () => {
      if (!creating) sheet.close();
    });
  for (const link of sheet.querySelectorAll("[data-sheet-link]"))
    link.addEventListener("click", () => sheet.close());
  sheet.addEventListener("cancel", (event) => {
    if (creating) event.preventDefault();
  });
  byId("new-short-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (creating || savedResult) return;
    const status = byId("new-short-status");
    const fromStory = document.querySelector('input[name="new-source"]:checked').value === "story";
    const url = fromStory ? byId("new-short-story").value : byId("new-short-url").value.trim();
    const delivery = {
      format: format(),
      tone: byId("new-short-tone").value,
      targetDurationSeconds: Number(byId("new-short-length").value),
      narrator: byId("new-short-narrator").value,
      ...(format() === "dialogue" ? { secondaryNarrator: byId("new-short-secondary").value } : {}),
    };
    if (!url || !delivery.narrator) {
      status.textContent = "Choose an official story and an installed stock narrator.";
      return;
    }
    if (delivery.format === "dialogue" && delivery.narrator === delivery.secondaryNarrator) {
      status.textContent = "Choose two distinct installed voices for the conversation.";
      byId("new-short-secondary").focus();
      return;
    }
    if (delivery.format === "dialogue" && delivery.narrator === "default") {
      status.textContent = "Choose two distinct installed voices for the conversation.";
      byId("new-short-narrator").focus();
      return;
    }
    creating = true;
    const controls = [...sheet.querySelectorAll("input, select, button")];
    const disabled = controls.map((control) => control.disabled);
    for (const control of controls) control.disabled = true;
    status.textContent = "Fetching complete source excerpts and saving your draft…";
    try {
      const response = await fetch("/api/news/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, promote: true, delivery }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create this draft.");
      if (data.libraryUpdated === false) {
        savedResult = true;
        const id = /^NEWS-\d{2}$/u.test(data.episode?.id) ? ` ${data.episode.id}` : "";
        status.textContent = `Draft${id} saved. The workspace could not refresh yet. Refresh My shorts to check for your saved draft; creating it again would make another short.`;
        byId("new-short-refresh").hidden = false;
        byId("new-short-submit").textContent = "Draft saved";
        return;
      }
      if (!/^NEWS-\d{2}$/u.test(data.episode?.id))
        throw new Error("Draft saved, but its editor link is unavailable. Refresh My shorts.");
      status.textContent = "Draft saved. Opening the script editor…";
      window.location.assign(`episodes/${encodeURIComponent(data.episode.id)}/edit.html`);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      creating = false;
      for (const [index, control] of controls.entries()) control.disabled = disabled[index];
      if (savedResult) {
        for (const control of sheet.querySelectorAll("input, select")) control.disabled = true;
        byId("new-short-submit").disabled = true;
      }
    }
  });
  fields();

  // Keep the existing recorder, transcript, trim, consent and local audition handlers mounted.
  const enrollment = byId("my-voice-enrollment");
  if (enrollment) {
    const summary = enrollment.querySelector("summary");
    const dialog = make("dialog", "workspace-sheet personal-voice-panel voice-style-sheet");
    dialog.setAttribute("aria-labelledby", "voice-style-sheet-title");
    const header = make("header", "sheet-header");
    const heading = make("h2", "", "Add a voice style · Record a passage");
    heading.id = "voice-style-sheet-title";
    const close = make("button", "sheet-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close Add a voice style");
    header.append(heading, close);
    const body = make("div", "sheet-body");
    for (const node of [...enrollment.children]) if (node !== summary) body.append(node);
    const help = make(
      "p",
      "sheet-help",
      "Step 1: record or upload. Step 2: review the exact transcript and consent before saving. Generate and listen to a local audition in the voice library before making it available.",
    );
    dialog.append(header, help, body);
    // Keep live feedback next to recording controls while the sheet is open.
    const feedback = make("p", "sheet-help");
    feedback.setAttribute("role", "status");
    dialog.append(feedback);
    document.body.append(dialog);
    const status = byId("my-voice-status");
    new MutationObserver(() => {
      feedback.textContent = status.textContent;
    }).observe(status, { childList: true, characterData: true, subtree: true });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      enrollment.open = false;
      dialog.showModal();
    });
    const stop = () => {
      for (const audio of dialog.querySelectorAll("audio")) audio.pause();
      window.dispatchEvent(new Event("shorts:voice-panel-hidden"));
    };
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", stop);
    window.addEventListener("shorts:voice-panel-hidden", () => {
      if (dialog.open) dialog.close();
    });
    document.addEventListener("shorts:voice-style-saved", () => dialog.close());
    const step = () => {
      heading.textContent = byId("my-voice-review-pane").hidden
        ? "Add a voice style · 1 of 2 · Record"
        : "Add a voice style · 2 of 2 · Review & consent";
    };
    new MutationObserver(step).observe(byId("my-voice-review-pane"), {
      attributes: true,
      attributeFilter: ["hidden"],
    });
    step();

    const saved = document.querySelector(".saved-personal-voices");
    const cards = make("div", "personal-voice-cards");
    cards.setAttribute("aria-label", "Personal voice recordings");
    byId("my-voice-count").after(cards);
    function renderCards() {
      cards.replaceChildren();
      const keys = new Set([...byId("my-voice-saved").options].map((option) => option.value));
      for (const profile of globalThis.shortsVoiceProfiles?.profiles() ?? []) {
        const value = `qwen:${profile.voice.profileId}:${profile.voice.revision}`;
        if (!keys.has(value)) continue;
        const card = make("article", "personal-voice-card");
        const title = make("h4", "", profile.name);
        const state = make(
          "p",
          "voice-help",
          profile.accepted
            ? "Ready for episodes"
            : profile.auditionReady
              ? "Audition ready · needs your listen"
              : "Sample saved · generate an audition",
        );
        const audio = make("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = `/api/local-voices/audio?voice=${encodeURIComponent(JSON.stringify(profile.voice))}&kind=${profile.auditionReady ? "audition" : "reference"}`;
        audio.setAttribute(
          "aria-label",
          `${profile.name} ${profile.auditionReady ? "audition" : "original recording"}`,
        );
        const select = make("button", "secondary-action", "Review recording");
        select.type = "button";
        select.addEventListener("click", () => {
          globalThis.shortsVoiceProfiles.select(value);
          byId(profile.auditionReady ? "my-voice-audition" : "my-voice-reference").focus();
        });
        card.append(title, state, audio, select);
        cards.append(card);
      }
      if (!cards.children.length)
        cards.append(
          make("p", "voice-help", "No recordings match. Add a voice style or clear your filters."),
        );
    }
    document.addEventListener("shorts:voices-ready", renderCards);
    for (const id of ["my-voice-query", "my-voice-filter"])
      byId(id).addEventListener(id.endsWith("query") ? "input" : "change", renderCards);
    saved.classList.add("has-voice-cards");
    renderCards();
  }

  const data = byId("presenter-workspace-data");
  if (!data) return;
  const { uses, editor } = JSON.parse(data.textContent);
  const gallery = byId("presenter-gallery");
  const galleryStatus = byId("presenter-status");
  const labels = new Map();
  function renderPresenters(ids) {
    gallery.replaceChildren();
    let uploads = 0;
    for (const imageId of ids) {
      if (!/^[a-z0-9][a-z0-9_-]{0,47}\.(png|jpg|jpeg|webp)$/u.test(imageId)) continue;
      const base = imageId.replace(/\.[a-z0-9]+$/iu, "");
      const label =
        labels.get(imageId) ||
        (/^(?:portrait-)?(?:[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{12,}$)/iu.test(base)
          ? `Uploaded photo ${++uploads}`
          : base.replace(/[-_]+/gu, " ").replace(/^./u, (letter) => letter.toUpperCase()));
      const references = uses.filter((use) => use.imageId === imageId);
      const use = references.find((item) => item.aligned) ?? references[0];
      const card = make("article", "presenter-card");
      const image = make("img");
      image.src = `/api/avatars/${encodeURIComponent(imageId)}`;
      image.alt = label;
      image.loading = "lazy";
      const state = make(
        "p",
        "voice-help",
        use?.aligned ? "Alignment saved in a script" : "Needs alignment in a script",
      );
      const title = make("h3", "", label);
      card.append(image, title, state);
      if (use || editor) {
        const link = make(
          "a",
          "secondary-action",
          use?.aligned ? "Check & preview in editor" : "Align in editor",
        );
        link.href = use?.href ?? editor;
        if (use) link.title = `${use.speaker} · ${use.title}`;
        card.append(link);
      } else
        card.append(
          make("p", "voice-help", "Create a short, then select this photo in its editor."),
        );
      gallery.append(card);
    }
  }
  let portraitIds = [];
  fetch("/api/avatars")
    .then(async (response) => {
      if (!response.ok) throw new Error("Connect to the local studio to see your saved photos.");
      const result = await response.json();
      portraitIds = Array.isArray(result.avatars) ? result.avatars : [];
      renderPresenters(portraitIds);
      galleryStatus.textContent = portraitIds.length
        ? "Recheck alignment in the editor after changing a photo."
        : "No saved photos yet. Upload a front-facing photo, then align it in a script editor.";
      document.querySelector(".presenter-upload").hidden = false;
    })
    .catch((error) => {
      galleryStatus.textContent = error.message;
    });
  byId("presenter-upload").addEventListener("change", async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    galleryStatus.textContent = "Saving your photo on this Mac…";
    try {
      if (!/^image\/(png|jpeg|webp)$/u.test(file.type) || file.size > 4 * 1024 * 1024)
        throw new Error("Choose a PNG, JPEG or WebP photo up to 4 MiB.");
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read this photo."));
        reader.readAsDataURL(file);
      });
      // A fresh name prevents an upload from replacing an existing personal photo.
      const name = `portrait-${crypto.randomUUID()}`;
      const response = await fetch("/api/avatars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, dataUrl }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this photo.");
      labels.set(result.imageId, file.name.replace(/\.[^.]+$/u, ""));
      portraitIds = [...portraitIds, result.imageId];
      renderPresenters(portraitIds);
      galleryStatus.textContent =
        "Photo saved. Select it in a script editor to align the mouth and preview motion.";
    } catch (error) {
      galleryStatus.textContent = error.message;
    } finally {
      input.disabled = false;
      input.value = "";
    }
  });
})();
