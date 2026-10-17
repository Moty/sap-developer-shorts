export interface Source {
  id: string;
  title: string;
  url: string;
  retrievedOn: string;
}

export interface FaceLandmarksConfig {
  leftEye: [number, number, number, number];
  rightEye: [number, number, number, number];
  jawY: number;
  faceX: number;
  faceY: number;
  faceRx: number;
  faceRy: number;
}

export interface SpeakerAvatarConfig {
  mode: "illustrated" | "photo";
  animation?: "mouth-only" | "full-face" | "neural";
  imageId?: string;
  mouthX?: number;
  mouthY?: number;
  mouthScale?: number;
  mouthAngle?: number;
  mouthAspect?: number;
  faceLandmarks?: FaceLandmarksConfig;
  calibration?: { imageSha256: string; modelSha256: string; detector: "mediapipe-0.10.32" };
  eyeY?: number;
}

export interface Presentation {
  variant?: string;
  tone: "professional" | "casual" | "comic";
  format: "explainer" | "dialogue" | "myth-fact" | "countdown" | "story" | "quiz";
  humor: "none" | "light" | "sap-geek";
  speakers: { id: string; name: string; voice: string; avatar?: SpeakerAvatarConfig }[];
}

export interface Scene {
  id: string;
  phase: "hook" | "context" | "demo" | "payoff" | "cta";
  startSeconds: number;
  endSeconds: number;
  narration: string;
  dialogue?: { speakerId: string; text: string }[];
  overlay: string;
  visual: {
    kind: "presenter" | "code" | "output";
    label: string;
    codePath?: string;
    captureKey?: "products" | "filtered" | "metadata";
    instructions?: string[];
  };
}

export interface Episode {
  schemaVersion: 1;
  id: string;
  version: number;
  title: string;
  audience: string;
  language: "en";
  targetDurationSeconds: number;
  presentation?: Presentation;
  environment: { description: string; prerequisites: string[] };
  sources: Source[];
  claims: { id: string; text: string; sourceIds: string[]; evidenceChecks: string[] }[];
  demo: { id: "cap-inventory"; expectedChecks: string[] };
  scenes: Scene[];
  pronunciation: Record<string, string>;
  publication: { channel: "linkedin"; text: string };
}

export type AvailabilityStatus =
  | "generally-available"
  | "rollout"
  | "early-access"
  | "planned"
  | "announced";

export interface NewsSource extends Source {
  publisher: "SAP";
  publishedOn: string | null;
}

export interface NewsClaim {
  id: string;
  text: string;
  sourceIds: string[];
  checkedOn: string;
  availability: { status: AvailabilityStatus; timing: string; scope: string };
  support: { sourceId: string; locator: string; summary: string }[];
}

export interface NewsScene extends Omit<Scene, "phase" | "visual"> {
  phase: "hook" | "context" | "headline" | "payoff" | "cta";
  claimIds: string[];
  visual: { kind: "presenter" | "news-card"; label: string };
}

export interface NewsEpisode
  extends Omit<Episode, "environment" | "demo" | "sources" | "claims" | "scenes"> {
  format: "news";
  news: {
    event: string;
    asOf: string;
    maxAgeDays: number;
    editorialStatus: "draft";
    selection: "editorial";
    angle: string;
  };
  sources: NewsSource[];
  claims: NewsClaim[];
  scenes: NewsScene[];
}

export type ContentEpisode = Episode | NewsEpisode;

export function isNewsEpisode(episode: ContentEpisode): episode is NewsEpisode {
  return "format" in episode && episode.format === "news";
}

export interface NewsTopic {
  id: string;
  title: string;
  event: string;
  angle: string;
  priority: number;
  status: "draft-ready" | "needs-research";
  sourceUrls: string[];
}

export interface NewsEvidence {
  schemaVersion: 1;
  kind: "news-source-review";
  asOf: string;
  event: string;
  editorialStatus: "draft";
  sources: NewsSource[];
  claimReviews: NewsClaim[];
}

export interface Topic {
  id: string;
  pillar: "ABAP" | "CAP" | "RAP" | "BTP" | "AI";
  title: string;
  status: "needs-research" | "pilot-ready";
  prerequisites: string[];
  sources: Source[];
  supportedRelease: string | null;
  verifiedOn: string | null;
  outcome: string;
}

export interface DemoEvidence {
  demoId: string;
  verifiedAt: string;
  environment: { node: string; cds: string; database: string };
  checks: string[];
  captures: { products: ProductCollection; filtered: ProductCollection; metadata: string };
}

export interface ProductCollection {
  "@odata.context"?: string;
  value: { ID: string; title: string; stock: number }[];
}
