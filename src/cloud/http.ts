import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { saveCustomAvatar } from "../media/avatar.js";
import { createVoiceProfile, readVoiceProfile } from "../media/voice-profiles.js";
import { prepareVoiceSample } from "../media/voice-sample-input.js";
import type { VerifyUser } from "./auth.js";
import type { PrivateConfig } from "./config.js";
import {
  ApiError,
  type Asset,
  fail,
  identifier,
  object,
  parseCapabilities,
  type RecordData,
  text,
} from "./contracts.js";
import { defaultPresentation, publicTemplates } from "./episodes.js";
import { checkPortraitInput } from "./image-input.js";
import type { WorkspaceService } from "./service.js";

async function body(request: IncomingMessage, limit = 1024 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) fail(413, "UPLOAD_TOO_LARGE", "This file exceeds the upload limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function json(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    fail(415, "JSON_REQUIRED", "Send a JSON request.");
  try {
    return object(JSON.parse((await body(request)).toString()));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, "INVALID_JSON", "Invalid JSON request.");
  }
}
function send(response: ServerResponse, value: unknown, status = 200) {
  response
    .writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    })
    .end(JSON.stringify(value));
}
function media(response: ServerResponse, asset: Asset, bytes: Buffer) {
  response
    .writeHead(200, {
      "content-type": asset.contentType,
      "content-length": bytes.length,
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="${asset.kind}-${asset.id}.${asset.kind === "portrait" ? "png" : asset.kind === "video" ? "mp4" : asset.kind === "package" ? "zip" : asset.kind === "captions" ? "vtt" : asset.kind === "manifest" ? "json" : "wav"}"`,
    })
    .end(bytes);
}
export function createPrivateServer(
  service: WorkspaceService,
  verify: VerifyUser,
  config: PrivateConfig,
  directory: string,
) {
  const rates = new Map<string, { count: number; until: number }>();
  const limit = (request: IncomingMessage, scope: string, maximum: number) => {
    const key = `${request.socket.remoteAddress}:${scope}`;
    const current = rates.get(key);
    const record =
      current && current.until > Date.now() ? current : { count: 0, until: Date.now() + 60_000 };
    if (++record.count > maximum) fail(429, "RATE_LIMITED", "Wait a moment before trying again.");
    rates.set(key, record);
    if (rates.size > 10_000)
      for (const [key, item] of rates) if (item.until < Date.now()) rates.delete(key);
  };
  return createServer(
    { maxHeaderSize: 32768, requestTimeout: 120_000 },
    async (request, response) => {
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("cache-control", "no-store");
      try {
        const url = new URL(request.url ?? "/", config.origin);
        const path = url.pathname;
        const isAllowedOrigin = (orig: string) => orig === config.origin;
        if (path !== "/healthz" && request.headers.host !== new URL(config.origin).host)
          fail(403, "ORIGIN_DENIED", "Use this workspace's configured studio address.");
        if (request.headers.origin && !isAllowedOrigin(request.headers.origin))
          fail(403, "ORIGIN_DENIED", "Use this workspace's studio.");
        if (request.headers.origin && isAllowedOrigin(request.headers.origin)) {
          response.setHeader("access-control-allow-origin", request.headers.origin);
          response.setHeader(
            "access-control-allow-headers",
            "content-type, authorization, idempotency-key, x-voice-metadata",
          );
          response.setHeader(
            "access-control-allow-methods",
            "GET, POST, PUT, DELETE, OPTIONS, HEAD",
          );
        }
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.end();
          return;
        }
        if (path === "/healthz") {
          send(response, { status: "ok", mode: "private-workspace" });
          return;
        }
        if (path === "/v1/config" && request.method === "GET") {
          send(response, {
            projectId: config.projectId,
            apiKey: config.apiKey,
            authDomain: config.authDomain,
            appId: config.appId,
            cloudEnabled: Boolean(config.cloud),
            cloudRuntimeDigest: config.cloud?.runtimeDigest ?? null,
            ...(config.emulator ? { authEmulatorUrl: `http://${config.authEmulator}` } : {}),
          });
          return;
        }
        if (!path.startsWith("/v1/")) {
          const file = (
            {
              "/": "index.html",
              "/index.html": "index.html",
              "/app.js": "app.js",
              "/app.css": "app.css",
            } as Record<string, string>
          )[path];
          if (!file || (request.method !== "GET" && request.method !== "HEAD"))
            fail(404, "NOT_FOUND", "Page unavailable.");
          response.setHeader(
            "content-security-policy",
            `default-src 'none'; script-src 'self' https://apis.google.com https://www.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://${config.authDomain} ${config.emulator ? `http://${config.authEmulator}` : ""}; frame-src 'self' https://${config.authDomain} https://*.firebaseapp.com https://www.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self' javascript:`,
          );
          response.setHeader(
            "content-type",
            file.endsWith(".html")
              ? "text/html; charset=utf-8"
              : file.endsWith(".js")
                ? "text/javascript"
                : "text/css",
          );
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          response.end(await readFile(resolve(directory, file)));
          return;
        }
        if (path === "/v1/worker-pairings" && request.method === "POST") {
          limit(request, "pairing", 5);
          send(response, await service.pairingStart(await json(request)), 201);
          return;
        }
        const redeem = /^\/v1\/worker-pairings\/([a-zA-Z0-9_-]+)\/redeem$/u.exec(path);
        if (redeem && request.method === "POST") {
          limit(request, "redeem", 60);
          const input = await json(request);
          send(
            response,
            await service.redeemPairing(
              String(redeem[1]),
              text(input.pollingSecret, "pairing secret", 100),
            ),
          );
          return;
        }
        const authorization = request.headers.authorization ?? "";
        if (path.startsWith("/v1/worker/")) {
          if (!authorization.startsWith("Device "))
            fail(401, "DEVICE_AUTH", "Register this rendering device.");
          const actor = await service.workerAuth(authorization.slice(7));
          if (path === "/v1/worker/heartbeat" && request.method === "POST") {
            const input = await json(request);
            send(
              response,
              await service.heartbeat(
                actor,
                parseCapabilities(input.capabilities),
                input.busy === true,
              ),
            );
            return;
          }
          if (path === "/v1/worker/unregister" && request.method === "POST") {
            send(response, await service.unregisterWorker(actor));
            return;
          }
          if (path === "/v1/worker/status" && request.method === "GET") {
            send(response, await service.deviceStatus(actor));
            return;
          }
          if (path === "/v1/worker/claim" && request.method === "POST") {
            send(response, await service.claim(actor));
            return;
          }
          if (path === "/v1/worker/rotate" && request.method === "POST") {
            send(response, await service.rotateCredential(actor));
            return;
          }
          const match =
            /^\/v1\/worker\/jobs\/([a-zA-Z0-9_-]+)\/(manifest|progress|complete|fail|release|assets|outputs)(?:\/([a-zA-Z0-9_-]+))?$/u.exec(
              path,
            );
          if (!match) fail(404, "NOT_FOUND", "Worker endpoint unavailable.");
          const jobId = identifier(match[1]);
          const action = match[2];
          const lease = text(request.headers["x-attempt-lease"], "attempt lease", 100);
          if (action === "manifest" && request.method === "GET")
            send(response, await service.manifest(actor, jobId, lease));
          else if (action === "assets" && request.method === "GET") {
            const result = await service.workerAsset(actor, jobId, lease, identifier(match[3]));
            media(response, result.asset, result.bytes);
          } else if (action === "outputs" && request.method === "POST") {
            const kind = text(request.headers["x-output-kind"], "output kind", 16) as Asset["kind"];
            const types: Partial<Record<Asset["kind"], string>> = {
              video: "video/mp4",
              audio: "audio/wav",
              audition: "audio/wav",
              captions: "text/vtt",
              manifest: "application/json",
              package: "application/zip",
            };
            const contentType = types[kind];
            if (!contentType) fail(400, "INVALID_OUTPUT", "Unsupported output type.");
            send(
              response,
              await service.uploadOutput(
                actor,
                jobId,
                lease,
                kind,
                await body(request, 30 * 1024 * 1024),
                contentType,
              ),
              201,
            );
          } else if (request.method === "POST") {
            if (action === "progress")
              send(response, await service.progress(actor, jobId, lease, await json(request)));
            else if (action === "complete")
              send(response, await service.complete(actor, jobId, lease, await json(request)));
            else if (action === "fail") {
              const input = await json(request);
              send(
                response,
                await service.finishFailure(
                  actor,
                  jobId,
                  lease,
                  text(input.message, "failure message", 300),
                ),
              );
            } else if (action === "release") send(response, await service.release(actor, jobId));
            else fail(405, "METHOD_NOT_ALLOWED", "Unsupported action.");
          } else fail(405, "METHOD_NOT_ALLOWED", "Unsupported action.");
          return;
        }
        if (!authorization.startsWith("Bearer "))
          fail(401, "SIGN_IN_REQUIRED", "Sign in to open your workspace.");
        const actor = await verify(authorization.slice(7));
        limit(request, `account-${actor.uid}`, 180);
        if (path === "/v1/bootstrap" && request.method === "POST") {
          send(response, await service.bootstrap(actor));
          return;
        }
        if (path === "/v1/me" && request.method === "GET") {
          send(response, await service.me(actor));
          return;
        }
        if (path === "/v1/templates" && request.method === "GET") {
          const account = await service.me(actor);
          if (!account.workspace) fail(403, "ACCESS_PENDING", "Open an approved workspace first.");
          send(
            response,
            await Promise.all(
              (await publicTemplates()).map(async (item) => ({
                selector: item.selector,
                episode: defaultPresentation(item.episode),
              })),
            ),
          );
          return;
        }
        const match =
          /^\/v1\/workspaces\/([a-zA-Z0-9_-]+)\/(episodes|jobs|workers|assets|voices|pairings|reconcile)(?:\/([a-zA-Z0-9_-]+))?(?:\/(cancel|accept|approve|retry))?$/u.exec(
            path,
          );
        if (!match) fail(404, "NOT_FOUND", "Endpoint unavailable.");
        const context = await service.context(actor, identifier(match[1]));
        const collection = match[2],
          key = match[3],
          action = match[4];
        if (
          request.method === "GET" &&
          !key &&
          ["episodes", "jobs", "workers", "assets", "voices"].includes(String(collection))
        ) {
          send(
            response,
            await service.list(
              context,
              collection === "voices"
                ? "voiceProfiles"
                : (collection as "episodes" | "jobs" | "workers" | "assets"),
            ),
          );
          return;
        }
        if (collection === "assets" && key && request.method === "GET") {
          const result = await service.readAsset(context, key);
          media(response, result.asset, result.bytes);
          return;
        }
        if (collection === "assets" && key && request.method === "PATCH") {
          send(response, await service.updatePortrait(context, key, await json(request)));
          return;
        }
        if (collection === "voices" && key && request.method === "PATCH") {
          send(response, await service.updateVoicePortraits(context, key, await json(request)));
          return;
        }
        if (collection === "episodes" && request.method === "POST") {
          send(response, await service.saveEpisode(context, await json(request), key));
          return;
        }
        if (collection === "jobs" && !key && request.method === "POST") {
          send(
            response,
            await service.submit(
              context,
              await json(request),
              identifier(request.headers["idempotency-key"]),
            ),
            201,
          );
          return;
        }
        if (collection === "jobs" && key && action === "retry" && request.method === "POST") {
          send(
            response,
            await service.retry(
              context,
              key,
              await json(request),
              identifier(request.headers["idempotency-key"]),
            ),
          );
          return;
        }
        if (collection === "jobs" && key && action === "cancel" && request.method === "POST") {
          send(response, await service.cancel(context, key));
          return;
        }
        if (collection === "jobs" && key && action === "accept" && request.method === "POST") {
          send(response, await service.acceptAudition(context, key));
          return;
        }
        if (collection === "workers" && key && request.method === "PATCH") {
          send(response, await service.updateWorker(context, key, await json(request)));
          return;
        }
        if (collection === "pairings" && key && action === "approve" && request.method === "POST") {
          const input = await json(request);
          limit(request, "approve", 10);
          send(
            response,
            await service.approvePairing(context, key, text(input.code, "pairing code", 6)),
          );
          return;
        }
        if (collection === "reconcile" && request.method === "POST") {
          send(response, await service.reconcile(context));
          return;
        }
        if (collection === "voices" && key && request.method === "DELETE") {
          send(response, await service.deleteVoice(context, key));
          return;
        }
        if (
          request.method === "POST" &&
          !key &&
          ["voices", "assets"].includes(String(collection))
        ) {
          if (!["owner", "admin", "editor"].includes(context.role))
            fail(403, "FORBIDDEN", "Editing access is required.");
          limit(request, "media-upload", 10);
          const bytes = await body(
            request,
            collection === "voices" ? 30 * 1024 * 1024 : 4 * 1024 * 1024,
          );
          const work = await mkdtemp(resolve(tmpdir(), "shorts-private-normalize-"));
          try {
            if (collection === "voices") {
              let input: RecordData;
              try {
                input = object(
                  JSON.parse(
                    Buffer.from(
                      text(request.headers["x-voice-metadata"], "voice metadata", 16000),
                      "base64",
                    ).toString(),
                  ),
                );
              } catch {
                fail(400, "INVALID_INPUT", "Invalid voice enrollment metadata.");
              }
              if (input.consent !== true)
                fail(
                  400,
                  "CONSENT_REQUIRED",
                  "Confirm permission to store and process this voice.",
                );
              const sample = await prepareVoiceSample(
                bytes,
                {
                  ...(typeof input.startSeconds === "number"
                    ? { startSeconds: input.startSeconds }
                    : {}),
                  ...(typeof input.endSeconds === "number" ? { endSeconds: input.endSeconds } : {}),
                },
                work,
              );
              const created = await createVoiceProfile(
                sample.bytes,
                {
                  name: text(input.name, "voice name", 64),
                  transcript: text(
                    typeof input.transcript === "string"
                      ? input.transcript.replace(/\s+/gu, " ")
                      : input.transcript,
                    "sample transcript",
                    2000,
                  ),
                  consent: true,
                  startSeconds: sample.startSeconds,
                  endSeconds: sample.endSeconds,
                },
                work,
              );
              const profile = await readVoiceProfile(created.voice, {
                root: work,
                accepted: false,
              });
              send(
                response,
                await service.saveVoice(context, input, profile.sample, { ...profile.profile }),
                201,
              );
            } else {
              await checkPortraitInput(bytes, work);
              const avatar = await saveCustomAvatar("portrait.png", bytes, work);
              const normalized = await readFile(resolve(work, "assets/avatars", avatar.imageId));
              const asset = await service.saveAsset(context, "portrait", normalized, "image/png");
              send(
                response,
                { id: asset.id, sha256: asset.sha256, imageId: `${asset.id}.png` },
                201,
              );
            }
          } catch (error) {
            console.error("Media upload preparation error:", error);
            if (error instanceof ApiError) throw error;
            fail(
              400,
              "MEDIA_INVALID",
              collection === "voices"
                ? "The voice sample could not be prepared. Use a clear 3–30-second spoken excerpt, an exact transcript, and a supported audio format. Your recording is still available in this form."
                : error instanceof Error && error.message.includes("MB")
                  ? error.message
                  : "The portrait could not be prepared. Use a valid PNG or JPEG up to 4 MB and 24 megapixels.",
            );
          } finally {
            await rm(work, { recursive: true, force: true });
          }
          return;
        }
        fail(405, "METHOD_NOT_ALLOWED", "Unsupported workspace action.");
      } catch (error) {
        const known = error instanceof ApiError;
        if (!response.headersSent)
          send(
            response,
            {
              code: known ? error.code : "REQUEST_FAILED",
              error: known
                ? error.message
                : "The request could not be completed. Check the service diagnostics.",
            },
            known ? error.status : 500,
          );
        else response.destroy();
      }
    },
  );
}
