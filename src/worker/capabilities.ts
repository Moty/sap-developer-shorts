import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type Capability, digest } from "../cloud/contracts.js";
import { withModelLock } from "../media/model-lock.js";
import { neuralRuntime } from "../media/neural.js";
import { qwenRuntime } from "../media/qwen.js";
import { talkingHeadRuntime } from "../media/talking-head.js";
import { installedKokoroVoices } from "../media/voice-audition.js";
import { projectRoot } from "../paths.js";

const exec = promisify(execFile);
export async function portableRuntime(kind: "qwen-mlx" | "kokoro" | "ditto-mps") {
  const folder =
    kind === "qwen-mlx" ? "qwen-voice" : kind === "kokoro" ? "neural-voice" : "portrait-runtime";
  const runtime = JSON.parse(
    await readFile(resolve(projectRoot, ".state", folder, "runtime.json"), "utf8"),
  );
  const code =
    kind === "qwen-mlx"
      ? [
          "src/media/qwen-runner.py",
          "src/media/qwen.ts",
          "src/media/local-voices.ts",
          "src/media/audio.ts",
          "src/media/voice-profiles.ts",
          "config/qwen-voice.json",
          "config/qwen-voice-requirements.txt",
        ]
      : kind === "kokoro"
        ? ["src/media/kokoro-runner.py", "config/neural-voice.json"]
        : ["src/media/portrait-runner.py", "config/portrait-runtime.json"];
  const files = await Promise.all(
    code.map(async (name) => [name, digest(await readFile(resolve(projectRoot, name)))]),
  );
  return digest(
    JSON.stringify({
      kind,
      files,
      filesInstalled: Array.isArray(runtime.files)
        ? runtime.files.map((file: { path: string; sha256: string; size: number }) => ({
            path: file.path,
            sha256: file.sha256,
            size: file.size,
          }))
        : Object.entries(runtime.files ?? {}).map(([role, file]) => ({
            role,
            sha256: (file as { sha256: string }).sha256,
          })),
      voices: Object.entries(runtime.voices ?? {}).map(([voice, file]) => ({
        voice,
        sha256: (file as { sha256: string }).sha256,
      })),
      packages: runtime.packages ?? {},
      sourceHashes: runtime.sourceHashes ?? {},
      spec: runtime.specSha256 ?? runtime.configHash ?? "",
    }),
  );
}
export async function detectCapabilities(): Promise<Capability[]> {
  const result: Capability[] = [];
  try {
    await exec("ffmpeg", ["-version"]);
    await exec("ffprobe", ["-version"]);
    result.push({
      engine: "video-compose",
      digest: digest(await readFile(resolve(projectRoot, "src/video/export.ts"))),
    });
  } catch {}
  try {
    const voices = await installedKokoroVoices();
    await neuralRuntime(voices);
    result.push({ engine: "kokoro", digest: await portableRuntime("kokoro"), voices });
  } catch {}
  try {
    await qwenRuntime();
    result.push({ engine: "qwen-mlx", digest: await portableRuntime("qwen-mlx") });
  } catch {}
  try {
    if ((await talkingHeadRuntime()).installed)
      result.push({ engine: "ditto-mps", digest: await portableRuntime("ditto-mps") });
  } catch {}
  return result;
}
export async function modelBusy() {
  try {
    await withModelLock(async () => {});
    return false;
  } catch {
    return true;
  }
}
