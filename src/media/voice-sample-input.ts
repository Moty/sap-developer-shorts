import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { readPcmWav } from "./audio.js";

const exec = promisify(execFile);
/** Decode browser recordings too: streamed WebM may not contain a duration header. */
export async function prepareVoiceSample(
  bytes: Buffer,
  excerpt: { startSeconds?: number; endSeconds?: number },
  directory: string,
) {
  if (!bytes.length || bytes.length > 30 * 1024 * 1024)
    throw new Error("Choose an audio recording up to 30 MiB.");
  const trimmed = excerpt.startSeconds !== undefined || excerpt.endSeconds !== undefined;
  const maximum = trimmed ? 120 : 30;
  const source = resolve(directory, "reference-input");
  const output = resolve(directory, "reference-decoded.wav");
  await writeFile(source, bytes, { mode: 0o600 });
  await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "wav,mp3,ogg,flac,mov,matroska,webm,aac,aiff,asf",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-t",
      String(maximum + 1),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "22050",
      "-c:a",
      "pcm_s16le",
      output,
    ],
    { timeout: 20_000, maxBuffer: 64_000 },
  );
  const audio = await readFile(output);
  const pcm = readPcmWav(audio);
  const duration = pcm.length / (2 * 22050);
  if (duration < 3 || duration > maximum)
    throw new Error(
      trimmed
        ? "Choose a recording up to two minutes with a 3–30 second excerpt."
        : "Read the complete passage in 3–30 seconds, or upload a shorter recording. Nothing has been saved or cut off.",
    );
  return {
    bytes: audio,
    startSeconds: excerpt.startSeconds ?? 0,
    // Never silently cut a reading at 15s while retaining its full transcript.
    endSeconds: excerpt.endSeconds ?? duration,
  };
}
