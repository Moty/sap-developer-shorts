import assert from "node:assert/strict";
import test from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import {
  applyWritingProposal,
  parseWritingInput,
  parseWritingResult,
  writingMessages,
} from "../src/editorial/workflow.js";
import { createScriptEditor, scriptEditorSeed } from "../src/script-editor.js";
import { defaultStoryBrief, parseStoryBrief } from "../src/story-brief.js";
import { validatePresentationDefinition } from "../src/variants.js";

test("story briefs survive tutorial/news revisions without mutating saved evidence or speakers", async () => {
  for (const selector of ["CAP-01@casual-v2", "NEWS-02@duo"]) {
    const episode = await readContentEpisode(selector);
    episode.presentation ??= {
      tone: "casual",
      format: "explainer",
      humor: "none",
      speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
    };
    episode.presentation.brief = {
      ...defaultStoryBrief,
      audience: "architect",
      viewerProblem: "What changes in my integration?",
      takeaway: "Check the service boundary",
      angle: "A concrete discovery",
      targetSeconds: 60,
    };
    const definition = await scriptEditorSeed(episode);
    const compiled = (await validatePresentationDefinition(definition)).episode;
    assert.deepEqual(compiled.presentation?.brief, episode.presentation.brief);
    assert.deepEqual(compiled.sources, episode.sources);
    assert.deepEqual(compiled.claims, episode.claims);
    assert.deepEqual(compiled.presentation?.speakers, episode.presentation.speakers);
    assert.deepEqual(compiled.scenes, episode.scenes);
  }
});

test("the writer receives the saved brief and returns consistent companion copy with retained links", async () => {
  const episode = await readContentEpisode("CAP-01@casual-v2");
  const snapshot = {
    brief: {
      ...defaultStoryBrief,
      audience: "architect" as const,
      viewerProblem: "My API is missing",
      takeaway: "Expose a service",
      angle: "Follow one request",
    },
    title: episode.title,
    publicationText: episode.publication.text,
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      overlay: scene.overlay,
      texts: [scene.narration],
    })),
  };
  const input = parseWritingInput({
    requestId: "11111111-1111-4111-8111-111111111111",
    selector: "CAP-01@casual-v2",
    sourceHash: hash(JSON.stringify(episode)),
    settingsHash: "a".repeat(64),
    snapshot,
    action: "rewrite",
    style: "conversational",
    instruction: "",
    allowRemote: false,
  });
  assert.match(writingMessages(input, episode)[1]?.content ?? "", /My API is missing/u);
  const result = parseWritingResult(
    JSON.stringify({
      ...snapshot,
      brief: undefined,
      publicationText: `Follow one request.\n${episode.publication.text}`,
    }),
    input,
    episode,
  );
  assert.ok("scenes" in result && "title" in result);
  const compiled = applyWritingProposal(episode, result);
  assert.match(compiled.publication.text, /Follow one request/u);
  assert.deepEqual(compiled.sources, episode.sources);
  assert.throws(
    () =>
      parseWritingResult(
        JSON.stringify({ ...snapshot, brief: undefined, publicationText: "Source links removed." }),
        input,
        episode,
      ),
    /retain.*links/u,
  );
  const existingUrl = episode.publication.text.match(/https?:\/\/[^\s<>]+/u)?.[0];
  assert.ok(existingUrl);
  for (const post of [
    episode.publication.text.replace(existingUrl, `${existingUrl}-invented`),
    `${episode.publication.text}\nhttps://unrelated.example/new`,
  ])
    assert.throws(
      () =>
        parseWritingResult(
          JSON.stringify({ ...snapshot, brief: undefined, publicationText: post }),
          input,
          episode,
        ),
      /retain.*links/u,
    );
});

test("brief validation rejects executable markup, unknown fields and unsupported targets", () => {
  for (const value of [
    { ...defaultStoryBrief, targetSeconds: 100 },
    { ...defaultStoryBrief, angle: "<script>" },
    { ...defaultStoryBrief, privateProfile: "secret" },
  ])
    assert.throws(() => parseStoryBrief(value), /Story brief/u);
});

test("fractional planned timing remains editable and only the inferred brief target is rounded", async () => {
  const episode = await readContentEpisode("CAP-01");
  const scale = 55.5 / episode.targetDurationSeconds;
  episode.targetDurationSeconds = 55.5;
  for (const scene of episode.scenes) {
    scene.startSeconds *= scale;
    scene.endSeconds *= scale;
  }
  assert.match(await createScriptEditor(episode), /id="writing-target-seconds"[^>]*value="56"/u);
  assert.equal(episode.targetDurationSeconds, 55.5);
});
