import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { inside } from "./paths.js";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".wav": "audio/wav",
  ".vtt": "text/vtt; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

export async function startPreviewServer(directory: string, port = 4173) {
  const root = await realpath(directory);
  async function respond(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let path: string;
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const name = pathname === "/" ? "review.html" : pathname.slice(1);
      if (name.split("/").some((part) => part.startsWith("."))) throw new Error("Hidden path");
      path = inside(root, await realpath(inside(root, name)));
    } catch {
      response.writeHead(404).end();
      return;
    }
    const file = await stat(path);
    if (!file.isFile()) {
      response.writeHead(404).end();
      return;
    }
    const headers: Record<string, string | number> = {
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    let start = 0;
    let end = file.size - 1;
    let status = 200;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range);
      let valid = Boolean(match && (match[1] || match[2]));
      if (match) {
        if (!match[1]) {
          const suffix = Number(match[2]);
          start = Math.max(0, file.size - suffix);
          valid = valid && suffix > 0;
        } else {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
        }
      }
      valid =
        valid &&
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start <= end &&
        start < file.size;
      if (!valid) {
        response.writeHead(416, { "content-range": `bytes */${file.size}` }).end();
        return;
      }
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${file.size}`;
    }
    headers["content-length"] = Math.max(0, end - start + 1);
    response.writeHead(status, headers);
    if (request.method === "HEAD" || !file.size) {
      response.end();
      return;
    }
    createReadStream(path, { start, end })
      .on("error", () => response.destroy())
      .pipe(response);
  }
  const server = createServer((request, response) => {
    void respond(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Preview server did not bind a port");
  return { server, url: `http://127.0.0.1:${address.port}/review.html` };
}
