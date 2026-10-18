import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { readPcmWav } from "../media/audio.js";
import type { BlobStore } from "./blobs.js";
import { type Asset, digest, fail, type Job, object, type RecordData } from "./contracts.js";

const exec = promisify(execFile);
export async function verifyOutputs(
  blobs: BlobStore,
  job: Job,
  assets: Asset[],
  metrics: RecordData,
) {
  const data = new Map<string, Buffer>();
  for (const asset of assets) {
    const bytes = await blobs.get(asset.path);
    if (bytes.length !== asset.size || digest(bytes) !== asset.sha256)
      fail(409, "OUTPUT_CHANGED", "An output failed integrity verification.");
    if (data.has(asset.kind))
      fail(409, "INVALID_OUTPUT", "Duplicate output types are not permitted.");
    data.set(asset.kind, bytes);
  }
  let manifest: RecordData;
  try {
    manifest = object(JSON.parse(data.get("manifest")?.toString() ?? ""));
  } catch {
    fail(409, "INVALID_OUTPUT", "Invalid result manifest.");
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.outputs))
    fail(409, "INVALID_OUTPUT", "Invalid result manifest.");
  if (JSON.stringify(manifest.metrics) !== JSON.stringify(metrics))
    fail(409, "INVALID_OUTPUT", "Result metrics do not match the manifest.");
  const outputs = manifest.outputs as RecordData[];
  if (
    outputs.length !== assets.length - 1 ||
    assets.some(
      (asset) =>
        asset.kind !== "manifest" &&
        !outputs.some((output) => output.kind === asset.kind && output.sha256 === asset.sha256),
    )
  )
    fail(409, "INVALID_OUTPUT", "Result manifest does not cover all outputs.");
  const audio = data.get(job.kind === "audition" ? "audition" : "audio");
  if (!audio) fail(409, "INCOMPLETE_OUTPUT", "Narration is missing.");
  let duration = 0;
  try {
    duration = readPcmWav(audio).length / 2 / 22050;
  } catch {
    fail(409, "INVALID_OUTPUT", "Narration must be a valid normalized WAV.");
  }
  if (Math.abs(duration - Number(metrics.durationSeconds)) > 0.15)
    fail(409, "INVALID_OUTPUT", "The reported audio duration does not match the output.");
  if (job.kind === "episode") {
    const expected = new Map([
      ["short.mp4", data.get("video")],
      ["narration.wav", data.get("audio")],
      ["captions.vtt", data.get("captions")],
    ]);
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data.get("package") ?? Buffer.alloc(0), {
        filter: (file) => {
          const maximum =
            file.name === "episode.json" ? 1024 * 1024 : (expected.get(file.name)?.length ?? 0);
          if (!maximum || file.originalSize > maximum)
            fail(
              409,
              "INVALID_OUTPUT",
              "The episode package contains an unexpected or oversized file.",
            );
          return true;
        },
      });
    } catch {
      fail(409, "INVALID_OUTPUT", "The episode package could not be verified.");
    }
    if (Object.keys(entries).length !== 4 || !entries["episode.json"])
      fail(
        409,
        "INVALID_OUTPUT",
        "The package must contain the episode and its three media files.",
      );
    for (const [name, bytes] of expected)
      if (!bytes || !entries[name] || digest(Buffer.from(entries[name])) !== digest(bytes))
        fail(409, "INVALID_OUTPUT", "The package media does not match its verified output.");
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      if (value && typeof value === "object")
        return `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
          .join(",")}}`;
      return JSON.stringify(value);
    };
    if (
      canonical(JSON.parse(Buffer.from(entries["episode.json"]).toString())) !==
      canonical(job.snapshot.episode)
    )
      fail(409, "INVALID_OUTPUT", "The package script does not match the submitted episode.");
    const directory = await mkdtemp(resolve(tmpdir(), "shorts-private-verify-"));
    try {
      const video = resolve(directory, "video.mp4");
      await writeFile(video, data.get("video") ?? Buffer.alloc(0), { mode: 0o600 });
      const probe = JSON.parse(
        (
          await exec(
            "ffprobe",
            [
              "-v",
              "error",
              "-protocol_whitelist",
              "file,pipe",
              "-format_whitelist",
              "mov",
              "-show_streams",
              "-show_format",
              "-of",
              "json",
              video,
            ],
            { timeout: 10_000 },
          )
        ).stdout,
      );
      if (
        !probe.streams.some(
          (stream: RecordData) =>
            stream.codec_type === "video" && stream.width === 1080 && stream.height === 1920,
        ) ||
        !probe.streams.some((stream: RecordData) => stream.codec_type === "audio") ||
        Math.abs(Number(probe.format.duration) - duration) > 0.25
      )
        fail(
          409,
          "INVALID_OUTPUT",
          "The video does not match the expected size, audio, or duration.",
        );
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-xerror",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mov",
          "-i",
          video,
          "-f",
          "null",
          "-",
        ],
        {
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
        },
      );
      if (!data.get("captions")?.toString().startsWith("WEBVTT"))
        fail(409, "INVALID_OUTPUT", "Captions are missing or invalid.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
