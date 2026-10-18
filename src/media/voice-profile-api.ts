import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { withModelLock } from "./model-lock.js";
import { acceptClonedVoice, auditionClonedVoice, qwenStatus } from "./qwen.js";
import {
  createVoiceProfile,
  deleteVoiceProfile,
  listVoiceProfiles,
  maximumSampleBytes,
  readVoiceProfile,
} from "./voice-profiles.js";
import { isClonedVoice } from "./voice-reference.js";

interface PrivateApiOptions {
  token?: string;
  busy?: boolean;
  readBody(request: IncomingMessage, limit?: number): Promise<unknown>;
  send(response: ServerResponse, status: number, value: unknown): void;
}
function isLocalRequest(request: IncomingMessage) {
  const address = request.socket.remoteAddress;
  const origin = request.headers.origin;
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address ?? "") &&
    /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/u.test(request.headers.host ?? "") &&
    (!request.headers["sec-fetch-site"] || request.headers["sec-fetch-site"] === "same-origin") &&
    (!origin || new URL(origin).host === request.headers.host)
  );
}
export function assertPrivateVoiceRequest(request: IncomingMessage, token?: string) {
  if (
    !token ||
    !isLocalRequest(request) ||
    !request.headers.cookie
      ?.split(";")
      .some((cookie) => cookie.trim() === `shorts_voice_session=${token}`)
  )
    throw new Error("Open this studio on localhost to use a private voice profile.");
  if (request.method === "POST" && !request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Use the local studio's JSON voice controls.");
}
export async function handleVoiceProfileApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: PrivateApiOptions,
) {
  if (!url.pathname.startsWith("/api/local-voices")) return false;
  try {
    if (url.pathname === "/api/local-voices/session" && request.method === "GET") {
      if (!options.token || !isLocalRequest(request))
        throw new Error("My voice is available in the localhost studio.");
      response.setHeader(
        "set-cookie",
        `shorts_voice_session=${options.token}; HttpOnly; SameSite=Strict; Path=/api/`,
      );
      options.send(response, 200, { local: true });
      return true;
    }
    assertPrivateVoiceRequest(request, options.token);
    if (url.pathname === "/api/local-voices" && request.method === "GET") {
      const [runtime, profiles] = await Promise.all([qwenStatus(), listVoiceProfiles()]);
      options.send(response, 200, {
        runtime,
        profiles: profiles.map((profile) => {
          const auditionReady = !!(
            runtime.ready &&
            "hash" in runtime &&
            profile.audition?.runtimeHash === runtime.hash
          );
          return { ...profile, auditionReady, accepted: profile.accepted && auditionReady };
        }),
      });
      return true;
    }
    if (url.pathname === "/api/local-voices/audio" && request.method === "GET") {
      const voice = JSON.parse(url.searchParams.get("voice") ?? "null");
      if (!isClonedVoice(voice)) throw new Error("Choose a saved voice profile.");
      const saved = await readVoiceProfile(voice, { accepted: false });
      const audio =
        url.searchParams.get("kind") === "audition"
          ? await readFile(resolve(saved.directory, "audition.wav"))
          : saved.sample;
      response.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": audio.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(audio);
      return true;
    }
    if (request.method !== "POST") {
      options.send(response, 405, { error: "Use a supported voice action." });
      return true;
    }
    if (options.busy)
      throw new Error("Wait for the current production to finish before changing voice profiles.");
    const body = (await options.readBody(request, Math.ceil(maximumSampleBytes * 1.4))) as Record<
      string,
      unknown
    >;
    if (url.pathname === "/api/local-voices/enroll") {
      if (
        typeof body.audio !== "string" ||
        body.audio.length > maximumSampleBytes * 1.4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(body.audio)
      )
        throw new Error("Choose a valid audio recording up to 30 MiB.");
      const bytes = Buffer.from(body.audio, "base64");
      const result = await withModelLock(() =>
        createVoiceProfile(bytes, {
          name: body.name as string,
          transcript: body.transcript as string,
          consent: body.consent === true,
          ...(body.startSeconds !== undefined ? { startSeconds: body.startSeconds as number } : {}),
          ...(body.endSeconds !== undefined ? { endSeconds: body.endSeconds as number } : {}),
        }),
      );
      options.send(response, 200, result);
      return true;
    }
    if (!isClonedVoice(body.voice)) throw new Error("Choose a saved voice profile.");
    const voice = body.voice;
    if (url.pathname === "/api/local-voices/audition") {
      const result = await auditionClonedVoice(voice);
      options.send(response, 200, { durationSeconds: result.alignment.frames / 22050 });
    } else if (url.pathname === "/api/local-voices/accept") {
      await withModelLock(() => acceptClonedVoice(voice));
      options.send(response, 200, { accepted: true });
    } else if (url.pathname === "/api/local-voices/delete") {
      await withModelLock(() => deleteVoiceProfile(voice));
      options.send(response, 200, { deleted: true });
    } else options.send(response, 404, { error: "Unknown local voice action." });
  } catch (error) {
    options.send(response, 400, { error: (error as Error).message });
  }
  return true;
}
