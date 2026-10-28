(() => {
  const panel = document.querySelector?.("[data-writing-panel]");
  if (!panel) return;
  const el = (id) => panel.querySelector(`#writing-${id}`);
  const editor = panel.dataset.writingMode === "editor";
  // The editor only shows a status chip; engine choices live in the workspace Settings.
  const setup = !editor;
  let settings = null;
  let settingsHash = "";
  let connected = false;
  let connection = { state: "checking", message: "Checking your writing engine…", key: "" };
  let running = false;
  let starting = false;
  let runningJobId = null;
  let displayedJobId = null;
  let catalogContext = "";
  let catalogSequence = 0;
  let pollSequence = 0;
  let leaving = false;
  const knownModels = new Map();
  const actionButtons = [...panel.querySelectorAll("[data-writing-action]")];
  const status = (message) => {
    el("status").textContent = message;
  };
  const providerName = (provider) =>
    provider === "hyperspace" ? "SAP Hyperspace" : "Local · LM Studio";
  const stateLabels = { connected: "Connected", offline: "Not connected", checking: "Checking…" };
  function paintEngine(node, info) {
    const items = node.querySelector("[data-engine-items]");
    const note = node.querySelector("[data-engine-note]");
    if (!items || !note) return;
    const chip = (text, tone) => {
      const item = document.createElement("span");
      item.className = `writing-chip ${tone}`;
      item.textContent = text;
      return item;
    };
    node.dataset.state = info.state;
    if (!info.settings)
      items.replaceChildren(chip(info.message || "No writing engine yet", "is-muted"));
    else {
      const remote = info.settings.provider === "hyperspace";
      const parts = [
        chip(info.settings[info.settings.provider].model || "No model chosen", "is-model"),
        chip(providerName(info.settings.provider), "is-provider"),
        chip(remote ? "May incur cost" : "Free", remote ? "is-warn" : "is-free"),
      ];
      if (stateLabels[info.state]) parts.push(chip(stateLabels[info.state], `is-${info.state}`));
      items.replaceChildren(...parts);
    }
    note.textContent = info.state === "connected" ? "" : info.message || "";
  }
  const listeners = new Set();
  globalThis.shortsWritingEngine = {
    paint: paintEngine,
    get connection() {
      return connection;
    },
    subscribe(listener) {
      listeners.add(listener);
    },
  };
  function setConnection(state, message) {
    connection = { state, message, key: settingsHash };
    if (setup) el("connection").textContent = message;
    for (const node of panel.querySelectorAll("[data-engine-chip], [data-engine-badge]")) {
      if (node.hasAttribute("data-engine-badge")) {
        node.textContent = stateLabels[state] ?? "Not available";
        node.dataset.state = state;
      } else paintEngine(node, { settings: settings ? choice() : null, state, message });
    }
    for (const listener of listeners) listener(connection);
  }
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
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The local writing service is unavailable. Reopen the current studio.");
    }
    if (!response.ok) throw new Error(data.error || "Writing action could not finish.");
    return data;
  }
  function choice() {
    const value = structuredClone(settings);
    if (!setup) return value;
    value.provider = el("provider").value;
    value.local.baseUrl = el("local-base").value.trim();
    value.hyperspace.baseUrl = el("hyperspace-base").value.trim();
    value[value.provider].model = el("model").value;
    value.outputTokens = {
      writing: el("default-writing").checked ? null : Number(el("output-writing").value),
      finalReview: el("default-review").checked ? null : Number(el("output-review").value),
    };
    return value;
  }
  function controls() {
    const provider = setup ? el("provider").value : settings?.provider;
    const remote = provider === "hyperspace";
    const modelId = setup ? el("model").value : (settings?.[provider]?.model ?? "");
    if (setup) {
      el("cost").hidden = !remote;
      for (const radio of panel.querySelectorAll('input[name="writing-provider-choice"]')) {
        radio.checked = radio.value === provider;
        radio.disabled = starting;
      }
    } else el("ack-row").hidden = !remote;
    const selected = knownModels.get(modelId);
    const current = settings ? choice() : null;
    const catalogMatches =
      current &&
      catalogContext === JSON.stringify([current.provider, current[current.provider].baseUrl]);
    const reason =
      !settings || !connected
        ? connection.state === "checking"
          ? "Checking your writing engine…"
          : settings
            ? "Connect a writing engine in Settings."
            : connection.message
        : !catalogMatches
          ? "Checking the writing service…"
          : running
            ? "A writing request is running. Wait for it or cancel it."
            : !selected?.chat
              ? "Choose a chat model in Settings."
              : provider === "local" && !selected.loaded
                ? "Load this model in LM Studio, then check the connection again."
                : remote && !el("allow-remote")?.checked
                  ? "Tick the cost consent to use Hyperspace."
                  : "";
    for (const button of actionButtons) button.disabled = Boolean(reason);
    if (editor) {
      el("cancel").hidden = !runningJobId;
      el("hint").textContent = reason;
      el("hint").hidden = !reason;
    }
    if (setup) {
      for (const name of ["provider", "model", "local-base", "hyperspace-base"])
        el(name).disabled = starting;
      for (const kind of ["writing", "review"]) {
        el(`default-${kind}`).disabled = starting;
        el(`output-${kind}`).disabled = starting || el(`default-${kind}`).checked;
      }
      el("save").disabled = !settings || starting;
      el("connect").disabled = !settings || starting;
      el("refresh").disabled = !settings || starting;
    }
  }
  function keyStatus(data) {
    if (!setup) return;
    el("key-status").textContent = data.credentialFromEnvironment
      ? "Configured through the server environment. Remove that override to change the key here."
      : data.keyConfigured
        ? "A proxy key is configured in this Mac’s Keychain. Paste a replacement to change it."
        : "No proxy API key is configured. Paste the key from Hyperspace AI.";
    el("api-key").disabled = data.credentialFromEnvironment;
    el("forget-key").disabled = !data.keyConfigured || data.credentialFromEnvironment;
  }
  async function catalog() {
    if (!settings) return;
    const sequence = ++catalogSequence;
    const selected = choice();
    connected = false;
    setConnection("checking", "Checking the writing service…");
    controls();
    try {
      const data = await request("catalog", { provider: selected.provider, settings: selected });
      if (sequence !== catalogSequence) return;
      knownModels.clear();
      if (setup) el("model").replaceChildren();
      for (const model of data.models) {
        knownModels.set(model.id, model);
        if (!setup) continue;
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = `${model.id}${model.recommended ? " · recommended" : ""}${!model.chat ? " · not a chat model" : selected.provider === "local" && !model.loaded ? " · load in LM Studio" : ""}`;
        option.disabled = !model.chat;
        el("model").append(option);
      }
      const wanted = selected[selected.provider].model;
      if (setup) {
        if (!knownModels.has(wanted)) {
          const option = document.createElement("option");
          option.value = wanted;
          option.textContent = wanted
            ? `${wanted} · saved choice unavailable`
            : "Choose a chat model";
          el("model").prepend(option);
        }
        el("model").value = wanted;
      }
      connected = data.status === "ready";
      catalogContext = JSON.stringify([selected.provider, selected[selected.provider].baseUrl]);
      setConnection(connected ? "connected" : "offline", data.message);
    } catch (error) {
      if (sequence === catalogSequence) setConnection("offline", error.message);
    }
    if (sequence === catalogSequence) controls();
  }
  function adopt(data) {
    settings = data.settings;
    settingsHash = data.settingsHash;
  }
  async function save(includeKey = false, forget = false) {
    const body = { settings: choice() };
    if (includeKey && el("api-key").value.trim()) body.apiKey = el("api-key").value.trim();
    if (forget) body.forgetKey = true;
    const data = await request("settings", body);
    adopt(data);
    keyStatus(data);
    history(data.jobs);
    if (includeKey || forget) el("api-key").value = "";
    return data;
  }
  function para(parent, value, tag = "p") {
    const node = document.createElement(tag);
    node.textContent = value;
    parent.append(node);
    return node;
  }
  function history(jobs) {
    el("history").replaceChildren();
    for (const job of jobs || []) {
      const row = document.createElement("div");
      row.className = "writing-history-row";
      para(
        row,
        `${job.selector} · ${job.action} · ${job.model} · ${job.state} · ${new Date(job.startedAt).toLocaleString()}`,
        "small",
      );
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "View request";
      open.addEventListener("click", () => {
        if (job.state === "RUNNING") void watch(job).catch((error) => status(error.message));
        else render(job);
      });
      row.append(open);
      const script = document.createElement("a");
      script.href = `/episodes/${encodeURIComponent(job.selector)}/edit.html`;
      script.textContent = "Open script";
      row.append(script);
      el("history").append(row);
    }
    if (!jobs?.length) para(el("history"), "No writing requests saved yet.");
  }
  function render(job) {
    displayedJobId = job.id;
    status(`${job.model} · ${job.message}${job.warning ? ` ${job.warning}` : ""}`);
    const duration = job.stages.reduce((sum, stage) => sum + stage.seconds, 0);
    const tokenCount = (field, label) => {
      const values = job.stages
        .map((stage) => stage.usage?.[field])
        .filter((value) => typeof value === "number");
      return !values.length
        ? `${label}: unavailable`
        : `${label}: ${values.reduce((a, b) => a + b, 0).toLocaleString()}${values.length < job.stages.length ? " reported (other attempts unavailable)" : ""}`;
    };
    const completed = job.stages.filter((stage) => stage.state === "complete").length;
    const attempts = job.stages.filter((stage) => stage.submitted).length;
    el("usage").textContent =
      `${job.outputTokenLimit === null ? "Provider default token budget" : job.outputTokenLimit ? `${job.outputTokenLimit.toLocaleString()}-token budget` : "Token budget not recorded"} · ${attempts} text ${attempts === 1 ? "attempt" : "attempts"} · ${completed} completed · ${duration.toFixed(1)}s recorded generation · ${tokenCount("inputTokens", "input tokens")} · ${tokenCount("outputTokens", "output tokens")} · ${tokenCount("totalTokens", "total tokens")}${job.provider === "hyperspace" ? " · actual charges are determined by SAP Hyperspace; dollar cost is not reported here" : " · local inference"}.`;
    const result = el("result");
    result.replaceChildren();
    result.hidden = !job.result || job.state !== "SUCCEEDED";
    if (result.hidden) return;
    if (job.action === "ideas") {
      para(result, "Three possible angles", "h3");
      for (const idea of job.result.ideas) {
        const card = document.createElement("article");
        para(card, idea.title, "h3");
        para(card, `Hook: ${idea.hook}`);
        para(card, `Question: ${idea.question}`);
        para(card, `Payoff: ${idea.payoff}`);
        if (editor) {
          const use = document.createElement("button");
          use.type = "button";
          use.textContent = "Use this direction";
          use.addEventListener("click", () => {
            el("direction").value = `${idea.title}. ${idea.question} ${idea.payoff}`.slice(0, 1200);
            status(
              "Direction selected. Choose Draft / rewrite to generate a proposal with your selected provider.",
            );
          });
          card.append(use);
        }
        result.append(card);
      }
    } else if (job.action === "final-review") {
      para(result, "Final text review", "h3");
      para(result, job.result.summary);
      para(
        result,
        "Open Review & produce for current/outdated status, individual issues and proposed fixes.",
      );
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "Open final review";
      open.addEventListener("click", () => globalThis.shortsWritingEditor?.openReview());
      result.append(open);
    } else if (job.action === "review") {
      para(result, "AI editorial feedback · verify against sources", "h3");
      para(result, job.result.summary);
      for (const issue of job.result.issues) {
        const card = document.createElement("article");
        para(card, `${issue.sceneId} · ${issue.kind}`, "h3");
        para(card, issue.message);
        para(card, issue.suggestion);
        result.append(card);
      }
    } else if (job.action === "presentation") {
      para(result, "Presentation proposal · preview before applying", "h3");
      para(
        result,
        `Theme: ${job.result.theme} · motion: ${job.result.motion}. Narration and evidence are retained.`,
      );
      const bridge = globalThis.shortsWritingEditor;
      const matching =
        editor &&
        bridge?.context?.selector === job.selector &&
        bridge?.context?.sourceHash === job.sourceHash;
      let current;
      try {
        if (matching) current = bridge.snapshot();
      } catch {
        /* Recovery may still be pending. */
      }
      const currentDesignLabel = para(
        result,
        `Current design: ${current?.design ? `${current.design.theme} · ${current.design.motion}` : "automatic"}`,
      );
      const comparison = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Compare seven visual headlines";
      comparison.append(summary);
      for (const [index, scene] of job.result.scenes.entries()) {
        const card = document.createElement("article");
        para(card, `${index + 1}. ${scene.id} · ${scene.emphasis}`, "h3");
        para(
          card,
          `Current: ${current?.design?.scenes[index]?.headline ?? current?.scenes[index]?.overlay ?? "Open the matching editor"}`,
        );
        para(card, `Proposed: ${scene.headline}`);
        comparison.append(card);
      }
      result.append(comparison);
      para(
        result,
        "Check visual headlines against the sources. Preview uses planned timing, with no new audio or captured result generated.",
      );
      if (matching) {
        const preview = document.createElement("button");
        preview.type = "button";
        preview.textContent = "Preview proposed presentation";
        const previewBox = document.createElement("div");
        preview.addEventListener("click", async () => {
          preview.disabled = true;
          try {
            const data = await request(`jobs/${job.id}/preview`, {
              ...bridge.context,
              snapshot: bridge.snapshot(),
            });
            const frame = document.createElement("iframe");
            frame.title = "Proposed interactive presentation · planned timing";
            frame.className = "writing-deck-preview";
            frame.setAttribute("sandbox", "allow-scripts");
            frame.srcdoc = data.html;
            previewBox.replaceChildren(frame);
          } catch (error) {
            status(error.message);
          } finally {
            preview.disabled = applied;
          }
        });
        const apply = document.createElement("button");
        let applied = false;
        apply.type = "button";
        apply.textContent = "Apply presentation design";
        apply.addEventListener("click", async () => {
          apply.disabled = true;
          try {
            const snapshot = bridge.snapshot();
            const data = await request(`jobs/${job.id}/proposal`, { ...bridge.context, snapshot });
            bridge.applyDesign(data.proposal, snapshot);
            applied = true;
            currentDesignLabel.textContent = `Applied design: ${data.proposal.theme} · ${data.proposal.motion}`;
            apply.textContent = "Design applied · save draft";
            preview.disabled = true;
            preview.textContent = "Save draft to keep this presentation";
            status(
              "Presentation design applied. Narration, voices, photos and sources retained. Use Save draft, then produce to include it in the video.",
            );
          } catch (error) {
            status(error.message);
          } finally {
            apply.disabled = applied;
          }
        });
        result.append(preview, apply, previewBox);
      } else para(result, "Open this proposal’s matching script to preview or apply it.");
    } else {
      para(result, "Proposed wording · nothing applied yet", "h3");
      para(result, job.result.title);
      const bridge = globalThis.shortsWritingEditor;
      const matchingEditor =
        editor &&
        bridge?.context?.selector === job.selector &&
        bridge?.context?.sourceHash === job.sourceHash;
      let snapshot;
      try {
        if (matchingEditor) snapshot = bridge.snapshot();
      } catch {
        /* Read-only comparison while recovery/save is pending. */
      }
      const titleCompare = document.createElement("div");
      titleCompare.className = "writing-comparison";
      const currentTitle = document.createElement("div");
      para(currentTitle, "Current title", "small");
      para(currentTitle, snapshot?.title || "Open the matching editor to compare.");
      const proposedTitle = document.createElement("div");
      para(proposedTitle, "Proposed title", "small");
      para(proposedTitle, job.result.title);
      titleCompare.append(currentTitle, proposedTitle);
      result.append(titleCompare);
      for (const [index, scene] of job.result.scenes.entries()) {
        const card = document.createElement("article");
        para(card, `${index + 1}. ${scene.id}`, "h3");
        const compare = document.createElement("div");
        compare.className = "writing-comparison";
        const before = document.createElement("div");
        para(before, "Current editor", "small");
        para(before, `Headline: ${snapshot?.scenes[index]?.overlay || "Unavailable"}`, "small");
        para(before, snapshot?.scenes[index]?.texts.join("\n") || "Open this script to compare.");
        const after = document.createElement("div");
        para(after, "Proposal", "small");
        para(after, `Headline: ${scene.overlay}`, "small");
        para(after, scene.texts.join("\n"));
        compare.append(before, after);
        card.append(compare);
        result.append(card);
      }
      para(
        result,
        "Review factual scope and the full story before applying. Sources are not rechecked; the companion post remains yours to edit.",
      );
      if (matchingEditor) {
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "writing-apply";
        apply.textContent = "Apply wording to this editor";
        apply.addEventListener("click", async () => {
          apply.disabled = true;
          try {
            const current = bridge.snapshot();
            const data = await request(`jobs/${job.id}/proposal`, {
              snapshot: current,
              ...bridge.context,
            });
            bridge.apply(data.proposal, current);
            status(
              "Wording applied. Your voices, photos, pronunciation and version name are retained. Review changes and use Save draft when ready.",
            );
          } catch (error) {
            status(error.message);
          } finally {
            apply.disabled = false;
          }
        });
        result.append(apply);
      } else if (editor)
        para(
          result,
          "This proposal belongs to another script or source version. Open its matching editor to apply it.",
        );
    }
  }
  async function watch(job) {
    const sequence = ++pollSequence;
    running = job.state === "RUNNING";
    runningJobId = running ? job.id : null;
    controls();
    render(job);
    try {
      while (job.state === "RUNNING" && !leaving && sequence === pollSequence) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (leaving || sequence !== pollSequence) return;
        job = await request(`jobs/${job.id}`);
        if (leaving || sequence !== pollSequence) return;
        if (displayedJobId === job.id) render(job);
      }
      if (sequence === pollSequence) {
        running = false;
        runningJobId = null;
        controls();
        history((await request("status")).jobs);
      }
    } catch (error) {
      if (sequence === pollSequence) {
        status(
          `Connection interrupted. The request may continue on the server; it was not resubmitted. Use Recent writing requests or refresh this page. ${error.message}`,
        );
        running = false;
        controls();
      }
    }
  }
  for (const button of actionButtons)
    button.addEventListener("click", async () => {
      if (running) return;
      running = true;
      starting = true;
      controls();
      try {
        const bridge = globalThis.shortsWritingEditor;
        const snapshot = bridge.snapshot();
        const acceptedCost = el("allow-remote").checked;
        const saved = await request("status");
        if (saved.settingsHash !== settingsHash) {
          adopt(saved);
          el("allow-remote").checked = false;
          void catalog();
          throw new Error(
            "Writing settings changed in Settings. Check the engine shown above, then start again.",
          );
        }
        const job = await request("jobs", {
          requestId: crypto.randomUUID(),
          ...bridge.context,
          snapshot,
          action: button.dataset.writingAction,
          style: el("style").value,
          instruction: el("direction").value.trim(),
          settingsHash: saved.settingsHash,
          allowRemote: saved.settings.provider === "hyperspace" && acceptedCost,
        });
        starting = false;
        el("allow-remote").checked = false;
        await watch(job);
      } catch (error) {
        status(error.message);
        running = false;
        starting = false;
        controls();
      }
    });
  if (editor) {
    el("allow-remote").addEventListener("change", controls);
    el("cancel").addEventListener("click", async () => {
      if (!runningJobId) return;
      try {
        render(await request(`jobs/${runningJobId}/cancel`, {}));
      } catch (error) {
        status(error.message);
      }
    });
  }
  if (setup) {
    const chooseProvider = () => {
      if (!settings) return;
      el("model").replaceChildren();
      const option = document.createElement("option");
      option.value = settings[el("provider").value].model;
      option.textContent = option.value || "Choose a chat model";
      el("model").append(option);
      controls();
      void catalog();
    };
    el("provider").addEventListener("change", chooseProvider);
    for (const radio of panel.querySelectorAll('input[name="writing-provider-choice"]'))
      radio.addEventListener("change", () => {
        if (!radio.checked || el("provider").value === radio.value) return;
        el("provider").value = radio.value;
        chooseProvider();
      });
    el("model").addEventListener("change", controls);
    for (const kind of ["writing", "review"])
      el(`default-${kind}`).addEventListener("change", controls);
    for (const name of ["local-base", "hyperspace-base"])
      el(name).addEventListener("input", () => {
        ++catalogSequence;
        connected = false;
        catalogContext = "";
        setConnection(
          "offline",
          "Connection address changed. Test the connection again before writing.",
        );
        controls();
      });
    el("refresh").addEventListener("click", () => void catalog());
    el("save").addEventListener("click", async () => {
      try {
        await save();
        status("Writing preference saved on this Mac.");
      } catch (error) {
        status(error.message);
      }
    });
    el("connect").addEventListener("click", async () => {
      try {
        await save(true);
        status("Writing setup saved. Testing connection…");
        await catalog();
      } catch (error) {
        status(error.message);
      }
    });
    el("forget-key").addEventListener("click", async () => {
      try {
        await save(false, true);
        status("Saved proxy key removed from this Mac’s Keychain.");
        await catalog();
      } catch (error) {
        status(error.message);
      }
    });
  }
  addEventListener("pagehide", () => {
    leaving = true;
    ++pollSequence;
  });
  controls();
  void (async () => {
    try {
      const session = await fetch("/api/local-voices/session");
      if (!session.ok)
        throw new Error(
          "Writing setup needs the running localhost studio. Manual editing remains available.",
        );
      const data = await request("status");
      adopt(data);
      if (data.settingsIssue) status(data.settingsIssue);
      keyStatus(data);
      history(data.jobs);
      if (setup) {
        el("default-writing").checked = settings.outputTokens.writing === null;
        el("default-review").checked = settings.outputTokens.finalReview === null;
        el("output-writing").value = String(settings.outputTokens.writing ?? 8192);
        el("output-review").value = String(settings.outputTokens.finalReview ?? 16384);
        el("provider").value = settings.provider;
        el("local-base").value = settings.local.baseUrl;
        el("hyperspace-base").value = settings.hyperspace.baseUrl;
        const option = document.createElement("option");
        option.value = settings[settings.provider].model;
        option.textContent = option.value || "Choose a chat model";
        el("model").replaceChildren(option);
      }
      await catalog();
      const current = data.jobs.find((job) => job.state === "RUNNING");
      if (current) await watch(current);
    } catch (error) {
      setConnection("unavailable", error.message);
      controls();
    }
  })();
})();
