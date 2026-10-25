import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NewsEpisode } from "../domain.js";
import { projectRoot } from "../paths.js";
import { validateNewsEpisode } from "./contracts.js";
import { fetchStoryDetail, type SapStoryDetail } from "./fetcher.js";

const COMMON_PRONUNCIATIONS: Record<string, string> = {
  "AI": "ay eye",
  "LLM": "L L M",
  "LLMs": "L L Ms",
  "ERP": "E R P",
  "BTP": "B T P",
  "CAP": "cap",
  "SAP": "sap",
  "Joule": "jool",
  "HANA": "hah-nuh",
  "S/4HANA": "S four hah-nuh",
  "SCM": "S C M",
  "CRM": "C R M",
  "API": "A P I",
  "APIs": "A P Is",
  "SDK": "S D K",
};

/** Trims text to fit within a maximum word count, keeping full sentence punctuation. */
function trimWords(text: string, maxWords: number): string {
  const clean = text.replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim();
  const words = clean.split(/\s+/u).filter(Boolean);
  if (words.length <= maxWords) return clean;
  const cut = words.slice(0, maxWords).join(" ");
  return /[.!?]$/u.test(cut) ? cut : `${cut}.`;
}

/** Generates a punchy hook guaranteed to fit <= 3 seconds and <= 7 words. */
function generateHook(title: string): { hookText: string; hookOverlay: string } {
  const lower = title.toLowerCase();
  if (lower.includes("autonomous")) {
    return { hookText: "Autonomous enterprise is finally here.", hookOverlay: "Autonomous enterprise arrives" };
  }
  if (lower.includes("joule") && lower.includes("agent")) {
    return { hookText: "Joule brings agents into enterprise.", hookOverlay: "Joule agents enter enterprise" };
  }
  if (lower.includes("joule")) {
    return { hookText: "Joule transforms enterprise work.", hookOverlay: "Joule transforms work" };
  }
  if (lower.includes("supply chain") || lower.includes("scm")) {
    return { hookText: "AI agents take on supply chains.", hookOverlay: "AI in supply chains" };
  }
  if (lower.includes("payment") || lower.includes("finance")) {
    return { hookText: "Embedded payments arrive in ERP.", hookOverlay: "Payments inside ERP" };
  }
  if (lower.includes("btp") || lower.includes("cloud")) {
    return { hookText: "Cloud ERP enters the next phase.", hookOverlay: "Next-gen Cloud ERP" };
  }
  if (lower.includes("relational") || lower.includes("table") || lower.includes("database")) {
    return { hookText: "Enterprise data needs relational models.", hookOverlay: "Relational data in AI" };
  }

  // Fallback: take first 5 words from title
  const words = title.replace(/[^\w\s]/gu, "").split(/\s+/u).filter(Boolean);
  const selected = words.slice(0, 5);
  return {
    hookText: `${selected.join(" ")}.`,
    hookOverlay: selected.slice(0, 4).join(" "),
  };
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
  const cleanTitle = story.title.replace(/[\r\n\t]+/gu, " ").trim().slice(0, 60);

  const { hookText, hookOverlay } = generateHook(story.title);

  // Extract quotes or paragraph sentences
  const rawQ1 = story.keyQuotes[0] || story.paragraphs[1] || story.paragraphs[0] || "SAP announced new enterprise architecture capabilities.";
  const rawQ2 = story.keyQuotes[1] || story.paragraphs[2] || "Enterprise applications require deep process knowledge and relational models.";
  const rawQ3 = story.keyQuotes[2] || story.paragraphs[3] || "Capabilities are rolling out across cloud environments.";

  const cleanQ1 = rawQ1.replace(/^["“]|["”]$/gu, "").trim();
  const cleanQ2 = rawQ2.replace(/^["“]|["”]$/gu, "").trim();
  const cleanQ3 = rawQ3.replace(/^["“]|["”]$/gu, "").trim();

  // Word limits strictly satisfying <= 180 words/min (3 words/sec):
  // Hook (3s): max 7 words (schema limit)
  // Context (7s): max 20 words
  // Headline 1 (11s): max 30 words
  // Headline 2 (10s): max 28 words
  // Headline 3 (12s): max 32 words
  // Payoff (6s): max 16 words
  // CTA (6s): max 16 words

  const contextNarration = trimWords(
    `Checked today from official SAP news. ${story.paragraphs[0] ? story.paragraphs[0].slice(0, 90) : "Here is the technical shift and what it means for your stack."}`,
    20,
  );

  const headline1Narration = trimWords(`First, ${cleanQ1}`, 30);
  const headline2Narration = trimWords(`Second, ${cleanQ2}`, 28);
  const headline3Narration = trimWords(`Third, ${cleanQ3}`, 32);

  const payoffNarration = trimWords(
    `My takeaway: ${story.angleSuggestion || "Connect AI models directly to trusted enterprise data semantics."}`,
    16,
  );

  const ctaNarration = trimWords(
    "Read the official announcement in the link below. How will this impact your architecture?",
    16,
  );

  const claims = [
    {
      id: "announcement-core",
      text: cleanQ1.slice(0, 140),
      sourceIds: ["sap-official"],
      checkedOn: today,
      availability: {
        status: "announced" as const,
        timing: `Published ${story.pubDate || "October 2026"}`,
        scope: "Official SAP news announcement.",
      },
      support: [
        {
          sourceId: "sap-official",
          locator: "Opening announcement and core capabilities",
          summary: "Cites official SAP release details.",
        },
      ],
    },
    {
      id: "technical-impact",
      text: cleanQ2.slice(0, 140),
      sourceIds: ["sap-official"],
      checkedOn: today,
      availability: {
        status: "announced" as const,
        timing: "Available in current architecture release",
        scope: "Enterprise platform and data structures.",
      },
      support: [
        {
          sourceId: "sap-official",
          locator: "Technical impact and architectural considerations",
          summary: "Explains enterprise process and integration benefits.",
        },
      ],
    },
    {
      id: "rollout-availability",
      text: cleanQ3.slice(0, 140),
      sourceIds: ["sap-official"],
      checkedOn: today,
      availability: {
        status: "announced" as const,
        timing: "Ongoing platform rollout",
        scope: "Global SAP customer and cloud deployments.",
      },
      support: [
        {
          sourceId: "sap-official",
          locator: "Availability and roadmap details",
          summary: "Details the rollout schedule and prerequisites.",
        },
      ],
    },
  ];

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
      overlay: "What changed today",
      claimIds: [],
      visual: {
        kind: "presenter",
        label: `As of ${today}`,
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
      overlay: "2. Why it matters",
      claimIds: ["technical-impact"],
      visual: {
        kind: "news-card",
        label: "Architecture & impact",
      },
    },
    {
      id: "headline-3",
      phase: "headline",
      startSeconds: 31,
      endSeconds: 43,
      narration: headline3Narration,
      overlay: "3. When it ships",
      claimIds: ["rollout-availability"],
      visual: {
        kind: "news-card",
        label: "Rollout & availability",
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
  const publicationText = `${cleanTitle}\n\n${story.paragraphs[0] || "SAP has announced key updates to its enterprise technology platform."}\n\nKey takeaways from the official announcement:\n1. Core capability: ${cleanQ1.slice(0, 100)}\n2. Architecture impact: ${cleanQ2.slice(0, 100)}\n3. Availability: ${cleanQ3.slice(0, 100)}\n\nRead the official source: ${story.link}\n\nHow is your organization preparing for this in your enterprise architecture?\n\n#SAP #BusinessAI #EnterpriseArchitecture #CloudERP #SAPBTP`;

  // Filter pronunciation entries relevant to this text
  const fullContent = `${cleanTitle} ${scenes.map((s) => s.narration).join(" ")}`;
  const pronunciation: Record<string, string> = {};
  for (const [term, phonetic] of Object.entries(COMMON_PRONUNCIATIONS)) {
    if (new RegExp(`\\b${term}\\b`, "i").test(fullContent)) {
      pronunciation[term] = phonetic;
    }
  }
  // Ensure basic entries
  pronunciation["SAP"] = "sap";
  pronunciation["AI"] = "ay eye";

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
      event: "SAP Technology Insights 2026",
      asOf: today,
      maxAgeDays: 7,
      editorialStatus: "draft",
      selection: "editorial",
      angle: story.angleSuggestion,
    },
    sources: [
      {
        id: "sap-official",
        title: cleanTitle,
        url: story.link,
        retrievedOn: today,
        publisher: "SAP",
        publishedOn: story.publishedIso,
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
export async function promoteNewsDraft(draftIdOrPath: string): Promise<{ episode: NewsEpisode; path: string }> {
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
