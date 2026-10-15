(() => {
  const { seed, scenes, reservedNames, availableVoices, recoveryId } = JSON.parse(
    document.getElementById("editor-data").textContent,
  );
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
  function enableEditor() {
    byId("editor-fields").disabled = false;
    byId("download-controls").hidden = false;
    byId("resume-draft").hidden = true;
    byId("discard-draft").hidden = true;
    readDraft();
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
