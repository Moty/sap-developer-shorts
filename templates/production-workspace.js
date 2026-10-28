(() => {
  const pane = document.getElementById("production-workspace");
  if (!pane) return;
  const byId = (id) => document.getElementById(id);
  const {
    seed,
    writingContext,
    productionHistory = [],
  } = JSON.parse(byId("editor-data").textContent);
  const phases = ["PREFLIGHT", "NARRATION", "RENDER", "LIBRARY"];
  const terminal = (stage) => ["READY", "BLOCKED", "FAILED", "INTERRUPTED"].includes(stage);
  const selectorPattern = /^(?:ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}(?:@[a-z][a-z0-9-]{0,31})?$/u;
  const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
  // Draft recovery hashes change when a saved variant reserves a new name.
  // A production receipt belongs to this originating saved selector instead.
  const storageKey = `shorts:production:${writingContext.selector}`;
  let validation = null;
  let run = null;
  let timer;
  let clock;
  let sequence = 0;
  let leaving = false;
  let blocked = true;
  let sourceBlocked = false;
  let otherJob = null;
  const formatTime = (ms) => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
  };
  const kind = (draft) =>
    draft.presentation.speakers
      .map(
        (speaker) =>
          `${typeof speaker.voice === "string" ? "stock" : "personal"}:${speaker.avatar?.mode === "photo" ? (speaker.avatar.animation === "neural" ? "ditto" : "photo") : "illustrated"}`,
      )
      .sort()
      .join("+");
  function row(id, state, message) {
    const item = pane.querySelector(`[data-production-check="${id}"]`);
    item.dataset.state = state;
    item.querySelector(".production-check-icon").textContent =
      state === "ready" ? "✓" : state === "blocked" ? "!" : "·";
    byId(`production-check-${id}`).textContent = message;
  }
  function refresh() {
    const issues = validation?.issues ?? {};
    const draft = validation?.draft ?? seed;
    const error = (group) => issues[group]?.join(" ") || "";
    row(
      "script",
      error("script") ? "blocked" : "ready",
      error("script") ||
        `${draft.scenes.length} scenes · ${byId("workspace-total-words").textContent}. Actual speech sets the pace.`,
    );
    const voices = draft.presentation.speakers
      .map((_speaker, index) => {
        const select = byId(`speaker-voice-${index}`);
        return select.selectedOptions?.[0]?.textContent || select.value;
      })
      .join(" + ");
    row(
      "voice",
      error("voice") || !validation?.voicesReady ? "blocked" : "ready",
      error("voice") ||
        (validation?.voicesReady
          ? `${voices}. Assets checked again before generation.`
          : `${voices}. Install or accept this voice in Voice & presenter.`),
    );
    const portraits = draft.presentation.speakers.map((speaker) =>
      speaker.avatar?.mode === "photo"
        ? speaker.avatar.animation === "neural"
          ? "Ditto realistic portrait"
          : "Photo animation"
        : "Illustrated presenter",
    );
    row(
      "presenter",
      error("presenter") ? "blocked" : "note",
      error("presenter") ||
        `${portraits.join(" + ")}. Alignment and local runtime are checked during production.`,
    );
    const notice = document.querySelector("[data-news-review-notice]");
    sourceBlocked =
      ["expired", "uncertain"].includes(notice?.dataset.newsReviewState) ||
      notice?.dataset.newsExpired === "true";
    row(
      "sources",
      sourceBlocked ? "blocked" : "note",
      notice
        ? sourceBlocked
          ? "Source review needs attention. Open saved sources before producing."
          : `Saved review through ${notice.dataset.newsValidThrough} (UTC). Re-read the evidence before sharing.`
        : "Saved tutorial sources and local demo checks are verified during production.",
    );
    row(
      "post",
      error("post") ? "blocked" : "ready",
      error("post") ||
        `${draft.publicationText?.length ?? 0} characters · saved with this version.`,
    );
    const review = byId("final-review-panel").dataset.reviewState;
    row(
      "ai",
      review === "current" ? "ready" : "note",
      review === "current"
        ? "Review matches the current wording and evidence."
        : review === "outdated"
          ? "Wording changed. The previous review is outdated; reviewing again is optional."
          : "Optional text review. Production does not require an AI request.",
    );
    const samples = productionHistory
      .filter(
        (sample) =>
          sample.kind === kind(draft) && Number.isFinite(sample.totalMs) && sample.totalMs > 0,
      )
      .map((sample) => sample.totalMs);
    if (samples.length) {
      byId("production-estimate").textContent =
        `About ${formatTime(Math.min(...samples) * 0.75)}–${formatTime(Math.max(...samples) * 1.25)}`;
      byId("production-estimate-basis").textContent =
        `Rough range from ${samples.length} saved fresh production${samples.length === 1 ? "" : "s"} using this voice/portrait pipeline. Hardware, length and caches vary; reused stages are excluded.`;
    } else {
      byId("production-estimate").textContent = "No comparable history yet";
      byId("production-estimate-basis").textContent =
        "Your first fresh production will establish a timing reference. No precise ETA is available.";
    }
    blocked =
      !validation?.enabled ||
      Boolean(validation?.errors.length) ||
      !validation?.voicesReady ||
      sourceBlocked ||
      Boolean(otherJob) ||
      Boolean(run && !terminal(run.stage));
    const reason = !validation?.enabled
      ? "Finish draft recovery or wait for the current save."
      : validation?.errors.length
        ? "Fix the highlighted checklist items before producing."
        : !validation?.voicesReady
          ? "Install or accept the selected voice before producing."
          : sourceBlocked
            ? "Recheck the saved source review before producing."
            : otherJob
              ? `Another production is active: ${otherJob.selector}.`
              : run && !terminal(run.stage)
                ? "This saved version is being produced. You can continue editing or leave this page."
                : "Ready to save this revision and produce on this Mac.";
    byId("produce-script").disabled = blocked;
    byId("produce-script").title = reason;
    byId("draft-errors").textContent = reason;
    byId("draft-errors").dataset.blocked = String(blocked);
    if (document.body.dataset.editorStep === "review") {
      const next = byId("editor-next");
      next.disabled = blocked;
      next.textContent = "Save & produce";
      next.dataset.shortLabel = "Produce";
      next.setAttribute("aria-label", "Save this version and produce video");
      next.setAttribute("aria-describedby", "draft-errors");
    }
  }
  function link(label, href) {
    const item = document.createElement("a");
    item.textContent = label;
    item.href = href;
    item.className = "secondary-btn";
    return item;
  }
  function elapsed() {
    if (!run?.startedAt || !Number.isFinite(Date.parse(run.startedAt))) return;
    const end = terminal(run.stage)
      ? Date.parse(run.updatedAt ?? run.report?.updatedAt ?? "")
      : Date.now();
    const total = run.report?.generationTiming?.totalMs;
    byId("production-run-elapsed").textContent = Number.isFinite(total)
      ? `Measured generation: ${formatTime(total)}`
      : Number.isFinite(end)
        ? `Elapsed: ${formatTime(Math.max(0, end - Date.parse(run.startedAt)))}`
        : "Elapsed time unavailable";
  }
  function renderRun() {
    if (!run) return;
    byId("production-live").hidden = false;
    pane.dataset.productionState = run.stage;
    byId("production-run-title").textContent =
      run.stage === "READY"
        ? run.libraryUpdated === false
          ? "Video produced · workspace refresh pending"
          : "Video ready for review"
        : run.stage === "INTERRUPTED"
          ? "Production was interrupted"
          : ["FAILED", "BLOCKED"].includes(run.stage)
            ? run.accepted
              ? "Your saved version needs attention"
              : "Production could not start"
            : "Producing your video";
    byId("production-run-target").textContent =
      `${run.accepted ? "Saved version" : "Draft revision"}: ${run.selector}`;
    byId("production-run-message").textContent =
      run.stage === "INTERRUPTED"
        ? "No active worker owns this receipt. Open the saved version and produce again to retry; no request was automatically resubmitted."
        : run.message || run.report?.issue?.message || "Preparing the next stage…";
    const position =
      run.stage === "READY" ? phases.length : phases.indexOf(run.report?.failedAt ?? run.stage);
    for (const item of pane.querySelectorAll("[data-production-stage]")) {
      const index = phases.indexOf(item.dataset.productionStage);
      const state =
        run.stage === "READY" || index < position
          ? "done"
          : index === position
            ? terminal(run.stage)
              ? "stopped"
              : "current"
            : "todo";
      item.dataset.state = state;
      item.querySelector("span").textContent =
        state === "done" ? "✓" : state === "stopped" ? "!" : state === "current" ? "●" : "·";
      const timing = run.report?.generationTiming?.stages?.[item.dataset.productionStage];
      item.querySelector("small").textContent = timing?.completedAt
        ? formatTime(timing.elapsedMs)
        : state === "current"
          ? "In progress"
          : state === "stopped"
            ? "Stopped"
            : "";
    }
    const actions = byId("production-run-actions");
    if (terminal(run.stage) && run.accepted && run.libraryUpdated !== false) {
      const prefix = `../../episodes/${encodeURIComponent(run.selector)}`;
      actions.replaceChildren(
        link(
          run.stage === "READY" ? "Review & publish →" : "Open saved version to fix or retry →",
          `${prefix}/${run.stage === "READY" ? "publish" : "edit"}.html`,
        ),
        link("Back to Shorts", "../../review.html#episodes"),
      );
    } else actions.replaceChildren(link("Back to Shorts", "../../review.html#episodes"));
    elapsed();
    refresh();
  }
  function store(value) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Server context remains available when tab storage is blocked. */
    }
  }
  function progress(value) {
    if (["RUNNING", "RECONNECTING"].includes(value.stage) && run)
      value = { ...value, stage: run.stage };
    if (!run && !["PREFLIGHT", "FAILED"].includes(value.stage)) return;
    run = {
      ...(run ?? { selector: `${seed.baseEpisodeId}@${byId("variant-name").value}` }),
      ...value,
    };
    if (value.report?.startedAt) {
      run.startedAt = value.report.startedAt;
      run.updatedAt = value.report.updatedAt;
    }
    if (terminal(run.stage)) {
      ++sequence;
      clearTimeout(timer);
    }
    renderRun();
  }
  async function recover() {
    const ticket = ++sequence;
    clearTimeout(timer);
    let receipt = run?.accepted && run.id ? run : null;
    try {
      receipt ??= JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {
      /* Browser storage is optional. */
    }
    const selector = selectorPattern.test(receipt?.selector ?? "")
      ? receipt.selector
      : writingContext.selector;
    const id = idPattern.test(receipt?.id ?? "") ? receipt.id : null;
    try {
      const response = await fetch(
        `/api/production-context?selector=${encodeURIComponent(selector)}${id ? `&jobId=${encodeURIComponent(id)}` : ""}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (ticket !== sequence || leaving) return;
      if (!response.ok) throw new Error(data.error || "Production status is unavailable.");
      otherJob = data.otherJob;
      if (data.stage) {
        run = { ...data, selector, accepted: true };
        renderRun();
      } else {
        if (id) {
          run = {
            selector,
            stage: "INTERRUPTED",
            message:
              "The exact job receipt is unavailable. Open the saved version to inspect its history.",
            accepted: true,
          };
          renderRun();
        }
        refresh();
      }
      if (data.active || data.otherJob) timer = setTimeout(() => void recover(), 2500);
    } catch (error) {
      if (ticket !== sequence || leaving) return;
      if ((run && !terminal(run.stage)) || otherJob) {
        byId("production-run-message").textContent =
          `Connection unavailable. The job may still be running. ${error.message}`;
        timer = setTimeout(() => void recover(), 5000);
      }
    }
  }
  globalThis.shortsProduction = {
    update(value) {
      validation = value;
      refresh();
    },
    refresh,
    startAttempt(value) {
      ++sequence;
      clearTimeout(timer);
      run = { ...value, stage: "PREFLIGHT", accepted: false };
      renderRun();
      byId("production-live").scrollIntoView({ block: "start", behavior: "instant" });
      byId("production-run-title").setAttribute("tabindex", "-1");
      byId("production-run-title").focus({ preventScroll: true });
    },
    reconnect() {
      void recover();
    },
    accepted(value) {
      ++sequence;
      clearTimeout(timer);
      run = { ...value, stage: "PREFLIGHT", accepted: true };
      store(value);
      renderRun();
    },
    progress,
  };
  document.body.classList.add("production-modern");
  for (const button of pane.querySelectorAll("[data-production-go]"))
    button.addEventListener("click", () => {
      const target = button.dataset.productionGo;
      if (target === "sources") {
        if (byId("editor-evidence-toggle").getAttribute("aria-expanded") !== "true")
          byId("editor-evidence-toggle").click();
      } else if (target === "post" || target === "ai") {
        const details = byId(`production-${target}`);
        details.open = true;
        details.scrollIntoView({ block: "start", behavior: "instant" });
        details.querySelector("summary").focus({ preventScroll: true });
      } else globalThis.shortsWorkspace.showStep(target, true);
    });
  if (typeof MutationObserver === "function") {
    new MutationObserver(refresh).observe(byId("final-review-panel"), {
      attributes: true,
      attributeFilter: ["data-review-state"],
    });
    const notice = document.querySelector("[data-news-review-notice]");
    if (notice) new MutationObserver(refresh).observe(notice, { attributes: true });
  }
  addEventListener("pagehide", () => {
    leaving = true;
    ++sequence;
    clearTimeout(timer);
    clearInterval(clock);
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) {
      leaving = false;
      clock = setInterval(elapsed, 1000);
      void recover();
    }
  });
  validation = globalThis.shortsWritingEditor.validate();
  refresh();
  clock = setInterval(elapsed, 1000);
  void recover();
})();
