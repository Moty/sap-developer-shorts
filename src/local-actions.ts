import { randomUUID } from "node:crypto";
import { withModelLock } from "./media/model-lock.js";
import { kokoroVoice } from "./media/voices.js";

const actionNames = [
  "voice-audition",
  "voice-install",
  "voice-default",
  "face-setup",
  "portrait-setup",
  "clone-setup",
] as const;
export type LocalActionName = (typeof actionNames)[number];
export interface LocalAction {
  action: LocalActionName;
  voice?: string;
}
export interface LocalActionResult {
  message: string;
  audio?: Buffer;
  durationSeconds?: number;
  selected?: string;
  libraryUpdated?: boolean;
  warning?: string;
}
export type LocalActionRunner = (
  input: LocalAction,
  progress: (message: string) => void,
) => Promise<LocalActionResult>;

export function parseLocalAction(value: unknown): LocalAction {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a supported studio action.");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== "action" && key !== "voice") ||
    !actionNames.includes(input.action as LocalActionName)
  )
    throw new Error("Choose a supported studio action.");
  const action = input.action as LocalActionName;
  if (action.startsWith("voice-")) {
    if (typeof input.voice !== "string") throw new Error("Choose a supported stock voice.");
    kokoroVoice(input.voice);
    return { action, voice: input.voice };
  }
  if (input.voice !== undefined) throw new Error("This setup does not take a voice selection.");
  return { action };
}

export async function runLocalAction(
  input: LocalAction,
  progress: (message: string) => void,
  artifactRoot?: string,
): Promise<LocalActionResult> {
  return withModelLock(async () => {
    switch (input.action) {
      case "voice-audition": {
        progress("Generating the comparison passage. The sample will be saved on this Mac.");
        const { createVoiceAudition } = await import("./media/voice-audition.js");
        const { productionSettings } = await import("./media/worker.js");
        const { sample, reused } = await createVoiceAudition(
          input.voice as string,
          await productionSettings(),
          artifactRoot ? { artifactRoot } : {},
        );
        return {
          message: reused
            ? "Saved voice sample is ready to play."
            : "Voice sample generated and saved.",
          audio: sample.audio,
          durationSeconds: sample.durationSeconds,
        };
      }
      case "voice-install": {
        progress(
          "Installing the selected voice and checking local voice tools. This can take several minutes.",
        );
        const { setupNeuralVoice } = await import("./media/neural.js");
        await setupNeuralVoice([input.voice as string]);
        return { message: "Voice installed. Generate a sample to hear it." };
      }
      case "voice-default": {
        const { neuralRuntime } = await import("./media/neural.js");
        const { selectNarrator } = await import("./media/voice-selection.js");
        await neuralRuntime([input.voice as string]);
        const { selected } = await selectNarrator(input.voice as string);
        return {
          message: "Default narrator saved. Prepared scripts keep their own speaker choices.",
          selected,
        };
      }
      case "face-setup": {
        progress("Downloading and checking the face alignment model.");
        const { setupFaceLandmarker } = await import("./media/face-assets.js");
        await setupFaceLandmarker();
        return { message: "Face alignment is ready. Try automatic alignment again." };
      }
      case "portrait-setup": {
        progress(
          "Installing realistic portrait tools and model files. This can take several minutes.",
        );
        const { setupTalkingHead } = await import("./media/talking-head.js");
        await setupTalkingHead();
        return { message: "Realistic portrait rendering is ready." };
      }
      case "clone-setup": {
        progress("Installing personal voice tools and model files. This can take several minutes.");
        const { setupQwenVoice } = await import("./media/qwen.js");
        await setupQwenVoice();
        return { message: "Personal voice tools are ready. Reopen My voice to continue." };
      }
    }
  });
}

interface ActionJob extends LocalAction {
  id: string;
  state: "RUNNING" | "SUCCEEDED" | "FAILED";
  message: string;
  startedAt: string;
  completedAt?: string;
  result?: LocalActionResult;
}

/** One bounded action at a time, with status retained while the user navigates. */
export class LocalActionManager {
  private readonly jobs = new Map<string, ActionJob>();
  private current: ActionJob | undefined;
  constructor(private readonly run: LocalActionRunner) {}
  get busy() {
    return this.current?.state === "RUNNING";
  }
  latest() {
    return this.current ? this.view(this.current) : null;
  }
  get(id: string) {
    const job = this.jobs.get(id);
    return job ? this.view(job) : null;
  }
  audio(id: string) {
    const job = this.jobs.get(id);
    return job?.state === "SUCCEEDED" ? job.result?.audio : undefined;
  }
  start(input: LocalAction) {
    if (this.busy) {
      if (this.current?.action === input.action && this.current.voice === input.voice)
        return this.view(this.current);
      throw new Error("Another studio action is running. Wait for it to finish.");
    }
    const job: ActionJob = {
      ...input,
      id: randomUUID(),
      state: "RUNNING",
      message: "Starting on this Mac…",
      startedAt: new Date().toISOString(),
    };
    this.current = job;
    this.jobs.set(job.id, job);
    while (this.jobs.size > 20) this.jobs.delete(this.jobs.keys().next().value as string);
    void Promise.resolve().then(async () => {
      try {
        job.result = await this.run(input, (message) => {
          job.message = message;
        });
        job.state = "SUCCEEDED";
        job.message = job.result.message;
      } catch (error) {
        job.state = "FAILED";
        job.message = error instanceof Error ? error.message : "Studio action could not finish.";
      } finally {
        job.completedAt = new Date().toISOString();
      }
    });
    return this.view(job);
  }
  private view(job: ActionJob) {
    const { result, ...view } = job;
    return {
      ...view,
      ...(result
        ? {
            result: {
              message: result.message,
              durationSeconds: result.durationSeconds,
              selected: result.selected,
              libraryUpdated: result.libraryUpdated,
              warning: result.warning,
              ...(result.audio ? { audioUrl: `/api/local-actions/${job.id}/audio` } : {}),
            },
          }
        : {}),
    };
  }
}
