(() => {
  const panel = document.getElementById("final-review-panel");
  if (!panel) return;
  const el = (id) => document.getElementById(`final-review-${id}`);
  const bridge = () => globalThis.shortsWritingEditor;
  let settings = null;
  let settingsHash = "";
  let busy = false;
  let starting = false;
  let runningId = null;
  let watching = null;
  let last = null;
  let checkedSignature = "";
  let current = false;
  let sequence = 0;
  let timer;
  let leaving = false;
  const status = (message) => {
    el("status").textContent = message;
  };
  const context = (snapshot = bridge().snapshot()) => ({ ...bridge().context, snapshot });
  async function request(path, body) {
    const response = await fetch(
      `/api/editorial/${path}`,
      body === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        data.error || "Final review is unavailable. Refresh the current local studio.",
      );
    return data;
  }
  function controls() {
    const remote = settings?.provider === "hyperspace";
    el("cost-row").hidden = !remote;
    const reason = !settings
      ? "Connect a writing engine in Settings."
      : !settings[settings.provider].model
        ? "Choose a writing model in Settings."
        : busy || starting
          ? "A writing request is running. Wait for it to finish."
          : remote && !el("remote").checked
            ? "Tick the cost consent to use Hyperspace."
            : "";
    el("start").disabled = Boolean(reason);
    el("hint").textContent = reason;
    el("hint").hidden = !reason;
    el("cancel").hidden = !runningId;
    el("refresh").disabled = starting;
    const apply = document.getElementById("final-review-apply");
    if (apply) apply.disabled = !current || busy || starting;
  }
  function paintEngine() {
    const shared = globalThis.shortsWritingEngine;
    if (!shared) return;
    if (!settings) {
      const { state, message } = shared.connection;
      if (state !== "checking") shared.paint(el("engine"), { settings: null, state, message });
      return;
    }
    const known = shared.connection.key === settingsHash;
    shared.paint(el("engine"), {
      settings,
      state: known ? shared.connection.state : "unknown",
      message: known ? shared.connection.message : "",
    });
  }
  globalThis.shortsWritingEngine?.subscribe(paintEngine);
  function engine(data) {
    if (settingsHash !== data.settingsHash) el("remote").checked = false;
    settings = data.settings;
    settingsHash = data.settingsHash;
    paintEngine();
    controls();
  }
  function para(parent, value, tag = "p") {
    const node = document.createElement(tag);
    node.textContent = value;
    parent.append(node);
    return node;
  }
  function showReceipt(data) {
    last = data.job ?? null;
    current = data.state === "current";
    panel.dataset.reviewState = data.state;
    const result = el("result");
    result.replaceChildren();
    result.hidden = !last;
    if (!last) {
      status(
        "Not reviewed yet. Run Final AI review before rendering when you want editorial feedback.",
      );
      controls();
      return;
    }
    const outcome =
      data.outcome === "needs-attention"
        ? "Needs attention"
        : data.outcome === "suggestions"
          ? "Suggestions"
          : "No issues flagged";
    status(
      current
        ? `Current text review · ${outcome}`
        : "Outdated review · the content or source evidence differs. Run review again.",
    );
    para(result, last.result.summary);
    para(
      result,
      `${last.model} · ${last.outputTokenLimit === null ? "provider default budget" : last.outputTokenLimit ? `${last.outputTokenLimit.toLocaleString()}-token budget` : "budget not recorded"} · ${new Date(last.completedAt || last.startedAt).toLocaleString()} · ${last.stages.reduce((sum, stage) => sum + stage.seconds, 0).toFixed(1)}s · ${last.provider === "local" ? "local inference" : "Hyperspace request; charges are determined by the provider"}`,
      "small",
    );
    const counts = { high: 0, medium: 0, low: 0 };
    for (const issue of last.result.issues) counts[issue.severity]++;
    para(
      result,
      `${counts.high} high · ${counts.medium} medium · ${counts.low} low. Feedback is advisory; source accuracy and media still need review.`,
      "small",
    );
    for (const issue of last.result.issues) {
      const details = document.createElement("details");
      details.className = "final-review-issue";
      details.open = false;
      para(
        details,
        `${issue.severity.toUpperCase()} · ${issue.area} · ${issue.sceneId}: ${issue.message}`,
        "summary",
      );
      para(details, issue.suggestion);
      if (issue.fix) {
        para(details, `Proposed edit · ${issue.fix.field}`, "strong");
        const comparison = document.createElement("div");
        comparison.className = "writing-comparison";
        for (const [label, text] of [
          ["Current", issue.fix.before],
          ["Proposed", issue.fix.after],
        ]) {
          const column = document.createElement("div");
          para(column, label, "small");
          para(column, text);
          comparison.append(column);
        }
        details.append(comparison);
      }
      result.append(details);
    }
    if (last.result.issues.some((issue) => issue.fix)) {
      para(result, "Expand the issues to compare each proposed edit before applying.", "small");
      const apply = document.createElement("button");
      apply.id = "final-review-apply";
      apply.type = "button";
      apply.textContent = "Apply proposed fixes to this draft";
      apply.addEventListener("click", async () => {
        if (!current || busy || starting) return;
        starting = true;
        controls();
        try {
          const expected = bridge().snapshot();
          const data = await request(`jobs/${last.id}/fixes`, context(expected));
          bridge().applyFinal(data.snapshot, expected);
          current = false;
          panel.dataset.reviewState = "outdated";
          status(
            "Proposed fixes applied to the editor. Review is now outdated; review again, then save or produce when ready.",
          );
        } catch (error) {
          status(error.message);
        } finally {
          starting = false;
          controls();
        }
      });
      result.append(apply);
    }
    controls();
  }
  async function refresh() {
    if (leaving || starting) return;
    const ticket = ++sequence;
    let snapshot;
    try {
      snapshot = bridge().snapshot();
    } catch {
      return;
    }
    try {
      const data = await request("status");
      if (ticket !== sequence || leaving) return;
      engine(data);
      busy = data.jobs.some((job) => job.state === "RUNNING");
      const receipt = await request("final-review", context(snapshot));
      if (
        ticket !== sequence ||
        leaving ||
        JSON.stringify(bridge().snapshot()) !== JSON.stringify(snapshot)
      )
        return;
      checkedSignature = JSON.stringify(snapshot);
      showReceipt(receipt);
      const active = data.jobs.find(
        (job) =>
          job.state === "RUNNING" &&
          job.action === "final-review" &&
          job.selector.split("@")[0] === bridge().context.selector.split("@")[0],
      );
      if (active && !watching) void watch(active);
    } catch (error) {
      if (ticket !== sequence || leaving) return;
      current = false;
      panel.dataset.reviewState = "unavailable";
      status(error.message);
    }
    controls();
  }
  async function watch(job) {
    if (watching === job.id) return;
    watching = runningId = job.id;
    busy = true;
    controls();
    try {
      while (job.state === "RUNNING" && !leaving) {
        status(`${job.model} · ${job.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (leaving) return;
        job = await request(`jobs/${job.id}`);
      }
      if (leaving) return;
      runningId = watching = null;
      busy = false;
      await refresh();
      if (job.state !== "SUCCEEDED") status(`${job.state}: ${job.message}`);
    } catch (error) {
      runningId = watching = null;
      busy = false;
      status(
        `Connection interrupted. The review may continue on the server; it was not resubmitted. Refresh review status. ${error.message}`,
      );
    }
    controls();
  }
  el("start").addEventListener("click", async () => {
    if (!settings || busy || starting) return;
    const acceptedCost = el("remote").checked;
    const intendedSettings = settingsHash;
    starting = true;
    controls();
    try {
      const snapshot = bridge().snapshot();
      const fresh = await request("status");
      if (fresh.settingsHash !== intendedSettings) {
        engine(fresh);
        throw new Error("Writing settings changed. Review the displayed engine and start again.");
      }
      if (fresh.settings.provider === "hyperspace" && !acceptedCost)
        throw new Error("Confirm possible Hyperspace cost for this review.");
      const job = await request("jobs", {
        requestId: crypto.randomUUID(),
        ...context(snapshot),
        settingsHash: fresh.settingsHash,
        action: "final-review",
        style: "conversational",
        instruction:
          "Final editorial consistency check before rendering. Preserve the story and the source facts.",
        allowRemote: fresh.settings.provider === "hyperspace" && acceptedCost,
      });
      el("remote").checked = false;
      starting = false;
      await watch(job);
    } catch (error) {
      status(error.message);
    } finally {
      starting = false;
      controls();
    }
  });
  el("remote").addEventListener("change", controls);
  el("refresh").addEventListener("click", () => void refresh());
  el("cancel").addEventListener("click", async () => {
    if (!runningId) return;
    try {
      const job = await request(`jobs/${runningId}/cancel`, {});
      status(job.message);
    } catch (error) {
      status(error.message);
    }
  });
  globalThis.shortsFinalReview = {
    refresh,
    changed() {
      if (leaving) return;
      let signature;
      try {
        signature = JSON.stringify(bridge().snapshot());
      } catch {
        return;
      }
      if (signature === checkedSignature) return;
      ++sequence;
      current = false;
      if (last) {
        panel.dataset.reviewState = "outdated";
        status("Content changed · the final review is outdated. Run review again.");
      }
      controls();
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 500);
    },
  };
  addEventListener("pagehide", () => {
    leaving = true;
    ++sequence;
    clearTimeout(timer);
  });
  void (async () => {
    try {
      const session = await fetch("/api/local-voices/session");
      if (!session.ok)
        throw new Error(
          "Final review needs the running local studio. Manual editing remains available.",
        );
      await refresh();
    } catch (error) {
      status(error.message);
    }
  })();
})();
