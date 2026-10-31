(() => {
  // Enhances the shared episode header. Menus are <details>, so links work without this script.
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
  const menus = [...document.querySelectorAll("[data-version-menu]")];
  const close = (menu, restoreFocus = false) => {
    if (!menu.open) return;
    menu.open = false;
    if (restoreFocus) menu.querySelector("summary")?.focus();
  };
  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      for (const other of menus) if (other !== menu) close(other);
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.open) {
        event.preventDefault();
        event.stopPropagation();
        close(menu, true);
        return;
      }
      if (!menu.open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const links = [...menu.querySelectorAll(".ep-ver-menu a")];
      if (!links.length) return;
      event.preventDefault();
      const index = links.indexOf(document.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? links.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % links.length
              : (index - 1 + links.length) % links.length;
      links[next]?.focus();
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of menus) if (!menu.contains(event.target)) close(menu);
  });
  document.addEventListener("focusin", (event) => {
    for (const menu of menus) if (!menu.contains(event.target)) close(menu);
  });
  const labels = {
    editing: "Editing",
    producing: "Producing",
    review: "To review",
    publish: "To publish",
    published: "Published",
  };
  /** Live workflow stages from /api/workflow, when a page already fetched them. */
  function setStages(episodes) {
    if (!Array.isArray(episodes)) return;
    for (const state of episodes) {
      if (!state || !Object.hasOwn(labels, state.stage)) continue;
      for (const link of document.querySelectorAll("[data-version-selector]")) {
        if (link.dataset.versionSelector !== state.selector) continue;
        const badge = link.querySelector("[data-version-stage]");
        if (badge) {
          badge.dataset.badge = state.stage;
          badge.textContent = labels[state.stage];
        }
      }
      for (const chip of document.querySelectorAll("[data-version-current-stage]"))
        if (chip.dataset.selector === state.selector) chip.textContent = labels[state.stage];
    }
  }
  globalThis.shortsEpisodeShell = { setStages };
  const header =
    typeof document.querySelector === "function" ? document.querySelector(".ep-shell") : null;
  // Read-only live stages where the page's CSP allows it; offline or static copies keep the
  // neutral build-time labels without any message.
  if (
    header?.hasAttribute("data-live-stages") &&
    typeof fetch === "function" &&
    /^https?:$/u.test(globalThis.location?.protocol ?? "")
  )
    fetch("/api/workflow", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setStages(data?.episodes))
      .catch(() => {});
  // Pages that size content to the viewport (the deck's Focus view) subtract the header and,
  // on phones, the fixed action bar.
  const root = document.documentElement;
  function measure() {
    if (!header || !root?.style) return;
    root.style.setProperty(
      "--ep-shell-height",
      `${Math.ceil(header.getBoundingClientRect().height)}px`,
    );
    const bar = header.querySelector(".ep-actions");
    const fixed = bar && getComputedStyle(bar).position === "fixed";
    root.style.setProperty(
      "--ep-bar-height",
      `${fixed ? Math.ceil(bar.getBoundingClientRect().height) : 0}px`,
    );
  }
  if (header) {
    measure();
    addEventListener("resize", measure);
    if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(header);
  }
})();
