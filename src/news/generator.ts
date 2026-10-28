import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NewsEpisode } from "../domain.js";
import { projectRoot } from "../paths.js";
import { validateNewsEpisode } from "./contracts.js";
import { cleanHtml, fetchStoryDetail, type SapStoryDetail } from "./fetcher.js";

const COMMON_PRONUNCIATIONS: Record<string, string> = {
  AI: "ay eye",
  LLM: "L L M",
  LLMs: "L L Ms",
  ERP: "E R P",
  BTP: "B T P",
  CAP: "cap",
  SAP: "sap",
  Joule: "jool",
  HANA: "hah-nuh",
  "S/4HANA": "S four hah-nuh",
  SCM: "S C M",
  CRM: "C R M",
  API: "A P I",
  APIs: "A P Is",
  SDK: "S D K",
};

/** Display titles may be abbreviated; evidence and source titles remain complete. */
function displayTitle(value: string): string {
  if (value.length <= 60) return value;
  return `${value
    .slice(0, 59)
    .replace(/\s+\S*$/u, "")
    .replace(/[,;:]$/u, "")}…`;
}

/** Keep complete source sentences. Never turn an arbitrary word cut into a claim. */
function sourceSentences(story: SapStoryDetail): string[] {
  return [
    ...new Set(
      [...story.keyQuotes, ...story.paragraphs]
        .flatMap((value) => cleanHtml(value).split(/(?<=[.!?])\s+/u))
        .filter(
          (sentence) =>
            sentence.length >= 40 && sentence.length <= 180 && /[.!?][”"']?$/u.test(sentence),
        ),
    ),
  ];
}

/** Finds the next available NEWS-XX episode ID in content/episodes and content/drafts */
export async function getNextNewsId(): Promise<string> {
  const readNumbers = async (dirPath: string): Promise<number[]> => {
    try {
      const files = await readdir(dirPath);
      return files
        .map((f) => f.match(/^NEWS-(\d{2})\.json$/u)?.[1])
        .filter((n): n is string => Boolean(n))
        .map((n) => Number.parseInt(n, 10));
    } catch {
      return [];
    }
  };

  const episodeNumbers = await readNumbers(resolve(projectRoot, "content/episodes"));
  const draftNumbers = await readNumbers(resolve(projectRoot, "content/drafts"));
  const allNumbers = [...episodeNumbers, ...draftNumbers];

  const maxNum = allNumbers.length > 0 ? Math.max(...allNumbers) : 2;
  const nextNum = maxNum + 1;
  return `NEWS-${String(nextNum).padStart(2, "0")}`;
}

/** Formulates a valid 7-scene NewsEpisode from a fetched SAP story */
export function buildNewsEpisodeFromStory(story: SapStoryDetail, episodeId: string): NewsEpisode {
  const today = new Date().toISOString().slice(0, 10);
  const fullTitle = cleanHtml(story.title);
  const cleanTitle = displayTitle(fullTitle);
  const hookText = "What's changed, and what's actually available?";
  const hookOverlay = "Beyond the headline";
  const sentences = sourceSentences(story).slice(0, 3);
  if (sentences.length < 3)
    throw new Error(
      "Source needs editorial review: provide three complete source sentences of 40–180 characters. No claims were truncated or invented.",
    );
  const [cleanQ1, cleanQ2, cleanQ3] = sentences as [string, string, string];
  const contextNarration =
    "Here are three details from SAP’s announcement. Product scope and access matter as much as the headline.";
  const headline1Narration = cleanQ1;
  const headline2Narration = cleanQ2;
  const headline3Narration = cleanQ3;
  const payoffNarration =
    "Before planning an implementation, check which product each detail describes, its availability, and your own requirements.";
  const ctaNarration = "Read the full announcement below. Which detail matters most for your team?";
  const ids = ["announcement-core", "technical-impact", "rollout-availability"];
  const claims = sentences.map((sentence, index) => ({
    id: ids[index] as string,
    text: sentence,
    sourceIds: ["sap-official"],
    checkedOn: today,
    // Imported snippets need an editor to assign product-specific access, dates
    // and geography; do not infer global availability from unrelated sentences.
    availability: {
      status: "announced" as const,
      timing: story.publishedIso
        ? `Source published ${story.publishedIso}`
        : "Publication date not supplied",
      scope: "Confirm product-specific access and eligibility in the full source.",
    },
    support: [
      {
        sourceId: "sap-official",
        locator: `Source sentence: ${sentence}`,
        summary: "Complete source excerpt; availability scope needs editorial review.",
      },
    ],
  }));

  // 7 Scenes adhering strictly to: hook,context,headline,headline,headline,payoff,cta
  const scenes: NewsEpisode["scenes"] = [
    {
      id: "hook",
      phase: "hook",
      startSeconds: 0,
      endSeconds: 3,
      narration: hookText,
      overlay: hookOverlay,
      claimIds: [],
      visual: {
        kind: "presenter",
        label: "Opening hook",
      },
    },
    {
      id: "context",
      phase: "context",
      startSeconds: 3,
      endSeconds: 10,
      narration: contextNarration,
      overlay: "What the source says",
      claimIds: [],
      visual: {
        kind: "presenter",
        label: `Source reviewed ${today}`,
      },
    },
    {
      id: "headline-1",
      phase: "headline",
      startSeconds: 10,
      endSeconds: 21,
      narration: headline1Narration,
      overlay: "1. Core announcement",
      claimIds: ["announcement-core"],
      visual: {
        kind: "news-card",
        label: "Official announcement",
      },
    },
    {
      id: "headline-2",
      phase: "headline",
      startSeconds: 21,
      endSeconds: 31,
      narration: headline2Narration,
      overlay: "2. From the source",
      claimIds: ["technical-impact"],
      visual: {
        kind: "news-card",
        label: "Source detail",
      },
    },
    {
      id: "headline-3",
      phase: "headline",
      startSeconds: 31,
      endSeconds: 43,
      narration: headline3Narration,
      overlay: "3. Check the details",
      claimIds: ["rollout-availability"],
      visual: {
        kind: "news-card",
        label: "Source detail & scope",
      },
    },
    {
      id: "payoff",
      phase: "payoff",
      startSeconds: 43,
      endSeconds: 49,
      narration: payoffNarration,
      overlay: "Editorial takeaway",
      claimIds: [],
      visual: {
        kind: "presenter",
        label: "Editorial takeaway",
      },
    },
    {
      id: "cta",
      phase: "cta",
      startSeconds: 49,
      endSeconds: 55,
      narration: ctaNarration,
      overlay: "Read source. Share thoughts.",
      claimIds: [],
      visual: {
        kind: "presenter",
        label: "Discussion & CTA",
      },
    },
  ];

  // Companion LinkedIn Post
  const publicationText = `${fullTitle}\n\nThree details from SAP’s announcement:\n1. ${cleanQ1}\n2. ${cleanQ2}\n3. ${cleanQ3}\n\nThese are source excerpts, not a statement of availability for every product. Check the full source for access, geography, and roadmap dates.\n\nOfficial source${story.publishedIso ? ` (published ${story.publishedIso})` : ""}: ${story.link}\n\nWhich detail matters most for your team?\n\n#SAP #EnterpriseArchitecture`;

  // Filter pronunciation entries relevant to this text
  const fullContent = `${cleanTitle} ${scenes.map((s) => s.narration).join(" ")}`;
  const pronunciation: Record<string, string> = {};
  for (const [term, phonetic] of Object.entries(COMMON_PRONUNCIATIONS)) {
    if (new RegExp(`\\b${term}\\b`, "i").test(fullContent)) {
      pronunciation[term] = phonetic;
    }
  }
  // Ensure basic entries
  pronunciation.SAP = "sap";
  pronunciation.AI = "ay eye";

  const episode: NewsEpisode = {
    schemaVersion: 1,
    format: "news",
    id: episodeId,
    version: 1,
    title: cleanTitle,
    audience: "SAP developers, architects, and business technology teams",
    language: "en",
    targetDurationSeconds: 55,
    news: {
      event: "SAP News",
      asOf: today,
      maxAgeDays: 7,
      editorialStatus: "draft",
      selection: "editorial",
      angle: cleanHtml(story.angleSuggestion),
    },
    sources: [
      {
        id: "sap-official",
        title: fullTitle,
        url: story.link,
        retrievedOn: today,
        publisher: "SAP",
        publishedOn: story.publishedIso || null,
      },
    ],
    claims,
    scenes,
    pronunciation,
    publication: {
      channel: "linkedin",
      text: publicationText,
    },
  };

  return validateNewsEpisode(episode);
}

export interface CreateNewsEpisodeOptions {
  targetId?: string;
  promote?: boolean;
}

/** Fetches a story from URL, builds a valid episode, and saves it to content/drafts (or content/episodes if promote is true) */
export async function createNewsEpisodeFromUrl(
  url: string,
  options: CreateNewsEpisodeOptions = {},
): Promise<{ episode: NewsEpisode; path: string }> {
  const story = await fetchStoryDetail(url);
  const id = options.targetId ?? (await getNextNewsId());
  const episode = buildNewsEpisodeFromStory(story, id);

  const destinationDir = options.promote
    ? resolve(projectRoot, "content/episodes")
    : resolve(projectRoot, "content/drafts");

  await mkdir(destinationDir, { recursive: true });
  const filePath = resolve(destinationDir, `${id}.json`);
  await writeFile(filePath, `${JSON.stringify(episode, null, 2)}\n`, "utf8");

  if (options.promote) {
    await updateNewsBacklog(episode, story.link);
  }

  return { episode, path: filePath };
}

/** Updates content/news/backlog.json when an episode is promoted to active episodes */
async function updateNewsBacklog(episode: NewsEpisode, sourceUrl: string): Promise<void> {
  const backlogPath = resolve(projectRoot, "content/news/backlog.json");
  try {
    const backlog = JSON.parse(await readFile(backlogPath, "utf8")) as {
      id: string;
      title: string;
      event: string;
      angle: string;
      priority: number;
      status: string;
      sourceUrls: string[];
    }[];
    const maxPriority = backlog.length > 0 ? Math.max(...backlog.map((b) => b.priority || 0)) : 0;
    const existing = backlog.find((item) => item.id === episode.id);
    if (existing) {
      existing.title = episode.title;
      existing.event = episode.news.event;
      existing.angle = episode.news.angle;
      existing.status = "draft-ready";
      existing.sourceUrls = [sourceUrl];
    } else {
      backlog.push({
        id: episode.id,
        title: episode.title,
        event: episode.news.event,
        angle: episode.news.angle,
        priority: maxPriority + 1,
        status: "draft-ready",
        sourceUrls: [sourceUrl],
      });
    }
    await writeFile(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`, "utf8");
  } catch {
    /* preserve existing backlog if malformed */
  }
}

/** Promotes an existing draft from content/drafts into content/episodes and marks it draft-ready */
export async function promoteNewsDraft(
  draftIdOrPath: string,
): Promise<{ episode: NewsEpisode; path: string }> {
  const idMatch = draftIdOrPath.match(/(NEWS-\d{2})/u);
  if (!idMatch?.[1]) throw new Error(`Could not determine episode ID from: ${draftIdOrPath}`);
  const id = idMatch[1];

  let raw: string;
  if (draftIdOrPath.endsWith(".json")) {
    raw = await readFile(resolve(projectRoot, draftIdOrPath), "utf8");
  } else {
    raw = await readFile(resolve(projectRoot, "content/drafts", `${id}.json`), "utf8");
  }

  const episode = validateNewsEpisode(JSON.parse(raw));
  const episodePath = resolve(projectRoot, "content/episodes", `${id}.json`);
  await writeFile(episodePath, `${JSON.stringify(episode, null, 2)}\n`, "utf8");

  const sourceUrl = episode.sources[0]?.url ?? "https://news.sap.com/";
  await updateNewsBacklog(episode, sourceUrl);

  return { episode, path: episodePath };
}
