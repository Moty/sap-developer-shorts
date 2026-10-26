import { readFile } from "node:fs/promises";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { hash } from "../digest.js";
import { type ContentEpisode, type DemoEvidence, isNewsEpisode } from "../domain.js";
import type { VideoLayout } from "../layout.js";
import { drawAvatarBadge, loadAvatarImage, resolveCueAnimation } from "../media/avatar.js";
import type { NarrationTiming } from "../media/model.js";
import { availabilityLabels } from "../news/contracts.js";
import { sourceFile } from "../paths.js";
import { sceneMotion, storySteps } from "./motion.js";
import { type VideoMoment, videoFps } from "./timeline.js";

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
        context.fillStyle = "#35524b";
        context.fillRect(left - 2, box.y + index * lineHeight - 2, width + 4, lineHeight);
      }
      context.fillStyle = color;
    }
    context.fillText(line, box.x, box.y + index * lineHeight);
  });
  return lines.length * lineHeight;
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

import { createMotionTrack, sampleMotionTrack } from "../media/portrait-motion.js";
import type { TalkingHeadSequence } from "../media/talking-head.js";

export interface VideoFrameInput {
  episode: ContentEpisode;
  timing: NarrationTiming;
  layout: VideoLayout;
  code: Record<string, string>;
  evidence?: DemoEvidence;
  talkingHeadSequences?: Record<string, TalkingHeadSequence>;
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
  const accent = comic ? "#fbbf24" : "#5eead4";
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1920);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(0.6, "#080f20");
  gradient.addColorStop(1, "#020617");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);
  const glowX = 850 + Math.sin(motion.elapsed * 0.35) * 75;
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
  text(
    ctx,
    "SAP / DEVELOPER SHORTS",
    { x: 72, y: 90, width: 864, height: 40 },
    28,
    accent,
    "Shorts Heading",
    "brand",
  );
  let headlineSize = layout.headline.fontSize;
  const minimumHeadlineSize = Math.min(56, headlineSize);
  for (;;) {
    ctx.font = `${headlineSize}px "Shorts Heading"`;
    if (
      wrapVideoText(ctx, scene.overlay, layout.headline.width).length * headlineSize * 1.22 <=
        layout.headline.height ||
      headlineSize <= minimumHeadlineSize
    )
      break;
    headlineSize -= 2;
  }
  ctx.save();
  ctx.globalAlpha = motion.opacity;
  text(
    ctx,
    scene.overlay,
    { ...layout.headline, y: layout.headline.y + motion.offsetY },
    headlineSize,
    "#f8fafc",
    "Shorts Heading",
    "headline",
  );
  ctx.restore();
  const box = layout.demo;
  panel(ctx, box.x, box.y, box.width, box.height, "#0b1222");
  ctx.strokeStyle = "#25344c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, 24);
  ctx.stroke();
  panel(ctx, box.x + 24, box.y + box.height - 10, (box.width - 48) * motion.progress, 3, accent, 1);
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
  let y = box.y + 118;
  const body = { x: box.x + 32, y, width: box.width - 64, height: box.height - 150 };
  if (scene.visual.kind === "code" && "codePath" in scene.visual && scene.visual.codePath) {
    const source = code[scene.visual.codePath];
    if (!source) throw new Error("Missing verified source code for video");
    text(ctx, source, body, box.fontSize, "#d6ead7", "Shorts Code", "source code", cue?.text);
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
      y +=
        text(
          ctx,
          "200 OK · captured result",
          { ...body, y, height: 65 },
          32,
          accent,
          "Shorts Heading",
        ) + 24;
      const maximumStock = Math.max(1, ...capture.value.map((row) => row.stock));
      for (const [rowIndex, row] of capture.value.entries()) {
        panel(ctx, body.x, y, body.width, 84, "#132239", 12);
        text(ctx, row.title, { x: body.x + 20, y: y + 20, width: 580, height: 48 }, 34, "#e6f2e8");
        text(
          ctx,
          `${row.stock} in stock`,
          { x: body.x + 570, y: y + 26, width: 200, height: 40 },
          26,
          "#a9c6bb",
        );
        const reveal = Math.min(1, Math.max(0, motion.elapsed - rowIndex * 0.12) / 0.65);
        panel(
          ctx,
          body.x + 20,
          y + 74,
          Math.max(1, (body.width - 40) * (row.stock / maximumStock) * reveal),
          3,
          row.stock > 0 ? accent : "#475569",
          1,
        );
        y += 100;
      }
      if (y + 130 < box.y + box.height - 24) {
        text(
          ctx,
          String(Math.round(capture.value.length * Math.min(1, motion.elapsed / 0.7))),
          { x: body.x, y: y + 36, width: 140, height: 110 },
          80,
          accent,
          "Shorts Heading",
          "captured row counter",
        );
        text(
          ctx,
          "captured rows",
          { x: body.x + 155, y: y + 65, width: body.width - 155, height: 50 },
          32,
          "#94a3b8",
        );
      }
      if (y > box.y + box.height - 20) throw new Error("Captured results overflow the video panel");
    }
  } else if (isNewsEpisode(episode) && scene.visual.kind === "news-card" && "claimIds" in scene) {
    const claim = episode.claims.find((item) => item.id === scene.claimIds[0]);
    if (!claim) throw new Error("Missing sourced news card");
    y +=
      text(
        ctx,
        availabilityLabels[claim.availability.status],
        { ...body, y, height: 80 },
        34,
        accent,
        "Shorts Heading",
      ) + 36;
    y +=
      text(
        ctx,
        claim.text,
        { ...body, y, height: 270 },
        52,
        "#f5f8ee",
        "Shorts Heading",
        "news headline",
      ) + 36;
    y += text(ctx, claim.availability.timing, { ...body, y, height: 150 }, 36, "#bdd2c9") + 24;
    text(
      ctx,
      claim.availability.scope,
      { ...body, y, height: box.y + box.height - 32 - y },
      34,
      "#bdd2c9",
      "Shorts Body",
      "news scope",
    );
  } else {
    const title =
      scene.phase === "cta"
        ? isNewsEpisode(episode)
          ? "Explore the official sources"
          : "Try the working example"
        : episode.title;
    const openingHeight = text(
      ctx,
      title,
      { ...body, y: y + 12, height: 310 },
      58,
      "#f8fafc",
      "Shorts Heading",
      "opening",
    );
    let flowY = y + openingHeight + 60;
    for (const [index, step] of storySteps(episode).entries()) {
      const stepEnter = Math.min(1, Math.max(0, motion.elapsed - index * 0.14) / 0.5);
      const offset = 18 * (1 - stepEnter);
      ctx.save();
      ctx.globalAlpha = 0.65 + 0.35 * stepEnter;
      panel(ctx, body.x, flowY + offset, body.width, 104, "#122139", 16);
      text(
        ctx,
        String(index + 1).padStart(2, "0"),
        { x: body.x + 20, y: flowY + offset + 32, width: 70, height: 44 },
        30,
        accent,
        "Shorts Code",
      );
      text(
        ctx,
        step.label,
        { x: body.x + 100, y: flowY + offset + 25, width: body.width - 125, height: 70 },
        30,
        "#dbeafe",
        "Shorts Heading",
        "story step",
      );
      ctx.restore();
      flowY += 126;
    }
    if (flowY > box.y + box.height - 24)
      throw new Error("Video story flow does not fit its readable text bounds");
  }
  if (cue) {
    const captionY = layout.captions.y;
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
  return canvas.encode("png");
}
