import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hash } from "../digest.js";
import { projectRoot } from "../paths.js";

const exec = promisify(execFile);
const historyLimit = 64;
const lookupBudgetMs = 10000;

export async function publishedDemoCommit(
  files: readonly string[],
  sourceHashes: Record<string, string>,
  root = projectRoot,
): Promise<string | null> {
  if (!files.length || files.some((name) => !/^[a-f0-9]{64}$/u.test(sourceHashes[name] ?? "")))
    return null;
  const deadline = performance.now() + lookupBudgetMs;
  const options = () => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) throw new Error("Published demo lookup budget exhausted");
    return { cwd: root, timeout: Math.min(5000, remaining) };
  };
  try {
    const remote = (await exec("git", ["remote", "get-url", "origin"], options())).stdout.trim();
    if (
      !/^(?:https:\/\/github\.com\/|git@github\.com:)Moty\/sap-developer-shorts(?:\.git)?$/iu.test(
        remote,
      )
    )
      return null;
    const candidates = (
      await exec("git", ["log", `-${historyLimit}`, "--format=%H", "--", ...files], options())
    ).stdout
      .trim()
      .split("\n");
    for (const commit of candidates) {
      if (!/^[a-f0-9]{40}$/u.test(commit)) continue;
      const trackingRefs = (
        await exec(
          "git",
          ["for-each-ref", `--contains=${commit}`, "--format=%(refname)", "refs/remotes/origin/"],
          options(),
        )
      ).stdout.trim();
      if (!trackingRefs) continue;
      let matches = true;
      for (const name of files) {
        try {
          const committed = await exec("git", ["show", `${commit}:${name}`], {
            ...options(),
            encoding: "buffer",
          });
          if (hash(committed.stdout) !== sourceHashes[name]) {
            matches = false;
            break;
          }
        } catch {
          // A path may not exist in this historical tree. Only a complete matching tree qualifies.
          matches = false;
          break;
        }
      }
      if (matches) return commit;
    }
    return null;
  } catch {
    return null;
  }
}
