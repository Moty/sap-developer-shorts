/** Continuous, reproducible motion for the lightweight portrait preview.
 * Learned rendering uses audio-generated poses; these settings share its style contract.
 */
export const portraitMotionVersion = "conversational-1";

/** @typedef {{style?:'calm'|'conversational'|'expressive',intensity?:number,seed?:number}} MotionSettings */
/** @typedef {{startSeconds:number,endSeconds:number,text:string,speakerId?:string}} MotionCue */

/** @param {number} value */
function ease(value) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** @param {number} seed */
function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** @param {MotionCue[]} cues @param {number} duration @param {string} speakerId @param {MotionSettings} [settings] */
export function createMotionTrack(cues, duration, speakerId = "narrator", settings = {}) {
  const style = settings.style ?? "conversational";
  const intensity = settings.intensity ?? 0.7;
  const seed = settings.seed ?? 42;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 600 ||
    !["calm", "conversational", "expressive"].includes(style) ||
    !Number.isFinite(intensity) ||
    intensity < 0 ||
    intensity > 1 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 4294967295
  )
    throw new Error("Invalid portrait motion settings");
  let identity = seed;
  for (const char of speakerId) identity = Math.imul(identity ^ char.charCodeAt(0), 16777619);
  const random = randomSource(identity);
  const scale = { calm: 0.45, conversational: 0.7, expressive: 1 }[style] * intensity;
  /** @type {MotionCue[]} */
  const phrases = [];
  for (const cue of cues) {
    if (cue.speakerId && cue.speakerId !== speakerId) continue;
    const previous = phrases.at(-1);
    if (
      previous &&
      cue.startSeconds - previous.endSeconds < 0.35 &&
      !/[.!?]["']?\s*$/.test(previous.text)
    ) {
      previous.text += ` ${cue.text}`;
      previous.endSeconds = cue.endSeconds;
    } else phrases.push({ ...cue });
  }
  const gestures = [];
  let available = 0;
  for (const phrase of phrases) {
    const length = phrase.endSeconds - phrase.startSeconds;
    if (length < 0.35 || phrase.startSeconds < available) continue;
    const question = phrase.text.includes("?");
    if (!question && random() > (style === "calm" ? 0.38 : 0.65)) continue;
    const start = Math.max(0, phrase.startSeconds + Math.min(0.25, length * 0.1));
    const span = Math.min(length + 0.3, question ? 1.8 : 1.35);
    gestures.push({
      start,
      span,
      kind: question ? "tilt" : "nod",
      direction: random() < 0.5 ? -1 : 1,
    });
    available = start + span + 1.6 + random() * 1.5;
  }
  const postures = [{ time: 0, tilt: 0, sway: 0 }];
  for (let time = 3.5 + random() * 2; time < duration + 8; time += 4 + random() * 4)
    postures.push({ time, tilt: (random() - 0.5) * 0.024, sway: (random() - 0.5) * 0.7 });
  const blinks = [];
  for (let time = 1.6 + random() * 2; time < duration; time += 2.7 + random() * 3.6)
    blinks.push(time);
  return { version: portraitMotionVersion, duration, scale, gestures, postures, blinks };
}

/** @param {ReturnType<typeof createMotionTrack>} track @param {number} time */
export function sampleMotionTrack(track, time) {
  let headBobY = 0,
    headTilt = 0,
    headSwayX = 0,
    browLift = 0;
  const t = Math.max(0, Math.min(track.duration, time));
  const next = track.postures.findIndex((pose) => pose.time > t);
  const left = track.postures[Math.max(0, next < 0 ? track.postures.length - 1 : next - 1)];
  const right = track.postures[next] ?? left;
  const fraction = ease((t - left.time) / Math.max(0.001, right.time - left.time));
  headTilt = left.tilt + (right.tilt - left.tilt) * fraction;
  headSwayX = left.sway + (right.sway - left.sway) * fraction;
  for (const gesture of track.gestures) {
    const p = (t - gesture.start) / gesture.span;
    if (p < 0 || p > 1) continue;
    const value = p < 0.38 ? ease(p / 0.38) : 1 - ease((p - 0.38) / 0.62);
    if (gesture.kind === "tilt") headTilt += value * 0.025 * gesture.direction;
    else headBobY += value * 0.9;
    browLift += value * (gesture.kind === "tilt" ? 0.9 : 0.3);
  }
  let blink = 0;
  for (const start of track.blinks) {
    const elapsed = t - start;
    if (elapsed >= 0 && elapsed < 0.25)
      blink = elapsed < 0.07 ? ease(elapsed / 0.07) : 1 - ease((elapsed - 0.07) / 0.18);
  }
  const settle = 1 - ease((t - Math.max(0, track.duration - 0.8)) / 0.8);
  const strength = track.scale * settle;
  return {
    headBobY: headBobY * strength,
    headTilt: headTilt * strength,
    headSwayX: headSwayX * strength,
    browLift: browLift * strength,
    blink,
    isBlinking: blink > 0.5,
  };
}
