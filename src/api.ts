import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { type auditionPhrase, installedKokoroVoices } from "./media/voice-audition.js";
import { kokoroVoices } from "./media/voices.js";
import { type ProductionReport, produce } from "./production.js";
import { savePresentation } from "./script-import.js";

export interface ProductionJobState {
  id: string;
  selector: string;
  stage: string;
  progressMessage: string;
  startedAt: string;
  updatedAt: string;
  report?: ProductionReport;
  error?: string;
  listeners: Set<(event: { type: string; data: unknown }) => void>;
}

export interface ApiOptions {
  onLibraryUpdated?: (newDirectory: string) => void | Promise<void>;
  artifactRoot?: string;
  audition?: typeof auditionPhrase;
}

let activeJob: ProductionJobState | null = null;
const recentJobs = new Map<string, ProductionJobState>();

export function getActiveJob() {
  return activeJob;
}

export function getJob(id: string) {
  return recentJobs.get(id);
}

export function resetJobsForTest() {
  activeJob = null;
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

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: ApiOptions = {},
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;

  // GET /api/health
  if (request.method === "GET" && path === "/api/health") {
    sendJson(response, 200, { status: "ok", timestamp: new Date().toISOString() });
    return true;
  }

  // GET /api/status
  if (request.method === "GET" && path === "/api/status") {
    sendJson(response, 200, {
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

  // POST /api/audition
  if (request.method === "POST" && path === "/api/audition") {
    try {
      const body = (await readJsonBody(request)) as {
        text?: string;
        voice?: string;
        speed?: number;
        pronunciation?: Record<string, string>;
      };
      if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
        sendJson(response, 400, { error: "Text is required for audition" });
        return true;
      }
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
      const saved = await savePresentation(body?.definition ?? body);
      sendJson(response, 201, {
        selector: saved.selector,
        file: saved.file,
      });
    } catch (error) {
      sendJson(response, 400, { error: (error as Error).message });
    }
    return true;
  }

  // POST /api/produce
  if (request.method === "POST" && path === "/api/produce") {
    try {
      const body = (await readJsonBody(request)) as {
        selector?: string;
        definition?: unknown;
      };
      let selector = body?.selector;
      if (body?.definition) {
        const saved = await savePresentation(body.definition);
        selector = saved.selector;
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
          const report = await produce(selector, {
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

          job.stage = report.stage;
          job.report = report;
          job.updatedAt = new Date().toISOString();
          if (report.stage === "READY" && report.libraryDirectory && options.onLibraryUpdated) {
            await options.onLibraryUpdated(report.libraryDirectory);
          }
          notify({ type: "complete", data: { stage: report.stage, report } });
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
        streamUrl: `/api/productions/${jobId}/stream`,
        statusUrl: `/api/productions/${jobId}`,
      });
    } catch (error) {
      const collision =
        error instanceof Error &&
        (error.cause as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
      sendJson(response, collision ? 409 : 400, { error: (error as Error).message });
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

  // Unknown API route
  sendJson(response, 404, { error: "API route not found" });
  return true;
}
