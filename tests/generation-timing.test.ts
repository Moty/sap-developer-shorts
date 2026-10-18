import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  formatGenerationTime,
  generationForOutput,
  generationTimingHtml,
  readGenerationReports,
  summarizeGeneration,
} from "../src/generation-timing.js";

const report = (): Parameters<typeof summarizeGeneration>[0] => ({
  schemaVersion: 1,
  selector: "CAP-01",
  stage: "READY",
  startedAt: "2026-10-18T01:56:38.275Z",
  updatedAt: "2026-10-18T02:05:36.490Z",
  inputHash: "input",
  mediaJobId: "audio",
  videoDirectory: "video",
  reusedVideo: false,
});

test("generation labels distinguish output length from elapsed time and keep old runs honest", () => {
  assert.equal(formatGenerationTime(0), "<1s");
  assert.equal(formatGenerationTime(59500), "1m");
  assert.equal(formatGenerationTime(538215), "8m 58s");
  assert.equal(formatGenerationTime(3661000), "1h 1m 1s");
  assert.equal(formatGenerationTime(Number.NaN), "Unavailable");
  const summary = summarizeGeneration(report());
  assert.equal(summary?.basis, "legacy-run");
  assert.equal(summary?.totalMs, 538215);
  assert.equal(summary?.stages, undefined);
  const html = generationTimingHtml(summary ?? undefined);
  assert.match(html, /Total recorded run: 8m 58s/);
  assert.match(html, /not recorded separately/);
  assert.doesNotMatch(html, /<dt>Audio/);
  assert.match(generationTimingHtml(undefined), /not recorded for this output/);
  assert.equal(summarizeGeneration({ ...report(), updatedAt: "invalid" }), null);
  assert.equal(summarizeGeneration({ ...report(), stage: "LIBRARY" }), null);
});

test("completed phase timings are available before studio packaging and label reuse", () => {
  const value = report();
  value.stage = "LIBRARY";
  const step = (elapsedMs: number) => ({
    startedAt: value.startedAt,
    completedAt: value.updatedAt,
    elapsedMs,
  });
  value.generationTiming = {
    totalMs: 538000,
    completedAt: value.updatedAt,
    stages: { PREFLIGHT: step(1000), NARRATION: step(43000), RENDER: step(494000) },
  };
  value.reusedAudio = true;
  value.reusedVideo = true;
  const summary = summarizeGeneration(value);
  assert.deepEqual(summary?.stages, { preparationMs: 1000, audioMs: 43000, videoMs: 494000 });
  const html = generationTimingHtml(summary ?? undefined);
  assert.match(html, /Total to MP4: 8m 58s/);
  assert.match(html, /Audio &amp; captions · reused/);
  assert.match(html, /Video &amp; portrait · reused/);
  assert.match(html, /Studio packaging is excluded/);
  assert.match(html, /retrieval and verification time/);
});

test("timing is bound to the exact narration and video, surviving corrupt reports and later failed attempts", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "sap-generation-timing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const save = async (digit: string, value: unknown) => {
    const directory = resolve(
      root,
      "productions",
      `${digit.repeat(8)}-aaaa-bbbb-cccc-dddddddddddd`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "production.json"), JSON.stringify(value));
  };
  await save("1", report());
  await save("2", { ...report(), stage: "FAILED", startedAt: "2026-10-19T01:00:00Z" });
  await save("3", { ...report(), mediaJobId: "other-audio", startedAt: "2026-10-19T02:00:00Z" });
  await save("4", null);
  const reports = await readGenerationReports(root);
  const output = {
    selector: "CAP-01",
    inputHash: "input",
    mediaJobId: "audio",
    videoDirectory: "video",
  };
  assert.equal(generationForOutput(reports, output)?.totalMs, 538215);
  assert.equal(generationForOutput(reports, { ...output, inputHash: "new-input" }), null);
  assert.equal(generationForOutput(reports, { ...output, videoDirectory: "other-video" }), null);
  const actual = resolve(root, "video-output");
  const alias = resolve(root, "video-alias");
  await mkdir(actual);
  await symlink(actual, alias);
  await save("5", { ...report(), videoDirectory: alias });
  const canonicalReports = await readGenerationReports(root);
  assert.equal(
    generationForOutput(canonicalReports, { ...output, videoDirectory: await realpath(actual) })
      ?.totalMs,
    538215,
    "an artifact root reached through a symlink must still match its saved timing",
  );
});
