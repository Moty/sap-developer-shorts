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
})();
