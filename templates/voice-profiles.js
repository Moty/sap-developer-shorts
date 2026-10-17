(() => {
  const byId = (id) => document.getElementById(id);
  if (!byId("my-voice-panel")) return;
  const key = (voice) =>
    typeof voice === "string" ? voice : `qwen:${voice.profileId}:${voice.revision}`;
  const state = {
    profiles: [],
    current: null,
    blob: null,
    recording: null,
    stream: null,
    context: null,
  };
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
    state.auditionFor = null;
    state.current = profile?.voice ?? null;
    byId("my-voice-reference").hidden = !profile;
    if (profile) byId("my-voice-reference").src = audioUrl(profile.voice, "reference");
    byId("my-voice-generate").disabled = !profile;
    byId("my-voice-delete").disabled = !profile;
    byId("my-voice-accept").disabled = true;
    byId("my-voice-audition").hidden = true;
    if (profile)
      message(
        `${profile.name} · ${profile.durationSeconds.toFixed(1)}s · ${profile.accepted ? "Ready to use" : "Generate and listen to an audition"}${profile.warnings?.length ? ` · ${profile.warnings.join(" ")}` : ""}`,
      );
  }
  async function refresh(preserve) {
    const data = await request("");
    state.profiles = data.profiles;
    byId("my-voice-runtime").textContent = data.runtime.ready
      ? "Qwen voice cloning is ready on this Mac."
      : data.runtime.message;
    const select = byId("my-voice-saved");
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a saved voice";
    select.append(placeholder);
    for (const profile of state.profiles) {
      const option = document.createElement("option");
      option.value = key(profile.voice);
      option.textContent = `${profile.name}${profile.accepted ? " · Ready" : " · Audition needed"}`;
      select.append(option);
      if (!profile.accepted) continue;
      for (const speakerSelect of document.querySelectorAll('[id^="speaker-voice-"]')) {
        if (speakerSelect.tagName !== "SELECT") continue;
        let item = Array.from(speakerSelect.options).find((item) => item.value === option.value);
        if (!item) {
          item = document.createElement("option");
          item.value = option.value;
          speakerSelect.append(item);
        }
        item.textContent = `My voice · ${profile.name}`;
      }
    }
    if (preserve) select.value = preserve;
    showSaved();
  }
  function loadBlob(blob) {
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blob = blob;
    state.blobUrl = URL.createObjectURL(blob);
    const player = byId("my-voice-upload-preview");
    player.src = state.blobUrl;
    player.hidden = false;
    player.onloadedmetadata = () => {
      if (Number.isFinite(player.duration))
        byId("my-voice-end").value = Math.min(15, player.duration).toFixed(2);
    };
    message("Preview the recording, select the excerpt, and enter exactly what is spoken in it.");
  }
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
    byId("my-voice-transcript").value =
      "Let's make SAP a little simpler. I'll show you one useful idea, walk through an example, and check the result together. Ready? Let's give it a try.";
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
    button.disabled = true;
    let stream = null;
    let context = null;
    const cleanup = () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (context && context.state !== "closed") context.close().catch(() => {});
      if (state.stream === stream) state.stream = null;
      button.textContent = "Record sample";
      button.disabled = false;
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("Microphone recording is unavailable here.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
          loadBlob(new Blob(chunks, { type: recorder.mimeType }));
        } finally {
          cleanup();
        }
      };
      recorder.onerror = () => {
        cleanup();
        message("Recording failed. Upload a recording instead.");
      };
      recorder.start();
      state.recordingTimer = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 120000);
      button.textContent = "Stop recording";
      button.disabled = false;
      message("Recording. Speak naturally, then press Stop. Recording stops after two minutes.");
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
      if (!state.blob) throw new Error("Record or upload an audio sample first.");
      if (state.blob.size > 30 * 1024 * 1024) throw new Error("Choose a recording up to 30 MiB.");
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
        startSeconds: Number(byId("my-voice-start").value),
        endSeconds: Number(byId("my-voice-end").value),
      });
      await refresh(key(result.voice));
      byId("my-voice-transcript").value = "";
      byId("my-voice-file").value = "";
      byId("my-voice-consent").checked = false;
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
    const voice = state.current ? structuredClone(state.current) : null;
    const selection = state.selection;
    try {
      if (!voice) return;
      message("Generating a local audition. Allow about half a minute…");
      await request("/audition", { voice });
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
      await request("/accept", { voice });
      if (selection !== state.selection) return;
      await refresh(key(voice));
      const select = byId(`speaker-voice-${byId("my-voice-speaker").value}`);
      select.value = key(voice);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      message("Voice accepted and selected. Save your draft, or produce the video.");
    } catch (error) {
      message(error.message);
    }
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
  request("/session")
    .then(() => refresh())
    .catch(() => {
      byId("my-voice-controls").hidden = true;
      byId("my-voice-runtime").textContent =
        "My voice is available in the localhost studio on the Mac that renders your shorts.";
    });
})();
