import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { projectRoot } from "../src/paths.js";
import { hash, type Manifest } from "../src/pipeline.js";
import { assertInventory } from "../src/provenance.js";

const exec = promisify(execFile);

test("unregistered CAP models, handlers, and configuration are rejected", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-inventory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(resolve(directory, "db"));
  await writeFile(resolve(directory, "db/schema.cds"), "namespace demo;");
  await assertInventory(directory, ["db/schema.cds"]);
  for (const file of ["db/extra.cds", "handler.js", ".cdsrc.json"]) {
    await writeFile(resolve(directory, file), "additional input");
    await assert.rejects(assertInventory(directory, ["db/schema.cds"]), /Unregistered:/);
    await rm(resolve(directory, file));
  }
});

test("compiled previews identify executed JavaScript and reject extra discovered CAP inputs", {
  timeout: 60000,
}, async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-compiled-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of [
    "src",
    "scripts",
    "schemas",
    "config",
    "templates",
    "content",
    "demos",
    "package.json",
    "package-lock.json",
  ]) {
    await cp(resolve(projectRoot, name), resolve(directory, name), {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules",
    });
  }
  await symlink(resolve(projectRoot, "node_modules"), resolve(directory, "node_modules"), "dir");
  const tsc = resolve(
    dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
    "bin/tsc",
  );
  await exec(
    process.execPath,
    [
      tsc,
      "--project",
      resolve(projectRoot, "tsconfig.json"),
      "--outDir",
      resolve(directory, "dist"),
    ],
    {
      cwd: projectRoot,
      timeout: 30000,
    },
  );
  const sourcePath = resolve(directory, "src/review.ts");
  const source = await readFile(sourcePath, "utf8");
  const marker = "ASTRA_SOURCE_EDIT_AFTER_COMPILATION";
  assert.ok(source.includes("A first look at the story, code, and results."));
  await writeFile(
    sourcePath,
    source.replace("A first look at the story, code, and results.", marker),
  );
  const command = [resolve(directory, "dist/src/cli.js"), "preview", "CAP-01"];
  const { stdout } = await exec(process.execPath, command, { cwd: directory, timeout: 30000 });
  const runDirectory = /^Run: (.+)$/mu.exec(stdout)?.[1];
  assert.ok(runDirectory);
  const manifest: Manifest = JSON.parse(
    await readFile(resolve(runDirectory, "manifest.json"), "utf8"),
  );
  const rendered = await readFile(resolve(runDirectory, "review.html"), "utf8");
  assert.equal(manifest.stage, "PREVIEW_READY");
  assert.ok(!rendered.includes(marker));
  assert.equal(manifest.sourceHashes["src/review.ts"], hash(await readFile(sourcePath)));
  assert.equal(
    manifest.runtimeHashes["dist/src/review.js"],
    hash(await readFile(resolve(directory, "dist/src/review.js"))),
  );
  assert.ok(!manifest.runtimeHashes["src/review.ts"]);
  for (const name of ["api", "media/avatar"]) {
    assert.equal(
      manifest.runtimeHashes[`dist/src/${name}.js`],
      hash(await readFile(resolve(directory, `dist/src/${name}.js`))),
    );
    assert.ok(!manifest.runtimeHashes[`src/${name}.ts`]);
  }

  const extra = resolve(directory, "demos/cap/inventory/db/extra.cds");
  await writeFile(
    extra,
    "using { demo } from './schema';\nannotate demo.Products with @title: 'Unregistered input';\n",
  );
  await assert.rejects(
    exec(process.execPath, command, { cwd: directory, timeout: 30000 }),
    (error: unknown) => {
      const failure = error as { stderr: string };
      return /Unregistered: db\/extra.cds/u.test(failure.stderr);
    },
  );
  const runs = await readdir(resolve(directory, "artifacts"));
  const manifests: Manifest[] = await Promise.all(
    runs.map(async (id) =>
      JSON.parse(await readFile(resolve(directory, "artifacts", id, "manifest.json"), "utf8")),
    ),
  );
  const failed = manifests.find((item) => item.stage === "FAILED");
  assert.ok(failed);
  assert.ok(
    !failed.history.some((entry) => entry.stage === "VERIFYING" || entry.stage === "TECH_VERIFIED"),
  );
});
