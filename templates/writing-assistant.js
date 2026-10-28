(() => {
  const panel = document.querySelector?.("[data-writing-panel]");
  if (!panel) return;
  const el = (id) => panel.querySelector(`#writing-${id}`);
  const editor = panel.dataset.writingMode === "editor";
  let settings = null;
  let connected = false;
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
    value.provider = el("provider").value;
    value.local.baseUrl = el("local-base").value.trim();
    value.hyperspace.baseUrl = el("hyperspace-base").value.trim();
    value[value.provider].model = el("model").value;
    return value;
  }
  function controls() {
    const remote = el("provider").value === "hyperspace";
    el("cost").hidden = !remote;
    if (editor) el("ack-row").hidden = !remote;
    const selected = knownModels.get(el("model").value);
    const current = settings ? choice() : null;
    const catalogMatches =
      current &&
      catalogContext === JSON.stringify([current.provider, current[current.provider].baseUrl]);
    for (const button of actionButtons)
      button.disabled =
        !connected ||
        !catalogMatches ||
        running ||
        !selected?.chat ||
        (el("provider").value === "local" && !selected.loaded) ||
        (remote && !el("allow-remote").checked);
    if (editor) el("cancel").hidden = !runningJobId;
    for (const name of ["provider", "model", "local-base", "hyperspace-base"])
      el(name).disabled = starting;
    el("save").disabled = !settings || starting;
    el("connect").disabled = !settings || starting;
    el("refresh").disabled = !settings || starting;
  }
  function keyStatus(data) {
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
    controls();
    el("connection").textContent = "Checking the writing service…";
    try {
      const data = await request("catalog", { provider: selected.provider, settings: selected });
      if (sequence !== catalogSequence) return;
      knownModels.clear();
      el("model").replaceChildren();
      for (const model of data.models) {
        knownModels.set(model.id, model);
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = `${model.id}${model.recommended ? " · recommended" : ""}${!model.chat ? " · not a chat model" : selected.provider === "local" && !model.loaded ? " · load in LM Studio" : ""}`;
        option.disabled = !model.chat;
        el("model").append(option);
      }
      const wanted = selected[selected.provider].model;
      if (!knownModels.has(wanted)) {
        const option = document.createElement("option");
        option.value = wanted;
        option.textContent = wanted
          ? `${wanted} · saved choice unavailable`
          : "Choose a chat model";
        el("model").prepend(option);
      }
      el("model").value = wanted;
      connected = data.status === "ready";
      catalogContext = JSON.stringify([selected.provider, selected[selected.provider].baseUrl]);
      el("connection").textContent = data.message;
    } catch (error) {
      if (sequence === catalogSequence) el("connection").textContent = error.message;
    }
    if (sequence === catalogSequence) controls();
  }
  async function save(includeKey = false, forget = false) {
    const body = { settings: choice() };
    if (includeKey && el("api-key").value.trim()) body.apiKey = el("api-key").value.trim();
    if (forget) body.forgetKey = true;
    const data = await request("settings", body);
    settings = data.settings;
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
      `${attempts} text ${attempts === 1 ? "attempt" : "attempts"} · ${completed} completed · ${duration.toFixed(1)}s recorded generation · ${tokenCount("inputTokens", "input tokens")} · ${tokenCount("outputTokens", "output tokens")} · ${tokenCount("totalTokens", "total tokens")}${job.provider === "hyperspace" ? " · actual charges are determined by SAP Hyperspace; dollar cost is not reported here" : " · local inference"}.`;
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
        const saved = await save();
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
  el("provider").addEventListener("change", () => {
    if (!settings) return;
    el("model").replaceChildren();
    const option = document.createElement("option");
    option.value = settings[el("provider").value].model;
    option.textContent = option.value || "Choose a chat model";
    el("model").append(option);
    if (editor) el("allow-remote").checked = false;
    controls();
    void catalog();
  });
  el("model").addEventListener("change", controls);
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
  for (const name of ["local-base", "hyperspace-base"])
    el(name).addEventListener("input", () => {
      ++catalogSequence;
      connected = false;
      catalogContext = "";
      el("connection").textContent =
        "Connection address changed. Test the connection again before writing.";
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
      settings = data.settings;
      if (data.settingsIssue) status(data.settingsIssue);
      keyStatus(data);
      history(data.jobs);
      el("provider").value = settings.provider;
      el("local-base").value = settings.local.baseUrl;
      el("hyperspace-base").value = settings.hyperspace.baseUrl;
      const option = document.createElement("option");
      option.value = settings[settings.provider].model;
      option.textContent = option.value || "Choose a chat model";
      el("model").replaceChildren(option);
      await catalog();
      const current = data.jobs.find((job) => job.state === "RUNNING");
      if (current) await watch(current);
    } catch (error) {
      el("connection").textContent = error.message;
      controls();
    }
  })();
})();
