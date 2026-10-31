import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "./digest.js";
import { type DemoEvidence, isNewsEpisode } from "./domain.js";
import { readLayout } from "./layout.js";
import type { NarrationTiming } from "./media/model.js";
import { loadVerifiedRun } from "./media/worker.js";
import { inside, projectRoot, sourceFile } from "./paths.js";
import { validatePresentationDefinition } from "./variants.js";
import { drawVideoFrame } from "./video/frames.js";
import { readWorkflowManifest } from "./workflow.js";

let previewBusy = false;
export async function visualPreview(value: unknown, directory: string, artifactRoot?: string) {
  if (previewBusy)
    throw new Error("A visual preview is already being drawn. Try again in a moment.");
  const body = value as {
    definition?: unknown;
    selector?: unknown;
    sceneIndex?: unknown;
    progress?: unknown;
  };
  if (
    !body ||
    Object.keys(body).some(
      (key) => !["definition", "selector", "sceneIndex", "progress"].includes(key),
    ) ||
    typeof body.selector !== "string" ||
    typeof body.sceneIndex !== "number" ||
    !Number.isInteger(body.sceneIndex) ||
    body.sceneIndex < 0 ||
    body.sceneIndex > 6 ||
    typeof body.progress !== "number" ||
    !Number.isFinite(body.progress) ||
    body.progress < 0 ||
    body.progress > 0.98
  )
    throw new Error("Choose a scene and a valid preview position.");
  previewBusy = true;
  try {
    const { episode } = await validatePresentationDefinition(body.definition);
    const manifest = await readWorkflowManifest(directory);
    const saved = manifest.episodes.find((item) => item.selector === body.selector);
    if (!saved || body.selector.split("@")[0] !== episode.id)
      throw new Error("Open a matching episode in the current studio.");
    const code: Record<string, string> = {};
    for (const scene of episode.scenes)
      if ("codePath" in scene.visual && scene.visual.codePath)
        code[scene.visual.codePath] = await readFile(
          await sourceFile(scene.visual.codePath),
          "utf8",
        );
    let evidence: DemoEvidence | undefined;
    const sourceRunId = (saved.preview as { sourceRunId?: string } | null)?.sourceRunId;
    if (
      !isNewsEpisode(episode) &&
      sourceRunId &&
      /^[A-Z]+-\d{2}-v\d+-[a-f0-9-]+$/u.test(sourceRunId)
    ) {
      try {
        const root = resolve(
          projectRoot,
          artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
        );
        const run = await loadVerifiedRun(inside(root, sourceRunId), { requireFreshNews: false });
        if (
          Object.entries(code).every(
            ([path, text]) => run.manifest.sourceHashes[path] === hash(text),
          )
        )
          evidence = JSON.parse(
            await readFile(resolve(root, sourceRunId, "demo-evidence.json"), "utf8"),
          );
      } catch {
        /* A design preview never invents missing captured evidence. */
      }
    }
    const timing: NarrationTiming = {
      schemaVersion: 1,
      mode: "local-preview",
      voice: "af_heart",
      rate: 155,
      sampleRate: 22050,
      durationSeconds: episode.targetDurationSeconds,
      scenes: episode.scenes.map((scene) => ({
        id: scene.id,
        startSeconds: scene.startSeconds,
        endSeconds: scene.endSeconds,
        speechSeconds: scene.endSeconds - scene.startSeconds,
      })),
      cues: [],
    };
    const scene = episode.scenes[body.sceneIndex];
    if (!scene) throw new Error("Scene not found.");
    const frame = Math.round(
      (scene.startSeconds + (scene.endSeconds - scene.startSeconds) * body.progress) * 30,
    );
    const bytes = await drawVideoFrame(
      {
        episode,
        code,
        timing,
        layout: (await readLayout()).layout,
        ...(evidence ? { evidence } : {}),
      },
      { sceneIndex: body.sceneIndex, startFrame: frame, endFrame: frame + 1, cueIndex: null },
    );
    return {
      imageDataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      note: `Visual preview at planned scene time. No new speech or portrait inference.${evidence ? " Uses a verified saved demo capture." : " No verified demo capture is available in this preview."}`,
    };
  } finally {
    previewBusy = false;
  }
}
