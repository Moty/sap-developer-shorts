import type { ContentEpisode } from "../domain.js";
import type { WritingSnapshot } from "./workflow.js";

export interface FinalReviewFix {
  field: "title" | "narration" | "overlay" | "publicationText" | "presentationHeadline";
  sceneId: string;
  turnIndex: number;
  before: string;
  after: string;
}
export interface FinalReview {
  summary: string;
  issues: {
    severity: "high" | "medium" | "low";
    area: "script" | "companion" | "slides" | "sources";
    sceneId: string;
    message: string;
    suggestion: string;
    fix: FinalReviewFix | null;
  }[];
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`Final review requires fields: ${keys.join(", ")}.`);
  return value as Record<string, unknown>;
}
function prose(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /\p{Cc}/u.test(value.replace(/[\r\n\t]/gu, ""))
  )
    throw new Error(`Final review text needs 1–${maximum} plain characters.`);
  return value.trim();
}
export function companionLinks(value: string) {
  return [
    ...new Set(
      (value.match(/https?:\/\/[^\s<>"')\]]+/gu) ?? []).map((url) => url.replace(/[.,;!?]+$/u, "")),
    ),
  ];
}
export function assertCompanionLinks(before: string, after: string, sourceUrls: string[]) {
  const original = companionLinks(before);
  const proposed = companionLinks(after);
  const allowed = new Set([...original, ...sourceUrls]);
  if (original.some((url) => !proposed.includes(url)) || proposed.some((url) => !allowed.has(url)))
    throw new Error("Companion copy must retain existing links and use only saved source URLs.");
}
export function fixValue(
  snapshot: WritingSnapshot,
  fix: Pick<FinalReviewFix, "field" | "sceneId" | "turnIndex">,
): string {
  if (fix.field === "title" || fix.field === "publicationText") {
    if (fix.sceneId !== "overall" || fix.turnIndex !== 0)
      throw new Error("Use overall for title/post edits.");
    return fix.field === "title" ? snapshot.title : (snapshot.publicationText ?? "");
  }
  const scene = snapshot.scenes.find((scene) => scene.id === fix.sceneId);
  if (!scene) throw new Error("Final review fixes must refer to an existing scene.");
  if (fix.field === "narration") {
    if (
      !Number.isInteger(fix.turnIndex) ||
      fix.turnIndex < 0 ||
      scene.texts[fix.turnIndex] === undefined
    )
      throw new Error("Keep the existing speaker-turn slots.");
    return scene.texts[fix.turnIndex] as string;
  }
  if (fix.turnIndex !== 0) throw new Error("Only narration edits use a speaker-turn index.");
  if (fix.field === "overlay") return scene.overlay;
  const headline = snapshot.design?.scenes.find((item) => item.id === fix.sceneId)?.headline;
  if (headline === undefined)
    throw new Error("Use an overlay edit for an automatic presentation headline.");
  return headline;
}
export function parseFinalReview(
  value: unknown,
  snapshot: WritingSnapshot,
  episode: ContentEpisode,
): FinalReview {
  const result = record(value, ["summary", "issues"]);
  if (!Array.isArray(result.issues) || result.issues.length > 12)
    throw new Error("Return at most twelve final-review issues.");
  const targets = new Set<string>();
  const issues = result.issues.map((value) => {
    const issue = record(value, ["severity", "area", "sceneId", "message", "suggestion", "fix"]);
    if (
      !["high", "medium", "low"].includes(String(issue.severity)) ||
      !["script", "companion", "slides", "sources"].includes(String(issue.area)) ||
      !["overall", ...episode.scenes.map((scene) => scene.id)].includes(String(issue.sceneId))
    )
      throw new Error("Use a supported final-review severity, area, and scene.");
    let fix: FinalReviewFix | null = null;
    if (issue.fix !== null) {
      const candidate = record(issue.fix, ["field", "sceneId", "turnIndex", "before", "after"]);
      if (
        !["title", "narration", "overlay", "publicationText", "presentationHeadline"].includes(
          String(candidate.field),
        ) ||
        typeof candidate.sceneId !== "string" ||
        !Number.isInteger(candidate.turnIndex)
      )
        throw new Error("Final review can propose only bounded wording/post/headline edits.");
      if (issue.area === "sources")
        throw new Error("Source issues require human review; use fix:null.");
      const permitted =
        issue.area === "script"
          ? ["title", "narration"]
          : issue.area === "companion"
            ? ["publicationText"]
            : ["overlay", "presentationHeadline"];
      if (!permitted.includes(String(candidate.field)))
        throw new Error("Keep each fix within its review area.");
      const maximum =
        candidate.field === "publicationText"
          ? 3000
          : candidate.field === "narration"
            ? 1200
            : candidate.field === "title"
              ? 60
              : 48;
      fix = {
        field: candidate.field as FinalReviewFix["field"],
        sceneId: candidate.sceneId,
        turnIndex: candidate.turnIndex as number,
        before: prose(candidate.before, 4000),
        after: prose(candidate.after, maximum),
      };
      if (fixValue(snapshot, fix) !== fix.before || fix.before === fix.after)
        throw new Error(
          "A proposed edit must match the complete current field exactly and change it.",
        );
      if (["overlay", "presentationHeadline"].includes(fix.field) && /[<>\p{Cc}]/u.test(fix.after))
        throw new Error("Visual headlines must be short plain text.");
      if (
        fix.field === "narration" &&
        /https?:\/\/|\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/iu.test(fix.after)
      )
        throw new Error("Keep URLs and private identifiers out of narration.");
      if (fix.field === "publicationText") {
        assertCompanionLinks(
          fix.before,
          fix.after,
          episode.sources.map((source) => source.url),
        );
      }
      const key = JSON.stringify([fix.field, fix.sceneId, fix.turnIndex]);
      if (targets.has(key)) throw new Error("Propose only one replacement per field.");
      targets.add(key);
    }
    return {
      severity: issue.severity as FinalReview["issues"][number]["severity"],
      area: issue.area as FinalReview["issues"][number]["area"],
      sceneId: String(issue.sceneId),
      message: prose(issue.message, 700),
      suggestion: prose(issue.suggestion, 1000),
      fix,
    };
  });
  return { summary: prose(result.summary, 1200), issues };
}
export function finalReviewOutcome(review: FinalReview) {
  return review.issues.some((issue) => issue.severity === "high")
    ? "needs-attention"
    : review.issues.length
      ? "suggestions"
      : "clear";
}
export function applyFinalReviewFixes(
  snapshot: WritingSnapshot,
  fixes: FinalReviewFix[],
): WritingSnapshot {
  const copy = structuredClone(snapshot);
  for (const fix of fixes) {
    if (fixValue(copy, fix) !== fix.before)
      throw new Error("Reviewed content changed. Run final review again.");
    if (fix.field === "title") copy.title = fix.after;
    else if (fix.field === "publicationText") copy.publicationText = fix.after;
    else {
      const scene = copy.scenes.find((scene) => scene.id === fix.sceneId);
      if (!scene) throw new Error("Missing scene.");
      if (fix.field === "narration") scene.texts[fix.turnIndex] = fix.after;
      else if (fix.field === "overlay") scene.overlay = fix.after;
      else {
        const design = copy.design?.scenes.find((item) => item.id === fix.sceneId);
        if (!design) throw new Error("Missing presentation headline.");
        design.headline = fix.after;
      }
    }
  }
  return copy;
}

/** LM Studio can constrain local output syntax; semantic checks still run above. */
export function finalReviewResponseSchema(episode: ContentEpisode) {
  const scene = { type: "string", enum: ["overall", ...episode.scenes.map((scene) => scene.id)] };
  const fix = {
    type: "object",
    additionalProperties: false,
    properties: {
      field: {
        type: "string",
        enum: ["title", "narration", "overlay", "publicationText", "presentationHeadline"],
      },
      sceneId: scene,
      turnIndex: { type: "integer", minimum: 0, maximum: 5 },
      before: { type: "string" },
      after: { type: "string" },
    },
    required: ["field", "sceneId", "turnIndex", "before", "after"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      issues: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            severity: { type: "string", enum: ["high", "medium", "low"] },
            area: { type: "string", enum: ["script", "companion", "slides", "sources"] },
            sceneId: scene,
            message: { type: "string" },
            suggestion: { type: "string" },
            fix: { anyOf: [{ type: "null" }, fix] },
          },
          required: ["severity", "area", "sceneId", "message", "suggestion", "fix"],
        },
      },
    },
    required: ["summary", "issues"],
  };
}
