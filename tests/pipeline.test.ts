import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readEpisode } from "../src/contracts.js";
import type { DemoEvidence } from "../src/domain.js";
import { assertEvidence, hash, type Manifest, prepareEpisode } from "../src/pipeline.js";
import { createReview } from "../src/review.js";

const episode = await readEpisode("CAP-01");
const fixture: DemoEvidence = {
  demoId: "cap-inventory",
  verifiedAt: new Date().toISOString(),
  environment: { node: process.version, cds: "10.1.1", database: "sqlite-memory" },
  checks: [...episode.demo.expectedChecks],
  captures: {
    products: { value: [] },
    filtered: { value: [] },
    metadata: '<edmx:Edmx Version="4.0"></edmx:Edmx>',
  },
};

async function temporaryRun(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("a failed verifier persists a failed run and cannot produce a preview", async (t) => {
  const directory = await temporaryRun(t);
  await assert.rejects(
    prepareEpisode(episode, {
      preview: true,
      artifactRoot: directory,
      verifier: async () => {
        throw new Error("Simulated execution failure");
      },
    }),
    /Simulated execution failure/,
  );
  const [runId] = await readdir(directory);
  assert.ok(runId);
  const files = await readdir(resolve(directory, runId));
  const manifest: Manifest = JSON.parse(
    await readFile(resolve(directory, runId, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.stage, "FAILED");
  assert.equal(manifest.error, "Simulated execution failure");
  assert.ok(!manifest.history.some((item) => item.stage === "TECH_VERIFIED"));
  assert.ok(!files.includes("review.html"));
});

test("missing or duplicate check evidence cannot advance the run", async (t) => {
  const directory = await temporaryRun(t);
  const incomplete = structuredClone(fixture);
  incomplete.checks = ["odata-metadata"];
  await assert.rejects(
    prepareEpisode(episode, {
      artifactRoot: directory,
      verifier: async () => incomplete,
    }),
    /incomplete/,
  );
  incomplete.checks = [...episode.demo.expectedChecks];
  incomplete.checks[0] = "seed-products";
  assert.throws(() => assertEvidence(incomplete, episode), /incomplete/);
});

test("malformed capture data fails before technical verification", async (t) => {
  const directory = await temporaryRun(t);
  const cases: unknown[] = [
    { ...fixture, captures: { metadata: "", products: {}, filtered: {} } },
    { ...fixture, environment: { ...fixture.environment, node: "not-a-version" } },
    { ...fixture, verifiedAt: "not-a-date" },
    {
      ...fixture,
      captures: {
        ...fixture.captures,
        filtered: {
          value: [
            { ID: "11111111-1111-4111-8111-111111111111", title: "Keyboard", stock: "twelve" },
          ],
        },
      },
    },
  ];
  for (const payload of cases) {
    await assert.rejects(
      prepareEpisode(episode, {
        artifactRoot: directory,
        verifier: async () => payload as DemoEvidence,
      }),
      /evidence is incomplete or invalid/,
    );
  }
  for (const id of await readdir(directory)) {
    const manifest: Manifest = JSON.parse(
      await readFile(resolve(directory, id, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.stage, "FAILED");
    assert.ok(!manifest.history.some((entry) => entry.stage === "TECH_VERIFIED"));
  }
});

test("each successful run is isolated and hashes the exact script, evidence and preview", async (t) => {
  const directory = await temporaryRun(t);
  const first = await prepareEpisode(episode, {
    preview: true,
    artifactRoot: directory,
    verifier: async () => fixture,
  });
  const second = await prepareEpisode(episode, {
    artifactRoot: directory,
    verifier: async () => fixture,
  });
  assert.notEqual(first.directory, second.directory);
  assert.equal(first.manifest.stage, "PREVIEW_READY");
  assert.equal(second.manifest.stage, "TECH_VERIFIED");
  assert.ok(first.manifest.runtimeHashes["src/review.ts"]);
  for (const [file, expected] of Object.entries(first.manifest.artifactHashes)) {
    assert.equal(hash(await readFile(resolve(first.directory, file))), expected);
  }
  assert.ok(first.manifest.sourceHashes["demos/cap/inventory/srv/inventory-service.cds"]);
  assert.deepEqual(
    first.manifest.history.map((entry) => entry.stage),
    ["VALIDATED", "VERIFYING", "TECH_VERIFIED", "PREVIEW_READY"],
  );
});

test("editorial text is escaped and cannot become executable markup in the review", async () => {
  const hostile = structuredClone(episode);
  hostile.publication.text = '</div><script>alert("unexpected")</script>';
  const review = await createReview(hostile, fixture);
  assert.ok(review["review.html"]?.includes("&lt;script&gt;"));
  assert.ok(!review["review.html"]?.includes('<script>alert("unexpected")'));
  assert.ok(review["review.html"]?.includes("Silent storyboard"));
});
