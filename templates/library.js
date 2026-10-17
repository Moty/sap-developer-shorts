(() => {
  const release = document.querySelector("#release-review");
  if (release) {
    const node = (id) => document.getElementById(id);
    let current = null;
    let busy = false;
    function render(state) {
      current = state;
      release.dataset.stage = state.stage;
      node("release-state").textContent = state.label;
      node("approve-video").disabled =
        busy ||
        state.reviewBlocked ||
        !node("review-confirmed").checked ||
        !!state.record?.reviewedAt;
      node("record-publication").disabled =
        busy || state.reviewBlocked || !state.record?.reviewedAt;
      node("reopen-review").hidden = !state.record?.reviewedAt;
      node("reopen-review").disabled = busy;
      const publication = state.record?.publication;
      node("publication-record").hidden = !publication;
      if (publication) {
        const link = document.createElement("a");
        link.textContent = "Open published post ↗";
        link.href = publication.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        node("publication-record").replaceChildren(
          link,
          document.createTextNode(
            ` · Recorded ${new Date(publication.recordedAt).toLocaleDateString()}`,
          ),
        );
        node("publication-url").value = publication.url;
      }
      node("release-message").textContent = state.reviewBlocked
        ? state.issue
        : state.stage === "published"
          ? "Publication recorded on this Mac. You can revisit the live post below."
          : state.stage === "publish"
            ? "Approved. Download your video, publish it on your channel, then save the post link."
            : "Video produced. Your final review is the next step.";
    }
    async function change(action) {
      busy = true;
      if (current) render(current);
      node("release-message").textContent = "Saving…";
      try {
        const response = await fetch("/api/workflow", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            selector: release.dataset.selector,
            renderKey: release.dataset.renderKey,
            action,
            reviewed: node("review-confirmed").checked,
            url: node("publication-url").value.trim(),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save this change.");
        busy = false;
        render(data);
      } catch (error) {
        busy = false;
        if (current) render(current);
        node("release-message").textContent = error.message;
      }
    }
    node("review-confirmed").addEventListener("change", () => {
      if (current) render(current);
    });
    node("approve-video").addEventListener("click", () => change("approve"));
    node("record-publication").addEventListener("click", () => {
      if (!node("publication-url").value.trim() || !node("publication-url").reportValidity()) {
        node("release-message").textContent =
          "Paste the live post URL before recording publication.";
        node("publication-url").focus();
        return;
      }
      change("publish");
    });
    node("reopen-review").addEventListener("click", () => change("reopen"));
    node("copy-post").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(node("release-post").value);
        node("release-message").textContent = "Companion post copied.";
      } catch {
        node("release-post").focus();
        node("release-post").select();
        node("release-message").textContent = "Select and copy the post text above.";
      }
    });
    fetch("/api/workflow")
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Review status is unavailable. Open this page from the running local studio to save progress.",
          );
        const data = await response.json();
        const state = data.episodes.find((entry) => entry.selector === release.dataset.selector);
        if (!state)
          throw new Error(
            "This version is no longer in the current studio. Return to the workspace.",
          );
        if (state.renderKey !== release.dataset.renderKey)
          throw new Error(
            "A newer video is available. Return to the workspace and open its review.",
          );
        render(state);
      })
      .catch((error) => {
        node("release-message").textContent = error.message;
      });
    return;
  }
  const choices = [...document.querySelectorAll("[data-style-choice]")];
  const panels = [...document.querySelectorAll("[data-comparison-panel]")];
  function chooseStyle() {
    const requested = panels.find((panel) => `#${panel.id}` === window.location.hash);
    const selected = requested ?? panels[0];
    for (const panel of panels) panel.hidden = panel !== selected;
    for (const choice of choices) {
      if (choice.hash === `#${selected?.id}`) choice.setAttribute("aria-current", "true");
      else choice.removeAttribute("aria-current");
    }
  }
  for (const choice of choices)
    choice.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      if (window.location.hash !== choice.hash) {
        try {
          window.history.pushState(null, "", choice.hash);
        } catch {
          window.location.hash = choice.hash;
        }
      }
      chooseStyle();
    });
  window.addEventListener("hashchange", chooseStyle);
  window.addEventListener("popstate", chooseStyle);
  chooseStyle();
  const input = document.querySelector("#episode-search");
  const cards = [...document.querySelectorAll(".episode-card")];
  const buttons = [...document.querySelectorAll("[data-format]")];
  const clear = document.querySelector("#clear-search");
  const status = document.querySelector("#filter-status");
  const empty = document.querySelector("#no-episodes");
  let format = "all";
  let stage = "all";
  const stageButtons = [...document.querySelectorAll("[data-stage-filter]")];
  const attentionFilter = document.querySelector("#attention-filter");
  if (typeof window.location.href === "string") {
    const requested = new URL(window.location.href).searchParams.get("stage");
    if (stageButtons.some((button) => button.dataset.stageFilter === requested)) stage = requested;
  }

  function update() {
    const terms = input.value.trim().toLowerCase().split(/\s+/u).filter(Boolean);
    let visible = 0;
    for (const card of cards) {
      const matches =
        (format === "all" || card.dataset.kind === format) &&
        (stage === "all" || card.dataset.stage === stage) &&
        (!attentionFilter?.checked || card.dataset.attention === "true") &&
        terms.every((term) => card.dataset.search.includes(term));
      card.hidden = !matches;
      if (matches) visible++;
    }
    for (const button of buttons)
      button.setAttribute("aria-pressed", String(button.dataset.format === format));
    for (const button of stageButtons)
      button.setAttribute("aria-pressed", String(button.dataset.stageFilter === stage));
    clear.hidden = !input.value;
    empty.hidden = visible !== 0;
    status.textContent = `${visible} ${visible === 1 ? "version" : "versions"}`;
  }
  for (const button of stageButtons)
    button.addEventListener("click", () => {
      stage = button.dataset.stageFilter;
      const url = new URL(window.location.href);
      url.searchParams.set("stage", stage);
      window.history.replaceState(null, "", url);
      update();
    });
  attentionFilter?.addEventListener("change", update);
  for (const button of buttons)
    button.addEventListener("click", () => {
      format = button.dataset.format;
      update();
    });
  input.addEventListener("input", update);
  clear.addEventListener("click", () => {
    input.value = "";
    update();
    input.focus();
  });
  document.querySelector("#reset-filters").addEventListener("click", () => {
    format = "all";
    stage = "all";
    if (attentionFilter) attentionFilter.checked = false;
    if (typeof window.location.href === "string") {
      const url = new URL(window.location.href);
      url.searchParams.delete("stage");
      window.history.replaceState(null, "", url);
    }
    input.value = "";
    update();
    input.focus();
  });
  update();
  document.querySelector("[data-enhancement-only]").hidden = false;

  const banner = document.querySelector("#studio-produce-banner");
  const title = document.querySelector("#studio-produce-title");
  const msg = document.querySelector("#studio-produce-message");
  const progressFill = document.querySelector("#studio-produce-progress");
  let lastActiveJob = null;
  async function refreshWorkflow() {
    const sync = document.querySelector("#workflow-sync");
    try {
      const response = await fetch("/api/workflow");
      if (!response.ok) throw new Error("Status unavailable");
      const data = await response.json();
      for (const card of cards) {
        const state = data.episodes.find((entry) => entry.selector === card.dataset.selector);
        if (!state) continue;
        card.dataset.stage = state.stage;
        card.dataset.attention = String(state.attention);
        card.querySelector("[data-work-stage]").textContent = state.label;
        const next = {
          editing: "Script saved · continue when ready",
          producing: "Running on this Mac",
          review: "Video produced · awaiting your review",
          publish: "Approved · ready to post",
          published: "Live post link recorded",
        };
        card.querySelector("[data-work-next]").textContent = next[state.stage];
        const issue = card.querySelector("[data-work-issue]");
        if (state.issue) {
          issue.hidden = false;
          issue.textContent = state.issue;
        }
        const action = card.querySelector("[data-work-action]");
        if (["review", "publish", "published"].includes(state.stage)) {
          action.textContent =
            state.stage === "review"
              ? "Review video"
              : state.stage === "publish"
                ? "Finish publishing"
                : "View publication";
          action.href = `episodes/${encodeURIComponent(state.selector)}/publish.html`;
        }
        if (state.stage === "producing") {
          action.textContent = "View progress";
          action.href = "#studio-produce-banner";
        }
      }
      for (const count of document.querySelectorAll("[data-stage-count]"))
        count.textContent = String(
          cards.filter((card) => card.dataset.stage === count.dataset.stageCount).length,
        );
      const job = data.activeJob;
      if (job && banner) {
        banner.hidden = false;
        title.textContent = `Producing ${job.selector}`;
        updateProgress(job.stage, job.message);
        const link = document.querySelector("#studio-job-link");
        if (link) link.href = `episodes/${encodeURIComponent(job.selector)}/edit.html`;
      } else if (lastActiveJob) {
        // A successful render swaps the served library; load its new video links.
        window.location.reload();
        return;
      }
      lastActiveJob = job?.id ?? null;
      if (sync) sync.textContent = "Live status · saved on this Mac";
      update();
    } catch {
      if (sync)
        sync.textContent =
          "Live status unavailable · showing last known state. Reopen the local studio to sync.";
    }
  }
  if (typeof fetch === "function") {
    void refreshWorkflow();
    setInterval(() => {
      if (!document.hidden) void refreshWorkflow();
    }, 5000);
  }

  function updateProgress(stage, message) {
    if (msg) msg.textContent = `${stage}: ${message || ""}`;
    const stagePercent = {
      PREFLIGHT: "20%",
      NARRATION: "50%",
      RENDER: "80%",
      LIBRARY: "95%",
      READY: "100%",
    };
    if (progressFill && stagePercent[stage]) {
      progressFill.style.width = stagePercent[stage];
    }
  }

  function listenProduction(jobId, selector, btn, originalText) {
    const sse = new EventSource(`/api/productions/${encodeURIComponent(jobId)}/stream`);
    sse.addEventListener("status", (e) => {
      try {
        const payload = JSON.parse(e.data);
        updateProgress(payload.stage, payload.message);
        if (["READY", "FAILED", "BLOCKED"].includes(payload.stage)) completeProduction(e);
      } catch {}
    });
    sse.addEventListener("progress", (e) => {
      try {
        const payload = JSON.parse(e.data);
        updateProgress(payload.stage, payload.message);
      } catch {}
    });
    function completeProduction(e) {
      sse.close();
      let payload = {};
      try {
        payload = JSON.parse(e.data || "{}");
      } catch {}
      const report = payload.report || {};
      const stage = payload.stage || report.stage || "READY";
      if (stage !== "READY") {
        btn.disabled = false;
        btn.textContent = originalText;
        const issueMsg =
          report.issue?.message || payload.error || "Production stopped before MP4 export.";
        const timingDetail =
          Number.isFinite(report.durationSeconds) && Number.isFinite(report.hookSeconds)
            ? ` (Measured: ${report.durationSeconds.toFixed(1)}s total, ${report.hookSeconds.toFixed(2)}s opening hook)`
            : "";
        if (title) title.textContent = `${selector} · ${stage}`;
        if (msg) msg.textContent = `${issueMsg}${timingDetail}`;
        return;
      }
      if (title) title.textContent = `${selector} is READY!`;
      if (msg) msg.textContent = "Production completed successfully. Reloading studio...";
      if (progressFill) progressFill.style.width = "100%";
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
    sse.addEventListener("complete", completeProduction);
    sse.addEventListener("error", (e) => {
      if (!e.data) {
        if (msg)
          msg.textContent = "Connection lost. Production may still be running; reconnecting…";
        return;
      }
      completeProduction(e);
    });
  }

  async function triggerProduction(selector, btn) {
    if (!selector) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Starting...";
    if (banner) {
      banner.hidden = false;
      title.textContent = `Producing ${selector}...`;
      msg.textContent = "Sending production request...";
      if (progressFill) progressFill.style.width = "10%";
    }
    try {
      const res = await fetch("/api/produce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selector }),
      });
      if (res.status === 409) {
        const data = await res.json();
        alert(
          `A production job is already running for ${data.selector} (${data.stage}). Please wait for it to complete.`,
        );
        btn.disabled = false;
        btn.textContent = originalText;
        if (banner) banner.hidden = true;
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server responded with ${res.status}`);
      }
      const data = await res.json();
      btn.textContent = "Producing...";
      listenProduction(data.jobId, selector, btn, originalText);
    } catch (err) {
      alert(`Production request failed: ${err.message}`);
      btn.disabled = false;
      btn.textContent = originalText;
      if (banner) banner.hidden = true;
    }
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("click", (e) => {
      const btn = e.target?.closest ? e.target.closest(".produce-card-btn") : null;
      if (btn?.dataset?.selector) {
        e.preventDefault();
        triggerProduction(btn.dataset.selector, btn);
      }
    });
  }
})();
