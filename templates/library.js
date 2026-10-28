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
      window.dispatchEvent?.(new Event("shorts:style-selected"));
    });
  window.addEventListener("hashchange", chooseStyle);
  window.addEventListener("popstate", chooseStyle);
  chooseStyle();
  const input = document.querySelector("#episode-search");
  const stories = [...document.querySelectorAll(".story")];
  const lib = globalThis.shortsStories;
  const buttons = [...document.querySelectorAll("[data-format]")];
  const clear = document.querySelector("#clear-search");
  const status = document.querySelector("#filter-status");
  const empty = document.querySelector("#no-episodes");
  const collections = globalThis.shortsCollections;
  const rememberedFilters = collections?.read("shorts:episode-filters") ?? {};
  let format = ["all", "news", "tutorial"].includes(rememberedFilters.format)
    ? rememberedFilters.format
    : "all";
  let stage = ["all", "editing", "producing", "review", "publish", "published"].includes(
    rememberedFilters.stage,
  )
    ? rememberedFilters.stage
    : "all";
  const stageButtons = [...document.querySelectorAll("[data-stage-filter]")];
  const attentionFilter = document.querySelector("#attention-filter");
  if (typeof window.location.href === "string") {
    const requested = new URL(window.location.href).searchParams.get("stage");
    if (stageButtons.some((button) => button.dataset.stageFilter === requested)) stage = requested;
  }

  if (attentionFilter) attentionFilter.checked = rememberedFilters.attention === true;
  const searchTerms = () => (input.value ?? "").trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const versionRows = (story) => [...story.querySelectorAll("[data-version]")];
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  // A story is one row; its search index covers every saved version.
  for (const story of stories)
    story.dataset.search = versionRows(story)
      .map((row) => row.dataset.search)
      .join(" ");
  const rememberedOpen = new Set(
    Array.isArray(rememberedFilters.open) ? rememberedFilters.open : [],
  );

  function applyDrawer(story) {
    const drawer = story.querySelector(".versions");
    const open = story.dataset.open === "true";
    if (drawer) drawer.hidden = !open;
    story.querySelector("[data-versions-toggle]")?.setAttribute("aria-expanded", String(open));
  }
  // Searching opens the drawers whose versions match and marks the matching versions.
  function applySearch() {
    const terms = searchTerms();
    for (const story of stories) {
      let matched = 0;
      for (const row of versionRows(story)) {
        const match = terms.length > 0 && terms.every((term) => row.dataset.search.includes(term));
        row.classList.toggle("is-match", match);
        if (match) matched++;
      }
      story.dataset.open = String(matched > 0 || story.dataset.manualOpen === "true");
      applyDrawer(story);
    }
  }
  for (const story of stories) {
    story.dataset.manualOpen = String(rememberedOpen.has(story.dataset.story));
    for (const control of story.querySelectorAll("[data-versions-toggle]")) {
      control.hidden = false;
      control.addEventListener("click", () => {
        const open = story.dataset.open !== "true";
        story.dataset.open = String(open);
        story.dataset.manualOpen = String(open);
        applyDrawer(story);
        saveFilters();
      });
    }
    for (const label of story.querySelectorAll(".ver-static")) label.hidden = true;
  }

  const episodeCollection = collections?.create({
    id: "shorts",
    root: document.querySelector("#shorts-list"),
    query: input,
    status,
    empty,
    label: "stories",
    pageSize: 10,
    scrollTarget: document.querySelector("#episodes"),
    match: (story) =>
      (format === "all" || story.dataset.kind === format) &&
      (stage === "all" || story.dataset.stages.split(" ").includes(stage)) &&
      (!attentionFilter?.checked || story.dataset.attention === "true"),
    onRender: ({ ordered, start, perPage }) => {
      const versions = ordered.reduce((sum, story) => sum + Number(story.dataset.versions), 0);
      const total = stories.length;
      const range =
        ordered.length > perPage
          ? `${start + 1}–${Math.min(start + perPage, ordered.length)} of ${ordered.length}`
          : ordered.length === total
            ? String(total)
            : `${ordered.length} of ${total}`;
      if (status)
        status.textContent = ordered.length
          ? `${range} ${total === 1 ? "story" : "stories"} · ${plural(versions, "version")}`
          : `No matching stories (${total} total)`;
    },
  });
  function saveFilters() {
    collections?.save("shorts:episode-filters", {
      format,
      stage,
      attention: !!attentionFilter?.checked,
      open: stories
        .filter((story) => story.dataset.manualOpen === "true")
        .map((s) => s.dataset.story),
    });
  }
  function update(reset = false) {
    for (const button of buttons)
      button.setAttribute("aria-pressed", String(button.dataset.format === format));
    for (const button of stageButtons)
      button.setAttribute("aria-pressed", String(button.dataset.stageFilter === stage));
    for (const count of document.querySelectorAll("[data-stage-count]"))
      count.textContent = String(
        count.dataset.stageCount === "all"
          ? stories.length
          : stories.filter((story) =>
              story.dataset.stages.split(" ").includes(count.dataset.stageCount),
            ).length,
      );
    clear.hidden = !input.value;
    episodeCollection?.render({ reset });
    saveFilters();
    refreshNeeds();
  }
  // "Needs you" is derived from the same version rows that the workflow poll keeps current.
  function refreshNeeds() {
    const section = document.querySelector("#needs-you");
    if (!lib || !section || stories.length === 0) return;
    const ideas = [...document.querySelectorAll("#live-news-grid .news-story-card")].filter(
      (card) => !card.querySelector(".story-existing"),
    ).length;
    lib.renderNeedsYou(
      section,
      lib.needsYou(
        stories.map((story) => ({
          id: story.dataset.story,
          title: story.dataset.title,
          versions: versionRows(story).map(lib.readVersion),
        })),
        { ideas },
      ),
    );
  }
  for (const button of stageButtons)
    button.addEventListener("click", () => {
      stage = button.dataset.stageFilter;
      const url = new URL(window.location.href);
      url.searchParams.set("stage", stage);
      window.history.replaceState(null, "", url);
      update(true);
    });
  attentionFilter?.addEventListener("change", () => update(true));
  for (const button of buttons)
    button.addEventListener("click", () => {
      format = button.dataset.format;
      update(true);
    });
  input.addEventListener("input", () => {
    applySearch();
    update(true);
  });
  clear.addEventListener("click", () => {
    input.value = "";
    applySearch();
    update(true);
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
    applySearch();
    update(true);
    input.focus();
  });
  applySearch();
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
      if (lib) {
        const rows = new Map(
          [...document.querySelectorAll("[data-version]")].map((row) => [
            row.dataset.selector,
            row,
          ]),
        );
        for (const state of data.episodes) {
          const row = rows.get(state.selector);
          if (row) lib.applyWorkflowState(row, state);
        }
        for (const story of stories) lib.syncStory(story);
      }
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
      const stage = payload.stage || report.stage || "FAILED";
      if (stage !== "READY") {
        btn.disabled = false;
        btn.textContent = originalText;
        const issueMsg =
          report.issue?.message || payload.error || "Production stopped before MP4 export.";
        const timingDetail =
          Number.isFinite(report.durationSeconds) && Number.isFinite(report.hookSeconds)
            ? ` (Measured: ${report.durationSeconds.toFixed(1)}s total, ${report.hookSeconds.toFixed(2)}s opening hook)`
            : "";
        if (title) title.textContent = `${selector} · no video produced`;
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
        alert(data.error || "A production job is already running. Wait for it to complete.");
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
        return;
      }

      const createBtn = e.target?.closest ? e.target.closest(".create-short-from-news-btn") : null;
      if (createBtn?.dataset?.url) {
        e.preventDefault();
        createShortDraft(createBtn.dataset.url, createBtn);
        return;
      }

      const copyBtn = e.target?.closest ? e.target.closest(".copy-linkedin-btn") : null;
      if (copyBtn) {
        e.preventDefault();
        const rawText = decodeURIComponent(copyBtn.dataset.post || "");
        if (rawText) {
          navigator.clipboard.writeText(rawText).then(() => {
            const original = copyBtn.textContent;
            copyBtn.textContent = "Copied to clipboard! ✓";
            setTimeout(() => {
              copyBtn.textContent = original;
            }, 2500);
          });
        }
        return;
      }

      const promoteBtn = e.target?.closest ? e.target.closest(".promote-draft-btn") : null;
      if (promoteBtn?.dataset?.draftId) {
        e.preventDefault();
        const draftId = promoteBtn.dataset.draftId;
        promoteBtn.disabled = true;
        promoteBtn.textContent = "Promoting…";
        fetch("/api/news/promote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: draftId }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((data) => {
            showNewsNotice(
              `Promoted ${data.episode.id} to content/episodes! Backlog marked draft-ready.`,
            );
            promoteBtn.textContent = "Promoted ✓";
            setTimeout(() => {
              window.location.reload();
            }, 1200);
          })
          .catch((err) => {
            showNewsNotice(`Promotion failed: ${err.message}`, true);
            promoteBtn.disabled = false;
            promoteBtn.textContent = "Promote to Backlog";
          });
        return;
      }
    });

    // --- SAP News Hub Interactivity ---
    const scanNewsBtn = document.querySelector("#scan-news-btn");
    const newsGrid = document.querySelector("#live-news-grid");
    const customNewsForm = document.querySelector("#custom-news-form");
    const customNewsUrl = document.querySelector("#custom-news-url");
    const newsStatusMsg = document.querySelector("#news-status-msg");
    const stagedGrid = document.querySelector("#staged-drafts-grid");

    function showNewsNotice(message, isError = false) {
      if (!newsStatusMsg) return;
      newsStatusMsg.hidden = false;
      newsStatusMsg.className = `news-status-banner ${isError ? "error" : "success"}`;
      newsStatusMsg.textContent = message;
      if (!isError) {
        setTimeout(() => {
          newsStatusMsg.hidden = true;
        }, 8000);
      }
    }

    const escapeHtml = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      );
    // Keep in step with src/news/story-fit.ts.
    const normalizeUrl = (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
      } catch {
        return String(url).trim().toLowerCase();
      }
    };
    const normalizeTitle = (title) =>
      String(title)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const fitFor = (score) => {
      const steps =
        [
          [160, 5],
          [125, 4],
          [90, 3],
          [50, 2],
        ].find(([minimum]) => score >= minimum)?.[1] ?? 1;
      return { steps, label: steps >= 5 ? "High" : steps >= 3 ? "Good" : "Low" };
    };
    let existingShorts = [];
    try {
      const parsed = JSON.parse(newsGrid?.dataset?.existingShorts || "");
      if (Array.isArray(parsed?.shorts)) existingShorts = parsed.shorts;
    } catch {}
    const svgIcon = (path) =>
      `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;

    function renderStoryCard(story) {
      const card = document.createElement("article");
      card.className = "news-story-card";
      card.dataset.url = story.link;
      card.dataset.updated = story.publishedIso || "";
      card.dataset.score = String(story.relevanceScore || 0);
      const score = Number(story.relevanceScore) || 0;
      const fit = fitFor(score);
      const fitText = `${fit.label} fit`;
      const title = normalizeTitle(story.title || "");
      const url = normalizeUrl(story.link);
      const titleMatches = (item) =>
        (!item.url || item.url === url) &&
        (item.title === title ||
          (item.truncated && title.startsWith(`${item.title} `)) ||
          (item.truncated && item.title.length >= 58 && title.startsWith(item.title)));
      const lookup = (items) => items.find(titleMatches) || items.find((item) => item.url === url);
      const existing =
        lookup(existingShorts.filter((item) => item.kind === "short")) ||
        lookup(existingShorts.filter((item) => item.kind === "draft"));
      const tagsHtml = (story.categories || [])
        .slice(0, 3)
        .map((c) => `<span class="tag-chip">${escapeHtml(c)}</span>`)
        .join("");
      const pips = [1, 2, 3, 4, 5]
        .map((step) => `<i${step <= fit.steps ? ' class="on"' : ""}></i>`)
        .join("");
      const existingLabel = existing
        ? existing.kind === "draft"
          ? `Already a short · ${existing.id} · staged draft`
          : `Already a short · ${existing.id} · ${existing.versions} ${existing.versions === 1 ? "version" : "versions"}`
        : "";
      const badge = existing
        ? `<div class="story-existing">${svgIcon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>')}<span>${escapeHtml(existingLabel)}</span><a href="${escapeHtml(existing.href)}">Open</a></div>`
        : "";
      const action = existing
        ? `<button type="button" class="create-short-from-news-btn secondary-action" data-url="${escapeHtml(story.link)}">New angle</button>`
        : `<button type="button" class="create-short-from-news-btn primary-action" data-url="${escapeHtml(story.link)}">${svgIcon('<path d="M12 5v14M5 12h14"/>')}Start short</button>`;

      card.innerHTML = `
        <div class="story-meta">
          <span class="fit-meter" role="img" title="Fit score ${score}" aria-label="${fitText} for a short (score ${score})"><span class="fit-pips" aria-hidden="true">${pips}</span><span class="fit-label" aria-hidden="true">${fitText}</span></span>
          <span class="story-date">${escapeHtml(story.publishedIso || "")}</span>
          <div class="story-tags">${tagsHtml}</div>
        </div>
        <h4 class="story-title"><a href="${escapeHtml(story.link)}" target="_blank" rel="noreferrer">${escapeHtml(story.title)} ↗</a></h4>
        <p class="story-angle"><strong>Suggested angle:</strong> ${escapeHtml(story.angleSuggestion || "")}</p>
        ${badge}
        <div class="story-card-actions">${action}</div>
      `;
      return card;
    }

    async function refreshNewsStories() {
      if (!scanNewsBtn) return;
      const originalText = scanNewsBtn.textContent;
      scanNewsBtn.disabled = true;
      scanNewsBtn.textContent = "Scanning stories…";
      showNewsNotice("Scanning live official stories from news.sap.com…");
      try {
        const res = await fetch("/api/news/discover");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data.stories) && data.stories.length > 0) {
          if (newsGrid) {
            newsGrid.innerHTML = "";
            for (const story of data.stories) {
              newsGrid.appendChild(renderStoryCard(story));
            }
            globalThis.shortsWorkspace?.refresh("stories");
          }
          showNewsNotice(
            `Discovered ${data.stories.length} top SAP stories ranked for short videos.`,
          );
        } else {
          showNewsNotice("No new stories found at this time.");
        }
      } catch (err) {
        showNewsNotice(`Failed to scan stories: ${err.message}`, true);
      } finally {
        scanNewsBtn.disabled = false;
        scanNewsBtn.textContent = originalText;
      }
    }

    async function createShortDraft(url, btn) {
      if (!url) return;
      const originalHtml = btn ? btn.innerHTML : "";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Synthesizing draft…";
      }
      showNewsNotice(
        "Fetching story details, verifying claims, and generating 7-scene Short draft with LinkedIn copy…",
      );
      try {
        const res = await fetch("/api/news/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const ep = data.episode;
        showNewsNotice(`Short draft created: ${ep.id} ("${ep.title}")! Staged in content/drafts.`);

        if (stagedGrid) {
          const draftCard = document.createElement("article");
          draftCard.className = "staged-draft-card new-draft-highlight";
          draftCard.id = `draft-${ep.id}`;
          draftCard.innerHTML = `
            <div class="draft-header">
              <span class="draft-badge">${ep.id} · Staged Draft</span>
              <span class="draft-duration">${ep.targetDurationSeconds}s · ${ep.scenes ? ep.scenes.length : 7} scenes</span>
            </div>
            <h4>${ep.title}</h4>
            <p class="draft-hook"><strong>Hook:</strong> "${ep.scenes?.[0]?.narration ?? ""}"</p>
            <details class="draft-linkedin-details">
              <summary>View companion LinkedIn post copy <span aria-hidden="true">+</span></summary>
              <pre class="draft-linkedin-text">${ep.publication?.text || ""}</pre>
            </details>
            <div class="draft-actions">
              <button type="button" class="copy-linkedin-btn secondary-action" data-post="${encodeURIComponent(ep.publication?.text || "")}">📋 Copy LinkedIn Post</button>
              <button type="button" class="promote-draft-btn primary-action" data-draft-id="${ep.id}">Promote to Backlog</button>
            </div>
          `;
          stagedGrid.prepend(draftCard);
          globalThis.shortsWorkspace?.refresh("drafts");
          globalThis.shortsWorkspace?.revealDraft(draftCard);
        }
      } catch (err) {
        showNewsNotice(`Draft generation failed: ${err.message}`, true);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      }
    }

    document.querySelector("[data-new-short]")?.addEventListener?.("click", () => {
      // The workspace router shows Ideas → Official stories; focus once it has rendered.
      setTimeout(() => customNewsUrl?.focus?.(), 0);
    });

    scanNewsBtn?.addEventListener("click", refreshNewsStories);

    customNewsForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const url = customNewsUrl?.value?.trim();
      if (url) {
        createShortDraft(url, document.querySelector("#custom-news-submit"));
        if (customNewsUrl) customNewsUrl.value = "";
      }
    });
  }
})();
