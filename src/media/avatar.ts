import { lstat, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type Canvas,
  createCanvas,
  type Image,
  loadImage,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { hash } from "../digest.js";
import type { SpeakerAvatarConfig } from "../domain.js";
import { projectRoot } from "../paths.js";

export type VisemeShape =
  | "rest"
  | "open_a"
  | "open_e"
  | "open_o"
  | "open_u"
  | "smile"
  | "consonant";

export interface AvatarSpeaker {
  id: string;
  name: string;
  accentColor?: string;
  role?: string;
  avatar?: SpeakerAvatarConfig;
  photoImage?: Image | Canvas;
}

export interface AvatarAnimationState {
  viseme: VisemeShape;
  jawOpen: number;
  isBlinking: boolean;
  headBobY: number;
  headTilt: number;
  browLift: number;
  voiceEnergy: number;
  activeWordIndex: number;
}

export const avatarImagePattern = /^[a-z0-9][a-z0-9_-]{0,47}\.(png|jpg|jpeg|webp)$/u;

export async function resolveAvatarPath(imageId: string, rootDir = projectRoot): Promise<string> {
  if (!avatarImagePattern.test(imageId)) {
    throw new Error(`Invalid avatar image filename: ${imageId}`);
  }
  const avatarDir = resolve(rootDir, "assets/avatars");
  try {
    const dirStat = await lstat(avatarDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error("Avatar directory cannot be a symlink");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const filePath = resolve(avatarDir, imageId);
  const stat = await lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Avatar image must be a regular file");
  }
  return filePath;
}

export async function listCustomAvatars(rootDir = projectRoot): Promise<string[]> {
  const avatarDir = resolve(rootDir, "assets/avatars");
  try {
    const dirStat = await lstat(avatarDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return [];
    const entries = await readdir(avatarDir, { withFileTypes: true });
    return entries
      .filter(
        (entry) => entry.isFile() && !entry.isSymbolicLink() && avatarImagePattern.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function saveCustomAvatar(
  rawName: string,
  imageBuffer: Buffer,
  rootDir = projectRoot,
): Promise<{ imageId: string; path: string; sha256: string }> {
  if (!imageBuffer.length || imageBuffer.length > 4 * 1024 * 1024) {
    throw new Error("Avatar image must be between 1 byte and 4 MB");
  }
  const baseSlug = rawName
    .toLowerCase()
    .replace(/\.(png|jpg|jpeg|webp)$/iu, "")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
  if (!baseSlug || !/^[a-z0-9]/u.test(baseSlug)) {
    throw new Error("Avatar name must start with a letter or digit");
  }
  const imageId = `${baseSlug}.png`;
  if (!avatarImagePattern.test(imageId)) {
    throw new Error("Invalid avatar image identifier");
  }

  const avatarDir = resolve(rootDir, "assets/avatars");
  await mkdir(avatarDir, { recursive: true });
  const dirStat = await lstat(avatarDir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new Error("Avatar directory cannot be a symlink");
  }

  const targetPath = resolve(avatarDir, imageId);
  try {
    const existing = await lstat(targetPath);
    if (existing.isSymbolicLink()) {
      throw new Error("Refusing to overwrite symlink avatar target");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Decode and normalize to a clean 512x512 square PNG
  const decoded = await loadImage(imageBuffer);
  if (decoded.width < 32 || decoded.height < 32) {
    throw new Error("Avatar image must be at least 32x32 pixels");
  }
  const size = 512;
  const normCanvas = createCanvas(size, size);
  const normCtx = normCanvas.getContext("2d");
  const cropSide = Math.min(decoded.width, decoded.height);
  const sx = (decoded.width - cropSide) / 2;
  const sy = (decoded.height - cropSide) / 2;
  normCtx.drawImage(decoded, sx, sy, cropSide, cropSide, 0, 0, size, size);
  const pngBytes = await normCanvas.encode("png");

  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, pngBytes);
  await rename(tmpPath, targetPath);

  return { imageId, path: targetPath, sha256: hash(pngBytes) };
}

const loadedAvatarCache = new Map<string, { sha256: string; image: Image }>();

export async function loadAvatarImage(imageId: string, rootDir = projectRoot): Promise<Image> {
  const filePath = await resolveAvatarPath(imageId, rootDir);
  const bytes = await readFile(filePath);
  const sha = hash(bytes);
  const cached = loadedAvatarCache.get(filePath);
  if (cached && cached.sha256 === sha) return cached.image;
  const image = await loadImage(bytes);
  loadedAvatarCache.set(filePath, { sha256: sha, image });
  return image;
}

/**
 * Maps a spoken word or phoneme representation to a 2D viseme shape.
 */
export function determineViseme(word: string | undefined, isSpeaking: boolean): VisemeShape {
  if (!isSpeaking || !word) return "rest";
  const clean = word.toLowerCase().replace(/[^a-z]/gu, "");
  if (!clean) return "rest";

  // Check vowel digraphs before single vowels
  if (clean.includes("oo") || clean.includes("ou")) return "open_u";
  if (clean.includes("ee") || clean.includes("ea")) return "open_e";
  if (clean.includes("oa")) return "open_o";

  // Determine viseme by the first vowel sound
  const firstVowel = clean.match(/[aeiou]/u)?.[0];
  if (firstVowel === "a") return "open_a";
  if (firstVowel === "e" || firstVowel === "i") return "open_e";
  if (firstVowel === "o") return "open_o";
  if (firstVowel === "u") return "open_u";
  return "smile";
}

function jawOpenForViseme(viseme: VisemeShape): number {
  switch (viseme) {
    case "open_a":
      return 1.0;
    case "open_o":
      return 0.78;
    case "open_e":
      return 0.56;
    case "open_u":
      return 0.45;
    case "consonant":
      return 0.18;
    case "smile":
      return 0.22;
    default:
      return 0;
  }
}

/**
 * Computes frame-accurate syllable viseme, jaw movement, eye blink, brow expression,
 * and voice energy for a cue at a given timestamp in seconds.
 */
export function resolveCueAnimation(
  cue:
    | {
        text: string;
        spokenText?: string;
        startSeconds: number;
        endSeconds: number;
      }
    | undefined,
  timeSeconds: number,
  isSpeaking: boolean,
  speakerId = "narrator",
): AvatarAnimationState {
  // Periodic organic blink (~every 3.4s, phase-offset per speaker)
  const speakerOffset = speakerId === "mira" ? 0.4 : speakerId === "max" ? 1.9 : 1.1;
  const blinkCycle = (timeSeconds + speakerOffset) % 3.4;
  const isBlinking = blinkCycle >= 3.18 && blinkCycle <= 3.36;

  if (!isSpeaking || !cue) {
    return {
      viseme: "rest",
      jawOpen: 0,
      isBlinking,
      headBobY: 0,
      headTilt: 0,
      browLift: 0,
      voiceEnergy: 0,
      activeWordIndex: -1,
    };
  }

  const duration = Math.max(0.08, cue.endSeconds - cue.startSeconds);
  const elapsed = Math.max(0, Math.min(duration, timeSeconds - cue.startSeconds));
  const progress = elapsed / duration;

  const displayWords = cue.text.trim().split(/\s+/u).filter(Boolean);
  const spokenSource = (cue.spokenText ?? cue.text).trim();
  const spokenWords = spokenSource.split(/\s+/u).filter(Boolean);

  // Weight words by character length so multi-syllable words get proportional time
  const weights = spokenWords.map((w) => Math.max(2, w.replace(/[^a-zA-Z0-9]/gu, "").length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || 1;
  const targetWeight = progress * totalWeight;

  let cumulative = 0;
  let spokenIndex = 0;
  let wordLocalProgress = 0;
  for (let i = 0; i < spokenWords.length; i++) {
    const w = weights[i] ?? 2;
    if (cumulative + w >= targetWeight || i === spokenWords.length - 1) {
      spokenIndex = i;
      wordLocalProgress = Math.max(0, Math.min(1, (targetWeight - cumulative) / w));
      break;
    }
    cumulative += w;
  }

  const activeWordIndex =
    displayWords.length > 0
      ? Math.min(
          displayWords.length - 1,
          Math.floor((spokenIndex / Math.max(1, spokenWords.length)) * displayWords.length),
        )
      : -1;

  const currentWord = spokenWords[spokenIndex] ?? cue.text;
  const cleanWord = currentWord.toLowerCase().replace(/[^a-z]/gu, "");

  // Extract vowel groups (syllable nuclei) inside the current word
  const vowelGroups = cleanWord.match(/[aeiouy]+/gu) ?? [];
  const syllableCount = Math.max(1, vowelGroups.length);
  const syllablePosition = wordLocalProgress * syllableCount;
  const syllableIndex = Math.min(syllableCount - 1, Math.floor(syllablePosition));
  const syllablePhase = syllablePosition - syllableIndex;

  // Alternate between vowel peak and consonant closure at syllable boundaries
  const syllableBeat = Math.floor(elapsed * 6.0);
  let viseme: VisemeShape;
  if (
    (syllableCount > 1 && syllablePhase > 0.76) ||
    (wordLocalProgress > 0.84 && spokenIndex < spokenWords.length - 1)
  ) {
    viseme = "consonant";
  } else if (vowelGroups[syllableIndex]) {
    viseme = determineViseme(vowelGroups[syllableIndex], true);
    if (syllableBeat % 4 === 3 && viseme !== "open_a") {
      viseme = "consonant";
    }
  } else {
    viseme = determineViseme(currentWord, true);
  }

  const jawOpen = jawOpenForViseme(viseme);
  const isQuestion = cue.text.includes("?");
  const isExclaim = cue.text.includes("!") || cue.text.includes("≠");
  const browLift = (isQuestion ? 2.8 : isExclaim ? 2.0 : 0.6) + (jawOpen > 0.7 ? 1.4 : 0);

  const headBobY = Math.sin(elapsed * 8.5) * 1.6 * (0.4 + jawOpen * 0.6);
  const headTilt = Math.sin(elapsed * 4.2 + (speakerId === "max" ? 1.2 : 0)) * 0.02;
  const voiceEnergy = Math.min(1, 0.35 + jawOpen * 0.55 + Math.abs(Math.sin(elapsed * 11)) * 0.1);

  return {
    viseme,
    jawOpen,
    isBlinking,
    headBobY,
    headTilt,
    browLift,
    voiceEnergy,
    activeWordIndex,
  };
}

interface CharacterPalette {
  bgTop: string;
  bgBottom: string;
  jacketMain: string;
  jacketShade: string;
  shirtColor: string;
  skinLight: string;
  skinMid: string;
  skinShadow: string;
  hairColor: string;
  hairHighlight: string;
  irisColor: string;
  lipColor: string;
  hasGlasses: boolean;
  glassesStyle: "round-teal" | "thin-gold" | "none";
  hasStubble: boolean;
  hasLapelPin: boolean;
}

function paletteForSpeaker(speakerId: string): CharacterPalette {
  const id = speakerId.toLowerCase();
  if (id === "max") {
    return {
      bgTop: "#1b3d4d",
      bgBottom: "#0a1c26",
      jacketMain: "#204759",
      jacketShade: "#142f3c",
      shirtColor: "#d9ebf2",
      skinLight: "#f2cfb6",
      skinMid: "#e3b89b",
      skinShadow: "#c49476",
      hairColor: "#1d2226",
      hairHighlight: "#353f47",
      irisColor: "#35637a",
      lipColor: "#9c5650",
      hasGlasses: false,
      glassesStyle: "none",
      hasStubble: true,
      hasLapelPin: false,
    };
  }
  if (id === "mira") {
    return {
      bgTop: "#1a443e",
      bgBottom: "#0a1f1d",
      jacketMain: "#215c4a",
      jacketShade: "#143d31",
      shirtColor: "#f0f5ef",
      skinLight: "#f6d8c2",
      skinMid: "#eac3a8",
      skinShadow: "#cca084",
      hairColor: "#22332f",
      hairHighlight: "#39544d",
      irisColor: "#386b58",
      lipColor: "#b05858",
      hasGlasses: true,
      glassesStyle: "round-teal",
      hasStubble: false,
      hasLapelPin: false,
    };
  }
  return {
    bgTop: "#173a4f",
    bgBottom: "#091b26",
    jacketMain: "#0f3850",
    jacketShade: "#082334",
    shirtColor: "#f5f8fa",
    skinLight: "#f0cbb0",
    skinMid: "#e0b495",
    skinShadow: "#be8f70",
    hairColor: "#2b211c",
    hairHighlight: "#4a3931",
    irisColor: "#63462a",
    lipColor: "#9e534d",
    hasGlasses: true,
    glassesStyle: "thin-gold",
    hasStubble: false,
    hasLapelPin: true,
  };
}

/**
 * Keeps the uploaded portrait stationary and confines speech animation to the
 * calibrated mouth. Whole-photo transforms and jaw patches can move clothing.
 */
function drawPhotoAvatarPortrait(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  radius: number,
  image: Image | Canvas,
  config: SpeakerAvatarConfig | undefined,
  anim: AvatarAnimationState,
  isSpeaking: boolean,
  accent: string,
): void {
  const mouthX = Math.max(0.2, Math.min(0.8, config?.mouthX ?? 0.5));
  const mouthY = Math.max(0.4, Math.min(0.9, config?.mouthY ?? 0.68));
  const mouthScale = Math.max(0.5, Math.min(2, config?.mouthScale ?? 1));
  const diameter = radius * 2;
  const cropSide = Math.min(image.width, image.height);
  const sx = (image.width - cropSide) / 2;
  const sy = (image.height - cropSide) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  // Match the editor's square crop and calibration coordinates exactly.
  ctx.drawImage(image, sx, sy, cropSide, cropSide, -radius, -radius, diameter, diameter);

  if (isSpeaking && anim.viseme !== "rest") {
    const mx = (mouthX - 0.5) * diameter;
    const my = (mouthY - 0.5) * diameter;
    const unit = (diameter / 140) * mouthScale;
    ctx.save();
    ctx.translate(mx, my);
    // Photos need a smaller vertical opening than illustrated characters.
    ctx.scale(unit, unit * 0.5);
    // A hard boundary prevents any future mouth drawing from reaching the jaw,
    // neck, or collar. Leave the original photograph untouched outside it.
    ctx.beginPath();
    ctx.ellipse(0, 1, 16, 12, 0, 0, Math.PI * 2);
    ctx.clip();
    drawMouthViseme(ctx, 0, 0, anim.viseme, "rgba(145, 58, 68, 0.75)");
    ctx.restore();
  }

  // Subtle studio vignette rim inside circle
  const rimGrad = ctx.createRadialGradient(0, 0, radius * 0.72, 0, 0, radius);
  rimGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
  rimGrad.addColorStop(1, "rgba(8, 24, 32, 0.42)");
  ctx.fillStyle = rimGrad;
  ctx.fillRect(-radius, -radius, diameter, diameter);

  ctx.restore(); // End portrait clip

  // Outer frame ring & voice energy halo
  ctx.save();
  ctx.strokeStyle = isSpeaking ? accent : "rgba(184, 219, 188, 0.38)";
  ctx.lineWidth = isSpeaking ? 4.5 : 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (isSpeaking) {
    const haloRadius = radius + 4 + anim.voiceEnergy * 4;
    ctx.strokeStyle = "rgba(184, 219, 188, 0.30)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCharacterPortrait(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  radius: number,
  speakerId: string,
  anim: AvatarAnimationState,
  isSpeaking: boolean,
  accent: string,
): void {
  const pal = paletteForSpeaker(speakerId);
  const scale = radius / 112;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  // 1. Studio backdrop radial gradient
  const bgGrad = ctx.createRadialGradient(
    cx - radius * 0.25,
    cy - radius * 0.35,
    radius * 0.1,
    cx,
    cy,
    radius * 1.1,
  );
  bgGrad.addColorStop(0, pal.bgTop);
  bgGrad.addColorStop(1, pal.bgBottom);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  if (isSpeaking) {
    const glow = ctx.createRadialGradient(cx, cy + radius * 0.2, radius * 0.2, cx, cy, radius);
    glow.addColorStop(0, "rgba(184, 219, 188, 0.12)");
    glow.addColorStop(1, "rgba(184, 219, 188, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // 2. Back hair layer (behind neck and shoulders for Mira)
  if (speakerId.toLowerCase() === "mira") {
    ctx.fillStyle = pal.hairColor;
    ctx.beginPath();
    ctx.ellipse(0, -4 + anim.headBobY * 0.6, 52, 54, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Torso / Shoulders / Jacket
  const torsoGrad = ctx.createLinearGradient(0, 48, 0, 120);
  torsoGrad.addColorStop(0, pal.jacketMain);
  torsoGrad.addColorStop(1, pal.jacketShade);
  ctx.fillStyle = torsoGrad;
  ctx.beginPath();
  ctx.ellipse(0, 106, 92, 62, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = pal.shirtColor;
  ctx.beginPath();
  ctx.moveTo(-24, 52);
  ctx.lineTo(0, 86);
  ctx.lineTo(24, 52);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-24, 54);
  ctx.lineTo(-10, 96);
  ctx.moveTo(24, 54);
  ctx.lineTo(10, 96);
  ctx.stroke();

  if (pal.hasLapelPin) {
    ctx.fillStyle = "#f0ab00";
    ctx.beginPath();
    ctx.arc(26, 78, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Neck & cast chin shadow
  ctx.fillStyle = pal.skinMid;
  ctx.beginPath();
  ctx.roundRect(-16, 26, 32, 36, 8);
  ctx.fill();

  ctx.fillStyle = "rgba(38, 20, 14, 0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 38 + anim.jawOpen * 2.5, 17, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(0, anim.headBobY);
  ctx.rotate(anim.headTilt);

  const jawDrop = anim.jawOpen * 3.4;

  // 5. Ears
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = pal.skinMid;
    ctx.beginPath();
    ctx.ellipse(side * 42, -3, 8, 13, side * -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.skinShadow;
    ctx.beginPath();
    ctx.ellipse(side * 42, -3, 4, 7, side * -0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. 3D-shaded Head & Dynamic Jaw Contour
  const faceGrad = ctx.createRadialGradient(-12, -18, 8, 0, 0, 56);
  faceGrad.addColorStop(0, pal.skinLight);
  faceGrad.addColorStop(0.65, pal.skinMid);
  faceGrad.addColorStop(1, pal.skinShadow);
  ctx.fillStyle = faceGrad;

  ctx.beginPath();
  ctx.moveTo(-41, -12);
  ctx.bezierCurveTo(-41, -46, 41, -46, 41, -12);
  ctx.bezierCurveTo(41, 16, 24, 38 + jawDrop, 0, 40 + jawDrop);
  ctx.bezierCurveTo(-24, 38 + jawDrop, -41, 16, -41, -12);
  ctx.closePath();
  ctx.fill();

  if (pal.hasStubble) {
    ctx.fillStyle = "rgba(30, 38, 44, 0.13)";
    ctx.beginPath();
    ctx.moveTo(-36, 4);
    ctx.bezierCurveTo(-34, 24, -18, 37 + jawDrop, 0, 39 + jawDrop);
    ctx.bezierCurveTo(18, 37 + jawDrop, 34, 24, 36, 4);
    ctx.bezierCurveTo(28, 18, 16, 26 + jawDrop * 0.7, 0, 27 + jawDrop * 0.7);
    ctx.bezierCurveTo(-16, 26 + jawDrop * 0.7, -28, 18, -36, 4);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "rgba(218, 112, 98, 0.14)";
  ctx.beginPath();
  ctx.ellipse(-23, 5, 9, 5.5, 0, 0, Math.PI * 2);
  ctx.ellipse(23, 5, 9, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 7. Nose bridge & soft nose tip
  ctx.strokeStyle = pal.skinShadow;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-1, -10);
  ctx.lineTo(-3, 2);
  ctx.quadraticCurveTo(0, 5, 4, 2);
  ctx.stroke();

  // 8. Eyes
  const eyeY = -8;
  const eyeX = 17;
  if (anim.isBlinking) {
    ctx.strokeStyle = "#1c2826";
    ctx.lineWidth = 2.6;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(side * (eyeX - 8), eyeY);
      ctx.quadraticCurveTo(side * eyeX, eyeY + 4, side * (eyeX + 8), eyeY);
      ctx.stroke();
    }
  } else {
    for (const side of [-1, 1] as const) {
      const ex = side * eyeX;
      ctx.fillStyle = "#f9fbfa";
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, 8.2, 5.8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = pal.irisColor;
      ctx.beginPath();
      ctx.arc(ex, eyeY, 4.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#10181a";
      ctx.beginPath();
      ctx.arc(ex, eyeY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex - 1.6, eyeY - 1.8, 1.4, 0, Math.PI * 2);
      ctx.arc(ex + 1.4, eyeY + 1.4, 0.7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#1c2826";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(ex, eyeY + 1.5, 8.5, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
  }

  // 9. Expressive Eyebrows
  const browY = -21 - anim.browLift;
  ctx.strokeStyle = pal.hairColor;
  ctx.lineWidth = 2.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-26, browY + 1.5);
  ctx.quadraticCurveTo(-17, browY - 2.5, -8, browY + 0.5);
  ctx.moveTo(8, browY + 0.5);
  ctx.quadraticCurveTo(17, browY - 2.5, 26, browY + 1.5);
  ctx.stroke();

  // 10. Glasses
  if (pal.hasGlasses) {
    ctx.save();
    ctx.strokeStyle = pal.glassesStyle === "thin-gold" ? "#c89d54" : "#3a5e55";
    ctx.lineWidth = pal.glassesStyle === "thin-gold" ? 2.0 : 2.6;
    ctx.beginPath();
    ctx.roundRect(-29, -16, 22, 16, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(7, -16, 22, 16, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, -9);
    ctx.quadraticCurveTo(0, -11, 7, -9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-29, -10);
    ctx.lineTo(-40, -7);
    ctx.moveTo(29, -10);
    ctx.lineTo(40, -7);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-25, -13);
    ctx.lineTo(-20, -4);
    ctx.moveTo(11, -13);
    ctx.lineTo(16, -4);
    ctx.stroke();
    ctx.restore();
  }

  // 11. Hair Crown & Side Locks
  ctx.fillStyle = pal.hairColor;
  const id = speakerId.toLowerCase();
  if (id === "max") {
    ctx.beginPath();
    ctx.moveTo(-41, -10);
    ctx.bezierCurveTo(-44, -42, -24, -56, 2, -55);
    ctx.bezierCurveTo(28, -55, 44, -40, 41, -10);
    ctx.lineTo(38, -8);
    ctx.lineTo(36, -24);
    ctx.bezierCurveTo(20, -33, -18, -33, -36, -24);
    ctx.lineTo(-38, -8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = pal.hairHighlight;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, -34, 24, Math.PI * 1.2, Math.PI * 1.75);
    ctx.stroke();
  } else if (id === "mira") {
    ctx.beginPath();
    ctx.moveTo(-42, 4);
    ctx.bezierCurveTo(-47, -34, -30, -56, 0, -56);
    ctx.bezierCurveTo(30, -56, 47, -34, 42, 4);
    ctx.lineTo(38, 2);
    ctx.bezierCurveTo(38, -18, 28, -30, 10, -32);
    ctx.bezierCurveTo(-6, -34, -28, -30, -37, -18);
    ctx.lineTo(-38, 2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = pal.hairHighlight;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(-4, -35, 26, Math.PI * 1.15, Math.PI * 1.7);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-41, -6);
    ctx.bezierCurveTo(-45, -38, -26, -55, 0, -55);
    ctx.bezierCurveTo(28, -55, 45, -38, 41, -6);
    ctx.lineTo(37, -6);
    ctx.bezierCurveTo(36, -24, 18, -32, -8, -32);
    ctx.bezierCurveTo(-24, -31, -35, -24, -37, -6);
    ctx.closePath();
    ctx.fill();
  }

  // 12. Anatomical Mouth & Viseme Articulation
  const mouthY = 18 + jawDrop * 0.55;
  drawMouthViseme(ctx, 0, mouthY, anim.viseme, pal.lipColor);

  ctx.restore();
  ctx.restore();

  // Outer frame ring & voice energy equalizer
  ctx.save();
  ctx.strokeStyle = isSpeaking ? accent : "rgba(184, 219, 188, 0.38)";
  ctx.lineWidth = isSpeaking ? 4.5 : 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (isSpeaking) {
    const haloRadius = radius + 4 + anim.voiceEnergy * 4;
    ctx.strokeStyle = "rgba(184, 219, 188, 0.30)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMouthViseme(
  ctx: SKRSContext2D,
  mx: number,
  my: number,
  viseme: VisemeShape,
  lipColor: string,
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (viseme) {
    case "open_a": {
      ctx.beginPath();
      ctx.ellipse(mx, my + 2, 12.5, 9.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#3b1519";
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#f7faf7";
      ctx.fillRect(mx - 11, my - 8, 22, 5.5);
      ctx.fillStyle = "#d96b6b";
      ctx.beginPath();
      ctx.ellipse(mx, my + 9, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = lipColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(mx, my + 2, 12.5, 9.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "open_e": {
      ctx.beginPath();
      ctx.ellipse(mx, my + 1, 13.5, 6.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#3b1519";
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#f7faf7";
      ctx.fillRect(mx - 12, my - 5, 24, 4.5);
      ctx.fillStyle = "#d96b6b";
      ctx.beginPath();
      ctx.ellipse(mx, my + 6, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = lipColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(mx, my + 1, 13.5, 6.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "open_o": {
      ctx.beginPath();
      ctx.ellipse(mx, my + 2, 8.5, 8.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#3b1519";
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#f7faf7";
      ctx.fillRect(mx - 7, my - 6.5, 14, 3.5);
      ctx.fillStyle = "#d96b6b";
      ctx.beginPath();
      ctx.ellipse(mx, my + 7.5, 6, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = lipColor;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(mx, my + 2, 8.5, 8.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "open_u": {
      ctx.beginPath();
      ctx.ellipse(mx, my + 1.5, 6.0, 6.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#3b1519";
      ctx.fill();
      ctx.strokeStyle = lipColor;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      break;
    }

    case "consonant": {
      ctx.beginPath();
      ctx.ellipse(mx, my + 0.5, 10.5, 3.0, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#4a1c20";
      ctx.fill();
      ctx.strokeStyle = lipColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }

    case "smile": {
      ctx.strokeStyle = lipColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mx - 11, my - 1);
      ctx.quadraticCurveTo(mx, my + 6.5, mx + 11, my - 1);
      ctx.stroke();
      break;
    }

    default: {
      ctx.strokeStyle = lipColor;
      ctx.lineWidth = 2.3;
      ctx.beginPath();
      ctx.moveTo(mx - 9.5, my);
      ctx.quadraticCurveTo(mx, my + 2.8, mx + 9.5, my);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

function drawSpeakerPortraitByMode(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  radius: number,
  speaker: AvatarSpeaker,
  anim: AvatarAnimationState,
  isSpeaking: boolean,
  accent: string,
): void {
  if (speaker.avatar?.mode === "photo" && speaker.photoImage) {
    drawPhotoAvatarPortrait(
      ctx,
      cx,
      cy,
      radius,
      speaker.photoImage,
      speaker.avatar,
      anim,
      isSpeaking,
      accent,
    );
  } else {
    drawCharacterPortrait(ctx, cx, cy, radius, speaker.id, anim, isSpeaking, accent);
  }
}

/**
 * Draws a stylized developer avatar badge (either 3D-shaded illustrated rig or
 * 2.5D animated photo portrait) into the video frame canvas.
 */
export function drawAvatarBadge(
  ctx: SKRSContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  speaker: AvatarSpeaker,
  viseme: VisemeShape,
  isSpeaking: boolean,
  options?: {
    animation?: AvatarAnimationState;
    coSpeaker?: AvatarSpeaker;
  },
): void {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2 - 10;
  const radius = Math.min(bounds.width, bounds.height) / 2 - 8;
  const accent = speaker.accentColor ?? "#b8dbbc";

  const anim: AvatarAnimationState = options?.animation ?? {
    viseme,
    jawOpen: jawOpenForViseme(viseme),
    isBlinking: false,
    headBobY: 0,
    headTilt: 0,
    browLift: 0,
    voiceEnergy: isSpeaking ? 0.6 : 0,
    activeWordIndex: -1,
  };

  drawSpeakerPortraitByMode(ctx, cx, cy, radius, speaker, anim, isSpeaking, accent);

  if (options?.coSpeaker && options.coSpeaker.id !== speaker.id) {
    const pipRadius = 30;
    const pipCx = bounds.x + bounds.width - pipRadius - 4;
    const pipCy = bounds.y + pipRadius + 4;
    const idleAnim: AvatarAnimationState = {
      viseme: "smile",
      jawOpen: 0,
      isBlinking: false,
      headBobY: 0,
      headTilt: 0,
      browLift: 0,
      voiceEnergy: 0,
      activeWordIndex: -1,
    };
    ctx.save();
    ctx.fillStyle = "#0b202a";
    ctx.beginPath();
    ctx.arc(pipCx, pipCy, pipRadius + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawSpeakerPortraitByMode(
      ctx,
      pipCx,
      pipCy,
      pipRadius,
      options.coSpeaker,
      idleAnim,
      false,
      accent,
    );
  }

  const pillY = bounds.y + bounds.height - 24;
  const pillWidth = bounds.width - 24;
  const pillHeight = 26;
  const pillX = bounds.x + 12;

  ctx.save();
  ctx.fillStyle = isSpeaking ? accent : "#1b3e44";
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 13);
  ctx.fill();

  ctx.font = '14px "Shorts Heading", sans-serif';
  ctx.fillStyle = isSpeaking ? "#15352c" : "#a2c5b9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(speaker.name.toUpperCase(), cx, pillY + pillHeight / 2);

  if (isSpeaking) {
    const barBaseX = pillX + 18;
    const barCenterY = pillY + pillHeight / 2;
    ctx.fillStyle = "#15352c";
    for (let i = 0; i < 3; i++) {
      const h = 4 + (i === 1 ? anim.voiceEnergy : anim.voiceEnergy * 0.65) * 9;
      ctx.beginPath();
      ctx.roundRect(barBaseX + i * 4.5, barCenterY - h / 2, 2.5, h, 1);
      ctx.fill();
    }
  }

  ctx.restore();
}
