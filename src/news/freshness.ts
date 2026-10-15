import { createHash } from "node:crypto";

type NewsReviewDate = { asOf: string; maxAgeDays: number };

const styleId = "news-review-freshness-style";
const scriptId = "news-review-freshness-script";
const noticePattern = /<[a-z][^>]*\sdata-news-review-notice(?:\s|=|>)/iu;
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/gu, (character) => {
    return (
      (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<
          string,
          string
        >
      )[character] ?? character
    );
  });

function validThrough(news: NewsReviewDate): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(news.asOf) ||
    !Number.isInteger(news.maxAgeDays) ||
    news.maxAgeDays < 1 ||
    news.maxAgeDays > 7
  )
    return null;
  const start = new Date(`${news.asOf}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== news.asOf)
    return null;
  const end = new Date(start.getTime() + news.maxAgeDays * 86400000);
  const result = end.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(result) ? result : null;
}

const css = `.source-review-notice{box-sizing:border-box;flex-shrink:0;margin:16px 0;padding:14px 16px;border:1px solid #b4c4bc;border-left:4px solid #607d6b;border-radius:8px;background:#f2f5ef;color:#203c36;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}.source-review-notice h2{margin:0 0 6px;font:700 16px/1.4 system-ui,sans-serif;letter-spacing:normal;color:inherit}.source-review-notice p{margin:6px 0;max-width:none;font:inherit;color:inherit}.source-review-notice small{font:12px/1.5 system-ui,sans-serif;color:inherit}.source-review-notice[data-news-review-state="expired"],.source-review-notice[data-news-review-state="uncertain"]{border-color:#b79b65;border-left-color:#946415;background:#fff6df;color:#573b13}.watch-page>.source-review-notice{margin:8px 16px;flex-shrink:0}@media(max-width:480px){.source-review-notice{padding:12px;font-size:13px}}`;

// This exact source is also hashed into copied players' restrictive CSPs.
const browserScript = `(() => {
  "use strict";
  const notices = Array.from(document.querySelectorAll("[data-news-review-notice]"));
  if (!notices.length) return;
  const expired = new WeakSet();
  function parseDate(value) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value || "")) return null;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : null;
  }
  function update() {
    const now = new Date();
    const today = Number.isFinite(now.getTime()) ? parseDate(now.toISOString().slice(0, 10)) : null;
    for (const notice of notices) {
      const asOf = parseDate(notice.dataset.newsAsOf);
      const through = parseDate(notice.dataset.newsValidThrough);
      const validDates = asOf !== null && through !== null && through - asOf >= 86400000 && through - asOf <= 7 * 86400000;
      if (notice.dataset.newsExpired === "true" || (validDates && today !== null && today > through)) expired.add(notice);
      let state = "dated";
      let heading = "Dated source review";
      let message = "The device UTC date is within this saved review window. This does not verify current facts. Re-read official sources before sharing current news.";
      if (expired.has(notice)) {
        state = "expired";
        heading = "Source recheck required";
        message = "Saved media remains available. Re-read official sources before producing or sharing current news. This notice does not renew the saved source review.";
        notice.dataset.newsExpired = "true";
      } else if (!validDates || today === null || today < asOf) {
        state = "uncertain";
        heading = "Check source-review dates";
        message = "The saved review dates or device clock could not establish the review window. Recheck the dates and official sources before producing or sharing current news.";
      }
      notice.dataset.newsReviewState = state;
      const title = notice.querySelector("[data-news-review-heading]");
      const text = notice.querySelector("[data-news-review-message]");
      if (title && title.textContent !== heading) title.textContent = heading;
      if (text && text.textContent !== message) text.textContent = message;
    }
  }
  update();
  window.addEventListener("pageshow", update);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") update();
  });
  window.setInterval(() => {
    if (document.visibilityState !== "hidden") update();
  }, 60000);
})();`;

/** A static dated notice remains useful when scripts or the device clock are unavailable. */
export function newsReviewNotice(news: NewsReviewDate, expiredAtBuild = false): string {
  const through = validThrough(news);
  const state = expiredAtBuild ? "expired" : through ? "dated" : "uncertain";
  const heading = expiredAtBuild
    ? "Source recheck required"
    : through
      ? "Dated source review"
      : "Check source-review dates";
  return `<section class="source-review-notice" data-news-review-notice data-news-as-of="${escapeHtml(news.asOf)}" data-news-valid-through="${through ?? ""}" data-news-expired="${expiredAtBuild}" data-news-review-state="${state}" aria-label="News source review"><div role="status" aria-live="polite" aria-atomic="true"><h2 data-news-review-heading>${heading}</h2><p data-news-review-message>${expiredAtBuild ? "Saved media remains available. Re-read official sources before producing or sharing current news." : through ? "Compare the saved UTC dates with today, and re-read official sources before producing or sharing current news." : "The saved review dates could not establish the review window. Recheck the dates and official sources before producing or sharing current news."}</p></div><p>Sources reviewed <strong>${escapeHtml(news.asOf)}</strong> · review valid through <strong>${through ?? "unknown"}</strong> (UTC dates, inclusive).</p><p><small>Date checks use this device's clock; they do not fetch sources or renew factual verification. Saved media and review dates remain unchanged.</small></p><noscript><p>Automatic date checks require JavaScript. Compare the UTC dates yourself; recheck sources after the valid-through date.</p></noscript></section>`;
}

function permitScript(html: string): string {
  const source = `'sha256-${createHash("sha256").update(browserScript).digest("base64")}'`;
  return html.replace(/<meta\b[^>]*>/giu, (tag) => {
    if (!/\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1/iu.test(tag)) return tag;
    return tag.replace(/(\bcontent\s*=\s*)(["'])(.*?)\2/iu, (_match, prefix, quote, content) => {
      const directives = (content as string).split(";");
      const addSource = (name: string, fallback?: string[]) => {
        const index = directives.findIndex((item) => item.trim().split(/\s+/u)[0] === name);
        const current =
          index < 0
            ? (fallback ?? [])
            : (directives[index] as string).trim().split(/\s+/u).slice(1);
        // Adding a hash to unsafe-inline would disable existing un-hashed inline scripts.
        if (
          current.includes("'unsafe-inline'") &&
          !current.some((item) => /^'(?:sha\d+-|nonce-)/u.test(item))
        )
          return;
        if (current.includes(source)) return;
        const updated = `${name} ${[...current.filter((item) => item !== "'none'"), source].join(" ")}`;
        if (index < 0) directives.push(` ${updated}`);
        else directives[index] = `${/^\s/u.test(directives[index] as string) ? " " : ""}${updated}`;
      };
      const defaultSources = directives
        .find((item) => item.trim().startsWith("default-src "))
        ?.trim()
        .split(/\s+/u)
        .slice(1);
      addSource("script-src", defaultSources);
      if (directives.some((item) => item.trim().split(/\s+/u)[0] === "script-src-elem"))
        addSource("script-src-elem");
      return `${prefix}${quote}${directives.join(";")}${quote}`;
    });
  });
}

/** Enhance only pages containing notices; unrelated tutorial HTML is returned byte-for-byte. */
export function enhanceNewsReviewHtml(html: string): string {
  if (!noticePattern.test(html)) return html;
  let result = html;
  if (!result.includes(`id="${styleId}"`)) {
    const style = `<style id="${styleId}">${css}</style>`;
    result = /<\/head\s*>/iu.test(result)
      ? result.replace(/<\/head\s*>/iu, (closing) => `${style}${closing}`)
      : `${style}${result}`;
  }
  if (!result.includes(`id="${scriptId}"`)) {
    const script = `<script id="${scriptId}">${browserScript}</script>`;
    result = /<\/body\s*>/iu.test(result)
      ? result.replace(/<\/body\s*>/iu, (closing) => `${script}${closing}`)
      : `${result}${script}`;
  }
  return permitScript(result);
}

/** Decorate a copied review document without modifying its saved media or original file. */
export function decorateNewsReviewHtml(
  html: string,
  news: NewsReviewDate,
  expiredAtBuild = false,
): string {
  if (noticePattern.test(html)) {
    if (!expiredAtBuild) return enhanceNewsReviewHtml(html);
    const asOf = escapeHtml(news.asOf);
    const through = validThrough(news) ?? "";
    const promoted = html.replace(
      /<section\b[^>]*\sdata-news-review-notice(?:\s|=|>)[\s\S]*?<\/section>/giu,
      (section) => {
        const opening = section.slice(0, section.indexOf(">") + 1);
        if (
          /\bdata-news-as-of="([^"]*)"/u.exec(opening)?.[1] !== asOf ||
          /\bdata-news-valid-through="([^"]*)"/u.exec(opening)?.[1] !== through ||
          /\bdata-news-expired="true"/u.test(opening)
        )
          return section;
        return newsReviewNotice(news, true);
      },
    );
    return enhanceNewsReviewHtml(promoted);
  }
  const notice = newsReviewNotice(news, expiredAtBuild);
  const container = /<main\b[^>]*>/iu.test(html) ? /<main\b[^>]*>/iu : /<body\b[^>]*>/iu;
  return enhanceNewsReviewHtml(
    container.test(html)
      ? html.replace(container, (opening) => `${opening}${notice}`)
      : `${notice}${html}`,
  );
}
