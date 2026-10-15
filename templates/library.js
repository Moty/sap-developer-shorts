(() => {
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
})();
