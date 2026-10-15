(() => {
  const { seed, scenes, reservedNames, availableVoices } = JSON.parse(
    document.getElementById("editor-data").textContent,
  );
  const byId = (id) => document.getElementById(id);
  const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
  const download = byId("download-script");
  const status = byId("download-status");
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
    return { draft, errors };
  }
  const update = () => {
    status.textContent = "";
    readDraft();
  };
  byId("editor-fields").addEventListener("input", update);
  byId("editor-fields").addEventListener("change", update);
  download.addEventListener("click", () => {
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
  byId("editor-fields").disabled = false;
  byId("download-controls").hidden = false;
  readDraft();
})();
