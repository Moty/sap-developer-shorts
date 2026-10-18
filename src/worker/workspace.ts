import { execFile } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { digest, type RecordData } from "../cloud/contracts.js";
import { inside, repositoryRoot } from "../paths.js";

const exec = promisify(execFile);
/** Only version-controlled runtime inputs are copied; personal state and avatars are excluded. */
export async function stageRuntime(directory: string) {
  let files: string[];
  try {
    files = JSON.parse(
      await readFile(resolve(repositoryRoot, "config/worker-files.json"), "utf8"),
    ) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    files = (
      await exec("git", ["ls-files", "-z"], { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 })
    ).stdout
      .split("\0")
      .filter(Boolean);
  }
  if (import.meta.url.endsWith(".js")) {
    // Production images contain compiled runtime code, with no tsx/dev dependencies.
    const compiled = resolve(repositoryRoot, "dist/src");
    for (const name of await readdir(compiled, { recursive: true })) {
      const source = inside(compiled, name);
      const info = await lstat(source);
      if (info.isDirectory()) continue;
      if (!info.isFile() || (await realpath(source)) !== source)
        throw new Error("Compiled runtime input redirects are forbidden.");
      const target = inside(resolve(directory, "dist/src"), name);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target);
    }
  }
  for (const name of files) {
    if (
      !/^(src\/|scripts\/|schemas\/|config\/|templates\/|demos\/|assets\/|content\/|prompts\/|package(?:-lock)?\.json$)/u.test(
        name,
      ) ||
      name.startsWith("assets/avatars/") ||
      name.startsWith("content/presentations/") ||
      name.startsWith("config/private/")
    )
      continue;
    const source = inside(repositoryRoot, name);
    if (!(await lstat(source)).isFile() || (await realpath(source)) !== source)
      throw new Error("Runtime input redirects are forbidden.");
    const target = inside(directory, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target);
  }
  await mkdir(resolve(directory, "content/presentations"), { recursive: true });
  await mkdir(resolve(directory, "assets/avatars"), { recursive: true });
  await symlink(resolve(repositoryRoot, "node_modules"), resolve(directory, "node_modules"), "dir");
}
export async function stageInputs(
  directory: string,
  manifest: RecordData,
  inputs: Map<string, Buffer>,
) {
  const snapshot = manifest.snapshot as RecordData;
  const assets = manifest.assets as RecordData[];
  for (const asset of assets) {
    const data = inputs.get(String(asset.id));
    if (!data || digest(data) !== asset.sha256)
      throw new Error("Workspace input checksum mismatch.");
    if (asset.kind === "portrait")
      await writeFile(resolve(directory, "assets/avatars", `${asset.id}.png`), data, {
        mode: 0o600,
      });
  }
  const episode = structuredClone(snapshot.episode) as RecordData;
  const presentation = episode.presentation as { variant?: string; speakers: RecordData[] };
  if (presentation.variant) delete presentation.variant;
  for (const entry of snapshot.voices as {
    profile: RecordData;
    approval: RecordData | null;
    speakerId: string;
  }[]) {
    const profile = entry.profile.profile as RecordData;
    const folder = resolve(
      directory,
      ".state/voice-profiles",
      String(profile.id),
      String(profile.revision),
    );
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const sample = inputs.get(String(entry.profile.sampleAssetId));
    if (!sample || digest(sample) !== profile.sampleHash)
      throw new Error("Voice sample integrity check failed.");
    await writeFile(resolve(folder, "sample.wav"), sample, { mode: 0o600 });
    await writeFile(resolve(folder, "profile.json"), JSON.stringify(profile), { mode: 0o600 });
    const speaker = presentation.speakers.find((speaker) => speaker.id === entry.speakerId);
    if (!speaker) throw new Error("Voice speaker missing from snapshot.");
    speaker.voice = { engine: "qwen", profileId: profile.id, revision: profile.revision };
    episode.schemaVersion = 2;
    if (entry.approval) {
      const audition = inputs.get(String(entry.approval.assetId));
      if (!audition || digest(audition) !== entry.approval.auditionHash)
        throw new Error("Approved audition integrity check failed.");
      // The worker checked the portable runtime against this server-issued approval.
      // Retain the normal local runtime-hash and sample checks within the pipeline.
      const runtimeBytes = await readFile(
        resolve(repositoryRoot, ".state/qwen-voice/runtime.json"),
      );
      await writeFile(resolve(folder, "audition.wav"), audition, { mode: 0o600 });
      await writeFile(
        resolve(folder, "accepted.json"),
        JSON.stringify({
          runtimeHash: digest(runtimeBytes),
          auditionHash: digest(audition),
          acceptedAt: new Date(Number(entry.approval.acceptedAt)).toISOString(),
        }),
        { mode: 0o600 },
      );
    }
  }
  if (episode.id)
    await writeFile(
      resolve(directory, "content/episodes", `${episode.id}.json`),
      JSON.stringify(episode),
      { mode: 0o600 },
    );
  await writeFile(
    resolve(directory, "worker-input.json"),
    JSON.stringify({ kind: (manifest.job as RecordData).kind, snapshot, episode }),
    { mode: 0o600 },
  );
}
