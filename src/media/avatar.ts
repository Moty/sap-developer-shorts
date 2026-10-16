import type { SKRSContext2D } from "@napi-rs/canvas";

export type VisemeShape = "rest" | "open_a" | "open_e" | "open_o" | "open_u" | "smile";

export interface AvatarSpeaker {
  id: string;
  name: string;
  accentColor?: string;
  role?: string;
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

/**
 * Draws a stylized, vector developer avatar badge into the video frame canvas.
 * Renders into bounds (typically 240x240 in layout.presenter).
 */
export function drawAvatarBadge(
  ctx: SKRSContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  speaker: AvatarSpeaker,
  viseme: VisemeShape,
  isSpeaking: boolean,
): void {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2 - 10;
  const radius = Math.min(bounds.width, bounds.height) / 2 - 8;
  const accent = speaker.accentColor ?? "#b8dbbc";

  ctx.save();

  // Circular clip for avatar portrait
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  // Background portrait gradient
  const bgGrad = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  bgGrad.addColorStop(0, "#193c47");
  bgGrad.addColorStop(1, "#0d232c");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Subtle background ring
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Shoulders & torso
  ctx.fillStyle = speaker.id === "max" ? "#1e434f" : "#245242";
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius + 15, radius * 0.95, radius * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Collar / neckline
  ctx.fillStyle = "#f0f4ea";
  ctx.beginPath();
  ctx.moveTo(cx - 24, cy + radius - 20);
  ctx.lineTo(cx, cy + radius - 2);
  ctx.lineTo(cx + 24, cy + radius - 20);
  ctx.closePath();
  ctx.fill();

  // Neck
  ctx.fillStyle = "#e0be9f";
  ctx.fillRect(cx - 18, cy + 18, 36, 32);

  // Head
  ctx.fillStyle = "#eccab0";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 2, 42, 50, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair style based on speaker identity
  ctx.fillStyle = speaker.id === "max" ? "#231f20" : "#2c3d38";
  if (speaker.id === "max") {
    // Short styled crop
    ctx.beginPath();
    ctx.ellipse(cx, cy - 36, 46, 26, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Mira: side-swept hair with bangs
    ctx.beginPath();
    ctx.ellipse(cx - 6, cy - 34, 48, 28, -0.15, 0, Math.PI * 2);
    ctx.fill();
    // Side fringe
    ctx.beginPath();
    ctx.ellipse(cx + 34, cy - 10, 16, 32, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Glasses for technical character (Mira)
  if (speaker.id === "mira" || speaker.id === "narrator") {
    ctx.strokeStyle = "#5f7e73";
    ctx.lineWidth = 2.5;
    // Left rim
    ctx.beginPath();
    ctx.rect(cx - 30, cy - 15, 22, 16);
    ctx.stroke();
    // Right rim
    ctx.beginPath();
    ctx.rect(cx + 8, cy - 15, 22, 16);
    ctx.stroke();
    // Bridge
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 8);
    ctx.lineTo(cx + 8, cy - 8);
    ctx.stroke();
  }

  // Eyes
  ctx.fillStyle = "#162828";
  ctx.beginPath();
  ctx.arc(cx - 19, cy - 8, 3.5, 0, Math.PI * 2);
  ctx.arc(cx + 19, cy - 8, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Eye highlights
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx - 20, cy - 9.5, 1.2, 0, Math.PI * 2);
  ctx.arc(cx + 18, cy - 9.5, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrows
  ctx.strokeStyle = "#2c3d38";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(cx - 30, cy - 20);
  ctx.quadraticCurveTo(cx - 19, cy - 23, cx - 9, cy - 20);
  ctx.moveTo(cx + 9, cy - 20);
  ctx.quadraticCurveTo(cx + 19, cy - 23, cx + 30, cy - 20);
  ctx.stroke();

  // Mouth rendering based on viseme
  const mouthY = cy + 24;
  ctx.fillStyle = "#7b3535";
  ctx.strokeStyle = "#7b3535";
  ctx.lineWidth = 2;

  switch (viseme) {
    case "open_a":
      // Wide open vertical mouth
      ctx.beginPath();
      ctx.ellipse(cx, mouthY + 2, 14, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      // Teeth bar
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cx - 9, mouthY - 3, 18, 4);
      break;

    case "open_e":
      // Stretched wide horizontal smile
      ctx.beginPath();
      ctx.ellipse(cx, mouthY + 1, 16, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cx - 11, mouthY - 2, 22, 3);
      break;

    case "open_o":
      // Rounded circular mouth
      ctx.beginPath();
      ctx.arc(cx, mouthY + 2, 9, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "open_u":
      // Small puckered circle
      ctx.beginPath();
      ctx.arc(cx, mouthY + 2, 5.5, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "smile":
      // Friendly open curve
      ctx.beginPath();
      ctx.arc(cx, mouthY - 2, 12, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;

    default:
      // Neutral resting line
      ctx.beginPath();
      ctx.moveTo(cx - 10, mouthY);
      ctx.lineTo(cx + 10, mouthY);
      ctx.stroke();
      break;
  }

  ctx.restore();

  // Outer border ring with speaker accent
  ctx.save();
  ctx.strokeStyle = isSpeaking ? accent : "rgba(184, 219, 188, 0.45)";
  ctx.lineWidth = isSpeaking ? 4.5 : 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Active speaker pulse ring
  if (isSpeaking) {
    ctx.strokeStyle = "rgba(184, 219, 188, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Name pill below the circle
  const pillY = bounds.y + bounds.height - 24;
  const pillWidth = bounds.width - 24;
  const pillHeight = 26;
  const pillX = bounds.x + 12;

  ctx.fillStyle = isSpeaking ? accent : "#1b3e44";
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 13);
  ctx.fill();

  ctx.font = '14px "Shorts Heading", sans-serif';
  ctx.fillStyle = isSpeaking ? "#15352c" : "#a2c5b9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(speaker.name.toUpperCase(), cx, pillY + pillHeight / 2);

  ctx.restore();
}
