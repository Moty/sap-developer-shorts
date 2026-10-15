import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { MediaRequest, NarrationTiming } from "./model.js";

const exec = promisify(execFile);
export const sampleRate = 22050;

export function readPcmWav(buffer: Buffer): Buffer {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Invalid WAV file");
  const end = buffer.readUInt32LE(4) + 8;
  if (end !== buffer.length) throw new Error("Incomplete WAV file");
  let format = false;
  let pcm: Buffer | undefined;
  for (let offset = 12; offset + 8 <= end; ) {
    const name = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > end) throw new Error("Truncated WAV chunk");
    if (name === "fmt ") {
      if (
        length < 16 ||
        buffer.readUInt16LE(start) !== 1 ||
        buffer.readUInt16LE(start + 2) !== 1 ||
        buffer.readUInt32LE(start + 4) !== sampleRate ||
        buffer.readUInt32LE(start + 8) !== sampleRate * 2 ||
        buffer.readUInt16LE(start + 12) !== 2 ||
        buffer.readUInt16LE(start + 14) !== 16
      )
        throw new Error("Expected mono 22050 Hz 16-bit PCM audio");
      format = true;
    }
    if (name === "data") pcm = buffer.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2) throw new Error("WAV has no complete PCM samples");
  return pcm;
}

export function encodePcmWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function splitNarration(text: string): string[] {
  const parts: string[] = [];
  for (const { segment } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)) {
    let phrase = "";
    for (const word of segment.trim().split(/\s+/u)) {
      if (phrase && (phrase.length + word.length + 1 > 70 || phrase.split(" ").length >= 10)) {
        parts.push(phrase);
        phrase = "";
      }
      phrase += `${phrase ? " " : ""}${word}`;
    }
    if (phrase) parts.push(phrase);
  }
  return parts;
}

export function pronounce(text: string, glossary: Record<string, string>): string {
  if (text.includes("[[")) throw new Error("Speech control markup is not allowed in narration");
  let spoken = text;
  for (const [term, pronunciation] of Object.entries(glossary).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    spoken = spoken.replace(new RegExp(`\\b${escaped}\\b`, "gu"), () => pronunciation);
  }
  return spoken;
}

export function narrationChunks(request: MediaRequest) {
  return request.episode.scenes.flatMap((scene) =>
    splitNarration(scene.narration).map((text) => ({
      sceneId: scene.id,
      text,
      spokenText: pronounce(text, request.episode.pronunciation),
    })),
  );
}

export async function synthesizeChunk(
  request: MediaRequest,
  text: string,
  path: string,
  signal: AbortSignal,
) {
  try {
    readPcmWav(await readFile(path));
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (process.platform !== "darwin")
    throw new Error(
      "Local narration uses macOS say. Use the fake provider for portable workflow tests.",
    );
  const temporary = `${path}.${randomUUID()}.tmp`;
  const input = `${temporary}.txt`;
  await writeFile(input, text, { flag: "wx" });
  await exec(
    "/usr/bin/say",
    [
      "-v",
      request.settings.localPreview.voice,
      "-r",
      String(request.settings.localPreview.wordsPerMinute),
      "-f",
      input,
      "-o",
      temporary,
      "--file-format=WAVE",
      `--data-format=LEI16@${sampleRate}`,
    ],
    { signal, timeout: 20000, maxBuffer: 1024 * 1024 },
  );
  readPcmWav(await readFile(temporary));
  await rename(temporary, path);
}

export function vttTimestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function buildVtt(cues: NarrationTiming["cues"]): string {
  return `WEBVTT\n\n${cues.map((cue, index) => `${index + 1}\n${vttTimestamp(cue.startSeconds)} --> ${vttTimestamp(cue.endSeconds)}\n${cue.speakerName ? `${cue.speakerName}: ` : ""}${cue.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("-->", "→")}\n`).join("\n")}`;
}

export async function assembleNarration(
  request: MediaRequest,
  directory: string,
): Promise<NarrationTiming> {
  const chunks = narrationChunks(request);
  const timing: NarrationTiming = {
    schemaVersion: 1,
    mode: "local-preview",
    voice: request.settings.localPreview.voice,
    rate: request.settings.localPreview.wordsPerMinute,
    sampleRate,
    durationSeconds: 0,
    scenes: [],
    cues: [],
  };
  const buffers: Buffer[] = [];
  let frames = 0;
  for (const scene of request.episode.scenes) {
    const sceneStart = frames;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!chunk || chunk.sceneId !== scene.id) continue;
      const pcm = readPcmWav(await readFile(resolve(directory, `chunk-${index}.wav`)));
      const startSeconds = frames / sampleRate;
      buffers.push(pcm);
      frames += pcm.length / 2;
      timing.cues.push({ ...chunk, startSeconds, endSeconds: frames / sampleRate });
    }
    const speechFrames = frames - sceneStart;
    const targetFrames = Math.round((scene.endSeconds - scene.startSeconds) * sampleRate);
    if (speechFrames < targetFrames) {
      buffers.push(Buffer.alloc((targetFrames - speechFrames) * 2));
      frames += targetFrames - speechFrames;
    }
    timing.scenes.push({
      id: scene.id,
      startSeconds: sceneStart / sampleRate,
      endSeconds: frames / sampleRate,
      speechSeconds: speechFrames / sampleRate,
    });
  }
  timing.durationSeconds = frames / sampleRate;
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "narration.wav"), encodePcmWav(Buffer.concat(buffers)));
  await writeFile(resolve(directory, "timing.json"), `${JSON.stringify(timing, null, 2)}\n`);
  await writeFile(resolve(directory, "captions.vtt"), buildVtt(timing.cues));
  return timing;
}
