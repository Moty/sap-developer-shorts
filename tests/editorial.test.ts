import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import type { ContentEpisode } from "../src/domain.js";
import {
  applyFinalReviewFixes,
  type FinalReview,
  parseFinalReview,
} from "../src/editorial/final-review.js";
import { type WritingJob, WritingManager } from "../src/editorial/manager.js";
import {
  type JsonTransport,
  WritingError,
  writingCatalog,
  writingCompletion,
  writingHttp,
} from "../src/editorial/providers.js";
import {
  defaultWritingSettings,
  parseWritingSettings,
  type WritingSecrets,
  type WritingSettings,
  writingBaseUrl,
} from "../src/editorial/settings.js";
import {
  applyWritingProposal,
  episodeWithWritingSnapshot,
  finalReviewContext,
  finalReviewFingerprint,
  parseWritingInput,
  parseWritingResult,
  type WritingInput,
  writingContext,
  writingMessages,
} from "../src/editorial/workflow.js";
import { type PresentationDesign, parsePresentationDesign } from "../src/presentation-design.js";
import { scriptEditorSeed } from "../src/script-editor.js";
import { startPreviewServer } from "../src/serve.js";
import { validatePresentationDefinition } from "../src/variants.js";

const model = "claude-sonnet-4-6";
const fixtureKey = "private-fixture-key-never-in-model-context";
const settings = () => ({
  ...structuredClone(defaultWritingSettings),
  provider: "hyperspace" as const,
  hyperspace: { baseUrl: "http://127.0.0.1:6655/litellm/v1", model },
});
function secretStore(): WritingSecrets {
  let value: string | undefined = fixtureKey;
  return {
    get: async () => value,
    set: async (key) => {
      value = key;
    },
    remove: async () => {
      value = undefined;
    },
  };
}
const snapshot = (episode: ContentEpisode) => ({
  title: episode.title,
  scenes: episode.scenes.map((scene) => ({
    id: scene.id,
    overlay: scene.overlay,
    texts: scene.dialogue?.map((turn) => turn.text) ?? [scene.narration],
  })),
});
const reply = (value: unknown) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
  usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
});
async function fixture(t: TestContext, completion?: JsonTransport) {
  const directory = await mkdtemp(resolve(tmpdir(), "shorts-writing-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let episode = await readContentEpisode("CAP-01@casual-v2");
  const requests: { url: string; options: Parameters<JsonTransport>[1] }[] = [];
  const transport: JsonTransport = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/models")) {
      if (url.includes("/api/v1/"))
        return {
          models: [
            { key: "gemma-4-31b-it", format: "mlx", loaded_instances: [{ id: "gemma-4-31b-it" }] },
          ],
        };
      return {
        data: [
          { id: model },
          { id: `${model}[1m]` },
          { id: "gpt-6.1-sol" },
          { id: "gemma-4-31b-it" },
          { id: "text-embedding-3-small" },
        ],
      };
    }
    return completion ? completion(url, options) : reply(snapshot(episode));
  };
  const manager = new WritingManager({
    directory,
    secrets: secretStore(),
    transport,
    readEpisode: async () => structuredClone(episode),
    lock: async (action) => action(),
  });
  await manager.configure({ settings: settings() });
  const input = async (action: WritingInput["action"] = "rewrite"): Promise<WritingInput> => ({
    requestId: randomUUID(),
    selector: "CAP-01@casual-v2",
    sourceHash: hash(JSON.stringify(episode)),
    settingsHash: (await manager.status()).settingsHash,
    snapshot: {
      ...snapshot(episode),
      ...(action === "final-review" ? { publicationText: episode.publication.text } : {}),
    },
    action,
    style: "conversational",
    instruction: "Use a useful discovery.",
    allowRemote: true,
  });
  return {
    directory,
    manager,
    input,
    requests,
    transport,
    episode: () => episode,
    replaceEpisode: (value: ContentEpisode) => {
      episode = value;
    },
  };
}
async function waitFor(manager: WritingManager, id: string): Promise<WritingJob> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = await manager.get(id);
    if (job && job.state !== "RUNNING" && !manager.active) return job;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Writing fixture did not finish");
}

test("writing URLs and settings accept only explicit loopback provider routes and opaque model IDs", () => {
  const value = settings();
  value.hyperspace.model = "claude-sonnet-4-6[1m]";
  assert.equal(parseWritingSettings(value).hyperspace.model, value.hyperspace.model);
  assert.equal(
    writingBaseUrl("http://localhost:6655/litellm/v1/", "hyperspace"),
    "http://127.0.0.1:6655/litellm/v1",
  );
  for (const base of [
    "https://example.com/litellm/v1",
    "http://169.254.169.254/litellm/v1",
    "http://127.1:6655/v1",
    "http://user:secret@localhost:6655/litellm/v1",
    "http://localhost:6655/v1",
    "http://localhost:6655/litellm/v1?key=secret",
  ])
    assert.throws(() => writingBaseUrl(base, "hyperspace"));
  assert.throws(() => parseWritingSettings({ ...value, apiKey: fixtureKey }));
});

test("catalogs preserve advertised IDs, distinguish embeddings, and never load or replace local models", async (t) => {
  const f = await fixture(t);
  const catalog = await writingCatalog(settings(), "hyperspace", fixtureKey, f.transport);
  assert.equal(catalog.status, "ready");
  assert.equal(catalog.models.find((item) => item.id.includes("[1m]"))?.id, `${model}[1m]`);
  assert.equal(catalog.models.find((item) => item.id.includes("embedding"))?.chat, false);
  assert.ok(f.requests.every((entry) => !entry.options?.body));
  const local = await writingCatalog(defaultWritingSettings, "local", fixtureKey, f.transport);
  assert.equal(local.models.find((item) => item.id === "gemma-4-31b-it")?.loaded, true);
  assert.equal(
    f.requests
      .filter((entry) => !entry.url.includes("litellm"))
      .some((entry) => entry.options?.apiKey),
    false,
  );
});

test("direct HTTP uses the authenticated LiteLLM path and rejects redirects, oversized bodies and timeouts without forwarding the key", async (t) => {
  const seen: { path: string; authorization?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({
      path: req.url ?? "",
      ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
    });
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://example.com/" }).end();
      return;
    }
    if (req.url === "/large") {
      res.end("x".repeat(1024 * 1024 + 1));
      return;
    }
    if (req.url === "/timeout") return;
    if (req.url === "/unauthorized") {
      res.writeHead(401).end(JSON.stringify({ error: fixtureKey }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: model }] }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  await writingHttp(`${origin}/litellm/v1/models`, { apiKey: fixtureKey });
  assert.equal(seen[0]?.authorization, `Bearer ${fixtureKey}`);
  for (const path of ["redirect", "large", "unauthorized"])
    await assert.rejects(
      writingHttp(`${origin}/${path}`, { apiKey: fixtureKey }),
      (error: Error) => !error.message.includes(fixtureKey),
    );
  await assert.rejects(
    writingHttp(`${origin}/timeout`, { timeoutMs: 20 }),
    (error: WritingError) => error.code === "TIMEOUT",
  );
  assert.ok(seen.every((item) => item.path !== "/"));
});

test("provider output validation retains usage on incomplete responses and keeps model-specific parameters separate", async () => {
  const value = settings();
  value.hyperspace.model = "gpt-6.1-sol";
  let body: Record<string, unknown> = {};
  await assert.rejects(
    writingCompletion(value, [{ role: "user", content: "Public fixture" }], {
      apiKey: fixtureKey,
      transport: async (_url, options) => {
        body = options?.body as Record<string, unknown>;
        return {
          choices: [{ finish_reason: "length", message: { content: "partial" } }],
          usage: { total_tokens: 91 },
        };
      },
    }),
    (error: WritingError) => error.code === "INCOMPLETE_OUTPUT" && error.usage?.totalTokens === 91,
  );
  assert.equal(body.model, "gpt-6.1-sol");
  assert.equal(body.max_completion_tokens, value.outputTokens.writing);
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_k, undefined);
  assert.equal(body.reasoning_effort, undefined);
  await assert.rejects(
    writingCompletion(settings(), [], {
      apiKey: fixtureKey,
      transport: async () => reply({ echoed: fixtureKey }),
    }),
    /credential material/u,
  );
});

test("writing context excludes private media, profile IDs and local paths; output cannot author metadata or change slots", async (t) => {
  const f = await fixture(t);
  const episode = structuredClone(f.episode());
  assert.ok(episode.presentation);
  const speaker = episode.presentation.speakers[0];
  assert.ok(speaker);
  speaker.avatar = { mode: "photo", imageId: "private-headshot.png" };
  speaker.voice = {
    engine: "qwen",
    profileId: randomUUID(),
    revision: "a".repeat(64),
  };
  const value = snapshot(episode);
  const context = JSON.stringify(writingContext(episode, value));
  assert.doesNotMatch(context, /private-headshot|profileId|codePath|imageId|faceLandmarks/u);
  const input = await f.input();
  const messages = writingMessages(input, episode);
  assert.ok(JSON.stringify(messages).includes("source"));
  assert.ok(!JSON.stringify(messages).includes(fixtureKey));
  const proposal = snapshot(f.episode());
  assert.deepEqual(parseWritingResult(JSON.stringify(proposal), input, f.episode()), proposal);
  assert.throws(() =>
    parseWritingResult(
      JSON.stringify({ ...proposal, presentation: episode.presentation }),
      input,
      f.episode(),
    ),
  );
  const reordered = structuredClone(proposal);
  const first = reordered.scenes[0],
    second = reordered.scenes[1];
  assert.ok(first && second);
  [reordered.scenes[0], reordered.scenes[1]] = [second, first];
  assert.throws(() => parseWritingResult(JSON.stringify(reordered), input, f.episode()));
  const privateRequest = {
    ...input,
    snapshot: { ...value, voice: speaker.voice },
  };
  assert.throws(() => parseWritingInput(privateRequest));
});

test("text compilation preserves the full voice/photo/evidence/companion context, including dialogue speaker assignments", async () => {
  for (const selector of ["CAP-01@casual-v2", "CAP-01@duo", "NEWS-02@duo"]) {
    const episode = await readContentEpisode(selector);
    const seed = await scriptEditorSeed(episode);
    const speaker = seed.presentation.speakers[0];
    assert.ok(speaker);
    speaker.avatar = {
      mode: "photo",
      imageId: "private-headshot.png",
      animation: "neural",
      motion: { style: "calm", intensity: 0.3 },
    };
    const proposal = snapshot(episode);
    proposal.title = "A clearer, source-backed story";
    const copy = applyWritingProposal(seed, proposal);
    assert.deepEqual(copy.presentation, seed.presentation);
    assert.deepEqual(copy.pronunciation, seed.pronunciation);
    assert.equal(copy.publicationText, seed.publicationText);
    assert.equal(copy.presentation.variant, seed.presentation.variant);
    const compiled = (await validatePresentationDefinition(copy)).episode;
    assert.deepEqual(compiled.sources, episode.sources);
    assert.deepEqual(compiled.claims, episode.claims);
    assert.deepEqual(
      compiled.scenes.map((scene) => scene.visual),
      episode.scenes.map((scene) => scene.visual),
    );
    assert.deepEqual(
      compiled.scenes.map((scene) => scene.dialogue?.map((turn) => turn.speakerId)),
      episode.scenes.map((scene) => scene.dialogue?.map((turn) => turn.speakerId)),
    );
  }
});

test("writing jobs freeze selection, deduplicate requests, retain valid originals after correction failures and expose safe timing/usage", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    if (calls === 2)
      throw new WritingError("INCOMPLETE_OUTPUT", "Correction did not complete.", {
        totalTokens: 44,
      });
    return reply(snapshot(f.episode()));
  });
  const input = await f.input();
  const started = await f.manager.start(input);
  const duplicate = await f.manager.start(input);
  assert.equal(duplicate.id, started.id);
  const job = await waitFor(f.manager, started.id);
  assert.equal(job.state, "SUCCEEDED");
  assert.equal(calls, 2);
  assert.ok(job.result);
  assert.match(job.warning ?? "", /valid original proposal was preserved/u);
  assert.equal(job.stages[1]?.state, "failed");
  assert.equal(job.stages[1]?.usage?.totalTokens, 44);
  assert.ok((job.stages[1]?.seconds ?? -1) >= 0);
  assert.doesNotMatch(JSON.stringify(job), new RegExp(fixtureKey, "u"));
  const prefs = JSON.parse(await readFile(resolve(f.directory, "settings.json"), "utf8"));
  assert.equal(prefs.apiKey, undefined);
  const applied = await f.manager.proposal(job.id, {
    selector: job.selector,
    sourceHash: job.sourceHash,
    snapshot: input.snapshot,
  });
  assert.deepEqual(applied.proposal, job.result);
  await assert.rejects(
    f.manager.proposal(job.id, {
      selector: "CAP-01",
      sourceHash: job.sourceHash,
      snapshot: input.snapshot,
    }),
    /different script/u,
  );
  const changed = structuredClone(input.snapshot);
  const hook = changed.scenes[0];
  assert.ok(hook);
  hook.texts[0] = "My newer edit.";
  await assert.rejects(
    f.manager.proposal(job.id, {
      selector: job.selector,
      sourceHash: job.sourceHash,
      snapshot: changed,
    }),
    /wording changed/u,
  );
  const sourceChanged = structuredClone(f.episode());
  sourceChanged.title = "A changed saved source";
  f.replaceEpisode(sourceChanged);
  await assert.rejects(
    f.manager.proposal(job.id, {
      selector: job.selector,
      sourceHash: job.sourceHash,
      snapshot: input.snapshot,
    }),
    /source script changed/u,
  );
});

test("Hyperspace generation requires cost acknowledgement, exact saved preferences, available chat model and valid source binding", async (t) => {
  const f = await fixture(t);
  const input = await f.input();
  await assert.rejects(
    f.manager.start({ ...input, allowRemote: false }),
    /possible downstream cost/u,
  );
  await f.manager.configure({
    settings: { ...settings(), hyperspace: { ...settings().hyperspace, model: `${model}[1m]` } },
  });
  await assert.rejects(f.manager.start(input), /preferences changed/u);
  const missing = {
    ...settings(),
    hyperspace: { ...settings().hyperspace, model: "missing-model" },
  };
  await f.manager.configure({ settings: missing });
  let job = await f.manager.start(await f.input());
  job = await waitFor(f.manager, job.id);
  assert.equal(job.errorCode, "MODEL_UNAVAILABLE");
  assert.equal(f.requests.filter((item) => item.url.endsWith("chat/completions")).length, 0);
  await f.manager.configure({
    settings: {
      ...missing,
      hyperspace: { ...missing.hyperspace, model: "text-embedding-3-small" },
    },
  });
  job = await f.manager.start(await f.input());
  job = await waitFor(f.manager, job.id);
  assert.equal(job.errorCode, "UNSUPPORTED_MODEL");
});

test("independent managers respect a live journal lease and cancel the actual running request without duplicate generation", async (t) => {
  let calls = 0;
  const f = await fixture(t, async (_url, options) => {
    calls++;
    return new Promise((_done, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(new WritingError("CANCELED", "Canceled fixture")),
        { once: true },
      );
    });
  });
  const input = await f.input();
  const started = await f.manager.start(input);
  while (!calls) await new Promise(setImmediate);
  const second = new WritingManager({
    directory: f.directory,
    secrets: secretStore(),
    transport: f.transport,
    readEpisode: async () => f.episode(),
    lock: async (action) => action(),
  });
  const status = await second.status();
  assert.equal(status.jobs[0]?.state, "RUNNING");
  assert.equal((await second.start(input)).id, started.id);
  await assert.rejects(second.start({ ...input, requestId: randomUUID() }), /active in another/u);
  const requested = await second.cancel(started.id);
  assert.equal(requested.state, "RUNNING");
  const canceled = await waitFor(f.manager, started.id);
  assert.equal(canceled.state, "CANCELED");
  assert.equal(calls, 1);
  assert.equal(canceled.stages[0]?.state, "canceled");
  const final = await second.get(started.id);
  assert.equal(final?.state, "CANCELED");
});

test("orphaned running receipts become interrupted without resubmission; local model work is admitted only while device is idle", async (t) => {
  const f = await fixture(t);
  const input = await f.input();
  const id = randomUUID();
  await writeFile(
    resolve(f.directory, "jobs", `${id}.json`),
    JSON.stringify({
      schemaVersion: 1,
      id,
      requestId: input.requestId,
      state: "RUNNING",
      startedAt: "2026-01-01T00:00:00Z",
      stages: [],
    }),
  );
  const status = await f.manager.status();
  assert.equal(status.jobs.find((job) => job.id === id)?.state, "INTERRUPTED");
  assert.equal(f.requests.length, 0);
  await f.manager.configure({ settings: defaultWritingSettings });
  let checks = 0;
  await assert.rejects(
    f.manager.start(await f.input(), () => ++checks > 1),
    /production started/u,
  );
  assert.equal(checks, 2);
  assert.equal(f.requests.length, 0);
});

test("writing API requires local session and same-origin JSON; status and saved settings never expose the API key", async (t) => {
  const f = await fixture(t);
  const { server, url } = await startPreviewServer(f.directory, 0, "127.0.0.1", {
    editorial: f.manager,
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const origin = new URL(url).origin;
  assert.equal((await fetch(`${origin}/api/editorial/status`)).status, 403);
  const session = await fetch(`${origin}/api/local-voices/session`);
  const header = session.headers.get("set-cookie");
  assert.ok(header);
  const cookie = header.split(";")[0];
  assert.ok(cookie);
  const other = await startPreviewServer(f.directory, 0, "127.0.0.1", { editorial: f.manager });
  t.after(async () => {
    other.server.closeAllConnections();
    await new Promise<void>((done) => other.server.close(() => done()));
  });
  const otherOrigin = new URL(other.url).origin;
  const otherSession = await fetch(`${otherOrigin}/api/local-voices/session`);
  const otherCookie = otherSession.headers.get("set-cookie")?.split(";")[0];
  assert.ok(otherCookie);
  assert.notEqual(cookie.split("=")[0], otherCookie.split("=")[0]);
  const combined = `${cookie}; ${otherCookie}`;
  for (const host of [origin, otherOrigin])
    assert.equal(
      (await fetch(`${host}/api/editorial/status`, { headers: { cookie: combined, origin: host } }))
        .status,
      200,
    );
  assert.equal(
    (
      await fetch(`${otherOrigin}/api/editorial/status`, {
        headers: { cookie, origin: otherOrigin },
      })
    ).status,
    403,
  );
  const headers = { cookie, origin, "content-type": "application/json" };
  const response = await fetch(`${origin}/api/editorial/status`, { headers });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes(fixtureKey), false);
  const bad = await fetch(`${origin}/api/editorial/settings`, {
    method: "POST",
    headers: { ...headers, origin: "https://foreign.example" },
    body: JSON.stringify({ settings: settings() }),
  });
  assert.equal(bad.status, 403);
  const saved = await fetch(`${origin}/api/editorial/settings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ settings: settings(), apiKey: fixtureKey }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.text()).includes(fixtureKey), false);
  for (const name of await readdir(f.directory)) {
    if (name.endsWith(".json"))
      assert.equal(
        (await readFile(resolve(f.directory, name), "utf8")).includes(fixtureKey),
        false,
      );
  }
});

test("concurrent setup responses describe their own saved selection so later admission cannot silently switch models", async (t) => {
  const f = await fixture(t);
  const values = Array.from({ length: 8 }, (_unused, index) => ({
    ...settings(),
    hyperspace: { ...settings().hyperspace, model: `intended-model-${index}` },
  }));
  const responses = await Promise.all(
    values.map((value) => f.manager.configure({ settings: value })),
  );
  for (const [index, response] of responses.entries()) {
    assert.deepEqual(response.settings, values[index]);
    assert.equal(response.settingsHash, hash(JSON.stringify(values[index])));
  }
});

test("cross-studio cancellation between stages prevents the correction even before the timer polls", async (t) => {
  let calls = 0;
  let release: (value: unknown) => void = () => {};
  const f = await fixture(t, async () => {
    calls++;
    return new Promise((done) => {
      release = done;
    });
  });
  const started = await f.manager.start(await f.input());
  while (!calls) await new Promise(setImmediate);
  const other = new WritingManager({
    directory: f.directory,
    secrets: secretStore(),
    transport: f.transport,
  });
  await other.cancel(started.id);
  release(reply(snapshot(f.episode())));
  const job = await waitFor(f.manager, started.id);
  assert.equal(job.state, "CANCELED");
  assert.equal(calls, 1);
});

test("active requests retain their exact model when preferences are changed and broken preferences remain repairable in UI", async (t) => {
  let release: () => void = () => {};
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    if (calls === 1)
      await new Promise<void>((done) => {
        release = done;
      });
    return reply(snapshot(f.episode()));
  });
  const input = await f.input();
  const started = await f.manager.start(input);
  while (!calls) await new Promise(setImmediate);
  await f.manager.configure({
    settings: { ...settings(), hyperspace: { ...settings().hyperspace, model: `${model}[1m]` } },
  });
  release();
  const job = await waitFor(f.manager, started.id);
  assert.equal(job.state, "SUCCEEDED");
  const completions = f.requests.filter((item) => item.url.endsWith("chat/completions"));
  assert.equal(completions.length, 2);
  assert.ok(
    completions.every(
      (item) => (item.options?.body as { model?: string } | undefined)?.model === model,
    ),
  );
  await writeFile(resolve(f.directory, "settings.json"), "broken JSON");
  const status = await f.manager.status();
  assert.match(status.settingsIssue ?? "", /save them again/u);
  assert.deepEqual(status.settings, defaultWritingSettings);
  await assert.rejects(
    f.manager.start({ ...input, requestId: randomUUID() }),
    /settings could not be read/u,
  );
  const repaired = await f.manager.configure({ settings: settings() });
  assert.equal(repaired.settingsIssue, undefined);
});

test("presentation generation uses one completion, previews safely, and binds both wording and design before apply", async (t) => {
  const episode = await readContentEpisode("CAP-01@casual-v2");
  const design: PresentationDesign = {
    schemaVersion: 1,
    theme: "ocean",
    motion: "snappy",
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      headline: scene.overlay,
      emphasis: "evidence",
    })),
  };
  const f = await fixture(t, async () => reply(design));
  const input = await f.input("presentation");
  const completed = await waitFor(f.manager, (await f.manager.start(input)).id);
  assert.equal(completed.state, "SUCCEEDED");
  assert.equal(completed.stages.length, 1);
  assert.deepEqual(completed.result, design);
  const context = {
    selector: input.selector,
    sourceHash: input.sourceHash,
    snapshot: input.snapshot,
  };
  assert.deepEqual((await f.manager.proposal(completed.id, context)).proposal, design);
  const preview = await f.manager.preview(completed.id, context);
  assert.match(preview.html, /custom-design/);
  assert.match(preview.html, /emphasis-evidence/);
  assert.match(preview.html, /connect-src 'none'/);
  assert.doesNotMatch(preview.html, new RegExp(fixtureKey));
  assert.equal(
    f.requests.filter((item) => item.url.endsWith("/chat/completions")).length,
    1,
    "preview never infers again",
  );
  await assert.rejects(
    f.manager.proposal(completed.id, { ...context, snapshot: { ...input.snapshot, design } }),
    /wording changed/,
  );
  const changed = structuredClone(input.snapshot);
  const opening = changed.scenes[0];
  assert.ok(opening);
  opening.texts = ["A different opening question?"];
  await assert.rejects(
    f.manager.preview(completed.id, { ...context, snapshot: changed }),
    /wording changed/,
  );
  for (const invalid of [
    { ...design, html: "<script>bad()</script>" },
    { ...design, theme: "external-url" },
    { ...design, scenes: design.scenes.toReversed() },
    { ...design, scenes: design.scenes.map((scene) => ({ ...scene, headline: "<img src=x>" })) },
  ])
    assert.throws(() =>
      parsePresentationDesign(
        invalid,
        episode.scenes.map((scene) => scene.id),
      ),
    );
});

test("final review checks companion and rendered headlines while excluding private media and preserving saved facts", async (t) => {
  const f = await fixture(t);
  const episode = structuredClone(f.episode());
  assert.ok(episode.presentation?.speakers[0]);
  episode.presentation.speakers[0].voice = {
    engine: "qwen",
    profileId: randomUUID(),
    revision: "a".repeat(64),
  };
  episode.presentation.speakers[0].avatar = { mode: "photo", imageId: "private-headshot.png" };
  f.replaceEpisode(episode);
  const input = await f.input("final-review");
  input.snapshot.publicationText = "A companion post with &#8211; left inside it.";
  input.snapshot.design = {
    schemaVersion: 1,
    theme: "ocean",
    motion: "smooth",
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      headline: "A visual cue",
      emphasis: "balanced",
    })),
  };
  const context = finalReviewContext(episode, input.snapshot);
  assert.equal(context.companionPost, input.snapshot.publicationText);
  assert.ok(context.visualHeadlines.every((item) => item.text === "A visual cue"));
  const prompt = JSON.stringify(writingMessages(input, episode));
  assert.match(prompt, /companion|geography|HTML entities|BEFORE rendering/u);
  assert.doesNotMatch(prompt, /private-headshot|profileId|imageId|faceLandmarks/u);
  assert.ok(!prompt.includes(fixtureKey));
  assert.throws(
    () => parseWritingInput({ ...input, snapshot: snapshot(episode) }),
    /companion post/u,
  );
  const compiled = episodeWithWritingSnapshot(episode, input.snapshot);
  assert.deepEqual(compiled.claims, episode.claims);
  assert.deepEqual(compiled.sources, episode.sources);
  assert.deepEqual(compiled.presentation?.speakers, episode.presentation.speakers);
});

test("final reviews persist, use exactly one completion, and become outdated for any reviewed text/evidence change", async (t) => {
  const review: FinalReview = {
    summary: "No issues in the supplied text; sources and media still need review.",
    issues: [],
  };
  const f = await fixture(t, async () => reply(review));
  const input = await f.input("final-review");
  input.snapshot.design = {
    schemaVersion: 1,
    theme: "ocean",
    motion: "smooth",
    scenes: f
      .episode()
      .scenes.map((scene) => ({ id: scene.id, headline: scene.overlay, emphasis: "balanced" })),
  };
  await assert.rejects(
    f.manager.start({ ...input, allowRemote: false }),
    /possible downstream cost/u,
  );
  const running = await f.manager.start(input);
  assert.equal((await f.manager.start(input)).id, running.id);
  const completed = await waitFor(f.manager, running.id);
  assert.equal(completed.state, "SUCCEEDED");
  assert.equal(completed.stages.length, 1);
  assert.equal(completed.finalReviewHash, finalReviewFingerprint(f.episode(), input.snapshot));
  const body = { selector: input.selector, sourceHash: input.sourceHash, snapshot: input.snapshot };
  const status = await f.manager.finalReviewStatus(body);
  assert.equal(status.state, "current");
  assert.equal(status.outcome, "clear");
  for (const change of [
    (copy: WritingInput["snapshot"]) => {
      copy.publicationText += " A changed post.";
    },
    (copy: WritingInput["snapshot"]) => {
      copy.title = "A new title";
    },
    (copy: WritingInput["snapshot"]) => {
      (copy.scenes[0] as NonNullable<(typeof copy.scenes)[0]>).texts[0] = "A different opening?";
    },
    (copy: WritingInput["snapshot"]) => {
      if (copy.design?.scenes[0]) copy.design.scenes[0].headline = "A new visual cue";
    },
  ]) {
    const copy = structuredClone(input.snapshot);
    change(copy);
    assert.equal(
      (await f.manager.finalReviewStatus({ ...body, snapshot: copy })).state,
      "outdated",
    );
  }
  const original = structuredClone(f.episode());
  const changedEvidence = structuredClone(original);
  assert.ok(changedEvidence.claims[0]);
  changedEvidence.claims[0].text += " Changed source scope.";
  f.replaceEpisode(changedEvidence);
  assert.equal(
    (
      await f.manager.finalReviewStatus({
        ...body,
        sourceHash: hash(JSON.stringify(changedEvidence)),
      })
    ).state,
    "outdated",
  );
  const savedCopy = structuredClone(original);
  assert.ok(savedCopy.presentation);
  savedCopy.presentation.variant = "saved-copy";
  f.replaceEpisode(savedCopy);
  assert.equal(
    (
      await f.manager.finalReviewStatus({
        ...body,
        selector: "CAP-01@saved-copy",
        sourceHash: hash(JSON.stringify(savedCopy)),
      })
    ).state,
    "current",
  );
  const restarted = new WritingManager({
    directory: f.directory,
    readEpisode: async () => savedCopy,
  });
  assert.equal(
    (
      await restarted.finalReviewStatus({
        ...body,
        selector: "CAP-01@saved-copy",
        sourceHash: hash(JSON.stringify(savedCopy)),
      })
    ).state,
    "current",
  );
  assert.equal(
    f.requests.filter((item) => item.url.endsWith("/chat/completions")).length,
    1,
    "status, restart and content comparison never infer",
  );
});

test("final-review fixes require an exact current binding, validate edits, and keep voice/photo/evidence intact", async (t) => {
  let review: FinalReview;
  const f = await fixture(t, async () => reply(review));
  const input = await f.input("final-review");
  review = {
    summary: "Align the post and opening.",
    issues: [
      {
        severity: "medium",
        area: "companion",
        sceneId: "overall",
        message: "Post needs a clearer discussion question.",
        suggestion: "Keep sources and add a concrete question.",
        fix: {
          field: "publicationText",
          sceneId: "overall",
          turnIndex: 0,
          before: input.snapshot.publicationText as string,
          after: `${input.snapshot.publicationText}\n\nWhich entity would you expose?`,
        },
      },
      {
        severity: "low",
        area: "script",
        sceneId: "hook",
        message: "Opening could sound more natural.",
        suggestion: "Use a direct question.",
        fix: {
          field: "narration",
          sceneId: "hook",
          turnIndex: 0,
          before: input.snapshot.scenes[0]?.texts[0] as string,
          after: "Where did your API go?",
        },
      },
    ],
  };
  const job = await waitFor(f.manager, (await f.manager.start(input)).id);
  assert.equal(job.state, "SUCCEEDED");
  const body = { selector: input.selector, sourceHash: input.sourceHash, snapshot: input.snapshot };
  const { snapshot: fixed } = await f.manager.finalReviewFixes(job.id, body);
  assert.equal(fixed.scenes[0]?.texts[0], "Where did your API go?");
  assert.ok(fixed.publicationText?.endsWith("Which entity would you expose?"));
  const compiled = episodeWithWritingSnapshot(f.episode(), fixed);
  assert.deepEqual(compiled.presentation?.speakers, f.episode().presentation?.speakers);
  assert.deepEqual(compiled.claims, f.episode().claims);
  assert.deepEqual(compiled.sources, f.episode().sources);
  assert.equal((await f.manager.finalReviewStatus({ ...body, snapshot: fixed })).state, "outdated");
  await assert.rejects(
    f.manager.finalReviewFixes(job.id, { ...body, snapshot: fixed }),
    /content changed/u,
  );
  assert.throws(
    () =>
      applyFinalReviewFixes(
        fixed,
        review.issues.flatMap((i) => (i.fix ? [i.fix] : [])),
      ),
    /content changed/u,
  );
  for (const invalid of [
    {
      ...review,
      issues: [
        { ...review.issues[0], fix: { ...review.issues[0]?.fix, before: "A partial excerpt" } },
      ],
    },
    { ...review, issues: [{ ...review.issues[0], area: "sources" }] },
    {
      ...review,
      issues: [{ ...review.issues[0], fix: { ...review.issues[0]?.fix, field: "voice" } }],
    },
    { ...review, issues: [review.issues[0], review.issues[0]] },
  ])
    assert.throws(() => parseFinalReview(invalid, input.snapshot, f.episode()));
});

test("final-review status and fixes routes enforce the local session and never start inference", async (t) => {
  const f = await fixture(t, async () =>
    reply({
      summary: "Check source scope with the publisher.",
      issues: [
        {
          severity: "high",
          area: "sources",
          sceneId: "overall",
          message: "Saved sources need a current review.",
          suggestion: "Re-read the official sources.",
          fix: null,
        },
      ],
    }),
  );
  const input = await f.input("final-review");
  const job = await waitFor(f.manager, (await f.manager.start(input)).id);
  const { server, url } = await startPreviewServer(f.directory, 0, "127.0.0.1", {
    editorial: f.manager,
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const origin = new URL(url).origin;
  const body = JSON.stringify({
    selector: input.selector,
    sourceHash: input.sourceHash,
    snapshot: input.snapshot,
  });
  assert.equal(
    (
      await fetch(`${origin}/api/editorial/final-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
    ).status,
    403,
  );
  const cookie = (await fetch(`${origin}/api/local-voices/session`)).headers
    .get("set-cookie")
    ?.split(";")[0];
  assert.ok(cookie);
  const headers = { cookie, origin, "content-type": "application/json" };
  const response = await fetch(`${origin}/api/editorial/final-review`, {
    method: "POST",
    headers,
    body,
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as { state: string; outcome: string };
  assert.equal(result.state, "current");
  assert.equal(result.outcome, "needs-attention");
  const fixes = await fetch(`${origin}/api/editorial/jobs/${job.id}/fixes`, {
    method: "POST",
    headers,
    body,
  });
  assert.equal(fixes.status, 200);
  assert.deepEqual(((await fixes.json()) as { fixes: unknown[] }).fixes, []);
  assert.equal(
    (
      await fetch(`${origin}/api/editorial/final-review`, {
        method: "POST",
        headers: { ...headers, origin: "https://foreign.example" },
        body,
      })
    ).status,
    403,
  );
  assert.equal(f.requests.filter((r) => r.url.endsWith("/chat/completions")).length, 1);
});

test("response budgets are configurable, migrate old settings, and omit all app token caps in provider-default mode", async () => {
  const legacy = structuredClone(defaultWritingSettings) as Partial<typeof defaultWritingSettings>;
  delete legacy.outputTokens;
  assert.deepEqual(parseWritingSettings(legacy).outputTokens, {
    writing: 8192,
    finalReview: 16384,
  });
  for (const invalid of [-1, 0, 255, 131073, 1024.5, "8192", undefined])
    assert.throws(() =>
      parseWritingSettings({
        ...settings(),
        outputTokens: { writing: invalid, finalReview: 16384 },
      }),
    );
  for (const provider of ["local", "hyperspace"] as const) {
    const config: WritingSettings = {
      ...settings(),
      provider,
      outputTokens: { writing: 12288, finalReview: 24576 },
    };
    if (provider === "hyperspace") config.hyperspace.model = "gpt-6.1-sol";
    for (const finalReview of [false, true]) {
      let request: Record<string, unknown> = {};
      const run = async () =>
        writingCompletion(config, [{ role: "user", content: "Public budget fixture" }], {
          finalReview,
          transport: async (_url, options) => {
            request = options?.body as Record<string, unknown>;
            return reply({ summary: "Complete", issues: [] });
          },
        });
      await run();
      const key = provider === "local" ? "max_tokens" : "max_completion_tokens";
      assert.equal(request[key], finalReview ? 24576 : 12288);
      config.outputTokens = {
        writing: null,
        finalReview: null,
      };
      await run();
      assert.equal(Object.hasOwn(request, "max_tokens"), false);
      assert.equal(Object.hasOwn(request, "max_completion_tokens"), false);
      config.outputTokens = { writing: 12288, finalReview: 24576 };
    }
  }
});

test("final review pins its chosen response budget for the admitted job", async (t) => {
  const f = await fixture(t, async () =>
    reply({ summary: "No major text issues flagged.", issues: [] }),
  );
  const config = settings();
  config.outputTokens.finalReview = null;
  await f.manager.configure({ settings: config });
  const input = await f.input("final-review");
  const job = await waitFor(f.manager, (await f.manager.start(input)).id);
  assert.equal(job.state, "SUCCEEDED");
  assert.equal(job.outputTokenLimit, null);
  const call = f.requests.find((entry) => entry.url.endsWith("/chat/completions"));
  assert.ok(call);
  assert.equal(Object.hasOwn(call.options?.body ?? {}, "max_tokens"), false);
  config.outputTokens.finalReview = 24576;
  await f.manager.configure({ settings: config });
  assert.equal(
    (await f.manager.get(job.id))?.outputTokenLimit,
    null,
    "settings changes never rewrite completed receipt budgets",
  );
});

test("local final reviews request schema-constrained JSON while remote models keep their supported transport", async (t) => {
  const f = await fixture(t, async () =>
    reply({ summary: "No issues in the supplied text.", issues: [] }),
  );
  await f.manager.configure({ settings: structuredClone(defaultWritingSettings) });
  const input = await f.input("final-review");
  const job = await waitFor(f.manager, (await f.manager.start(input)).id);
  assert.equal(job.state, "SUCCEEDED");
  const call = f.requests.find((entry) => entry.url.endsWith("/chat/completions"));
  assert.ok(call);
  const body = call.options?.body as {
    response_format: {
      type: string;
      json_schema: {
        strict: boolean;
        schema: {
          properties: { issues: { items: { properties: { sceneId: { enum: string[] } } } } };
        };
      };
    };
  };
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(
    body.response_format.json_schema.schema.properties.issues.items.properties.sceneId.enum,
    ["overall", ...f.episode().scenes.map((scene) => scene.id)],
  );
  assert.equal(call.options?.timeoutMs, 300000);
});
