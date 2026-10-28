// Pure grouping rules for the "My shorts" workspace. templates/library-stories.js mirrors
// stageRank, pickRepresentative, versionLabels and workAction for live updates in the browser;
// tests/library-stories.test.ts runs both implementations against the same fixtures.

export const workStages = ["editing", "producing", "review", "publish", "published"] as const;
export type WorkStage = (typeof workStages)[number];

/**
 * Representative version of a story: the most advanced actionable state wins, in this order
 * Producing (active job) > To review > To publish > Editing > Published.
 * Ties go to the most recently updated version, then to the later one in creation order.
 */
export const representativeOrder: readonly WorkStage[] = [
  "producing",
  "review",
  "publish",
  "editing",
  "published",
];

export interface StoryVersion {
  id: string;
  selector: string;
  stage: WorkStage;
  updatedAt: string;
  attention: boolean;
}

export interface Story<T extends StoryVersion> {
  id: string;
  /** Newest first. */
  versions: T[];
  latest: T;
  representative: T;
  /** Friendly labels (v1 = oldest) by selector. */
  labels: Map<string, string>;
  stages: WorkStage[];
  attention: boolean;
}

export const stageRank = (stage: WorkStage): number => representativeOrder.indexOf(stage);

const stamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const naturalSelector = (a: string, b: string) => {
  const [baseA = "", variantA] = a.split("@");
  const [baseB = "", variantB] = b.split("@");
  return (
    baseA.localeCompare(baseB, "en", { numeric: true }) ||
    Number(variantA !== undefined) - Number(variantB !== undefined) ||
    (variantA ?? "").localeCompare(variantB ?? "", "en", { numeric: true })
  );
};

/** Oldest first by update time; ties keep the unvarianted original first, then selector order. */
export function chronologicalVersions<T extends Pick<StoryVersion, "selector" | "updatedAt">>(
  versions: readonly T[],
): T[] {
  return [...versions].sort(
    (a, b) => stamp(a.updatedAt) - stamp(b.updatedAt) || naturalSelector(a.selector, b.selector),
  );
}

export function versionLabels<T extends Pick<StoryVersion, "selector" | "updatedAt">>(
  versions: readonly T[],
): Map<string, string> {
  return new Map(
    chronologicalVersions(versions).map((version, index) => [version.selector, `v${index + 1}`]),
  );
}

/**
 * Versions that still count for the story's stage: a video awaiting review is superseded
 * (and dropped) once a newer version has been approved or published.
 */
export function activeVersions<T extends StoryVersion>(versions: readonly T[]): T[] {
  const settled = Math.max(
    Number.NEGATIVE_INFINITY,
    ...versions
      .filter((version) => version.stage === "publish" || version.stage === "published")
      .map((version) => stamp(version.updatedAt)),
  );
  return versions.filter(
    (version) => version.stage !== "review" || stamp(version.updatedAt) >= settled,
  );
}

export function pickRepresentative<T extends StoryVersion>(versions: readonly T[]): T {
  const ordered = chronologicalVersions(activeVersions(versions));
  const [first] = ordered;
  if (!first) throw new Error("A story needs at least one version");
  return ordered.reduce((best, version) => {
    const rank = stageRank(version.stage) - stageRank(best.stage);
    if (rank !== 0) return rank < 0 ? version : best;
    return stamp(version.updatedAt) >= stamp(best.updatedAt) ? version : best;
  }, first);
}

/** Groups versions by episode id. Stories keep the order in which their id first appears. */
export function groupStories<T extends StoryVersion>(versions: readonly T[]): Story<T>[] {
  const byId = new Map<string, T[]>();
  for (const version of versions) byId.set(version.id, [...(byId.get(version.id) ?? []), version]);
  return [...byId.entries()].map(([id, members]) => {
    const newestFirst = chronologicalVersions(members).reverse();
    const latest = newestFirst[0] as T;
    return {
      id,
      versions: newestFirst,
      latest,
      representative: pickRepresentative(members),
      labels: versionLabels(members),
      stages: workStages.filter((stage) =>
        activeVersions(members).some((member) => member.stage === stage),
      ),
      attention: members.some((member) => member.attention),
    };
  });
}

/** Stories with at least one version in each stage; "all" counts stories. */
export function stageCounts<T extends StoryVersion>(
  stories: readonly Story<T>[],
): Record<WorkStage | "all", number> {
  const counts = { all: stories.length } as Record<WorkStage | "all", number>;
  for (const stage of workStages)
    counts[stage] = stories.filter((story) => story.stages.includes(stage)).length;
  return counts;
}

export interface WorkAction {
  label: string;
  /** Compact label for rows inside the versions drawer. */
  shortLabel: string;
  href: string;
}

export function workAction(
  stage: WorkStage,
  selector: string,
  options: { blocked?: boolean } = {},
): WorkAction {
  const prefix = `episodes/${encodeURIComponent(selector)}`;
  if (stage === "producing")
    return { label: "View progress", shortLabel: "Progress", href: "#studio-produce-banner" };
  if (stage === "review")
    return { label: "Review video", shortLabel: "Review", href: `${prefix}/publish.html` };
  if (stage === "publish")
    return { label: "Finish publishing", shortLabel: "Finish", href: `${prefix}/publish.html` };
  if (stage === "published")
    return { label: "View publication", shortLabel: "View", href: `${prefix}/publish.html` };
  return options.blocked
    ? { label: "Fix saved version", shortLabel: "Fix", href: `${prefix}/edit.html` }
    : { label: "Continue editing", shortLabel: "Edit", href: `${prefix}/edit.html` };
}
