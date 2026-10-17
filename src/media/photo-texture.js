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
  // Width scale, upper-lip displacement and lower-lip displacement at 140px.
  const shapes = {
    open_a: [0.98, -1.2, 2],
    open_e: [1.04, -0.6, 1],
    open_o: [0.84, -0.9, 1.7],
    open_u: [0.8, -0.4, 1],
    consonant: [1, 1.2, -1.8],
    smile: [1.06, 0.3, -0.5],
  };
  const shape = shapes[viseme];
  if (!shape) return output;
  const unit = (width / 140) * Math.max(0.5, Math.min(2, config.mouthScale ?? 1));
  const mx = width * (config.mouthX ?? 0.5);
  const my = height * (config.mouthY ?? 0.68);
  const rx = 16 * unit;
  const lipHeight = 16 * (config.mouthAspect ?? 0.375) * unit;
  // A stationary feather boundary surrounds the moving lip core. Using the
  // lip height itself as the boundary previously suppressed motion below 1px.
  const ry = Math.max(8 * unit, lipHeight + 4 * unit);
  const angle = config.mouthAngle ?? 0;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const fx = (shape[0] - 1) * Math.min(1, strength);
  const amount = Math.min(1, strength);
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
      const horizontalFalloff = 1 - (u / rx) ** 2;
      const boundary = ry * Math.sqrt(horizontalFalloff);
      const core = Math.min(lipHeight, boundary * 0.55);
      const epsilon = boundary * 0.01;
      // Ordered source/destination landmarks keep each vertical slice monotonic:
      // fixed boundary -> upper lip -> opening -> lower lip -> fixed boundary.
      const upper = Math.max(
        -boundary + epsilon,
        Math.min(-core * 0.2, -core + shape[1] * unit * amount * horizontalFalloff),
      );
      const lower = Math.min(
        boundary - epsilon,
        Math.max(core * 0.2, core + shape[2] * unit * amount * horizontalFalloff),
      );
      let sv;
      if (v < upper) sv = -boundary + ((v + boundary) / (upper + boundary)) * (boundary - core);
      else if (v < 0) sv = (v / upper) * -core;
      else if (v < lower) sv = (v / lower) * core;
      else sv = core + ((v - lower) / (boundary - lower)) * (boundary - core);
      const su = u / (1 + fx * (1 - r2) ** 2);
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
    y = (points[13].y + points[14].y) / 2;
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
  const mouthX = Number(x.toFixed(3));
  const mouthY = Number(y.toFixed(3));
  const mouthScale = Number(Math.max(0.5, Math.min(2, width / (27 / 140))).toFixed(3));
  const mouthAngle = Number(angle.toFixed(4));
  const mouthAspect = Number(Math.max(0.2, Math.min(0.6, (height / width) * 0.8)).toFixed(4));
  const faceLandmarks = extractFaceLandmarks(points, { mouthX, mouthY, mouthScale });
  return {
    mouthX,
    mouthY,
    mouthScale,
    mouthAngle,
    mouthAspect,
    faceLandmarks,
  };
}

/**
 * Derive anatomically proportional full-face landmarks from a portrait config
 * when explicit 478-landmark measurements are not yet stored.
 * @param {{mouthX?:number,mouthY?:number,mouthScale?:number,eyeY?:number,faceLandmarks?:{leftEye:[number,number,number,number],rightEye:[number,number,number,number],jawY:number,faceX:number,faceY:number,faceRx:number,faceRy:number}}} [config]
 * @returns {{leftEye:[number,number,number,number],rightEye:[number,number,number,number],jawY:number,faceX:number,faceY:number,faceRx:number,faceRy:number}}
 */
export function defaultFaceLandmarks(config = {}) {
  if (
    config.faceLandmarks &&
    Array.isArray(config.faceLandmarks.leftEye) &&
    Array.isArray(config.faceLandmarks.rightEye)
  ) {
    return config.faceLandmarks;
  }
  const mx = config.mouthX ?? 0.5;
  const my = config.mouthY ?? 0.68;
  const scale = Math.max(0.5, Math.min(2, config.mouthScale ?? 1));
  const eyeY = Math.max(0.24, Math.min(0.62, config.eyeY ?? my - 0.24 * scale));
  const eyeOffsetX = 0.105 * scale;
  const eyeRx = Math.max(0.032, Math.min(0.11, 0.052 * scale));
  const eyeRy = Math.max(0.014, Math.min(0.06, 0.022 * scale));
  const clamp = (val, min, max, digits = 4) =>
    Number(Math.max(min, Math.min(max, val)).toFixed(digits));
  return {
    leftEye: [
      clamp(mx - eyeOffsetX, 0.12, 0.88),
      clamp(eyeY, 0.15, 0.72),
      clamp(eyeRx, 0.015, 0.16),
      clamp(eyeRy, 0.008, 0.09),
    ],
    rightEye: [
      clamp(mx + eyeOffsetX, 0.12, 0.88),
      clamp(eyeY, 0.15, 0.72),
      clamp(eyeRx, 0.015, 0.16),
      clamp(eyeRy, 0.008, 0.09),
    ],
    jawY: clamp(my + 0.15 * scale, 0.5, 0.94),
    faceX: clamp(mx, 0.2, 0.8),
    faceY: clamp((eyeY + my) * 0.5, 0.22, 0.78),
    faceRx: clamp(0.24 * scale, 0.12, 0.46),
    faceRy: clamp(0.31 * scale, 0.15, 0.48),
  };
}

/**
 * Extract eye, jaw, and face-oval geometry from 478 MediaPipe landmarks,
 * falling back to proportional defaults if non-mouth test points are synthetic.
 * @param {{x:number,y:number}[]} points
 * @param {{mouthX:number,mouthY:number,mouthScale:number}} fallback
 * @returns {{leftEye:[number,number,number,number],rightEye:[number,number,number,number],jawY:number,faceX:number,faceY:number,faceRx:number,faceRy:number}}
 */
function extractFaceLandmarks(points, fallback) {
  const needed = [33, 133, 159, 145, 362, 263, 386, 374, 152, 10, 234, 454];
  const hasAll = needed.every(
    (i) => points[i] && Number.isFinite(points[i].x) && Number.isFinite(points[i].y),
  );
  if (!hasAll) return defaultFaceLandmarks(fallback);
  const leftW = Math.hypot(points[133].x - points[33].x, points[133].y - points[33].y);
  const rightW = Math.hypot(points[263].x - points[362].x, points[263].y - points[362].y);
  const faceH = Math.hypot(points[152].x - points[10].x, points[152].y - points[10].y);
  const faceW = Math.hypot(points[454].x - points[234].x, points[454].y - points[234].y);
  if (leftW < 0.02 || rightW < 0.02 || faceH < 0.1 || faceW < 0.1) {
    return defaultFaceLandmarks(fallback);
  }
  const clamp = (val, min, max, digits = 4) =>
    Number(Math.max(min, Math.min(max, val)).toFixed(digits));
  const leftH = Math.max(
    leftW * 0.34,
    Math.hypot(points[145].x - points[159].x, points[145].y - points[159].y),
  );
  const rightH = Math.max(
    rightW * 0.34,
    Math.hypot(points[374].x - points[386].x, points[374].y - points[386].y),
  );
  return {
    leftEye: [
      clamp((points[33].x + points[133].x) / 2, 0.08, 0.92),
      clamp((points[159].y + points[145].y) / 2, 0.12, 0.78),
      clamp(leftW * 0.62, 0.015, 0.18),
      clamp(leftH * 0.75, 0.008, 0.1),
    ],
    rightEye: [
      clamp((points[362].x + points[263].x) / 2, 0.08, 0.92),
      clamp((points[386].y + points[374].y) / 2, 0.12, 0.78),
      clamp(rightW * 0.62, 0.015, 0.18),
      clamp(rightH * 0.75, 0.008, 0.1),
    ],
    jawY: clamp(points[152].y, 0.48, 0.96),
    faceX: clamp((points[234].x + points[454].x) / 2, 0.18, 0.82),
    faceY: clamp((points[10].y + points[152].y) / 2, 0.18, 0.82),
    faceRx: clamp(faceW * 0.52, 0.1, 0.48),
    faceRy: clamp(faceH * 0.52, 0.12, 0.5),
  };
}

/**
 * Full-face anatomical portrait deformer driven by MediaPipe facial geometry.
 * Animates 2.5D head nod/tilt inside the facial oval, automatic upper-eyelid blinks,
 * eyebrow expression lifts, synchronized lower-jaw/cheek opening, and articulated
 * lip deformation with feathered inner oral-cavity shading while anchoring the
 * outer collar and frame borders smoothly to zero displacement.
 *
 * @param {Uint8ClampedArray} source
 * @param {number} width
 * @param {number} height
 * @param {{mouthX?:number,mouthY?:number,mouthScale?:number,mouthAngle?:number,mouthAspect?:number,eyeY?:number,faceLandmarks?:{leftEye:[number,number,number,number],rightEye:[number,number,number,number],jawY:number,faceX:number,faceY:number,faceRx:number,faceRy:number}}} config
 * @param {{viseme?:string,strength?:number,jawOpen?:number,isBlinking?:boolean,blink?:number,browLift?:number,headBobY?:number,headTilt?:number,headSwayX?:number}|string} animInput
 * @param {number} [fallbackStrength]
 */
export function warpPhotoFace(
  source,
  width,
  height,
  config = {},
  animInput = {},
  fallbackStrength = 1,
) {
  const anim =
    typeof animInput === "string"
      ? {
          viseme: animInput,
          strength: fallbackStrength,
          jawOpen: animInput === "rest" ? 0 : 0.75 * fallbackStrength,
        }
      : animInput || {};
  const viseme = anim.viseme ?? "rest";
  const jawOpen = Math.max(0, Math.min(1, anim.jawOpen ?? (viseme === "rest" ? 0 : 0.7)));
  const rawStrength = anim.strength ?? (viseme === "rest" ? 0 : Math.max(0.35, jawOpen));
  const strength = viseme === "rest" ? 0 : Math.max(0, Math.min(1, rawStrength));
  const blink = Math.max(0, Math.min(1, anim.blink ?? (anim.isBlinking ? 1 : 0)));
  const isBlinking = blink > 0;
  const browLift = Math.max(-4, Math.min(6, anim.browLift ?? 0));
  const headBobY = Math.max(-12, Math.min(12, anim.headBobY ?? 0));
  const headTilt = Math.max(-0.25, Math.min(0.25, anim.headTilt ?? 0));
  const headSwayX = Math.max(-10, Math.min(10, anim.headSwayX ?? 0));

  const output = new Uint8ClampedArray(source);
  const hasMouthMotion = viseme !== "rest" && strength > 0.001;
  const hasJawMotion = jawOpen > 0.015;
  const hasHeadMotion =
    Math.abs(headBobY) > 0.04 || Math.abs(headTilt) > 0.0015 || Math.abs(headSwayX) > 0.04;
  const hasBrowMotion = Math.abs(browLift) > 0.05;
  if (!hasMouthMotion && !hasJawMotion && !isBlinking && !hasBrowMotion && !hasHeadMotion) {
    return output;
  }

  const shapes = {
    open_a: [0.98, -1.65, 2.75],
    open_e: [1.06, -0.95, 1.55],
    open_o: [0.82, -1.35, 2.35],
    open_u: [0.78, -0.75, 1.4],
    consonant: [1.0, 1.35, -1.95],
    smile: [1.09, 0.45, -0.75],
  };
  const shape = shapes[viseme] || [1, 0, 0];

  const landmarks = defaultFaceLandmarks(config);
  const unit = (width / 140) * Math.max(0.5, Math.min(2, config.mouthScale ?? 1));
  const mx = width * (config.mouthX ?? 0.5);
  const my = height * (config.mouthY ?? 0.68);
  const rx = 16.5 * unit;
  const lipHeight = 16 * (config.mouthAspect ?? 0.375) * unit;
  const ry = Math.max(8.5 * unit, lipHeight + 4.5 * unit);
  const angle = config.mouthAngle ?? 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const fxLip = (shape[0] - 1) * strength;

  // Whole-head volume anchored inside portrait bounds so cranium, hair, ears,
  // and glasses move cohesively while collar and outer borders stay fixed.
  const faceX = width * landmarks.faceX;
  const faceY = height * landmarks.faceY;
  const headCy = Math.max(height * 0.24, faceY - height * 0.03);
  const maxRx = Math.max(width * 0.14, Math.min(faceX - 4, width - 4 - faceX));
  const maxRy = Math.max(height * 0.16, Math.min(headCy - 4, height - 5 - headCy));
  const faceRx = Math.min(maxRx, Math.max(width * 0.35, width * landmarks.faceRx * 2.15));
  const faceRy = Math.min(maxRy, Math.max(height * 0.37, height * landmarks.faceRy * 2.05));

  // Jaw & lower-cheek zone between mouth and chin tip (tapering to 0 before collar).
  const jawTopY = my - ry * 0.35;
  const jawBottomY = Math.min(
    height - 4,
    Math.max(my + ry * 1.25, height * Math.min(0.94, landmarks.jawY + 0.03)),
  );
  const jawSpanY = Math.max(1, jawBottomY - jawTopY);
  const jawRx = Math.min(faceRx * 0.92, Math.max(rx * 2.05, width * landmarks.faceRx * 0.82));
  const pivotY = Math.min(height - 6, jawBottomY);

  // Eye & brow regions.
  const eyes = [landmarks.leftEye, landmarks.rightEye].map(([ex, ey, erx, ery]) => ({
    cx: width * ex,
    cy: height * ey,
    rx: Math.max(width * 0.048, width * erx * 1.28),
    ry: Math.max(height * 0.028, height * ery * 2.05),
  }));

  const minY = Math.max(3, Math.floor(headCy - faceRy - 1));
  const maxY = Math.min(height - 5, Math.ceil(Math.max(headCy + faceRy, jawBottomY) + 1));
  const minX = Math.max(3, Math.floor(faceX - faceRx - 1));
  const maxX = Math.min(width - 4, Math.ceil(faceX + faceRx + 1));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let sx = x;
      let sy = y;
      let modified = false;

      // 1. Cohesive 2.5D head tilt (roll), nod (pitch), and turn (yaw) around neck pivot.
      const ndx = (x - faceX) / faceRx;
      const ndy = (y - headCy) / faceRy;
      const rFace = Math.hypot(ndx, ndy);
      if (rFace < 1 && hasHeadMotion) {
        const radialWeight = rFace <= 0.54 ? 1 : (1 - ((rFace - 0.54) / 0.46) ** 2) ** 2;
        const neckTaper =
          y <= pivotY
            ? 1
            : (1 - Math.min(1, (y - pivotY) / Math.max(6, headCy + faceRy - pivotY))) ** 2;
        const wFace = radialWeight * neckTaper;
        if (wFace > 0.001) {
          const bobPx = headBobY * (width / 140) * 0.88 * wFace;
          const swayPx = headSwayX * (width / 140) * 0.85 * wFace;
          const tiltRad = headTilt * 1.05 * wFace;
          const dxF = sx - faceX - swayPx;
          const dyF = sy - pivotY - bobPx;
          const ct = Math.cos(tiltRad);
          const st = Math.sin(tiltRad);
          const pitchScale = 1 - 0.018 * (headBobY / 5) * ((sy - faceY) / faceRy) * wFace;
          const yawScale = 1 + 0.022 * (headSwayX / 4) * (dxF / faceRx) * wFace;
          sx = faceX + (dxF * ct + dyF * st) * pitchScale * yawScale;
          sy = pivotY + (-dxF * st + dyF * ct) / pitchScale;
          modified = true;
        }
      }

      // 2. Eyebrow expression lift & upper-eyelid blink closure.
      if (isBlinking || hasBrowMotion) {
        for (let ei = 0; ei < eyes.length; ei++) {
          const eye = eyes[ei];
          if (hasBrowMotion) {
            const browCy = eye.cy - eye.ry * 1.32;
            const browRx = eye.rx * 1.22;
            const browRy = eye.ry * 1.05;
            const bdx = (sx - eye.cx) / browRx;
            const bdy = (sy - browCy) / browRy;
            const rBrow2 = bdx * bdx + bdy * bdy;
            if (rBrow2 < 1) {
              const wBrow = (1 - rBrow2) ** 2;
              sy += browLift * (width / 140) * 0.55 * wBrow;
              modified = true;
            }
          }
          if (isBlinking) {
            const edx = sx - eye.cx;
            const edy = sy - eye.cy;
            const eu = edx * c + edy * s;
            const ev = -edx * s + edy * c;
            const rEye2 = (eu / eye.rx) ** 2 + (ev / eye.ry) ** 2;
            if (rEye2 < 1) {
              const hFall = Math.max(0, 1 - (eu / eye.rx) ** 2);
              const bEye = eye.ry * Math.sqrt(hFall);
              if (bEye > 0.5) {
                const lidMeet = bEye * 0.48 * hFall;
                const upperCrease = -bEye * 0.18;
                let sev = ev;
                if (ev < lidMeet) {
                  const t = (ev + bEye) / Math.max(0.001, lidMeet + bEye);
                  sev = -bEye + t * (upperCrease + bEye);
                } else {
                  const t = (ev - lidMeet) / Math.max(0.001, bEye - lidMeet);
                  sev = upperCrease + t * (bEye - upperCrease);
                }
                const blended = ev + (sev - ev) * blink;
                sx = eye.cx + eu * c - blended * s;
                sy = eye.cy + eu * s + blended * c;
                modified = true;
              }
            }
          }
        }
      }

      // 3. Synchronized lower-jaw and cheek displacement (tapering to 0 at jawBottomY).
      if ((hasJawMotion || hasMouthMotion) && sy > jawTopY && sy < jawBottomY) {
        const jdx = (sx - mx) / jawRx;
        if (Math.abs(jdx) < 1) {
          const jxFall = (1 - jdx * jdx) ** 2;
          const jyNorm = (sy - jawTopY) / jawSpanY;
          const jyFall = Math.sin(jyNorm * Math.PI) ** 2;
          const wJaw = jxFall * jyFall;
          const openDrop = Math.max(0, shape[2] * 0.45 * strength + jawOpen * 2.4) * unit * wJaw;
          const cheekStretchX = (shape[0] - 1) * 0.32 * strength * (sx - mx) * wJaw;
          sy -= openDrop;
          sx -= cheekStretchX;
          modified = true;
        }
      }

      // 4. Articulated rotated lip warp + inner oral cavity shading.
      let cavityShade = 0;
      let teethHighlight = 0;
      if (hasMouthMotion) {
        const dx = sx - mx;
        const dy = sy - my;
        const u = dx * c + dy * s;
        const v = -dx * s + dy * c;
        const r2 = (u / rx) ** 2 + (v / ry) ** 2;
        if (r2 < 1) {
          const horizontalFalloff = 1 - (u / rx) ** 2;
          const boundary = ry * Math.sqrt(horizontalFalloff);
          const core = Math.min(lipHeight, boundary * 0.55);
          const epsilon = boundary * 0.01;
          const upper = Math.max(
            -boundary + epsilon,
            Math.min(-core * 0.2, -core + shape[1] * unit * strength * horizontalFalloff),
          );
          const lower = Math.min(
            boundary - epsilon,
            Math.max(core * 0.2, core + shape[2] * unit * strength * horizontalFalloff),
          );
          let sv;
          if (v < upper) sv = -boundary + ((v + boundary) / (upper + boundary)) * (boundary - core);
          else if (v < 0) sv = (v / upper) * -core;
          else if (v < lower) sv = (v / lower) * core;
          else sv = core + ((v - lower) / (boundary - lower)) * (boundary - core);
          const su = u / (1 + fxLip * (1 - r2) ** 2);
          sx = mx + su * c - sv * s;
          sy = my + su * s + sv * c;
          modified = true;

          // Feathered inner oral cavity & upper-teeth hint when jaw opens on vowels.
          if (viseme !== "consonant" && jawOpen > 0.22) {
            const innerHalfW = rx * 0.56;
            const innerTop = upper * 0.42;
            const innerBot = lower * 0.54;
            if (
              Math.abs(u) < innerHalfW &&
              v > innerTop &&
              v < innerBot &&
              innerBot > innerTop + 0.5
            ) {
              const ux = 1 - (u / innerHalfW) ** 2;
              const midV = (innerTop + innerBot) * 0.5;
              const radV = (innerBot - innerTop) * 0.5;
              const vy = Math.max(0, 1 - ((v - midV) / radV) ** 2);
              const openWeight = Math.min(1, (jawOpen - 0.22) / 0.55);
              const aperture = ux * vy ** 1.4 * openWeight;
              cavityShade = aperture * 0.72;
              if (jawOpen > 0.32 && v < innerTop + (innerBot - innerTop) * 0.34) {
                const toothBand =
                  1 -
                  Math.abs(
                    (v - (innerTop + (innerBot - innerTop) * 0.17)) /
                      ((innerBot - innerTop) * 0.17),
                  );
                teethHighlight = Math.max(0, toothBand) * ux * openWeight * 0.28;
              }
            }
          }
        }
      }

      if (!modified) continue;

      const px = Math.max(0, Math.min(width - 1.001, sx));
      const py = Math.max(0, Math.min(height - 1.001, sy));
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const ax = px - x0;
      const ay = py - y0;
      const p = (y0 * width + x0) * 4;
      const q = (y * width + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        let val =
          source[p + ch] * (1 - ax) * (1 - ay) +
          source[p + 4 + ch] * ax * (1 - ay) +
          source[p + width * 4 + ch] * (1 - ax) * ay +
          source[p + (width + 1) * 4 + ch] * ax * ay;
        if (ch < 3 && (cavityShade > 0 || teethHighlight > 0)) {
          const depthFactor = ch === 0 ? 0.66 : ch === 1 ? 0.76 : 0.79;
          val *= 1 - cavityShade * depthFactor;
          if (teethHighlight > 0) {
            const toothTarget = ch === 2 ? 222 : 234;
            val = val * (1 - teethHighlight) + toothTarget * teethHighlight;
          }
        }
        output[q + ch] = val;
      }
    }
  }
  return output;
}
