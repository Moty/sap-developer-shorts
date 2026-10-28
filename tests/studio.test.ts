import assert from "node:assert/strict";
import test from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import type { LibraryEntry } from "../src/library.js";
import { createLibraryPages } from "../src/library-review.js";
import {
  comparisonId,
  recordedNarrator,
  studioReadiness,
  studioReturnFragment,
} from "../src/studio.js";

async function entry(selector: string, voice = "af_heart"): Promise<LibraryEntry> {
  return {
    episode: await readContentEpisode(selector),
    sourceReviewExpired: false,
    preview: {
      kind: "narrated",
      durationSeconds: 55,
      timingReady: true,
      sourceRunId: "fixture",
      sourceManifestHash: "fixture",
      mediaJobId: "fixture",
      updatedAt: new Date().toISOString(),
      files: {
        "review.html": Buffer.from("Narration player fixture"),
        "timing.json": Buffer.from(JSON.stringify({ engine: "kokoro", voice })),
      },
    },
  };
}

test("saved review pages show generation time separately from playback duration and preserve media", async () => {
  const value = await entry("CAP-01@casual");
  const media = Buffer.from("unchanged verified MP4 fixture");
  value.video = {
    renderKey: "fixture",
    durationSeconds: 55,
    files: {
      "review.html": Buffer.from('<!--LIBRARY_BACK--><div class="links"></div>'),
      "short.mp4": media,
    },
  };
  value.generation = {
    basis: "generation",
    totalMs: 538000,
    stages: { preparationMs: 1000, audioMs: 43000, videoMs: 494000 },
    reusedAudio: true,
    reusedVideo: false,
  };
  const pages = await createLibraryPages({
    entries: [value],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.match(String(pages["review.html"]), /55\.0s recorded/);
  assert.match(String(pages["review.html"]), /Generated in 8m 58s · reused media/);
  for (const name of ["publish.html", "video/review.html"]) {
    const html = String(pages[`episodes/CAP-01@casual/${name}`]);
    assert.match(html, /Total to MP4: 8m 58s/);
    assert.match(html, /Audio &amp; captions · reused/);
    assert.match(html, /Video &amp; portrait/);
  }
  assert.deepEqual(pages["episodes/CAP-01@casual/video/short.mp4"], media);
});

test("studio voice labels describe the recording, including an older chosen voice, rather than current defaults", async () => {
  const solo = await entry("CAP-01@casual", "af_bella");
  assert.equal(
    recordedNarrator(solo),
    "Kokoro · Bella",
    "the authored default is Heart but this recording uses Bella",
  );
  const duo = await entry("CAP-01@duo");
  assert.equal(recordedNarrator(duo), "Kokoro · Mira (Heart) + Max (Michael)");
  const legacy = await entry("CAP-01");
  assert.ok(legacy.preview);
  legacy.preview.files["timing.json"] = Buffer.from(JSON.stringify({ voice: "Samantha" }));
  assert.equal(recordedNarrator(legacy), "System voice · Samantha");
});

test("missing recordings, invalid timing, and expired exports keep specific readiness states", async () => {
  const value = await entry("NEWS-01");
  assert.equal(studioReadiness(value).label, "Narration ready · MP4 pending");
  assert.ok(value.preview);
  value.preview.timingReady = false;
  assert.equal(studioReadiness(value).label, "Timing needs review");
  value.video = {
    renderKey: "fixture",
    durationSeconds: 55,
    files: { "review.html": Buffer.from("<!--LIBRARY_BACK-->Saved video fixture") },
  };
  value.sourceReviewExpired = true;
  assert.deepEqual(studioReadiness(value), {
    label: "Saved export · sources need rechecking",
    attention: true,
  });
  const files = await createLibraryPages({
    entries: [value],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.match(
    String(files["episodes/NEWS-01/video/review.html"]),
    /Saved export · sources need rechecking/,
  );
  assert.match(String(files["episodes/NEWS-01/video/review.html"]), /review.html#episodes/);
  value.preview = null;
  delete value.video;
  value.sourceReviewExpired = false;
  assert.equal(studioReadiness(value).label, "No recording yet");
});

test("comparison anchors and return links work without scripts and voice text remains escaped", async () => {
  const professional = await entry("CAP-01", "af_bella");
  const duo = await entry("CAP-01@duo");
  duo.video = {
    renderKey: "fixture",
    durationSeconds: 55,
    files: {
      "review.html": Buffer.from("<!--LIBRARY_BACK-->Video fixture"),
      "poster.png": Buffer.from("poster fixture"),
    },
  };
  const files = await createLibraryPages({
    entries: [duo, professional],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  const html = String(files["review.html"]);
  assert.match(html, /class="shorts-controls" data-enhancement-only hidden/);
  assert.match(html, /href="#compare-CAP-01--duo" data-style-choice>Conversation/);
  assert.match(html, /<article id="compare-CAP-01--duo" class="style-panel" data-comparison-panel/);
  assert.doesNotMatch(html, /<article[^>]*data-comparison-panel[^>]*\bhidden\b/u);
  assert.ok(html.indexOf('id="compare-CAP-01"') < html.indexOf('id="compare-CAP-01--duo"'));
  assert.match(html, /Kokoro · Bella/);
  assert.match(html, /npm run shorts -- produce CAP-01@duo/);
  assert.match(
    String(files["episodes/CAP-01@duo/video/review.html"]),
    /review.html#compare-CAP-01--duo/,
  );
  assert.match(String(files["episodes/CAP-01@duo/watch.html"]), /review.html#compare-CAP-01--duo/);
  assert.equal(comparisonId(duo), "compare-CAP-01--duo");
  assert.ok(professional.preview);
  professional.preview.files["timing.json"] = Buffer.from(
    JSON.stringify({ voice: '<img src=x onerror="attack">' }),
  );
  const escaped = await createLibraryPages({
    entries: [professional],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  assert.match(String(escaped["review.html"]), /System voice · &lt;img/);
  assert.doesNotMatch(String(escaped["review.html"]), /<img src=x onerror=/);
});

test("format examples reflect scripts, previews, and exports instead of hardcoded readiness", async () => {
  const quiz = await entry("CAP-02@quiz");
  const professional = await entry("CAP-01");
  const casual = await entry("CAP-01@casual");
  casual.video = {
    renderKey: "fixture",
    durationSeconds: 55,
    files: { "review.html": Buffer.from("<!--LIBRARY_BACK-->Video fixture") },
  };
  const render = async () => {
    const pages = await createLibraryPages({
      entries: [professional, quiz, casual],
      topics: [],
      newsTopics: [],
      budgetCents: 500,
    });
    const html = String(pages["review.html"]);
    return (format: string) =>
      html.match(
        new RegExp(
          `<article class="style-option" data-story-format="${format}">([\\s\\S]*?)</article>`,
        ),
      )?.[1] ?? "";
  };
  const preview = quiz.preview;
  quiz.preview = null;
  let cards = await render();
  assert.match(cards("quiz"), /Script prepared · preview pending/);
  assert.doesNotMatch(cards("quiz"), /Watch example|Review example/);
  assert.match(cards("dialogue"), /Script needed/);
  assert.match(cards("explainer"), /CAP-01%40casual\/video\/review.html/);
  quiz.preview = preview;
  cards = await render();
  assert.match(cards("quiz"), /CAP-02%40quiz\/watch.html/);
  assert.match(cards("quiz"), /Review example/);
  quiz.video = {
    renderKey: "fixture",
    durationSeconds: 55,
    files: { "review.html": Buffer.from("<!--LIBRARY_BACK-->Video fixture") },
  };
  cards = await render();
  assert.match(cards("quiz"), /CAP-02%40quiz\/video\/review.html/);
  assert.match(cards("quiz"), /Watch example/);
  quiz.sourceReviewExpired = true;
  cards = await render();
  assert.match(cards("quiz"), /Watch saved example/);
  assert.match(cards("quiz"), /sources need rechecking/);
});

test("the conversation gallery retains ordinary links to news and tutorial examples", async () => {
  const news = await entry("NEWS-02@duo");
  const tutorial = await entry("CAP-01@duo");
  for (const value of [news, tutorial])
    value.video = {
      renderKey: "fixture",
      durationSeconds: 55,
      files: { "review.html": Buffer.from("<!--LIBRARY_BACK-->Video fixture") },
    };
  const pages = await createLibraryPages({
    entries: [news, tutorial],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  const html =
    String(pages["review.html"]).match(
      /data-story-format="dialogue">([\s\S]*?)<\/article>/u,
    )?.[1] ?? "";
  assert.match(html, /NEWS-02%40duo\/video\/review.html/u);
  assert.match(html, /CAP-01%40duo\/video\/review.html/u);
  assert.match(html, /Watch tutorial conversation/u);
  assert.equal(recordedNarrator(news), "Kokoro · Mira (Heart) + Max (Michael)");
});

test("new CAP deliveries stay in the gallery while the original comparison and return anchors stay consistent", async () => {
  const originals = await Promise.all(
    ["CAP-01", "CAP-01@casual", "CAP-01@comic", "CAP-01@duo"].map((selector) => entry(selector)),
  );
  for (const value of originals)
    assert.equal(studioReturnFragment(value), `#${comparisonId(value)}`);
  const countdown = await entry("CAP-01@countdown");
  countdown.video = {
    renderKey: "fixture",
    durationSeconds: 55,
    files: { "review.html": Buffer.from("<!--LIBRARY_BACK-->Video fixture") },
  };
  assert.equal(studioReturnFragment(countdown), "#episodes");
  const custom = structuredClone(countdown);
  assert.ok(custom.episode.presentation);
  custom.episode.presentation.variant = "my-countdown";
  assert.equal(studioReturnFragment(custom), "#episodes");
  const pages = await createLibraryPages({
    entries: [countdown, ...originals.reverse()],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  const html = String(pages["review.html"]);
  const comparison = html.match(/<nav class="style-choices"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  assert.equal((comparison.match(/data-style-choice/gu) ?? []).length, 4);
  assert.ok(comparison.indexOf('#compare-CAP-01"') < comparison.indexOf("#compare-CAP-01--casual"));
  assert.doesNotMatch(comparison, /countdown/u);
  assert.doesNotMatch(html, /id="compare-CAP-01--countdown"/u);
  assert.match(
    html,
    /data-story-format="countdown">[\s\S]*?CAP-01%40countdown\/video\/review.html/u,
  );
  assert.match(
    String(pages["episodes/CAP-01@countdown/video/review.html"]),
    /review.html#episodes/u,
  );
  assert.match(String(pages["episodes/CAP-01@countdown/watch.html"]), /review.html#episodes/u);
});

test("all saved news entry points share dated fallback notices while copied tutorial players and media stay exact", async () => {
  const news = await entry("NEWS-02@duo");
  const tutorial = await entry("CAP-02");
  assert.ok(news.preview);
  news.preview.files["review.html"] = Buffer.from(
    "<html><head></head><body><main>Saved narration</main></body></html>",
  );
  const review = Buffer.from(
    "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; media-src 'self'\"></head><body><main><!--LIBRARY_BACK--><video controls></video><div class=\"links\"></div></main></body></html>",
  );
  news.video = {
    renderKey: "fixture",
    durationSeconds: 55,
    files: { "review.html": review, "short.mp4": Buffer.from("exact saved movie") },
  };
  const originalNewsFiles = Object.fromEntries(
    Object.entries(news.preview.files).map(([name, bytes]) => [name, Buffer.from(bytes)]),
  );
  const originalVideoFiles = Object.fromEntries(
    Object.entries(news.video.files).map(([name, bytes]) => [name, Buffer.from(bytes)]),
  );
  const pages = await createLibraryPages({
    entries: [news, tutorial],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
  });
  for (const path of [
    "review.html",
    "episodes/NEWS-02@duo/review.html",
    "episodes/NEWS-02@duo/video/review.html",
    "episodes/NEWS-02@duo/edit.html",
  ]) {
    const html = String(pages[path]);
    assert.match(html, /data-news-as-of="2026-10-15"/u, path);
    assert.match(html, /data-news-valid-through="2026-10-22"/u, path);
    assert.match(html, /Automatic date checks require JavaScript/u, path);
    assert.equal((html.match(/id="news-review-freshness-script"/gu) ?? []).length, 1, path);
  }
  // The watch page frames review.html, which already carries the notice; repeating it showed it twice.
  const watch = String(pages["episodes/NEWS-02@duo/watch.html"]);
  assert.match(watch, /<iframe class="episode-frame" src="review.html"/u);
  assert.doesNotMatch(watch, /data-news-review-notice|news-review-freshness/u);
  assert.match(String(pages["episodes/NEWS-02@duo/video/review.html"]), /review.html#episodes/u);
  assert.match(
    String(pages["episodes/NEWS-02@duo/edit.html"]),
    /This revision keeps the source-review dates/u,
  );
  assert.deepEqual(pages["episodes/NEWS-02@duo/video/short.mp4"], news.video.files["short.mp4"]);
  assert.deepEqual(news.preview.files, originalNewsFiles);
  assert.deepEqual(news.video.files, originalVideoFiles);
  assert.ok(tutorial.preview);
  assert.deepEqual(pages["episodes/CAP-02/review.html"], tutorial.preview.files["review.html"]);
  for (const path of [
    "episodes/CAP-02/review.html",
    "episodes/CAP-02/watch.html",
    "episodes/CAP-02/edit.html",
  ])
    assert.doesNotMatch(
      String(pages[path]),
      /<section\b[^>]*\sdata-news-review-notice(?:\s|=|>)|id="news-review-freshness/u,
      path,
    );
});
