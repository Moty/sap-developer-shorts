(() => {
  const plan = JSON.parse(document.getElementById("presentation-data").textContent);
  const reduced =
    matchMedia("(prefers-reduced-motion: reduce)").matches || plan.design?.motion === "minimal";
  document.documentElement.dataset.reducedMotion = String(reduced);
  const deck = new Reveal(document.querySelector(".reveal"), {
    view: "slide",
    scrollActivationWidth: 0,
    width: 1080,
    height: 1920,
    margin: 0,
    minScale: 0.08,
    maxScale: 1,
    embedded: true,
    center: false,
    controls: false,
    progress: false,
    hash: false,
    transition: reduced ? "none" : "fade",
    transitionSpeed:
      plan.design?.motion === "snappy"
        ? "fast"
        : plan.design?.motion === "smooth"
          ? "slow"
          : "default",
    autoAnimateDuration: reduced
      ? 0
      : plan.design?.motion === "snappy"
        ? 0.3
        : plan.design?.motion === "smooth"
          ? 0.8
          : 0.5,
    autoAnimateEasing: "ease-out",
    keyboard: true,
    touch: true,
    overview: false,
  });
  const audio = document.getElementById("deck-audio");
  const play = document.getElementById("deck-play");
  const seek = document.getElementById("deck-seek");
  const status = document.getElementById("deck-status");
  const slides = [...document.querySelectorAll(".deck-slide")];
  let automaticNavigation = false;
  let time = 0,
    playing = false,
    started = 0,
    origin = 0,
    frame;
  const label = () => `Play ${audio ? "with narration" : "silent preview"}`;
  const stop = () => {
    playing = false;
    cancelAnimationFrame(frame);
    audio?.pause();
    play.textContent = label();
    for (const slide of slides) {
      const chip = slide.querySelector(".spoken-code-focus");
      if (chip) chip.hidden = true;
      const counter = slide.querySelector("[data-counter]");
      if (counter)
        counter.textContent = String(
          Array.from(slide.querySelectorAll(".result-rows [data-stock]")).filter(
            (row) => !row.hidden,
          ).length,
        );
    }
  };
  const sceneAt = (value) =>
    Math.max(
      0,
      plan.scenes.findIndex(
        (scene, index) =>
          value >= scene.start && (value < scene.end || index === plan.scenes.length - 1),
      ),
    );
  function update(value, navigate = true) {
    time = Math.max(0, Math.min(plan.duration, value));
    const index = sceneAt(time),
      scene = plan.scenes[index];
    if (navigate && deck.getIndices().h !== index) {
      automaticNavigation = true;
      try {
        deck.slide(index);
      } finally {
        automaticNavigation = false;
      }
    }
    seek.value = String(time);
    document.getElementById("deck-time").textContent =
      `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
    const cue = plan.cues.find((item) => time >= item.start && time < item.end);
    slides[index].querySelector(".narration-caption").textContent = cue
      ? `${cue.speaker}: ${cue.text}`
      : "";
    slides[index].querySelector(".scene-progress i").style.transform =
      `scaleX(${Math.min(1, (time - scene.start) / (scene.end - scene.start))})`;
    if (playing && cue && scene.kind === "code") {
      const ignored = new Set(["the", "and", "with", "from", "this", "that", "for", "you", "your"]);
      const words = new Set(
        (cue.text.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? [])
          .map((word) => word.toLowerCase())
          .filter((word) => (word.length >= 3 || word === "id") && !ignored.has(word)),
      );
      for (const line of slides[index].querySelectorAll(".code-line"))
        line.classList.toggle(
          "focused",
          (line.textContent.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? []).some((word) =>
            words.has(word.toLowerCase()),
          ),
        );
    }
    const focusChip = slides[index].querySelector(".spoken-code-focus");
    if (focusChip) {
      const terms = Array.from(slides[index].querySelectorAll(".code-line.focused")).flatMap(
        (line) => line.textContent.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? [],
      );
      const spoken = new Set(
        (cue?.text.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? []).map((word) => word.toLowerCase()),
      );
      const matches = [
        ...new Set(
          terms.filter(
            (word) =>
              spoken.has(word.toLowerCase()) && (word.length >= 3 || word.toLowerCase() === "id"),
          ),
        ),
      ].slice(0, 2);
      focusChip.hidden = !playing || matches.length === 0;
      focusChip.textContent = matches.join(" · ");
    }
    if (playing && !reduced && scene.kind === "results") {
      const rowCount = scene.rows?.length ?? 0;
      const focused = rowCount ? Math.floor(Math.max(0, time - scene.start) / 2.4) % rowCount : -1;
      for (const view of slides[index].querySelectorAll("[data-view]"))
        Array.from(view.children).forEach((row, position) => {
          row.classList.toggle("is-spotlight", position === focused);
        });
    }
    const counter = slides[index].querySelector("[data-counter]");
    const filter = slides[index].querySelector("[data-stock-filter]");
    if (counter && (!filter || filter.value === "0"))
      counter.textContent = String(
        playing && !reduced
          ? Math.round(Number(counter.dataset.counter) * Math.min(1, (time - scene.start) / 0.8))
          : counter.dataset.counter,
      );
    for (const button of document.querySelectorAll(".presentation-inspector [data-jump]")) {
      if (Number(button.dataset.jump) === index) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    document.getElementById("deck-previous").disabled = index === 0;
    document.getElementById("deck-next").disabled = index === plan.scenes.length - 1;
  }
  function jump(index) {
    stop();
    const scene = plan.scenes[Math.max(0, Math.min(plan.scenes.length - 1, index))];
    if (audio) audio.currentTime = scene.start;
    deck.slide(scene.index);
    update(scene.start);
  }
  function tick(now) {
    if (!playing) return;
    const next = audio ? audio.currentTime : origin + (now - started) / 1000;
    update(next);
    if (next >= plan.duration - 0.02) {
      stop();
      update(plan.duration);
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  play.addEventListener("click", async () => {
    if (playing) {
      stop();
      return;
    }
    if (time >= plan.duration - 0.02) update(0);
    for (const filter of document.querySelectorAll("[data-stock-filter]")) {
      filter.value = "0";
      filter.dispatchEvent(new Event("input"));
    }
    try {
      if (audio) {
        audio.currentTime = time;
        await audio.play();
      }
      playing = true;
      origin = time;
      started = performance.now();
      play.textContent = "Pause";
      frame = requestAnimationFrame(tick);
    } catch {
      status.textContent =
        "Narration could not play. Check this saved audio, or explore the scenes manually.";
      stop();
    }
  });
  document.getElementById("deck-focus").addEventListener("click", (event) => {
    const active = document.body.classList.toggle("focus-presentation");
    event.currentTarget.setAttribute("aria-pressed", String(active));
    event.currentTarget.textContent = active ? "Show evidence" : "Focus view";
    requestAnimationFrame(() => deck.layout());
  });
  seek.addEventListener("input", () => {
    stop();
    if (audio) audio.currentTime = Number(seek.value);
    update(Number(seek.value));
  });
  audio?.addEventListener("ended", () => {
    stop();
    update(plan.duration);
  });
  audio?.addEventListener("error", () => {
    stop();
    status.textContent =
      "This presentation's narration is unavailable. Its script, scenes and evidence remain available.";
  });
  document.getElementById("deck-previous").addEventListener("click", () => jump(sceneAt(time) - 1));
  document.getElementById("deck-next").addEventListener("click", () => jump(sceneAt(time) + 1));
  for (const button of document.querySelectorAll("[data-jump]"))
    button.addEventListener("click", () => jump(Number(button.dataset.jump)));
  for (const slide of slides) {
    const lines = [...slide.querySelectorAll(".code-line")];
    const focus = slide.querySelector("[data-code-focus]");
    const highlight = () => {
      lines.forEach((line, index) => {
        line.classList.toggle("focused", index === Number(focus.value));
      });
    };
    focus?.addEventListener("input", () => {
      stop();
      highlight();
    });
    if (focus) highlight();
    slide.querySelector("[data-show-story]")?.addEventListener("click", (event) => {
      stop();
      const note = slide.querySelector(".story-explanation");
      note.hidden = !note.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!note.hidden));
    });
    for (const button of slide.querySelectorAll("[data-result-view]"))
      button.addEventListener("click", () => {
        stop();
        for (const view of slide.querySelectorAll("[data-view]"))
          view.hidden = view.dataset.view !== button.dataset.resultView;
        for (const item of slide.querySelectorAll("[data-result-view]"))
          item.setAttribute("aria-pressed", String(item === button));
      });
    const filter = slide.querySelector("[data-stock-filter]");
    filter?.addEventListener("input", () => {
      stop();
      let visible = 0;
      for (const row of slide.querySelectorAll(".result-rows [data-stock]")) {
        row.hidden = Number(row.dataset.stock) < Number(filter.value);
        if (!row.hidden) visible++;
      }
      for (const row of slide.querySelectorAll(".result-bars [data-stock]"))
        row.hidden = Number(row.dataset.stock) < Number(filter.value);
      slide.querySelector(".stock-filter output").textContent = filter.value;
      slide.querySelector("[data-counter]").textContent = String(visible);
    });
  }
  function fitVisualHeadline(slide) {
    if (!plan.design || !slide) return;
    const heading = slide.querySelector("h2");
    const limit =
      slide.classList.contains("feed-hook") || slide.classList.contains("feed-closing") ? 360 : 200;
    let size = Number.parseFloat(getComputedStyle(heading).fontSize);
    while (heading.scrollHeight > limit && size > 48) {
      size = Math.max(48, size - 2);
      heading.style.fontSize = `${size}px`;
    }
  }
  deck.on("slidechanged", (event) => {
    fitVisualHeadline(slides[event.indexh]);
    if (!automaticNavigation) {
      stop();
      const scene = plan.scenes[event.indexh];
      if (audio) audio.currentTime = scene.start;
      update(scene.start, false);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  window.addEventListener("pagehide", stop);
  deck
    .initialize()
    .then(() => {
      fitVisualHeadline(slides[0]);
      update(0);
    })
    .catch(() => {
      status.textContent =
        "The presentation could not initialize. Read the script and sources, or reload the local studio.";
      play.disabled = true;
    });
})();
