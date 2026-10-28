(() => {
  const { seed, scenes, reservedNames, availableVoices, recoveryId, pronunciation, faceDetector } =
    JSON.parse(document.getElementById("editor-data").textContent);
  const voiceKey = (voice) =>
    typeof voice === "string" ? voice : `qwen:${voice.profileId}:${voice.revision}`;
  const voiceFromKey = (value) => {
    const parts = value.split(":");
    return parts.length === 3 && parts[0] === "qwen"
      ? { engine: "qwen", profileId: parts[1], revision: parts[2] }
      : value;
  };
  const validPersonalVoiceKey = (value) =>
    /^qwen:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}:[a-f0-9]{64}$/u.test(
      value,
    );
  const voiceAvailable = (value) =>
    availableVoices.includes(value) || globalThis.shortsVoiceProfiles?.isAvailable(value);
  let activePronunciation = { ...(pronunciation || seed.pronunciation || {}) };
  const startingPronunciation = structuredClone(activePronunciation);
  let renderGlossaryUi = null;
  let refreshAvatarUi = () => {};
  const byId = (id) => document.getElementById(id);
  const portraitLabels = (ids) => {
    const labels = new Map();
    const taken = new Set();
    let uploads = 0;
    for (const id of ids) {
      const base = id.replace(/\.[a-z0-9]+$/iu, "");
      let label;
      if (/^(?:portrait-)?(?:[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{12,}$)/iu.test(base))
        label = `Uploaded photo ${++uploads}`;
      else {
        const cleaned = base.replace(/[-_.\s]+/gu, " ").trim();
        label = cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : id;
      }
      let unique = label;
      for (let copy = 2; taken.has(unique); copy++) unique = `${label} (${copy})`;
      taken.add(unique);
      labels.set(id, unique);
    }
    return labels;
  };
  // Option values stay the stored file names; only the visible text is friendlier.
  function labelPortraitOptions(select) {
    const options = Array.from(select?.options ?? []).filter((option) => option.value);
    const labels = portraitLabels(options.map((option) => option.value));
    for (const option of options) {
      option.textContent = labels.get(option.value);
      option.title = option.value;
    }
  }
  const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
  const download = byId("download-script");
  const status = byId("download-status");
  let reviewedDraft = "";
  let savedSnapshot = null;
  let saving = false;
  let editorStep = "script";
  const guided = typeof document.querySelectorAll === "function";
  function showStep(step, scroll = false) {
    if (!guided) return;
    editorStep = step;
    if (globalThis.shortsWorkspace) {
      globalThis.shortsWorkspace.showStep(step, scroll);
      return;
    }
    if (step === "review") globalThis.shortsFinalReview?.refresh();
    document.body.dataset.editorStep = step;
    for (const pane of document.querySelectorAll("[data-editor-pane]"))
      pane.hidden = pane.dataset.editorPane !== step;
    for (const button of document.querySelectorAll("[data-editor-step]")) {
      if (button.dataset.editorStep === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    byId("editor-next").textContent =
      step === "script"
        ? "Next: Voice & portrait"
        : step === "voice"
          ? "Next: Review & produce"
          : "Back to script";
    if (scroll)
      jumpTo(
        step === "script"
          ? "editor-script-start"
          : step === "voice"
            ? "voice-heading"
            : "companion-post-heading",
      );
  }
  function updateNavigationOffset() {
    if (!guided) return;
    const navigation = document.querySelector(".editor-navigation");
    const height = Math.ceil(navigation?.getBoundingClientRect().height ?? 90);
    document.documentElement.style.setProperty("--editor-nav-offset", `${height + 12}px`);
  }
  function jumpTo(id) {
    if (globalThis.shortsWorkspace) {
      globalThis.shortsWorkspace.jumpTo(id);
      return;
    }
    if (!guided) return;
    const target = byId(id);
    if (!target) return;
    if (id === "presentation") target.open = true;
    updateNavigationOffset();
    target.setAttribute("tabindex", "-1");
    target.scrollIntoView({ block: "start", behavior: "instant" });
    target.focus({ preventScroll: true });
    const select = byId("editor-jump-target");
    if (select && Array.from(select.options).some((option) => option.value === id))
      select.value = id;
  }
  const recoveryLimit = 128 * 1024;
  const fieldIds = ["variant-name", "draft-title", "publication-text", "presentation-design"];
  for (const [index] of seed.presentation.speakers.entries())
    fieldIds.push(
      `speaker-voice-${index}`,
      ...[
        "mode",
        "image",
        "mouth-x",
        "mouth-y",
        "mouth-scale",
        "geometry",
        "motion-style",
        "motion-intensity",
      ].map((name) => `speaker-avatar-${name}-${index}`),
    );
  for (const [index, scene] of seed.scenes.entries()) {
    fieldIds.push(`overlay-${index}`);
    if (scene.dialogue)
      for (const [position] of scene.dialogue.entries()) fieldIds.push(`turn-${index}-${position}`);
    else fieldIds.push(`narration-${index}`);
  }
  const rawFields = () => Object.fromEntries(fieldIds.map((id) => [id, byId(id).value]));
  function cleanDesign(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) => !["schemaVersion", "theme", "motion", "scenes"].includes(key),
      ) ||
      value.schemaVersion !== 1 ||
      !["electric", "ocean", "sunset"].includes(value.theme) ||
      !["snappy", "smooth", "minimal"].includes(value.motion) ||
      !Array.isArray(value.scenes) ||
      value.scenes.length !== seed.scenes.length
    )
      throw new Error("Presentation design does not match this editor.");
    for (const [index, scene] of value.scenes.entries())
      if (
        !scene ||
        scene.id !== seed.scenes[index].id ||
        Object.keys(scene).some((key) => !["id", "headline", "emphasis"].includes(key)) ||
        typeof scene.headline !== "string" ||
        !scene.headline.trim() ||
        scene.headline.length > 48 ||
        /[<>\p{Cc}]/u.test(scene.headline) ||
        !["balanced", "headline", "evidence"].includes(scene.emphasis)
      )
        throw new Error("Presentation design has invalid scene content.");
    return structuredClone(value);
  }
  const currentDesign = () =>
    byId("presentation-design").value
      ? cleanDesign(JSON.parse(byId("presentation-design").value))
      : undefined;
  // The writer receives only these wording fields; media selections and private
  // profile metadata never enter its snapshot or its provider prompts.
  const writingSnapshot = () => ({
    ...(currentDesign() ? { design: currentDesign() } : {}),
    title: byId("draft-title").value.trim(),
    publicationText: byId("publication-text").value.trim(),
    scenes: seed.scenes.map((scene, index) => ({
      id: scene.id,
      overlay: byId(`overlay-${index}`).value.trim(),
      texts: scene.dialogue
        ? scene.dialogue.map((_turn, position) => byId(`turn-${index}-${position}`).value.trim())
        : [byId(`narration-${index}`).value.trim()],
    })),
  });
  const startingFields = rawFields();
  const startingSignature = JSON.stringify(startingFields);
  let storage;
  let recoveryKey;
  let pendingRecovery = null;
  let recoveredDraft = false;
  let editorEnabled = false;
  globalThis.shortsWritingEditor = {
    context: JSON.parse(document.getElementById("editor-data").textContent).writingContext,
    syncStep(step) {
      editorStep = step;
    },
    openWritingSetup() {
      if (globalThis.shortsWorkspace) {
        globalThis.shortsWorkspace.activate("writing");
        return;
      }
      showStep("script", true);
      const disclosure = document.querySelector?.(".writing-editor-disclosure");
      if (disclosure) {
        disclosure.open = true;
        jumpTo("presentation");
      }
    },
    openReview() {
      if (globalThis.shortsWorkspace) {
        globalThis.shortsWorkspace.activate("ai-review");
        return;
      }
      showStep("review");
      jumpTo("final-review-heading");
    },
    applyFinal(snapshot, expected) {
      if (
        typeof snapshot.publicationText !== "string" ||
        !snapshot.publicationText.trim() ||
        snapshot.publicationText.length > 3000
      )
        throw new Error("The proposed companion post needs 1–3,000 characters.");
      const design = snapshot.design ? cleanDesign(snapshot.design) : undefined;
      this.apply(snapshot, expected);
      byId("publication-text").value = snapshot.publicationText;
      byId("presentation-design").value = design ? JSON.stringify(design) : "";
      update();
    },
    snapshot() {
      if (!editorEnabled || pendingRecovery || saving)
        throw new Error("Finish draft recovery or saving before using the writing assistant.");
      return writingSnapshot();
    },
    applyDesign(proposal, expected) {
      if (
        !editorEnabled ||
        pendingRecovery ||
        saving ||
        JSON.stringify(writingSnapshot()) !== JSON.stringify(expected)
      )
        throw new Error("Your script or design changed. Generate a new presentation proposal.");
      const design = cleanDesign(proposal);
      byId("presentation-design").value = JSON.stringify(design);
      reviewedDraft = "";
      update();
    },
    apply(proposal, expected) {
      if (
        !editorEnabled ||
        pendingRecovery ||
        saving ||
        JSON.stringify(writingSnapshot()) !== JSON.stringify(expected)
      )
        throw new Error(
          "Your script changed while applying this proposal. Keep your edits and generate again.",
        );
      if (
        !proposal ||
        typeof proposal.title !== "string" ||
        !proposal.title.trim() ||
        proposal.title.length > 60 ||
        !Array.isArray(proposal.scenes) ||
        proposal.scenes.length !== seed.scenes.length
      )
        throw new Error("Proposal does not match this editor.");
      for (const [index, scene] of proposal.scenes.entries()) {
        const original = seed.scenes[index];
        if (
          scene.id !== original.id ||
          typeof scene.overlay !== "string" ||
          !scene.overlay.trim() ||
          scene.overlay.length > 48 ||
          !Array.isArray(scene.texts) ||
          scene.texts.length !== (original.dialogue?.length ?? 1) ||
          scene.texts.some((value) => typeof value !== "string" || !value.trim())
        )
          throw new Error("Proposal does not match this editor's scene and speaker turns.");
      }
      byId("draft-title").value = proposal.title;
      for (const [index, scene] of proposal.scenes.entries()) {
        byId(`overlay-${index}`).value = scene.overlay;
        if (seed.scenes[index].dialogue)
          for (const [position, value] of scene.texts.entries())
            byId(`turn-${index}-${position}`).value = value;
        else byId(`narration-${index}`).value = scene.texts[0];
      }
      reviewedDraft = "";
      update();
    },
  };
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
    // Older text-only recovery records remain usable after adding presentation editing.
    if (
      !Object.hasOwn(fields, "presentation-design") &&
      Object.keys(fields).length === fieldIds.length - 1
    )
      fields["presentation-design"] = seed.presentation.design
        ? JSON.stringify(seed.presentation.design)
        : "";
    if (Object.keys(fields).length !== fieldIds.length) return false;
    if (fieldIds.some((id) => !Object.hasOwn(fields, id) || typeof fields[id] !== "string"))
      return false;
    return seed.presentation.speakers.every((speaker, index) => {
      const voice = fields[`speaker-voice-${index}`];
      return (
        voice === voiceKey(speaker.voice) ||
        voiceAvailable(voice) ||
        /^qwen:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}:[a-f0-9]{64}$/u.test(
          voice,
        )
      );
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
  const iconSvg = (path) =>
    `<svg class="action-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
  const speakerSvg = iconSvg(
    '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  );
  const closeSvg = iconSvg('<path d="M6 6l12 12M18 6 6 18"/>');
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
    section(
      "Presentation design",
      [
        {
          label: "Theme, motion and visual headlines",
          before: JSON.stringify(seed.presentation.design ?? "Automatic", null, 2),
          after: JSON.stringify(draft.presentation.design ?? "Automatic", null, 2),
        },
      ],
      "Restore presentation design",
      () => {
        byId("presentation-design").value = seed.presentation.design
          ? JSON.stringify(seed.presentation.design)
          : "";
      },
      "presentation-design-reset",
    );
    const voiceLabel = (index, voice) =>
      Array.from(byId(`speaker-voice-${index}`).options).find(
        (option) => option.value === voiceKey(voice),
      )?.textContent ?? (typeof voice === "string" ? voice : "My voice (Qwen)");
    section(
      "Voices",
      draft.presentation.speakers.map((speaker, index) => ({
        label: `${speaker.name} voice`,
        before: voiceLabel(index, seed.presentation.speakers[index].voice),
        after: voiceLabel(index, speaker.voice),
        changed: voiceKey(seed.presentation.speakers[index].voice) !== voiceKey(speaker.voice),
      })),
      "Restore starting voices",
      () => {
        for (const [index, speaker] of seed.presentation.speakers.entries())
          byId(`speaker-voice-${index}`).value = voiceKey(speaker.voice);
      },
      "speaker-voice-0",
    );
    const formatAvatar = (avatar) =>
      avatar?.mode === "photo"
        ? `Photo (${avatar.imageId || "none"} · ${avatar.animation === "neural" ? "realistic local" : avatar.animation === "mouth-only" ? "mouth only" : "lightweight"} · ${avatar.motion?.style ?? "conversational"}, ${Math.round((avatar.motion?.intensity ?? 0.7) * 100)}% motion · mouth ${Math.round((avatar.mouthX ?? 0.5) * 100)}%, ${Math.round((avatar.mouthY ?? 0.68) * 100)}%, scale ${Math.round((avatar.mouthScale ?? 1) * 100)}%)`
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
          byId(`speaker-avatar-motion-style-${index}`).value =
            speaker.avatar?.motion?.style ?? "conversational";
          byId(`speaker-avatar-motion-intensity-${index}`).value = String(
            speaker.avatar?.motion?.intensity ?? 0.7,
          );
          byId(`speaker-avatar-mouth-y-${index}`).value = String(speaker.avatar?.mouthY ?? 0.68);
          byId(`speaker-avatar-mouth-x-${index}`).value = String(speaker.avatar?.mouthX ?? 0.5);
          byId(`speaker-avatar-mouth-scale-${index}`).value = String(
            speaker.avatar?.mouthScale ?? 1,
          );
          byId(`speaker-avatar-geometry-${index}`).value =
            startingFields[`speaker-avatar-geometry-${index}`];
          refreshAvatarUi(index);
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
  function readMouthMetadata(index) {
    try {
      const value = JSON.parse(byId(`speaker-avatar-geometry-${index}`)?.value || "{}");
      const metadata = {};
      if (
        value.animation === "mouth-only" ||
        value.animation === "full-face" ||
        value.animation === "neural"
      ) {
        metadata.animation = value.animation;
      }
      if (Number.isFinite(value.mouthAngle) && Math.abs(value.mouthAngle) <= 0.55)
        metadata.mouthAngle = value.mouthAngle;
      if (
        Number.isFinite(value.mouthAspect) &&
        value.mouthAspect >= 0.2 &&
        value.mouthAspect <= 0.6
      )
        metadata.mouthAspect = value.mouthAspect;
      const motion = value.motion;
      if (
        motion &&
        ["calm", "conversational", "expressive"].includes(motion.style) &&
        Number.isFinite(motion.intensity) &&
        motion.intensity >= 0 &&
        motion.intensity <= 1
      ) {
        metadata.motion = { style: motion.style, intensity: motion.intensity };
        if (Number.isInteger(motion.seed) && motion.seed >= 0 && motion.seed <= 4294967295)
          metadata.motion.seed = motion.seed;
      }
      const fl = value.faceLandmarks;
      if (
        fl &&
        typeof fl === "object" &&
        Array.isArray(fl.leftEye) &&
        fl.leftEye.length === 4 &&
        Array.isArray(fl.rightEye) &&
        fl.rightEye.length === 4 &&
        Number.isFinite(fl.jawY) &&
        Number.isFinite(fl.faceX) &&
        Number.isFinite(fl.faceY) &&
        Number.isFinite(fl.faceRx) &&
        Number.isFinite(fl.faceRy)
      ) {
        metadata.faceLandmarks = {
          leftEye: fl.leftEye.slice(0, 4).map(Number),
          rightEye: fl.rightEye.slice(0, 4).map(Number),
          jawY: Number(fl.jawY),
          faceX: Number(fl.faceX),
          faceY: Number(fl.faceY),
          faceRx: Number(fl.faceRx),
          faceRy: Number(fl.faceRy),
        };
      }
      const c = value.calibration;
      if (
        c &&
        /^[a-f0-9]{64}$/u.test(c.imageSha256) &&
        c.modelSha256 === faceDetector?.modelSha256 &&
        c.detector === faceDetector?.version
      )
        metadata.calibration = {
          imageSha256: c.imageSha256,
          modelSha256: c.modelSha256,
          detector: c.detector,
        };
      return metadata;
    } catch {
      return {};
    }
  }

  function readDraft() {
    const draft = structuredClone(seed);
    draft.presentation.variant = byId("variant-name").value.trim();
    draft.title = byId("draft-title").value.trim();
    draft.publicationText = byId("publication-text").value.trim();
    const errors = [];
    try {
      const design = currentDesign();
      if (design) draft.presentation.design = design;
      else delete draft.presentation.design;
      byId("presentation-design-status").textContent = design
        ? `Custom presentation · ${design.theme} · ${design.motion} motion · ${design.scenes.length} visual headlines. Save draft to use this design in the deck and next video.`
        : "Automatic presentation design. Use the Writing assistant to generate or enhance it with a prompt.";
      byId("presentation-design-reset").disabled = !design;
    } catch {
      errors.push(
        "Presentation design is invalid. Restore the automatic design or generate a new proposal.",
      );
    }
    for (const [index, speaker] of draft.presentation.speakers.entries()) {
      const original = voiceKey(seed.presentation.speakers[index].voice);
      const selected = byId(`speaker-voice-${index}`).value;
      if (selected !== original && !voiceAvailable(selected) && !validPersonalVoiceKey(selected))
        errors.push(`Choose an available voice for ${speaker.name}.`);
      speaker.voice = voiceFromKey(selected);
      byId(`speaker-voice-${index}-help`).textContent = selected.startsWith("qwen:")
        ? "Personal voice profile on this Mac. Production checks its accepted revision."
        : availableVoices.includes(selected)
          ? "Local voice assets checked when this studio was built. Production checks them again."
          : "Install this voice using the button below before production.";
      const setup =
        typeof seed.presentation.speakers[index].voice === "string"
          ? byId(`speaker-voice-setup-${index}`)
          : null;
      if (setup) {
        setup.hidden = selected.startsWith("qwen:") || availableVoices.includes(selected);
        const button = setup.querySelector?.("[data-local-action]");
        if (button) button.dataset.voice = selected;
      }
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
          ...readMouthMetadata(index),
          mouthX: Number.isFinite(mouthX) ? Number(mouthX.toFixed(3)) : 0.5,
          mouthY: Number.isFinite(mouthY) ? Number(mouthY.toFixed(3)) : 0.68,
          mouthScale: Number.isFinite(mouthScale) ? Number(mouthScale.toFixed(3)) : 1,
        };
      } else if (seed.presentation.speakers[index].avatar) {
        speaker.avatar = { mode: "illustrated" };
      } else {
        delete speaker.avatar;
      }
    }
    if (
      draft.presentation.speakers.length > 1 &&
      new Set(
        draft.presentation.speakers.map((speaker) =>
          typeof speaker.voice === "string" ? speaker.voice : speaker.voice.profileId,
        ),
      ).size !== draft.presentation.speakers.length
    )
      errors.push("Choose a different voice for each person in the conversation.");
    draft.schemaVersion = draft.presentation.speakers.some(
      (speaker) => typeof speaker.voice !== "string",
    )
      ? 2
      : seed.schemaVersion;
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
      const pacing = [];
      if (index === 0 && count > 7) pacing.push("A shorter opening may land faster.");
      if (count > seconds * 3)
        pacing.push(
          "This section may run longer than planned; production follows the actual speech.",
        );
      const warning = byId(`scene-${index}-warning`);
      warning.textContent = [...problems, ...pacing].join(" ");
      warning.hidden = !problems.length && !pacing.length;
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
      : "Ready to save or produce. Target 45–60s; measured totals of 15–90s are accepted. Section pacing is flexible.";
    const voiceSummary = byId("production-voice-summary");
    if (voiceSummary)
      voiceSummary.textContent = `Voices for this video: ${draft.presentation.speakers
        .map((speaker, index) => {
          const select = byId(`speaker-voice-${index}`);
          const option = Array.from(select.options ?? []).find(
            (item) => item.value === select.value,
          );
          return `${speaker.name} — ${option?.textContent || select.value}`;
        })
        .join("; ")}. Saving a voice sample does not change this selection.`;
    byId("produce-command").textContent =
      `npm run shorts -- produce ${draft.baseEpisodeId}@${draft.presentation.variant} --serve`;
    download.disabled = !!errors.length;
    if (guided) {
      byId("editor-validation-state").textContent = errors.length
        ? `${errors.length} ${errors.length === 1 ? "item" : "items"} to fix · see Review & produce`
        : globalThis.shortsWorkspace
          ? "Draft checked"
          : "Draft checked · timing measured during production";
      if (!saving)
        byId("editor-save-state").textContent =
          savedSnapshot && savedSnapshot.signature === JSON.stringify(draft)
            ? `Saved on this Mac · ${savedSnapshot.selector}`
            : globalThis.shortsWorkspace
              ? "Unsaved changes"
              : "Unsaved changes · Save draft to keep this version";
    }
    reviewChanges(draft);
    saveRecovery();
    globalThis.shortsWorkspace?.refresh();
    return { draft, errors };
  }
  const update = () => {
    if (pendingRecovery) return;
    status.textContent = "";
    readDraft();
    globalThis.shortsFinalReview?.changed();
  };
  byId("editor-fields").addEventListener("input", update);
  byId("presentation-design-reset").addEventListener("click", () => {
    byId("presentation-design").value = "";
    update();
  });
  if (location.hash === "#presentation") {
    const assistant = document.querySelector?.(".writing-editor-disclosure");
    if (assistant) assistant.open = true;
  }
  byId("editor-fields").addEventListener("change", update);
  document.addEventListener?.("shorts:voices-ready", update);
  addEventListener("shorts-local-action-complete", (event) => {
    const job = event.detail;
    if (job.action === "voice-install" && job.voice && !availableVoices.includes(job.voice)) {
      availableVoices.push(job.voice);
      update();
    }
    if (job.action === "portrait-setup") {
      for (const [index] of seed.presentation.speakers.entries()) {
        const label = byId(`speaker-avatar-runtime-${index}`);
        if (label) label.textContent = "Realistic local rendering is ready.";
      }
    }
  });
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

  function nextSnapshot() {
    let result = readDraft();
    if (
      savedSnapshot &&
      savedSnapshot.signature !== JSON.stringify(result.draft) &&
      savedSnapshot.name === result.draft.presentation.variant
    ) {
      let number = 2;
      let name;
      do {
        name = `${savedSnapshot.name.replace(/-\d+$/u, "").slice(0, 27)}-${number++}`;
      } while (reservedNames.includes(name) || name === savedSnapshot.name);
      byId("variant-name").value = name;
      result = readDraft();
    }
    return result;
  }
  function rememberSnapshot(draft, selector) {
    if (savedSnapshot && savedSnapshot.name !== draft.presentation.variant)
      reservedNames.push(savedSnapshot.name);
    savedSnapshot = {
      signature: JSON.stringify(draft),
      name: draft.presentation.variant,
      selector,
    };
    if (guided) byId("editor-save-state").textContent = `Saved on this Mac · ${selector}`;
    if (guided) {
      const link = element("a", "saved-version-link", "Open saved version ↗");
      link.href = `../../episodes/${encodeURIComponent(selector)}/edit.html`;
      byId("editor-save-state").append(element("span", "", " · "), link);
    }
  }
  if (guided) {
    if (!document.querySelector("[data-editor-workspace]")) {
      byId("editor-jump-go").addEventListener("click", () =>
        jumpTo(byId("editor-jump-target").value),
      );
      for (const link of document.querySelectorAll(".editor-scene-index a"))
        link.addEventListener("click", (event) => {
          event.preventDefault();
          jumpTo(link.hash.slice(1));
        });
      addEventListener("resize", updateNavigationOffset);
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(updateNavigationOffset);
        observer.observe(document.querySelector(".editor-navigation"));
      }
      updateNavigationOffset();
      for (const button of document.querySelectorAll("[data-editor-step]"))
        button.addEventListener("click", () => showStep(button.dataset.editorStep, true));
      byId("editor-next").addEventListener("click", () =>
        showStep(
          editorStep === "script" ? "voice" : editorStep === "voice" ? "review" : "script",
          true,
        ),
      );
    }
    byId("save-draft").addEventListener("click", async () => {
      if (pendingRecovery || saving) return;
      const { draft, errors } = nextSnapshot();
      if (errors.length) {
        showStep("review", true);
        jumpTo("draft-errors");
        return;
      }
      if (savedSnapshot?.signature === JSON.stringify(draft)) return;
      saving = true;
      byId("save-draft").disabled = true;
      produceBtn.disabled = true;
      byId("editor-fields").disabled = true;
      byId("editor-save-state").textContent = "Saving draft and updating the workspace…";
      try {
        const response = await fetch("/api/scripts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ definition: draft }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Draft could not be saved. Your edits are still here.");
        rememberSnapshot(draft, data.selector);
        if (!data.libraryUpdated)
          byId("editor-save-state").textContent =
            `Draft saved · ${data.selector}. Workspace refresh is pending; produce or rebuild to include it.`;
      } catch (error) {
        byId("editor-save-state").textContent = error.message;
      } finally {
        saving = false;
        byId("save-draft").disabled = false;
        produceBtn.disabled = false;
        byId("editor-fields").disabled = false;
      }
    });
  }

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
      if (pendingRecovery || saving) return;
      const { draft, errors } = nextSnapshot();
      if (errors.length) {
        showStep("review", true);
        jumpTo("draft-errors");
        return;
      }
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
          body: JSON.stringify(
            savedSnapshot?.signature === JSON.stringify(draft)
              ? { selector: savedSnapshot.selector }
              : { definition: draft },
          ),
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
        rememberSnapshot(draft, selector);
        const sse = new EventSource(`/api/productions/${encodeURIComponent(data.jobId)}/stream`);
        sse.addEventListener("status", (e) => {
          try {
            const p = JSON.parse(e.data);
            setProduceProgress(p.stage, p.message);
            if (["READY", "FAILED", "BLOCKED"].includes(p.stage)) completeProduction(e);
          } catch {}
        });
        sse.addEventListener("progress", (e) => {
          try {
            const p = JSON.parse(e.data);
            setProduceProgress(p.stage, p.message);
          } catch {}
        });
        function completeProduction(e) {
          sse.close();
          produceBtn.disabled = false;
          download.disabled = false;
          let payload = {};
          try {
            payload = JSON.parse(e.data || "{}");
          } catch {}
          const report = payload.report || {};
          const stage = payload.stage || report.stage || "FAILED";
          if (stage !== "READY") {
            const issueMsg =
              report.issue?.message || payload.error || "Production stopped before MP4 export.";
            const timingDetail =
              Number.isFinite(report.durationSeconds) && Number.isFinite(report.hookSeconds)
                ? ` (Measured: ${report.durationSeconds.toFixed(1)}s total, ${report.hookSeconds.toFixed(2)}s opening hook)`
                : "";
            const nextAction = report.issue?.nextAction ? ` ${report.issue.nextAction}` : "";
            setProduceProgress(stage, `${issueMsg}${timingDetail}${nextAction}`);
            if (produceResult) {
              produceResult.hidden = false;
              const strong = element("strong", "", "Video not produced · your version is saved");
              const p = element("p", "", `${issueMsg}${timingDetail}${nextAction}`);
              const edit = element(
                "button",
                "secondary-btn",
                report.issue?.code === "VIDEO_LAYOUT_REVIEW_REQUIRED"
                  ? "Review script & visuals"
                  : report.issue?.code === "TIMING_REVIEW_REQUIRED"
                    ? "Edit opening & narration"
                    : "Review voice & portrait",
              );
              edit.type = "button";
              edit.addEventListener("click", () => {
                showStep(
                  ["TIMING_REVIEW_REQUIRED", "VIDEO_LAYOUT_REVIEW_REQUIRED"].includes(
                    report.issue?.code,
                  )
                    ? "script"
                    : "voice",
                  true,
                );
                const scriptIssue = [
                  "TIMING_REVIEW_REQUIRED",
                  "VIDEO_LAYOUT_REVIEW_REQUIRED",
                ].includes(report.issue?.code);
                if (scriptIssue) {
                  jumpTo("scene-0-heading");
                  byId(seed.scenes[0]?.dialogue ? "turn-0-0" : "narration-0").focus({
                    preventScroll: true,
                  });
                } else jumpTo("voice-heading");
              });
              const saved = element("a", "", "Open saved version ↗");
              saved.href = `../../episodes/${encodeURIComponent(selector)}/edit.html`;
              produceResult.replaceChildren(strong, p, edit, saved);
            }
            return;
          }
          setProduceProgress("READY", "Production complete!");
          if (produceResult) {
            produceResult.hidden = false;
            const strong = element("strong", "", "Video produced · ready for your review");
            const p = element("p");
            const watchLink = element("a", "watch-now-btn", "Review & publish ↗");
            watchLink.href = `../../episodes/${encodeURIComponent(selector)}/publish.html`;
            const studioLink = element("a", "", "View in Studio ↗");
            studioLink.href = "../../review.html?stage=review#episodes";
            p.append(watchLink, element("span", "", " "), studioLink);
            produceResult.replaceChildren(strong, p);
          }
        }
        sse.addEventListener("complete", completeProduction);
        sse.addEventListener("error", (e) => {
          if (!e.data) {
            setProduceProgress(
              "RECONNECTING",
              "Production may still be running. Reconnecting; you can also check the workspace.",
            );
            return;
          }
          completeProduction(e);
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
            voice: voiceFromKey(voice),
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
          const auditionBtn = element("button", "audition-term-btn");
          auditionBtn.innerHTML = speakerSvg;
          auditionBtn.setAttribute("aria-label", `Audition ${term}`);
          auditionBtn.type = "button";
          auditionBtn.title = `Audition ${term}`;
          auditionBtn.addEventListener("click", () => {
            const spokenVal = activePronunciation[term] || input.value.trim() || term;
            const sandboxStatus = byId("sandbox-status");
            const sandboxPlayer = byId("sandbox-player");
            runAudition(spokenVal, 0, sandboxStatus, sandboxPlayer, auditionBtn);
          });
          const removeBtn = element("button", "remove-term-btn");
          removeBtn.innerHTML = closeSvg;
          removeBtn.setAttribute("aria-label", `Remove ${term}`);
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
      const imageHashes = new Map();
      const imageLoads = new Map();
      const revisions = new Map();
      let detectorPromise;
      const invalidate = (index) => revisions.set(index, (revisions.get(index) || 0) + 1);
      const detectStatus = (index, text) => {
        byId(`speaker-avatar-detect-status-${index}`).textContent = text;
      };
      async function detector() {
        if (!detectorPromise)
          detectorPromise = (async () => {
            const { FaceLandmarker, FilesetResolver } = await import(
              "/api/face-assets/vision_bundle.mjs"
            );
            const files = await FilesetResolver.forVisionTasks("/api/face-assets");
            return FaceLandmarker.createFromOptions(files, {
              baseOptions: {
                modelAssetPath: "/api/face-assets/face_landmarker.task",
                delegate: "CPU",
              },
              runningMode: "IMAGE",
              numFaces: 2,
              minFaceDetectionConfidence: 0.65,
              minFacePresenceConfidence: 0.65,
            });
          })().catch((error) => {
            detectorPromise = undefined;
            throw error;
          });
        return detectorPromise;
      }
      async function detectMouth(index) {
        invalidate(index);
        const revision = revisions.get(index);
        const imageId = byId(`speaker-avatar-image-${index}`).value;
        const current = () =>
          revisions.get(index) === revision &&
          byId(`speaker-avatar-image-${index}`).value === imageId;
        if (!imageId) {
          detectStatus(index, "Select or upload a portrait first.");
          return;
        }
        detectStatus(index, "Locating lips on this device…");
        try {
          const portrait = await ensureImageLoaded(imageId, index, true);
          const model = await detector();
          if (!current()) return;
          const img = portrait.img;
          // Detect the exact square crop used in both preview and export.
          const square = document.createElement("canvas");
          square.width = square.height = 512;
          const side = Math.min(img.width, img.height);
          square
            .getContext("2d")
            .drawImage(
              img,
              (img.width - side) / 2,
              (img.height - side) / 2,
              side,
              side,
              0,
              0,
              512,
              512,
            );
          const result = model.detect(square);
          if (result.faceLandmarks.length !== 1)
            throw new Error(
              result.faceLandmarks.length
                ? "More than one face found. Use a single-person portrait."
                : "No clear face found. Try a front-facing portrait.",
            );
          const geometry = mouthGeometry(result.faceLandmarks[0]);
          const imageSha256 = portrait.sha;
          if (!/^[a-f0-9]{64}$/u.test(imageSha256 || ""))
            throw new Error("Photo verification unavailable. Reload the studio.");
          if (!current()) return;
          const animSelect = byId(`speaker-avatar-animation-${index}`);
          byId(`speaker-avatar-mouth-x-${index}`).value = String(geometry.mouthX);
          byId(`speaker-avatar-mouth-y-${index}`).value = String(geometry.mouthY);
          byId(`speaker-avatar-mouth-scale-${index}`).value = String(geometry.mouthScale);
          byId(`speaker-avatar-geometry-${index}`).value = JSON.stringify({
            ...(animSelect?.value ? { animation: animSelect.value } : {}),
            ...(readMouthMetadata(index).motion ? { motion: readMouthMetadata(index).motion } : {}),
            mouthAngle: geometry.mouthAngle,
            mouthAspect: geometry.mouthAspect,
            ...(geometry.faceLandmarks ? { faceLandmarks: geometry.faceLandmarks } : {}),
            calibration: {
              imageSha256,
              modelSha256: faceDetector.modelSha256,
              detector: faceDetector.version,
            },
          });
          detectStatus(
            index,
            "Face & mouth landmarks located. Check the guide and test the motion; fine-tune if needed.",
          );
          renderSpeakerCanvas(index);
          update();
        } catch (error) {
          if (current())
            detectStatus(
              index,
              `Automatic alignment unavailable: ${error.message} You can adjust manually. If setup is needed, open Local portrait tools and choose Set up face alignment.`,
            );
        }
      }
      refreshAvatarUi = (index) => {
        invalidate(index);
        detectStatus(index, "");
        const animEl = byId(`speaker-avatar-animation-${index}`);
        if (animEl) {
          const meta = readMouthMetadata(index);
          animEl.value = meta.animation || "full-face";
          if (byId(`speaker-avatar-motion-style-${index}`))
            byId(`speaker-avatar-motion-style-${index}`).value =
              meta.motion?.style || "conversational";
          if (byId(`speaker-avatar-motion-intensity-${index}`))
            byId(`speaker-avatar-motion-intensity-${index}`).value = String(
              meta.motion?.intensity ?? 0.7,
            );
        }
        ensureImageLoaded(byId(`speaker-avatar-image-${index}`).value, index).catch(() => {});
      };

      function renderSpeakerCanvas(
        index,
        jawOpen = 0,
        viseme = "rest",
        showCrosshair = true,
        animState = null,
      ) {
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

        const metadata = readMouthMetadata(index);
        const animMode =
          metadata.animation || byId(`speaker-avatar-animation-${index}`)?.value || "mouth-only";
        if ((jawOpen > 0 && viseme !== "rest") || animState) {
          const pixels = ctx.getImageData(0, 0, w, h);
          if (
            (animMode === "full-face" || animMode === "neural") &&
            typeof warpPhotoFace === "function"
          ) {
            pixels.data.set(
              warpPhotoFace(
                pixels.data,
                w,
                h,
                { mouthX, mouthY, mouthScale, ...metadata },
                animState || { viseme, jawOpen },
              ),
            );
          } else {
            pixels.data.set(
              warpPhotoMouth(
                pixels.data,
                w,
                h,
                { mouthX, mouthY, mouthScale, ...metadata },
                viseme,
              ),
            );
          }
          ctx.putImageData(pixels, 0, 0);
        } else if (showCrosshair) {
          ctx.save();
          ctx.strokeStyle = "rgba(87, 199, 163, 0.9)";
          ctx.lineWidth = (2 * w) / 140;
          ctx.setLineDash([(4 * w) / 140, (3 * w) / 140]);
          ctx.beginPath();
          ctx.ellipse(
            mx,
            my,
            16 * unit,
            Math.max(8, 16 * (metadata.mouthAspect ?? 0.375) + 4) * unit,
            metadata.mouthAngle ?? 0,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
          if ((animMode === "full-face" || animMode === "neural") && metadata.faceLandmarks) {
            ctx.strokeStyle = "rgba(184, 219, 188, 0.55)";
            ctx.lineWidth = (1.5 * w) / 140;
            for (const eye of [metadata.faceLandmarks.leftEye, metadata.faceLandmarks.rightEye]) {
              if (Array.isArray(eye) && eye.length === 4) {
                ctx.beginPath();
                ctx.ellipse(
                  w * eye[0],
                  h * eye[1],
                  Math.max(w * 0.045, w * eye[2]),
                  Math.max(h * 0.025, h * eye[3] * 1.4),
                  metadata.mouthAngle ?? 0,
                  0,
                  Math.PI * 2,
                );
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }
      }

      async function ensureImageLoaded(imageId, index, fresh = false) {
        if (!imageId) {
          renderSpeakerCanvas(index);
          return;
        }
        if (!fresh && loadedImages.has(imageId)) {
          renderSpeakerCanvas(index);
          return { img: loadedImages.get(imageId), sha: imageHashes.get(imageId) };
        }
        const loading = (async () => {
          const response = await fetch(`/api/avatars/${encodeURIComponent(imageId)}`, {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Cannot load this portrait.");
          const sha = response.headers.get("x-image-sha256");
          const url = URL.createObjectURL(await response.blob());
          try {
            const img = new Image();
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = () => reject(new Error("Cannot decode this portrait."));
              img.src = url;
            });
            return { img, sha };
          } finally {
            URL.revokeObjectURL(url);
          }
        })();
        imageLoads.set(imageId, loading);
        const portrait = await loading;
        if (imageLoads.get(imageId) === loading) {
          loadedImages.set(imageId, portrait.img);
          imageHashes.set(imageId, portrait.sha);
          renderSpeakerCanvas(index);
          const calibration = readMouthMetadata(index).calibration;
          if (
            byId(`speaker-avatar-image-${index}`).value === imageId &&
            calibration &&
            calibration.imageSha256 !== portrait.sha
          )
            detectStatus(
              index,
              "This photo has changed. Detect the mouth again before testing or producing.",
            );
        }
        return portrait;
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
        labelPortraitOptions(selectEl);
        selectEl.value = current;
      }

      fetch("/api/portrait-status")
        .then((response) => (response.ok ? response.json() : null))
        .then((runtime) => {
          for (const [index] of seed.presentation.speakers.entries()) {
            const label = byId(`speaker-avatar-runtime-${index}`);
            if (label)
              label.textContent = runtime?.installed
                ? "Realistic local rendering is ready. Generating a portrait takes longer than the silent preview."
                : "Open Local portrait tools below and choose Set up realistic portraits.";
          }
        })
        .catch(() => {
          for (const [index] of seed.presentation.speakers.entries()) {
            const label = byId(`speaker-avatar-runtime-${index}`);
            if (label)
              label.textContent =
                "Open through the local studio server to check the portrait renderer.";
          }
        });

      for (const [index] of seed.presentation.speakers.entries())
        labelPortraitOptions(byId(`speaker-avatar-image-${index}`));

      fetch("/api/avatars")
        .then((res) => (res.ok ? res.json() : { avatars: [] }))
        .then((data) => {
          const avatars = Array.isArray(data.avatars) ? data.avatars : [];
          for (const [index] of seed.presentation.speakers.entries()) {
            const selectEl = byId(`speaker-avatar-image-${index}`);
            if (selectEl) {
              populateSelect(selectEl, avatars);
              ensureImageLoaded(selectEl.value, index).catch((error) =>
                detectStatus(index, error.message),
              );
            }
          }
        })
        .catch(() => {});

      for (const [index] of seed.presentation.speakers.entries()) {
        const selectEl = byId(`speaker-avatar-image-${index}`);
        if (selectEl) {
          selectEl.addEventListener("change", () => {
            byId(`speaker-avatar-geometry-${index}`).value = JSON.stringify({
              animation: byId(`speaker-avatar-animation-${index}`)?.value,
              motion: readMouthMetadata(index).motion,
            });
            detectMouth(index);
            update();
          });
        }
        for (const suffix of ["motion-style", "motion-intensity"]) {
          const control = byId(`speaker-avatar-${suffix}-${index}`);
          control?.addEventListener("input", () => {
            const metadata = readMouthMetadata(index);
            metadata.motion = {
              ...(metadata.motion || {}),
              style: byId(`speaker-avatar-motion-style-${index}`).value,
              intensity: Number(byId(`speaker-avatar-motion-intensity-${index}`).value),
            };
            byId(`speaker-avatar-geometry-${index}`).value = JSON.stringify(metadata);
            update();
          });
        }
        const animSelect = byId(`speaker-avatar-animation-${index}`);
        if (animSelect) {
          animSelect.addEventListener("change", () => {
            try {
              const currentGeo = JSON.parse(
                byId(`speaker-avatar-geometry-${index}`)?.value || "{}",
              );
              currentGeo.animation = animSelect.value;
              byId(`speaker-avatar-geometry-${index}`).value = JSON.stringify(currentGeo);
            } catch {}
            renderSpeakerCanvas(index);
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
              invalidate(index);
              detectStatus(index, "Manual adjustment applied.");
              renderSpeakerCanvas(index);
            });
          }
        }
        byId(`speaker-avatar-detect-${index}`).addEventListener("click", () => detectMouth(index));
        const uploadInput = byId(`speaker-avatar-upload-${index}`);
        if (uploadInput) {
          uploadInput.addEventListener("change", () => {
            const file = uploadInput.files?.[0];
            if (!file) return;
            invalidate(index);
            const uploadRevision = revisions.get(index);
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
                if (avatarId && selectEl && revisions.get(index) === uploadRevision) {
                  let exists = false;
                  for (const opt of Array.from(selectEl.options)) {
                    if (opt.value === avatarId) exists = true;
                  }
                  if (!exists) {
                    const opt = element("option", "", avatarId);
                    opt.value = avatarId;
                    selectEl.append(opt);
                    labelPortraitOptions(selectEl);
                  }
                  selectEl.value = avatarId;
                  loadedImages.delete(avatarId);
                  byId(`speaker-avatar-geometry-${index}`).value = JSON.stringify({
                    animation: byId(`speaker-avatar-animation-${index}`)?.value,
                    motion: readMouthMetadata(index).motion,
                  });
                  detectMouth(index);
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
            const calibration = readMouthMetadata(index).calibration;
            const imageId = byId(`speaker-avatar-image-${index}`).value;
            if (calibration && imageHashes.get(imageId) !== calibration.imageSha256) {
              detectStatus(
                index,
                "This photo has changed. Detect the mouth again before testing or producing.",
              );
              return;
            }
            const duration = 8;
            const track = createMotionTrack(
              [
                { text: "How does this work?", startSeconds: 0.4, endSeconds: 2.6 },
                { text: "Here is the useful part.", startSeconds: 3.4, endSeconds: 6.3 },
              ],
              duration,
              `speaker-${index}`,
              readMouthMetadata(index).motion,
            );
            const shapes = ["open_a", "consonant", "open_o", "open_e", "open_u"];
            let step = 0;
            testBtn.disabled = true;
            const timer = setInterval(() => {
              const time = step++ / 30;
              if (time >= duration) {
                clearInterval(timer);
                testBtn.disabled = false;
                renderSpeakerCanvas(index, 0, "rest", true);
                return;
              }
              const speaking = (time >= 0.4 && time < 2.6) || (time >= 3.4 && time < 6.3);
              const viseme = speaking ? shapes[Math.floor(time * 6) % shapes.length] : "rest";
              const jawOpen = speaking ? 0.5 : 0;
              renderSpeakerCanvas(index, jawOpen, viseme, false, {
                ...sampleMotionTrack(track, time),
                jawOpen,
                viseme,
              });
            }, 1000 / 30);
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
    byId("discard-draft").hidden = !recoveredDraft;
    readDraft();
    if (!editorEnabled) {
      setupAuditioning();
      editorEnabled = true;
    }
    for (const [index] of seed.presentation.speakers.entries()) refreshAvatarUi(index);
    showStep(editorStep);
  }
  function restoreRecovery() {
    if (!pendingRecovery) return;
    // A native select drops values that are not yet in its option list.
    // Restore validated image options before the asynchronous saved-photo list loads.
    for (const [index] of seed.presentation.speakers.entries()) {
      const id = `speaker-avatar-image-${index}`;
      const value = pendingRecovery[id];
      const select = byId(id);
      if (
        value &&
        /^[a-z0-9][a-z0-9._-]{0,63}\.(png|jpg|jpeg|webp)$/iu.test(value) &&
        !Array.from(select.options).some((option) => option.value === value)
      ) {
        const option = element("option", "", value);
        option.value = value;
        select.append(option);
        labelPortraitOptions(select);
      }
    }
    for (const [index] of seed.presentation.speakers.entries()) {
      const value = pendingRecovery[`speaker-voice-${index}`];
      const select = byId(`speaker-voice-${index}`);
      if (
        value.startsWith("qwen:") &&
        !Array.from(select.options).some((option) => option.value === value)
      ) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = "My voice · restored revision (checked at production)";
        select.append(option);
      }
    }
    for (const id of fieldIds) byId(id).value = pendingRecovery[id];
    lastSavedFields = JSON.stringify(rawFields());
    pendingRecovery = null;
    recoveredDraft = true;
    recoveryMessage(
      "Recovered this tab's unsaved changes. Continue editing, or choose Start with original to return to the starting script.",
    );
    enableEditor();
  }
  byId("resume-draft").addEventListener("click", restoreRecovery);
  byId("discard-draft").addEventListener("click", () => {
    if (!pendingRecovery && !recoveredDraft) return;
    pendingRecovery = null;
    recoveredDraft = false;
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
  if (pendingRecovery) restoreRecovery();
  else enableEditor();
})();
