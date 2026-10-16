import type { NarrationTiming } from "../media/model.js";

export const videoFps = 30;
export interface VideoMoment {
  startFrame: number;
  endFrame: number;
  sceneIndex: number;
  cueIndex: number | null;
}

export function videoTimeline(
  timing: NarrationTiming,
  options?: { animateAvatar?: boolean },
): VideoMoment[] {
  const total = Math.ceil(timing.durationSeconds * videoFps);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Invalid video duration");
  const frame = (seconds: number) => Math.min(total, Math.max(0, Math.ceil(seconds * videoFps)));
  const avatarSteps: number[] = [];
  if (options?.animateAvatar) {
    const stepFrames = 5; // 6 Hz syllable & viseme cadence at 30 fps
    for (const cue of timing.cues) {
      const start = frame(cue.startSeconds);
      const end = frame(cue.endSeconds);
      for (let f = start + stepFrames; f < end; f += stepFrames) {
        avatarSteps.push(f);
      }
    }
  }
  const boundaries = [
    ...new Set([
      0,
      total,
      ...timing.scenes.flatMap((scene) => [frame(scene.startSeconds), frame(scene.endSeconds)]),
      ...timing.cues.flatMap((cue) => [frame(cue.startSeconds), frame(cue.endSeconds)]),
      ...avatarSteps,
    ]),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const time = (start + 0.5) / videoFps;
    const sceneIndex = timing.scenes.findIndex(
      (scene) =>
        time >= scene.startSeconds && (time < scene.endSeconds || scene === timing.scenes.at(-1)),
    );
    if (sceneIndex < 0) throw new Error("Video timeline has an uncovered scene");
    const cueIndex = timing.cues.findIndex(
      (cue) => time >= cue.startSeconds && time < cue.endSeconds,
    );
    return {
      startFrame: start,
      endFrame: boundaries[index + 1] as number,
      sceneIndex,
      cueIndex: cueIndex < 0 ? null : cueIndex,
    };
  });
}

export function concatTimeline(moments: VideoMoment[]): string {
  const file = (index: number) => `frames/frame-${String(index).padStart(4, "0")}.png`;
  return `ffconcat version 1.0\n${moments.map((moment, index) => `file '${file(index)}'\noption framerate ${videoFps}\nduration ${((moment.endFrame - moment.startFrame) / videoFps).toFixed(9)}\n`).join("")}file '${file(moments.length - 1)}'\noption framerate ${videoFps}\n`;
}
