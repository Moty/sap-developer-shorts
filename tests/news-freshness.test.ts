import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  decorateNewsReviewHtml,
  enhanceNewsReviewHtml,
  newsReviewNotice,
} from "../src/news/freshness.js";

const review = { asOf: "2026-10-15", maxAgeDays: 7 };
const page = (
  content: string,
  policy = "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'",
) =>
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Saved news</title></head><body><main>${content}</main></body></html>`;
const source = (html: string) => {
  const match = /<script id="news-review-freshness-script">([\s\S]*?)<\/script>/u.exec(html);
  assert.ok(match?.[1], "actual shared script must be present");
  return match[1];
};

function browser(
  initialNow: string | number,
  settings: { asOf?: string; through?: string; expired?: boolean }[] = [{}],
) {
  let clock = initialNow;
  class ClockDate extends Date {
    constructor(value?: string | number) {
      super(value === undefined ? clock : value);
    }
  }
  const notices = settings.map((setting) => ({
    dataset: {
      newsAsOf: setting.asOf ?? review.asOf,
      newsValidThrough: setting.through ?? "2026-10-22",
      newsExpired: String(setting.expired ?? false),
      newsReviewState: "static",
    },
    heading: { textContent: "Static heading" },
    message: { textContent: "Static text" },
    querySelector(selector: string) {
      return selector === "[data-news-review-heading]"
        ? this.heading
        : selector === "[data-news-review-message]"
          ? this.message
          : null;
    },
  }));
  const windowEvents = new Map<string, () => void>();
  const documentEvents = new Map<string, () => void>();
  const intervals: { callback: () => void; milliseconds: number }[] = [];
  const document = {
    visibilityState: "visible",
    querySelectorAll(selector: string) {
      assert.equal(selector, "[data-news-review-notice]");
      return notices;
    },
    addEventListener(name: string, handler: () => void) {
      documentEvents.set(name, handler);
    },
  };
  runInNewContext(source(enhanceNewsReviewHtml(page(newsReviewNotice(review)))), {
    Date: ClockDate,
    document,
    window: {
      addEventListener(name: string, handler: () => void) {
        windowEvents.set(name, handler);
      },
      setInterval(callback: () => void, milliseconds: number) {
        intervals.push({ callback, milliseconds });
      },
    },
  });
  return {
    notices,
    document,
    intervals,
    setNow(value: string | number) {
      clock = value;
    },
    pageShow() {
      windowEvents.get("pageshow")?.();
    },
    visibilityChange() {
      documentEvents.get("visibilitychange")?.();
    },
  };
}

test("news notices expose inclusive UTC dates, accessible status, and useful no-script guidance", () => {
  const html = newsReviewNotice(review);
  assert.match(html, /data-news-as-of="2026-10-15"/u);
  assert.match(html, /data-news-valid-through="2026-10-22"/u);
  assert.match(html, /Sources reviewed <strong>2026-10-15<\/strong>/u);
  assert.match(html, /review valid through <strong>2026-10-22<\/strong> \(UTC dates, inclusive\)/u);
  assert.match(html, /aria-label="News source review"/u);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/u);
  assert.match(html, /<h2 data-news-review-heading>Dated source review<\/h2>/u);
  assert.match(html, /<noscript><p>Automatic date checks require JavaScript/u);
  assert.match(html, /do not fetch sources or renew factual verification/u);
  assert.doesNotMatch(html, /<script/u);
  const invalid = newsReviewNotice({ asOf: '<img src=x onerror="bad()">$&', maxAgeDays: 7 });
  assert.match(invalid, /Check source-review dates/u);
  assert.match(invalid, /data-news-valid-through=""/u);
  assert.match(invalid, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;\$&amp;/u);
  assert.doesNotMatch(invalid, /<img/u);
  const decorated = decorateNewsReviewHtml(page("Original"), { asOf: "$&", maxAgeDays: 7 });
  assert.match(decorated, /<strong>\$&amp;<\/strong>/u);
  assert.equal((decorated.match(/<main>/gu) ?? []).length, 1);
});

test("the actual browser script uses UTC and includes the complete valid-through day", () => {
  const before = browser("2026-10-22T23:59:59.999Z");
  assert.equal(before.notices[0]?.dataset.newsReviewState, "dated");
  assert.match(before.notices[0]?.message.textContent ?? "", /does not verify current facts/u);
  const at = browser("2026-10-23T00:00:00.000Z");
  assert.equal(at.notices[0]?.dataset.newsReviewState, "expired");
  const localBeforeMidnight = browser("2026-10-22T17:00:00-07:00");
  assert.equal(localBeforeMidnight.notices[0]?.dataset.newsReviewState, "expired");
  const localNextDay = browser("2026-10-23T06:59:59+07:00");
  assert.equal(localNextDay.notices[0]?.dataset.newsReviewState, "dated");
  assert.deepEqual(at.notices[0]?.dataset, {
    newsAsOf: "2026-10-15",
    newsValidThrough: "2026-10-22",
    newsExpired: "true",
    newsReviewState: "expired",
  });
});

test("valid-through generation handles leap days and rejects malformed date windows", () => {
  assert.match(
    newsReviewNotice({ asOf: "2028-02-28", maxAgeDays: 1 }),
    /data-news-valid-through="2028-02-29"/u,
  );
  assert.match(
    newsReviewNotice({ asOf: "2028-02-29", maxAgeDays: 1 }),
    /data-news-valid-through="2028-03-01"/u,
  );
  for (const value of [
    { asOf: "2026-02-29", maxAgeDays: 7 },
    { asOf: "2026-13-01", maxAgeDays: 7 },
    { asOf: "2026-1-1", maxAgeDays: 7 },
    { asOf: "2026-10-15", maxAgeDays: 0 },
    { asOf: "2026-10-15", maxAgeDays: 8 },
    { asOf: "2026-10-15", maxAgeDays: 1.5 },
    { asOf: "2026-10-15", maxAgeDays: Number.NaN },
  ])
    assert.match(newsReviewNotice(value), /data-news-review-state="uncertain"/u);
  assert.equal(
    browser("2028-02-29T23:59:59Z", [{ asOf: "2028-02-28", through: "2028-02-29" }]).notices[0]
      ?.dataset.newsReviewState,
    "dated",
  );
  assert.equal(
    browser("2028-03-01T00:00:00Z", [{ asOf: "2028-02-28", through: "2028-02-29" }]).notices[0]
      ?.dataset.newsReviewState,
    "expired",
  );
});

test("invalid dates and future source reviews never present a current review window", () => {
  for (const setting of [
    { asOf: "2026-02-29" },
    { asOf: "" },
    { through: "bad" },
    { through: "2026-10-14" },
    { through: "2026-10-23" },
    { asOf: "2026-10-20", through: "2026-10-22" },
  ]) {
    const notice = browser("2026-10-15T12:00:00Z", [setting]).notices[0];
    assert.equal(notice?.dataset.newsReviewState, "uncertain");
    assert.equal(notice?.heading.textContent, "Check source-review dates");
  }
  assert.equal(browser(Number.NaN).notices[0]?.dataset.newsReviewState, "uncertain");
});

test("expiry stays sticky after clock rollback and preserves an expired build state", () => {
  const runtime = browser("2026-10-23T00:00:00Z", [{}, { expired: true }]);
  runtime.setNow("2026-10-16T12:00:00Z");
  runtime.pageShow();
  assert.ok(runtime.notices.every((notice) => notice.dataset.newsReviewState === "expired"));
  assert.equal(
    browser("2026-10-16T12:00:00Z", [{ expired: true }]).notices[0]?.dataset.newsReviewState,
    "expired",
  );
  assert.match(newsReviewNotice(review, true), /data-news-expired="true"/u);
  assert.match(
    newsReviewNotice(review, true),
    /<h2 data-news-review-heading>Source recheck required/u,
  );
});

test("pageshow, visibility return, and one bounded minute interval detect overnight expiry", () => {
  const runtime = browser("2026-10-22T23:59:59Z");
  assert.equal(runtime.intervals.length, 1);
  assert.equal(runtime.intervals[0]?.milliseconds, 60000);
  runtime.setNow("2026-10-23T00:00:01Z");
  runtime.intervals[0]?.callback();
  assert.equal(runtime.notices[0]?.dataset.newsReviewState, "expired");
  const restored = browser("2026-10-22T23:59:59Z");
  restored.setNow("2026-10-23T00:00:01Z");
  restored.pageShow();
  assert.equal(restored.notices[0]?.dataset.newsReviewState, "expired");
  const hidden = browser("2026-10-22T23:59:59Z");
  hidden.document.visibilityState = "hidden";
  hidden.setNow("2026-10-23T00:00:01Z");
  hidden.intervals[0]?.callback();
  hidden.visibilityChange();
  assert.equal(hidden.notices[0]?.dataset.newsReviewState, "dated");
  hidden.document.visibilityState = "visible";
  hidden.visibilityChange();
  assert.equal(hidden.notices[0]?.dataset.newsReviewState, "expired");
});

test("restrictive copied-player CSP permits only the exact added script and keeps media policy", () => {
  const html = decorateNewsReviewHtml(page('<video src="short.mp4" controls></video>'), review);
  const digest = createHash("sha256").update(source(html)).digest("base64");
  assert.ok(html.includes(`script-src 'sha256-${digest}'`));
  assert.match(
    html,
    /default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'/u,
  );
  assert.doesNotMatch(html, /script-src 'unsafe-inline'/u);
  assert.equal((html.match(/http-equiv="Content-Security-Policy"/gu) ?? []).length, 1);
  assert.match(html, /<video src="short.mp4" controls><\/video>/u);
  const elem = decorateNewsReviewHtml(
    page("", "default-src 'none'; script-src 'none'; script-src-elem 'none'; connect-src 'none'"),
    review,
  );
  assert.ok(elem.includes(`script-src 'sha256-${digest}'`));
  assert.ok(elem.includes(`script-src-elem 'sha256-${digest}'`));
  assert.match(elem, /connect-src 'none'/u);
});

test("existing inline script permissions are preserved without disabling existing scripts", () => {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'";
  const html = decorateNewsReviewHtml(
    page("<script>window.original = true;</script>", policy),
    review,
  );
  assert.ok(html.includes(`content="${policy}"`));
  assert.match(html, /<script>window.original = true;<\/script>/u);
  const restrictive = decorateNewsReviewHtml(
    page("", "script-src 'self' 'nonce-test'; script-src-elem 'self'"),
    review,
  );
  assert.match(restrictive, /script-src 'self' 'nonce-test' 'sha256-/u);
  assert.match(restrictive, /script-src-elem 'self' 'sha256-/u);
});

test("decoration and enhancement are idempotent, support fragments, and leave tutorials exact", () => {
  const original = page(
    '<h1>Keep this title</h1><!--LIBRARY_BACK--><video src="short.mp4"></video>',
  );
  assert.equal(enhanceNewsReviewHtml(original), original);
  const decorated = decorateNewsReviewHtml(original, review);
  assert.equal(decorateNewsReviewHtml(decorated, review), decorated);
  assert.equal(enhanceNewsReviewHtml(decorated), decorated);
  assert.match(decorated, /<main><section class="source-review-notice"/u);
  const bodyOnly = decorateNewsReviewHtml(
    "<body class=watch-page><iframe src=review.html></iframe></body>",
    review,
  );
  assert.match(bodyOnly, /<body class=watch-page><section class="source-review-notice"/u);
  const fragment = decorateNewsReviewHtml("<!--LIBRARY_BACK-->Saved video fixture", review);
  assert.match(fragment, /<!--LIBRARY_BACK-->Saved video fixture/u);
  assert.equal(decorateNewsReviewHtml(fragment, review), fragment);
  const cards = enhanceNewsReviewHtml(
    page(newsReviewNotice(review) + newsReviewNotice(review, true)),
  );
  assert.equal((cards.match(/<section class="source-review-notice"/gu) ?? []).length, 2);
  assert.equal((cards.match(/<script id="news-review-freshness-script">/gu) ?? []).length, 1);
  assert.equal((cards.match(/<style id="news-review-freshness-style">/gu) ?? []).length, 1);
});

test("redecorating promotes matching saved notices without downgrading expiry or changing other dates", () => {
  const saved = decorateNewsReviewHtml(page("<video src=short.mp4></video>"), review);
  const promoted = decorateNewsReviewHtml(saved, review, true);
  assert.match(promoted, /data-news-expired="true"/u);
  assert.match(promoted, /<h2 data-news-review-heading>Source recheck required/u);
  assert.match(promoted, /data-news-as-of="2026-10-15" data-news-valid-through="2026-10-22"/u);
  assert.match(promoted, /Sources reviewed <strong>2026-10-15<\/strong>/u);
  assert.match(promoted, /review valid through <strong>2026-10-22<\/strong>/u);
  assert.equal(decorateNewsReviewHtml(promoted, review, true), promoted);
  assert.equal(decorateNewsReviewHtml(promoted, review, false), promoted);
  assert.equal(source(promoted), source(saved));
  assert.equal((promoted.match(/<script id="news-review-freshness-script">/gu) ?? []).length, 1);
  assert.equal((promoted.match(/<style id="news-review-freshness-style">/gu) ?? []).length, 1);
  assert.match(promoted, /<video src=short.mp4><\/video>/u);

  const otherDate = newsReviewNotice({ asOf: "2026-10-16", maxAgeDays: 7 });
  const otherWindow = newsReviewNotice({ asOf: "2026-10-15", maxAgeDays: 6 });
  const mixed = enhanceNewsReviewHtml(
    page(newsReviewNotice(review) + otherDate + newsReviewNotice(review) + otherWindow),
  );
  const mixedPromoted = decorateNewsReviewHtml(mixed, review, true);
  assert.ok(mixedPromoted.includes(otherDate), "another as-of date must remain exact");
  assert.ok(mixedPromoted.includes(otherWindow), "another review window must remain exact");
  assert.equal((mixedPromoted.match(/data-news-expired="true"/gu) ?? []).length, 2);
  assert.equal((mixedPromoted.match(/data-news-expired="false"/gu) ?? []).length, 2);
  assert.equal((mixedPromoted.match(/<section class="source-review-notice"/gu) ?? []).length, 4);
  assert.equal(decorateNewsReviewHtml(mixedPromoted, review, false), mixedPromoted);
});
