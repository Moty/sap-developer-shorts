import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { hash } from "../src/digest.js";
import { publishedDemoCommit } from "../src/video/source.js";

const exec = promisify(execFile);

async function repository(t: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), "sap-video-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => exec("git", args, { cwd: root, timeout: 10000 });
  await git("init", "-q", "-b", "main");
  await git("remote", "add", "origin", "https://github.com/Moty/sap-developer-shorts.git");
  const commit = async (files: Record<string, string | null>) => {
    for (const [name, text] of Object.entries(files)) {
      if (text === null) await rm(resolve(root, name));
      else await writeFile(resolve(root, name), text);
    }
    await git("add", "--all");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Source fixture",
    );
    return (await git("rev-parse", "HEAD")).stdout.trim();
  };
  const publish = (commit: string) => git("update-ref", "refs/remotes/origin/main", commit);
  return { root, git, commit, publish };
}

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

test("historical links find a complete older published snapshot after newer registered files change", async (t) => {
  const repo = await repository(t);
  const files = ["service.cds", "package-lock.json"];
  const oldHashes = { "service.cds": hash("old service"), "package-lock.json": hash("old lock") };
  const first = await repo.commit({
    "service.cds": "old service",
    "package-lock.json": "old lock",
  });
  await repo.publish(first);
  const second = await repo.commit({
    "service.cds": "new service",
    "package-lock.json": "new lock",
  });
  await repo.publish(second);
  assert.equal(await publishedDemoCommit(files, oldHashes, repo.root), first);
  assert.equal(
    await publishedDemoCommit(
      files,
      { "service.cds": hash("new service"), "package-lock.json": hash("new lock") },
      repo.root,
    ),
    second,
  );
  const revert = await repo.commit({
    "service.cds": "old service",
    "package-lock.json": "old lock",
  });
  assert.equal(
    await publishedDemoCommit(files, oldHashes, repo.root),
    first,
    "an unpublished revert must not displace the published snapshot",
  );
  await repo.publish(revert);
  assert.equal(
    await publishedDemoCommit(files, oldHashes, repo.root),
    revert,
    "select the newest matching published tree",
  );
});

test("deleted or not-yet-created candidate paths are skipped without losing a complete historical match", async (t) => {
  const repo = await repository(t);
  await repo.commit({ "service.cds": "service" });
  const complete = await repo.commit({ "data.csv": "products" });
  const deletion = await repo.commit({ "data.csv": null });
  await repo.publish(deletion);
  assert.equal(
    await publishedDemoCommit(
      ["service.cds", "data.csv"],
      { "service.cds": hash("service"), "data.csv": hash("products") },
      repo.root,
    ),
    complete,
  );
  assert.equal(
    await publishedDemoCommit(
      ["service.cds", "never-created.csv"],
      { "service.cds": hash("service"), "never-created.csv": hash("products") },
      repo.root,
    ),
    null,
  );
});

test("history cannot invent a mixed snapshot or link an unpublished matching tree", async (t) => {
  const repo = await repository(t);
  await repo.commit({ "service.cds": "service one", "data.csv": "data one" });
  const second = await repo.commit({ "service.cds": "service two", "data.csv": "data two" });
  await repo.publish(second);
  assert.equal(
    await publishedDemoCommit(
      ["service.cds", "data.csv"],
      { "service.cds": hash("service one"), "data.csv": hash("data two") },
      repo.root,
    ),
    null,
    "matching individual blobs in different commits is insufficient",
  );
  await repo.commit({ "service.cds": "unpublished service", "data.csv": "unpublished data" });
  const unpublished = {
    "service.cds": hash("unpublished service"),
    "data.csv": hash("unpublished data"),
  };
  assert.equal(
    await publishedDemoCommit(["service.cds", "data.csv"], unpublished, repo.root),
    null,
  );
  await repo.git("remote", "set-url", "origin", "https://github.com/example/different-repo.git");
  assert.equal(
    await publishedDemoCommit(
      ["service.cds", "data.csv"],
      { "service.cds": hash("service two"), "data.csv": hash("data two") },
      repo.root,
    ),
    null,
  );
});

test("history search has a finite candidate limit and safely leaves older snapshots unresolved", async (t) => {
  const repo = await repository(t);
  await repo.commit({ "demo.txt": "oldest" });
  let latest = "";
  for (let index = 0; index < 64; index++)
    latest = await repo.commit({ "demo.txt": `change ${index}` });
  await repo.publish(latest);
  assert.equal(
    await publishedDemoCommit(["demo.txt"], { "demo.txt": hash("oldest") }, repo.root),
    null,
  );
  assert.equal(
    await publishedDemoCommit(["demo.txt"], { "demo.txt": hash("change 63") }, repo.root),
    latest,
  );
});
