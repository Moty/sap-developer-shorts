import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateContent } from "./contracts.js";
import { buildLibrary } from "./library.js";
import { setupFaceLandmarker } from "./media/face-assets.js";
import { setupNeuralVoice } from "./media/neural.js";
import { setupTalkingHead, talkingHeadRuntime } from "./media/talking-head.js";
import { projectRoot } from "./paths.js";

const exec = promisify(execFile);

export interface MacSetupOptions {
  skipHeavyModels?: boolean;
  logger?: (msg: string) => void;
}

export async function runMacSetup(options: MacSetupOptions = {}): Promise<boolean> {
  const log = options.logger ?? console.log;
  log("==================================================");
  log("SAP Developer Shorts — Mac Local Setup & Bootstrap");
  log("==================================================\n");

  // 1. Verify Prerequisites
  log("[1/5] Checking system prerequisites...");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if ((major ?? 0) < 22 || (major === 22 && (minor ?? 0) < 13)) {
    throw new Error(`Node.js 22.13.0+ required (detected ${process.version})`);
  }
  log(`  ✓ Node.js ${process.version}`);

  for (const binary of ["ffmpeg", "ffprobe"]) {
    try {
      const { stdout } = await exec(binary, ["-version"], { cwd: projectRoot, timeout: 5000 });
      log(`  ✓ ${binary}: ${stdout.split("\n")[0]}`);
    } catch {
      throw new Error(`Missing ${binary}. Install via Homebrew: brew install ffmpeg`);
    }
  }

  try {
    const { stdout } = await exec("uv", ["--version"], { cwd: projectRoot, timeout: 5000 });
    log(`  ✓ uv: ${stdout.trim()}`);
  } catch {
    throw new Error(
      "Missing uv package manager. Install via Homebrew: brew install uv (or curl -LsSf https://astral.sh/uv/install.sh | sh)",
    );
  }

  await validateContent();
  log("  ✓ Editorial content & presentation schemas validated");

  // 2. Setup Face Landmark Detector
  log("\n[2/5] Setting up local MediaPipe face landmark detector...");
  const facePath = await setupFaceLandmarker();
  log(`  ✓ Face landmarker model ready: ${facePath}`);

  // 3. Setup Kokoro Neural Voice
  log("\n[3/5] Setting up Kokoro-82M local neural voice runtime...");
  try {
    const voiceResult = await setupNeuralVoice();
    log(`  ✓ Neural voice ready: ${voiceResult}`);
  } catch (error) {
    log(`  ⚠ Voice setup notice: ${(error as Error).message}`);
  }

  // 4. Setup Ditto Talking-Head Portrait Runtime (Apple Silicon MPS)
  log("\n[4/5] Setting up Ditto portrait animation runtime (PyTorch MPS)...");
  if (options.skipHeavyModels) {
    log("  ⏭ Skipped heavy model downloads (--skip-heavy-models)");
  } else {
    try {
      const headResult = await setupTalkingHead(log);
      log(`  ✓ Portrait runtime ready: ${headResult}`);
    } catch (error) {
      log(`  ⚠ Talking head setup warning: ${(error as Error).message}`);
    }
  }
  const runtime = await talkingHeadRuntime().catch(() => null);
  if (runtime?.installed) {
    log(
      `  ✓ Ditto runtime verified (accelerator: ${runtime.accelerator ?? "mps"}, engine: ${runtime.engine ?? "ditto-talkinghead"})`,
    );
  }

  // 5. Build Initial Local Studio Library
  log("\n[5/5] Building initial Studio Library artifact...");
  const built = await buildLibrary();
  log(`  ✓ Initial library created at: ${built.directory}`);

  log("\n==================================================");
  log("Setup Complete! Choose how you want to work:");
  log("1. Run Local UI (standalone on this Mac):");
  log("   npm run shorts -- serve\n");
  log("2. Run Local Mac Render Worker for Firebase Cloud Studio:");
  log("   npm run shorts -- firebase-worker\n");
  log("3. Export & Deploy Studio to Firebase Hosting:");
  log("   npm run shorts -- firebase-export");
  log("   npx firebase deploy --only hosting\n");
  log("4. Sync State with Firebase (Seed or Hydrate):");
  log("   npm run shorts -- firebase-sync");
  log("==================================================");

  return true;
}
