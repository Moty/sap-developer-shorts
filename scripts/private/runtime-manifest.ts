import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const dirty = (await exec("git", ["status", "--porcelain", "--untracked-files=no"])).stdout.trim();
if (dirty) throw new Error("Commit the reviewed source before preparing a cloud build context.");
await mkdir(".state/private-builds", { recursive: true, mode: 0o700 });
const directory = await mkdtemp(resolve(".state/private-builds/context-"));
const archive = resolve(directory, "source.tar");
await exec("git", ["archive", "--format=tar", `--output=${archive}`, "HEAD"]);
await exec("tar", ["-xf", archive, "-C", directory]);
await rm(archive);
const files = (await exec("git", ["ls-files", "-z"])).stdout
  .split("\0")
  .filter(
    (file) =>
      file &&
      !file.startsWith("assets/avatars/") &&
      !file.startsWith("content/presentations/") &&
      !file.startsWith(".state/") &&
      !file.startsWith("config/private/"),
  );
await writeFile(resolve(directory, "config/worker-files.json"), JSON.stringify(files, null, 2));
await mkdir(resolve(directory, "config/private-templates"), { recursive: true });
for (const name of [
  "CAP-01--casual-v2.json",
  "CAP-01--duo.json",
  "CAP-02--quiz.json",
  "NEWS-02--myth-fact.json",
]) {
  const input = resolve(directory, "content/presentations", name);
  const source = await readFile(input, "utf8");
  const parsed = JSON.parse(source);
  if (
    parsed.presentation?.speakers.some(
      (speaker: { voice: unknown }) => typeof speaker.voice !== "string",
    )
  )
    throw new Error("Container templates must use public stock voices.");
  await copyFile(input, resolve(directory, "config/private-templates", name));
}
// Exclude even previously committed portraits/variants from the upload context.
// Only the reviewed stock template copies above are needed by the containers.
await rm(resolve(directory, "assets/avatars"), { recursive: true, force: true });
await rm(resolve(directory, "content/presentations"), { recursive: true, force: true });
console.log(`Verified committed build context: ${directory}`);
