import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { portableMedia } from "./portable-media.mjs";

const exec = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(repo);
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Build the desktop payload on an Apple Silicon Mac");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) throw new Error("Build with Node 22.13 or newer");
const tools = JSON.parse(await readFile("desktop/tools.json", "utf8"));
const payload = resolve("desktop/payload"),
  cache = resolve("desktop/vendor-cache");
await mkdir(cache, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function checkedDownload(spec, name) {
  const target = resolve(cache, name);
  let bytes = await readFile(target).catch(() => null);
  if (!bytes || sha(bytes) !== spec.sha256) {
    console.log(`Downloading ${name}…`);
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`${name} download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== spec.sha256) throw new Error(`${name} checksum mismatch`);
    await writeFile(target, bytes);
  }
  const destination = resolve(cache, spec.directory);
  await exec("/usr/bin/tar", ["-xzf", target, "-C", cache]);
  return destination;
}
console.log("Building the application backend…");
await exec("npm", ["run", "build"], { maxBuffer: 4 * 1024 * 1024 });
for (const directory of ["desktop", "desktop/backend"]) {
  console.log(`Installing locked build dependencies: ${directory}`);
  await exec("npm", ["ci", "--prefix", directory], { maxBuffer: 8 * 1024 * 1024 });
}
// Electron 45 provides an explicit binary installer rather than a postinstall hook.
await exec(process.execPath, ["desktop/node_modules/electron/install.js"], {
  timeout: 300000,
  maxBuffer: 4 * 1024 * 1024,
});
await rm(payload, { recursive: true, force: true });
await mkdir(resolve(payload, "bin"), { recursive: true });
await mkdir(resolve(payload, "seed"), { recursive: true });
await mkdir(resolve(payload, "notices"), { recursive: true });
const node = await checkedDownload(tools.node, "node.tar.gz"),
  uv = await checkedDownload(tools.uv, "uv.tar.gz");
await copyFile(resolve(node, "bin/node"), resolve(payload, "bin/node"));
await copyFile(resolve(node, "LICENSE"), resolve(payload, "notices/NODE-LICENSE.txt"));
await copyFile(resolve(uv, "uv"), resolve(payload, "bin/uv"));
const uvLicense = await fetch(
  `https://raw.githubusercontent.com/astral-sh/uv/${tools.uv.version}/LICENSE-MIT`,
);
if (!uvLicense.ok) throw new Error("UV license could not be retrieved");
await writeFile(resolve(payload, "notices/UV-LICENSE-MIT.txt"), await uvLicense.text());
await exec(
  "/usr/bin/xcrun",
  [
    "swiftc",
    "scripts/private/keychain.swift",
    "-target",
    "arm64-apple-macos13.0",
    "-O",
    "-o",
    resolve(payload, "bin/keychain"),
  ],
  { timeout: 120000 },
);
for (const name of ["node", "uv", "keychain"]) await chmod(resolve(payload, "bin", name), 0o755);
await writeFile(
  resolve(payload, "bin/python3"),
  '#!/bin/sh\nexec "$(dirname "$0")/uv" run --no-project --python 3.12 python "$@"\n',
  { mode: 0o755 },
);
console.log("Bundling portable FFmpeg and all non-system library dependencies…");
const media = await portableMedia(resolve(payload, "bin"), tools.media);
await copyFile("desktop/tools.json", resolve(payload, "notices/source/tools.json"));
await writeFile(
  resolve(payload, "notices/source/BUILD.txt"),
  `Corresponding media source for this build\n\nPrerequisites on an Apple Silicon builder: Node 22.13+, Xcode Command Line Tools, pkg-config, make.\nThe source tarballs and exact checksums/revisions are included beside this file.\n\nFrom this directory:\n  mkdir -p media-build/bin media-build/desktop/vendor-cache\n  cp ffmpeg-source.tar.gz x264-source.tar.gz media-build/desktop/vendor-cache/\n  cd media-build\n  node --input-type=module -e 'import{mkdir,readFile}from"node:fs/promises";import{resolve}from"node:path";import{portableMedia}from"../build-media.mjs";await mkdir("bin",{recursive:true});await portableMedia(resolve("bin"),JSON.parse(await readFile("../tools.json","utf8")).media)'\n\nThe build disables networking in FFmpeg, links x264 statically, targets macOS 13.0, and uses only system dynamic libraries. Compiler/SDK differences can change binary hashes.\n`,
);
await writeFile(
  resolve(payload, "notices/media-build.json"),
  `${JSON.stringify(media, null, 2)}\n`,
);
await cp("desktop/backend/node_modules", resolve(payload, "node_modules"), {
  recursive: true,
  dereference: true,
});
await copyFile(
  "desktop/backend/package-lock.json",
  resolve(payload, "notices/backend-package-lock.json"),
);
const tracked = (await exec("git", ["ls-files", "-z"])).stdout.split("\0").filter(Boolean);
const templates = new Set([
  "CAP-01--casual-v2.json",
  "CAP-01--casual.json",
  "CAP-01--comic.json",
  "CAP-01--countdown.json",
  "CAP-01--duo.json",
  "CAP-01--feed-pop.json",
  "CAP-02--quiz.json",
  "NEWS-02--duo.json",
  "NEWS-02--myth-fact.json",
]);
const files = [];
async function add(name, bytes, policy) {
  const target = resolve(payload, "seed", name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  files.push({ path: name, sha256: sha(bytes), policy });
}
for (const name of tracked) {
  const fixed =
    /^(schemas\/|templates\/|prompts\/|src\/|scripts\/setup-portrait\.py$|scripts\/private\/keychain\.swift$|assets\/fonts\/|docs\/)/u.test(
      name,
    ) || ["package.json", "package-lock.json", "LICENSE"].includes(name);
  const config =
    /^config\/[^/]+\.(?:json|txt|in)$/u.test(name) && !/worker-files|private/u.test(name);
  const content =
    /^content\/(episodes|news|topics)\/[^/]+\.json$/u.test(name) ||
    (name.startsWith("content/presentations/") && templates.has(name.split("/").at(-1)));
  const demo = name.startsWith("demos/cap/inventory/") && !name.includes("node_modules");
  if (!fixed && !config && !content && !demo) continue;
  // Editorial/user data always comes from committed public source, never from local drafts.
  const bytes =
    content || name === "config/production.json"
      ? Buffer.from(
          (
            await exec("git", ["show", `HEAD:${name}`], {
              encoding: "buffer",
              maxBuffer: 8 * 1024 * 1024,
            })
          ).stdout,
        )
      : await readFile(name);
  if (name.startsWith("content/presentations/")) {
    const value = JSON.parse(bytes);
    if (
      value.presentation?.speakers.some(
        (speaker) => typeof speaker.voice !== "string" || speaker.avatar,
      )
    )
      throw new Error(`Desktop template contains personal media: ${name}`);
  }
  await add(name, bytes, content || name === "config/production.json" ? "seed" : "runtime");
}
async function tree(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await tree(resolve(directory, entry.name), `${prefix}/${entry.name}`);
    else if (entry.isFile())
      await add(
        `${prefix}/${entry.name}`,
        await readFile(resolve(directory, entry.name)),
        "runtime",
      );
  }
}
await tree(resolve("dist/src"), "dist/src");
for (const name of ["core.cjs", "runner.cjs", "engine.cjs", "phonemes.cjs"])
  await add(`desktop-runtime/${name}`, await readFile(resolve("desktop", name)), "runtime");
await add(
  "config/worker-files.json",
  Buffer.from(JSON.stringify(files.map((file) => file.path))),
  "runtime",
);
const version = JSON.parse(await readFile("desktop/package.json", "utf8")).version;
const revision = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
const manifest = {
  schemaVersion: 1,
  version,
  revision,
  distribution: process.env.DESKTOP_RELEASE === "1" ? "signed-release" : "local-test",
  tools,
  media: media.versions,
  minimumMacOS: media.minimumMacOS,
  files,
};
await writeFile(resolve(payload, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile("LICENSE", resolve(payload, "notices/APP-LICENSE.txt"));
await copyFile("assets/fonts/LICENSE_DEJAVU", resolve(payload, "notices/FONTS-LICENSE.txt"));
const ffmpegLicense = await fetch(
  "https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/COPYING.GPLv3",
);
if (!ffmpegLicense.ok) throw new Error("FFmpeg license could not be retrieved");
await writeFile(resolve(payload, "notices/FFMPEG-GPLv3.txt"), await ffmpegLicense.text());
await writeFile(
  resolve(payload, "notices/README.txt"),
  "Local test distribution. This FFmpeg build enables GPL components including libx264. media-build.json records the build and bundled libraries. Before public distribution, complete the third-party notices/corresponding-source inventory and review auxiliary portrait-model terms. Optional models are not bundled. No private voices, portraits, worker credentials or local drafts are supplied.\n",
);
await import("./icon.mjs");
console.log(`Desktop payload ready: ${payload} (${files.length} verified files)`);
