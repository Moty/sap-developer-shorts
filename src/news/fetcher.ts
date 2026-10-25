/**
 * Live SAP News discovery and story scraper.
 * Fetches official stories from news.sap.com, filters for short-form video suitability,
 * and extracts full editorial content for episode generation.
 */

export interface SapNewsItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  publishedIso: string;
  categories: string[];
  relevanceScore: number;
  angleSuggestion: string;
}

export interface SapStoryDetail extends SapNewsItem {
  author?: string | undefined;
  paragraphs: string[];
  fullText: string;
  keyQuotes: string[];
}

const HIGH_VALUE_TOPICS: Record<string, number> = {
  "artificial intelligence": 15,
  "ai": 15,
  "business technology platform": 14,
  "btp": 14,
  "cloud": 10,
  "joule": 15,
  "agents": 12,
  "technology": 8,
  "solutions": 6,
  "developer": 10,
  "integration": 8,
};

function scoreItem(title: string, categories: string[]): { score: number; angle: string } {
  let score = 5;
  const lowerTitle = title.toLowerCase();

  for (const cat of categories) {
    const lowerCat = cat.toLowerCase();
    for (const [topic, points] of Object.entries(HIGH_VALUE_TOPICS)) {
      if (lowerCat.includes(topic)) score += points;
    }
  }

  if (lowerTitle.includes("ai") || lowerTitle.includes("joule") || lowerTitle.includes("agent")) {
    score += 15;
  }
  if (lowerTitle.includes("btp") || lowerTitle.includes("cloud") || lowerTitle.includes("platform")) {
    score += 10;
  }
  if (lowerTitle.includes("leader") || lowerTitle.includes("gartner") || lowerTitle.includes("quadrant")) {
    score -= 8; // Pure awards are less useful for tech shorts than architecture/capabilities
  }
  if (lowerTitle.includes("results") || lowerTitle.includes("earnings")) {
    score -= 10; // Earnings calls are corporate, not developer/architect shorts
  }

  // Suggest a compelling short-video angle based on content
  let angle = "Examine the technical capability, enterprise context, and real-world availability.";
  if (lowerTitle.includes("llm") || lowerTitle.includes("ai") || lowerTitle.includes("agent")) {
    angle = "Contrasts generative AI hype with tabular enterprise data requirements.";
  } else if (lowerTitle.includes("cloud") || lowerTitle.includes("btp")) {
    angle = "Explain the platform shift and separate current access from roadmaps.";
  } else if (lowerTitle.includes("roleplay") || lowerTitle.includes("certified") || lowerTitle.includes("learning")) {
    angle = "How developers and consultants should adapt their skills to AI-assisted workflows.";
  }

  return { score, angle };
}

function cleanHtml(input: string): string {
  return input
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&#8217;/gu, "'")
    .replace(/&#8216;/gu, "'")
    .replace(/&#8220;|&#8221;/gu, '"')
    .replace(/&#x2122;/gu, "™")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Fetches and parses the official SAP News RSS feed. */
export async function fetchTopSapStories(options: { limit?: number; minScore?: number } = {}): Promise<SapNewsItem[]> {
  const feedUrl = "https://news.sap.com/feed/";
  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "SAP-Shorts-Discovery/1.0 (+https://github.com/SAP)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch official SAP News feed: HTTP ${response.status}`);
  }

  const xml = await response.text();
  const items: SapNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gu;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1] ?? "";
    const rawTitle = content.match(/<title>([\s\S]*?)<\/title>/u)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/gu, "$1") ?? "";
    const title = cleanHtml(rawTitle);
    const link = content.match(/<link>([\s\S]*?)<\/link>/u)?.[1]?.trim() ?? "";
    const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/u)?.[1]?.trim() ?? "";
    const rawCats = [...content.matchAll(/<category>([\s\S]*?)<\/category>/gu)].map((m) =>
      cleanHtml(m[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/gu, "$1") ?? ""),
    );

    const { score, angle } = scoreItem(title, rawCats);
    const publishedIso = pubDate ? new Date(pubDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const slug = link.split("/").filter(Boolean).pop() ?? "sap-news";

    items.push({
      id: slug,
      title,
      link,
      pubDate,
      publishedIso,
      categories: rawCats,
      relevanceScore: score,
      angleSuggestion: angle,
    });
  }

  // Sort by relevance score descending
  items.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const filtered = typeof options.minScore === "number" ? items.filter((i) => i.relevanceScore >= options.minScore!) : items;
  return filtered.slice(0, options.limit ?? 10);
}

/** Fetches full article content from an official news.sap.com story. */
export async function fetchStoryDetail(url: string): Promise<SapStoryDetail> {
  const parsed = new URL(url);
  if (parsed.hostname !== "news.sap.com" && !parsed.hostname.endsWith(".sap.com")) {
    throw new Error(`Invalid source URL: must be an official SAP domain (${url})`);
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "SAP-Shorts-Discovery/1.0 (+https://github.com/SAP)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch article: HTTP ${response.status}`);
  }

  const html = await response.text();
  const rawTitle = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/u)?.[1] ?? "";
  const title = cleanHtml(rawTitle) || "SAP News Update";

  const authorMatch = html.match(/(?:by|Feature by|Article by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/u);
  const author = authorMatch?.[1];

  // Extract paragraphs
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gu)]
    .map((m) => cleanHtml(m[1] ?? ""))
    .filter((p) => p.length > 50 && !p.startsWith("©") && !p.includes("Cookie") && !p.includes("privacy policy"));

  const fullText = paragraphs.join("\n\n");

  // Extract key sentences with numbers, percentages, or strong verbs for claims
  const keyQuotes = paragraphs
    .flatMap((p) => p.split(/(?<=[.!?])\s+/u))
    .filter((s) => s.length > 40 && s.length < 200 && (/\d+|percent|study|requires|because|rollout|available/iu.test(s)))
    .slice(0, 6);

  const { score, angle } = scoreItem(title, []);
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: url.split("/").filter(Boolean).pop() ?? "sap-story",
    title,
    link: url,
    pubDate: today,
    publishedIso: today,
    categories: [],
    relevanceScore: score,
    angleSuggestion: angle,
    author,
    paragraphs,
    fullText,
    keyQuotes,
  };
}
