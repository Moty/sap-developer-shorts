import type { ContentEpisode } from "../domain.js";
import type { NarrationTiming } from "../media/model.js";
import { videoFps } from "./timeline.js";

export function sceneMotion(
  episode: ContentEpisode,
  timing: NarrationTiming,
  sceneIndex: number,
  frame: number,
) {
  const scene = timing.scenes[sceneIndex] ?? episode.scenes[sceneIndex];
  if (!scene) throw new Error("Missing motion scene");
  const elapsed = Math.max(0, (frame + 0.5) / videoFps - scene.startSeconds);
  const duration = scene.endSeconds - scene.startSeconds;
  const linear = Math.max(0, Math.min(1, elapsed / 0.5));
  const enter = 1 - (1 - linear) ** 3;
  return {
    elapsed,
    enter,
    progress: Math.min(1, elapsed / Math.max(0.01, duration)),
    offsetY: 24 * (1 - enter),
    opacity: 0.7 + 0.3 * enter,
  };
}
export function storySteps(episode: ContentEpisode) {
  return episode.scenes
    .map((scene, index) => ({ index, label: scene.overlay, phase: scene.phase }))
    .filter((scene) => ["demo", "headline", "payoff"].includes(scene.phase))
    .slice(0, 3);
}
