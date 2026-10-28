import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { readContentEpisode } from "../contracts.js";
import { demos } from "../demos.js";
import { hash } from "../digest.js";
import type { ContentEpisode, DemoEvidence } from "../domain.js";
import { isNewsEpisode } from "../domain.js";
import { validateLayout } from "../layout.js";
import { collectLibrary } from "../library.js";
import { readPcmWav } from "../media/audio.js";
import type { NarrationTiming } from "../media/model.js";
import { validateTiming } from "../media/package.js";
import { episodeVoiceDescription } from "../media/voice-display.js";
import { loadVerifiedRun } from "../media/worker.js";
import { inside, projectRoot, sourceFile } from "../paths.js";
import { createPresentationDeck, presentationAssets } from "../presentation-deck.js";
import { readRuntimeFiles } from "../provenance.js";
import { escapeHtml as esc } from "../review.js";
import { shortDurationAllowed } from "../timing-policy.js";
import {
  acquireVideoGate,
  recoverVideoCache,
  releaseVideoLock,
  videoCacheDirectory,
} from "./cache.js";
import { drawVideoFrame, type VideoFrameInput, videoFontFiles } from "./frames.js";
import { assertVideoQuality, readVideoReceipt } from "./receipt.js";
import { publishedDemoCommit } from "./source.js";
import { concatTimeline, videoFps, videoTimeline } from "./timeline.js";

const exec = promisify(execFile);
const portraitRuntimeSource = ".state/portrait-runtime/runtime.json";
const encoding = {
  width: 1080,
  height: 1920,
  fps: videoFps,
  video: "libx264",
  crf: 19,
  audio: "aac",
  sampleRate: 48000,
  channels: 2,
  loudness: -16,
  truePeak: -1.5,
};

export interface VideoProbe {
  streams: {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    avg_frame_rate?: string;
    duration?: string;
    nb_frames?: string;
    sample_rate?: string;
    channels?: number;
  }[];
  format: { duration: string };
}

export function validateVideoProbe(probe: VideoProbe, expectedSeconds: number) {
  const video = probe.streams.filter((stream) => stream.codec_type === "video");
  const audio = probe.streams.filter((stream) => stream.codec_type === "audio");
  const v = video[0],
    a = audio[0];
  const duration = Number(probe.format.duration);
  const videoDuration = Number(v?.duration),
    audioDuration = Number(a?.duration);
  const [numerator, denominator] = (v?.avg_frame_rate ?? "").split("/").map(Number);
  if (
    video.length !== 1 ||
    audio.length !== 1 ||
    v?.codec_name !== "h264" ||
    v.width !== 1080 ||
    v.height !== 1920 ||
    v.pix_fmt !== "yuv420p" ||
    !numerator ||
    !denominator ||
    Math.abs(numerator / denominator - videoFps) > 0.001 ||
    a?.codec_name !== "aac" ||
    a.sample_rate !== "48000" ||
    a.channels !== 2 ||
    !Number.isFinite(duration) ||
    !Number.isFinite(videoDuration) ||
    !Number.isFinite(audioDuration) ||
    !shortDurationAllowed(duration, 0.1) ||
    Math.abs(duration - expectedSeconds) > 0.1 ||
    Math.abs(Number(v.duration) - expectedSeconds) > 0.1 ||
    Math.abs(Number(a.duration) - expectedSeconds) > 0.1 ||
    !Number.isFinite(Number(v.nb_frames)) ||
    Math.abs(Number(v.nb_frames) - Math.ceil(expectedSeconds * videoFps)) > 1
  )
    throw new Error(
      "MP4 verification failed: video/audio format, frame count, or duration differs",
    );
  return {
    durationSeconds: duration,
    width: v.width,
    height: v.height,
    fps: videoFps,
    codec: v.codec_name,
    audioCodec: a.codec_name,
    sampleRate: Number(a.sample_rate),
    channels: a.channels,
    frameCount: Number(v.nb_frames),
  };
}

export function loudnessResult(stderr: string) {
  const block = stderr.match(/\{\s*"input_i"[\s\S]*?\}/u)?.[0];
  if (!block) throw new Error("Audio loudness analysis returned no measurements");
  const values = JSON.parse(block);
  for (const key of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"])
    if (!Number.isFinite(Number(values[key])))
      throw new Error("Audio is silent or has invalid loudness measurements");
  return values as Record<string, string>;
}

export async function verifyRenderSources(sources: Record<string, string>): Promise<void> {
  for (const [name, expected] of Object.entries(sources)) {
    let actual: string | undefined;
    if (name === portraitRuntimeSource) {
      // Workers keep installed models outside their disposable job workspace.
      // Recheck the same runtime and installed engine sources used at render start.
      const { talkingHeadRuntime } = await import("../media/talking-head.js");
      const runtime = await talkingHeadRuntime();
      actual = runtime.installed ? runtime.hash : undefined;
    } else {
      actual = hash(await readFile(await sourceFile(name)));
    }
    if (actual !== expected) throw new Error(`Renderer input changed: ${name}; retry the export`);
  }
}

async function videoPage(episode: ContentEpisode, timing: NarrationTiming): Promise<string> {
  const seconds = timing.durationSeconds;
  const narrator =
    timing.schemaVersion === 2
      ? esc(await episodeVoiceDescription(episode))
      : timing.engine === "kokoro"
        ? "Kokoro"
        : "local";
  const captionNote =
    timing.schemaVersion === 2
      ? "Qwen caption timings use local forced alignment. Stock turns use model timing estimates. Review pronunciation, timing and animation before sharing."
      : "Caption boundaries and syllable visemes use model timing estimates.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'"><title>${esc(episode.title)} · MP4 review</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f7f2;color:#203c36;font:16px/1.6 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:30px 24px}h1{line-height:1.15;letter-spacing:-.04em}video{display:block;max-width:100%;height:75vh;min-height:360px;margin:24px auto;border-radius:20px;background:#102a32}.tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#597365}.links{display:flex;flex-wrap:wrap;gap:18px}a{color:inherit;text-underline-offset:4px}.note{color:#60776e;font-size:14px}details{margin-top:24px}p{max-width:780px}pre{white-space:pre-wrap;font:inherit}@media(max-width:480px){main{padding:20px 14px}video{height:auto;width:100%;min-height:0}}</style></head><body><main><!--LIBRARY_BACK--><span class="tag">SAP Shorts · MP4 export · ${seconds.toFixed(1)} seconds</span><h1>${esc(episode.title)}</h1><p>Vertical video with ${narrator} narration, visible captions, and ${isNewsEpisode(episode) ? "dated SAP announcement cards" : "verified demo visuals"}.</p><video controls playsinline preload="metadata" poster="poster.png" aria-label="${esc(episode.title)} video"><source src="short.mp4" type="video/mp4"></video><div class="links"><a href="presentation.html">Explore interactive presentation</a><a href="short.mp4" download>Download MP4</a><a href="captions.vtt" download>Caption file</a><a href="publication-draft.txt">Companion post draft</a></div><p class="note">AI-generated narration${episode.presentation?.format === "dialogue" ? " and two animated hosts (Mira & Max)" : " and animated presenter avatar"}. ${captionNote}</p><details><summary>Read the transcript</summary>${episode.scenes.map((scene) => `<p><strong>${esc(scene.overlay)}</strong><br>${scene.dialogue ? scene.dialogue.map((turn) => `${esc(episode.presentation?.speakers.find((speaker) => speaker.id === turn.speakerId)?.name ?? "")}: ${esc(turn.text)}`).join("<br>") : esc(scene.narration)}</p>`).join("")}</details><details><summary>Official sources</summary>${episode.sources.map((source) => `<p><a href="${esc(source.url)}">${esc(source.title)}</a></p>`).join("")}</details></main></body></html>`;
}

export async function renderVideo(
  selector: string,
  options: {
    artifactRoot?: string;
    progress?: (message: string) => void;
    mediaJobId?: string;
  } = {},
) {
  const report = options.progress ?? (() => {});
  const artifactRoot = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );
  const episode = await readContentEpisode(selector);
  const { entries } = await collectLibrary(
    [episode],
    artifactRoot,
    new Date(),
    options.mediaJobId ? { [selector]: options.mediaJobId } : {},
  );
  const preview = entries[0]?.preview;
  if (preview?.kind !== "narrated" || !preview.timingReady || !preview.mediaJobId)
    throw new Error(
      "Render needs a matching narrated preview with 15–90 seconds of valid measured audio. Run narrate first.",
    );
  const sourceDirectory = inside(artifactRoot, preview.sourceRunId);
  const source = await loadVerifiedRun(sourceDirectory);
  if (source.manifestHash !== preview.sourceManifestHash)
    throw new Error("Saved narration source changed");
  const timingText = preview.files["timing.json"];
  const audio = preview.files["narration.wav"];
  if (!timingText || !audio) throw new Error("Missing narration files");
  const timing = validateTiming(
    JSON.parse(timingText.toString("utf8")),
    episode,
    readPcmWav(audio).length / 2,
  );
  const layout = validateLayout(
    JSON.parse(await readFile(resolve(sourceDirectory, "video-layout.json"), "utf8")),
  );
  const versions: Record<string, string> = {};
  for (const binary of ["ffmpeg", "ffprobe"]) {
    try {
      versions[binary] =
        (await exec(binary, ["-version"], { timeout: 5000 })).stdout.split("\n")[0] ?? "";
    } catch {
      throw new Error(`${binary} is required for MP4 export. Install FFmpeg, then retry.`);
    }
  }
  const code: Record<string, string> = {};
  for (const scene of episode.scenes) {
    if ("codePath" in scene.visual && scene.visual.codePath) {
      const bytes = await readFile(await sourceFile(scene.visual.codePath));
      if (hash(bytes) !== source.manifest.sourceHashes[scene.visual.codePath])
        throw new Error("Demo source changed; regenerate the verified preview before rendering");
      code[scene.visual.codePath] = bytes.toString("utf8");
    }
  }
  const renderSources: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(await readRuntimeFiles()))
    renderSources[name] = hash(bytes);
  for (const name of [...videoFontFiles, ...presentationAssets, "package-lock.json"])
    renderSources[name] = hash(await readFile(await sourceFile(name)));
  if (episode.presentation?.speakers.some((speaker) => speaker.avatar?.animation === "neural")) {
    const { talkingHeadRuntime } = await import("../media/talking-head.js");
    const runtime = await talkingHeadRuntime();
    if (!runtime.installed || !runtime.hash)
      throw new Error(
        "Realistic portraits require npm run shorts -- talking-head-setup before rendering.",
      );
    renderSources[portraitRuntimeSource] = runtime.hash;
  }
  for (const speaker of episode.presentation?.speakers ?? []) {
    if (speaker.avatar?.mode === "photo" && speaker.avatar.imageId) {
      const { resolveAvatarPath } = await import("../media/avatar.js");
      const avatarPath = await resolveAvatarPath(speaker.avatar.imageId);
      renderSources[`assets/avatars/${speaker.avatar.imageId}`] = hash(await readFile(avatarPath));
    }
  }
  const sourceAudioHash = hash(audio);
  const sourceCodeCommit = isNewsEpisode(episode)
    ? null
    : await publishedDemoCommit(demos[episode.demo.id].files, source.manifest.sourceHashes);
  const key = hash(
    JSON.stringify({
      inputHash: source.manifest.inputHash,
      sourceManifestHash: source.manifestHash,
      mediaJobId: preview.mediaJobId,
      sourceAudioHash,
      timingHash: hash(timingText),
      layout,
      encoding,
      versions,
      renderSources,
      sourceCodeCommit,
    }),
  );
  const directory = await videoCacheDirectory(artifactRoot, selector, key);
  try {
    const saved = await readVideoReceipt(directory);
    if (saved.receipt.renderKey !== key) throw new Error("Saved render key differs");
    assertVideoQuality(saved.receipt.quality, timing.durationSeconds);
    report("Reusing the verified MP4.");
    return { directory, reused: true, receipt: saved.receipt };
  } catch {
    /* A locked recovery pass below preserves invalid local exports. */
  }
  const releaseGate = await acquireVideoGate(directory);
  try {
    const lock = resolve(directory, "export.lock");
    const lockOwner = { pid: process.pid, host: hostname(), token: randomUUID() };
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(JSON.stringify(lockOwner));
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await lstat(lock);
      if (!lockStat.isFile() || lockStat.size > 4096)
        throw new Error("This MP4 has an invalid export lock; inspect it before retrying");
      const owner = JSON.parse(await readFile(lock, "utf8"));
      let stopped = false;
      if (owner.host === hostname() && Number.isSafeInteger(owner.pid)) {
        try {
          process.kill(owner.pid, 0);
        } catch (failure) {
          stopped = (failure as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
      if (!stopped) throw new Error("This MP4 is already being rendered by another worker");
      await rm(lock);
      const handle = await open(lock, "wx");
      await handle.writeFile(JSON.stringify(lockOwner));
      await handle.close();
    }
    let recovered: Awaited<ReturnType<typeof recoverVideoCache>>;
    try {
      recovered = await recoverVideoCache(directory, key, lockOwner.token, timing.durationSeconds);
      if (recovered.recoveryDirectory)
        report(`Preserved the previous export for recovery: ${recovered.recoveryDirectory}`);
      if (!recovered.saved) await mkdir(resolve(directory, "frames"));
    } catch (error) {
      await releaseVideoLock(directory, lockOwner.token);
      throw error;
    }
    if (recovered.saved) {
      report("Reusing the verified MP4.");
      await releaseVideoLock(directory, lockOwner.token);
      return { directory, reused: true, receipt: recovered.saved.receipt };
    }
    const manifest = {
      schemaVersion: 1,
      stage: "RENDERING",
      renderKey: key,
      selector,
      inputHash: source.manifest.inputHash,
      sourceManifestHash: source.manifestHash,
      sourceRunId: preview.sourceRunId,
      mediaJobId: preview.mediaJobId,
      sourceAudioHash,
      sourceCodeCommit,
      encoding,
      versions,
      renderSources,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      costCents: 0,
      stockAvatar: "pending",
      published: false,
      quality: {} as Record<string, unknown>,
      artifactHashes: {} as Record<string, string>,
      error: null as string | null,
    };
    const save = async () => {
      manifest.updatedAt = new Date().toISOString();
      await writeFile(
        resolve(directory, "video-manifest.tmp"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await rename(
        resolve(directory, "video-manifest.tmp"),
        resolve(directory, "video-manifest.json"),
      );
    };
    const command = async (name: string, binary: string, args: string[], timeout = 180000) => {
      try {
        const result = await exec(binary, args, {
          cwd: directory,
          timeout,
          maxBuffer: 4 * 1024 * 1024,
        });
        await writeFile(resolve(directory, `${name}.log`), `${result.stdout}\n${result.stderr}`);
        return result;
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string };
        await writeFile(
          resolve(directory, `${name}.log`),
          `${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
        );
        throw new Error(`Video ${name} failed; see the saved diagnostic log`, { cause: error });
      }
    };
    try {
      await save();
      const evidence = !isNewsEpisode(episode)
        ? (JSON.parse(
            await readFile(resolve(sourceDirectory, "demo-evidence.json"), "utf8"),
          ) as DemoEvidence)
        : undefined;
      const input: VideoFrameInput = {
        episode,
        timing,
        layout,
        code,
        ...(evidence ? { evidence } : {}),
      };
      const moments = videoTimeline(timing, { animateAvatar: true });
      const totalVideoFrames = Math.max(moments.length, moments.at(-1)?.endFrame ?? moments.length);
      const talkingHeadSequences: NonNullable<VideoFrameInput["talkingHeadSequences"]> = {};
      for (const speaker of episode.presentation?.speakers ?? []) {
        if (speaker.avatar?.mode === "photo" && speaker.avatar.animation === "neural") {
          const { prepareTalkingHeadSequence } = await import("../media/talking-head.js");
          const seq = await prepareTalkingHeadSequence({
            speakerId: speaker.id,
            avatar: speaker.avatar,
            wavBytes: audio,
            cues: timing.cues,
            frameCount: totalVideoFrames,
            fps: videoFps,
            progress: report,
          });
          if (seq) talkingHeadSequences[speaker.id] = seq;
        }
      }
      if (Object.keys(talkingHeadSequences).length > 0) {
        input.talkingHeadSequences = talkingHeadSequences;
      }
      report(`Drawing ${moments.length} animated avatar, caption, and scene frames.`);
      const batchSize = 8;
      for (let start = 0; start < moments.length; start += batchSize) {
        const batch = moments.slice(start, start + batchSize);
        await Promise.all(
          batch.map(async (moment, offset) => {
            const index = start + offset;
            await writeFile(
              resolve(directory, "frames", `frame-${String(index).padStart(4, "0")}.png`),
              await drawVideoFrame(input, moment),
            );
          }),
        );
      }
      await writeFile(resolve(directory, "timeline.ffconcat"), concatTimeline(moments));
      await writeFile(resolve(directory, "source-narration.wav"), audio);
      report("Measuring narration volume.");
      const analysis = loudnessResult(
        (
          await command("input-loudness", "ffmpeg", [
            "-hide_banner",
            "-nostdin",
            "-i",
            "source-narration.wav",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
            "-f",
            "null",
            "-",
          ])
        ).stderr,
      );
      const filter = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${analysis.input_i}:measured_TP=${analysis.input_tp}:measured_LRA=${analysis.input_lra}:measured_thresh=${analysis.input_thresh}:offset=${analysis.target_offset}:linear=true`;
      report("Encoding the vertical MP4.");
      await command("encode", "ffmpeg", [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        "timeline.ffconcat",
        "-i",
        "source-narration.wav",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        "fps=30,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "19",
        "-threads",
        "4",
        "-r",
        "30",
        "-af",
        filter,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-t",
        timing.durationSeconds.toFixed(9),
        "-movflags",
        "+faststart",
        "short.tmp.mp4",
      ]);
      manifest.stage = "VERIFYING";
      await save();
      report("Checking video format, complete decoding, and audio levels.");
      const probe = JSON.parse(
        (
          await command("probe", "ffprobe", [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            "short.tmp.mp4",
          ])
        ).stdout,
      ) as VideoProbe;
      const quality = validateVideoProbe(probe, timing.durationSeconds);
      await command("decode", "ffmpeg", [
        "-v",
        "error",
        "-xerror",
        "-nostdin",
        "-i",
        "short.tmp.mp4",
        "-f",
        "null",
        "-",
      ]);
      const outputAudio = loudnessResult(
        (
          await command("output-loudness", "ffmpeg", [
            "-hide_banner",
            "-nostdin",
            "-i",
            "short.tmp.mp4",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
            "-f",
            "null",
            "-",
          ])
        ).stderr,
      );
      if (Math.abs(Number(outputAudio.input_i) + 16) > 1.5 || Number(outputAudio.input_tp) > -0.5)
        throw new Error("MP4 narration volume is outside the review range");
      const after = await loadVerifiedRun(sourceDirectory);
      if (after.manifestHash !== preview.sourceManifestHash)
        throw new Error("Source changed during MP4 rendering");
      await verifyRenderSources(renderSources);
      await rename(resolve(directory, "short.tmp.mp4"), resolve(directory, "short.mp4"));
      await writeFile(
        resolve(directory, "poster.png"),
        await drawVideoFrame(input, {
          ...(moments[0] as NonNullable<(typeof moments)[0]>),
          cueIndex: 0,
        }),
      );
      await writeFile(resolve(directory, "timing.json"), timingText);
      await writeFile(resolve(directory, "captions.vtt"), preview.files["captions.vtt"] as Buffer);
      await writeFile(resolve(directory, "review.html"), await videoPage(episode, timing));
      const deckFiles = await createPresentationDeck({ ...input, audioSrc: "short.mp4" });
      for (const [name, contents] of Object.entries(deckFiles))
        await writeFile(resolve(directory, name), contents);
      const publicationText = sourceCodeCommit
        ? episode.publication.text.replace(
            "Code link pending repository publication",
            `https://github.com/Moty/sap-developer-shorts/tree/${sourceCodeCommit}/demos/cap/inventory`,
          )
        : episode.publication.text;
      await writeFile(
        resolve(directory, "publication-draft.txt"),
        `${publicationText}\n\nProduction note: AI-generated narration${episode.presentation?.format === "dialogue" ? " with fictional AI hosts" : ""}.\n`,
      );
      for (const name of [
        "short.mp4",
        "poster.png",
        "review.html",
        "captions.vtt",
        "timing.json",
        "publication-draft.txt",
        "presentation.html",
        "presentation.json",
        "reveal-LICENSE.txt",
      ])
        manifest.artifactHashes[name] = hash(await readFile(resolve(directory, name)));
      manifest.quality = {
        ...quality,
        decoded: true,
        audioChecked: true,
        integratedLufs: Number(outputAudio.input_i),
        truePeakDb: Number(outputAudio.input_tp),
        captions: timing.alignment ?? "measured-phrase-boundaries",
        captionFrameToleranceSeconds: 1 / videoFps,
        burnInCaptions: true,
      };
      manifest.stage = "READY";
      await save();
      report("MP4 verified and ready for review.");
      return { directory, reused: false, receipt: manifest };
    } catch (error) {
      manifest.stage = "FAILED";
      manifest.error = error instanceof Error ? error.message : "Video export failed";
      await save();
      throw error;
    } finally {
      await releaseVideoLock(directory, lockOwner.token);
    }
  } finally {
    releaseGate();
  }
}
