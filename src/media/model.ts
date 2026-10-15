import type { ContentEpisode } from "../domain.js";

export type MediaPhase =
  | "PLANNED"
  | "SUBMITTING"
  | "SUBMISSION_UNKNOWN"
  | "SUBMITTED"
  | "PROCESSING"
  | "POLL_TIMEOUT"
  | "PACKAGE_PENDING"
  | "PACKAGE_FAILED"
  | "SUCCEEDED"
  | "SIMULATED"
  | "FAILED";
export type FakeScenario =
  | "success"
  | "lost-submit"
  | "unknown-submit"
  | "poll-timeout"
  | "failure";
export interface ProductionSettings {
  schemaVersion: 1;
  presenter: "stock";
  currency: "USD";
  pilotBudgetCents: number;
  liveProvider: null;
  localPreview: {
    voice: string;
    wordsPerMinute: number;
    sampleRate: 22050;
    engine?: "system" | "kokoro";
    speed?: number;
  };
}
export interface MediaRequest {
  schemaVersion: 1;
  episode: ContentEpisode;
  settings: ProductionSettings;
  provider: "fake" | "local-speech" | "local-kokoro";
  voiceRuntimeHash?: string;
  generatorHash?: string;
  scenario: FakeScenario;
  sourceDirectory: string;
  sourceManifestHash: string;
}
export interface MediaJob {
  schemaVersion: 1;
  id: string;
  requestKey: string;
  requestHash: string;
  request: MediaRequest;
  phase: MediaPhase;
  providerJobId: string | null;
  providerOutput: ProviderOutput | null;
  quoteCents: number;
  billedCents: number | null;
  outputDirectory: string | null;
  error: string | null;
  progress: string | null;
  createdAt: string;
  updatedAt: string;
  history: { phase: MediaPhase; at: string }[];
  retryOf?: string;
  audioReuse?: { jobId: string; sourceAudioHash: string; timingHash: string };
}
export interface Cue {
  speakerId?: string;
  speakerName?: string;
  sceneId: string;
  text: string;
  spokenText: string;
  startSeconds: number;
  endSeconds: number;
}
export interface NarrationTiming {
  schemaVersion: 1;
  mode: "local-preview";
  voice: string;
  rate: number;
  durationSeconds: number;
  sampleRate: number;
  engine?: "kokoro";
  speed?: number;
  alignment?: "model-estimated-phrase-boundaries";
  scenes: { id: string; startSeconds: number; endSeconds: number; speechSeconds: number }[];
  cues: Cue[];
}
export interface ProviderOutput {
  kind: "narration" | "simulation";
  billedCents: number;
  directory: string | null;
}
export interface MediaProvider {
  readonly id: "fake" | "local-speech" | "local-kokoro";
  readonly billing: "free" | "simulated";
  quote(request: MediaRequest): number;
  submit(request: MediaRequest, key: string, signal: AbortSignal): Promise<string>;
  lookup(
    key: string,
    signal: AbortSignal,
  ): Promise<{ state: "found"; id: string } | { state: "unknown" }>;
  poll(
    id: string,
    request: MediaRequest,
    signal: AbortSignal,
  ): Promise<
    | { state: "processing"; progress: string }
    | { state: "failed"; message: string }
    | { state: "ready"; output: ProviderOutput }
  >;
}
