import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { validateContent } from "./contracts.js";
import { projectRoot } from "./paths.js";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);

export async function doctor(): Promise<boolean> {
  let healthy = true;
  const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "OK" : "FAIL"} ${label}: ${detail}`);
    if (!ok) healthy = false;
  };
  const [major, minor] = process.versions.node.split(".").map(Number);
  check(
    "Node.js",
    (major ?? 0) > 22 || (major === 22 && (minor ?? 0) >= 13),
    `${process.version} (22.13+ required)`,
  );
  for (const name of ["@sap/cds", "@cap-js/sqlite"]) {
    try {
      const pkg = require(`${name}/package.json`) as { version: string };
      check(name, true, pkg.version);
    } catch {
      check(name, false, "run npm ci at the project root");
    }
  }
  try {
    const content = await validateContent();
    check("Content", true, `${content.topics.length} topics; ${content.episodes.length} episode`);
  } catch (error) {
    check("Content", false, error instanceof Error ? error.message : "Invalid content");
  }
  for (const binary of ["ffmpeg", "ffprobe"]) {
    try {
      const { stdout } = await exec(binary, ["-version"], { cwd: projectRoot, timeout: 5000 });
      console.log(`OPTIONAL ${binary}: ${stdout.split("\n")[0]}`);
    } catch {
      console.log(`OPTIONAL ${binary}: missing; needed for the later video rendering stage`);
    }
  }
  const { talkingHeadRuntime } = await import("./media/talking-head.js");
  const portrait = await talkingHeadRuntime();
  console.log(
    portrait.installed
      ? `OPTIONAL Portrait: local Ditto models ready (${portrait.accelerator}); output quality still needs review.`
      : "OPTIONAL Portrait: run npm run shorts -- talking-head-setup for realistic photo narration.",
  );
  try {
    const { qwenRuntime } = await import("./media/qwen.js");
    const qwen = await qwenRuntime();
    console.log(`OPTIONAL Voice Clone: local Qwen models ready (${qwen.engine}).`);
  } catch {
    console.log(
      "OPTIONAL Voice Clone: run npm run shorts -- voice-clone-setup for personal voice cloning.",
    );
  }
  console.log("Publishing: not connected.");
  return healthy;
}
