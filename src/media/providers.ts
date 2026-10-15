import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assembleNarration, narrationChunks, synthesizeChunk } from "./audio.js";
import type { MediaProvider, MediaRequest } from "./model.js";
import { assembleNeuralNarration, synthesizeNeuralScene } from "./neural.js";
import type { MediaStore } from "./store.js";

interface ProviderRecord {
  key: string;
  index: number;
  polls: number;
  ready: boolean;
  directory: string;
}

export class FakeProvider implements MediaProvider {
  readonly id = "fake";
  readonly billing = "simulated";
  constructor(
    private readonly store: MediaStore,
    private readonly quoteCents = 0,
  ) {}
  quote() {
    return this.quoteCents;
  }
  async submit(request: MediaRequest, key: string) {
    if (request.scenario === "unknown-submit") throw new Error("Simulated uncertain submission");
    const id = `fake-${key}`;
    if (!this.store.providerGet(key))
      this.store.providerPut(id, key, { key, index: 0, polls: 0, ready: false, directory: "" });
    if (request.scenario === "lost-submit") throw new Error("Simulated lost submission response");
    return id;
  }
  async lookup(key: string) {
    const record = this.store.providerGet(key);
    return record ? { state: "found" as const, id: record.id } : { state: "unknown" as const };
  }
  async poll(id: string, request: MediaRequest) {
    const saved = this.store.providerGet(id);
    if (!saved) throw new Error("Unknown simulated provider job");
    const record = saved.value as ProviderRecord;
    if (request.scenario === "failure")
      return { state: "failed" as const, message: "Simulated processing failure" };
    if (request.scenario === "poll-timeout" && !record.polls) {
      record.polls++;
      this.store.providerPut(id, record.key, record);
      throw new Error("Simulated poll timeout");
    }
    if (record.polls++ === 0) {
      this.store.providerPut(id, record.key, record);
      return { state: "processing" as const, progress: "Simulated processing" };
    }
    return {
      state: "ready" as const,
      output: { kind: "simulation" as const, billedCents: this.quoteCents, directory: null },
    };
  }
}

export class LocalSpeechProvider implements MediaProvider {
  readonly id: "local-speech" | "local-kokoro";
  readonly billing = "free";
  constructor(
    private readonly store: MediaStore,
    private readonly workRoot: string,
    private readonly engine: "system" | "kokoro" = "system",
  ) {
    this.id = engine === "kokoro" ? "local-kokoro" : "local-speech";
  }
  quote() {
    return 0;
  }
  async submit(_request: MediaRequest, key: string) {
    const id = `${this.engine === "kokoro" ? "kokoro" : "local"}-${key}`;
    if (!this.store.providerGet(key))
      this.store.providerPut(id, key, {
        key,
        index: 0,
        polls: 0,
        ready: false,
        directory: resolve(this.workRoot, id),
      });
    return id;
  }
  async lookup(key: string) {
    const record = this.store.providerGet(key);
    return record ? { state: "found" as const, id: record.id } : { state: "unknown" as const };
  }
  async poll(id: string, request: MediaRequest, signal: AbortSignal) {
    const saved = this.store.providerGet(id);
    if (!saved) throw new Error("Unknown local narration job");
    const record = saved.value as ProviderRecord;
    const chunks = narrationChunks(request);
    const count = this.engine === "kokoro" ? request.episode.scenes.length : chunks.length;
    await mkdir(record.directory, { recursive: true });
    if (!record.ready && record.index < count) {
      if (this.engine === "kokoro")
        await synthesizeNeuralScene(request, record.index, record.directory, signal);
      else {
        const chunk = chunks[record.index];
        if (!chunk) throw new Error("Missing narration chunk");
        await synthesizeChunk(
          request,
          chunk.spokenText,
          resolve(record.directory, `chunk-${record.index}.wav`),
          signal,
        );
      }
      record.index++;
      this.store.providerPut(id, record.key, record);
      return {
        state: "processing" as const,
        progress: `Recorded ${this.engine === "kokoro" ? "scene" : "phrase"} ${record.index}/${count}`,
      };
    }
    if (!record.ready) {
      if (this.engine === "kokoro") await assembleNeuralNarration(request, record.directory);
      else await assembleNarration(request, record.directory);
      record.ready = true;
      this.store.providerPut(id, record.key, record);
    }
    return {
      state: "ready" as const,
      output: { kind: "narration" as const, billedCents: 0, directory: record.directory },
    };
  }
}
