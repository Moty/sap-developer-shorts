import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readContentEpisode } from "./contracts.js";
import { handleCreatorApi } from "./creator-api.js";
import { hash } from "./digest.js";
import { handleWritingApi } from "./editorial/api.js";
import type { WritingManager } from "./editorial/manager.js";
import { buildLibrary } from "./library.js";
import { type LocalActionManager, parseLocalAction } from "./local-actions.js";
import { pronounce } from "./media/audio.js";
import { synthesizeClonedSpeech } from "./media/qwen.js";
import { verifiedKokoroVoices } from "./media/voice-assets.js";
import { type auditionPhrase, installedKokoroVoices } from "./media/voice-audition.js";
import { assertPrivateVoiceRequest, handleVoiceProfileApi } from "./media/voice-profile-api.js";
import { hasClonedVoices, isClonedVoice } from "./media/voice-reference.js";
import { kokoroVoices } from "./media/voices.js";
import { productionSettings } from "./media/worker.js";
import {
  latestProduction,
  type ProductionReport,
  produce,
  productionReceipt,
} from "./production.js";
import { savePresentation } from "./script-import.js";
import { shortDurationAllowed } from "./timing-policy.js";
import {
  readWorkflowManifest,
  updateWorkflow,
  workflowDirectory,
  workflowSourcesExpired,
  workflowState,
} from "./workflow.js";

export interface ProductionJobState {
  id: string;
  selector: string;
  stage: string;
  progressMessage: string;
  startedAt: string;
  updatedAt: string;
  report?: ProductionReport;
  error?: string;
  libraryUpdated?: boolean;
  listeners: Set<(event: { type: string; data: unknown }) => void>;
}

export interface ApiOptions {
  editorial?: WritingManager;
  localActions?: LocalActionManager;
  privateVoiceToken?: string;
  onLibraryUpdated?: (newDirectory: string) => void | Promise<void>;
  artifactRoot?: string;
  audition?: typeof auditionPhrase;
  libraryDirectory?: () => string;
  production?: typeof produce;
  rebuildLibrary?: (options?: { artifactRoot?: string }) => Promise<{ directory: string }>;
}

async function refreshSavedLibrary(options: ApiOptions, directory?: string) {
  if (!options.onLibraryUpdated) return false;
  try {
    const output =
      directory ??
      (
        await (options.rebuildLibrary ?? buildLibrary)(
          options.artifactRoot ? { artifactRoot: options.artifactRoot } : {},
        )
      ).directory;
    await options.onLibraryUpdated(output);
    return true;
  } catch (error) {
    console.warn("Saved script retained; workspace refresh failed:", (error as Error).message);
    return false;
  }
}

let activeJob: ProductionJobState | null = null;
let productionStarting = false;
const recentJobs = new Map<string, ProductionJobState>();

export function getActiveJob() {
  return activeJob;
}

export function getJob(id: string) {
  return recentJobs.get(id);
}

export function resetJobsForTest() {
  activeJob = null;
  productionStarting = false;
  recentJobs.clear();
}

async function readJsonBody(request: IncomingMessage, limit = 2 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(response: ServerResponse, statusCode: number, data: unknown) {
  const json = JSON.stringify(data);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(json);
}

function isSameOriginMutation(request: IncomingMessage) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers["content-type"] ?? "")) return false;
  if (
    request.headers["sec-fetch-site"] &&
    request.headers["sec-fetch-site"] !== "same-origin" &&
    request.headers["sec-fetch-site"] !== "none"
  )
    return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      parsed.origin === origin &&
      parsed.host === request.headers.host
    );
  } catch {
    return false;
  }
}

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: ApiOptions = {},
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;
  if (request.method === "POST" && !isSameOriginMutation(request)) {
    sendJson(response, 403, { error: "Save changes from this local studio using JSON." });
    return true;
  }
  if (
    await handleCreatorApi(request, response, url, {
      ...(options.privateVoiceToken ? { token: options.privateVoiceToken } : {}),
      ...(options.artifactRoot ? { artifactRoot: options.artifactRoot } : {}),
      ...(options.libraryDirectory ? { directory: options.libraryDirectory() } : {}),
      readBody: readJsonBody,
      send: sendJson,
    })
  )
    return true;
  if (
    await handleWritingApi(request, response, url, {
      ...(options.editorial ? { manager: options.editorial } : {}),
      ...(options.privateVoiceToken ? { token: options.privateVoiceToken } : {}),
      deviceBusy: () =>
        Boolean(
          options.localActions?.busy ||
            productionStarting ||
            (activeJob && !["READY", "FAILED", "BLOCKED"].includes(activeJob.stage)),
        ),
      readBody: readJsonBody,
      send: sendJson,
    })
  )
    return true;
  if (path === "/api/local-actions" || path.startsWith("/api/local-actions/")) {
    try {
      assertPrivateVoiceRequest(request, options.privateVoiceToken);
    } catch (error) {
      sendJson(response, 403, { error: (error as Error).message });
      return true;
    }
    const actions = options.localActions;
    if (!actions) {
      sendJson(response, 503, { error: "Reopen the current local studio to use these controls." });
      return true;
    }
    if (request.method === "GET" && path === "/api/local-actions") {
      sendJson(response, 200, { job: actions.latest() });
      return true;
    }
    if (request.method === "POST" && path === "/api/local-actions") {
      try {
        const input = parseLocalAction(await readJsonBody(request, 4096));
        if (
          options.editorial?.localBusy ||
          productionStarting ||
          (activeJob && !["READY", "FAILED", "BLOCKED"].includes(activeJob.stage))
        ) {
          sendJson(response, 409, {
            error:
              "Wait for the current production to finish before running setup or changing voices.",
          });
          return true;
        }
        sendJson(response, 202, actions.start(input));
      } catch (error) {
        sendJson(response, actions.busy ? 409 : 400, { error: (error as Error).message });
      }
      return true;
    }
    const match = /^\/api\/local-actions\/([a-f0-9-]+)(\/audio)?$/u.exec(path);
    const job = match && actions.get(match[1] as string);
    if (request.method === "GET" && match && job) {
      if (match[2]) {
        const audio = actions.audio(match[1] as string);
        if (!audio) sendJson(response, 404, { error: "The voice sample is not ready." });
        else {
          response.writeHead(200, {
            "content-type": "audio/wav",
            "content-length": audio.length,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          });
          response.end(audio);
        }
      } else sendJson(response, 200, job);
      return true;
    }
    sendJson(response, 404, {
      error: "Studio action unavailable. If the server restarted, start the action again.",
    });
    return true;
  }
  if (
    await handleVoiceProfileApi(request, response, url, {
      ...(options.privateVoiceToken ? { token: options.privateVoiceToken } : {}),
      busy:
        options.editorial?.localBusy ||
        options.localActions?.busy ||
        productionStarting ||
        (!!activeJob && !["READY", "FAILED", "BLOCKED"].includes(activeJob.stage)),
      readBody: readJsonBody,
      send: sendJson,
    })
  )
    return true;
  if (path === "/api/workflow" && ["GET", "POST"].includes(request.method ?? "")) {
    try {
      const directory = options.libraryDirectory?.();
      if (!directory) throw new Error("Open a saved studio to review its videos.");
      const root = workflowDirectory(options.artifactRoot);
      if (request.method === "POST") {
        sendJson(response, 200, await updateWorkflow(directory, root, await readJsonBody(request)));
      } else {
        const manifest = await readWorkflowManifest(directory);
        const episodes = await Promise.all(
          manifest.episodes.map(async (entry) => {
            const state = await workflowState(
              root,
              entry,
              manifest.artifactHashes[`episodes/${entry.selector}/video/short.mp4`],
            );
            const report = await latestProduction(entry.selector, options.artifactRoot);
            const episode = await readContentEpisode(entry.selector);
            const changed = hash(JSON.stringify(episode)) !== entry.inputHash;
            const expired = entry.sourceReviewExpired || workflowSourcesExpired(episode);
            const current =
              activeJob?.selector === entry.selector &&
              !["READY", "FAILED", "BLOCKED"].includes(activeJob.stage)
                ? activeJob
                : null;
            const interrupted =
              report && !["READY", "BLOCKED", "FAILED"].includes(report.stage) && !current;
            const issue = changed
              ? "The script changed. Rebuild the studio and produce this version."
              : expired
                ? "Sources need rechecking before sharing current news."
                : interrupted
                  ? "Production was interrupted. Produce again to resume."
                  : report?.issue?.code === "TIMING_REVIEW_REQUIRED" &&
                      typeof report.durationSeconds === "number" &&
                      typeof report.hookSeconds === "number"
                    ? shortDurationAllowed(report.durationSeconds) && report.hookSeconds > 0
                      ? `This earlier attempt stopped on the old timing limits. ${report.durationSeconds.toFixed(1)}s total and a ${report.hookSeconds.toFixed(2)}s opening are accepted now. Produce again to retry.`
                      : `Video not produced: narration ${report.durationSeconds.toFixed(1)}s. Accepted total: 15–90 seconds. Opening and section lengths are flexible.`
                    : report?.issue?.message;
            return {
              selector: entry.selector,
              renderKey: entry.video?.renderKey ?? null,
              ...state,
              ...(report?.stage === "BLOCKED" && !entry.video
                ? {
                    label:
                      report.issue?.code === "TIMING_REVIEW_REQUIRED"
                        ? typeof report.durationSeconds === "number" &&
                          shortDurationAllowed(report.durationSeconds)
                          ? "Ready to retry"
                          : "Needs script edit"
                        : "Setup needed",
                  }
                : {}),
              ...(changed ? { stage: "editing", label: "Editing" } : {}),
              ...(current ? { stage: "producing", label: "Producing" } : {}),
              reviewBlocked: changed || expired,
              attention: Boolean(
                expired ||
                  issue ||
                  (entry.preview?.kind === "narrated" && !entry.preview.timingReady),
              ),
              issue: issue ?? null,
              productionStage: report?.stage ?? null,
            };
          }),
        );
        sendJson(response, 200, {
          episodes,
          activeJob: activeJob
            ? {
                id: activeJob.id,
                selector: activeJob.selector,
                stage: activeJob.stage,
                message: activeJob.progressMessage,
              }
            : null,
        });
      }
    } catch (error) {
      sendJson(response, 400, { error: (error as Error).message });
    }
    return true;
  }

  // GET /api/health
  if (request.method === "GET" && path === "/api/health") {
    sendJson(response, 200, { status: "ok", timestamp: new Date().toISOString() });
    return true;
  }

  // Read-only recovery: exact job identity survives a browser/server restart.
  if (request.method === "GET" && path === "/api/production-context") {
    try {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams;
      const selector = query.get("selector") ?? "";
      await readContentEpisode(selector);
      const id = query.get("jobId");
      const job = id ? recentJobs.get(id) : activeJob?.selector === selector ? activeJob : null;
      if (job && job.selector !== selector)
        throw new Error("Production job belongs to another version");
      const report =
        job?.report ??
        (id
          ? await productionReceipt(selector, id, options.artifactRoot)
          : await latestProduction(selector, options.artifactRoot));
      const active = Boolean(job && !["READY", "FAILED", "BLOCKED"].includes(job.stage));
      const stage =
        job?.stage ??
        (report && !["READY", "FAILED", "BLOCKED"].includes(report.stage)
          ? "INTERRUPTED"
          : (report?.stage ?? null));
      sendJson(response, 200, {
        selector,
        id: job?.id ?? report?.id ?? null,
        active,
        stage,
        message: job?.progressMessage ?? report?.issue?.message ?? "",
        startedAt: job?.startedAt ?? report?.startedAt ?? null,
        updatedAt: job?.updatedAt ?? report?.updatedAt ?? null,
        libraryUpdated: job?.libraryUpdated,
        report: report
          ? {
              id: report.id,
              selector: report.selector,
              stage: report.stage,
              failedAt: report.failedAt,
              startedAt: report.startedAt,
              updatedAt: report.updatedAt,
              generationTiming: report.generationTiming,
              issue: report.issue,
              durationSeconds: report.durationSeconds,
              hookSeconds: report.hookSeconds,
            }
          : null,
        otherJob: activeJob && activeJob.id !== job?.id ? { selector: activeJob.selector } : null,
      });
    } catch (error) {
      sendJson(response, 400, { error: (error as Error).message });
    }
    return true;
  }

  // GET /api/status
  if (request.method === "GET" && path === "/api/status") {
    sendJson(response, 200, {
      writingJob: options.editorial?.active ?? null,
      activeJob: activeJob
        ? {
            id: activeJob.id,
            selector: activeJob.selector,
            stage: activeJob.stage,
            message: activeJob.progressMessage,
            startedAt: activeJob.startedAt,
            updatedAt: activeJob.updatedAt,
          }
        : null,
    });
    return true;
  }

  // GET /api/voices
  if (request.method === "GET" && path === "/api/portrait-status") {
    const { talkingHeadRuntime } = await import("./media/talking-head.js");
    sendJson(response, 200, await talkingHeadRuntime());
    return true;
  }

  // GET /api/voices
  if (request.method === "GET" && path === "/api/voices") {
    try {
      const installed = await installedKokoroVoices();
      sendJson(response, 200, {
        voices: kokoroVoices.map((voice) => ({
          ...voice,
          installed: installed.includes(voice.id),
        })),
      });
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
    return true;
  }

  if (request.method === "GET" && path.startsWith("/api/face-assets/")) {
    try {
      const { faceAsset } = await import("./media/face-assets.js");
      const { bytes, contentType } = await faceAsset(path.slice("/api/face-assets/".length));
      response.writeHead(200, {
        "content-type": contentType,
        "content-length": bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
    } catch {
      sendJson(response, 404, {
        error: "Local detector asset unavailable. Run npm run shorts -- avatar-setup",
      });
    }
    return true;
  }

  // GET /api/avatars
  if (request.method === "GET" && path === "/api/avatars") {
    try {
      const { listCustomAvatars } = await import("./media/avatar.js");
      const avatars = await listCustomAvatars();
      sendJson(response, 200, { avatars });
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
    return true;
  }

  // GET /api/avatars/:imageId
  if (request.method === "GET" && path.startsWith("/api/avatars/")) {
    try {
      const imageId = decodeURIComponent(path.slice("/api/avatars/".length));
      const { resolveAvatarPath } = await import("./media/avatar.js");
      const { readFile } = await import("node:fs/promises");
      const filePath = await resolveAvatarPath(imageId);
      const bytes = await readFile(filePath);
      const mime = imageId.endsWith(".webp")
        ? "image/webp"
        : imageId.endsWith(".jpg") || imageId.endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png";
      response.writeHead(200, {
        "content-type": mime,
        "content-length": bytes.length,
        "x-image-sha256": (await import("./digest.js")).hash(bytes),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
    } catch {
      sendJson(response, 404, { error: "Avatar image not found" });
    }
    return true;
  }

  // POST /api/avatars
  if (request.method === "POST" && path === "/api/avatars") {
    try {
      const body = (await readJsonBody(request, 6 * 1024 * 1024)) as {
        name?: string;
        dataUrl?: string;
      };
      if (
        !body.name ||
        typeof body.name !== "string" ||
        !body.dataUrl ||
        typeof body.dataUrl !== "string"
      ) {
        sendJson(response, 400, { error: "Avatar name and base64 image dataUrl are required" });
        return true;
      }
      const match = /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/iu.exec(
        body.dataUrl.trim(),
      );
      const base64Payload = match ? (match[1] ?? "") : body.dataUrl.trim();
      const buffer = Buffer.from(base64Payload, "base64");
      const { saveCustomAvatar } = await import("./media/avatar.js");
      const saved = await saveCustomAvatar(body.name, buffer);
      sendJson(response, 201, {
        imageId: saved.imageId,
        sha256: saved.sha256,
        url: `/api/avatars/${encodeURIComponent(saved.imageId)}`,
      });
    } catch (error) {
      sendJson(response, 400, { error: (error as Error).message });
    }
    return true;
  }

  // POST /api/audition
  if (request.method === "POST" && path === "/api/audition") {
    if (options.localActions?.busy || options.editorial?.localBusy) {
      sendJson(response, 409, {
        error: "Wait for the current studio action to finish before auditioning another voice.",
      });
      return true;
    }
    if (activeJob && !["READY", "FAILED", "BLOCKED"].includes(activeJob.stage)) {
      sendJson(response, 409, {
        error: "Wait for the current production to finish before auditioning another voice.",
      });
      return true;
    }
    try {
      const body = (await readJsonBody(request)) as {
        text?: string;
        voice?: unknown;
        speed?: number;
        pronunciation?: Record<string, string>;
      };
      if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
        sendJson(response, 400, { error: "Text is required for audition" });
        return true;
      }
      if (isClonedVoice(body.voice)) {
        assertPrivateVoiceRequest(request, options.privateVoiceToken);
        const spokenText = pronounce(body.text.trim(), body.pronunciation ?? {});
        const result = await synthesizeClonedSpeech(body.voice, spokenText);
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": result.audio.length,
          "x-spoken-text": encodeURIComponent(spokenText),
          "x-duration-seconds": (result.alignment.frames / 22050).toFixed(2),
          "cache-control": "no-store",
        });
        response.end(result.audio);
        return true;
      }
      if (body.voice !== undefined && typeof body.voice !== "string")
        throw new Error("Invalid voice selection.");
      const audition =
        options.audition ?? (await import("./media/voice-audition.js")).auditionPhrase;
      const result = await audition(body.text.trim(), {
        ...(body.voice !== undefined ? { voice: body.voice } : {}),
        ...(body.speed !== undefined ? { speed: body.speed } : {}),
        ...(body.pronunciation !== undefined ? { pronunciation: body.pronunciation } : {}),
      });
      response.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": result.audio.length,
        "x-spoken-text": encodeURIComponent(result.spokenText),
        "x-duration-seconds": result.durationSeconds.toFixed(2),
        "cache-control": "no-store",
      });
      response.end(result.audio);
    } catch (error) {
      sendJson(response, 400, { error: (error as Error).message });
    }
    return true;
  }

  // POST /api/scripts
  if (request.method === "POST" && path === "/api/scripts") {
    try {
      const body = (await readJsonBody(request)) as { definition?: unknown };
      const definition = (body?.definition ?? body) as {
        presentation?: { speakers?: { voice?: unknown }[] };
      };
      if (definition.presentation?.speakers?.some((speaker) => isClonedVoice(speaker.voice)))
        assertPrivateVoiceRequest(request, options.privateVoiceToken);
      const saved = await savePresentation(definition, { artifactRoot: options.artifactRoot });
      const libraryUpdated = await refreshSavedLibrary(options);
      sendJson(response, 201, {
        selector: saved.selector,
        file: saved.file,
        libraryUpdated,
      });
    } catch (error) {
      sendJson(response, 400, { error: (error as Error).message });
    }
    return true;
  }

  // POST /api/produce
  if (request.method === "POST" && path === "/api/produce") {
    if (options.localActions?.busy || options.editorial?.localBusy) {
      sendJson(response, 409, {
        error: "Wait for the current studio action to finish before producing a video.",
      });
      return true;
    }
    if (productionStarting) {
      sendJson(response, 409, {
        error: "A production request is being prepared. Try again shortly.",
      });
      return true;
    }
    productionStarting = true;
    try {
      if (activeJob && !["READY", "FAILED", "BLOCKED"].includes(activeJob.stage)) {
        sendJson(response, 409, {
          error: "A production job is already in progress",
          jobId: activeJob.id,
          selector: activeJob.selector,
          stage: activeJob.stage,
        });
        return true;
      }
      const body = (await readJsonBody(request)) as {
        selector?: string;
        definition?: unknown;
      };
      let selector = body?.selector;
      let libraryUpdated = false;
      if (body?.definition) {
        const definition = body.definition as {
          presentation?: { speakers?: { voice?: unknown }[] };
        };
        if (definition.presentation?.speakers?.some((speaker) => isClonedVoice(speaker.voice)))
          assertPrivateVoiceRequest(request, options.privateVoiceToken);
        const saved = await savePresentation(body.definition, {
          artifactRoot: options.artifactRoot,
        });
        selector = saved.selector;
        // A saved version must remain discoverable even if narration or video fails.
        libraryUpdated = await refreshSavedLibrary(options);
      }

      if (
        !selector ||
        !/^(ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}(?:@[a-z][a-z0-9-]{0,31})?$/u.test(selector)
      ) {
        sendJson(response, 400, { error: "A valid episode selector is required" });
        return true;
      }

      if (
        activeJob &&
        activeJob.stage !== "READY" &&
        activeJob.stage !== "FAILED" &&
        activeJob.stage !== "BLOCKED"
      ) {
        sendJson(response, 409, {
          error: "A production job is already in progress",
          jobId: activeJob.id,
          selector: activeJob.selector,
          stage: activeJob.stage,
        });
        return true;
      }

      if (hasClonedVoices(await readContentEpisode(selector)))
        assertPrivateVoiceRequest(request, options.privateVoiceToken);
      const jobId = randomUUID();
      const job: ProductionJobState = {
        id: jobId,
        selector,
        stage: "PREFLIGHT",
        progressMessage: "Starting production...",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        listeners: new Set(),
      };

      activeJob = job;
      recentJobs.set(jobId, job);

      const notify = (event: { type: string; data: unknown }) => {
        for (const listener of job.listeners) {
          try {
            listener(event);
          } catch {
            /* ignore dead listener */
          }
        }
      };

      // Run production asynchronously
      void (async () => {
        try {
          const report = await (options.production ?? produce)(selector, {
            jobId,
            ...(options.artifactRoot !== undefined ? { artifactRoot: options.artifactRoot } : {}),
            progress(message) {
              job.updatedAt = new Date().toISOString();
              job.progressMessage = message;
              if (
                [
                  "PREFLIGHT",
                  "NARRATION",
                  "RENDER",
                  "LIBRARY",
                  "READY",
                  "BLOCKED",
                  "FAILED",
                ].includes(message)
              ) {
                job.stage = message;
              }
              notify({
                type: "progress",
                data: { stage: job.stage, message: job.progressMessage },
              });
            },
          });

          // READY links are safe only after this server serves the indexed library.
          job.stage = report.stage === "READY" ? "LIBRARY" : report.stage;
          job.report = report;
          job.updatedAt = new Date().toISOString();
          job.progressMessage = report.issue?.message ?? "Updating the workspace…";
          libraryUpdated = await refreshSavedLibrary(
            options,
            report.stage === "READY" ? (report.libraryDirectory ?? undefined) : undefined,
          );
          job.libraryUpdated = libraryUpdated;
          job.stage = report.stage;
          job.updatedAt = new Date().toISOString();
          job.progressMessage =
            report.issue?.message ??
            (libraryUpdated
              ? "Video produced · ready for review"
              : "Video produced. Workspace refresh is pending; refresh the studio before opening it.");
          notify({ type: "complete", data: { stage: report.stage, report, libraryUpdated } });
        } catch (error) {
          job.stage = "FAILED";
          job.error = (error as Error).message;
          job.updatedAt = new Date().toISOString();
          notify({ type: "error", data: { stage: "FAILED", error: (error as Error).message } });
        } finally {
          if (activeJob === job) activeJob = null;
        }
      })();

      sendJson(response, 202, {
        status: "ACCEPTED",
        jobId,
        selector,
        startedAt: job.startedAt,
        libraryUpdated,
        streamUrl: `/api/productions/${jobId}/stream`,
        statusUrl: `/api/productions/${jobId}`,
      });
    } catch (error) {
      const collision =
        error instanceof Error &&
        (error.cause as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
      sendJson(response, collision ? 409 : 400, { error: (error as Error).message });
    } finally {
      productionStarting = false;
    }
    return true;
  }

  // GET /api/productions/:id
  const singleMatch = /^\/api\/productions\/([a-f0-9-]+)$/u.exec(path);
  if (request.method === "GET" && singleMatch?.[1]) {
    const job = recentJobs.get(singleMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Production job not found" });
      return true;
    }
    sendJson(response, 200, {
      id: job.id,
      selector: job.selector,
      stage: job.stage,
      message: job.progressMessage,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      report: job.report ?? null,
      error: job.error ?? null,
      libraryUpdated: job.libraryUpdated,
    });
    return true;
  }

  // GET /api/productions/:id/stream
  const streamMatch = /^\/api\/productions\/([a-f0-9-]+)\/stream$/u.exec(path);
  if (request.method === "GET" && streamMatch?.[1]) {
    const job = recentJobs.get(streamMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Production job not found" });
      return true;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });

    response.write(
      `event: status\ndata: ${JSON.stringify({
        id: job.id,
        selector: job.selector,
        stage: job.stage,
        message: job.progressMessage,
        report: job.report ?? null,
        error: job.error ?? null,
        libraryUpdated: job.libraryUpdated,
      })}\n\n`,
    );

    if (job.stage === "READY" || job.stage === "FAILED" || job.stage === "BLOCKED") {
      response.end();
      return true;
    }

    const listener = (event: { type: string; data: unknown }) => {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      if (event.type === "complete" || event.type === "error") {
        job.listeners.delete(listener);
        response.end();
      }
    };

    job.listeners.add(listener);
    request.on("close", () => {
      job.listeners.delete(listener);
    });
    return true;
  }

  // GET /api/news/discover
  if (request.method === "GET" && path === "/api/news/discover") {
    try {
      const { fetchTopSapStories } = await import("./news/fetcher.js");
      const stories = await fetchTopSapStories({ limit: 12 });
      sendJson(response, 200, { stories });
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
    return true;
  }

  // GET /api/news/drafts
  if (request.method === "GET" && path === "/api/news/drafts") {
    try {
      const { readdir, readFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const { projectRoot } = await import("./paths.js");
      const dir = resolve(projectRoot, "content/drafts");
      let files: string[] = [];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      } catch {}
      const drafts = await Promise.all(
        files.map(async (file) => {
          try {
            const raw = JSON.parse(await readFile(resolve(dir, file), "utf8"));
            return raw;
          } catch {
            return null;
          }
        }),
      );
      sendJson(response, 200, { drafts: drafts.filter(Boolean) });
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
    return true;
  }

  // POST /api/news/create
  if (request.method === "POST" && path === "/api/news/create") {
    try {
      const body = (await readJsonBody(request)) as {
        url?: string;
        promote?: boolean;
        delivery?: unknown;
      };
      if (!body?.url || typeof body.url !== "string") {
        sendJson(response, 400, { error: "A valid official SAP story URL is required" });
        return true;
      }
      const { createNewsEpisodeFromUrl } = await import("./news/generator.js");
      const { parseNewShortDelivery } = await import("./news/new-short-delivery.js");
      let delivery: ReturnType<typeof parseNewShortDelivery>;
      try {
        delivery = parseNewShortDelivery(
          body.delivery,
          body.delivery === undefined ? [] : await verifiedKokoroVoices(),
          (await productionSettings()).localPreview.voice,
        );
      } catch (error) {
        sendJson(response, 400, { error: (error as Error).message });
        return true;
      }
      const result = await createNewsEpisodeFromUrl(body.url, {
        promote: Boolean(body.promote),
        ...(delivery ? { delivery } : {}),
      });

      const libraryUpdated = await refreshSavedLibrary(options);

      sendJson(response, 200, {
        success: true,
        episode: result.episode,
        path: result.path,
        libraryUpdated,
      });
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
    return true;
  }

  // POST /api/news/promote
  if (request.method === "POST" && path === "/api/news/promote") {
    try {
      const body = (await readJsonBody(request)) as { id?: string };
      if (!body?.id || typeof body.id !== "string") {
        sendJson(response, 400, { error: "Episode ID is required" });
        return true;
      }
      const { promoteNewsDraft } = await import("./news/generator.js");
      const result = await promoteNewsDraft(body.id);

      if (options.onLibraryUpdated) {
        const { buildLibrary } = await import("./library.js");
        const built = await buildLibrary();
        await options.onLibraryUpdated(built.directory);
      }

      sendJson(response, 200, {
        success: true,
        episode: result.episode,
        path: result.path,
      });
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
    return true;
  }

  // Unknown API route
  sendJson(response, 404, { error: "API route not found" });
  return true;
}
