import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "../digest.js";
import type { ContentEpisode } from "../domain.js";
import { sourceFile } from "../paths.js";
import {
  buildVtt,
  encodePcmWav,
  pronounce,
  readPcmWav,
  sampleRate,
  splitNarration,
} from "./audio.js";
import { currentNarrationGeneratorHash } from "./fingerprint.js";
import type {
  Cue,
  LocalNarrationTiming,
  MediaProvider,
  MediaRequest,
  ResolvedVoice,
} from "./model.js";
import { withModelLock } from "./model-lock.js";
import { neuralRuntime, readNeuralScene, synthesizeNeuralScene } from "./neural.js";
import { type AlignedWord, qwenRuntime, synthesizeClonedSpeech } from "./qwen.js";
import type { MediaStore } from "./store.js";
import { readVoiceProfile } from "./voice-profiles.js";
import { isClonedVoice } from "./voice-reference.js";

export async function localVoicesGeneratorHash() {
  const names = [
    "src/media/local-voices.ts",
    "src/media/qwen.ts",
    "src/media/qwen-runner.py",
    "src/media/voice-reference.ts",
    "src/media/voice-profiles.ts",
    "config/qwen-voice.json",
    "config/qwen-voice-requirements.txt",
    "schemas/narration-timing-v2.schema.json",
  ];
  const entries = await Promise.all(
    names.map(async (name) => [
      name,
      hash(
        await readFile(
          await sourceFile(
            name.endsWith(".ts") && import.meta.url.endsWith(".js")
              ? name.replace("src/", "dist/src/").replace(".ts", ".js")
              : name,
          ),
        ),
      ),
    ]),
  );
  return hash(
    JSON.stringify({ files: entries, kokoro: await currentNarrationGeneratorHash("local-kokoro") }),
  );
}
export async function resolveVoicePlan(
  episode: ContentEpisode,
  speed = 0.96,
): Promise<ResolvedVoice[]> {
  const runtime = await qwenRuntime();
  const plan = [];
  for (const speaker of episode.presentation?.speakers ?? []) {
    if (isClonedVoice(speaker.voice)) {
      const { acceptance } = await readVoiceProfile(speaker.voice);
      if (acceptance?.runtimeHash !== runtime.hash)
        throw new Error("Audition and accept this voice with the installed model first.");
      plan.push({ speakerId: speaker.id, voice: speaker.voice, runtimeHash: runtime.hash });
    } else {
      const stock = await neuralRuntime([speaker.voice]);
      plan.push({ speakerId: speaker.id, voice: speaker.voice, runtimeHash: stock.hash, speed });
    }
  }
  if (!plan.some((speaker) => isClonedVoice(speaker.voice)))
    throw new Error("A local cloned-voice job needs a voice profile.");
  return plan;
}
const letters = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function phraseCues(
  text: string,
  pronunciation: Record<string, string>,
  words: AlignedWord[],
  duration: number,
): Omit<Cue, "sceneId">[] {
  let cursor = 0;
  let wordCursor = 0;
  let end = 0;
  const normalized = words.map((word) => letters(word.text)).join("");
  const phrases = splitNarration(text);
  if (normalized !== letters(pronounce(text, pronunciation)))
    throw new Error("Alignment text does not cover the requested speech.");
  let wordEnd = 0;
  for (const word of words) {
    if (
      !Number.isFinite(word.startSeconds) ||
      !Number.isFinite(word.endSeconds) ||
      word.startSeconds < wordEnd ||
      word.endSeconds < word.startSeconds ||
      word.endSeconds > duration + 0.08
    )
      throw new Error("The aligner returned invalid caption word times.");
    wordEnd = word.endSeconds;
  }
  return phrases.map((phrase) => {
    const spokenText = pronounce(phrase, pronunciation);
    const stop = cursor + letters(spokenText).length;
    const covered = [];
    while (wordCursor < words.length && cursor < stop) {
      const word = words[wordCursor++];
      if (!word) break;
      cursor += letters(word.text).length;
      covered.push(word);
    }
    if (cursor !== stop || !covered.length)
      throw new Error("A pronunciation entry crosses a caption boundary.");
    const first = covered[0] as AlignedWord;
    const last = covered[covered.length - 1] as AlignedWord;
    const left = first.startSeconds;
    const right = last.endSeconds;
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      left < end ||
      right <= left ||
      right > duration + 0.08
    )
      throw new Error(
        "The aligner returned invalid caption times. Generate another audition or shorten the turn.",
      );
    end = Math.min(right, duration);
    return { text: phrase, spokenText, startSeconds: left, endSeconds: end };
  });
}
export function timingSpeakers(plan: ResolvedVoice[]) {
  return plan.map((speaker) => ({
    id: speaker.speakerId,
    engine: isClonedVoice(speaker.voice) ? ("qwen" as const) : ("kokoro" as const),
    voiceHash: hash(JSON.stringify(speaker.voice)),
  }));
}
export function localSceneIdentity(
  request: Extract<MediaRequest, { schemaVersion: 2 }>,
  index: number,
) {
  return hash(
    JSON.stringify({
      request: request.voicePlan,
      generator: request.generatorHash,
      scene: request.episode.scenes[index],
      glossary: request.episode.pronunciation,
    }),
  );
}
export async function readLocalVoiceScene(
  request: Extract<MediaRequest, { schemaVersion: 2 }>,
  index: number,
  directory: string,
) {
  try {
    const scene = request.episode.scenes[index];
    if (!scene) return null;
    const wav = await readFile(resolve(directory, `scene-${index}.wav`));
    const pcm = readPcmWav(wav);
    const saved = JSON.parse(await readFile(resolve(directory, `scene-${index}.json`), "utf8"));
    const turns = scene.dialogue ?? [
      { speakerId: request.voicePlan[0]?.speakerId ?? "narrator", text: scene.narration },
    ];
    const expected = turns.flatMap((turn) =>
      splitNarration(turn.text).map((text) => ({
        text,
        spokenText: pronounce(text, request.episode.pronunciation),
        ...(scene.dialogue
          ? {
              speakerId: turn.speakerId,
              speakerName: request.episode.presentation?.speakers.find(
                (speaker) => speaker.id === turn.speakerId,
              )?.name,
            }
          : {}),
      })),
    );
    if (
      saved.inputHash !== localSceneIdentity(request, index) ||
      saved.wavHash !== hash(wav) ||
      saved.frames !== pcm.length / 2 ||
      !Array.isArray(saved.cues) ||
      saved.cues.length !== expected.length
    )
      return null;
    let end = 0;
    for (const [position, cue] of saved.cues.entries()) {
      const target = expected[position];
      if (
        !target ||
        cue.text !== target.text ||
        cue.spokenText !== target.spokenText ||
        cue.sceneId !== scene.id ||
        cue.speakerId !== target.speakerId ||
        cue.speakerName !== target.speakerName ||
        !Number.isFinite(cue.startSeconds) ||
        !Number.isFinite(cue.endSeconds) ||
        cue.startSeconds < end ||
        cue.endSeconds <= cue.startSeconds ||
        cue.endSeconds > saved.frames / sampleRate + 1 / sampleRate
      )
        return null;
      end = cue.endSeconds;
    }
    return { pcm, recorded: saved as { cues: Cue[]; frames: number } };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") throw error;
    return null;
  }
}
async function recordScene(
  request: Extract<MediaRequest, { schemaVersion: 2 }>,
  index: number,
  directory: string,
  signal: AbortSignal,
) {
  const scene = request.episode.scenes[index];
  if (!scene) throw new Error("Missing scene.");
  if (await readLocalVoiceScene(request, index, directory)) return;
  const identity = localSceneIdentity(request, index);
  const wavPath = resolve(directory, `scene-${index}.wav`);
  const timingPath = resolve(directory, `scene-${index}.json`);
  const turns = scene.dialogue ?? [
    { speakerId: request.voicePlan[0]?.speakerId ?? "narrator", text: scene.narration },
  ];
  const buffers: Buffer[] = [];
  const cues: Cue[] = [];
  let frames = 0;
  for (const [turnIndex, turn] of turns.entries()) {
    signal.throwIfAborted();
    const speaker = request.voicePlan.find((item) => item.speakerId === turn.speakerId);
    if (!speaker) throw new Error("Missing speaker voice plan.");
    let pcm: Buffer;
    let local: Omit<Cue, "sceneId">[];
    if (isClonedVoice(speaker.voice)) {
      if ((await qwenRuntime()).hash !== speaker.runtimeHash)
        throw new Error("The Qwen runtime changed. Start a new recording.");
      const output = await synthesizeClonedSpeech(
        speaker.voice,
        pronounce(turn.text, request.episode.pronunciation),
        { signal },
      );
      pcm = readPcmWav(output.audio);
      local = phraseCues(
        turn.text,
        request.episode.pronunciation,
        output.alignment.words,
        pcm.length / 2 / sampleRate,
      );
    } else {
      const work = resolve(directory, `stock-${index}-${turnIndex}`);
      // An invalid scene is regenerated as a unit, including its stock intermediates.
      await rm(work, { recursive: true, force: true });
      await mkdir(work, { recursive: true });
      const stock = {
        episode: {
          pronunciation: request.episode.pronunciation,
          scenes: [{ id: scene.id, narration: turn.text }],
        },
        settings: {
          localPreview: {
            ...request.settings.localPreview,
            voice: speaker.voice,
            speed: speaker.speed ?? 0.96,
          },
        },
        voiceRuntimeHash: speaker.runtimeHash,
        ...(request.generatorHash ? { generatorHash: request.generatorHash } : {}),
      };
      await synthesizeNeuralScene(stock, 0, work, signal);
      const output = await readNeuralScene(stock, 0, work);
      pcm = output.pcm;
      local = output.alignment.cues;
    }
    const offset = frames / sampleRate;
    for (const cue of local)
      cues.push({
        ...cue,
        sceneId: scene.id,
        startSeconds: offset + cue.startSeconds,
        endSeconds: offset + cue.endSeconds,
        ...(scene.dialogue
          ? {
              speakerId: turn.speakerId,
              speakerName:
                request.episode.presentation?.speakers.find((item) => item.id === turn.speakerId)
                  ?.name ?? "Speaker",
            }
          : {}),
      });
    buffers.push(pcm);
    frames += pcm.length / 2;
    if (turnIndex < turns.length - 1) {
      const pause = Math.round(0.2 * sampleRate);
      buffers.push(Buffer.alloc(pause * 2));
      frames += pause;
    }
  }
  const wav = encodePcmWav(Buffer.concat(buffers));
  const temporary = `${wavPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, wav);
  await rename(temporary, wavPath);
  const receipt = `${timingPath}.${randomUUID()}.tmp`;
  await writeFile(
    receipt,
    JSON.stringify({ inputHash: identity, wavHash: hash(wav), frames, cues }),
  );
  await rename(receipt, timingPath);
}
async function assemble(request: Extract<MediaRequest, { schemaVersion: 2 }>, directory: string) {
  const timing: LocalNarrationTiming = {
    schemaVersion: 2,
    mode: "local-preview",
    engine: "local-voices",
    alignment: "local-per-speaker-phrase-boundaries",
    alignmentRuntimeHash: (await qwenRuntime()).hash,
    speakers: timingSpeakers(request.voicePlan),
    durationSeconds: 0,
    sampleRate,
    scenes: [],
    cues: [],
  };
  let frames = 0;
  const buffers: Buffer[] = [];
  for (const [index, scene] of request.episode.scenes.entries()) {
    const saved = await readLocalVoiceScene(request, index, directory);
    if (!saved) throw new Error("A completed scene changed. Resume production to repair it.");
    const { pcm, recorded } = saved;
    const start = frames / sampleRate;
    for (const cue of recorded.cues as Cue[])
      timing.cues.push({
        ...cue,
        startSeconds: start + cue.startSeconds,
        endSeconds: start + cue.endSeconds,
      });
    frames += pcm.length / 2;
    buffers.push(pcm);
    if (index < request.episode.scenes.length - 1) {
      const pause = Math.round(0.15 * sampleRate);
      frames += pause;
      buffers.push(Buffer.alloc(pause * 2));
    }
    timing.scenes.push({
      id: scene.id,
      startSeconds: start,
      endSeconds: frames / sampleRate,
      speechSeconds: pcm.length / 2 / sampleRate,
    });
  }
  timing.durationSeconds = frames / sampleRate;
  await writeFile(resolve(directory, "narration.wav"), encodePcmWav(Buffer.concat(buffers)));
  await writeFile(resolve(directory, "timing.json"), JSON.stringify(timing, null, 2));
  await writeFile(resolve(directory, "captions.vtt"), buildVtt(timing.cues));
}
export class LocalVoicesProvider implements MediaProvider {
  readonly id = "local-voices";
  readonly billing = "free";
  constructor(
    private readonly store: MediaStore,
    private readonly root: string,
  ) {}
  quote() {
    return 0;
  }
  async submit(_request: MediaRequest, key: string) {
    const id = `voices-${key}`;
    if (!this.store.providerGet(key))
      this.store.providerPut(id, key, {
        key,
        index: 0,
        ready: false,
        directory: resolve(this.root, id),
      });
    return id;
  }
  async lookup(key: string) {
    const saved = this.store.providerGet(key);
    return saved ? { state: "found" as const, id: saved.id } : { state: "unknown" as const };
  }
  async poll(id: string, request: MediaRequest, signal: AbortSignal) {
    if (request.schemaVersion !== 2) throw new Error("Cloned narration requires a v2 request.");
    const saved = this.store.providerGet(id);
    if (!saved) throw new Error("Unknown local voice job.");
    const record = saved.value as { key: string; index: number; ready: boolean; directory: string };
    await mkdir(record.directory, { recursive: true });
    for (let index = 0; index < record.index; index++) {
      if (!(await readLocalVoiceScene(request, index, record.directory))) {
        record.index = index;
        record.ready = false;
        this.store.providerPut(id, record.key, record);
        break;
      }
    }
    if (record.index < request.episode.scenes.length) {
      await withModelLock(() => recordScene(request, record.index, record.directory, signal));
      record.index++;
      this.store.providerPut(id, record.key, record);
      return {
        state: "processing" as const,
        progress: `Recorded and aligned scene ${record.index}/${request.episode.scenes.length}`,
      };
    }
    if (!record.ready) {
      await assemble(request, record.directory);
      record.ready = true;
      this.store.providerPut(id, record.key, record);
    }
    return {
      state: "ready" as const,
      output: { kind: "narration" as const, billedCents: 0, directory: record.directory },
    };
  }
}
