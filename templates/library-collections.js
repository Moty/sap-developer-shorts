(() => {
  const read = (key) => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null") ?? {};
    } catch {
      return {};
    }
  };
  const save = (key, value) => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Browsing works without storage. */
    }
  };
  function create(options) {
    const { id, root } = options;
    if (!root) return null;
    const node = (suffix) => document.getElementById(`${id}-${suffix}`);
    const query = options.query ?? node("search");
    const sort = node("sort");
    const size = node("size");
    const status = options.status ?? node("status");
    const empty = options.empty ?? node("empty");
    const key = `shorts:collection:${id}`;
    const stored = read(key);
    const allowed = (select, value) =>
      Array.from(select?.options ?? []).some((option) => option.value === value);
    if (query && typeof stored.query === "string") query.value = stored.query.slice(0, 200);
    if (allowed(sort, stored.sort)) sort.value = stored.sort;
    if (allowed(size, stored.size)) size.value = stored.size;
    let page = Number.isSafeInteger(stored.page) && stored.page > 0 ? stored.page : 1;
    let ordered = [];
    let previousOrder = [];
    const pagers = [...document.querySelectorAll(`[data-collection-pages="${id}"]`)];
    const title = (item) =>
      (
        item.dataset.title ||
        item.querySelector("h3, h4, strong")?.textContent ||
        item.textContent ||
        ""
      ).trim();
    const numeric = (item, field) => {
      const value =
        field === "updated" ? Date.parse(item.dataset.updated || "") : Number(item.dataset[field]);
      return Number.isFinite(value) ? value : 0;
    };
    function render({ reset = false } = {}) {
      if (reset) page = 1;
      const items = Array.from(root.children);
      const terms = (query?.value ?? "").trim().toLowerCase().split(/\s+/u).filter(Boolean);
      const matches = items.filter(
        (item) =>
          (!options.match || options.match(item)) &&
          terms.every((term) =>
            (item.dataset.search || item.textContent || "").toLowerCase().includes(term),
          ),
      );
      const mode = sort?.value ?? "original";
      const compare = (a, b) => {
        if (mode === "title") return title(a).localeCompare(title(b), undefined, { numeric: true });
        if (mode === "id")
          return (a.dataset.selector || a.id).localeCompare(b.dataset.selector || b.id, undefined, {
            numeric: true,
          });
        if (mode === "recent" || mode === "oldest")
          return (numeric(b, "updated") - numeric(a, "updated")) * (mode === "oldest" ? -1 : 1);
        if (mode === "score") return numeric(b, "score") - numeric(a, "score");
        return 0;
      };
      // Stable ties follow the original content order, even after changing sort modes.
      for (const item of items)
        if (!item.dataset.collectionOrder) item.dataset.collectionOrder = String(++create.sequence);
      ordered = matches.sort(
        (a, b) =>
          compare(a, b) || Number(a.dataset.collectionOrder) - Number(b.dataset.collectionOrder),
      );
      const perPage = Number(size?.value) || options.pageSize || 8;
      const pages = Math.max(1, Math.ceil(ordered.length / perPage));
      page = Math.min(Math.max(1, page), pages);
      const sizeLabel = size?.closest?.("label");
      if (sizeLabel)
        sizeLabel.hidden =
          items.length <= Math.min(...Array.from(size.options, (option) => Number(option.value)));
      const start = (page - 1) * perPage;
      const visible = new Set(ordered.slice(start, start + perPage));
      const all = [...ordered, ...items.filter((item) => !matches.includes(item))];
      if (
        all.length !== previousOrder.length ||
        all.some((item, index) => item !== previousOrder[index])
      ) {
        root.append(...all);
        previousOrder = all;
      }
      for (const item of items) item.hidden = !visible.has(item);
      if (status)
        status.textContent = ordered.length
          ? `${start + 1}–${Math.min(start + perPage, ordered.length)} of ${ordered.length} ${options.label ?? "items"}${ordered.length !== items.length ? ` (${items.length} total)` : ""}`
          : `No matching ${options.label ?? "items"} (${items.length} total)`;
      if (empty) empty.hidden = ordered.length !== 0;
      for (const pager of pagers) {
        pager.hidden = pages <= 1;
        const select = pager.querySelector("select");
        if (select.options.length !== pages) {
          select.replaceChildren(
            ...Array.from({ length: pages }, (_, index) => {
              const option = document.createElement("option");
              option.value = String(index + 1);
              option.textContent = `${index + 1} of ${pages}`;
              return option;
            }),
          );
        }
        select.value = String(page);
        pager.querySelector('[data-page="previous"]').disabled = page === 1;
        pager.querySelector('[data-page="next"]').disabled = page === pages;
      }
      save(key, { query: query?.value ?? "", sort: sort?.value, size: size?.value, page });
      options.onRender?.({ ordered, start, perPage, pages, page });
      return { page, pages, count: ordered.length, visible: visible.size };
    }
    const scrollToList = () => options.scrollTarget?.scrollIntoView({ block: "start" });
    for (const pager of pagers) {
      for (const direction of ["previous", "next"])
        pager.querySelector(`[data-page="${direction}"]`).addEventListener("click", () => {
          page += direction === "next" ? 1 : -1;
          render();
          scrollToList();
        });
      pager.querySelector("select").addEventListener("change", (event) => {
        page = Number(event.target.value);
        render();
        scrollToList();
      });
    }
    query?.addEventListener("input", () => render({ reset: true }));
    sort?.addEventListener("change", () => render({ reset: true }));
    size?.addEventListener("change", () => render({ reset: true }));
    node("reset")?.addEventListener("click", () => {
      if (query) query.value = "";
      render({ reset: true });
      query?.focus();
    });
    render();
    return {
      render,
      reveal(item) {
        if (query) query.value = "";
        render({ reset: true });
        const index = ordered.indexOf(item);
        if (index >= 0)
          page = Math.floor(index / (Number(size?.value) || options.pageSize || 8)) + 1;
        render();
      },
    };
  }
  create.sequence = 0;
  globalThis.shortsCollections = { create, read, save };
})();
