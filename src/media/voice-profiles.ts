import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { hash } from "../digest.js";
import { inside, projectRoot } from "../paths.js";
import { readPcmWav } from "./audio.js";
import { withModelLock } from "./model-lock.js";
import { type ClonedVoice, isClonedVoice } from "./voice-reference.js";

const exec = promisify(execFile);
export const profileRoot = resolve(projectRoot, ".state/voice-profiles");
export const maximumSampleBytes = 30 * 1024 * 1024;
interface Profile {
  schemaVersion: 1;
  id: string;
  revision: string;
  name: string;
  transcript: string;
  sampleHash: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  consentAt: string;
  warnings: string[];
}
export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}
async function safeRoot(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new Error("Voice storage cannot be a symlink.");
  return realpath(root);
}
function revisionFor(
  profile: Pick<Profile, "sampleHash" | "transcript" | "startSeconds" | "endSeconds">,
) {
  return hash(
    JSON.stringify({
      version: 1,
      sampleHash: profile.sampleHash,
      transcript: profile.transcript,
      startSeconds: profile.startSeconds,
      endSeconds: profile.endSeconds,
    }),
  );
}
export async function profileDirectory(voice: ClonedVoice, root = profileRoot) {
  if (!isClonedVoice(voice)) throw new Error("Invalid local voice reference.");
  const base = await safeRoot(root);
  const candidate = inside(base, `${voice.profileId}/${voice.revision}`);
  const actual = inside(base, await realpath(candidate));
  if (actual !== candidate) throw new Error("Voice profile cannot contain symlink redirects.");
  return candidate;
}
export async function readVoiceProfile(
  voice: ClonedVoice,
  options: { accepted?: boolean; root?: string } = {},
) {
  let directory: string;
  try {
    directory = await profileDirectory(voice, options.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        "Voice unavailable on this Mac. Enroll it here or choose another voice explicitly.",
      );
    throw error;
  }
  for (const name of ["profile.json", "sample.wav"])
    if (!(await lstat(resolve(directory, name))).isFile())
      throw new Error("Voice profile files must be regular files.");
  const profile = JSON.parse(await readFile(resolve(directory, "profile.json"), "utf8")) as Profile;
  const sample = await readFile(resolve(directory, "sample.wav"));
  if (
    profile.schemaVersion !== 1 ||
    profile.id !== voice.profileId ||
    profile.revision !== voice.revision ||
    !profile.consentAt ||
    typeof profile.transcript !== "string" ||
    hash(sample) !== profile.sampleHash ||
    revisionFor(profile) !== voice.revision
  )
    throw new Error("Voice profile changed. Enroll and audition a new revision.");
  let acceptance: { auditionHash: string; runtimeHash: string } | undefined;
  try {
    acceptance = JSON.parse(await readFile(resolve(directory, "accepted.json"), "utf8"));
    if (hash(await readFile(resolve(directory, "audition.wav"))) !== acceptance?.auditionHash)
      acceptance = undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (options.accepted !== false && !acceptance)
    throw new Error("Listen to and accept this voice's audition first.");
  return { profile, sample, directory, acceptance };
}
export async function createVoiceProfile(
  bytes: Buffer,
  input: {
    name: string;
    transcript: string;
    consent: boolean;
    startSeconds?: number;
    endSeconds?: number;
    profileId?: string;
  },
  root = profileRoot,
) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const transcript =
    typeof input.transcript === "string" ? input.transcript.trim().replace(/\s+/gu, " ") : "";
  if (
    !name ||
    name.length > 64 ||
    !transcript ||
    transcript.length > 2000 ||
    /[<>[\]]/u.test(transcript) ||
    Array.from(transcript).some((character) => character.charCodeAt(0) < 32) ||
    input.consent !== true
  )
    throw new Error(
      "Enter a voice name, the exact sample transcript, and confirm the speaker agreed.",
    );
  if (!bytes.length || bytes.length > maximumSampleBytes)
    throw new Error("Choose an audio recording up to 30 MiB.");
  const base = await safeRoot(root);
  const work = resolve(base, `.import-${randomUUID()}`);
  await mkdir(work, { mode: 0o700 });
  try {
    const source = resolve(work, "upload");
    await writeFile(source, bytes, { mode: 0o600 });
    const probe = await exec(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", source],
      { timeout: 10000 },
    );
    const duration = Number(JSON.parse(probe.stdout).format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120)
      throw new Error("Choose a recording no longer than two minutes.");
    const startSeconds = input.startSeconds ?? 0;
    const endSeconds = input.endSeconds ?? Math.min(duration, 15);
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds > duration + 0.05 ||
      endSeconds - startSeconds < 3 ||
      endSeconds - startSeconds > 30
    )
      throw new Error("Select a 3–30 second sample; 10–15 seconds is recommended.");
    const normalized = resolve(work, "sample.wav");
    await exec(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-i",
        source,
        "-ss",
        String(startSeconds),
        "-t",
        String(endSeconds - startSeconds),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-c:a",
        "pcm_s16le",
        normalized,
      ],
      { timeout: 20000 },
    );
    const sample = await readFile(normalized);
    const pcm = readPcmWav(sample);
    let sum = 0;
    let clipping = 0;
    let silent = 0;
    for (let offset = 0; offset < pcm.length; offset += 2) {
      const value = pcm.readInt16LE(offset) / 32768;
      sum += value * value;
      if (Math.abs(value) > 0.99) clipping++;
      if (Math.abs(value) < 0.003) silent++;
    }
    const frames = pcm.length / 2;
    if (Math.sqrt(sum / frames) < 0.003)
      throw new Error("The selected sample is too quiet or silent. Record clear speech.");
    const warnings = [];
    if (clipping / frames > 0.005)
      warnings.push("The recording may be clipping. Try a lower microphone level.");
    if (silent / frames > 0.7)
      warnings.push("The recording contains long quiet sections. Select a shorter spoken excerpt.");
    const id = input.profileId ?? randomUUID();
    const profile = {
      schemaVersion: 1 as const,
      id,
      name,
      transcript,
      sampleHash: hash(sample),
      startSeconds,
      endSeconds,
      durationSeconds: frames / 22050,
      consentAt: new Date().toISOString(),
      warnings,
      revision: "",
    };
    profile.revision = revisionFor(profile);
    const voice: ClonedVoice = { engine: "qwen", profileId: id, revision: profile.revision };
    if (!isClonedVoice(voice)) throw new Error("Invalid profile ID.");
    const destination = inside(base, `${id}/${profile.revision}`);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    if ((await realpath(destination)) !== destination)
      throw new Error("Voice storage cannot contain redirects.");
    try {
      await writeFile(resolve(destination, "sample.wav"), sample, { flag: "wx", mode: 0o600 });
      await atomicJson(resolve(destination, "profile.json"), profile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await atomicJson(resolve(base, id, "head.json"), voice);
    return { voice, name, durationSeconds: profile.durationSeconds, warnings };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
export async function listVoiceProfiles(root = profileRoot) {
  const base = await safeRoot(root);
  const result = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const voice = JSON.parse(
        await readFile(resolve(base, entry.name, "head.json"), "utf8"),
      ) as ClonedVoice;
      const { profile, acceptance, directory } = await readVoiceProfile(voice, {
        accepted: false,
        root,
      });
      let audition: { runtimeHash: string; sha256: string } | undefined;
      try {
        const receipt = JSON.parse(await readFile(resolve(directory, "audition.json"), "utf8"));
        if (
          /^[a-f0-9]{64}$/u.test(receipt.runtimeHash) &&
          receipt.auditionHash === hash(await readFile(resolve(directory, "audition.wav")))
        )
          audition = { runtimeHash: receipt.runtimeHash, sha256: receipt.auditionHash };
      } catch {
        // An absent or interrupted audition does not hide the original recording.
      }
      result.push({
        voice,
        name: profile.name,
        durationSeconds: profile.durationSeconds,
        accepted: !!acceptance,
        ...(audition ? { audition } : {}),
        warnings: profile.warnings,
      });
    } catch {
      /* Damaged entries must not be offered as valid voices. */
    }
  }
  return result;
}
export async function deleteVoiceProfile(voice: ClonedVoice, root = profileRoot) {
  await withModelLock(async () => {
    const directory = await profileDirectory(voice, root);
    await rm(resolve(directory, ".."), { recursive: true });
  });
}
