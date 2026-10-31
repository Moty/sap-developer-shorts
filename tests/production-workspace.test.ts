import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

async function workspace(
  options: {
    stored?: string;
    stage?: string;
    accepted?: boolean;
    sourceExpired?: boolean;
    otherJob?: boolean;
    recoveryId?: string;
    storageBlocked?: boolean;
    failSecond?: boolean;
  } = {},
) {
  const nodes = new Map<string, Node>();
  const events = new Map<string, (event: { persisted?: boolean }) => void>();
  const requests: string[] = [];
  const storage = new Map<string, string>();
  const polls: Array<() => void> = [];
  const stage = options.stage;
  const jobId = "11111111-1111-4111-8111-111111111111";
  const selector = "CAP-01@new";
  const statuses = new Map<string, Node>();
  let focused = "";
  class Node {
    value = "";
    textContent = "";
    hidden = false;
    disabled = false;
    open = false;
    href = "";
    title = "";
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    children: Node[] = [];
    listeners = new Map<string, () => void>();
    selectedOptions = [{ textContent: "Heart" }];
    constructor(readonly id = "") {
      if (id) nodes.set(id, this);
    }
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value);
    }
    querySelector(selector: string): Node {
      if (!statuses.has(`${this.id}:${selector}`))
        statuses.set(`${this.id}:${selector}`, new Node());
      return statuses.get(`${this.id}:${selector}`) as Node;
    }
    querySelectorAll() {
      return [] as Node[];
    }
    replaceChildren(...children: Node[]) {
      this.children = children;
    }
    addEventListener(event: string, callback: () => void) {
      this.listeners.set(event, callback);
    }
    click() {
      if (!this.disabled) this.listeners.get("click")?.();
    }
    focus() {
      focused = this.id;
    }
    scrollIntoView() {}
  }
  const byId = (id: string) => nodes.get(id) ?? new Node(id);
  const pane = byId("production-workspace");
  const phases = ["PREFLIGHT", "NARRATION", "RENDER", "LIBRARY"].map((stage) => {
    const n = new Node(`phase-${stage}`);
    n.dataset.productionStage = stage;
    return n;
  });
  const go = ["script", "voice", "sources", "post", "ai"].map((target) => {
    const n = new Node(`go-${target}`);
    n.dataset.productionGo = target;
    return n;
  });
  pane.querySelector = (selector: string) => byId(selector);
  pane.querySelectorAll = (selector?: string) =>
    selector === "[data-production-stage]" ? phases : selector === "[data-production-go]" ? go : [];
  const draft = {
    baseEpisodeId: "CAP-01",
    publicationText: "Companion",
    scenes: [{ id: "hook", narration: "Try this" }],
    presentation: { speakers: [{ voice: "af_heart" }] },
  };
  const validation = {
    draft,
    errors: [] as string[],
    issues: { script: [] as string[], voice: [], presenter: [], post: [] as string[] },
    enabled: true,
    voicesReady: true,
  };
  byId("editor-data").textContent = JSON.stringify({
    seed: draft,
    writingContext: { selector: "CAP-01" },
    recoveryId: options.recoveryId ?? "fixture",
    productionHistory: [{ kind: "stock:illustrated", totalMs: 60000 }],
  });
  byId("variant-name").value = "new";
  byId("workspace-total-words").textContent = "2 draft words";
  byId("speaker-voice-0").value = "af_heart";
  byId("final-review-panel").dataset.reviewState = "outdated";
  byId("production-post");
  byId("production-ai");
  const notice = options.sourceExpired ? new Node() : null;
  if (notice)
    notice.dataset = {
      newsReviewState: "expired",
      newsExpired: "true",
      newsValidThrough: "2026-01-01",
    };
  if (options.stored) storage.set("shorts:production:CAP-01", options.stored);
  const context = {
    document: {
      getElementById: byId,
      querySelector: () => notice,
      createElement: () => new Node(),
      body: { dataset: { editorStep: "review" }, classList: { add() {} } },
    },
    sessionStorage: {
      getItem: (key: string) => {
        if (options.storageBlocked) throw new Error("Storage blocked");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (options.storageBlocked) throw new Error("Storage blocked");
        storage.set(key, value);
      },
    },
    fetch: async (path: string) => {
      requests.push(path);
      if (options.failSecond && requests.length === 2) throw new Error("Temporary disconnect");
      return {
        ok: true,
        json: async () => ({
          selector,
          id: stage ? jobId : null,
          stage: stage ?? null,
          active: stage === "NARRATION",
          otherJob: options.otherJob && requests.length === 1 ? { selector: "CAP-02" } : null,
          startedAt: "2026-10-28T10:00:00Z",
          updatedAt: "2026-10-28T10:01:00Z",
          report: stage
            ? {
                id: jobId,
                stage: stage === "INTERRUPTED" ? "NARRATION" : stage,
                failedAt: null,
                startedAt: "2026-10-28T10:00:00Z",
                updatedAt: "2026-10-28T10:01:00Z",
                generationTiming: {
                  totalMs: 60000,
                  stages: { PREFLIGHT: { elapsedMs: 1000, completedAt: "2026-10-28T10:00:01Z" } },
                },
              }
            : null,
        }),
      };
    },
    setTimeout: (callback: () => void) => polls.push(callback),
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    addEventListener: (name: string, fn: (event: { persisted?: boolean }) => void) =>
      events.set(name, fn),
    shortsWritingEditor: { validate: () => validation },
    shortsWorkspace: { showStep() {} },
    shortsProduction: undefined as unknown as {
      update(value: object): void;
      startAttempt(value: object): void;
      accepted(value: object): void;
      progress(value: object): void;
      reconnect(): void;
    },
  };
  runInNewContext(await readFile("templates/production-workspace.js", "utf8"), context);
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise((done) => setImmediate(done));
  };
  await settle();
  return {
    byId,
    context,
    validation,
    requests,
    storage,
    jobId,
    selector,
    phases,
    settle,
    events,
    polls,
    focused: () => focused,
  };
}

test("production readiness uses existing validation; optional AI review never blocks", async () => {
  const ui = await workspace();
  assert.equal(ui.byId("produce-script").disabled, false);
  assert.equal(ui.byId("editor-next").disabled, false);
  assert.match(ui.byId("production-estimate").textContent, /About/u);
  assert.match(ui.byId("production-check-ai").textContent, /optional/u);
  ui.validation.errors = ["Invalid companion"];
  ui.validation.issues.post = ["Invalid companion"];
  ui.context.shortsProduction.update(ui.validation);
  assert.equal(ui.byId("produce-script").disabled, true);
  assert.equal(ui.byId("production-check-post").textContent, "Invalid companion");
  assert.ok(
    ui.requests.every((path) => path.startsWith("/api/production-context?")),
    "read-only recovery never submits jobs",
  );
  const expired = await workspace({ sourceExpired: true });
  assert.equal(expired.byId("produce-script").disabled, true);
});

test("another active production is polled until Produce becomes available, including with an old finished receipt", async () => {
  for (const stage of [undefined, "READY"]) {
    const ui = await workspace({ otherJob: true, ...(stage ? { stage } : {}) });
    assert.equal(ui.byId("produce-script").disabled, true);
    assert.equal(ui.polls.length, 1);
    ui.polls[0]?.();
    await ui.settle();
    assert.equal(ui.byId("produce-script").disabled, false);
    assert.equal(ui.requests.length, 2);
  }
});

test("accepted job identity survives reload and interrupted workers are not automatically retried", async () => {
  const first = await workspace();
  first.context.shortsProduction.accepted({
    id: first.jobId,
    selector: first.selector,
    startedAt: "2026-10-28T10:00:00Z",
  });
  assert.equal(first.byId("produce-script").disabled, true);
  first.context.shortsProduction.progress({ stage: "NARRATION", message: "Generating audio" });
  first.context.shortsProduction.progress({
    stage: "RECONNECTING",
    message: "Connection interrupted",
  });
  assert.equal(first.byId("production-workspace").dataset.productionState, "NARRATION");
  const receipt = first.storage.get("shorts:production:CAP-01");
  assert.ok(receipt);
  const finished = await workspace({
    stored: receipt,
    stage: "READY",
    recoveryId: "hash-after-saving-reserved-name",
  });
  assert.match(finished.requests[0] ?? "", new RegExp(`jobId=${first.jobId}`));
  assert.equal(finished.byId("production-run-title").textContent, "Video ready for review");
  assert.equal(
    finished.byId("production-run-actions").children[0]?.href,
    "../../episodes/CAP-01%40new/publish.html",
  );
  assert.match(finished.byId("production-run-elapsed").textContent, /Measured generation/u);
  finished.context.shortsProduction.progress({ stage: "READY", libraryUpdated: false });
  assert.match(finished.byId("production-run-title").textContent, /refresh pending/u);
  assert.equal(finished.byId("production-run-actions").children.length, 1);
  const interrupted = await workspace({ stored: receipt, stage: "INTERRUPTED" });
  assert.match(interrupted.byId("production-run-message").textContent, /No active worker/u);
  assert.equal(interrupted.requests.length, 1);
});

test("a submission failure does not claim a saved video or link to a nonexistent revision", async () => {
  const ui = await workspace();
  ui.context.shortsProduction.startAttempt({ selector: ui.selector });
  assert.equal(ui.focused(), "production-run-title");
  ui.context.shortsProduction.progress({ stage: "FAILED", message: "Request rejected" });
  assert.equal(ui.byId("production-run-title").textContent, "Production could not start");
  assert.match(ui.byId("production-run-target").textContent, /Draft revision/u);
  assert.deepEqual(
    ui.byId("production-run-actions").children.map((child) => child.href),
    ["../../review.html#episodes"],
  );
  assert.equal(ui.byId("produce-script").disabled, false);
});

test("a connection error while waiting for another job keeps polling without submitting", async () => {
  const ui = await workspace({ otherJob: true, failSecond: true });
  ui.polls[0]?.();
  await ui.settle();
  assert.equal(ui.byId("produce-script").disabled, true);
  assert.equal(ui.polls.length, 2);
  ui.polls[1]?.();
  await ui.settle();
  assert.equal(ui.byId("produce-script").disabled, false);
  assert.ok(ui.requests.every((path) => path.startsWith("/api/production-context?")));
});

test("reconnection retains the accepted in-memory job when tab storage is unavailable", async () => {
  const ui = await workspace({ storageBlocked: true });
  ui.context.shortsProduction.accepted({ id: ui.jobId, selector: ui.selector });
  ui.context.shortsProduction.reconnect();
  await ui.settle();
  assert.match(ui.requests.at(-1) ?? "", new RegExp(`selector=CAP-01%40new&jobId=${ui.jobId}`));
});
