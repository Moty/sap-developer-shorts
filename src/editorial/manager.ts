import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { readContentEpisode, validateEpisode, words } from "../contracts.js";
import { hash } from "../digest.js";
import { isNewsEpisode } from "../domain.js";
import { withModelLock } from "../media/model-lock.js";
import { validateNewsEpisode } from "../news/contracts.js";
import { sourceFile } from "../paths.js";
import { createPresentationDeck } from "../presentation-deck.js";
import { parsePresentationDesign } from "../presentation-design.js";
import { assertPresentationDesignFits } from "../video/frames.js";
import {
  applyFinalReviewFixes,
  type FinalReview,
  finalReviewOutcome,
  finalReviewResponseSchema,
} from "./final-review.js";
import { writingJobLease } from "./job-lock.js";
import {
  type ChatResult,
  type JsonTransport,
  WritingError,
  writingCatalog,
  writingCompletion,
} from "./providers.js";
import {
  defaultWritingSettings,
  editorialRoot,
  readWritingSettings,
  saveWritingSettings,
  type WritingProvider,
  type WritingSecrets,
  type WritingSettings,
  writingSecrets,
} from "./settings.js";
import {
  applyWritingProposal,
  episodeWithWritingSnapshot,
  finalReviewFingerprint,
  parseWritingInput,
  parseWritingResult,
  validateWritingSnapshot,
  type WritingInput,
  type WritingProposal,
  type WritingResult,
  writingMessages,
  writingPromptVersion,
} from "./workflow.js";

export interface WritingJob {
  schemaVersion: 1;
  id: string;
  requestId: string;
  inputHash: string;
  selector: string;
  sourceHash: string;
  snapshotHash: string;
  settingsHash: string;
  provider: WritingProvider;
  model: string;
  action: WritingInput["action"];
  promptVersion: string;
  state: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "INTERRUPTED";
  message: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  stages: {
    name: string;
    seconds: number;
    state: "running" | "complete" | "failed" | "canceled" | "interrupted";
    startedAt: string;
    submitted: boolean;
    usage?: ChatResult["usage"];
    checks?: string;
  }[];
  result?: WritingResult;
  warning?: string;
  errorCode?: string;
  finalReviewHash?: string;
  outputTokenLimit?: number | null;
}
export interface WritingManagerOptions {
  directory?: string;
  secrets?: WritingSecrets;
  transport?: JsonTransport;
  readEpisode?: typeof readContentEpisode;
  lock?: typeof withModelLock;
}
export class WritingManager {
  private readonly directory: string;
  private readonly secrets: WritingSecrets;
  private readonly jobs = new Map<string, WritingJob>();
  private current:
    | {
        job: WritingJob;
        abort: AbortController;
        lease: DatabaseSync;
        cancelTimer: ReturnType<typeof setInterval>;
      }
    | undefined;
  private initialized?: Promise<void>;
  private writes = Promise.resolve();
  constructor(private readonly options: WritingManagerOptions = {}) {
    this.directory = options.directory ?? editorialRoot;
    this.secrets = options.secrets ?? writingSecrets;
  }
  get localBusy() {
    return this.current?.job.provider === "local";
  }
  get busy() {
    return this.current?.job.state === "RUNNING";
  }
  get active() {
    return this.current
      ? { id: this.current.job.id, local: this.localBusy, state: this.current.job.state }
      : null;
  }
  private async initialize() {
    if (!this.initialized)
      this.initialized = (async () => {
        const directory = resolve(this.directory, "jobs");
        await mkdir(directory, { recursive: true, mode: 0o700 });
      })();
    await this.initialized;
  }
  private async refreshJobs(ownedLease = false) {
    const directory = resolve(this.directory, "jobs");
    const files = (await readdir(directory)).filter((name) => /^[a-f0-9-]{36}\.json$/u.test(name));
    for (const name of files) {
      try {
        let job = JSON.parse(await readFile(resolve(directory, name), "utf8")) as WritingJob;
        if (job.schemaVersion !== 1 || `${job.id}.json` !== name || !Array.isArray(job.stages))
          continue;
        if (this.current?.job.id === job.id) continue;
        if (job.state === "RUNNING") {
          let lease: DatabaseSync | undefined;
          try {
            if (!ownedLease) lease = writingJobLease(this.directory);
          } catch (error) {
            if (!(error instanceof WritingError && error.code === "BUSY")) throw error;
          }
          if (ownedLease || lease) {
            try {
              job = JSON.parse(await readFile(resolve(directory, name), "utf8")) as WritingJob;
              if (job.state === "RUNNING") {
                job.state = "INTERRUPTED";
                job.message =
                  "Studio restarted before completion. The provider may have processed the request. Start a new request explicitly; it was not retried.";
                for (const stage of job.stages)
                  if (stage.state === "running") stage.state = "interrupted";
                job.completedAt = job.updatedAt = new Date().toISOString();
                await this.persist(job);
              }
            } finally {
              lease?.close();
            }
          }
        }
        this.jobs.set(job.id, job);
      } catch {
        /* An unreadable old receipt must not remove other writing results. */
      }
    }
  }
  private persist(job: WritingJob) {
    const bytes = `${JSON.stringify(job, null, 2)}\n`;
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        const path = resolve(this.directory, "jobs", `${job.id}.json`);
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, path);
      });
    this.writes = task;
    return task;
  }
  async status() {
    await this.initialize();
    await this.refreshJobs();
    let settings = structuredClone(defaultWritingSettings);
    let settingsIssue: string | undefined;
    try {
      settings = await readWritingSettings(this.directory);
    } catch {
      settingsIssue =
        "Saved writing settings could not be read. Review the setup defaults and save them again. No generation will use them until settings are saved.";
    }
    return {
      settings,
      ...(settingsIssue ? { settingsIssue } : {}),
      settingsHash: hash(JSON.stringify(settings)),
      keyConfigured: Boolean(await this.secrets.get()),
      credentialFromEnvironment: Boolean(process.env.SHORTS_HYPERSPACE_API_KEY),
      jobs: [...this.jobs.values()]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 12),
      capabilities: {
        ideas: true,
        rewrite: true,
        presentation: true,
        scriptReview: true,
        finalReview: true,
        proxySpeech: false,
      },
    };
  }
  async configure(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Choose writing settings.");
    const input = value as { settings?: unknown; apiKey?: unknown; forgetKey?: unknown };
    if (
      Object.keys(input).some((key) => !["settings", "apiKey", "forgetKey"].includes(key)) ||
      (input.apiKey !== undefined && typeof input.apiKey !== "string") ||
      (input.forgetKey !== undefined && typeof input.forgetKey !== "boolean") ||
      (input.apiKey !== undefined && input.forgetKey === true)
    )
      throw new Error("Use the writing setup controls.");
    // Validate settings before changing a credential.
    const { parseWritingSettings } = await import("./settings.js");
    const settings = parseWritingSettings(input.settings);
    if ((input.apiKey !== undefined || input.forgetKey) && process.env.SHORTS_HYPERSPACE_API_KEY)
      throw new Error(
        "The proxy key comes from SHORTS_HYPERSPACE_API_KEY. Remove that server override to manage it in the UI.",
      );
    if (input.apiKey !== undefined) await this.secrets.set(input.apiKey);
    if (input.forgetKey) await this.secrets.remove();
    await saveWritingSettings(settings, this.directory);
    return { ...(await this.status()), settings, settingsHash: hash(JSON.stringify(settings)) };
  }
  async catalog(provider: WritingProvider, value?: unknown) {
    const { parseWritingSettings } = await import("./settings.js");
    const settings =
      value === undefined ? await readWritingSettings(this.directory) : parseWritingSettings(value);
    return writingCatalog(
      settings,
      provider,
      provider === "hyperspace" ? await this.secrets.get() : undefined,
      this.options.transport,
    );
  }
  async get(id: string) {
    await this.initialize();
    await this.refreshJobs();
    return this.jobs.get(id);
  }
  private async reviewedInput(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Use the current editor content.");
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["selector", "sourceHash", "snapshot"].includes(key)))
      throw new Error("Use the current editor content.");
    const input = parseWritingInput({
      ...body,
      requestId: randomUUID(),
      settingsHash: "0".repeat(64),
      action: "final-review",
      style: "conversational",
      instruction: "",
      allowRemote: false,
    });
    const episode = await (this.options.readEpisode ?? readContentEpisode)(input.selector);
    validateWritingSnapshot(input, episode);
    return { input, episode, fingerprint: finalReviewFingerprint(episode, input.snapshot) };
  }
  async finalReviewStatus(value: unknown) {
    await this.initialize();
    await this.refreshJobs();
    const { input, fingerprint } = await this.reviewedInput(value);
    const jobs = [...this.jobs.values()]
      .filter(
        (job) =>
          job.action === "final-review" &&
          job.state === "SUCCEEDED" &&
          job.result &&
          job.finalReviewHash,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const matching = jobs.find((job) => job.finalReviewHash === fingerprint);
    const previous = jobs.find(
      (job) => job.selector.split("@")[0] === input.selector.split("@")[0],
    );
    const job = matching ?? previous;
    return {
      state: matching ? "current" : previous ? "outdated" : "not-reviewed",
      fingerprint,
      ...(job
        ? { job: structuredClone(job), outcome: finalReviewOutcome(job.result as FinalReview) }
        : {}),
    };
  }
  async finalReviewFixes(id: string, value: unknown) {
    await this.initialize();
    await this.refreshJobs();
    const job = this.jobs.get(id);
    if (
      job?.state !== "SUCCEEDED" ||
      job.action !== "final-review" ||
      !job.result ||
      !job.finalReviewHash
    )
      throw new Error("No completed final review is available for these edits.");
    const { input, episode, fingerprint } = await this.reviewedInput(value);
    if (job.finalReviewHash !== fingerprint)
      throw new WritingError(
        "CONFLICT",
        "Reviewed content changed. Run final review again before applying fixes.",
      );
    const fixes = (job.result as FinalReview).issues.flatMap((issue) =>
      issue.fix ? [issue.fix] : [],
    );
    const snapshot = applyFinalReviewFixes(input.snapshot, fixes);
    const copy = episodeWithWritingSnapshot(episode, snapshot);
    if (words(copy.scenes.map((scene) => scene.narration).join(" ")) > 270)
      throw new Error(
        "The proposed fixes exceed the short's 270-word draft budget. Shorten the wording before applying.",
      );
    if (isNewsEpisode(copy)) validateNewsEpisode(copy);
    else validateEpisode(copy);
    await assertPresentationDesignFits(copy);
    return { fixes: structuredClone(fixes), snapshot };
  }
  async proposal(id: string, value: unknown) {
    await this.initialize();
    await this.refreshJobs();
    const job = this.jobs.get(id);
    if (
      job?.state !== "SUCCEEDED" ||
      !["rewrite", "presentation"].includes(job.action) ||
      !job.result ||
      !("scenes" in job.result)
    )
      throw new Error("This request has no ready proposal.");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Use this script's editor to apply a proposal.");
    const body = value as { selector?: unknown; sourceHash?: unknown; snapshot?: unknown };
    if (
      Object.keys(body).some((key) => !["selector", "sourceHash", "snapshot"].includes(key)) ||
      body.selector !== job.selector ||
      body.sourceHash !== job.sourceHash
    )
      throw new Error(
        "This proposal belongs to a different script or source version. Open its matching editor to apply it.",
      );
    const input = parseWritingInput({
      requestId: job.requestId,
      selector: body.selector,
      sourceHash: body.sourceHash,
      settingsHash: job.settingsHash,
      snapshot: body.snapshot,
      action: "rewrite",
      style: "conversational",
      instruction: "",
      allowRemote: false,
    });
    if (hash(JSON.stringify(input.snapshot)) !== job.snapshotHash)
      throw new Error(
        "The script wording changed after this request started. Keep your edits and generate a new proposal, or compare the old result without applying it.",
      );
    const episode = await (this.options.readEpisode ?? readContentEpisode)(job.selector);
    validateWritingSnapshot(input, episode);
    if (job.action === "presentation") {
      const copy = structuredClone(episode);
      copy.presentation = {
        ...(copy.presentation ?? {
          tone: "professional",
          format: "explainer",
          humor: "none",
          speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
        }),
        design: parsePresentationDesign(
          job.result,
          copy.scenes.map((scene) => scene.id),
        ),
      };
      await assertPresentationDesignFits(copy);
    }
    return { proposal: structuredClone(job.result) };
  }
  async preview(id: string, value: unknown) {
    const { proposal } = await this.proposal(id, value);
    const job = await this.get(id);
    if (job?.action !== "presentation")
      throw new Error("Choose a presentation proposal to preview.");
    const body = value as { snapshot: WritingInput["snapshot"] };
    const original = await (this.options.readEpisode ?? readContentEpisode)(job.selector);
    // Recheck the source after the await above; proposal may have been checked before a file changed.
    if (hash(JSON.stringify(original)) !== job.sourceHash)
      throw new Error("The saved source changed. Reopen the editor.");
    const episode = applyWritingProposal(original, { ...body.snapshot });
    const design = parsePresentationDesign(
      proposal,
      episode.scenes.map((scene) => scene.id),
    );
    episode.presentation = {
      ...(episode.presentation ?? {
        tone: "professional",
        format: "explainer",
        humor: "none",
        speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
      }),
      design,
    };
    const code: Record<string, string> = {};
    for (const scene of episode.scenes)
      if ("codePath" in scene.visual && scene.visual.codePath)
        code[scene.visual.codePath] = await readFile(
          await sourceFile(scene.visual.codePath),
          "utf8",
        );
    const files = await createPresentationDeck({ episode, code, previewOnly: true });
    return { html: files["presentation.html"] };
  }
  async cancel(id: string) {
    await this.initialize();
    await this.refreshJobs();
    const job = this.jobs.get(id);
    if (!job) throw new Error("Writing request not found.");
    if (this.current?.job.id === id && job.state === "RUNNING") {
      this.current.abort.abort();
      job.state = "CANCELED";
      job.message =
        "Canceled in this studio. Downstream work already processed may still incur cost.";
      job.completedAt = job.updatedAt = new Date().toISOString();
      await this.persist(job);
    } else if (job.state === "RUNNING") {
      await writeFile(resolve(this.directory, "jobs", `${job.id}.cancel`), "cancel", {
        mode: 0o600,
      });
      return {
        ...structuredClone(job),
        message:
          "Cancellation requested from the active studio. Downstream work may already have incurred cost.",
      };
    }
    return structuredClone(job);
  }
  async start(value: unknown, deviceBusy: () => boolean = () => false) {
    await this.initialize();
    await this.refreshJobs();
    const input = parseWritingInput(value);
    const fingerprint = hash(JSON.stringify(input));
    const existing = [...this.jobs.values()].find((job) => job.requestId === input.requestId);
    if (existing) {
      if (existing.inputHash !== fingerprint)
        throw new WritingError(
          "CONFLICT",
          "This request ID already belongs to different writing inputs.",
        );
      return structuredClone(existing);
    }
    if (this.current)
      throw new WritingError(
        "BUSY",
        "Another writing request is running. Wait or cancel it first.",
      );
    const settings = await readWritingSettings(this.directory);
    if (input.settingsHash !== hash(JSON.stringify(settings)))
      throw new WritingError(
        "CONFLICT",
        "Writing preferences changed in another tab. Refresh setup and start again with the intended provider/model.",
      );
    if (settings.provider === "hyperspace" && input.allowRemote !== true)
      throw new WritingError(
        "COST_ACK_REQUIRED",
        "Confirm use of Hyperspace and its possible downstream cost for this request.",
      );
    if (!settings[settings.provider].model)
      throw new Error("Choose a model in Writing setup first.");
    if (deviceBusy() && settings.provider === "local")
      throw new WritingError(
        "BUSY",
        "Wait for local production or setup before using the local writer.",
      );
    const lease = writingJobLease(this.directory);
    try {
      await this.refreshJobs(true);
      const duplicate = [...this.jobs.values()].find((job) => job.requestId === input.requestId);
      if (duplicate) {
        if (duplicate.inputHash !== fingerprint)
          throw new WritingError(
            "CONFLICT",
            "This request ID already belongs to different inputs.",
          );
        lease.close();
        return structuredClone(duplicate);
      }
      if (deviceBusy() && settings.provider === "local")
        throw new WritingError(
          "BUSY",
          "Local production started. Wait before using the local writer.",
        );
    } catch (error) {
      lease.close();
      throw error;
    }
    const job: WritingJob = {
      schemaVersion: 1,
      id: randomUUID(),
      requestId: input.requestId,
      inputHash: fingerprint,
      selector: input.selector,
      sourceHash: input.sourceHash,
      snapshotHash: hash(JSON.stringify(input.snapshot)),
      provider: settings.provider,
      settingsHash: input.settingsHash,
      model: settings[settings.provider].model,
      action: input.action,
      promptVersion: writingPromptVersion,
      outputTokenLimit:
        settings.outputTokens[input.action === "final-review" ? "finalReview" : "writing"],
      state: "RUNNING",
      message: "Checking the selected writing engine…",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stages: [],
    };
    const abort = new AbortController();
    const cancelTimer = setInterval(() => {
      void readFile(resolve(this.directory, "jobs", `${job.id}.cancel`))
        .then(() => abort.abort())
        .catch(() => {});
    }, 500);
    cancelTimer.unref();
    this.current = { job, abort, lease, cancelTimer };
    this.jobs.set(job.id, job);
    try {
      await this.persist(job);
    } catch {
      clearInterval(cancelTimer);
      lease.close();
      this.current = undefined;
      job.state = "FAILED";
      throw new Error("Writing receipt could not be saved. No generation started.");
    }
    void this.run(job, input, structuredClone(settings), abort.signal);
    return structuredClone(job);
  }
  private async run(
    job: WritingJob,
    input: WritingInput,
    settings: WritingSettings,
    signal: AbortSignal,
  ) {
    const checkCanceled = async () => {
      let marker = false;
      try {
        await readFile(resolve(this.directory, "jobs", `${job.id}.cancel`));
        marker = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (marker) this.current?.abort.abort();
      if (marker || signal.aborted) throw new WritingError("CANCELED", "Writing request canceled.");
    };
    try {
      const episode = await (this.options.readEpisode ?? readContentEpisode)(input.selector);
      validateWritingSnapshot(input, episode);
      if (input.action === "final-review") {
        job.finalReviewHash = finalReviewFingerprint(episode, input.snapshot);
        await this.persist(job);
      }
      const apiKey = settings.provider === "hyperspace" ? await this.secrets.get() : undefined;
      const catalog = await writingCatalog(
        settings,
        settings.provider,
        apiKey,
        this.options.transport,
      );
      if (catalog.status !== "ready")
        throw new WritingError(
          catalog.status === "auth-required" ? "AUTH_REQUIRED" : "UNAVAILABLE",
          catalog.message,
        );
      const model = catalog.models.find((item) => item.id === settings[settings.provider].model);
      if (!model)
        throw new WritingError(
          "MODEL_UNAVAILABLE",
          "The saved model is not advertised by this service. Refresh models and choose one; no replacement was selected.",
        );
      if (!model.chat)
        throw new WritingError(
          "UNSUPPORTED_MODEL",
          "That model is not a chat writer. Choose a chat model.",
        );
      if (settings.provider === "local" && !model.loaded)
        throw new WritingError(
          "MODEL_NOT_LOADED",
          "Load the selected Gemma/model in LM Studio, then try again. Writing setup never replaces your loaded models.",
        );
      const execute = async () => {
        const messages = writingMessages(input, episode);
        const stage = async (name: string, history = messages) => {
          await checkCanceled();
          job.message =
            name === "correction"
              ? "Refining the spoken story with the same model…"
              : `Generating ${input.action === "ideas" ? "three story angles" : input.action === "final-review" ? "the final script, companion and slide review" : input.action === "review" ? "editorial feedback" : input.action === "presentation" ? "a presentation design" : "a conversational script"}…`;
          const started = performance.now();
          const receipt: WritingJob["stages"][number] = {
            name,
            seconds: 0,
            state: "running",
            submitted: false,
            startedAt: new Date().toISOString(),
          };
          job.stages.push(receipt);
          job.updatedAt = new Date().toISOString();
          await this.persist(job);
          try {
            await checkCanceled();
            receipt.submitted = true;
            await this.persist(job);
            const response = await writingCompletion(settings, history, {
              ...(input.action === "final-review"
                ? {
                    finalReview: true,
                    ...(settings.provider === "local"
                      ? { responseSchema: finalReviewResponseSchema(episode) }
                      : {}),
                  }
                : {}),
              ...(apiKey ? { apiKey } : {}),
              signal,
              ...(this.options.transport ? { transport: this.options.transport } : {}),
            });
            receipt.seconds = response.seconds;
            receipt.state = "complete";
            if (response.usage) receipt.usage = response.usage;
            await checkCanceled();
            try {
              const result = parseWritingResult(response.content, input, episode);
              if (input.action === "rewrite") {
                const copy = applyWritingProposal(episode, result as WritingProposal);
                if (isNewsEpisode(copy)) validateNewsEpisode(copy);
                else validateEpisode(copy);
                await assertPresentationDesignFits(copy);
              }
              if (input.action === "presentation") {
                const copy = structuredClone(episode);
                copy.presentation = {
                  ...(copy.presentation ?? {
                    tone: "professional",
                    format: "explainer",
                    humor: "none",
                    speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
                  }),
                  design: parsePresentationDesign(
                    result,
                    copy.scenes.map((scene) => scene.id),
                  ),
                };
                if (isNewsEpisode(copy)) validateNewsEpisode(copy);
                else validateEpisode(copy);
                await assertPresentationDesignFits(copy);
              }
              receipt.checks =
                "Structure and wording limits passed; factual/editorial approval still required.";
              return { response, result };
            } catch (error) {
              receipt.checks = error instanceof Error ? error.message : "Output contract failed.";
              return { response, error: receipt.checks };
            }
          } catch (error) {
            receipt.state = signal.aborted ? "canceled" : "failed";
            receipt.seconds = (performance.now() - started) / 1000;
            if (error instanceof WritingError && error.usage) receipt.usage = error.usage;
            receipt.checks = error instanceof Error ? error.message : "Writing request failed.";
            throw error;
          } finally {
            await this.persist(job);
          }
        };
        const first = await stage(input.action);
        if (input.action !== "rewrite") {
          if (!first.result)
            throw new WritingError(
              "INVALID_OUTPUT",
              first.error ?? "The output did not meet the writing contract.",
            );
          job.result = first.result;
          return;
        }
        if (first.result) {
          job.result = first.result;
          await this.persist(job);
        }
        let corrected: Awaited<ReturnType<typeof stage>>;
        try {
          corrected = await stage("correction", [
            ...messages,
            { role: "assistant", content: first.response.content },
            {
              role: "user",
              content: `Revise once. Preserve every scene/turn slot and the exact JSON contract. Improve natural rhythm, one concrete discovery and a useful payoff. Do not repeat a disclaimer list or read commands/IDs aloud. Keep all source boundaries and existing scene claims. Checks from draft: ${first.error ?? "Structure passed. Improve wording without breaking it."}. Return only the complete revised JSON object.`,
            },
          ]);
        } catch (error) {
          if (signal.aborted || !first.result) throw error;
          job.warning =
            "The correction could not finish; the valid original proposal was preserved. The failed request may still incur cost. No retry was made.";
          return;
        }
        if (corrected.result) job.result = corrected.result;
        else if (first.result) {
          job.result = first.result;
          job.warning =
            "The correction failed its output checks; the valid original proposal was preserved.";
        } else
          throw new WritingError(
            "INVALID_OUTPUT",
            corrected.error ?? "Both rewrites failed validation. Your current script is unchanged.",
          );
      };
      if (settings.provider === "local") await (this.options.lock ?? withModelLock)(execute);
      else await execute();
      await checkCanceled();
      job.state = "SUCCEEDED";
      job.message =
        input.action === "rewrite"
          ? "Proposal ready. Review the wording and sources before applying it; nothing was saved or rendered."
          : input.action === "presentation"
            ? "Presentation proposal ready. Preview it before applying; narration, sources and media stay unchanged."
            : input.action === "final-review"
              ? "Final text review saved. Review the suggestions; audio, rendered frames and live sources were not assessed."
              : input.action === "review"
                ? "Editorial feedback ready. This reviews text, not audio/video or verified product availability."
                : "Three story angles ready. Choose one to guide a rewrite of these existing scenes.";
    } catch (error) {
      if (signal.aborted) {
        job.state = "CANCELED";
        job.message = "Canceled here. Work already processed may still incur cost.";
      } else {
        job.state = "FAILED";
        job.errorCode = error instanceof WritingError ? error.code : "WRITING_FAILED";
        job.message =
          error instanceof Error
            ? error.message
            : "Writing could not finish. Your script is unchanged.";
      }
    } finally {
      job.completedAt = job.updatedAt = new Date().toISOString();
      await this.persist(job).catch(() => {});
      if (this.current?.job.id === job.id) {
        clearInterval(this.current.cancelTimer);
        this.current.lease.close();
        this.current = undefined;
      }
      await unlink(resolve(this.directory, "jobs", `${job.id}.cancel`)).catch(() => {});
    }
  }
}

const sharedManagers = new Map<string, WritingManager>();
export function sharedWritingManager(directory = editorialRoot) {
  const key = resolve(directory);
  let manager = sharedManagers.get(key);
  if (!manager) {
    manager = new WritingManager({ directory: key });
    sharedManagers.set(key, manager);
  }
  return manager;
}
