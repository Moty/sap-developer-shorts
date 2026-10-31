import type { IncomingMessage, ServerResponse } from "node:http";
import { creatorRoot, readCreatorRecord, writeCreatorRecord } from "./creator-store.js";
import { finishedReviewKit, parseFinishedReview } from "./finished-review.js";
import {
  compareLibraryVersions,
  saveStoryMetadata,
  verifiedLibraryVideo,
} from "./library-management.js";
import { assertLocalStudioRequest } from "./media/voice-profile-api.js";
import {
  applyProductionPreset,
  assertPresetVoiceAssets,
  type ProductionPreset,
  saveProductionPreset,
} from "./production-presets.js";
import { listVisualAssets, readVisualAsset, saveVisualAsset } from "./visual-assets.js";
import { visualPreview } from "./visual-preview.js";
import { workflowDirectory } from "./workflow.js";

export async function handleCreatorApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: {
    token?: string;
    artifactRoot?: string;
    directory?: string;
    readBody(request: IncomingMessage, limit?: number): Promise<unknown>;
    send(response: ServerResponse, status: number, value: unknown): void;
  },
) {
  if (!url.pathname.startsWith("/api/creator/")) return false;
  const send = (status: number, value: unknown) => options.send(response, status, value);
  try {
    assertLocalStudioRequest(request, options.token);
  } catch {
    send(403, { error: "Open the current local studio to use these tools." });
    return true;
  }
  try {
    if (!options.directory) throw new Error("Reopen the current studio.");
    const selector = url.searchParams.get("selector") ?? "";
    if (url.pathname === "/api/creator/visual-preview" && request.method === "POST") {
      send(
        200,
        await visualPreview(
          await options.readBody(request, 128 * 1024),
          options.directory,
          options.artifactRoot,
        ),
      );
    } else if (url.pathname === "/api/creator/visual-assets") {
      if (request.method === "GET") send(200, { assets: await listVisualAssets() });
      else if (request.method === "POST") {
        const asset = await saveVisualAsset(await options.readBody(request, 12 * 1024 * 1024));
        send(200, { asset, assets: await listVisualAssets() });
      } else send(405, { error: "Use the visual library controls." });
    } else if (url.pathname.startsWith("/api/creator/visual-assets/") && request.method === "GET") {
      const asset = await readVisualAsset(url.pathname.slice("/api/creator/visual-assets/".length));
      response.writeHead(200, {
        "content-type": "image/jpeg",
        "content-length": asset.bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(asset.bytes);
    } else if (url.pathname === "/api/creator/video" && request.method === "GET") {
      const bytes = await verifiedLibraryVideo(
        options.directory,
        selector,
        url.searchParams.get("renderKey") ?? "",
        url.searchParams.get("videoHash") ?? "",
      );
      const range = request.headers.range;
      const match = range ? /^bytes=(\d+)-(\d*)$/u.exec(range) : null;
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : bytes.length - 1;
      if (
        range &&
        (!match ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          end >= bytes.length)
      ) {
        response.writeHead(416, { "content-range": `bytes */${bytes.length}` });
        response.end();
      } else {
        response.writeHead(range ? 206 : 200, {
          "content-type": "video/mp4",
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
          "accept-ranges": "bytes",
          "content-length": end - start + 1,
          ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        });
        response.end(bytes.subarray(start, end + 1));
      }
    } else if (url.pathname === "/api/creator/library") {
      const root = creatorRoot(options.artifactRoot);
      if (request.method === "GET")
        send(200, { stories: (await readCreatorRecord(root, "library")) ?? {} });
      else if (request.method === "POST") {
        const body = (await options.readBody(request, 4096)) as {
          id?: unknown;
          metadata?: unknown;
        };
        if (!body || Object.keys(body).some((key) => !["id", "metadata"].includes(key)))
          throw new Error("Use the story organization controls.");
        send(200, {
          stories: await saveStoryMetadata(root, options.directory, body.id, body.metadata),
        });
      } else send(405, { error: "Use the library controls." });
    } else if (url.pathname === "/api/creator/compare" && request.method === "GET") {
      send(200, {
        versions: await compareLibraryVersions(
          options.directory,
          workflowDirectory(options.artifactRoot),
          [url.searchParams.get("left") ?? "", url.searchParams.get("right") ?? ""],
        ),
      });
    } else if (url.pathname === "/api/creator/presets") {
      const root = creatorRoot(options.artifactRoot);
      if (request.method === "GET")
        send(200, { presets: (await readCreatorRecord(root, "presets")) ?? [] });
      else if (request.method === "POST") {
        const body = (await options.readBody(request, 128 * 1024)) as {
          action?: string;
          name?: unknown;
          definition?: unknown;
          id?: unknown;
        };
        if (
          !body ||
          Object.keys(body).some((key) => !["action", "name", "definition", "id"].includes(key))
        )
          throw new Error("Use the preset controls.");
        if (body.action === "save")
          send(200, { presets: await saveProductionPreset(root, body.name, body.definition) });
        else if (body.action === "apply") {
          const presets = (await readCreatorRecord(root, "presets")) as ProductionPreset[] | null;
          const preset = presets?.find((item) => item.id === body.id);
          if (!preset) throw new Error("Choose a saved preset.");
          const definition = await applyProductionPreset(preset, body.definition);
          await assertPresetVoiceAssets(definition);
          send(200, { definition });
        } else throw new Error("Choose save or apply.");
      } else send(405, { error: "Use the preset controls." });
    } else if (url.pathname === "/api/creator/output-review") {
      const kit = await finishedReviewKit(options.directory, selector);
      if (url.searchParams.get("renderKey") !== kit.renderKey)
        throw new Error(
          "This page shows an older render. Reload before reviewing the current MP4.",
        );
      const root = creatorRoot(options.artifactRoot);
      if (request.method === "GET") {
        const saved = await readCreatorRecord(root, `review:${selector}`);
        let review = null;
        try {
          if (saved) review = parseFinishedReview(saved, kit);
        } catch {
          /* Old MP4 review remains private but is not applied. */
        }
        send(200, { kit, review, stale: Boolean(saved && !review) });
      } else if (request.method === "POST") {
        const review = parseFinishedReview(await options.readBody(request, 128 * 1024), kit);
        await writeCreatorRecord(root, `review:${selector}`, review);
        send(200, { review });
      } else send(405, { error: "Use the review controls." });
    } else send(404, { error: "Studio tool not found." });
  } catch (error) {
    send(400, { error: (error as Error).message });
  }
  return true;
}
