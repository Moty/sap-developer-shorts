import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { handleCreatorApi } from "../src/creator-api.js";
import { readCreatorRecord, writeCreatorRecord } from "../src/creator-store.js";
import { hash } from "../src/digest.js";
import {
  finishedReviewKit,
  finishedReviewScenes,
  parseFinishedReview,
} from "../src/finished-review.js";

const identity = {
  selector: "CAP-01",
  renderKey: "a".repeat(64),
  videoHash: "b".repeat(64),
  durationSeconds: 50,
};
const review = {
  schemaVersion: 1,
  ...identity,
  reviewer: "Gemini manual",
  summary: "Useful, improve pacing",
  findings: [
    {
      seconds: 20,
      severity: "warning",
      area: "speech",
      observation: "Pause is long",
      suggestion: "Tighten this pause",
    },
  ],
};
const { durationSeconds: _duration, ...response } = review;
test("external feedback binds to exact output and rejects out-of-range findings", () => {
  assert.equal(parseFinishedReview(response, identity).findings.length, 1);
  assert.throws(
    () => parseFinishedReview({ ...response, videoHash: "c".repeat(64) }, identity),
    /different MP4/,
  );
  assert.throws(
    () =>
      parseFinishedReview(
        { ...response, findings: [{ ...response.findings[0], seconds: 51 }] },
        identity,
      ),
    /timestamp/,
  );
  assert.throws(() => parseFinishedReview({ ...response, approve: true }, identity), /Unsupported/);
  assert.equal(
    parseFinishedReview({ ...response, summary: "<script>untrusted text</script>" }, identity)
      .summary,
    "<script>untrusted text</script>",
  );
});
test("kit verifies the actual MP4 and transcript files; private feedback persists separately", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finished-review-"));
  try {
    const episode = await readContentEpisode("CAP-01");
    const dir = resolve(root, "episodes/CAP-01/video");
    await mkdir(dir, { recursive: true });
    const video = Buffer.from("exact output");
    const timing = Buffer.from(
      JSON.stringify({
        durationSeconds: 50,
        scenes: [{ id: episode.scenes[0]?.id, startSeconds: 0, endSeconds: 3 }],
      }),
    );
    await writeFile(resolve(dir, "short.mp4"), video);
    await writeFile(resolve(dir, "../timing.json"), timing);
    await writeFile(
      resolve(root, "library-manifest.json"),
      JSON.stringify({
        episodes: [
          {
            selector: "CAP-01",
            inputHash: hash(JSON.stringify(episode)),
            video: { renderKey: identity.renderKey, durationSeconds: 50 },
          },
        ],
        artifactHashes: {
          "episodes/CAP-01/video/short.mp4": hash(video),
          "episodes/CAP-01/timing.json": hash(timing),
        },
      }),
    );
    const kit = await finishedReviewKit(root, "CAP-01");
    const statuses: number[] = [];
    const options = {
      token: "test-token",
      directory: root,
      readBody: async () => response,
      send: (_res: ServerResponse, status: number) => {
        statuses.push(status);
      },
    };
    const request = {
      method: "GET",
      headers: { host: "127.0.0.1:5000" },
      socket: { remoteAddress: "127.0.0.1" },
    } as IncomingMessage;
    await handleCreatorApi(
      request,
      {} as ServerResponse,
      new URL("http://127.0.0.1:5000/api/creator/output-review?selector=CAP-01"),
      options,
    );
    assert.equal(statuses.pop(), 403);
    request.headers.cookie = "shorts_voice_session=test-token";
    await handleCreatorApi(
      request,
      {} as ServerResponse,
      new URL("http://127.0.0.1:5000/api/creator/output-review?selector=CAP-01&renderKey=old"),
      options,
    );
    assert.equal(statuses.pop(), 400);
    await handleCreatorApi(
      request,
      {} as ServerResponse,
      new URL(
        `http://127.0.0.1:5000/api/creator/output-review?selector=CAP-01&renderKey=${identity.renderKey}`,
      ),
      options,
    );
    assert.equal(statuses.pop(), 200);

    const custom = structuredClone(episode);
    custom.presentation = {
      tone: "casual",
      format: "explainer",
      humor: "none",
      speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
      design: {
        schemaVersion: 1,
        theme: "ocean",
        motion: "smooth",
        scenes: custom.scenes.map((scene, index) => ({
          id: scene.id,
          headline: index ? scene.overlay : "Rendered custom headline",
          emphasis: "balanced",
          ...(index
            ? {}
            : { composition: { kind: "callout", items: [{ label: "Saved visual idea" }] } }),
        })),
      },
    };
    const visuals = finishedReviewScenes(custom, { scenes: [] });
    assert.equal(visuals[0]?.headline, "Rendered custom headline");
    assert.equal(visuals[0]?.composition?.items[0]?.label, "Saved visual idea");
    assert.equal(kit.videoHash, hash(video));
    assert.equal(kit.scenes[0]?.measured?.startSeconds, 0);
    assert.equal("speakers" in kit, false);
    assert.equal("photo" in kit, false);
    const accepted = parseFinishedReview({ ...response, videoHash: kit.videoHash }, kit);
    await Promise.all([
      writeCreatorRecord(resolve(root, ".creator"), "review:CAP-01", accepted),
      writeCreatorRecord(resolve(root, ".creator"), "other", { ok: true }),
    ]);
    assert.deepEqual(await readCreatorRecord(resolve(root, ".creator"), "review:CAP-01"), accepted);
    assert.equal(
      (await readFile(resolve(root, "episodes/CAP-01/video/short.mp4"))).toString(),
      "exact output",
    );
    await writeFile(resolve(dir, "short.mp4"), "changed");
    await assert.rejects(() => finishedReviewKit(root, "CAP-01"), /output changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
