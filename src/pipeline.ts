import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { validateEpisode, validateEvidence } from "./contracts.js";
import { demos } from "./demos.js";
import { hash } from "./digest.js";
import { type ContentEpisode, type DemoEvidence, type Episode, isNewsEpisode } from "./domain.js";
import { projectRoot, sourceFile } from "./paths.js";
import { episodeSourceFiles } from "./presentation.js";
import { assertInventory, readRuntimeFiles } from "./provenance.js";
import { createReview } from "./review.js";

const exec = promisify(execFile);

export { hash } from "./digest.js";

export interface Manifest {
  schemaVersion: 1;
  runId: string;
  episodeId: string;
  episodeVersion: number;
  inputHash: string;
  startedAt: string;
  updatedAt: string;
  stage:
    | "VALIDATED"
    | "VERIFYING"
    | "TECH_VERIFIED"
    | "SOURCES_CHECKED"
    | "PREVIEW_READY"
    | "FAILED";
  sourceHashes: Record<string, string>;
  runtimeHashes: Record<string, string>;
  artifactHashes: Record<string, string>;
  history: { stage: Manifest["stage"]; at: string }[];
  error?: string;
}

export async function prepareContentEpisode(input: ContentEpisode, options: RunOptions = {}) {
  if (isNewsEpisode(input)) {
    return (await import("./news/pipeline.js")).prepareNewsEpisode(input, options);
  }
  return prepareEpisode(input, options);
}

export function assertEvidence(value: unknown, episode: Episode): asserts value is DemoEvidence {
  const evidence = validateEvidence(value);
  if (
    evidence.demoId !== episode.demo.id ||
    evidence.checks.length !== episode.demo.expectedChecks.length ||
    !episode.demo.expectedChecks.every((check) => evidence.checks.includes(check))
  ) {
    throw new Error("Demo evidence is incomplete or does not match the episode checks");
  }
}

export async function runDemo(episode: Episode, directory: string): Promise<DemoEvidence> {
  const demo = demos[episode.demo.id];
  const output = resolve(directory, "demo-evidence.json");
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [await sourceFile(demo.runner), output],
      {
        cwd: await sourceFile(demo.directory),
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: "development" },
      },
    );
    await writeFile(resolve(directory, "demo.log"), `${stdout}${stderr}`);
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    await writeFile(
      resolve(directory, "demo.log"),
      `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    );
    throw new Error("CAP verification failed. See demo.log in the run directory.", {
      cause: error,
    });
  }
  const evidence: unknown = JSON.parse(await readFile(output, "utf8"));
  assertEvidence(evidence, episode);
  return evidence;
}

export interface RunOptions {
  preview?: boolean;
  artifactRoot?: string;
  verifier?: typeof runDemo;
}

export async function prepareEpisode(input: Episode, options: RunOptions = {}) {
  const episode = structuredClone(validateEpisode(input));
  const runId = `${episode.id}-v${episode.version}-${randomUUID()}`;
  const artifactRoot = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );
  const directory = resolve(artifactRoot, runId);
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(directory);
  const startedAt = new Date().toISOString();
  const manifest: Manifest = {
    schemaVersion: 1,
    runId,
    episodeId: episode.id,
    episodeVersion: episode.version,
    inputHash: hash(JSON.stringify(episode)),
    startedAt,
    updatedAt: startedAt,
    stage: "VALIDATED",
    sourceHashes: {},
    runtimeHashes: {},
    artifactHashes: {},
    history: [{ stage: "VALIDATED", at: startedAt }],
  };
  const persist = async (stage: Manifest["stage"]) => {
    manifest.stage = stage;
    manifest.updatedAt = new Date().toISOString();
    if (manifest.history.at(-1)?.stage !== stage) {
      manifest.history.push({ stage, at: manifest.updatedAt });
    }
    const temporary = resolve(directory, "manifest.tmp");
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, resolve(directory, "manifest.json"));
  };
  await persist("VALIDATED");
  const demo = demos[episode.demo.id];
  const inventory = demo.files
    .filter((file) => file.startsWith(`${demo.directory}/`))
    .map((file) => file.slice(demo.directory.length + 1));
  const checkInventory = async () => assertInventory(await sourceFile(demo.directory), inventory);
  const checkHashes = async () => {
    await checkInventory();
    for (const [file, expected] of Object.entries({
      ...manifest.sourceHashes,
      ...manifest.runtimeHashes,
    })) {
      if (hash(await readFile(await sourceFile(file))) !== expected) {
        throw new Error(`Input changed during the run: ${file}; run again`);
      }
    }
  };
  try {
    await writeFile(resolve(directory, "episode.json"), `${JSON.stringify(episode, null, 2)}\n`);
    manifest.artifactHashes["episode.json"] = hash(
      await readFile(resolve(directory, "episode.json")),
    );
    const sourceFiles = [
      ...episodeSourceFiles(episode),
      ...demos[episode.demo.id].files,
      "config/video-layout.json",
      "templates/review.css",
      "templates/review-player.js",
      "schemas/episode.schema.json",
      "schemas/demo-evidence.schema.json",
      "schemas/video-layout.schema.json",
      "src/review.ts",
      "config/production.json",
      "schemas/narration-timing.schema.json",
    ];
    await checkInventory();
    for (const file of sourceFiles) {
      manifest.sourceHashes[file] = hash(await readFile(await sourceFile(file)));
    }
    for (const [file, content] of Object.entries(await readRuntimeFiles())) {
      manifest.runtimeHashes[file] = hash(content);
    }
    await persist("VERIFYING");
    const evidence = await (options.verifier ?? runDemo)(episode, directory);
    assertEvidence(evidence, episode);
    const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(resolve(directory, "demo-evidence.json"), evidenceText);
    manifest.artifactHashes["demo-evidence.json"] = hash(evidenceText);
    // The sources shown in a review must match the sources tested in this run.
    await checkHashes();
    await persist("TECH_VERIFIED");
    if (options.preview) {
      const reviewFiles = await createReview(episode, evidence);
      for (const [name, content] of Object.entries(reviewFiles)) {
        await writeFile(resolve(directory, name), content, { flag: "wx" });
        manifest.artifactHashes[name] = hash(content);
      }
      await checkHashes();
      await persist("PREVIEW_READY");
    }
    return { directory, manifest, evidence };
  } catch (error) {
    manifest.error = error instanceof Error ? error.message : "Unknown failure";
    await persist("FAILED");
    throw new Error(`${manifest.error}\nRun: ${directory}`, { cause: error });
  }
}
