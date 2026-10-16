(() => {
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

  function update() {
    const terms = input.value.trim().toLowerCase().split(/\s+/u).filter(Boolean);
    let visible = 0;
    for (const card of cards) {
      const matches =
        (format === "all" || card.dataset.kind === format) &&
        terms.every((term) => card.dataset.search.includes(term));
      card.hidden = !matches;
      if (matches) visible++;
    }
    for (const button of buttons)
      button.setAttribute("aria-pressed", String(button.dataset.format === format));
    clear.hidden = !input.value;
    empty.hidden = visible !== 0;
    status.textContent = `${visible} ${visible === 1 ? "episode" : "episodes"}`;
  }
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
      } catch {}
    });
    sse.addEventListener("progress", (e) => {
      try {
        const payload = JSON.parse(e.data);
        updateProgress(payload.stage, payload.message);
      } catch {}
    });
    sse.addEventListener("complete", () => {
      sse.close();
      if (title) title.textContent = `${selector} is READY!`;
      if (msg) msg.textContent = "Production completed successfully. Reloading studio...";
      if (progressFill) progressFill.style.width = "100%";
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    });
    sse.addEventListener("error", () => {
      sse.close();
      btn.disabled = false;
      btn.textContent = originalText;
      if (title) title.textContent = `Production failed for ${selector}`;
      if (msg) msg.textContent = "An error occurred during production. Check server logs.";
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
