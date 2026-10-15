const scenes = [...document.querySelectorAll(".scene")],
  buttons = [...document.querySelectorAll(".scene-button")],
  scrub = document.getElementById("scrub"),
  play = document.getElementById("play"),
  time = document.getElementById("time"),
  canvas = document.querySelector(".canvas"),
  phone = document.querySelector(".phone"),
  narration = document.getElementById("narration"),
  timingData = document.getElementById("narration-data"),
  measured = timingData ? JSON.parse(timingData.textContent) : null;
let position = 0,
  playing = false,
  last = 0,
  animation = 0;
const duration = measured ? measured.durationSeconds : Number(scrub.max),
  clock = (n) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
scrub.max = duration;
if (measured) {
  measured.scenes.forEach((scene, index) => {
    scenes[index].dataset.start = scene.startSeconds;
    scenes[index].dataset.end = scene.endSeconds;
    buttons[index].querySelector(".scene-time").textContent =
      `${scene.startSeconds.toFixed(1)}–${scene.endSeconds.toFixed(1)}s`;
  });
}
function show(value) {
  position = Math.max(0, Math.min(duration, value));
  scrub.value = position;
  time.textContent = `${clock(position)} / ${clock(duration)}`;
  const active = scenes.findIndex(
    (scene, index) =>
      position >= Number(scene.dataset.start) &&
      (position < Number(scene.dataset.end) || index === scenes.length - 1),
  );
  scenes.forEach((scene, index) => {
    scene.hidden = index !== active;
  });
  buttons.forEach((button, index) => {
    button.setAttribute("aria-pressed", String(index === active));
  });
  if (measured && active >= 0) {
    const cue = measured.cues.find(
      (item) => position >= item.startSeconds && position < item.endSeconds,
    );
    scenes[active].querySelector(".caption").textContent = cue
      ? `${cue.speakerName ? `${cue.speakerName}: ` : ""}${cue.text}`
      : "";
    const presenter = scenes[active].querySelector(".mini-presenter");
    if (presenter.dataset.speakers)
      presenter.textContent = cue?.speakerName ?? presenter.dataset.speakers;
  }
}
function pause() {
  cancelAnimationFrame(animation);
  playing = false;
  if (narration) narration.pause();
  play.textContent = "▶";
  play.setAttribute("aria-label", narration ? "Play narrated preview" : "Play silent storyboard");
}
function seek(value) {
  pause();
  if (narration) narration.currentTime = value;
  show(value);
}
function frame(now) {
  if (!playing) return;
  if (narration) show(narration.currentTime);
  else if (last) show(position + (now - last) / 1000);
  last = now;
  if (position >= duration) {
    pause();
    return;
  }
  animation = requestAnimationFrame(frame);
}
play.addEventListener("click", async () => {
  if (playing) {
    pause();
    return;
  }
  if (position >= duration) seek(0);
  if (narration) {
    narration.currentTime = position;
    try {
      await narration.play();
    } catch {
      pause();
      play.title = "Audio could not play. Open the preview through the local web server.";
      return;
    }
  }
  playing = true;
  last = 0;
  play.textContent = "Ⅱ";
  play.setAttribute("aria-label", narration ? "Pause narrated preview" : "Pause storyboard");
  animation = requestAnimationFrame(frame);
});
scrub.addEventListener("input", () => {
  seek(Number(scrub.value));
});
buttons.forEach((button, index) => {
  button.addEventListener("click", () => {
    seek(Number(scenes[index].dataset.start));
  });
});
if (narration)
  narration.addEventListener("ended", () => {
    pause();
    show(duration);
  });
new ResizeObserver(() => {
  canvas.style.transform = `scale(${phone.clientWidth / canvas.offsetWidth})`;
}).observe(phone);
show(0);
