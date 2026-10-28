(() => {
  const collections = globalThis.shortsCollections;
  if (!collections || !document.querySelector("[data-workspace-view]")) return;
  const controllers = {};
  for (const [id, rootId, label] of [
    ["stories", "live-news-grid", "stories"],
    ["drafts", "staged-drafts-grid", "drafts"],
    ["curated", "curated-list", "news ideas"],
    ["tutorials", "tutorial-list", "tutorial ideas"],
    ["stock", "stock-voice-list", "stock voices"],
    ["samples", "saved-stock-voice-list", "saved stock voices"],
  ])
    controllers[id] = collections.create({
      id,
      root: document.getElementById(rootId),
      label,
      pageSize: 6,
    });
  for (const tool of document.querySelectorAll("[data-collection-tools]")) tool.hidden = false;
  const sections = [...document.querySelectorAll("[data-workspace-view]")];
  const links = [...document.querySelectorAll("[data-workspace-link]")];
  const ideaPanels = [...document.querySelectorAll("[data-idea-panel]")];
  const ideaTabs = [...document.querySelectorAll("[data-idea-tab]")];
  const headings = {
    episodes: ["My shorts", "Find a draft, review a video, or pick up where you left off."],
    ideas: [
      "Ideas & SAP news",
      "Official SAP stories ranked for a short, plus your staged drafts and backlog.",
    ],
    styles: ["Delivery styles", "Explore storytelling formats and compare prepared examples."],
    voices: ["Voice library", "Manage your personal recordings and compare stock narrators."],
    writing: [
      "Settings",
      "Choose the writing engine: Gemma locally for free, or an SAP Hyperspace model that may incur cost.",
    ],
  };
  let activeView;
  const anchors = {
    stories: "#ideas",
    drafts: "#staged-drafts-section",
    curated: "#curated-ideas",
    tutorials: "#tutorial-ideas",
  };
  function selectIdea(id) {
    for (const panel of ideaPanels) panel.hidden = panel.dataset.ideaPanel !== id;
    for (const tab of ideaTabs) {
      if (tab.dataset.ideaTab === id) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
  }
  function route({ scroll = false } = {}) {
    const hash = window.location.hash;
    const idea =
      hash === anchors.drafts || hash.startsWith("#draft-")
        ? "drafts"
        : hash === anchors.curated
          ? "curated"
          : hash === anchors.tutorials
            ? "tutorials"
            : "stories";
    const view =
      hash === "#writing" || hash === "#settings"
        ? "writing"
        : hash === "#voices" || hash === "#my-voice-panel"
          ? "voices"
          : hash === "#styles" || hash === "#formats" || hash.startsWith("#compare-")
            ? "styles"
            : hash === "#ideas" ||
                Object.values(anchors).includes(hash) ||
                hash.startsWith("#draft-")
              ? "ideas"
              : "episodes";
    if (activeView) collections.save(`shorts:scroll:${activeView}`, { y: window.scrollY ?? 0 });
    if (activeView === "voices" && view !== "voices")
      window.dispatchEvent(new Event("shorts:voice-panel-hidden"));
    for (const section of sections) {
      if (!section.hidden && section.dataset.workspaceView !== view)
        for (const media of section.querySelectorAll("audio, video")) media.pause();
      section.hidden = section.dataset.workspaceView !== view;
    }
    for (const link of links) {
      link.classList.toggle("nav-current", link.dataset.workspaceLink === view);
      if (link.dataset.workspaceLink === view) {
        link.setAttribute("aria-current", "page");
        // Keep the active tab visible when the phone strip scrolls horizontally.
        const strip = link.parentElement;
        if (strip && strip.scrollWidth > strip.clientWidth)
          strip.scrollLeft = Math.max(0, link.offsetLeft - 24);
      } else link.removeAttribute("aria-current");
    }
    document.getElementById("workspace-title").textContent = headings[view][0];
    document.getElementById("workspace-description").textContent = headings[view][1];
    selectIdea(idea);
    if (hash.startsWith("#draft-")) {
      const draft = document.getElementById(hash.slice(1));
      if (draft) controllers.drafts?.reveal(draft);
    }
    activeView = view;
    if (scroll) {
      const target =
        hash.startsWith("#compare-") || hash.startsWith("#draft-")
          ? document.getElementById(hash.slice(1))
          : null;
      if (target) target.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    }
  }
  function navigate(hash) {
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    route({ scroll: true });
  }
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.('a[href^="#"]');
    if (
      !link ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.hasAttribute("data-style-choice")
    )
      return;
    if (
      !link.hasAttribute("data-workspace-link") &&
      !link.hasAttribute("data-idea-tab") &&
      ![
        "#ideas",
        "#episodes",
        "#formats",
        "#styles",
        "#voices",
        "#writing",
        "#settings",
        "#studio-produce-banner",
      ].includes(link.hash)
    )
      return;
    event.preventDefault();
    navigate(link.hash);
  });
  window.addEventListener("hashchange", () => route({ scroll: true }));
  window.addEventListener("popstate", () => route({ scroll: true }));
  window.addEventListener("shorts:style-selected", () => route({ scroll: true }));
  window.addEventListener("pagehide", () =>
    collections.save(`shorts:scroll:${activeView}`, { y: window.scrollY ?? 0 }),
  );
  globalThis.shortsWorkspace = {
    refresh(id) {
      controllers[id]?.render();
      if (id === "drafts")
        document.getElementById("drafts-count").textContent = String(
          document.getElementById("staged-drafts-grid").children.length,
        );
    },
    revealDraft(item) {
      controllers.drafts?.reveal(item);
      navigate(anchors.drafts);
      item.scrollIntoView({ block: "nearest" });
    },
  };
  route();
  const remembered = collections.read(`shorts:scroll:${activeView}`);
  if (Number.isFinite(remembered.y) && remembered.y > 0)
    requestAnimationFrame(() => window.scrollTo(0, remembered.y));
  else if (
    [
      "",
      "#episodes",
      "#ideas",
      "#styles",
      "#voices",
      "#writing",
      "#settings",
      ...Object.values(anchors),
    ].includes(window.location.hash)
  )
    requestAnimationFrame(() => window.scrollTo(0, 0));
})();
