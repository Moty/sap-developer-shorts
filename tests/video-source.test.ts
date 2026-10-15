import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { hash } from "../src/digest.js";
import { publishedDemoCommit } from "../src/video/source.js";

const exec = promisify(execFile);

test("public demo links bind published source bytes and keep stable across unrelated commits", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "sap-video-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => exec("git", args, { cwd: root, timeout: 10000 });
  await git("init", "-q", "-b", "main");
  await git("remote", "add", "origin", "https://github.com/Moty/sap-developer-shorts.git");
  const commit = async (name: string, text: string) => {
    await writeFile(resolve(root, name), text);
    await git("add", "--", name);
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Fixture change",
    );
    return (await git("rev-parse", "HEAD")).stdout.trim();
  };
  const first = await commit("demo.txt", "verified source one");
  const firstHashes = { "demo.txt": hash("verified source one") };
  assert.equal(
    await publishedDemoCommit(["demo.txt"], firstHashes, root),
    null,
    "unpublished local commits do not create public links",
  );
  await git("update-ref", "refs/remotes/origin/main", first);
  assert.equal(await publishedDemoCommit(["demo.txt"], firstHashes, root), first);
  await commit("notes.md", "unrelated change");
  assert.equal(await publishedDemoCommit(["demo.txt"], firstHashes, root), first);
  await writeFile(resolve(root, "demo.txt"), "new uncommitted source");
  assert.equal(
    await publishedDemoCommit(["demo.txt"], { "demo.txt": hash("new uncommitted source") }, root),
    null,
  );
  const second = await commit("demo.txt", "verified source two");
  const secondHashes = { "demo.txt": hash("verified source two") };
  assert.equal(await publishedDemoCommit(["demo.txt"], secondHashes, root), null);
  await git("update-ref", "refs/remotes/origin/main", second);
  assert.equal(await publishedDemoCommit(["demo.txt"], secondHashes, root), second);
  await git("remote", "set-url", "origin", "https://github.com/example/different-repo.git");
  assert.equal(await publishedDemoCommit(["demo.txt"], secondHashes, root), null);
});
