(() => {
  const { seed, scenes, reservedNames, availableVoices, recoveryId, pronunciation } = JSON.parse(
    document.getElementById("editor-data").textContent,
  );
  let activePronunciation = { ...(pronunciation || seed.pronunciation || {}) };
  const startingPronunciation = structuredClone(activePronunciation);
  let renderGlossaryUi = null;
  const byId = (id) => document.getElementById(id);
  const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
  const download = byId("download-script");
  const status = byId("download-status");
  let reviewedDraft = "";
  const recoveryLimit = 128 * 1024;
  const fieldIds = ["variant-name", "draft-title", "publication-text"];
  for (const [index] of seed.presentation.speakers.entries())
    fieldIds.push(`speaker-voice-${index}`);
  for (const [index, scene] of seed.scenes.entries()) {
    fieldIds.push(`overlay-${index}`);
    if (scene.dialogue)
      for (const [position] of scene.dialogue.entries()) fieldIds.push(`turn-${index}-${position}`);
    else fieldIds.push(`narration-${index}`);
  }
  const rawFields = () => Object.fromEntries(fieldIds.map((id) => [id, byId(id).value]));
  const startingFields = rawFields();
  const startingSignature = JSON.stringify(startingFields);
  let storage;
  let recoveryKey;
  let pendingRecovery = null;
  let lastSavedFields = startingSignature;
  let hasSavedDraft = false;
  const recoveryMessage = (message) => {
    byId("draft-recovery").hidden = false;
    if (byId("draft-recovery-message").textContent !== message)
      byId("draft-recovery-message").textContent = message;
  };
  const unavailable = () => {
    storage = undefined;
    recoveryMessage(
      "Browser draft recovery is unavailable. You can still edit and download your script; unsaved edits may be lost on reload.",
    );
  };
  const fitsRecovery = (text) =>
    text.length <= recoveryLimit && new TextEncoder().encode(text).byteLength <= recoveryLimit;
  function validFields(fields) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return false;
    if (Object.keys(fields).length !== fieldIds.length) return false;
    if (fieldIds.some((id) => !Object.hasOwn(fields, id) || typeof fields[id] !== "string"))
      return false;
    return seed.presentation.speakers.every((speaker, index) => {
      const voice = fields[`speaker-voice-${index}`];
      return voice === speaker.voice || availableVoices.includes(voice);
    });
  }
  function clearSavedDraft() {
    if (!hasSavedDraft) return;
    storage.removeItem(recoveryKey);
    hasSavedDraft = false;
  }
  function saveRecovery() {
    if (!storage || pendingRecovery) return;
    const fields = rawFields();
    const signature = JSON.stringify(fields);
    if (signature === lastSavedFields) return;
    lastSavedFields = signature;
    try {
      if (signature === startingSignature) {
        clearSavedDraft();
        recoveryMessage(
          "Starting script restored. Download a revised script to keep a portable copy.",
        );
        return;
      }
      const record = JSON.stringify({ schemaVersion: 1, recoveryId, fields });
      if (!fitsRecovery(record) || !validFields(fields)) {
        clearSavedDraft();
        recoveryMessage(
          "This draft cannot be kept for browser recovery. Your edits remain here; correct the draft and download it to keep a copy.",
        );
        return;
      }
      storage.setItem(recoveryKey, record);
      hasSavedDraft = true;
      recoveryMessage(
        "Unsaved draft kept in this tab at this address. Download your script for a portable copy; closing the tab may discard browser recovery.",
      );
    } catch {
      unavailable();
    }
  }
  function prepareRecovery() {
    try {
      if (!/^[a-f0-9]{64}$/u.test(recoveryId ?? "")) throw new Error("Missing recovery identity");
      recoveryKey = `sap-shorts:script-draft:${JSON.stringify([location.origin, location.pathname, recoveryId])}`;
      storage = sessionStorage;
      if (
        !storage ||
        ["getItem", "setItem", "removeItem"].some((name) => typeof storage[name] !== "function")
      )
        throw new Error("Unavailable browser storage");
      const saved = storage.getItem(recoveryKey);
      if (saved === null) return;
      hasSavedDraft = true;
      let record;
      try {
        if (typeof saved !== "string" || !fitsRecovery(saved)) throw new Error("Oversized draft");
        record = JSON.parse(saved);
        if (
          !record ||
          typeof record !== "object" ||
          Array.isArray(record) ||
          Object.keys(record).length !== 3 ||
          record.schemaVersion !== 1 ||
          record.recoveryId !== recoveryId ||
          !validFields(record.fields)
        )
          throw new Error("Incompatible draft");
      } catch {
        clearSavedDraft();
        recoveryMessage(
          "An incompatible or damaged browser draft was ignored. The starting script is ready to edit.",
        );
        return;
      }
      record.fields = Object.fromEntries(fieldIds.map((id) => [id, record.fields[id]]));
      if (JSON.stringify(record.fields) === startingSignature) {
        clearSavedDraft();
        return;
      }
      pendingRecovery = record.fields;
      byId("resume-draft").hidden = false;
      byId("discard-draft").hidden = false;
      recoveryMessage(
        "An unsaved draft from this tab matches this starting script. Resume it, or start with the original. Editing and downloading wait for your choice.",
      );
    } catch {
      unavailable();
    }
  }
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function reviewChanges(draft) {
    const signature = JSON.stringify(draft);
    if (signature === reviewedDraft) return;
    const items = [];
    const section = (title, fields, restoreLabel, restore, focusId) => {
      const changed = fields.filter((field) => field.changed ?? field.before !== field.after);
      if (!changed.length) return;
      const item = element("section", "change-item");
      item.append(element("h3", "", title));
      for (const field of changed) {
        item.append(element("p", "change-label", field.label));
        const values = element("div", "change-values");
        for (const [label, text] of [
          ["Original", field.before],
          ["Revised", field.after],
        ]) {
          const value = element("div", "change-value");
          value.append(
            element("span", "change-label", text ? label : `${label} (empty)`),
            element("pre", "", text),
          );
          values.append(value);
        }
        item.append(values);
      }
      const button = element("button", "restore-change", restoreLabel);
      button.type = "button";
      button.addEventListener("click", () => {
        restore();
        update();
        byId(focusId).focus();
      });
      item.append(button);
      items.push(item);
    };
    section(
      "Title",
      [{ label: "Short title", before: seed.title.trim(), after: draft.title }],
      "Restore title",
      () => {
        byId("draft-title").value = seed.title;
      },
      "draft-title",
    );
    const voiceLabel = (index, voice) =>
      Array.from(byId(`speaker-voice-${index}`).options).find((option) => option.value === voice)
        ?.textContent ?? voice;
    section(
      "Voices",
      draft.presentation.speakers.map((speaker, index) => ({
        label: `${speaker.name} voice`,
        before: voiceLabel(index, seed.presentation.speakers[index].voice),
        after: voiceLabel(index, speaker.voice),
        changed: seed.presentation.speakers[index].voice !== speaker.voice,
      })),
      "Restore starting voices",
      () => {
        for (const [index, speaker] of seed.presentation.speakers.entries())
          byId(`speaker-voice-${index}`).value = speaker.voice;
      },
      "speaker-voice-0",
    );
    const formatAvatar = (avatar) =>
      avatar?.mode === "photo"
        ? `Photo (${avatar.imageId || "none"} · mouth ${Math.round((avatar.mouthX ?? 0.5) * 100)}%, ${Math.round((avatar.mouthY ?? 0.68) * 100)}%, scale ${Math.round((avatar.mouthScale ?? 1) * 100)}%)`
        : "3D Illustrated Character";
    section(
      "Avatars",
      draft.presentation.speakers.map((speaker, index) => {
        const beforeAvatar = seed.presentation.speakers[index].avatar;
        const afterAvatar = speaker.avatar;
        return {
          label: `${speaker.name} avatar`,
          before: formatAvatar(beforeAvatar),
          after: formatAvatar(afterAvatar),
          changed:
            JSON.stringify(beforeAvatar ?? { mode: "illustrated" }) !==
            JSON.stringify(afterAvatar ?? { mode: "illustrated" }),
        };
      }),
      "Restore starting avatars",
      () => {
        for (const [index, speaker] of seed.presentation.speakers.entries()) {
          byId(`speaker-avatar-mode-${index}`).value = speaker.avatar?.mode ?? "illustrated";
          byId(`speaker-avatar-image-${index}`).value = speaker.avatar?.imageId ?? "";
          byId(`speaker-avatar-mouth-y-${index}`).value = String(speaker.avatar?.mouthY ?? 0.68);
          byId(`speaker-avatar-mouth-x-${index}`).value = String(speaker.avatar?.mouthX ?? 0.5);
          byId(`speaker-avatar-mouth-scale-${index}`).value = String(
            speaker.avatar?.mouthScale ?? 1,
          );
        }
      },
      "speaker-avatar-mode-0",
    );
    for (const [index, scene] of draft.scenes.entries()) {
      const original = seed.scenes[index];
      const fields = [
        { label: "On-screen headline", before: original.overlay.trim(), after: scene.overlay },
      ];
      if (scene.dialogue) {
        for (const [position, turn] of scene.dialogue.entries()) {
          const name =
            seed.presentation.speakers.find((speaker) => speaker.id === turn.speakerId)?.name ??
            turn.speakerId;
          fields.push({
            label: `${name} · turn ${position + 1}`,
            before: original.dialogue[position].text.trim(),
            after: turn.text,
          });
        }
      } else
        fields.push({
          label: "Narration",
          before: original.narration.trim(),
          after: scene.narration,
        });
      section(
        `Scene ${index + 1} · ${scene.id}`,
        fields,
        `Restore scene ${index + 1}`,
        () => {
          byId(`overlay-${index}`).value = original.overlay;
          if (original.dialogue) {
            for (const [position, turn] of original.dialogue.entries())
              byId(`turn-${index}-${position}`).value = turn.text;
          } else byId(`narration-${index}`).value = original.narration;
        },
        original.dialogue ? `turn-${index}-0` : `narration-${index}`,
      );
    }
    section(
      "Companion post",
      [
        {
          label: "Companion post draft",
          before: (seed.publicationText ?? "").trim(),
          after: draft.publicationText,
        },
      ],
      "Restore post",
      () => {
        byId("publication-text").value = seed.publicationText ?? "";
      },
      "publication-text",
    );
    const pronunciationChanges = [];
    const allTerms = Array.from(
      new Set([...Object.keys(startingPronunciation), ...Object.keys(activePronunciation)]),
    ).sort();
    for (const term of allTerms) {
      const before = startingPronunciation[term];
      const after = activePronunciation[term];
      if (before !== after) {
        pronunciationChanges.push({
          label: `Term: ${term}`,
          before: before ? `"${before}"` : "(none)",
          after: after ? `"${after}"` : "(removed)",
        });
      }
    }
    if (pronunciationChanges.length) {
      section(
        "Pronunciation glossary",
        pronunciationChanges,
        "Restore pronunciations",
        () => {
          activePronunciation = structuredClone(startingPronunciation);
          if (typeof renderGlossaryUi === "function") renderGlossaryUi();
          update();
        },
        "variant-name",
      );
    }
    byId("review-changes-list").replaceChildren(...items);
    const summary = items.length ? `Review changes (${items.length})` : "Review changes";
    const count = items.length
      ? `${items.length} edited ${items.length === 1 ? "section" : "sections"}. Compare the wording and voices before downloading.`
      : "No wording or voice changes from the starting script. Your new version name is kept separately.";
    if (byId("review-changes-summary").textContent !== summary)
      byId("review-changes-summary").textContent = summary;
    if (byId("review-changes-count").textContent !== count)
      byId("review-changes-count").textContent = count;
    reviewedDraft = signature;
  }
  function readDraft() {
    const draft = structuredClone(seed);
    draft.presentation.variant = byId("variant-name").value.trim();
    draft.title = byId("draft-title").value.trim();
    draft.publicationText = byId("publication-text").value.trim();
    const errors = [];
    for (const [index, speaker] of draft.presentation.speakers.entries()) {
      const original = seed.presentation.speakers[index].voice;
      const selected = byId(`speaker-voice-${index}`).value;
      if (selected !== original && !availableVoices.includes(selected))
        errors.push(`Choose an available voice for ${speaker.name}.`);
      speaker.voice = selected;
      byId(`speaker-voice-${index}-help`).textContent = availableVoices.includes(selected)
        ? "Local voice assets checked when this studio was built. Production checks them again."
        : `Original voice retained. Before production, run npm run shorts -- voice-setup ${original}, then rebuild the studio.`;
      const avatarMode = byId(`speaker-avatar-mode-${index}`).value;
      const photoPanel = byId(`speaker-avatar-photo-panel-${index}`);
      photoPanel.hidden = avatarMode !== "photo";
      if (avatarMode === "photo") {
        const imageId = byId(`speaker-avatar-image-${index}`).value.trim();
        const mouthY = Number.parseFloat(byId(`speaker-avatar-mouth-y-${index}`).value);
        const mouthX = Number.parseFloat(byId(`speaker-avatar-mouth-x-${index}`).value);
        const mouthScale = Number.parseFloat(byId(`speaker-avatar-mouth-scale-${index}`).value);
        byId(`speaker-avatar-mouth-y-val-${index}`).textContent = `${Math.round(mouthY * 100)}%`;
        byId(`speaker-avatar-mouth-x-val-${index}`).textContent = `${Math.round(mouthX * 100)}%`;
        byId(`speaker-avatar-mouth-scale-val-${index}`).textContent =
          `${Math.round(mouthScale * 100)}%`;
        if (!imageId || !/^[a-z0-9][a-z0-9._-]{0,63}\.(?:png|jpg|jpeg|webp)$/iu.test(imageId)) {
          errors.push(`Choose or upload a photo avatar for ${speaker.name}.`);
        }
        speaker.avatar = {
          mode: "photo",
          imageId,
          mouthX: Number.isFinite(mouthX) ? Number(mouthX.toFixed(2)) : 0.5,
          mouthY: Number.isFinite(mouthY) ? Number(mouthY.toFixed(2)) : 0.68,
          mouthScale: Number.isFinite(mouthScale) ? Number(mouthScale.toFixed(2)) : 1,
        };
      } else if (seed.presentation.speakers[index].avatar) {
        speaker.avatar = { mode: "illustrated" };
      } else {
        delete speaker.avatar;
      }
    }
    if (
      draft.presentation.speakers.length > 1 &&
      new Set(draft.presentation.speakers.map((speaker) => speaker.voice)).size !==
        draft.presentation.speakers.length
    )
      errors.push("Choose a different voice for each person in the conversation.");
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(draft.presentation.variant))
      errors.push("Choose a version name using lowercase letters, numbers, and hyphens.");
    if (reservedNames.includes(draft.presentation.variant))
      errors.push("That version already exists. Choose a new name.");
    if (!draft.title || draft.title.length > 60) errors.push("Use a title of 1–60 characters.");
    if (!draft.publicationText || draft.publicationText.length > 3000)
      errors.push("Use a companion post of 1–3,000 characters.");
    let total = 0;
    for (const [index, scene] of draft.scenes.entries()) {
      scene.overlay = byId(`overlay-${index}`).value.trim();
      if (scene.dialogue) {
        scene.dialogue = scene.dialogue.map((turn, position) => ({
          ...turn,
          text: byId(`turn-${index}-${position}`).value.trim(),
        }));
        scene.narration = scene.dialogue.map((turn) => turn.text).join(" ");
      } else scene.narration = byId(`narration-${index}`).value.trim();
      const count = words(scene.narration);
      const seconds = scenes[index].endSeconds - scenes[index].startSeconds;
      total += count;
      byId(`scene-${index}-count`).textContent = `${count} spoken words · ${seconds}s planned`;
      const problems = [];
      if (!scene.overlay || scene.overlay.length > 48)
        problems.push("Use a headline of 1–48 characters.");
      if (!scene.narration || scene.dialogue?.some((turn) => !turn.text))
        problems.push("Every narration or speaker turn needs text.");
      if (index === 0 && count > 7) problems.push("Keep the opening to seven words or fewer.");
      if (count > seconds * 3)
        problems.push(
          "Shorten this scene to stay within the draft pacing limit of 180 words per minute.",
        );
      const warning = byId(`scene-${index}-warning`);
      warning.textContent = problems.join(" ");
      warning.hidden = !problems.length;
      if (problems.length) errors.push(`Scene ${index + 1}: ${problems.join(" ")}`);
    }
    for (const [term, spoken] of Object.entries(activePronunciation)) {
      if (
        !term.trim() ||
        term.length > 80 ||
        !spoken.trim() ||
        spoken.length > 160 ||
        /[[\]<>\r\n]/u.test(term + spoken)
      ) {
        errors.push(`Pronunciation term "${term}" must be plain text without brackets.`);
      }
    }
    if (JSON.stringify(activePronunciation) !== JSON.stringify(startingPronunciation)) {
      draft.pronunciation = structuredClone(activePronunciation);
    } else if (seed.pronunciation) {
      draft.pronunciation = structuredClone(seed.pronunciation);
    }
    byId("draft-count").textContent =
      `${total} spoken words · ${scenes.at(-1).endSeconds}s planned · not yet recorded`;
    byId("draft-errors").textContent = errors.length
      ? errors.join(" ")
      : "Ready to download for import and validation.";
    byId("produce-command").textContent =
      `npm run shorts -- produce ${draft.baseEpisodeId}@${draft.presentation.variant} --serve`;
    download.disabled = !!errors.length;
    reviewChanges(draft);
    saveRecovery();
    return { draft, errors };
  }
  const update = () => {
    if (pendingRecovery) return;
    status.textContent = "";
    readDraft();
  };
  byId("editor-fields").addEventListener("input", update);
  byId("editor-fields").addEventListener("change", update);
  download.addEventListener("click", () => {
    if (pendingRecovery) return;
    const { draft, errors } = readDraft();
    if (errors.length) return;
    const filename = `${draft.baseEpisodeId}--${draft.presentation.variant}.json`;
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(draft, null, 2)}\n`], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Downloaded ${filename}. Import this file before producing the new version.`;
  });

  const produceBtn = byId("produce-script");
  const progressBox = byId("produce-progress-box");
  const progressBar = byId("produce-progress-bar");
  const progressText = byId("produce-progress-text");
  const produceResult = byId("produce-result");

  function setProduceProgress(stage, message) {
    if (progressText) progressText.textContent = `${stage}: ${message || ""}`;
    const stagePercent = {
      PREFLIGHT: "20%",
      NARRATION: "50%",
      RENDER: "80%",
      LIBRARY: "95%",
      READY: "100%",
    };
    if (progressBar && stagePercent[stage]) {
      progressBar.style.width = stagePercent[stage];
    }
  }

  if (produceBtn) {
    produceBtn.addEventListener("click", async () => {
      if (pendingRecovery) return;
      const { draft, errors } = readDraft();
      if (errors.length) return;
      const selector = `${draft.baseEpisodeId}@${draft.presentation.variant}`;
      produceBtn.disabled = true;
      download.disabled = true;
      if (progressBox) progressBox.hidden = false;
      if (produceResult) produceResult.hidden = true;
      setProduceProgress("PREFLIGHT", "Saving revised script and starting production...");

      try {
        const response = await fetch("/api/produce", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ definition: draft }),
        });
        if (response.status === 409) {
          const data = await response.json();
          alert(
            data.jobId
              ? `Another production job is running (${data.selector} · ${data.stage}). Please wait.`
              : data.error || "Choose a new version name before producing this script.",
          );
          produceBtn.disabled = false;
          download.disabled = false;
          if (progressBox) progressBox.hidden = true;
          return;
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Server returned ${response.status}`);
        }
        const data = await response.json();
        const sse = new EventSource(`/api/productions/${encodeURIComponent(data.jobId)}/stream`);
        sse.addEventListener("status", (e) => {
          try {
            const p = JSON.parse(e.data);
            setProduceProgress(p.stage, p.message);
          } catch {}
        });
        sse.addEventListener("progress", (e) => {
          try {
            const p = JSON.parse(e.data);
            setProduceProgress(p.stage, p.message);
          } catch {}
        });
        sse.addEventListener("complete", () => {
          sse.close();
          setProduceProgress("READY", "Production complete!");
          produceBtn.disabled = false;
          download.disabled = false;
          if (produceResult) {
            produceResult.hidden = false;
            const strong = element("strong", "", "Production Succeeded!");
            const p = element("p");
            const watchLink = element("a", "watch-now-btn", "Watch MP4 ↗");
            watchLink.href = `../../episodes/${encodeURIComponent(selector)}/video/review.html`;
            const studioLink = element("a", "", "View in Studio ↗");
            studioLink.href = `../../review.html#${encodeURIComponent(`compare-${selector.replace("@", "--")}`)}`;
            p.append(watchLink, element("span", "", " "), studioLink);
            produceResult.replaceChildren(strong, p);
          }
        });
        sse.addEventListener("error", () => {
          sse.close();
          setProduceProgress("FAILED", "Production failed. Check server logs for details.");
          produceBtn.disabled = false;
          download.disabled = false;
        });
      } catch (error) {
        setProduceProgress("FAILED", error.message);
        produceBtn.disabled = false;
        download.disabled = false;
      }
    });
  }

  function setupAuditioning() {
    if (typeof document.querySelectorAll !== "function") return;

    async function runAudition(text, speakerIndex, statusEl, audioEl, btnEl) {
      if (!text?.trim()) {
        if (statusEl) {
          statusEl.className = "audition-status error";
          statusEl.textContent = "Please enter text to audition.";
        }
        return;
      }
      const voiceSelect = byId(`speaker-voice-${speakerIndex}`) || byId("speaker-voice-0");
      const voice = voiceSelect ? voiceSelect.value : availableVoices[0] || "af_heart";
      if (btnEl) btnEl.disabled = true;
      if (statusEl) {
        statusEl.className = "audition-status loading";
        statusEl.textContent = "Synthesizing...";
      }
      try {
        const res = await fetch("/api/audition", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            voice,
            speed: 0.96,
            pronunciation: activePronunciation,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Audition failed" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const spoken = decodeURIComponent(res.headers.get("x-spoken-text") || "");
        const dur = res.headers.get("x-duration-seconds") || "";
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioEl) {
          audioEl.src = url;
          audioEl.hidden = false;
          audioEl.play().catch(() => {});
        }
        if (statusEl) {
          statusEl.className = "audition-status success";
          statusEl.textContent = `✓ ${dur}s · "${spoken}"`;
        }
      } catch (err) {
        if (statusEl) {
          statusEl.className = "audition-status error";
          statusEl.textContent = `Error: ${err.message}`;
        }
      } finally {
        if (btnEl) btnEl.disabled = false;
      }
    }

    const auditionBtns = document.querySelectorAll(".audition-btn");
    auditionBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        const speakerIndex = Number.parseInt(btn.getAttribute("data-speaker-index") || "0", 10);
        const input = byId(targetId);
        const statusEl = byId(`audition-status-${targetId}`);
        const audioEl = byId(`audio-${targetId}`);
        runAudition(input ? input.value : "", speakerIndex, statusEl, audioEl, btn);
      });
    });

    function setupGlossary() {
      const listEl = byId("glossary-list");
      const countEl = byId("glossary-count");
      if (!listEl) return;

      renderGlossaryUi = function render() {
        const entries = Object.entries(activePronunciation);
        if (countEl) countEl.textContent = String(entries.length);
        const items = entries.map(([term, spoken]) => {
          const li = element("li", "glossary-item");
          li.setAttribute("data-term", term);
          const badge = element("span", "glossary-term-badge", term);
          const arrow = element("span", "glossary-arrow", "→");
          const input = element("input", "glossary-spoken-input");
          input.type = "text";
          input.value = spoken;
          input.maxLength = 80;
          input.setAttribute("data-term", term);
          input.setAttribute("aria-label", `Pronunciation for ${term}`);
          input.addEventListener("input", () => {
            const val = input.value.trim();
            if (val) activePronunciation[term] = val;
            update();
          });
          const auditionBtn = element("button", "audition-term-btn", "🔊");
          auditionBtn.type = "button";
          auditionBtn.title = `Audition ${term}`;
          auditionBtn.addEventListener("click", () => {
            const spokenVal = activePronunciation[term] || input.value.trim() || term;
            const sandboxStatus = byId("sandbox-status");
            const sandboxPlayer = byId("sandbox-player");
            runAudition(spokenVal, 0, sandboxStatus, sandboxPlayer, auditionBtn);
          });
          const removeBtn = element("button", "remove-term-btn", "✕");
          removeBtn.type = "button";
          removeBtn.title = `Remove ${term}`;
          removeBtn.addEventListener("click", () => {
            delete activePronunciation[term];
            render();
            update();
          });
          li.append(badge, arrow, input, auditionBtn, removeBtn);
          return li;
        });
        listEl.replaceChildren(...items);
      };

      renderGlossaryUi();

      const addBtn = byId("add-term-btn");
      if (addBtn) {
        addBtn.addEventListener("click", () => {
          const keyInput = byId("new-term-key");
          const valInput = byId("new-term-val");
          const errEl = byId("glossary-add-error");
          const key = keyInput ? keyInput.value.trim() : "";
          const val = valInput ? valInput.value.trim() : "";
          if (!key || !val) {
            if (errEl) {
              errEl.textContent = "Please enter both term and spoken pronunciation.";
              errEl.hidden = false;
            }
            return;
          }
          if (/[[\]<>\r\n]/u.test(key + val)) {
            if (errEl) {
              errEl.textContent = "Brackets and special characters are not allowed.";
              errEl.hidden = false;
            }
            return;
          }
          activePronunciation[key] = val;
          if (keyInput) keyInput.value = "";
          if (valInput) valInput.value = "";
          if (errEl) errEl.hidden = true;
          renderGlossaryUi();
          update();
        });
      }
    }

    setupGlossary();

    const sandboxBtn = byId("sandbox-audition-btn");
    if (sandboxBtn) {
      sandboxBtn.addEventListener("click", () => {
        const textInput = byId("sandbox-text");
        const sandboxStatus = byId("sandbox-status");
        const sandboxPlayer = byId("sandbox-player");
        runAudition(textInput ? textInput.value : "", 0, sandboxStatus, sandboxPlayer, sandboxBtn);
      });
    }

    function setupAvatars() {
      const loadedImages = new Map();

      function renderSpeakerCanvas(index, jawOpen = 0, viseme = "rest", showCrosshair = true) {
        const canvas = byId(`speaker-avatar-canvas-${index}`);
        if (!canvas || typeof canvas.getContext !== "function") return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = "#162d26";
        ctx.fillRect(0, 0, w, h);

        const imageId = byId(`speaker-avatar-image-${index}`)?.value || "";
        const img = loadedImages.get(imageId);
        if (!img) {
          ctx.fillStyle = "#95b5a8";
          ctx.font = "600 12px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(imageId ? "Loading portrait..." : "Upload or pick a photo", w / 2, h / 2);
          return;
        }

        const mouthX = Number.parseFloat(byId(`speaker-avatar-mouth-x-${index}`)?.value || "0.5");
        const mouthY = Number.parseFloat(byId(`speaker-avatar-mouth-y-${index}`)?.value || "0.68");
        const mouthScale = Number.parseFloat(
          byId(`speaker-avatar-mouth-scale-${index}`)?.value || "1",
        );

        const cropSide = Math.min(img.width, img.height);
        ctx.drawImage(
          img,
          (img.width - cropSide) / 2,
          (img.height - cropSide) / 2,
          cropSide,
          cropSide,
          0,
          0,
          w,
          h,
        );

        const mx = w * mouthX;
        const my = h * mouthY;
        const unit = (w / 140) * mouthScale;

        if (jawOpen > 0 && viseme !== "rest") {
          // Same calibrated mouth boundary as the video renderer. The photo,
          // including its chin, neck and clothing, is never shifted or warped.
          ctx.save();
          ctx.translate(mx, my);
          ctx.scale(unit, unit * 0.5);
          ctx.beginPath();
          ctx.ellipse(0, 1, 16, 12, 0, 0, Math.PI * 2);
          ctx.clip();
          if (viseme === "smile") {
            ctx.strokeStyle = "rgba(145, 58, 68, 0.75)";
            ctx.lineWidth = 2.5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-11, -1);
            ctx.quadraticCurveTo(0, 6.5, 11, -1);
            ctx.stroke();
          } else {
            const shapes = {
              open_a: [12.5, 9.5, 2],
              open_e: [13.5, 6.2, 1],
              open_o: [8.5, 8.5, 2],
              open_u: [6, 6.2, 1.5],
              consonant: [10.5, 3, 0.5],
            };
            const [mw, mh, offsetY] = shapes[viseme] || shapes.consonant;
            ctx.beginPath();
            ctx.ellipse(0, offsetY, mw, mh, 0, 0, Math.PI * 2);
            ctx.fillStyle = "#3b1519";
            ctx.fill();
            ctx.save();
            ctx.clip();
            if (viseme !== "consonant" && viseme !== "open_u") {
              ctx.fillStyle = "#f7faf7";
              ctx.fillRect(-mw * 0.9, offsetY - mh, mw * 1.8, mh * 0.55);
              ctx.fillStyle = "#d96b6b";
              ctx.beginPath();
              ctx.ellipse(0, offsetY + mh * 0.85, mw * 0.7, mh * 0.6, 0, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
            ctx.strokeStyle = "rgba(145, 58, 68, 0.75)";
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.ellipse(0, offsetY, mw, mh, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        } else if (showCrosshair) {
          ctx.save();
          ctx.strokeStyle = "rgba(87, 199, 163, 0.9)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.ellipse(mx, my + unit * 0.5, 16 * unit, 6 * unit, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(mx - 24 * mouthScale, my);
          ctx.lineTo(mx + 24 * mouthScale, my);
          ctx.moveTo(mx, my - 11 * mouthScale);
          ctx.lineTo(mx, my + 11 * mouthScale);
          ctx.stroke();
          ctx.restore();
        }
      }

      function ensureImageLoaded(imageId, index) {
        if (!imageId) {
          renderSpeakerCanvas(index);
          return;
        }
        if (loadedImages.has(imageId)) {
          renderSpeakerCanvas(index);
          return;
        }
        if (typeof Image !== "function") return;
        const img = new Image();
        img.onload = () => {
          loadedImages.set(imageId, img);
          renderSpeakerCanvas(index);
        };
        img.src = `/api/avatars/${encodeURIComponent(imageId)}`;
      }

      function populateSelect(selectEl, avatars) {
        const current = selectEl.value || selectEl.getAttribute("data-initial-value") || "";
        const defaultOpt = element("option", "", "— Select or upload an image —");
        defaultOpt.value = "";
        const opts = [defaultOpt];
        const seen = new Set();
        for (const avatar of avatars) {
          const id = typeof avatar === "string" ? avatar : avatar?.id;
          if (!id) continue;
          seen.add(id);
          const opt = element("option", "", id);
          opt.value = id;
          if (id === current) opt.selected = true;
          opts.push(opt);
        }
        if (current && !seen.has(current)) {
          const opt = element("option", "", current);
          opt.value = current;
          opt.selected = true;
          opts.push(opt);
        }
        selectEl.replaceChildren(...opts);
        selectEl.value = current;
      }

      fetch("/api/avatars")
        .then((res) => (res.ok ? res.json() : { avatars: [] }))
        .then((data) => {
          const avatars = Array.isArray(data.avatars) ? data.avatars : [];
          for (const [index] of seed.presentation.speakers.entries()) {
            const selectEl = byId(`speaker-avatar-image-${index}`);
            if (selectEl) {
              populateSelect(selectEl, avatars);
              ensureImageLoaded(selectEl.value, index);
            }
          }
        })
        .catch(() => {});

      for (const [index] of seed.presentation.speakers.entries()) {
        const selectEl = byId(`speaker-avatar-image-${index}`);
        if (selectEl) {
          selectEl.addEventListener("change", () => {
            ensureImageLoaded(selectEl.value, index);
            update();
          });
        }
        for (const sliderId of [
          `speaker-avatar-mouth-y-${index}`,
          `speaker-avatar-mouth-x-${index}`,
          `speaker-avatar-mouth-scale-${index}`,
        ]) {
          const slider = byId(sliderId);
          if (slider) {
            slider.addEventListener("input", () => {
              renderSpeakerCanvas(index);
            });
          }
        }
        const uploadInput = byId(`speaker-avatar-upload-${index}`);
        if (uploadInput) {
          uploadInput.addEventListener("change", () => {
            const file = uploadInput.files?.[0];
            if (!file) return;
            const statusEl = byId(`speaker-avatar-upload-status-${index}`);
            if (statusEl) {
              statusEl.className = "audition-status loading";
              statusEl.textContent = "Uploading & normalizing portrait...";
            }
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                const res = await fetch("/api/avatars", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    name: file.name.replace(/\.[^.]+$/u, ""),
                    dataUrl: String(reader.result || ""),
                  }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
                const avatarId = body.imageId || body.avatar?.id;
                if (avatarId && selectEl) {
                  let exists = false;
                  for (const opt of Array.from(selectEl.options)) {
                    if (opt.value === avatarId) exists = true;
                  }
                  if (!exists) {
                    const opt = element("option", "", avatarId);
                    opt.value = avatarId;
                    selectEl.append(opt);
                  }
                  selectEl.value = avatarId;
                  loadedImages.delete(avatarId);
                  ensureImageLoaded(avatarId, index);
                  update();
                }
                if (statusEl) {
                  statusEl.className = "audition-status success";
                  statusEl.textContent = `✓ Saved ${avatarId}`;
                }
              } catch (err) {
                if (statusEl) {
                  statusEl.className = "audition-status error";
                  statusEl.textContent = `Upload failed: ${err.message}`;
                }
              }
            };
            reader.readAsDataURL(file);
          });
        }
        const testBtn = byId(`speaker-avatar-test-${index}`);
        if (testBtn) {
          testBtn.addEventListener("click", () => {
            const visemeCycle = [
              { v: "open_a", j: 0.85 },
              { v: "consonant", j: 0.25 },
              { v: "open_o", j: 0.78 },
              { v: "open_e", j: 0.65 },
              { v: "smile", j: 0.45 },
              { v: "open_u", j: 0.72 },
              { v: "open_a", j: 0.9 },
              { v: "rest", j: 0 },
            ];
            let step = 0;
            testBtn.disabled = true;
            const timer = setInterval(() => {
              if (step >= visemeCycle.length * 2) {
                clearInterval(timer);
                testBtn.disabled = false;
                renderSpeakerCanvas(index, 0, "rest", true);
                return;
              }
              const item = visemeCycle[step % visemeCycle.length];
              renderSpeakerCanvas(index, item.j, item.v, false);
              step += 1;
            }, 140);
          });
        }
      }
    }

    setupAvatars();
  }

  function enableEditor() {
    byId("editor-fields").disabled = false;
    byId("download-controls").hidden = false;
    byId("resume-draft").hidden = true;
    byId("discard-draft").hidden = true;
    readDraft();
    setupAuditioning();
  }
  byId("resume-draft").addEventListener("click", () => {
    if (!pendingRecovery) return;
    for (const id of fieldIds) byId(id).value = pendingRecovery[id];
    lastSavedFields = JSON.stringify(rawFields());
    pendingRecovery = null;
    recoveryMessage(
      "Recovered this tab's unsaved draft. Check the validation messages and review changes before downloading.",
    );
    enableEditor();
    byId("variant-name").focus();
  });
  byId("discard-draft").addEventListener("click", () => {
    if (!pendingRecovery) return;
    pendingRecovery = null;
    for (const id of fieldIds) byId(id).value = startingFields[id];
    try {
      clearSavedDraft();
      recoveryMessage("Saved draft discarded. The starting script is ready to edit.");
    } catch {
      unavailable();
    }
    enableEditor();
    byId("variant-name").focus();
  });
  addEventListener("pageshow", () => {
    if (!pendingRecovery) return;
    // Let navigation restore its scroll position before bringing the pending choice into view.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!pendingRecovery) return;
        byId("draft-recovery").scrollIntoView({ block: "center", behavior: "instant" });
        byId("resume-draft").focus({ preventScroll: true });
      }),
    );
  });
  prepareRecovery();
  if (pendingRecovery) {
    byId("editor-fields").disabled = true;
    byId("download-controls").hidden = true;
    download.disabled = true;
    byId("resume-draft").focus();
  } else enableEditor();
})();
