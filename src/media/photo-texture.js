/**
 * Shared browser/export renderer. Reuses only pixels from the source portrait;
 * no painted lips/teeth, whole-head motion, or edits outside the mouth ellipse.
 * @param {Uint8ClampedArray} source
 * @param {number} width
 * @param {number} height
 * @param {{mouthX?:number,mouthY?:number,mouthScale?:number,mouthAngle?:number,mouthAspect?:number}} config
 * @param {string} viseme
 * @param {number} [strength]
 */
export function warpPhotoMouth(source, width, height, config, viseme, strength = 1) {
  const output = new Uint8ClampedArray(source);
  if (viseme === "rest" || strength <= 0) return output;
  const shapes = {
    open_a: [0.98, 1.35],
    open_e: [1.04, 0.95],
    open_o: [0.84, 1.2],
    open_u: [0.8, 0.88],
    consonant: [1, 0.62],
    smile: [1.04, 0.94],
  };
  const shape = shapes[viseme];
  if (!shape) return output;
  const unit = (width / 140) * Math.max(0.5, Math.min(2, config.mouthScale ?? 1));
  const mx = width * (config.mouthX ?? 0.5);
  const my = height * (config.mouthY ?? 0.68);
  const rx = 16 * unit;
  const ry = Math.max(3, Math.min(10, 16 * (config.mouthAspect ?? 0.375))) * unit;
  const angle = config.mouthAngle ?? 0;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const fx = (shape[0] - 1) * Math.min(1, strength);
  const fy = (shape[1] - 1) * Math.min(1, strength);
  const extentX = Math.abs(rx * c) + Math.abs(ry * s);
  const extentY = Math.abs(rx * s) + Math.abs(ry * c);
  for (
    let y = Math.max(0, Math.floor(my - extentY));
    y <= Math.min(height - 1, Math.ceil(my + extentY));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(mx - extentX));
      x <= Math.min(width - 1, Math.ceil(mx + extentX));
      x++
    ) {
      const dx = x - mx,
        dy = y - my;
      const u = dx * c + dy * s,
        v = -dx * s + dy * c;
      const r2 = (u / rx) ** 2 + (v / ry) ** 2;
      if (r2 >= 1) continue;
      // The zero-displacement boundary and smooth falloff avoid a patch seam.
      const weight = (1 - r2) ** 2;
      const su = u / (1 + fx * weight),
        sv = v / (1 + fy * weight);
      const px = Math.max(0, Math.min(width - 1.001, mx + su * c - sv * s));
      const py = Math.max(0, Math.min(height - 1.001, my + su * s + sv * c));
      const x0 = Math.floor(px),
        y0 = Math.floor(py),
        ax = px - x0,
        ay = py - y0;
      const p = (y0 * width + x0) * 4,
        q = (y * width + x) * 4;
      for (let ch = 0; ch < 4; ch++)
        output[q + ch] =
          source[p + ch] * (1 - ax) * (1 - ay) +
          source[p + 4 + ch] * ax * (1 - ay) +
          source[p + width * 4 + ch] * (1 - ax) * ay +
          source[p + (width + 1) * 4 + ch] * ax * ay;
    }
  }
  return output;
}

/** Convert MediaPipe landmarks on the exact square portrait to saved geometry.
 * @param {{x:number,y:number}[]} points
 */
export function mouthGeometry(points) {
  const ids = [61, 291, 0, 17, 13, 14];
  if (ids.some((i) => !points[i] || !Number.isFinite(points[i].x) || !Number.isFinite(points[i].y)))
    throw new Error("The lips could not be located reliably. Try a clearer portrait.");
  const left = points[61],
    right = points[291],
    top = points[0],
    bottom = points[17];
  const dx = right.x - left.x,
    dy = right.y - left.y;
  const width = Math.hypot(dx, dy),
    angle = Math.atan2(dy, dx);
  const x = (left.x + right.x) / 2,
    y = (top.y + bottom.y) / 2;
  const height = Math.abs(
    (bottom.y - top.y) * Math.cos(angle) - (bottom.x - top.x) * Math.sin(angle),
  );
  if (
    width < 0.06 ||
    width > 0.38 ||
    height < 0.008 ||
    height > width * 0.8 ||
    Math.abs(angle) > 0.55 ||
    x < 0.2 ||
    x > 0.8 ||
    y < 0.4 ||
    y > 0.9
  )
    throw new Error("Use a closer, front-facing portrait or adjust the mouth manually.");
  return {
    mouthX: Number(x.toFixed(3)),
    mouthY: Number(y.toFixed(3)),
    mouthScale: Number(Math.max(0.5, Math.min(2, width / (27 / 140))).toFixed(3)),
    mouthAngle: Number(angle.toFixed(4)),
    mouthAspect: Number(Math.max(0.2, Math.min(0.6, (height / width) * 0.8)).toFixed(4)),
  };
}
