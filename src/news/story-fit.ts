import { escapeHtml as esc } from "../review.js";

/** Presentation helpers for official SAP news story cards. */

export interface StoryFit {
  steps: number;
  label: "High" | "Good" | "Low";
}

export interface ExistingShort {
  id: string;
  versions: number;
  href: string;
  kind: "short" | "draft";
}

export interface ShortSummary extends ExistingShort {
  title: string;
  sourceUrls: string[];
}

export interface IndexedShort extends ExistingShort {
  title: string;
  truncated: boolean;
  url?: string;
}

export interface ExistingShortIndex {
  shorts: IndexedShort[];
}

// Scores of official stories typically range from about 30 to 190.
const fitSteps: [number, number][] = [
  [160, 5],
  [125, 4],
  [90, 3],
  [50, 2],
];

export function storyFit(score: number): StoryFit {
  const steps = fitSteps.find(([minimum]) => score >= minimum)?.[1] ?? 1;
  return { steps, label: steps >= 5 ? "High" : steps >= 3 ? "Good" : "Low" };
}

export function normalizeStoryUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./u, "").toLowerCase()}${parsed.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function normalizeStoryTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Saved titles are cut at 60 characters, so only titles about that long (or ending in an
// ellipsis) may match as a leading part of a longer story title.
const truncatedTitleLength = 58;

/** Earlier summaries win. A story is only matched by URL when it is the short's single source. */
export function indexExistingShorts(shorts: ShortSummary[]): ExistingShortIndex {
  return {
    shorts: shorts.map(({ title, sourceUrls, ...existing }) => {
      const [onlySource] = sourceUrls;
      const normalized = normalizeStoryTitle(title);
      return {
        ...existing,
        title: normalized,
        truncated:
          /[…]\s*$|\.\.\.\s*$/u.test(title.trim()) || normalized.length >= truncatedTitleLength,
        ...(sourceUrls.length === 1 && onlySource ? { url: normalizeStoryUrl(onlySource) } : {}),
      };
    }),
  };
}

export function findExistingShort(
  index: ExistingShortIndex,
  story: { link: string; title: string },
): ExistingShort | undefined {
  const title = normalizeStoryTitle(story.title);
  const url = normalizeStoryUrl(story.link);
  const titleMatches = (item: IndexedShort) =>
    // A different single source is stronger evidence than any title similarity.
    (!item.url || item.url === url) &&
    (item.title === title ||
      (item.truncated && title.startsWith(`${item.title} `)) ||
      (item.truncated &&
        item.title.length >= truncatedTitleLength &&
        title.startsWith(item.title)));
  const lookup = (items: IndexedShort[]) =>
    items.find(titleMatches) ?? items.find((item) => item.url === url);
  const match =
    lookup(index.shorts.filter((item) => item.kind === "short")) ??
    lookup(index.shorts.filter((item) => item.kind === "draft"));
  if (!match) return undefined;
  const { title: _title, truncated: _truncated, url: _url, ...existing } = match;
  return existing;
}

export function existingShortLabel(existing: ExistingShort): string {
  return existing.kind === "draft"
    ? `Already a short · ${existing.id} · staged draft`
    : `Already a short · ${existing.id} · ${existing.versions} ${existing.versions === 1 ? "version" : "versions"}`;
}

const icon = (path: string) =>
  `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
const plusIcon = icon('<path d="M12 5v14M5 12h14"/>');
const filmIcon = icon(
  '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
);

export interface StoryCardData {
  link: string;
  title: string;
  publishedIso: string;
  categories: string[];
  relevanceScore: number;
  angleSuggestion: string;
}

export function storyFitMeter(score: number): string {
  const fit = storyFit(score);
  const text = `${fit.label} fit`;
  return `<span class="fit-meter" role="img" title="Fit score ${score}" aria-label="${text} for a short (score ${score})"><span class="fit-pips" aria-hidden="true">${[1, 2, 3, 4, 5].map((step) => `<i${step <= fit.steps ? ' class="on"' : ""}></i>`).join("")}</span><span class="fit-label" aria-hidden="true">${text}</span></span>`;
}

export function storyCardHtml(story: StoryCardData, existing?: ExistingShort): string {
  const tags = story.categories
    .slice(0, 3)
    .map((category) => `<span class="tag-chip">${esc(category)}</span>`)
    .join("");
  const badge = existing
    ? `<div class="story-existing">${filmIcon}<span>${esc(existingShortLabel(existing))}</span><a href="${esc(existing.href)}">Open</a></div>`
    : "";
  const action = existing
    ? `<button type="button" class="create-short-from-news-btn secondary-action" data-url="${esc(story.link)}">New angle</button>`
    : `<button type="button" class="create-short-from-news-btn primary-action" data-url="${esc(story.link)}">${plusIcon}Start short</button>`;
  return `<article class="news-story-card" data-updated="${esc(story.publishedIso)}" data-score="${story.relevanceScore}" data-url="${esc(story.link)}"><div class="story-meta">${storyFitMeter(story.relevanceScore)}<span class="story-date">${esc(story.publishedIso)}</span><div class="story-tags">${tags}</div></div><h4 class="story-title"><a href="${esc(story.link)}" target="_blank" rel="noreferrer">${esc(story.title)} ↗</a></h4><p class="story-angle"><strong>Suggested angle:</strong> ${esc(story.angleSuggestion)}</p>${badge}<div class="story-card-actions">${action}</div></article>`;
}
