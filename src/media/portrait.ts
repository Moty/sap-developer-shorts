import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { hash } from "../digest.js";
import type { SpeakerAvatarConfig } from "../domain.js";
import { projectRoot } from "../paths.js";
import { acquireVideoGate } from "../video/cache.js";
import { saveCustomAvatar } from "./avatar.js";
import { prepareTalkingHeadSequence } from "./talking-head.js";

const exec = promisify(execFile);

/** A reusable picture + narration entry point, independent of SAP episode schemas. */
export async function renderPortraitNarration(
  imageInput: string,
  audioPath: string,
  motion: NonNullable<SpeakerAvatarConfig["motion"]> = { style: "conversational", intensity: 0.7 },
  progress?: (message: string) => void,
) {
  let imageId = imageInput;
  if (imageInput.includes("/") || imageInput.includes("\\")) {
    const path = resolve(imageInput);
    if ((await stat(path)).size > 4 * 1024 * 1024)
      throw new Error("Portrait image must be at most 4 MB");
    const bytes = await readFile(path);
    imageId = (await saveCustomAvatar(`portrait-${hash(bytes).slice(0, 20)}`, bytes)).imageId;
  }
  const root = resolve(projectRoot, "artifacts/portraits");
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(resolve(root, "input-"));
  try {
    const wavPath = resolve(staging, "narration.wav");
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        resolve(audioPath),
        "-vn",
        "-ar",
        "22050",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ],
      { timeout: 120_000 },
    );
    const probe = JSON.parse(
      (
        await exec("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          wavPath,
        ])
      ).stdout,
    );
    const duration = Number(probe.format.duration);
    if (!Number.isFinite(duration) || duration < 0.25 || duration > 600)
      throw new Error("Portrait narration must be between 0.25 seconds and ten minutes");
    const wavBytes = await readFile(wavPath);
    const sequence = await prepareTalkingHeadSequence({
      speakerId: "narrator",
      avatar: { mode: "photo", animation: "neural", imageId, motion },
      wavBytes,
      cues: [],
      frameCount: Math.ceil(duration * 30),
      fps: 30,
      ...(progress ? { progress } : {}),
    });
    if (!sequence) throw new Error("Portrait renderer did not produce a sequence");
    const directory = resolve(root, sequence.directory.split("/").at(-1) as string);
    await mkdir(directory, { recursive: true });
    const videoPath = resolve(directory, "portrait.mp4");
    const temporary = resolve(directory, "portrait.tmp.mp4");
    const release = await acquireVideoGate(await realpath(directory));
    try {
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-framerate",
          "30",
          "-i",
          resolve(sequence.directory, "frame-%04d.png"),
          "-i",
          wavPath,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-frames:v",
          String(sequence.frameCount),
          "-c:v",
          "libx264",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-af",
          "apad",
          "-t",
          String(sequence.frameCount / 30),
          "-movflags",
          "+faststart",
          temporary,
        ],
        { timeout: 180_000 },
      );
      await exec("ffmpeg", ["-v", "error", "-xerror", "-i", temporary, "-f", "null", "-"], {
        timeout: 120_000,
      });
      const output = JSON.parse(
        (
          await exec("ffprobe", [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            temporary,
          ])
        ).stdout,
      );
      const video = output.streams.find(
        (stream: { codec_type: string }) => stream.codec_type === "video",
      );
      const audio = output.streams.find(
        (stream: { codec_type: string }) => stream.codec_type === "audio",
      );
      if (
        video?.width !== 512 ||
        video.height !== 512 ||
        video.codec_name !== "h264" ||
        video.avg_frame_rate !== "30/1" ||
        Number(video.nb_frames) !== sequence.frameCount ||
        !audio ||
        audio.codec_name !== "aac" ||
        !Number.isFinite(Number(output.format.duration)) ||
        Math.abs(Number(output.format.duration) - sequence.frameCount / 30) > 0.1
      )
        throw new Error("Portrait video failed frame, audio or duration validation");
      await rename(temporary, videoPath);
      await writeFile(
        resolve(directory, "portrait-receipt.tmp.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            engine: "ditto",
            imageId,
            motion,
            durationSeconds: sequence.frameCount / 30,
            fps: 30,
            frameCount: sequence.frameCount,
            sequenceDirectory: sequence.directory,
            audioSha256: hash(wavBytes),
            videoSha256: hash(await readFile(videoPath)),
            decoded: true,
          },
          null,
          2,
        )}\n`,
      );
      await rename(
        resolve(directory, "portrait-receipt.tmp.json"),
        resolve(directory, "portrait-receipt.json"),
      );
      return { directory, videoPath };
    } finally {
      release();
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
