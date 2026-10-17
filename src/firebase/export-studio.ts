import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readContentEpisode } from "../contracts.js";
import { hash } from "../digest.js";
import { buildLibrary } from "../library.js";
import { listCustomAvatars, resolveAvatarPath } from "../media/avatar.js";
import { assertCloudLibrarySafe } from "../media/cloud-voice-safety.js";
import { faceAsset } from "../media/face-assets.js";
import { talkingHeadRuntime } from "../media/talking-head.js";
import { installedKokoroVoices } from "../media/voice-audition.js";
import { kokoroVoices } from "../media/voices.js";
import { projectRoot } from "../paths.js";
import { latestProduction } from "../production.js";
import {
  readWorkflowManifest,
  workflowDirectory,
  workflowSourcesExpired,
  workflowState,
} from "../workflow.js";
import { renderFirebaseBridgeScript } from "./client-bridge.js";
import { type FirebaseClientConfig, loadFirebaseConfig } from "./config.js";

export interface ExportStudioResult {
  readonly outputDirectory: string;
  readonly sourceLibraryDirectory: string;
  readonly patchedHtmlFiles: string[];
  readonly bundledAvatars: string[];
  readonly faceAssetsBundled: boolean;
}

const cloudCspReplacement = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.firebasestorage.app",
  "media-src 'self' blob: data: https://*.googleapis.com https://*.firebasestorage.app",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasestorage.app",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function patchHtmlForFirebaseStudio(
  html: string,
  bridgeScriptPath = "/firebase-bridge.js",
): string {
  // 1. Expand Content-Security-Policy ONLY in the exported dist/studio copy
  const withCloudCsp = html.replace(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/?>/iu,
    `<meta http-equiv="Content-Security-Policy" content="${cloudCspReplacement}">`,
  );

  // 2. Inject /firebase-bridge.js before the first executable script tag
  if (withCloudCsp.includes(bridgeScriptPath)) return withCloudCsp;
  const scriptMatch = /<script(?![^>]*type=["']application\/json["'])[^>]*>/iu.exec(withCloudCsp);
  if (scriptMatch) {
    return withCloudCsp.replace(
      scriptMatch[0],
      `<script src="${bridgeScriptPath}"></script>\n    ${scriptMatch[0]}`,
    );
  }
  return withCloudCsp.replace(
    /<\/head>/iu,
    `  <script src="${bridgeScriptPath}"></script>\n</head>`,
  );
}

async function findLatestLibraryDirectory(artifactRoot: string): Promise<string> {
  try {
    const entries = await readdir(artifactRoot, { withFileTypes: true });
    const libraries = entries
      .filter(
        (e) =>
          e.isDirectory() && /^library-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(e.name),
      )
      .map((e) => resolve(artifactRoot, e.name));
    if (libraries.length) {
      const stats = await Promise.all(libraries.map(async (p) => ({ p, s: await stat(p) })));
      stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
      if (stats[0]?.p) return stats[0].p;
    }
  } catch {
    /* build fresh library below */
  }
  const built = await buildLibrary({ artifactRoot });
  return built.directory;
}

async function walkHtmlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkHtmlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push(full);
    }
  }
  return results;
}

export async function buildInitialWorkflowSnapshot(libraryDir: string, artifactRoot: string) {
  const manifest = await readWorkflowManifest(libraryDir);
  const root = workflowDirectory(artifactRoot);
  const episodes = await Promise.all(
    manifest.episodes.map(async (entry) => {
      const videoHash = manifest.artifactHashes[`episodes/${entry.selector}/video/short.mp4`];
      const state = await workflowState(root, entry, videoHash);
      const report = await latestProduction(entry.selector, artifactRoot);
      const episode = await readContentEpisode(entry.selector);
      const changed = hash(JSON.stringify(episode)) !== entry.inputHash;
      const expired = entry.sourceReviewExpired || workflowSourcesExpired(episode);
      const issue = changed
        ? "The script changed. Rebuild the studio and produce this version."
        : expired
          ? "Sources need rechecking before sharing current news."
          : report?.issue?.message;
      return {
        selector: entry.selector,
        renderKey: entry.video?.renderKey ?? null,
        inputHash: entry.inputHash,
        videoHash: videoHash ?? null,
        ...state,
        ...(changed ? { stage: "editing", label: "Editing" } : {}),
        reviewBlocked: changed || expired,
        attention: Boolean(
          expired || issue || (entry.preview?.kind === "narrated" && !entry.preview.timingReady),
        ),
        issue: issue ?? null,
      };
    }),
  );
  return { episodes, activeJob: null };
}

export async function exportStudioForFirebase(
  options: {
    libraryDirectory?: string;
    outputDirectory?: string;
    artifactRoot?: string;
    firebaseConfig?: FirebaseClientConfig;
  } = {},
): Promise<ExportStudioResult> {
  const artifactRoot = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );
  const sourceLibraryDirectory =
    options.libraryDirectory ?? (await findLatestLibraryDirectory(artifactRoot));
  const outputDirectory = resolve(projectRoot, options.outputDirectory ?? "dist/studio");
  const firebaseConfig = options.firebaseConfig ?? (await loadFirebaseConfig());

  await assertCloudLibrarySafe(sourceLibraryDirectory);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(sourceLibraryDirectory, outputDirectory, { recursive: true });

  // 1. Write /firebase-bridge.js
  const bridgeJs = renderFirebaseBridgeScript(firebaseConfig);
  await writeFile(resolve(outputDirectory, "firebase-bridge.js"), bridgeJs, "utf8");

  // 2. Bundle static API snapshots (/api-static/*)
  const apiStaticDir = resolve(outputDirectory, "api-static");
  const avatarsStaticDir = resolve(apiStaticDir, "avatars");
  await mkdir(avatarsStaticDir, { recursive: true });

  const workflowSnapshot = await buildInitialWorkflowSnapshot(sourceLibraryDirectory, artifactRoot);
  await writeFile(
    resolve(apiStaticDir, "workflow.json"),
    `${JSON.stringify(workflowSnapshot, null, 2)}\n`,
    "utf8",
  );

  const installedVoices = await installedKokoroVoices().catch(() => [] as string[]);
  await writeFile(
    resolve(apiStaticDir, "voices.json"),
    `${JSON.stringify(
      {
        voices: kokoroVoices.map((v) => ({
          ...v,
          installed: installedVoices.includes(v.id),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const portraitStatus = await talkingHeadRuntime().catch(() => ({
    ready: false,
    engine: "ditto-talkinghead",
  }));
  await writeFile(
    resolve(apiStaticDir, "portrait-status.json"),
    `${JSON.stringify(portraitStatus, null, 2)}\n`,
    "utf8",
  );

  const customAvatars = await listCustomAvatars();
  await writeFile(
    resolve(apiStaticDir, "avatars.json"),
    `${JSON.stringify({ avatars: customAvatars }, null, 2)}\n`,
    "utf8",
  );
  for (const imageId of customAvatars) {
    try {
      const srcPath = await resolveAvatarPath(imageId);
      await cp(srcPath, resolve(avatarsStaticDir, imageId));
    } catch {
      /* ignore unreadable avatar */
    }
  }

  // 3. Bundle MediaPipe face assets directly under /api/face-assets/* so native ES module `import('/api/face-assets/vision_bundle.mjs')` works on Firebase Hosting
  const faceAssetsOutDir = resolve(outputDirectory, "api/face-assets");
  await mkdir(faceAssetsOutDir, { recursive: true });
  let faceAssetsBundled = true;
  for (const assetName of [
    "vision_bundle.mjs",
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_nosimd_internal.js",
    "vision_wasm_nosimd_internal.wasm",
    "face_landmarker.task",
  ]) {
    try {
      const { bytes } = await faceAsset(assetName);
      await writeFile(resolve(faceAssetsOutDir, assetName), bytes);
    } catch {
      faceAssetsBundled = false;
    }
  }

  // 4. Patch HTML files in dist/studio with Cloud CSP + /firebase-bridge.js
  const htmlFiles = await walkHtmlFiles(outputDirectory);
  const patchedHtmlFiles: string[] = [];
  for (const htmlFile of htmlFiles) {
    const original = await readFile(htmlFile, "utf8");
    const patched = patchHtmlForFirebaseStudio(original, "/firebase-bridge.js");
    if (patched !== original) {
      await writeFile(htmlFile, patched, "utf8");
      patchedHtmlFiles.push(htmlFile);
    }
  }

  return {
    outputDirectory,
    sourceLibraryDirectory,
    patchedHtmlFiles,
    bundledAvatars: customAvatars,
    faceAssetsBundled,
  };
}
