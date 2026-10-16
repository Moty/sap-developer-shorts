import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { inside, projectRoot } from "./paths.js";
import { validatePresentationDefinition } from "./variants.js";

const maximumScriptBytes = 1024 * 1024;

export async function importScript(path: string, options: { presentationDirectory?: string } = {}) {
  const inputPath = resolve(path);
  if (!(await lstat(inputPath)).isFile())
    throw new Error("A script must be a regular JSON file, not a symlink");
  const input = await open(
    inputPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let value: unknown;
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size > maximumScriptBytes)
      throw new Error("A script must be a regular JSON file no larger than 1 MiB");
    const bytes = Buffer.alloc(maximumScriptBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await input.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximumScriptBytes) throw new Error("A script must be no larger than 1 MiB");
    value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally {
    await input.close();
  }
  return savePresentation(value, options);
}

export async function savePresentation(
  value: unknown,
  options: { presentationDirectory?: string } = {},
) {
  const validated = await validatePresentationDefinition(value);
  const requestedDirectory = resolve(
    options.presentationDirectory ?? resolve(projectRoot, "content/presentations"),
  );
  if (!(await lstat(requestedDirectory)).isDirectory())
    throw new Error("The presentation directory must be a real directory, not a symlink");
  const directory = await realpath(requestedDirectory);
  if (options.presentationDirectory === undefined) {
    const root = await realpath(projectRoot);
    inside(root, directory);
    if (directory !== resolve(root, "content/presentations"))
      throw new Error("The presentation directory cannot contain symlink redirects");
  }
  const file = inside(directory, resolve(directory, basename(validated.file)));
  const temporary = resolve(directory, `.${basename(file)}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(validated.definition, null, 2)}\n`, {
      flag: "wx",
    });
    // A hard link publishes complete bytes atomically and refuses every existing
    // target, including symlinks, without replacing or opening that target.
    await link(temporary, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `A script already exists for ${validated.selector}; choose a new version name`,
        {
          cause: error,
        },
      );
    throw error;
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return { ...validated, file };
}
