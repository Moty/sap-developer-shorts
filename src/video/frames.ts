import { readFile } from "node:fs/promises";
import {
  createCanvas,
  GlobalFonts,
  type Image,
  loadImage,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { hash } from "../digest.js";
import { type ContentEpisode, type DemoEvidence, isNewsEpisode } from "../domain.js";
import { readLayout, type VideoLayout } from "../layout.js";
import { drawAvatarBadge, loadAvatarImage, resolveCueAnimation } from "../media/avatar.js";
import type { NarrationTiming } from "../media/model.js";
import { availabilityLabels } from "../news/contracts.js";
import { sourceFile } from "../paths.js";
import type { SceneComposition } from "../presentation-design.js";
import { type ResolvedVisualAsset, resolveVisualAssets } from "../visual-assets.js";
import { cueIdentifiers, feedSceneDesign } from "./feed-design.js";
import { sceneMotion, storySteps } from "./motion.js";
import { type VideoMoment, videoFps, videoTimeline } from "./timeline.js";
import {
  chartPlan,
  figureGeometry,
  imagePlacement,
  sequenceGeometry,
  visualLabelLines,
  visualPrimitives,
} from "./visual-plan.js";

export const videoFontFiles = [
  "assets/fonts/DejaVuSans.ttf",
  "assets/fonts/DejaVuSans-Bold.ttf",
  "assets/fonts/DejaVuSansMono.ttf",
  "assets/fonts/LICENSE_DEJAVU",
  "assets/fonts/provenance.json",
];
let fonts: Promise<void> | undefined;
export function loadVideoFonts() {
  fonts ??= (async () => {
    const provenance = JSON.parse(
      await readFile(await sourceFile("assets/fonts/provenance.json"), "utf8"),
    );
    for (const [filename, alias] of [
      ["DejaVuSans.ttf", "Shorts Body"],
      ["DejaVuSans-Bold.ttf", "Shorts Heading"],
      ["DejaVuSansMono.ttf", "Shorts Code"],
    ]) {
      const name = filename as string;
      const path = await sourceFile(`assets/fonts/${name}`);
      if (hash(await readFile(path)) !== provenance.files[name]?.sha256)
        throw new Error("Bundled video font changed");
      if (!GlobalFonts.registerFromPath(path, alias))
        throw new Error(`Cannot load video font ${name}`);
    }
  })();
  return fonts;
}

export function wrapVideoText(
  context: SKRSContext2D,
  text: string,
  width: number,
  code = false,
): string[] {
  if (code) return wrapVideoCode(context, text, width);
  const lines: string[] = [];
  for (const paragraph of text.replaceAll("\r", "").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    const tokens = paragraph.split(/(\s+)/u);
    for (const token of tokens) {
      if (context.measureText(line + token).width <= width) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = token.trimStart();
      if (context.measureText(line).width > width) {
        const word = line;
        line = "";
        for (const character of word) {
          if (context.measureText(line + character).width > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function wrapVideoCode(context: SKRSContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replaceAll("\r", "").split("\n")) {
    let line = "";
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      if (context.measureText(line + token).width <= width) {
        line += token;
        continue;
      }
      if (line.length) {
        lines.push(line);
        line = "";
      }
      if (context.measureText(token).width <= width) {
        line = token;
        continue;
      }
      // Only oversized tokens (for example URLs) need character wrapping.
      // Keep every character, including indentation and trailing whitespace.
      for (const character of token) {
        if (context.measureText(character).width > width)
          throw new Error("Video code character does not fit its readable text bounds");
        if (context.measureText(line + character).width > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

function text(
  context: SKRSContext2D,
  value: string,
  box: { x: number; y: number; width: number; height: number },
  size: number,
  color: string,
  family = "Shorts Body",
  label = "text",
  spokenFocus?: string,
) {
  context.font = `${size}px "${family}"`;
  context.fillStyle = color;
  context.textBaseline = "top";
  const lines = wrapVideoText(context, value, box.width, family === "Shorts Code");
  const lineHeight = size * 1.22;
  if (lines.length * lineHeight > box.height + 1)
    throw new Error(`Video ${label} does not fit its readable text bounds (${lines.length} lines)`);
  lines.forEach((line, index) => {
    if (family === "Shorts Code" && spokenFocus) {
      for (const { start, end } of codeHighlights(line, spokenFocus)) {
        const left = box.x + context.measureText(line.slice(0, start)).width;
        const width = context.measureText(line.slice(start, end)).width;
        context.fillStyle = "#235477";
        context.fillRect(left - 2, box.y + index * lineHeight - 2, width + 4, lineHeight);
      }
      context.fillStyle = color;
    }
    context.fillText(line, box.x, box.y + index * lineHeight);
  });
  return lines.length * lineHeight;
}

/** Fit prose without clipping, truncating, or changing the spoken script. */
export function fitVideoProse(
  context: SKRSContext2D,
  value: string,
  box: { width: number; height: number },
  preferredSize: number,
  minimumSize = 48,
  label = "text",
) {
  for (let size = preferredSize; ; size = Math.max(minimumSize, size - 2)) {
    context.font = `${size}px "Shorts Heading"`;
    const lines = wrapVideoText(context, value, box.width);
    if (lines.length * size * 1.22 <= box.height + 1) return size;
    if (size <= minimumSize)
      throw new Error(
        `Video ${label} does not fit its readable text bounds at ${minimumSize}px. Use a shorter visual cue.`,
      );
  }
}

// Match complete identifiers mentioned by the current caption; never rewrite,
// reveal, or move source code to create visual emphasis.
export function codeHighlights(line: string, narration: string) {
  const ignored = new Set(["the", "and", "with", "from", "this", "that", "for", "you", "your"]);
  const terms = new Set(
    (narration.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? [])
      .map((term) => term.toLowerCase())
      .filter((term) => (term.length >= 3 || term === "id") && !ignored.has(term)),
  );
  return [...line.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/gu)]
    .filter((match) => terms.has(match[0].toLowerCase()))
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

function panel(
  context: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  radius = 24,
) {
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

/** Stack measured news text with real gutters, including the entire status pill. */
export function newsCardLayout(
  ctx: SKRSContext2D,
  claim: import("../domain.js").NewsEpisode["claims"][number],
  box: { x: number; y: number; width: number; height: number },
) {
  const measure = (value: string, size: number, family: string) => {
    ctx.font = `${size}px "${family}"`;
    return wrapVideoText(ctx, value, box.width).length * size * 1.22;
  };
  const badge = { ...box, height: 84 };
  const timingHeight = measure(claim.availability.timing, 32, "Shorts Body");
  const scopeHeight = measure(claim.availability.scope, 30, "Shorts Body");
  const claimTop = box.y + badge.height + 28;
  const claimBudget = box.y + box.height - claimTop - 28 - timingHeight - 20 - scopeHeight;
  const size = fitVideoProse(
    ctx,
    claim.text,
    { width: box.width, height: claimBudget },
    52,
    40,
    "news claim",
  );
  const headline = { ...box, y: claimTop, height: measure(claim.text, size, "Shorts Heading") };
  const timing = { ...box, y: headline.y + headline.height + 28, height: timingHeight };
  const scope = { ...box, y: timing.y + timing.height + 20, height: scopeHeight };
  return { badge, headline, timing, scope, size };
}

function headlineTypography(
  ctx: SKRSContext2D,
  design: ReturnType<typeof feedSceneDesign>,
  layout: VideoLayout,
) {
  const hero = design.kind === "hook" || design.kind === "closing";
  const box = hero
    ? { ...layout.headline, height: 360 }
    : design.custom
      ? { ...layout.headline, height: Math.min(200, layout.demo.y - layout.headline.y - 20) }
      : layout.headline;
  let size = hero
    ? design.emphasis === "headline"
      ? 140
      : design.emphasis === "evidence"
        ? 96
        : 128
    : design.emphasis === "headline"
      ? 96
      : design.emphasis === "evidence"
        ? 68
        : Math.max(80, layout.headline.fontSize);
  const minimum = design.custom ? 48 : 56;
  for (;;) {
    ctx.font = `${size}px "Shorts Heading"`;
    if (wrapVideoText(ctx, design.headline, box.width).length * size * 1.22 <= box.height)
      return { box, size };
    if (size <= minimum)
      throw new Error(
        "Presentation headline is too wide for readable video text. Use a shorter visual headline.",
      );
    size = Math.max(minimum, size - 2);
  }
}

/** Check every model-authored headline using the exact export fonts and bounds. */
export async function assertPresentationDesignFits(episode: ContentEpisode) {
  if (!episode.presentation?.design) return;
  await loadVideoFonts();
  const { layout } = await readLayout();
  const ctx = createCanvas(1080, 1920).getContext("2d");
  episode.scenes.forEach((_, index) => {
    const design = feedSceneDesign(episode, index);
    headlineTypography(ctx, design, layout);
    if (design.composition)
      for (const card of compositionCards(design.composition, {
        x: layout.demo.x + 32,
        y: layout.demo.y + 118,
        width: layout.demo.width - 64,
        height: layout.demo.height - 150,
      }))
        fitVideoProse(
          ctx,
          card.renderLabel,
          card.textBox,
          card.preferredSize,
          36,
          "composition label",
        );
  });
  ctx.font = '34px "Shorts Heading"';
  for (const step of storySteps(episode))
    if (wrapVideoText(ctx, step.label, 680).length * 34 * 1.22 > 128)
      throw new Error("Presentation step headline is too wide. Use a shorter visual headline.");
  ctx.font = '30px "Shorts Heading"';
  for (const [index, step] of storySteps(episode).entries())
    if (
      wrapVideoText(ctx, `${index + 1}. ${step.label}`, layout.demo.width - 104).length *
        30 *
        1.22 >
      80
    )
      throw new Error("Presentation story headline is too wide. Use a shorter visual headline.");
}

function compositionCards(
  composition: SceneComposition,
  body: { x: number; y: number; width: number; height: number },
) {
  const sequence = ["flow", "timeline"].includes(composition.kind)
    ? sequenceGeometry(composition.kind, composition.items.length, body)
    : null;
  return composition.items.map((item, index) => {
    const comparison = composition.kind === "comparison";
    const callout = composition.kind === "callout";
    const node = sequence?.[index];
    const width = node?.width ?? (comparison ? (body.width - 28) / 2 : body.width);
    const x = node?.x ?? body.x + (comparison ? index * (width + 28) : 0);
    const height = node?.height ?? (callout ? 420 : comparison ? 370 : 174);
    const y = node?.y ?? body.y + (callout ? 100 : comparison ? 140 : index * 220);
    return {
      ...item,
      x,
      y,
      width,
      height,
      preferredSize: node ? Math.round((44 * body.width) / 900) : callout ? 58 : 44,
      renderLabel: node ? visualLabelLines(item.label).join("\n") : item.label,
      textBox: {
        x: x + 28,
        y: y + (comparison ? 90 : node ? 44 : 50),
        width: width - 56,
        height: height - (comparison ? 125 : node ? 55 : 85),
      },
    };
  });
}

import { createMotionTrack, sampleMotionTrack } from "../media/portrait-motion.js";
import type { TalkingHeadSequence } from "../media/talking-head.js";

export interface VideoFrameInput {
  episode: ContentEpisode;
  timing: NarrationTiming;
  layout: VideoLayout;
  code: Record<string, string>;
  evidence?: DemoEvidence;
  talkingHeadSequences?: Record<string, TalkingHeadSequence>;
  visualAssets?: Record<string, ResolvedVisualAsset>;
}

/** Render distinct text states without neural sequences before costly inference. */
export async function assertVideoTextFits(input: VideoFrameInput) {
  const checked = new Set<string>();
  const preview = { ...input, talkingHeadSequences: {} };
  for (const moment of videoTimeline(input.timing)) {
    const signature = `${moment.sceneIndex}:${moment.cueIndex}`;
    if (checked.has(signature)) continue;
    await drawVideoFrame(preview, moment);
    if (moment.endFrame - moment.startFrame > 1)
      await drawVideoFrame(preview, { ...moment, startFrame: moment.endFrame - 1 });
    checked.add(signature);
  }
}

const motionTracks = new WeakMap<
  VideoFrameInput,
  Map<string, ReturnType<typeof createMotionTrack>>
>();
function portraitMotion(input: VideoFrameInput, speakerId: string, time: number) {
  let tracks = motionTracks.get(input);
  if (!tracks) {
    tracks = new Map();
    motionTracks.set(input, tracks);
  }
  let track = tracks.get(speakerId);
  if (!track) {
    const settings = input.episode.presentation?.speakers.find(
      (speaker) => speaker.id === speakerId,
    )?.avatar?.motion;
    track = createMotionTrack(input.timing.cues, input.timing.durationSeconds, speakerId, settings);
    tracks.set(speakerId, track);
  }
  return sampleMotionTrack(track, time);
}

const visualImageCache = new WeakMap<
  VideoFrameInput,
  Promise<Record<string, { asset: ResolvedVisualAsset; image: Image }>>
>();
function visualImages(input: VideoFrameInput) {
  let pending = visualImageCache.get(input);
  if (!pending) {
    pending = (async () => {
      const assets = input.visualAssets ?? (await resolveVisualAssets(input.episode));
      return Object.fromEntries(
        await Promise.all(
          Object.entries(assets).map(async ([id, asset]) => [
            id,
            { asset, image: await loadImage(asset.bytes) },
          ]),
        ),
      );
    })();
    visualImageCache.set(input, pending);
  }
  return pending;
}
function drawVisualImage(
  ctx: SKRSContext2D,
  image: Image,
  box: { x: number; y: number; width: number; height: number },
  fit: string,
  focalX: number,
  focalY: number,
) {
  const placed = imagePlacement(image.width, image.height, box, fit, focalX, focalY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.drawImage(image, placed.x, placed.y, placed.width, placed.height);
  ctx.restore();
}
export async function drawVideoFrame(input: VideoFrameInput, moment: VideoMoment): Promise<Buffer> {
  await loadVideoFonts();
  const { episode, timing, layout, code, evidence } = input;
  const scene = episode.scenes[moment.sceneIndex];
  if (!scene) throw new Error("Missing video scene");
  const cue = moment.cueIndex === null ? undefined : timing.cues[moment.cueIndex];
  const canvas = createCanvas(layout.canvas.width, layout.canvas.height);
  const ctx = canvas.getContext("2d");
  const motion = sceneMotion(episode, timing, moment.sceneIndex, moment.startFrame);
  const comic = episode.presentation?.tone === "comic";
  const design = feedSceneDesign(episode, moment.sceneIndex);
  const hero = design.kind === "hook" || design.kind === "closing";
  const accent = comic && !design.custom ? "#ffd166" : design.accent;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1920);
  gradient.addColorStop(0, design.surface);
  gradient.addColorStop(0.58, "#081126");
  gradient.addColorStop(1, "#030715");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);
  if (hero) {
    const band = ctx.createLinearGradient(0, 0, 1080, 1250);
    band.addColorStop(
      0,
      design.custom ? design.surface : design.kind === "hook" ? "#4738cd" : "#5a36aa",
    );
    band.addColorStop(1, "#12357b");
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(1080, 0);
    ctx.lineTo(1080, 960);
    ctx.lineTo(0, 1210);
    ctx.closePath();
    ctx.fill();
  }
  const glowX = 850 + (design.motion === "minimal" ? 0 : Math.sin(motion.elapsed * 0.35) * 75);
  const glow = ctx.createRadialGradient(glowX, 560, 10, glowX, 560, 650);
  glow.addColorStop(0, "#0e749030");
  glow.addColorStop(1, "#0e749000");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.globalAlpha = 0.035;
  for (let x = 72; x < 1000; x += 64)
    for (let y = 100; y < 1750; y += 64) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  ctx.globalAlpha = 1;
  const images = await visualImages(input);
  const selectedImage = design.image ? images[design.image.assetId] : undefined;
  if (design.image && !selectedImage)
    throw new Error("Selected presentation image is unavailable.");
  if (design.image?.treatment === "background" && selectedImage) {
    drawVisualImage(
      ctx,
      selectedImage.image,
      { x: 0, y: 0, width: 1080, height: 1920 },
      design.image.fit,
      design.image.focalX,
      design.image.focalY,
    );
    ctx.fillStyle = "#030715cc";
    ctx.fillRect(0, 0, 1080, 1920);
  }
  for (const shape of visualPrimitives(
    design.background,
    design.effect,
    motion.progress,
    design.motion === "minimal",
  )) {
    ctx.save();
    ctx.globalAlpha = shape.opacity;
    const color = shape.secondary ? design.secondary : accent;
    if (shape.kind === "line") {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(shape.x, shape.y);
      ctx.lineTo(shape.x2 ?? shape.x, shape.y2 ?? shape.y);
      ctx.stroke();
    } else {
      if (shape.kind === "glow") {
        const radial = ctx.createRadialGradient(
          shape.x,
          shape.y,
          0,
          shape.x,
          shape.y,
          shape.r ?? 0,
        );
        radial.addColorStop(0, color);
        radial.addColorStop(1, `${color}00`);
        ctx.fillStyle = radial;
      } else ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.r ?? 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  text(
    ctx,
    "SAP / DEVELOPER SHORTS",
    { x: 72, y: 90, width: 700, height: 40 },
    28,
    accent,
    "Shorts Heading",
    "brand",
  );
  const { box: headline, size: headlineSize } = headlineTypography(ctx, design, layout);
  ctx.save();
  ctx.globalAlpha = hero ? 0.9 + 0.1 * motion.enter : motion.opacity;
  text(
    ctx,
    design.headline,
    { ...headline, y: headline.y + motion.offsetY },
    headlineSize,
    "#f8fafc",
    "Shorts Heading",
    "headline",
  );
  ctx.restore();
  text(
    ctx,
    `${String(moment.sceneIndex + 1).padStart(2, "0")} / ${String(episode.scenes.length).padStart(2, "0")}`,
    { x: 796, y: 90, width: 160, height: 40 },
    28,
    accent,
    "Shorts Heading",
    "scene marker",
  );
  const box =
    !hero && design.emphasis === "evidence" ? { ...layout.demo, y: 400, height: 910 } : layout.demo;
  if (!hero) {
    panel(ctx, box.x, box.y, box.width, box.height, "#0b1222");
    ctx.strokeStyle = "#25344c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, 24);
    ctx.stroke();
    panel(
      ctx,
      box.x + 24,
      box.y + box.height - 10,
      (box.width - 48) * motion.progress,
      3,
      accent,
      1,
    );
    // Subtle window header divider & terminal control dots
    ctx.save();
    ctx.strokeStyle = "rgba(184, 219, 188, 0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(box.x + 24, box.y + 84);
    ctx.lineTo(box.x + box.width - 24, box.y + 84);
    ctx.stroke();
    const dotColors = ["#d96c63", "#e0b25b", "#59b381"];
    dotColors.forEach((dotColor, idx) => {
      ctx.fillStyle = dotColor;
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.arc(box.x + box.width - 88 + idx * 24, box.y + 44, 6.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
    if (comic) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.width, box.height, 24);
      ctx.stroke();
    }
    text(
      ctx,
      scene.visual.label,
      { x: box.x + 32, y: box.y + 28, width: box.width - 64, height: 70 },
      26,
      "#9fb8b6",
      "Shorts Body",
      "panel label",
    );
  }
  let y = box.y + 118;
  const body = { x: box.x + 32, y, width: box.width - 64, height: box.height - 150 };
  if (design.image?.treatment === "card" && selectedImage) {
    const imageBox = figureGeometry(body);
    panel(ctx, imageBox.x, imageBox.y, imageBox.width, imageBox.height, "#101a30", 18);
    drawVisualImage(
      ctx,
      selectedImage.image,
      imageBox,
      design.image.fit,
      design.image.focalX,
      design.image.focalY,
    );
    const caption = design.image.caption ?? "Illustration";
    const captionBox = { ...body, y: imageBox.y + imageBox.height + 20, height: 110 };
    text(
      ctx,
      caption,
      captionBox,
      fitVideoProse(ctx, caption, captionBox, 38, 30, "image caption"),
      "#f8fafc",
      "Shorts Body",
      "image caption",
    );
    if (selectedImage.asset.credit)
      text(
        ctx,
        selectedImage.asset.credit,
        { ...body, y: imageBox.y + imageBox.height + 140, height: 45 },
        fitVideoProse(
          ctx,
          selectedImage.asset.credit,
          { width: body.width, height: 45 },
          24,
          18,
          "image credit",
        ),
        "#a4bacb",
        "Shorts Body",
        "image credit",
      );
  } else if (design.composition) {
    const cards = compositionCards(design.composition, body);
    const active = Math.min(cards.length - 1, Math.floor(motion.progress * cards.length));
    for (const [index, card] of cards.entries()) {
      const cardActive = design.motion === "minimal" || index <= active;
      ctx.save();
      ctx.globalAlpha = cardActive ? 1 : 0.55;
      panel(
        ctx,
        card.x,
        card.y,
        card.width,
        card.height,
        cardActive ? design.surface : "#102039",
        24,
      );
      ctx.strokeStyle = cardActive ? accent : design.secondary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(card.x, card.y, card.width, card.height, 24);
      ctx.stroke();
      text(
        ctx,
        design.composition.kind === "comparison"
          ? index === 0
            ? "A"
            : "B"
          : String(index + 1).padStart(2, "0"),
        { x: card.x + 28, y: card.y + 16, width: card.width - 56, height: 34 },
        24,
        accent,
        "Shorts Heading",
        "composition marker",
      );
      text(
        ctx,
        card.renderLabel,
        card.textBox,
        fitVideoProse(
          ctx,
          card.renderLabel,
          card.textBox,
          card.preferredSize,
          36,
          "composition label",
        ),
        "#f7faff",
        "Shorts Heading",
        "composition label",
      );
      if (design.composition.kind === "timeline") {
        const node = sequenceGeometry("timeline", cards.length, body)[index];
        if (!node) throw new Error("Missing timeline node.");
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(node.markerX, body.y);
        ctx.lineTo(node.markerX, body.y + body.height);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(node.markerX, node.markerY, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      if (design.composition.kind === "flow" && index < cards.length - 1) {
        const center = card.x + card.width / 2;
        const bottom = card.y + card.height + 2;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(center, bottom);
        ctx.lineTo(center, bottom + 23);
        ctx.moveTo(center - 8, bottom + 15);
        ctx.lineTo(center, bottom + 23);
        ctx.lineTo(center + 8, bottom + 15);
        ctx.stroke();
      }
      if (design.composition.kind === "steps" && index < cards.length - 1)
        text(
          ctx,
          "↓",
          { x: card.x, y: card.y + card.height + 6, width: card.width, height: 44 },
          32,
          accent,
          "Shorts Heading",
          "composition arrow",
        );
      ctx.restore();
    }
  } else if (scene.visual.kind === "code" && "codePath" in scene.visual && scene.visual.codePath) {
    const source = code[scene.visual.codePath];
    if (!source) throw new Error("Missing verified source code for video");
    const codeHeight = text(
      ctx,
      source,
      body,
      box.fontSize,
      "#e4f0ff",
      "Shorts Code",
      "source code",
      cue?.text,
    );
    const identifiers = cueIdentifiers(source, cue?.text ?? "")
      .slice(0, 2)
      .join(" · ");
    if (identifiers && codeHeight + 125 < body.height) {
      const focusY = box.y + box.height - 105;
      panel(ctx, body.x, focusY, body.width, 72, "#183b65", 12);
      text(
        ctx,
        identifiers,
        { x: body.x + 20, y: focusY + 16, width: body.width - 40, height: 48 },
        34,
        accent,
        "Shorts Heading",
        "spoken code focus",
      );
    }
  } else if (scene.visual.kind === "output" && "captureKey" in scene.visual) {
    if (!evidence || !scene.visual.captureKey) throw new Error("Missing captured demo result");
    if (scene.visual.instructions?.length) {
      for (const instruction of scene.visual.instructions) {
        y +=
          text(
            ctx,
            instruction,
            { ...body, y, height: box.y + box.height - 32 - y },
            box.fontSize,
            accent,
            "Shorts Code",
            "run instructions",
          ) + 20;
      }
    }
    const capture = evidence.captures[scene.visual.captureKey];
    if (typeof capture === "string")
      text(
        ctx,
        capture,
        { ...body, y, height: box.y + box.height - 32 - y },
        box.fontSize,
        "#d6ead7",
        "Shorts Code",
        "captured metadata",
      );
    else {
      const spacious = !scene.visual.instructions?.length;
      if (spacious) {
        text(
          ctx,
          String(
            Math.round(
              capture.value.length *
                (design.motion === "minimal" ? 1 : Math.min(1, motion.elapsed / 0.65)),
            ),
          ),
          { x: body.x, y: y - 12, width: 230, height: 235 },
          188,
          accent,
          "Shorts Heading",
          "captured row counter",
        );
        text(
          ctx,
          "captured rows",
          { x: body.x + 250, y: y + 100, width: body.width - 250, height: 65 },
          38,
          "#e2f5fa",
          "Shorts Heading",
        );
        y += 235;
      } else {
        text(
          ctx,
          "200 OK · captured result",
          { ...body, y, height: 60 },
          34,
          accent,
          "Shorts Heading",
        );
        y += 78;
      }
      if (design.dataView !== "rows") {
        const chart = chartPlan(capture.value, motion.progress, design.motion === "minimal");
        const rowHeight = Math.min(160, (box.y + box.height - y - 90) / chart.rows.length);
        if (rowHeight < 110)
          throw new Error(
            "Too many captured rows for a readable chart. Use data rows or a smaller captured result.",
          );
        for (const row of chart.rows) {
          text(
            ctx,
            row.label,
            { x: body.x, y, width: body.width - 120, height: 54 },
            fitVideoProse(
              ctx,
              row.label,
              { width: body.width - 120, height: 54 },
              38,
              26,
              "chart label",
            ),
            "#f8fafc",
            "Shorts Heading",
            "chart label",
          );
          text(
            ctx,
            String(row.value),
            { x: body.x + body.width - 110, y, width: 110, height: 54 },
            40,
            accent,
            "Shorts Heading",
            "chart value",
          );
          panel(ctx, body.x, y + 64, body.width, 4, "#39485d", 2);
          if (design.dataView === "bars")
            panel(
              ctx,
              body.x,
              y + 60,
              Math.max(1, body.width * row.fraction * row.reveal),
              16,
              accent,
              6,
            );
          else {
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(body.x + body.width * row.fraction * row.reveal, y + 66, 12, 0, Math.PI * 2);
            ctx.fill();
          }
          y += rowHeight;
        }
        text(
          ctx,
          `Stock · zero baseline · ${chart.rows.length} captured rows`,
          { x: body.x, y: box.y + box.height - 66, width: body.width, height: 40 },
          24,
          "#9fb8b6",
          "Shorts Body",
          "chart basis",
        );
      } else {
        const maximumStock = Math.max(1, ...capture.value.map((row) => row.stock));
        const rowHeight = spacious ? 128 : 90;
        for (const [rowIndex, row] of capture.value.entries()) {
          const spotlight =
            Math.floor(motion.elapsed / 2.4) % Math.max(1, capture.value.length) === rowIndex;
          panel(
            ctx,
            body.x,
            y,
            body.width,
            rowHeight - 12,
            rowIndex % 2 ? "#242a53" : "#124051",
            16,
          );
          if (spotlight) panel(ctx, body.x, y + 12, 6, rowHeight - 36, accent, 3);
          const reveal = Math.min(1, Math.max(0, motion.elapsed - rowIndex * 0.16) / 0.65);
          text(
            ctx,
            row.title,
            { x: body.x + 20, y: y + 20, width: body.width - 210, height: 56 },
            spacious ? 42 : 34,
            "#f2f7ff",
            "Shorts Heading",
            "captured product",
          );
          text(
            ctx,
            String(row.stock),
            { x: body.x + body.width - 170, y: y + 18, width: 145, height: 60 },
            spacious ? 48 : 36,
            accent,
            "Shorts Heading",
            "captured stock",
          );
          text(
            ctx,
            "in stock",
            { x: body.x + body.width - 170, y: y + (spacious ? 72 : 48), width: 145, height: 30 },
            spacious ? 22 : 18,
            "#bfd7df",
          );
          panel(
            ctx,
            body.x + 20,
            y + rowHeight - (spacious ? 22 : 18),
            Math.max(1, (body.width - 40) * (row.stock / maximumStock) * reveal),
            spacious ? 6 : 4,
            accent,
            3,
          );
          y += rowHeight;
        }
        if (!spacious && y + 130 < box.y + box.height - 24) {
          text(
            ctx,
            `${capture.value.length} captured rows`,
            { x: body.x, y: y + 30, width: body.width, height: 65 },
            44,
            accent,
            "Shorts Heading",
            "captured total",
          );
        }
      }
      if (y > box.y + box.height - 20) throw new Error("Captured results overflow the video panel");
    }
  } else if (isNewsEpisode(episode) && scene.visual.kind === "news-card" && "claimIds" in scene) {
    const claim = episode.claims.find((item) => item.id === scene.claimIds[0]);
    if (!claim) throw new Error("Missing sourced news card");
    const card = newsCardLayout(ctx, claim, { ...body, height: box.y + box.height - 32 - body.y });
    panel(
      ctx,
      body.x,
      card.badge.y,
      body.width,
      card.badge.height,
      claim.availability.status === "generally-available" ? "#bfe96d" : "#ffcb77",
      12,
    );
    text(
      ctx,
      availabilityLabels[claim.availability.status],
      { ...card.badge, x: body.x + 20, width: body.width - 40, y: card.badge.y + 16, height: 64 },
      40,
      "#101a33",
      "Shorts Heading",
    );
    text(ctx, claim.text, card.headline, card.size, "#f5f8ee", "Shorts Heading", "news headline");
    text(ctx, claim.availability.timing, card.timing, 32, "#bdd2c9");
    text(ctx, claim.availability.scope, card.scope, 30, "#bdd2c9", "Shorts Body", "news scope");
  } else if (design.kind === "hook") {
    text(
      ctx,
      episode.title,
      { x: 72, y: 565, width: 864, height: 90 },
      30,
      "#cfdbff",
      "Shorts Body",
      "topic context",
    );
    if (design.serviceBridge) {
      const nodes = [
        { x: 72, label: "MODEL", glyph: "{ }", fill: "#172c64" },
        { x: 382, label: "SERVICE?", glyph: "?", fill: "#392d66" },
        { x: 692, label: "API", glyph: "↗", fill: "#15446b" },
      ];
      for (const [index, node] of nodes.entries()) {
        const lift = (1 - Math.min(1, Math.max(0, motion.elapsed - index * 0.12) / 0.5)) * 22;
        panel(ctx, node.x, 760 + lift, 244, 240, node.fill, 26);
        ctx.strokeStyle = index === 1 ? "#ffcb77" : accent;
        ctx.lineWidth = index === 1 ? 5 : 2;
        ctx.setLineDash(index === 1 ? [14, 12] : []);
        ctx.beginPath();
        ctx.roundRect(node.x, 760 + lift, 244, 240, 26);
        ctx.stroke();
        ctx.setLineDash([]);
        text(
          ctx,
          node.glyph,
          { x: node.x + 30, y: 790 + lift, width: 195, height: 130 },
          90,
          index === 1 ? "#ffcb77" : accent,
          "Shorts Heading",
          "architecture symbol",
        );
        text(
          ctx,
          node.label,
          { x: node.x + 20, y: 930 + lift, width: 214, height: 50 },
          index === 1 ? 31 : 36,
          "#f7faff",
          "Shorts Heading",
          "architecture node",
        );
        if (index < 2) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(node.x + 252, 878);
          ctx.lineTo(node.x + 302, 878);
          ctx.stroke();
          const packet = (motion.elapsed % 1.8) / 1.8;
          panel(ctx, node.x + 250 + packet * 42, 870, 14, 14, accent, 7);
        }
      }
      text(
        ctx,
        "The missing connection",
        { x: 72, y: 1080, width: 864, height: 80 },
        46,
        accent,
        "Shorts Heading",
        "hook insight",
      );
    } else {
      let rowY = 735;
      for (const [index, step] of storySteps(episode).entries()) {
        panel(ctx, 72, rowY, 864, design.custom ? 156 : 130, index % 2 ? "#393072" : "#173c75", 20);
        text(
          ctx,
          String(index + 1).padStart(2, "0"),
          { x: 98, y: rowY + 30, width: 100, height: 75 },
          48,
          accent,
          "Shorts Heading",
        );
        text(
          ctx,
          step.label,
          {
            x: 220,
            y: rowY + (design.custom ? 10 : 26),
            width: 680,
            height: design.custom ? 128 : 90,
          },
          34,
          "#f5f8ff",
          "Shorts Heading",
          "hook step",
        );
        rowY += design.custom ? 170 : 156;
      }
    }
  } else if (design.kind === "closing") {
    const questionBox = { x: 72, y: 640, width: 864, height: 450 };
    text(
      ctx,
      design.question,
      questionBox,
      fitVideoProse(ctx, design.question, questionBox, 78, 48, "closing question"),
      "#f7f8ff",
      "Shorts Heading",
      "closing question",
    );
    panel(ctx, 72, 1140, 864, 130, accent, 24);
    text(
      ctx,
      isNewsEpisode(episode) ? "Explore the sources ↗" : "Try the example ↗",
      { x: 110, y: 1173, width: 790, height: 75 },
      48,
      "#10182b",
      "Shorts Heading",
      "closing action",
    );
  } else {
    text(ctx, episode.title, { ...body, height: 310 }, 58, "#f7f8ff", "Shorts Heading", "opening");
    let flowY = y + 330;
    for (const [index, step] of storySteps(episode).entries()) {
      panel(ctx, body.x, flowY, body.width, 104, "#18325b", 16);
      text(
        ctx,
        `${index + 1}. ${step.label}`,
        { x: body.x + 20, y: flowY + 20, width: body.width - 40, height: 80 },
        30,
        accent,
        "Shorts Heading",
        "story step",
      );
      flowY += 120;
    }
  }
  if (cue) {
    const captionY = layout.captions.y;
    panel(
      ctx,
      layout.captions.x - 14,
      captionY - 12,
      layout.captions.width + 28,
      layout.captions.height + 30,
      "#050b1ae6",
      16,
    );
    // Left vertical accent bar beside active caption
    panel(ctx, layout.captions.x - 20, captionY + 6, 6, 52, accent, 3);
    if (cue.speakerName) {
      text(
        ctx,
        cue.speakerName.toUpperCase(),
        { ...layout.captions, y: captionY - 48, height: 42 },
        28,
        accent,
        "Shorts Heading",
        "speaker label",
      );
    }
    text(
      ctx,
      cue.text,
      {
        ...layout.captions,
        y: captionY,
        height: layout.captions.height - (captionY - layout.captions.y),
      },
      layout.captions.fontSize,
      "#f4f8ec",
      "Shorts Body",
      "captions",
    );
  }
  const timeSeconds = (moment.startFrame + 0.5) / videoFps;
  const fallbackSpeakerId =
    cue?.speakerId ??
    [...timing.cues].reverse().find((item) => item.endSeconds <= timeSeconds && item.speakerId)
      ?.speakerId ??
    scene.dialogue?.[0]?.speakerId;
  const speaker =
    episode.presentation?.speakers.find((item) => item.id === fallbackSpeakerId) ??
    episode.presentation?.speakers[0];
  const coSpeaker =
    episode.presentation?.format === "dialogue"
      ? episode.presentation.speakers.find((item) => item.id !== speaker?.id)
      : undefined;
  const badge = layout.presenter;
  const speakerId = speaker?.id ?? "narrator";
  const isSpeaking = Boolean(cue && (!cue.speakerId || cue.speakerId === speaker?.id));
  const animation = {
    ...resolveCueAnimation(cue, timeSeconds, isSpeaking, speakerId),
    ...portraitMotion(input, speakerId, timeSeconds),
  };
  const speakerPhoto =
    speaker?.avatar?.mode === "photo" && speaker.avatar.imageId
      ? await loadAvatarImage(
          speaker.avatar.imageId,
          undefined,
          speaker.avatar.calibration?.imageSha256,
        )
      : undefined;
  const speakerNeuralFrame =
    speaker?.avatar?.mode === "photo" && speaker.avatar.animation === "neural"
      ? await input.talkingHeadSequences?.[speakerId]?.getFrame(moment.startFrame)
      : undefined;
  const coSpeakerPhoto =
    coSpeaker?.avatar?.mode === "photo" && coSpeaker.avatar.imageId
      ? await loadAvatarImage(
          coSpeaker.avatar.imageId,
          undefined,
          coSpeaker.avatar.calibration?.imageSha256,
        )
      : undefined;
  const coSpeakerNeuralFrame =
    coSpeaker?.avatar?.mode === "photo" && coSpeaker.avatar.animation === "neural"
      ? await input.talkingHeadSequences?.[coSpeaker.id]?.getFrame(moment.startFrame)
      : undefined;
  drawAvatarBadge(
    ctx,
    badge,
    {
      id: speakerId,
      name: speaker?.name ?? (isNewsEpisode(episode) ? "SAP" : "Host"),
      accentColor: accent,
      ...(speaker?.avatar ? { avatar: speaker.avatar } : {}),
      ...(speakerPhoto ? { photoImage: speakerPhoto } : {}),
      ...(speakerNeuralFrame ? { neuralFrameImage: speakerNeuralFrame } : {}),
    },
    animation.viseme,
    isSpeaking,
    {
      animation,
      ...(coSpeaker
        ? {
            coSpeaker: {
              id: coSpeaker.id,
              name: coSpeaker.name,
              accentColor: accent,
              ...(coSpeaker.avatar ? { avatar: coSpeaker.avatar } : {}),
              ...(coSpeakerPhoto ? { photoImage: coSpeakerPhoto } : {}),
              ...(coSpeakerNeuralFrame ? { neuralFrameImage: coSpeakerNeuralFrame } : {}),
            },
          }
        : {}),
    },
  );
  text(
    ctx,
    isNewsEpisode(episode)
      ? `Official sources · checked ${episode.news.asOf}`
      : "Local demo · deployment and auth come later",
    { x: 72, y: 1645, width: 864, height: 38 },
    23,
    "#90aea8",
    "Shorts Body",
    "context note",
  );
  panel(ctx, 72, 1735, 864, 7, "#31504f", 3);
  panel(
    ctx,
    72,
    1735,
    Math.max(7, (864 * (moment.sceneIndex + motion.progress)) / episode.scenes.length),
    7,
    accent,
    3,
  );
  text(
    ctx,
    `${String(moment.sceneIndex + 1).padStart(2, "0")} / ${String(episode.scenes.length).padStart(2, "0")}    ${episode.presentation?.format === "dialogue" ? "THE DEVELOPER CONVERSATION" : "SAP SHORTS"}`,
    { x: 72, y: 1770, width: 864, height: 42 },
    24,
    "#a5bdb4",
  );
  if (design.image?.treatment === "background" && selectedImage?.asset.credit) {
    const creditBox = { x: 72, y: 1830, width: 864, height: 48 };
    text(
      ctx,
      `Image: ${selectedImage.asset.credit}`,
      creditBox,
      fitVideoProse(
        ctx,
        `Image: ${selectedImage.asset.credit}`,
        creditBox,
        22,
        18,
        "background image credit",
      ),
      "#a4bacb",
      "Shorts Body",
      "background image credit",
    );
  }
  return canvas.encode("png");
}
