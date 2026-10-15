import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "../digest.js";
import type { NewsEpisode } from "../domain.js";
import { projectRoot, sourceFile } from "../paths.js";
import type { Manifest, RunOptions } from "../pipeline.js";
import { episodeSourceFiles } from "../presentation.js";
import { readRuntimeFiles } from "../provenance.js";
import { newsEvidence, validateNewsEpisode } from "./contracts.js";
import { createNewsReview } from "./review.js";

export async function prepareNewsEpisode(input: NewsEpisode, options: RunOptions = {}) {
  const episode = structuredClone(validateNewsEpisode(input, { requireFresh: true }));
  const runId = `${episode.id}-v${episode.version}-${randomUUID()}`;
  const directory = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
    runId,
  );
  await mkdir(directory, { recursive: true });
  const at = new Date().toISOString();
  const manifest: Manifest = {
    schemaVersion: 1,
    runId,
    episodeId: episode.id,
    episodeVersion: episode.version,
    inputHash: hash(JSON.stringify(episode)),
    startedAt: at,
    updatedAt: at,
    stage: "VALIDATED",
    sourceHashes: {},
    runtimeHashes: {},
    artifactHashes: {},
    history: [{ stage: "VALIDATED", at }],
  };
  const persist = async (stage: Manifest["stage"]) => {
    manifest.stage = stage;
    manifest.updatedAt = new Date().toISOString();
    if (manifest.history.at(-1)?.stage !== stage)
      manifest.history.push({ stage, at: manifest.updatedAt });
    await writeFile(resolve(directory, "manifest.tmp"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(resolve(directory, "manifest.tmp"), resolve(directory, "manifest.json"));
  };
  const save = async (name: string, content: string) => {
    await writeFile(resolve(directory, name), content, { flag: "wx" });
    manifest.artifactHashes[name] = hash(content);
  };
  await persist("VALIDATED");
  try {
    for (const name of [
      ...episodeSourceFiles(episode),
      "schemas/episode.schema.json",
      "schemas/news-episode.schema.json",
      "schemas/news-topics.schema.json",
      "schemas/video-layout.schema.json",
      "schemas/narration-timing.schema.json",
      "config/video-layout.json",
      "config/production.json",
      "templates/review.css",
      "templates/review-player.js",
    ]) {
      manifest.sourceHashes[name] = hash(await readFile(await sourceFile(name)));
    }
    for (const [name, content] of Object.entries(await readRuntimeFiles()))
      manifest.runtimeHashes[name] = hash(content);
    await save("episode.json", `${JSON.stringify(episode, null, 2)}\n`);
    await persist("VERIFYING");
    const evidence = newsEvidence(episode);
    await save("news-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`);
    await persist("SOURCES_CHECKED");
    if (options.preview) {
      for (const [name, content] of Object.entries(await createNewsReview(episode)))
        await save(name, content);
    }
    for (const [name, expected] of Object.entries({
      ...manifest.sourceHashes,
      ...manifest.runtimeHashes,
    })) {
      if (hash(await readFile(await sourceFile(name))) !== expected)
        throw new Error(`Input changed during the run: ${name}; run again`);
    }
    if (options.preview) await persist("PREVIEW_READY");
    return { directory, manifest, evidence };
  } catch (error) {
    manifest.error = error instanceof Error ? error.message : "Unknown news preparation failure";
    await persist("FAILED");
    throw new Error(`${manifest.error}\nRun: ${directory}`, { cause: error });
  }
}
