import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { hash } from "../digest.js";
import { projectRoot } from "../paths.js";

export const faceModelSha = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
export const faceModelUrl =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
export const faceDetectorVersion = "mediapipe-0.10.32";
const packageRoot = dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision"));
const modelPath = resolve(projectRoot, ".state/face-landmarker/face_landmarker.task");
const files: Record<string, [string, string]> = {
  "vision_bundle.mjs": [resolve(packageRoot, "vision_bundle.mjs"), "text/javascript"],
  "vision_wasm_internal.js": [
    resolve(packageRoot, "wasm/vision_wasm_internal.js"),
    "text/javascript",
  ],
  "vision_wasm_internal.wasm": [
    resolve(packageRoot, "wasm/vision_wasm_internal.wasm"),
    "application/wasm",
  ],
  "vision_wasm_nosimd_internal.js": [
    resolve(packageRoot, "wasm/vision_wasm_nosimd_internal.js"),
    "text/javascript",
  ],
  "vision_wasm_nosimd_internal.wasm": [
    resolve(packageRoot, "wasm/vision_wasm_nosimd_internal.wasm"),
    "application/wasm",
  ],
  "face_landmarker.task": [modelPath, "application/octet-stream"],
};
export async function faceAsset(name: string) {
  const file = files[name];
  if (!file) throw new Error("Unknown detector asset");
  const bytes = await readFile(file[0]);
  if (name === "face_landmarker.task" && hash(bytes) !== faceModelSha)
    throw new Error("Detector model checksum mismatch. Run npm run shorts -- avatar-setup");
  return { bytes, contentType: file[1] };
}
export async function setupFaceLandmarker() {
  try {
    await faceAsset("face_landmarker.task");
    return modelPath;
  } catch {
    /* repair missing/corrupt model */
  }
  const response = await fetch(faceModelUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== faceModelSha) throw new Error("Downloaded model checksum mismatch");
  await mkdir(dirname(modelPath), { recursive: true });
  const temp = `${modelPath}.${process.pid}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, modelPath);
  } finally {
    await rm(temp, { force: true });
  }
  return modelPath;
}
