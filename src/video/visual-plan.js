/** Shared deterministic geometry for the browser and frame renderer. No wall clock or RNG. */
export function visualPrimitives(background, effect, progress, minimal = false) {
  const phase = minimal ? 0.5 : Math.max(0, Math.min(1, progress));
  const drift = effect === "drift" && !minimal ? Math.sin(phase * Math.PI * 2) : 0;
  const shapes = [];
  if (background === "aurora")
    for (let i = 0; i < 3; i++)
      shapes.push({
        kind: "glow",
        x: 150 + i * 390 + drift * (i % 2 ? -70 : 70),
        y: 180 + i * 520,
        r: 560 - i * 60,
        opacity: 0.23,
        secondary: i % 2 === 0,
      });
  if (background === "blueprint") {
    for (let x = 0; x <= 1080; x += 90)
      shapes.push({ kind: "line", x, y: 0, x2: x, y2: 1920, opacity: x % 270 ? 0.045 : 0.12 });
    for (let y = 0; y <= 1920; y += 90)
      shapes.push({ kind: "line", x: 0, y, x2: 1080, y2: y, opacity: y % 270 ? 0.045 : 0.12 });
  }
  if (background === "spotlight")
    shapes.push({
      kind: "glow",
      x: 540 + drift * 100,
      y: 480,
      r: 950,
      opacity: 0.25,
      secondary: false,
    });
  if (background === "editorial")
    for (let i = 0; i < 3; i++)
      shapes.push({
        kind: "line",
        x: 20 + i * 18,
        y: 110,
        x2: 20 + i * 18,
        y2: 1740,
        opacity: 0.2,
      });
  if (effect === "particles" && !minimal)
    for (let i = 0; i < 18; i++)
      shapes.push({
        kind: "dot",
        x: (i * 193 + 37) % 1080,
        y: (((i * 347 + 83) % 1920) + phase * 100) % 1920,
        r: (i % 3) + 2,
        opacity: 0.12 + (i % 4) * 0.025,
        secondary: i % 2 === 0,
      });
  return shapes;
}
export function primitivesSvg(shapes, accent, secondary) {
  return `<svg viewBox="0 0 1080 1920" preserveAspectRatio="none" aria-hidden="true"><defs><radialGradient id="visual-glow-a"><stop stop-color="${accent}"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient><radialGradient id="visual-glow-b"><stop stop-color="${secondary}"/><stop offset="1" stop-color="${secondary}" stop-opacity="0"/></radialGradient></defs>${shapes.map((s) => (s.kind === "line" ? `<path d="M${s.x} ${s.y}L${s.x2} ${s.y2}" fill="none" stroke="${accent}" stroke-width="2" opacity="${s.opacity}"/>` : `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${s.kind === "glow" ? `url(#visual-glow-${s.secondary ? "b" : "a"})` : s.secondary ? secondary : accent}" opacity="${s.opacity}"/>`)).join("")}</svg>`;
}
export function imagePlacement(width, height, box, fit, focalX = 0.5, focalY = 0.5) {
  const scale =
    fit === "cover"
      ? Math.max(box.width / width, box.height / height)
      : Math.min(box.width / width, box.height / height);
  return {
    x: box.x + (box.width - width * scale) * focalX,
    y: box.y + (box.height - height * scale) * focalY,
    width: width * scale,
    height: height * scale,
  };
}
/** @param {Array<{title:string,stock:number}>} rows */
export function chartPlan(rows, progress = 1, minimal = false) {
  if (
    !rows.length ||
    rows.length > 8 ||
    rows.some(
      (row) => !Number.isFinite(row.stock) || row.stock < 0 || typeof row.title !== "string",
    )
  )
    throw new Error("Chart needs one to eight captured rows with non-negative stock values.");
  const maximum = Math.max(1, ...rows.map((row) => row.stock));
  return {
    maximum,
    baseline: 0,
    rows: rows.map((row, index) => ({
      label: row.title,
      value: row.stock,
      fraction: row.stock / maximum,
      reveal: minimal ? 1 : Math.min(1, Math.max(0, progress * 4 - index * 0.16)),
    })),
  };
}
export function sequenceGeometry(kind, count, body) {
  const gap = 30;
  const height = Math.min(180, (body.height - gap * (count - 1)) / count);
  return Array.from({ length: count }, (_, index) => ({
    x: body.x + (kind === "timeline" ? 60 : 0),
    y: body.y + index * (height + gap),
    width: body.width - (kind === "timeline" ? 60 : 0),
    height,
    markerX: body.x + 18,
    markerY: body.y + index * (height + gap) + height / 2,
  }));
}
export function visualLabelLines(label, maximum = 16) {
  const lines = [];
  let line = "";
  for (const word of label.split(/\s+/u)) {
    if (line && `${line} ${word}`.length > maximum) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length <= 2 && lines.every((item) => [...item].length <= maximum)) return lines;
  const letters = [...label];
  return [letters.slice(0, maximum).join(""), letters.slice(maximum).join("")].filter(Boolean);
}
export function figureGeometry(body) {
  const height = Math.min(body.height - 190, body.width / 1.6);
  const width = height * 1.6;
  return { x: body.x + (body.width - width) / 2, y: body.y, width, height };
}
