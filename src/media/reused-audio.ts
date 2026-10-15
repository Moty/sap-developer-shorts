import { readFile, realpath } from "node:fs/promises";
import { hash } from "../digest.js";
import { inside } from "../paths.js";
import type { MediaJob } from "./model.js";

export async function readReusedAudio(job: MediaJob, directory: string) {
  const root = await realpath(directory);
  const read = async (name: string) => readFile(inside(root, await realpath(inside(root, name))));
  const receipt = JSON.parse((await read("reuse-manifest.json")).toString("utf8"));
  const reuse = receipt.audioReuse as MediaJob["audioReuse"];
  if (
    receipt.schemaVersion !== 1 ||
    receipt.jobId !== job.id ||
    receipt.requestHash !== job.requestHash ||
    !reuse ||
    !/^[a-f0-9]{64}$/u.test(reuse.sourceAudioHash) ||
    !/^[a-f0-9]{64}$/u.test(reuse.timingHash) ||
    typeof reuse.jobId !== "string" ||
    (job.audioReuse &&
      (reuse.jobId !== job.audioReuse.jobId ||
        reuse.sourceAudioHash !== job.audioReuse.sourceAudioHash ||
        reuse.timingHash !== job.audioReuse.timingHash))
  )
    throw new Error("Saved audio reuse receipt differs from this job");
  const files: Record<string, Buffer> = {};
  for (const name of ["narration.wav", "timing.json", "captions.vtt"]) {
    const bytes = await read(name);
    if (hash(bytes) !== receipt.artifactHashes?.[name])
      throw new Error(`Copied audio reuse artifact changed: ${name}`);
    files[name] = bytes;
  }
  if (
    hash(files["narration.wav"] as Buffer) !== reuse.sourceAudioHash ||
    hash(files["timing.json"] as Buffer) !== reuse.timingHash
  )
    throw new Error("Copied audio reuse hashes differ from the recorded provenance");
  return { files, audioReuse: reuse, directory: root };
}
