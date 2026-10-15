import { readFile } from "node:fs/promises";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { hash } from "../digest.js";
import { type ContentEpisode, type DemoEvidence, isNewsEpisode } from "../domain.js";
import type { VideoLayout } from "../layout.js";
import type { NarrationTiming } from "../media/model.js";
import { availabilityLabels } from "../news/contracts.js";
import { sourceFile } from "../paths.js";
import type { VideoMoment } from "./timeline.js";

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
  const lines: string[] = [];
  for (const paragraph of text.replaceAll("\r", "").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    const tokens = code ? [...paragraph] : paragraph.split(/(\s+)/u);
    for (const token of tokens) {
      if (context.measureText(line + token).width <= width) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = code ? token : token.trimStart();
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

function text(
  context: SKRSContext2D,
  value: string,
  box: { x: number; y: number; width: number; height: number },
  size: number,
  color: string,
  family = "Shorts Body",
  label = "text",
) {
  context.font = `${size}px "${family}"`;
  context.fillStyle = color;
  context.textBaseline = "top";
  const lines = wrapVideoText(context, value, box.width, family === "Shorts Code");
  const lineHeight = size * 1.22;
  if (lines.length * lineHeight > box.height + 1)
    throw new Error(`Video ${label} does not fit its readable text bounds (${lines.length} lines)`);
  lines.forEach((line, index) => {
    context.fillText(line, box.x, box.y + index * lineHeight);
  });
  return lines.length * lineHeight;
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

export interface VideoFrameInput {
  episode: ContentEpisode;
  timing: NarrationTiming;
  layout: VideoLayout;
  code: Record<string, string>;
  evidence?: DemoEvidence;
}

export async function drawVideoFrame(input: VideoFrameInput, moment: VideoMoment): Promise<Buffer> {
  await loadVideoFonts();
  const { episode, timing, layout, code, evidence } = input;
  const scene = episode.scenes[moment.sceneIndex];
  if (!scene) throw new Error("Missing video scene");
  const cue = moment.cueIndex === null ? undefined : timing.cues[moment.cueIndex];
  const canvas = createCanvas(layout.canvas.width, layout.canvas.height);
  const ctx = canvas.getContext("2d");
  const comic = episode.presentation?.tone === "comic";
  const accent = comic ? "#edcb7c" : "#b8dbbc";
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1920);
  gradient.addColorStop(0, "#234d48");
  gradient.addColorStop(0.6, "#142f38");
  gradient.addColorStop(1, "#0b202a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.globalAlpha = 0.05;
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
  text(ctx, scene.overlay, layout.headline, headlineSize, "#f7faf2", "Shorts Heading", "headline");
  const box = layout.demo;
  panel(ctx, box.x, box.y, box.width, box.height, "#0d232d");
  if (comic) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
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
    text(ctx, source, body, box.fontSize, "#d6ead7", "Shorts Code", "source code");
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
      for (const row of capture.value) {
        panel(ctx, body.x, y, body.width, 84, "#193641", 12);
        text(ctx, row.title, { x: body.x + 20, y: y + 20, width: 580, height: 48 }, 34, "#e6f2e8");
        text(
          ctx,
          `${row.stock} in stock`,
          { x: body.x + 570, y: y + 26, width: 200, height: 40 },
          26,
          "#a9c6bb",
        );
        y += 100;
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
          ? "Read the official sources."
          : "Try the working example."
        : isNewsEpisode(episode)
          ? "What changed.\nWhy it matters.\nWhen it ships."
          : episode.title;
    y +=
      text(
        ctx,
        title,
        { ...body, y: y + 40, height: 340 },
        60,
        "#f0f5e9",
        "Shorts Heading",
        "opening",
      ) + 100;
    text(
      ctx,
      isNewsEpisode(episode) ? `SAP news · checked ${episode.news.asOf}` : "Build → Run → Verify",
      { ...body, y, height: 120 },
      32,
      accent,
    );
    text(
      ctx,
      scene.phase === "cta"
        ? "Project and official sources in the post."
        : episode.presentation?.format === "dialogue"
          ? `A developer conversation with ${episode.presentation.speakers.map((speaker) => speaker.name).join(" + ")}`
          : "One idea. A working example.",
      { ...body, y: y + 140, height: 150 },
      34,
      "#a9c5bc",
    );
  }
  if (cue) {
    const captionY = layout.captions.y;
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
  const speaker =
    episode.presentation?.speakers.find((item) => item.id === cue?.speakerId) ??
    episode.presentation?.speakers[0];
  const badge = layout.presenter;
  panel(ctx, badge.x, badge.y, badge.width, badge.height, accent, 40);
  text(
    ctx,
    speaker?.name ?? "SAP",
    { x: badge.x + 20, y: badge.y + 60, width: badge.width - 40, height: 65 },
    40,
    "#173b35",
    "Shorts Heading",
    "speaker badge",
  );
  text(
    ctx,
    speaker ? "AI HOST" : "SHORTS",
    { x: badge.x + 20, y: badge.y + 138, width: badge.width - 40, height: 40 },
    24,
    "#356050",
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
    Math.max(7, (864 * (moment.sceneIndex + 1)) / episode.scenes.length),
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
