import type { IncomingMessage, ServerResponse } from "node:http";
import { assertLocalStudioRequest } from "../media/voice-profile-api.js";
import type { WritingManager } from "./manager.js";
import { WritingError } from "./providers.js";

export async function handleWritingApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: {
    manager?: WritingManager;
    token?: string;
    deviceBusy?: () => boolean;
    readBody(request: IncomingMessage, limit?: number): Promise<unknown>;
    send(response: ServerResponse, status: number, value: unknown): void;
  },
) {
  if (!url.pathname.startsWith("/api/editorial/")) return false;
  const send = (status: number, value: unknown) => options.send(response, status, value);
  try {
    assertLocalStudioRequest(request, options.token);
  } catch {
    send(403, { error: "Open this studio on localhost to configure or use writing providers." });
    return true;
  }
  const manager = options.manager;
  if (!manager) {
    send(503, { error: "Restart the current local studio to enable Writing setup." });
    return true;
  }
  try {
    const path = url.pathname;
    if (path === "/api/editorial/status" && request.method === "GET")
      send(200, await manager.status());
    else if (path === "/api/editorial/settings" && request.method === "POST")
      send(200, await manager.configure(await options.readBody(request, 16 * 1024)));
    else if (path === "/api/editorial/catalog" && request.method === "POST") {
      const body = (await options.readBody(request, 4096)) as {
        provider?: unknown;
        settings?: unknown;
      };
      if (
        !body ||
        Object.keys(body).some((key) => !["provider", "settings"].includes(key)) ||
        (body.provider !== "local" && body.provider !== "hyperspace")
      )
        throw new Error("Choose a writing provider.");
      send(200, await manager.catalog(body.provider, body.settings));
    } else if (path === "/api/editorial/jobs" && request.method === "POST")
      send(
        202,
        await manager.start(await options.readBody(request, 128 * 1024), options.deviceBusy),
      );
    else {
      const match =
        /^\/api\/editorial\/jobs\/([a-f0-9-]{36})(\/(?:cancel|proposal|preview))?$/u.exec(path);
      if (!match) send(404, { error: "Writing action not found." });
      else if (match[2] === "/cancel" && request.method === "POST")
        send(200, await manager.cancel(match[1] as string));
      else if (["/proposal", "/preview"].includes(match[2] ?? "") && request.method === "POST") {
        const body = (await options.readBody(request, 128 * 1024)) as { snapshot?: unknown };
        if (
          !body ||
          Object.keys(body).some((key) => !["snapshot", "selector", "sourceHash"].includes(key))
        )
          throw new Error("Use the current editor snapshot to apply a proposal.");
        send(
          200,
          await (match[2] === "/preview"
            ? manager.preview(match[1] as string, body)
            : manager.proposal(match[1] as string, body)),
        );
      } else if (!match[2] && request.method === "GET") {
        const job = await manager.get(match[1] as string);
        send(job ? 200 : 404, job ?? { error: "Writing request not found." });
      } else send(405, { error: "Use the writing setup controls." });
    }
  } catch (error) {
    send(error instanceof WritingError && ["BUSY", "CONFLICT"].includes(error.code) ? 409 : 400, {
      error: error instanceof Error ? error.message : "Writing request could not finish.",
      ...(error instanceof WritingError ? { code: error.code } : {}),
    });
  }
  return true;
}
