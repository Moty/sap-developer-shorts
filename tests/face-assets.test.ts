import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { loadAvatarImage, saveCustomAvatar } from "../src/media/avatar.js";
import { faceAsset } from "../src/media/face-assets.js";
import { projectRoot } from "../src/paths.js";
import { startPreviewServer } from "../src/serve.js";

test("detector serves only allowlisted local assets with browser module and wasm MIME types", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "face-assets-"));
  const server = await startPreviewServer(root, 0);
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.server.close((error) => (error ? reject(error) : resolve()));
      server.server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  });
  for (const [name, type] of [
    ["vision_bundle.mjs", "text/javascript"],
    ["vision_wasm_internal.wasm", "application/wasm"],
  ]) {
    const response = await fetch(new URL(`/api/face-assets/${name}`, server.url));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), type);
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
  await assert.rejects(faceAsset("../../package.json"));
  const missing = await fetch(new URL("/api/face-assets/unknown.task", server.url));
  assert.equal(missing.status, 404);
});

test("changed portrait bytes cannot render with a saved automatic calibration", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "face-binding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b59778";
  ctx.fillRect(0, 0, 64, 64);
  const saved = await saveCustomAvatar("portrait", await canvas.encode("png"), root);
  await loadAvatarImage(saved.imageId, root, saved.sha256);
  ctx.fillStyle = "#886655";
  ctx.fillRect(0, 0, 64, 64);
  await saveCustomAvatar("portrait", await canvas.encode("png"), root);
  await assert.rejects(
    loadAvatarImage(saved.imageId, root, saved.sha256),
    /changed since mouth detection/,
  );
  await loadAvatarImage(saved.imageId, root);
});

test("face model stays optional and outside portable studios", async () => {
  const ignore = await readFile(resolve(projectRoot, ".gitignore"), "utf8");
  assert.match(ignore, /\.state\//);
});
