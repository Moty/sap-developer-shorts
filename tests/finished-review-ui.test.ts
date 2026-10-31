import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as tick } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const source = (await readFile(new URL("../templates/library.js", import.meta.url), "utf8")).split(
  "// Exact-output advisory review; this never changes the approval checks.",
)[1];
assert.ok(source);
async function reviewPage(fail: boolean, staticServer = false) {
  class Node {
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    textContent = "";
    listeners = new Map<string, () => void>();
    paused = false;
    loaded = false;
    currentTime = 0;
    set src(value: string) {
      this.attributes.src = value;
    }
    get src() {
      return this.attributes.src ?? "";
    }
    set href(value: string) {
      this.attributes.href = value;
    }
    get href() {
      return this.attributes.href ?? "";
    }
    pause() {
      this.paused = true;
    }
    load() {
      this.loaded = true;
    }
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    }
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    }
    removeAttribute(name: string) {
      delete this.attributes[name];
    }
    addEventListener(name: string, handler: () => void) {
      this.listeners.set(name, handler);
    }
    replaceChildren() {}
    append() {}
  }
  const ids = [
    "output-review",
    "release-review",
    "output-review-status",
    "output-review-findings",
    "release-video",
    "review-kit-download",
    "output-review-import",
    "output-review-json",
  ];
  const nodes = new Map(ids.map((id) => [`#${id}`, new Node()]));
  const release = nodes.get("#release-review");
  const video = nodes.get("#release-video");
  assert.ok(release && video);
  release.dataset = { selector: "CAP-01", renderKey: "a".repeat(64) };
  video.src = "video/short.mp4";
  const link = new Node();
  link.href = "video/short.mp4";
  const calls: string[] = [];
  runInNewContext(source as string, {
    location: { protocol: "http:" },
    document: {
      querySelector: (id: string) => nodes.get(id) ?? null,
      querySelectorAll: () => [link],
      createElement: () => new Node(),
    },
    fetch: async (url: string) => {
      calls.push(url);
      if (url === "/api/local-voices/session")
        return { ok: !staticServer, status: staticServer ? 404 : 200 };
      return {
        ok: !fail,
        json: async () =>
          fail
            ? { error: "This page shows an older render." }
            : {
                kit: {
                  selector: "CAP-01",
                  renderKey: release.dataset.renderKey,
                  videoHash: "b".repeat(64),
                },
                review: null,
                stale: false,
              },
      };
    },
  });
  await tick(0);
  return { calls, video, link, status: nodes.get("#output-review-status")?.textContent };
}
test("fresh output review establishes session and binds playback before enabling exact download", async () => {
  const page = await reviewPage(false);
  assert.equal(page.calls[0], "/api/local-voices/session");
  assert.ok(page.video.src.startsWith("/api/creator/video?selector=CAP-01&renderKey="));
  assert.ok(page.video.src.includes(`videoHash=${"b".repeat(64)}`));
  assert.equal(page.link.href, page.video.src);
  assert.equal(page.link.getAttribute("aria-disabled"), null);
  assert.equal(page.video.paused, true);
  assert.equal(
    page.calls.some((url) => url.includes("/workflow")),
    false,
  );
});
test("stale or failed review validation cannot play/download mutable media under old metadata", async () => {
  const page = await reviewPage(true);
  assert.equal(page.video.src, "");
  assert.equal(page.link.href, "");
  assert.equal(page.link.getAttribute("aria-disabled"), "true");
  assert.match(page.status ?? "", /older render.*unavailable/s);
});

test("a portable studio served by static HTTP retains saved playback and downloads", async () => {
  const page = await reviewPage(false, true);
  assert.equal(page.video.src, "video/short.mp4");
  assert.equal(page.link.href, "video/short.mp4");
  assert.equal(page.link.getAttribute("aria-disabled"), null);
  assert.match(page.status ?? "", /static copy/);
  assert.deepEqual(page.calls, ["/api/local-voices/session"]);
});
