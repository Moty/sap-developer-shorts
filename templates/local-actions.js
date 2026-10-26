(() => {
  const buttons = () => Array.from(document.querySelectorAll("[data-local-action]"));
  if (!buttons().length) return;
  let ready = false;
  let running = false;
  let leaving = false;
  const audioUrls = new Map();
  const scopes = (job) => {
    const found = new Set();
    for (const button of buttons())
      if (
        button.dataset.localAction === job.action &&
        (!job.voice || button.dataset.voice === job.voice)
      ) {
        const scope = button.closest("[data-local-action-scope]");
        if (scope) found.add(scope);
      }
    return [...found];
  };
  function message(job) {
    const text = [job.message, job.result?.warning].filter(Boolean).join(" ");
    const globalStatus = document.getElementById("local-actions-status");
    if (globalStatus) globalStatus.textContent = text;
    for (const scope of scopes(job)) {
      const status = scope.querySelector("[data-local-action-status]");
      if (status) status.textContent = text;
    }
  }
  function enableButtons() {
    for (const button of buttons())
      button.disabled =
        !ready ||
        running ||
        button.dataset.currentDefault === "true" ||
        button.dataset.needsInstall === "true";
  }
  async function request(path, body) {
    const response = await fetch(
      path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Studio action could not finish.");
    return data;
  }
  async function finish(job) {
    if (job.state !== "SUCCEEDED") return;
    if (job.action === "voice-install") {
      for (const button of buttons())
        if (button.dataset.voice === job.voice) {
          delete button.dataset.needsInstall;
          if (button.dataset.localAction === "voice-install") {
            button.dataset.localAction = "voice-audition";
            button.textContent = "Generate voice sample";
          }
        }
    }
    if (job.result?.selected) {
      for (const button of buttons())
        if (button.dataset.localAction === "voice-default") {
          button.dataset.currentDefault = String(button.dataset.voice === job.result.selected);
          button.textContent =
            button.dataset.currentDefault === "true"
              ? "Default narrator"
              : "Set as default narrator";
        }
      const label = document.getElementById("default-voice-label");
      if (label) {
        const selected = buttons().find((button) => button.dataset.voice === job.result.selected);
        label.textContent = `Default: ${selected?.dataset.voiceLabel || job.result.selected}`;
      }
      for (const badge of document.querySelectorAll("[data-default-voice]"))
        badge.hidden = badge.dataset.defaultVoice !== job.result.selected;
    }
    if (job.result?.audioUrl) {
      const response = await fetch(job.result.audioUrl);
      if (!response.ok)
        throw new Error(
          "The sample was saved, but playback could not load. Refresh the studio to listen.",
        );
      const blob = await response.blob();
      for (const scope of scopes(job)) {
        const metadata = scope.querySelector(".voice-meta");
        if (metadata?.textContent?.startsWith("Installed but no current sample"))
          metadata.textContent = `Saved sample · ${Number(job.result.durationSeconds).toFixed(1)} seconds`;
        let player = scope.querySelector("[data-local-action-audio]");
        if (!player) {
          player = document.createElement("audio");
          player.controls = true;
          player.dataset.localActionAudio = "";
          scope.append(player);
        }
        const old = audioUrls.get(player);
        if (old) URL.revokeObjectURL(old);
        const url = URL.createObjectURL(blob);
        audioUrls.set(player, url);
        player.src = url;
        player.hidden = false;
        player.setAttribute("aria-label", `${job.voice} voice sample`);
      }
    }
    const refresh = document.getElementById("local-actions-refresh");
    if (refresh && job.result?.libraryUpdated) refresh.hidden = false;
    window.dispatchEvent(new CustomEvent("shorts-local-action-complete", { detail: job }));
  }
  async function watch(job) {
    running = true;
    enableButtons();
    message(job);
    try {
      while (job.state === "RUNNING" && !leaving) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (leaving) return;
        job = await request(`/api/local-actions/${encodeURIComponent(job.id)}`);
        message(job);
      }
      if (!leaving) await finish(job);
    } finally {
      running = false;
      enableButtons();
    }
  }
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-local-action]");
    if (!button || button.disabled || !ready || running) return;
    const input = {
      action: button.dataset.localAction,
      ...(button.dataset.voice ? { voice: button.dataset.voice } : {}),
    };
    running = true;
    enableButtons();
    message({ ...input, message: "Starting on this Mac…" });
    try {
      const job = await request("/api/local-actions", input);
      await watch(job);
    } catch (error) {
      running = false;
      enableButtons();
      message({ ...input, message: `${error.message} You can retry from this page.` });
    }
  });
  window.addEventListener("pagehide", () => {
    leaving = true;
    for (const url of audioUrls.values()) URL.revokeObjectURL(url);
    audioUrls.clear();
  });
  async function connect() {
    try {
      await request("/api/local-voices/session");
      const current = await request("/api/local-actions");
      ready = true;
      enableButtons();
      const help = document.getElementById("local-actions-help");
      if (help)
        help.textContent =
          "Actions run on this Mac. Model setup downloads the required files; only one action runs at a time.";
      if (current.job?.state === "RUNNING") await watch(current.job);
    } catch {
      const help = document.getElementById("local-actions-help");
      if (help)
        help.textContent =
          "Open this page in the running localhost studio to use voice and setup buttons. Saved samples remain playable in exported copies.";
    }
  }
  void connect();
})();
