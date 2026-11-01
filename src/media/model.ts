import type { ContentEpisode } from "../domain.js";
import type { VoiceReference } from "./voice-reference.js";

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
interface MediaRequestBase {
  episode: ContentEpisode;
  settings: ProductionSettings;
  voiceRuntimeHash?: string;
  generatorHash?: string;
  scenario: FakeScenario;
  sourceDirectory: string;
  sourceManifestHash: string;
}
export interface ResolvedVoice {
  speakerId: string;
  voice: VoiceReference;
  runtimeHash: string;
  speed?: number;
}
export type MediaRequest = MediaRequestBase &
  (
    | { schemaVersion: 1; provider: "fake" | "local-speech" | "local-kokoro"; voicePlan?: never }
    | { schemaVersion: 2; provider: "local-voices"; voicePlan: ResolvedVoice[] }
  );
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
export interface LegacyNarrationTiming {
  sceneReuse?: { reused: number; generated: number; checkpoint: number };
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
export interface LocalNarrationTiming {
  schemaVersion: 2;
  mode: "local-preview";
  engine: "local-voices";
  alignment: "local-per-speaker-phrase-boundaries";
  alignmentRuntimeHash: string;
  speakers: { id: string; engine: "qwen" | "kokoro"; voiceHash: string }[];
  durationSeconds: number;
  sampleRate: number;
  scenes: LegacyNarrationTiming["scenes"];
  cues: Cue[];
}
export type NarrationTiming = LegacyNarrationTiming | LocalNarrationTiming;
export interface ProviderOutput {
  kind: "narration" | "simulation";
  billedCents: number;
  directory: string | null;
}
export interface MediaProvider {
  readonly id: MediaRequest["provider"];
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
