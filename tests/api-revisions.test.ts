import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getActiveJob, resetJobsForTest } from "../src/api.js";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { projectRoot } from "../src/paths.js";
import type { ProductionReport } from "../src/production.js";
import { scriptEditorSeed } from "../src/script-editor.js";
import { startPreviewServer } from "../src/serve.js";

if (process.env.SHORTS_REVISION_TEST_CHILD !== "1") {
  test("a produced revision stays visible and keeps its voice/photo when timing blocks the video", async (t) => {
    // The API intentionally saves real immutable versions. Exercise it in a child
    // workspace so other parallel tests never discover/remove this private fixture.
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "sap-revision-workspace-")));
    t.after(() => rm(root, { recursive: true, force: true }));
    await cp(resolve(projectRoot, "schemas"), resolve(root, "schemas"), { recursive: true });
    await mkdir(resolve(root, "config"));
    for (const entry of await readdir(resolve(projectRoot, "config"), { withFileTypes: true }))
      if (entry.isFile())
        await cp(resolve(projectRoot, "config", entry.name), resolve(root, "config", entry.name));
    await mkdir(resolve(root, "content/episodes"), { recursive: true });
    await mkdir(resolve(root, "content/presentations"));
    await cp(
      resolve(projectRoot, "content/episodes/CAP-02.json"),
      resolve(root, "content/episodes/CAP-02.json"),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SHORTS_WORKSPACE_ROOT: root,
      SHORTS_REVISION_TEST_CHILD: "1",
    };
    delete env.NODE_TEST_CONTEXT;
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
      {
        cwd: projectRoot,
        env,
        timeout: 30000,
      },
    );
    assert.match(result.stdout, /isolated API keeps blocked revisions discoverable/);
    assert.match(result.stdout, /# pass 1\b/);
  });
} else
  test("isolated API keeps blocked revisions discoverable with their selected voice and portrait", async (t) => {
    resetJobsForTest();
    const directory = await mkdtemp(resolve(tmpdir(), "sap-saved-production-"));
    const initial = resolve(directory, "initial");
    const saved = resolve(directory, "saved");
    await mkdir(initial);
    await mkdir(saved);
    await writeFile(resolve(initial, "review.html"), "Original workspace");
    const definition = await scriptEditorSeed(await readContentEpisode("CAP-02"));
    definition.schemaVersion = 2;
    definition.presentation.variant = `api-${randomUUID().slice(0, 8)}`;
    const selector = `CAP-02@${definition.presentation.variant}`;
    const voice = { engine: "qwen" as const, profileId: randomUUID(), revision: "a".repeat(64) };
    const avatar = {
      mode: "photo" as const,
      imageId: "saved-photo.png",
      animation: "neural" as const,
    };
    const speaker = definition.presentation.speakers[0];
    assert.ok(speaker);
    Object.assign(speaker, { voice, avatar });
    const file = resolve(
      projectRoot,
      "content/presentations",
      `${selector.replace("@", "--")}.json`,
    );
    let finish!: () => void;
    const waiting = new Promise<void>((done) => {
      finish = done;
    });
    let refreshes = 0;
    const reportId = randomUUID();
    const { server, url } = await startPreviewServer(initial, 0, "127.0.0.1", {
      artifactRoot: directory,
      rebuildLibrary: async () => {
        refreshes++;
        const episode = await readContentEpisode(selector);
        await writeFile(resolve(saved, "review.html"), `Saved version ${selector}`);
        await writeFile(
          resolve(saved, "library-manifest.json"),
          JSON.stringify({
            artifactHashes: {},
            episodes: [
              {
                selector,
                inputHash: hash(JSON.stringify(episode)),
                sourceReviewExpired: false,
                preview: null,
              },
            ],
          }),
        );
        return { directory: saved };
      },
      production: async () => {
        await waiting;
        const now = new Date().toISOString();
        const reportDirectory = resolve(directory, "productions", reportId);
        const report: ProductionReport = {
          schemaVersion: 1,
          id: reportId,
          selector,
          stage: "BLOCKED",
          failedAt: "NARRATION",
          startedAt: now,
          updatedAt: now,
          directory: reportDirectory,
          mediaJobId: null,
          inputHash: null,
          voices: ["Synthetic test profile"],
          presentation: null,
          narrationDirectory: null,
          audioReusedFrom: null,
          durationSeconds: 55,
          hookSeconds: 4.48,
          videoDirectory: null,
          libraryDirectory: null,
          reusedVideo: false,
          issue: {
            code: "TIMING_REVIEW_REQUIRED",
            message: "Video not produced: opening 4.48s exceeds 3s.",
            nextAction: "Shorten the opening.",
          },
        };
        await mkdir(reportDirectory, { recursive: true });
        await writeFile(resolve(reportDirectory, "production.json"), JSON.stringify(report));
        return report;
      },
    });
    t.after(async () => {
      finish();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(file, { force: true });
      await rm(directory, { recursive: true, force: true });
      resetJobsForTest();
    });
    const origin = new URL(url).origin;
    const session = await fetch(`${origin}/api/local-voices/session`);
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const response = await fetch(`${origin}/api/produce`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ definition }),
    });
    assert.equal(response.status, 202);
    assert.equal(((await response.json()) as { libraryUpdated: boolean }).libraryUpdated, true);
    assert.equal(refreshes, 1, "the revision is indexed before production can finish");
    assert.match(await (await fetch(url)).text(), new RegExp(selector));
    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(persisted.presentation.speakers[0].voice, voice);
    assert.deepEqual(persisted.presentation.speakers[0].avatar, avatar);
    finish();
    for (let i = 0; i < 200 && getActiveJob(); i++) await setTimeout(10);
    assert.equal(getActiveJob(), null);
    assert.equal(refreshes, 2, "blocked narration is indexed without claiming a video");
    const workflow = (await (await fetch(`${origin}/api/workflow`)).json()) as {
      episodes: {
        selector: string;
        stage: string;
        label: string;
        issue: string;
        productionStage: string;
      }[];
    };
    const entry = workflow.episodes.find((entry) => entry.selector === selector);
    assert.equal(entry?.stage, "editing");
    assert.equal(entry?.label, "Ready to retry");
    assert.equal(entry?.productionStage, "BLOCKED");
    assert.match(entry?.issue ?? "", /4.48s/);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), persisted);
  });
