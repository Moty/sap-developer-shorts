import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fail } from "./contracts.js";

const exec = promisify(execFile);
export async function checkPortraitInput(bytes: Buffer, directory: string) {
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!png && !jpeg && !webp)
    fail(400, "INVALID_PORTRAIT", "Choose a PNG, JPEG, or WebP portrait.");
  const file = resolve(directory, "image-input");
  await writeFile(file, bytes, { mode: 0o600 });
  let probe: { streams?: { width: number; height: number }[] };
  try {
    probe = JSON.parse(
      (
        await exec(
          "ffprobe",
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            file,
          ],
          { timeout: 10_000, maxBuffer: 64_000 },
        )
      ).stdout,
    );
  } catch {
    fail(400, "INVALID_PORTRAIT", "The portrait could not be decoded.");
  }
  const image = probe.streams?.[0];
  if (
    !image ||
    image.width > 8192 ||
    image.height > 8192 ||
    image.width * image.height > 24_000_000
  )
    fail(
      400,
      "INVALID_PORTRAIT",
      "Choose a portrait up to 24 megapixels and 8192 pixels per side.",
    );
}
