import assert from "node:assert/strict";
import test from "node:test";
import { readEpisode, validateContent, validateEpisode, validateTopics } from "../src/contracts.js";
import { inside, projectRoot, sourceFile } from "../src/paths.js";

const pilot = await readEpisode("CAP-01");

test("the backlog retains thirty tutorials and adds a separate SAP news collection", async () => {
  const { topics, newsTopics, episodes } = await validateContent();
  assert.equal(topics.length, 30);
  assert.ok(newsTopics.length >= 6);
  assert.equal(new Set(newsTopics.map((topic) => topic.id)).size, newsTopics.length);
  assert.deepEqual(
    topics.filter((topic) => topic.status === "pilot-ready").map((topic) => topic.id),
    ["CAP-01", "CAP-02"],
  );
  const episodeIds = episodes.map((episode) => episode.id);
  for (const id of ["CAP-01", "CAP-02", "NEWS-01", "NEWS-02"]) {
    assert.ok(episodeIds.includes(id), `Missing seed episode ${id}`);
  }
  assert.equal(new Set(episodeIds).size, episodeIds.length);
});

test("claims cannot refer to absent sources or invented execution checks", () => {
  const episode = structuredClone(pilot);
  const claim = episode.claims[0];
  assert.ok(claim);
  claim.sourceIds = ["invented-source"];
  claim.evidenceChecks = ["performance-boost"];
  assert.throws(() => validateEpisode(episode), /unknown source invented-source/);
  claim.sourceIds = ["cap-services"];
  assert.throws(() => validateEpisode(episode), /unknown check performance-boost/);
});

test("a script cannot drop a required verification check", () => {
  const episode = structuredClone(pilot);
  episode.demo.expectedChecks.pop();
  assert.throws(() => validateEpisode(episode), /Missing demo check/);
});

test("timeline gaps remain invalid while hook and per-scene pacing are advisory", () => {
  const episode = structuredClone(pilot);
  const context = episode.scenes[1];
  const hook = episode.scenes[0];
  assert.ok(context && hook);
  context.startSeconds = 4;
  assert.throws(() => validateEpisode(episode), /gap or overlap/);
  context.startSeconds = 3;
  hook.narration = "This opening has far too many words for three seconds.";
  assert.doesNotThrow(() => validateEpisode(episode));
  hook.narration = "Build an API.";
  context.narration = "This is a very long line that cannot fit in seven seconds. ".repeat(4);
  assert.doesNotThrow(() => validateEpisode(episode));
});

test("code panels require a registered file and complete scene data", () => {
  const episode = structuredClone(pilot);
  const scene = episode.scenes[1];
  assert.ok(scene);
  scene.visual.codePath = "../../.env";
  assert.throws(() => validateEpisode(episode), /registered demo source/);
  delete scene.visual.codePath;
  assert.throws(() => validateEpisode(episode), /codePath/);
});

test("unresearched topics cannot be promoted by changing only their status", async () => {
  const { topics } = await validateContent();
  const topic = topics[0];
  assert.ok(topic);
  topic.status = "pilot-ready";
  assert.throws(() => validateTopics(topics), /needs sources, release, and verification date/);
});

test("IDs and file paths cannot escape the repository", async () => {
  assert.throws(() => inside(projectRoot, "../secrets"), /must stay inside/);
  await assert.rejects(sourceFile("/etc/hosts"), /must stay inside/);
  await assert.rejects(readEpisode("../../.env"), /Invalid episode ID/);
});
