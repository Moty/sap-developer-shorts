(() => {
  const byId = (id) => document.getElementById(id);
  if (!byId("my-voice-panel")) return;
  const libraryData = byId("voice-library-data");
  const panelData = JSON.parse(
    (libraryData?.textContent ? libraryData : byId("editor-data")).textContent,
  );
  const library = panelData.voicePanelContext === "library";
  const styles = panelData.voiceStyles ?? [];
  const styleLabel = (id) => styles.find((style) => style.id === id)?.label;
  const acceptLabel = () =>
    library ? "I listened · make available" : "I listened · use this voice";
  const key = (voice) =>
    typeof voice === "string" ? voice : `qwen:${voice.profileId}:${voice.revision}`;
  const state = {
    profiles: [],
    current: null,
    blob: null,
    recording: null,
    stream: null,
    context: null,
    recordingEpoch: 0,
    leaving: false,
    runtimeReady: false,
  };
  globalThis.addEventListener?.("pagehide", () => {
    state.leaving = true;
    state.recordingEpoch++;
    clearTimeout(state.recordingTimer);
    if (state.recording?.state === "recording") state.recording.stop();
    for (const track of state.stream?.getTracks() ?? []) track.stop();
    state.context?.close().catch(() => {});
    if (state.blobUrl) {
      URL.revokeObjectURL(state.blobUrl);
      state.blobUrl = null;
    }
  });
  globalThis.addEventListener?.("pageshow", () => {
    state.leaving = false;
    if (state.blob && !state.blobUrl) {
      state.blobUrl = URL.createObjectURL(state.blob);
      byId("my-voice-upload-preview").src = state.blobUrl;
    }
  });
  globalThis.shortsVoiceProfiles = {
    isAvailable: (value) =>
      state.profiles.some((profile) => profile.accepted && key(profile.voice) === value),
  };
  const status = byId("my-voice-status");
  const message = (text) => {
    status.textContent = text;
  };
  async function request(path, body) {
    const response = await fetch(
      `/api/local-voices${path}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Local voice action failed.");
    return result;
  }
  function audioUrl(voice, kind) {
    return `/api/local-voices/audio?voice=${encodeURIComponent(JSON.stringify(voice))}&kind=${kind}`;
  }
  function selected() {
    return state.profiles.find((profile) => key(profile.voice) === byId("my-voice-saved").value);
  }
  function showSaved() {
    const profile = selected();
    state.selection = (state.selection ?? 0) + 1;
    state.auditionFor = profile?.auditionReady ? key(profile.voice) : null;
    state.current = profile?.voice ?? null;
    byId("my-voice-reference").hidden = !profile;
    if (profile) byId("my-voice-reference").src = audioUrl(profile.voice, "reference");
    byId("my-voice-generate").disabled = !profile || !state.runtimeReady;
    byId("my-voice-delete").disabled = !profile;
    byId("my-voice-accept").disabled = !profile?.auditionReady || !!(library && profile?.accepted);
    byId("my-voice-accept").textContent = profile?.accepted
      ? library
        ? "Accepted · ready for episodes"
        : "Use this saved voice"
      : acceptLabel();
    byId("my-voice-audition").hidden = !profile?.auditionReady;
    if (profile?.auditionReady)
      byId("my-voice-audition").src =
        `${audioUrl(profile.voice, "audition")}&v=${profile.audition?.sha256 ?? "saved"}`;
    if (profile)
      message(
        `${profile.name} · ${profile.durationSeconds.toFixed(1)}s · ${profile.accepted ? "Ready to use" : profile.auditionReady ? "Listen to the saved audition, then use this voice" : "Sample saved. Next: generate and listen to an audition"}${profile.warnings?.length ? ` · ${profile.warnings.join(" ")}` : ""}`,
      );
    else message("Choose a saved recording, or open Add a voice style to record another take.");
    if (styles.length)
      byId("my-voice-style-summary").textContent = profile
        ? profile.style
          ? `${profile.speakerName} · ${styleLabel(profile.style) || profile.styleLabel}`
          : "Original recording · no delivery style label"
        : "";
  }
  globalThis.shortsVoiceProfiles.refresh = () =>
    refresh(state.current ? key(state.current) : undefined);
  function populate(preserve) {
    const filter = styles.length ? byId("my-voice-filter").value || "all" : "all";
    const visible = state.profiles.filter(
      (profile) =>
        filter === "all" || (filter === "unlabelled" ? !profile.style : profile.style === filter),
    );
    const select = byId("my-voice-saved");
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a saved voice";
    select.append(placeholder);
    for (const profile of visible) {
      const option = document.createElement("option");
      option.value = key(profile.voice);
      option.textContent = `${profile.name}${profile.accepted ? " · Ready" : " · Audition needed"}`;
      select.append(option);
    }
    for (const profile of state.profiles) {
      const value = key(profile.voice);
      for (const speakerSelect of document.querySelectorAll('[id^="speaker-voice-"]')) {
        if (speakerSelect.tagName !== "SELECT") continue;
        let item = Array.from(speakerSelect.options).find((item) => item.value === value);
        if (!item && !profile.accepted) continue;
        if (!item) {
          item = document.createElement("option");
          item.value = value;
          speakerSelect.append(item);
        }
        item.textContent = `My voice · ${profile.name}${profile.accepted ? "" : " · Audition needed"}`;
      }
    }
    const assigned = library
      ? null
      : byId(`speaker-voice-${byId("my-voice-speaker").value || "0"}`)?.value;
    if (preserve && visible.some((profile) => key(profile.voice) === preserve))
      select.value = preserve;
    else if (visible.some((profile) => key(profile.voice) === assigned)) select.value = assigned;
    if (styles.length)
      byId("my-voice-count").textContent =
        `${visible.length} of ${state.profiles.length} recordings shown. Each take keeps its own audition and approval.`;
    showSaved();
  }
  async function refresh(preserve, stillCurrent = () => true) {
    const data = await request("");
    if (!stillCurrent()) return null;
    state.profiles = data.profiles;
    state.runtimeReady = data.runtime.ready;
    byId("my-voice-runtime").textContent = data.runtime.ready
      ? "Qwen voice cloning is ready on this Mac."
      : "Personal voice tools need setup. Open Personal voice tools above and choose Set up personal voice tools.";
    if (styles.length && preserve) {
      const profile = state.profiles.find((item) => key(item.voice) === preserve);
      const filter = byId("my-voice-filter");
      if (profile && filter.value !== "all" && filter.value !== profile.style)
        filter.value = profile.style ?? "unlabelled";
    }
    populate(preserve);
    document.dispatchEvent?.(new Event("shorts:voices-ready"));
    return state.selection;
  }
  const passages = panelData.voiceReadingScripts;
  const passageChoice = byId("my-voice-reading-choice");
  const selectedPassage = () =>
    passages.find((passage) => passage.id === passageChoice.value) ?? passages[0];
  function showPassage() {
    const passage = selectedPassage();
    byId("my-voice-reading-text").textContent = passage.text;
    byId("my-voice-reading-guidance").textContent = passage.guidance;
  }
  passageChoice.addEventListener("change", showPassage);
  showPassage();
  function recordingStep(review) {
    if (!styles.length) return;
    byId("my-voice-record-pane").hidden = review;
    byId("my-voice-review-pane").hidden = !review;
  }
  if (styles.length) {
    byId("my-voice-filter").addEventListener("change", () =>
      populate(state.current ? key(state.current) : undefined),
    );
    byId("my-voice-style").addEventListener("change", () => {
      const style = styles.find((option) => option.id === byId("my-voice-style").value);
      if (style) {
        passageChoice.value = style.readingScript;
        showPassage();
      }
      byId("my-voice-style-guidance").textContent = state.blob
        ? "Check that your recording matches this delivery, or record another take. Style labels do not change the recorded audio."
        : "Read with the delivery you want for this style. Use the passage as your transcript if you read it exactly.";
    });
    byId("my-voice-review-next").addEventListener("click", () => {
      if (state.blob) recordingStep(true);
    });
    byId("my-voice-review-back").addEventListener("click", () => recordingStep(false));
  }
  function lockRecording(locked) {
    for (const id of [
      "my-voice-file",
      "my-voice-reading-choice",
      "my-voice-reading-script",
      "my-voice-transcript",
      "my-voice-start",
      "my-voice-end",
      "my-voice-save",
    ])
      byId(id).disabled = locked;
    if (styles.length)
      for (const id of [
        "my-voice-name",
        "my-voice-style",
        "my-voice-review-next",
        "my-voice-review-back",
      ])
        byId(id).disabled = locked;
    if (styles.length && !locked) byId("my-voice-review-next").disabled = !state.blob;
  }
  function loadBlob(blob, recordedDuration) {
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blob = blob;
    state.fullRecording = recordedDuration !== undefined;
    state.blobUrl = URL.createObjectURL(blob);
    const player = byId("my-voice-upload-preview");
    player.src = state.blobUrl;
    player.hidden = false;
    byId("my-voice-start").value = "0";
    const setEnd = (duration) => {
      byId("my-voice-end").value = (duration <= 30 ? duration : 15).toFixed(2);
    };
    if (recordedDuration) setEnd(recordedDuration);
    player.onloadedmetadata = () => {
      if (Number.isFinite(player.duration)) setEnd(player.duration);
    };
    message("Preview the recording, select the excerpt, and enter exactly what is spoken in it.");
    if (styles.length) {
      byId("my-voice-review-next").disabled = false;
      recordingStep(true);
    }
  }
  for (const id of ["my-voice-start", "my-voice-end"])
    byId(id).addEventListener("input", () => {
      state.fullRecording = false;
    });
  byId("my-voice-file").addEventListener("change", () => {
    const file = byId("my-voice-file").files[0];
    if (file) loadBlob(file);
  });
  byId("my-voice-preview-trim").addEventListener("click", () => {
    const player = byId("my-voice-upload-preview");
    player.currentTime = Number(byId("my-voice-start").value);
    player.play().catch((error) => message(error.message));
    player.ontimeupdate = () => {
      if (player.currentTime >= Number(byId("my-voice-end").value)) player.pause();
    };
  });
  byId("my-voice-reading-script").addEventListener("click", () => {
    byId("my-voice-transcript").value = selectedPassage().text;
    message(
      "Transcript filled. Read these exact words, or edit it to match the selected excerpt before saving.",
    );
  });
  byId("my-voice-record").addEventListener("click", async () => {
    const button = byId("my-voice-record");
    if (state.recordingPending) return;
    if (state.recording?.state === "recording") {
      button.disabled = true;
      state.recording.stop();
      return;
    }
    state.recordingPending = true;
    lockRecording(true);
    button.disabled = true;
    let stream = null;
    let context = null;
    const cleanup = () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (context && context.state !== "closed") context.close().catch(() => {});
      if (state.stream === stream) state.stream = null;
      button.textContent = "Record sample";
      button.disabled = false;
      lockRecording(false);
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("Microphone recording is unavailable here.");
      const epoch = state.recordingEpoch;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (state.leaving || epoch !== state.recordingEpoch) {
        for (const track of stream.getTracks()) track.stop();
        throw new Error(
          "Recording was stopped when you left this page. Start a new take when ready.",
        );
      }
      state.stream = stream;
      context = new AudioContext();
      state.context = context;
      const source = context.createMediaStreamSource(stream);
      const meter = context.createAnalyser();
      source.connect(meter);
      const samples = new Uint8Array(meter.fftSize);
      const updateMeter = () => {
        if (state.stream !== stream) return;
        meter.getByteTimeDomainData(samples);
        byId("my-voice-meter").value =
          Math.max(...samples.map((value) => Math.abs(value - 128))) / 128;
        requestAnimationFrame(updateMeter);
      };
      updateMeter();
      const recorder = new MediaRecorder(stream);
      state.recording = recorder;
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        clearTimeout(state.recordingTimer);
        try {
          if (state.leaving || epoch !== state.recordingEpoch) return;
          loadBlob(
            new Blob(chunks, { type: recorder.mimeType }),
            Math.min(29.9, (Date.now() - state.recordingStarted) / 1000),
          );
        } finally {
          cleanup();
        }
      };
      recorder.onerror = () => {
        cleanup();
        message("Recording failed. Upload a recording instead.");
      };
      recorder.start();
      state.recordingStarted = Date.now();
      state.recordingTimer = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 29000);
      button.textContent = "Stop recording";
      button.disabled = false;
      message(
        "Recording. Read the passage naturally, then press Stop. Auto-stop at 29 seconds; uploads can be longer with a selected excerpt.",
      );
    } catch (error) {
      cleanup();
      message(`${error.message} You can upload a recording instead.`);
    } finally {
      state.recordingPending = false;
    }
  });
  byId("my-voice-save").addEventListener("click", async () => {
    const button = byId("my-voice-save");
    button.disabled = true;
    try {
      if (state.recordingPending || state.recording?.state === "recording")
        throw new Error("Stop recording before saving.");
      if (!state.blob) throw new Error("Record or upload an audio sample first.");
      if (state.blob.size > 30 * 1024 * 1024) throw new Error("Choose a recording up to 30 MiB.");
      const style = styles.find((option) => option.id === byId("my-voice-style").value);
      if (styles.length && (!style || !byId("my-voice-name").value.trim()))
        throw new Error("Enter the speaker name and choose a recording style.");
      const audio = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(state.blob);
      });
      message("Checking and saving your selected voice sample on this Mac…");
      const result = await request("/enroll", {
        audio,
        name: byId("my-voice-name").value,
        transcript: byId("my-voice-transcript").value,
        consent: byId("my-voice-consent").checked,
        ...(style ? { speakerName: byId("my-voice-name").value.trim(), style: style.id } : {}),
        ...(state.fullRecording
          ? {}
          : {
              startSeconds: Number(byId("my-voice-start").value),
              endSeconds: Number(byId("my-voice-end").value),
            }),
      });
      await refresh(key(result.voice));
      byId("my-voice-transcript").value = "";
      byId("my-voice-file").value = "";
      byId("my-voice-consent").checked = false;
      state.blob = null;
      state.fullRecording = false;
      if (state.blobUrl) {
        URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = null;
      }
      byId("my-voice-upload-preview").hidden = true;
      if (styles.length) {
        byId("my-voice-enrollment").open = false;
        byId("my-voice-review-next").disabled = true;
        recordingStep(false);
      }
    } catch (error) {
      message(error.message);
    } finally {
      button.disabled = false;
    }
  });
  byId("my-voice-generate").addEventListener("click", async () => {
    const button = byId("my-voice-generate");
    button.disabled = true;
    byId("my-voice-accept").disabled = true;
    state.auditionFor = null;
    byId("my-voice-audition").hidden = true;
    byId("my-voice-accept").textContent = acceptLabel();
    const voice = state.current ? structuredClone(state.current) : null;
    const selection = state.selection;
    try {
      if (!voice) return;
      message("Generating a local audition. Allow about half a minute…");
      await request("/audition", { voice });
      const profile = state.profiles.find((item) => key(item.voice) === key(voice));
      if (profile) {
        profile.auditionReady = true;
        profile.accepted = false;
        delete profile.audition;
        const option = Array.from(byId("my-voice-saved").options).find(
          (item) => item.value === key(voice),
        );
        if (option) option.textContent = `${profile.name} · Audition needed`;
        for (const select of document.querySelectorAll('[id^="speaker-voice-"]')) {
          if (select.tagName !== "SELECT") continue;
          const item = Array.from(select.options).find((item) => item.value === key(voice));
          if (item) item.textContent = `My voice · ${profile.name} · Audition needed`;
        }
      }
      if (selection !== state.selection || !state.current || key(state.current) !== key(voice))
        return;
      state.auditionFor = key(voice);
      const player = byId("my-voice-audition");
      player.src = `${audioUrl(voice, "audition")}&t=${Date.now()}`;
      player.hidden = false;
      byId("my-voice-accept").disabled = false;
      message("Listen to the whole audition, then accept it if the voice sounds right.");
    } catch (error) {
      if (selection === state.selection) message(error.message);
    } finally {
      button.disabled = !state.current;
    }
  });
  byId("my-voice-accept").addEventListener("click", async () => {
    try {
      if (!state.current || state.auditionFor !== key(state.current))
        throw new Error("Generate an audition for the selected voice first.");
      const voice = structuredClone(state.current);
      const selection = state.selection;
      if (library) {
        const stillCurrent = () => selection === state.selection;
        await request("/accept", { voice });
        if (!stillCurrent()) return;
        const refreshed = await refresh(key(voice), stillCurrent);
        if (
          refreshed !== null &&
          refreshed === state.selection &&
          state.current &&
          key(state.current) === key(voice)
        )
          message(
            "Voice accepted. Choose this recording under My voice in an episode's Voice & portrait step.",
          );
        return;
      }
      const speaker = byId("my-voice-speaker").value || "0";
      const select = byId(`speaker-voice-${speaker}`);
      const previousVoice = select.value;
      const sameTarget = () =>
        (byId("my-voice-speaker").value || "0") === speaker && select.value === previousVoice;
      const stillCurrent = () => selection === state.selection && sameTarget();
      await request("/accept", { voice });
      if (!stillCurrent()) return;
      const refreshed = await refresh(key(voice), stillCurrent);
      if (refreshed === null || refreshed !== state.selection || !sameTarget()) return;
      select.value = key(voice);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      message("Voice accepted and selected. Save your draft, or produce the video.");
    } catch (error) {
      message(error.message);
    }
  });
  byId("my-voice-speaker").addEventListener("change", showSaved);
  for (const select of document.querySelectorAll('[id^="speaker-voice-"]'))
    if (select.tagName === "SELECT")
      select.addEventListener("change", () => {
        state.selection = (state.selection ?? 0) + 1;
      });
  byId("my-voice-delete").addEventListener("click", async () => {
    try {
      if (!state.current) return;
      if (
        !confirm(
          "Delete this voice's source sample and every saved revision? This cannot be undone. Finished videos and exported audio will remain available.",
        )
      )
        return;
      const value = key(state.current);
      await request("/delete", { voice: state.current });
      await refresh();
      for (const select of document.querySelectorAll('[id^="speaker-voice-"]'))
        if (select.tagName === "SELECT") {
          const item = Array.from(select.options).find((item) => item.value === value);
          if (item) item.textContent = "My voice · unavailable on this Mac";
        }
      message(
        "Voice sample and its private auditions deleted. Existing finished videos remain available.",
      );
    } catch (error) {
      message(error.message);
    }
  });
  byId("my-voice-saved").addEventListener("change", showSaved);
  globalThis.addEventListener?.("shorts-local-action-complete", (event) => {
    if (event.detail?.action === "clone-setup")
      void globalThis.shortsVoiceProfiles.refresh().catch((error) => message(error.message));
  });
  request("/session")
    .then(async () => {
      await refresh();
      byId("my-voice-controls").hidden = false;
    })
    .catch(() => {
      byId("my-voice-controls").hidden = true;
      byId("my-voice-runtime").textContent =
        "My voice is available in the localhost studio on the Mac that renders your shorts.";
    });
})();
