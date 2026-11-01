import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { hash } from "./digest.js";
import type { ContentEpisode } from "./domain.js";
import { projectRoot } from "./paths.js";

export interface VisualAsset {
  id: string;
  label: string;
  credit: string;
  width: number;
  height: number;
}
export interface ResolvedVisualAsset extends VisualAsset {
  bytes: Buffer;
  dataUrl: string;
}
export const visualAssetRoot = (workspace = projectRoot) =>
  resolve(workspace, ".state/visual-assets");
const idPattern = /^[a-f0-9]{64}$/u;
const plain = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max && !/[<>\p{Cc}]/u.test(value);
/** Read only supported raster headers before asking a native decoder to allocate pixels. */
export function rasterDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    const tag = bytes.toString("ascii", 12, 16);
    if (tag === "VP8X" && bytes.length >= 30)
      return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (tag === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (tag === "VP8 " && bytes.length >= 30 && bytes.toString("hex", 23, 26) === "9d012a")
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0xff || marker === 0x01 || (marker && marker >= 0xd0 && marker <= 0xd7))
        continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (
        marker &&
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      )
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      offset += length;
    }
  }
  return null;
}
async function assertRoot(root: string) {
  try {
    if (!(await lstat(root)).isDirectory())
      throw new Error("Visual asset directory must be a real directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
export async function saveVisualAsset(
  value: unknown,
  root = visualAssetRoot(),
): Promise<VisualAsset> {
  const body = value as { label?: unknown; credit?: unknown; dataUrl?: unknown };
  if (
    !body ||
    Object.keys(body).some((key) => !["label", "credit", "dataUrl"].includes(key)) ||
    !plain(body.label, 80) ||
    !(body.label as string).trim() ||
    !plain(body.credit ?? "", 120) ||
    typeof body.dataUrl !== "string"
  )
    throw new Error("Add a plain image label and optional credit.");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/u.exec(body.dataUrl);
  if (!match || body.dataUrl.length > 12 * 1024 * 1024)
    throw new Error("Upload PNG, JPEG or WebP, up to 8 MB. SVG and remote URLs are not accepted.");
  const bytes = Buffer.from(match[2] ?? "", "base64");
  const size = rasterDimensions(bytes);
  if (
    !size ||
    bytes.length > 8 * 1024 * 1024 ||
    size.width < 16 ||
    size.height < 16 ||
    size.width > 12000 ||
    size.height > 12000 ||
    size.width * size.height > 24_000_000
  )
    throw new Error("Use a valid raster image between 16 pixels and 24 megapixels.");
  const image = await loadImage(bytes);
  const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = createCanvas(
    Math.max(1, Math.round(image.width * ratio)),
    Math.max(1, Math.round(image.height * ratio)),
  );
  const context = canvas.getContext("2d");
  context.fillStyle = "#0b1222";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const normalized = canvas.toBuffer("image/jpeg", 88);
  if (normalized.length > 3 * 1024 * 1024)
    throw new Error("The normalized image is too large. Use a simpler or smaller image.");
  const id = hash(normalized);
  await assertRoot(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const asset = {
    id,
    label: (body.label as string).trim(),
    credit: String(body.credit ?? "").trim(),
    width: canvas.width,
    height: canvas.height,
  };
  // Publish completed bytes exclusively; interrupted/corrupt uploads can be repaired.
  await publishAssetFile(root, `${id}.jpg`, normalized, (existing) => hash(existing) === id);
  await publishAssetFile(root, `${id}.json`, Buffer.from(JSON.stringify(asset)), (existing) => {
    try {
      const item = JSON.parse(existing.toString("utf8"));
      return (
        item.id === id &&
        item.width === canvas.width &&
        item.height === canvas.height &&
        plain(item.label, 80) &&
        plain(item.credit, 120)
      );
    } catch {
      return false;
    }
  });
  const saved = await readVisualAsset(id, root);
  return {
    id: saved.id,
    label: saved.label,
    credit: saved.credit,
    width: saved.width,
    height: saved.height,
  };
}
async function publishAssetFile(
  root: string,
  name: string,
  bytes: Buffer,
  valid: (existing: Buffer) => boolean,
) {
  const temporary = resolve(root, `.${randomUUID()}.tmp`);
  const destination = resolve(root, name);
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await link(temporary, destination);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      try {
        const info = await lstat(destination);
        if (!info.isFile() || info.size > 3 * 1024 * 1024)
          throw new Error("Visual asset path is not a supported regular file.");
        if (valid(await readFile(destination))) return;
        await rename(destination, resolve(root, `.damaged-${name}-${randomUUID()}`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw new Error("Another image upload is updating this asset. Try again.");
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function readVisualAsset(
  id: string,
  root = visualAssetRoot(),
): Promise<ResolvedVisualAsset> {
  if (!idPattern.test(id)) throw new Error("Invalid presentation image reference.");
  await assertRoot(root);
  for (const name of [`${id}.jpg`, `${id}.json`]) {
    const file = await lstat(resolve(root, name));
    if (!file.isFile() || file.size > 3 * 1024 * 1024)
      throw new Error("Invalid presentation image file.");
  }
  const bytes = await readFile(resolve(root, `${id}.jpg`));
  const metadata = JSON.parse(await readFile(resolve(root, `${id}.json`), "utf8")) as VisualAsset;
  const size = rasterDimensions(bytes);
  if (
    hash(bytes) !== id ||
    metadata.id !== id ||
    !plain(metadata.label, 80) ||
    !plain(metadata.credit, 120) ||
    metadata.width !== size?.width ||
    metadata.height !== size.height
  )
    throw new Error("Presentation image changed. Restore the original image before producing.");
  return { ...metadata, bytes, dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` };
}
export async function listVisualAssets(root = visualAssetRoot()): Promise<VisualAsset[]> {
  await assertRoot(root);
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const assets: VisualAsset[] = [];
  for (const name of names.filter((name) => /^[a-f0-9]{64}\.json$/u.test(name)).sort()) {
    try {
      const { id, label, credit, width, height } = await readVisualAsset(name.slice(0, -5), root);
      assets.push({ id, label, credit, width, height });
    } catch {
      /* Damaged images remain on disk but cannot be selected. */
    }
  }
  return assets;
}
export async function resolveVisualAssets(
  episode: ContentEpisode,
  root = visualAssetRoot(),
  allowMissing = false,
) {
  const ids = [
    ...new Set(
      episode.presentation?.design?.scenes.flatMap((scene) =>
        scene.image ? [scene.image.assetId] : [],
      ) ?? [],
    ),
  ];
  return Object.fromEntries(
    (
      await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, await readVisualAsset(id, root)] as const;
          } catch (error) {
            if (!allowMissing) throw error;
            return null;
          }
        }),
      )
    ).filter((item): item is readonly [string, ResolvedVisualAsset] => item !== null),
  );
}
