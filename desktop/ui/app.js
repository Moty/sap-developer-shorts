(() => {
  const api = window.desktop;
  let state = {};
  const labels = {
    startup: "Workspace preparation",
    kokoro: "Stock narration",
    qwen: "Voice cloning",
    portrait: "Realistic portraits",
    face: "Photo alignment",
    test: "Sample video",
    "worker-register": "Device pairing",
  };
  const installLabels = {
    kokoro: "Install stock voices",
    qwen: "Install voice cloning",
    portrait: "Install portrait engine",
    face: "Install photo alignment",
  };
  const error = document.getElementById("error");
  function errorMessage(message) {
    return String(message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, "");
  }
  function failure(message) {
    error.hidden = false;
    error.textContent = `This step needs attention. ${errorMessage(message)}`;
    document.getElementById("activity-details").open = true;
  }
  function render(value) {
    state = value;
    const busy = !!state.task || state.busy || state.worker === "running";
    const ready = document.getElementById("readiness");
    ready.textContent = state.error
      ? "Setup needs attention"
      : state.task
        ? "Setup running"
        : state.ready
          ? "Studio ready"
          : "Preparing…";
    ready.classList.toggle("ready", !!state.ready && !state.error && !state.task);
    document.getElementById("workspace-readiness").textContent = state.studioUrl
      ? "Your studio is ready for writing. Rendering uses the tools you install below."
      : state.error
        ? "Your studio could not finish preparing. Check the activity log for the next step."
        : "Preparing your local studio…";
    const engineKeys = Object.keys(installLabels);
    const checked = engineKeys.filter((key) => typeof state.engines?.[key] === "boolean");
    const installed = checked.filter((key) => state.engines[key] && state.task?.action !== key);
    document.getElementById("engine-count").textContent = checked.length ? installed.length : "—";
    document.getElementById("engine-summary").textContent =
      checked.length === engineKeys.length
        ? `${installed.length} of ${engineKeys.length} rendering tools ready`
        : state.error
          ? state.canRetryStartup
            ? "Tool checks did not finish · retry workspace preparation"
            : "Tool checks did not finish · restart the app"
          : "Checking rendering tools…";
    document.getElementById("studio").disabled = !state.studioUrl;
    error.hidden = !state.error;
    error.textContent = state.error
      ? `This step needs attention. ${errorMessage(state.error)}`
      : "";
    for (const item of document.querySelectorAll("[data-status]")) {
      const key = item.dataset.status;
      const installed = state.engines?.[key];
      const active = state.task?.action === key;
      item.textContent = active
        ? installed
          ? "Verifying / repairing…"
          : "Installing…"
        : installed
          ? "Ready"
          : typeof installed === "boolean"
            ? "Not installed"
            : state.error
              ? "Not checked"
              : "Checking…";
      item.classList.toggle("ready", !!installed && !active);
      item.classList.toggle("active", active);
    }
    for (const button of document.querySelectorAll("[data-action]")) {
      const action = button.dataset.action;
      if (action === "retry-startup") {
        button.hidden = !state.canRetryStartup || !!state.ready || !state.error;
        button.disabled = !!state.task;
        continue;
      }
      button.disabled =
        !state.ready ||
        (action === "worker-stop" ? state.worker !== "running" : busy) ||
        (action === "test" && !state.engines?.kokoro);
      if (installLabels[action])
        button.textContent =
          state.task?.action === action
            ? "Setup in progress…"
            : state.engines?.[action]
              ? "Verify / repair"
              : installLabels[action];
    }
    document.getElementById("pair").disabled = !state.ready || busy;
    document.getElementById("worker-status").textContent =
      state.worker === "running" ? "Running" : "Stopped";
    document.getElementById("task").textContent = state.task
      ? `${labels[state.task.action] || state.task.action} · in progress`
      : state.busy
        ? "Production is running in the studio"
        : state.worker === "running"
          ? "Worker online · waiting for compatible jobs"
          : state.error
            ? "Setup needs attention · see the activity log"
            : state.ready
              ? "Your workspace is ready"
              : "Preparing the workspace…";
    document.getElementById("progress").hidden =
      !!state.error || (!state.task && !state.busy && state.ready);
    document.getElementById("logs").textContent = (state.logs || []).join("\n");
    if (state.error || state.task?.action === "worker-register")
      document.getElementById("activity-details").open = true;
    document.getElementById("version").textContent = `Apple Silicon · ${state.version || "0.1.0"}`;
    document.getElementById("revision").textContent = state.revision?.slice(0, 7) || "";
  }
  const call = async (input) => {
    try {
      error.hidden = true;
      await api.action(input);
    } catch (e) {
      failure(e.message);
    }
  };
  for (const button of document.querySelectorAll("[data-page]"))
    button.addEventListener("click", () => {
      if (!state.error) error.hidden = true;
      window.scrollTo({ top: 0, behavior: "instant" });
      for (const page of ["create", "worker"])
        document.getElementById(page).hidden = page !== button.dataset.page;
      for (const item of document.querySelectorAll("[data-page]")) {
        if (item === button) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
    });
  for (const button of document.querySelectorAll("[data-action]"))
    button.addEventListener("click", () => call({ action: button.dataset.action }));
  document
    .getElementById("studio")
    .addEventListener("click", () => api.openStudio().catch((e) => failure(e.message)));
  document
    .getElementById("files")
    .addEventListener("click", () => api.showFiles().catch((e) => failure(e.message)));
  document.getElementById("pairing").addEventListener("submit", (event) => {
    event.preventDefault();
    void call({
      action: "worker-register",
      origin: document.getElementById("origin").value,
      name: document.getElementById("device").value,
    });
  });
  setInterval(() => {
    document.getElementById("elapsed").textContent = state.task
      ? `${Math.floor((Date.now() - Date.parse(state.task.startedAt)) / 1000)}s elapsed`
      : "";
  }, 1000);
  document
    .getElementById("online")
    .addEventListener("click", () =>
      api
        .openOnlineStudio(document.getElementById("origin").value)
        .catch((e) => failure(e.message)),
    );
  api.subscribe(render);
  api
    .state()
    .then(render)
    .catch((e) => failure(e.message));
})();
