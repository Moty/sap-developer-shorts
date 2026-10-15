import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hash } from "../digest.js";
import { projectRoot } from "../paths.js";

const exec = promisify(execFile);

export async function publishedDemoCommit(
  files: readonly string[],
  sourceHashes: Record<string, string>,
  root = projectRoot,
): Promise<string | null> {
  if (!files.length) return null;
  try {
    const remote = (
      await exec("git", ["remote", "get-url", "origin"], { cwd: root, timeout: 5000 })
    ).stdout.trim();
    if (
      !/^(?:https:\/\/github\.com\/|git@github\.com:)Moty\/sap-developer-shorts(?:\.git)?$/iu.test(
        remote,
      )
    )
      return null;
    const commit = (
      await exec("git", ["log", "-1", "--format=%H", "--", ...files], { cwd: root, timeout: 5000 })
    ).stdout.trim();
    if (!/^[a-f0-9]{40}$/u.test(commit)) return null;
    const trackingRefs = (
      await exec(
        "git",
        ["for-each-ref", `--contains=${commit}`, "--format=%(refname)", "refs/remotes/origin/"],
        { cwd: root, timeout: 5000 },
      )
    ).stdout.trim();
    if (!trackingRefs) return null;
    for (const name of files) {
      const committed = await exec("git", ["show", `${commit}:${name}`], {
        cwd: root,
        timeout: 5000,
        encoding: "buffer",
      });
      if (hash(committed.stdout) !== sourceHashes[name]) return null;
    }
    return commit;
  } catch {
    return null;
  }
}
