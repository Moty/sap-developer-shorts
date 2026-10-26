import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { zipSync } from "fflate";
import { hash } from "./digest.js";
import { supportsKokoroVoice } from "./media/voices.js";
import { projectRoot } from "./paths.js";

const maximumManifestBytes = 1024 * 1024;
const maximumArtifacts = 4096;
const maximumBytes = 512 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^(?:ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}$/u;
const selectorPattern = /^(?:ABAP|CAP|RAP|BTP|AI|NEWS)-\d{2}(?:@[a-z][a-z0-9-]{0,31})?$/u;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const sourceInputs = [
  "templates/library.css",
  "templates/library.js",
  "templates/script-editor.css",
  "templates/script-editor.js",
  "config/production.json",
  "content/topics/backlog.json",
  "content/news/backlog.json",
];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Cannot package saved studio: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value), "invalid manifest object");
  return value as Record<string, unknown>;
}

function shape(value: unknown, required: string[], optional: string[] = []) {
  const result = object(value);
  check(
    required.every((key) => Object.hasOwn(result, key)) &&
      Object.keys(result).every((key) => required.includes(key) || optional.includes(key)),
    "unsupported manifest fields",
  );
  return result;
}

function string(value: unknown, pattern: RegExp, label: string): string {
  check(typeof value === "string" && pattern.test(value), `invalid ${label}`);
  return value;
}

function date(value: unknown): string {
  check(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "invalid manifest date",
  );
  return value;
}

function number(value: unknown, minimum: number, maximum: number): number {
  check(
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum,
    "invalid manifest number",
  );
  return value;
}

function list(value: unknown): unknown[] {
  check(
    Array.isArray(value) && value.length <= maximumArtifacts,
    "invalid manifest list or artifact count",
  );
  return value;
}

function hashes(value: unknown, allowed: (name: string) => boolean): Record<string, string> {
  const entries = Object.entries(object(value));
  check(
    entries.length > 0 && entries.length <= maximumArtifacts,
    "artifact count exceeds 4096 or is empty",
  );
  for (const [name, digest] of entries) {
    check(allowed(name), `unrecognized inventory path: ${name}`);
    string(digest, digestPattern, "artifact digest");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function validateManifest(value: unknown) {
  const manifest = shape(
    value,
    [
      "schemaVersion",
      "kind",
      "builtAt",
      "sourceHashes",
      "runtimeHashes",
      "artifactHashes",
      "excludedRuns",
      "episodePackages",
      "voiceSamples",
      "episodes",
    ],
    ["localOnly"],
  );
  if (Object.hasOwn(manifest, "localOnly"))
    check(manifest.localOnly === true, "invalid local-only marker");
  check(
    manifest.schemaVersion === 1 && manifest.kind === "review-library",
    "unsupported library manifest",
  );
  const builtAt = date(manifest.builtAt);
  check(
    Number.isSafeInteger(manifest.excludedRuns) && (manifest.excludedRuns as number) >= 0,
    "invalid excluded-run count",
  );
  const allowed = new Set(["review.html"]);
  const expectedSources = new Set(sourceInputs);
  for (const name of [
    "templates/voice-profiles.js",
    "templates/local-actions.js",
    "templates/voice-library.css",
    "templates/library-browser.css",
    "templates/library-collections.js",
    "templates/library-navigation.js",
    "templates/presentation.css",
    "templates/presentation.js",
  ])
    if (Object.hasOwn(object(manifest.sourceHashes), name)) expectedSources.add(name);
  const allowPresentation = (prefix: string) => {
    const names = ["presentation.html", "presentation.json", "reveal-LICENSE.txt"].map(
      (name) => prefix + name,
    );
    if (names.some((name) => Object.hasOwn(object(manifest.artifactHashes), name))) {
      check(
        names.every((name) => Object.hasOwn(object(manifest.artifactHashes), name)),
        "incomplete presentation inventory",
      );
      for (const name of names) allowed.add(name);
    }
  };
  const episodes = new Map<string, { version: number; renderKey?: string }>();
  let videoCount = 0;
  for (const value of list(manifest.episodes)) {
    const episode = shape(
      value,
      ["id", "selector", "version", "inputHash", "sourceReviewExpired", "preview"],
      ["video", "localOnly", "generation"],
    );
    if (Object.hasOwn(episode, "generation")) {
      const summary = shape(
        episode.generation,
        ["totalMs", "basis", "reusedAudio", "reusedVideo"],
        ["stages"],
      );
      number(summary.totalMs, 0, Number.MAX_SAFE_INTEGER);
      check(
        ["generation", "legacy-run"].includes(String(summary.basis)),
        "invalid generation timing basis",
      );
      check(
        typeof summary.reusedAudio === "boolean" && typeof summary.reusedVideo === "boolean",
        "invalid generation reuse flags",
      );
      if (summary.basis === "generation")
        check(Object.hasOwn(summary, "stages"), "missing generation stage timings");
      if (Object.hasOwn(summary, "stages")) {
        const stages = shape(summary.stages, ["preparationMs", "audioMs", "videoMs"]);
        for (const elapsed of Object.values(stages)) number(elapsed, 0, summary.totalMs as number);
      }
    }
    if (Object.hasOwn(episode, "localOnly"))
      check(episode.localOnly === true, "invalid local-only marker");
    const id = string(episode.id, idPattern, "episode ID");
    const selector = string(episode.selector, selectorPattern, "episode selector");
    check(
      selector.split("@")[0] === id && !episodes.has(selector),
      "duplicate or mismatched episode selector",
    );
    const version = number(episode.version, 1, Number.MAX_SAFE_INTEGER);
    check(Number.isInteger(version), "invalid episode version");
    string(episode.inputHash, digestPattern, "episode input digest");
    check(typeof episode.sourceReviewExpired === "boolean", "invalid source-review state");
    const entry: { version: number; renderKey?: string } = { version };
    episodes.set(selector, entry);
    expectedSources.add(`content/episodes/${id}.json`);
    if (selector.includes("@"))
      expectedSources.add(`content/presentations/${selector.replace("@", "--")}.json`);
    const prefix = `episodes/${selector}/`;
    allowed.add(`${prefix}edit.html`);
    allowPresentation(prefix);
    if (episode.preview === null) {
      check(!Object.hasOwn(episode, "video"), "video without a preview");
      continue;
    }
    const preview = shape(episode.preview, [
      "kind",
      "sourceRunId",
      "sourceManifestHash",
      "mediaJobId",
      "durationSeconds",
      "timingReady",
    ]);
    check(preview.kind === "storyboard" || preview.kind === "narrated", "invalid preview kind");
    const runId = string(preview.sourceRunId, /^[A-Za-z0-9-]+$/u, "source run ID");
    check(
      runId.startsWith(`${id}-v${version}-`) &&
        uuidPattern.test(runId.slice(`${id}-v${version}-`.length)),
      "source run does not match episode",
    );
    string(preview.sourceManifestHash, digestPattern, "source manifest digest");
    const duration = number(preview.durationSeconds, Number.MIN_VALUE, 3600);
    check(typeof preview.timingReady === "boolean", "invalid timing readiness");
    allowed.add(`${prefix}review.html`);
    allowed.add(`${prefix}watch.html`);
    if (preview.kind === "storyboard") {
      check(
        preview.mediaJobId === null &&
          preview.timingReady === false &&
          !Object.hasOwn(episode, "video"),
        "storyboard cannot claim recorded media",
      );
    } else {
      string(preview.mediaJobId, uuidPattern, "media job ID");
      for (const name of ["narration.wav", "timing.json", "captions.vtt"])
        allowed.add(prefix + name);
    }
    if (Object.hasOwn(episode, "video")) {
      const video = shape(episode.video, ["renderKey", "durationSeconds"]);
      entry.renderKey = string(video.renderKey, digestPattern, "render key");
      const videoDuration = number(video.durationSeconds, 45, 60.1);
      check(
        preview.kind === "narrated" &&
          preview.timingReady === true &&
          Math.abs(videoDuration - duration) <= 0.1 + 1e-9,
        "video and narration readiness differ",
      );
      for (const name of [
        "short.mp4",
        "poster.png",
        "review.html",
        "captions.vtt",
        "timing.json",
        "publication-draft.txt",
      ])
        allowed.add(`${prefix}video/${name}`);
      allowPresentation(`${prefix}video/`);
      videoCount++;
      // Older saved libraries predate the review-and-publication screen.
      if (Object.hasOwn(object(manifest.artifactHashes), `${prefix}publish.html`))
        allowed.add(`${prefix}publish.html`);
    }
  }
  const packages = new Map<string, string>();
  for (const value of list(manifest.episodePackages)) {
    const item = shape(value, ["selector", "filename", "sha256"]);
    const selector = string(item.selector, selectorPattern, "package selector");
    const episode = episodes.get(selector);
    check(episode?.renderKey && !packages.has(selector), "duplicate or unmatched episode package");
    check(
      item.filename ===
        `${selector.replace("@", "--")}-v${episode.version}-${episode.renderKey.slice(0, 8)}.zip`,
      "episode package filename differs",
    );
    const digest = string(item.sha256, digestPattern, "episode package digest");
    packages.set(selector, digest);
    allowed.add(`episodes/${selector}/episode-package.zip`);
  }
  check(packages.size === videoCount, "every video needs its matching episode package");
  const samples = new Map<string, string>();
  for (const value of list(manifest.voiceSamples)) {
    const sample = shape(value, ["key", "identity", "audioHash", "durationSeconds"]);
    const key = string(sample.key, digestPattern, "voice sample key");
    check(!samples.has(key), "duplicate voice sample");
    const identity = shape(sample.identity, [
      "schemaVersion",
      "kind",
      "text",
      "pronunciation",
      "voice",
      "speed",
      "voiceRuntimeHash",
      "generatorHash",
    ]);
    check(
      identity.schemaVersion === 1 &&
        identity.kind === "kokoro-voice-sample" &&
        typeof identity.text === "string" &&
        identity.text.length > 0 &&
        identity.text.length <= 10000 &&
        typeof identity.voice === "string" &&
        supportsKokoroVoice(identity.voice),
      "invalid voice identity",
    );
    for (const [key, value] of Object.entries(object(identity.pronunciation)))
      check(
        key.length > 0 && typeof value === "string" && value.length > 0,
        "invalid sample pronunciation",
      );
    number(identity.speed, 0.8, 1.2);
    string(identity.voiceRuntimeHash, digestPattern, "voice runtime digest");
    string(identity.generatorHash, digestPattern, "voice generator digest");
    check(hash(JSON.stringify(identity)) === key, "voice sample key differs from identity");
    number(sample.durationSeconds, Number.MIN_VALUE, 120);
    samples.set(key, string(sample.audioHash, digestPattern, "voice audio digest"));
    allowed.add(`voices/${key}/sample.wav`);
  }
  const artifacts = hashes(manifest.artifactHashes, (name) => allowed.has(name));
  check(
    Object.keys(artifacts).length === allowed.size,
    "missing required studio inventory entries",
  );
  for (const [selector, digest] of packages)
    check(
      artifacts[`episodes/${selector}/episode-package.zip`] === digest,
      "episode package hash differs from inventory",
    );
  for (const [key, digest] of samples)
    check(
      artifacts[`voices/${key}/sample.wav`] === digest,
      "voice sample hash differs from inventory",
    );
  const sources = hashes(manifest.sourceHashes, (name) => expectedSources.has(name));
  check(Object.keys(sources).length === expectedSources.size, "missing source provenance entries");
  hashes(
    manifest.runtimeHashes,
    (name) =>
      /^(?:src|dist\/src)\/(?:[a-z][a-z0-9-]*\/)*[a-z][a-z0-9-]*\.(?:ts|js|py)$/u.test(name) ||
      [
        "config/qwen-voice.json",
        "config/qwen-voice-requirements.txt",
        "schemas/narration-timing-v2.schema.json",
        "config/neural-voice.json",
        "config/neural-voice-requirements.txt",
        "scripts/setup-portrait.py",
        "config/portrait-runtime.json",
        "config/portrait-requirements.txt",
        "config/talking-head.json",
        "config/talking-head-requirements.txt",
      ].includes(name),
  );
  return {
    builtAt,
    artifacts,
    episodeCount: episodes.size,
    videoCount,
    episodePackageCount: packages.size,
    voiceSampleCount: samples.size,
  };
}

async function noSymlinks(path: string, missingAllowed = false): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  const parts = relative(current, absolute).split(sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    let info: Stats;
    try {
      info = await lstat(current);
    } catch (error) {
      if (missingAllowed && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    check(
      !info.isSymbolicLink() && (index === parts.length - 1 || info.isDirectory()),
      "symlink or non-directory path component",
    );
  }
}

async function inspect(path: string): Promise<Stats> {
  await noSymlinks(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    check(info.isFile() && Number.isSafeInteger(info.size), "artifact is not a regular file");
    return info;
  } finally {
    await file.close();
  }
}

function unchanged(before: Stats, after: Stats) {
  return (
    after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

async function readExact(path: string, before: Stats, limit: number): Promise<Buffer> {
  check(before.size <= limit, "file exceeds supported size limit");
  await noSymlinks(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    check(unchanged(before, await file.stat()), "file changed before packaging");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      check(result.bytesRead > 0, "file shortened while packaging");
      offset += result.bytesRead;
    }
    const extra = await file.read(Buffer.alloc(1), 0, 1, offset);
    check(
      extra.bytesRead === 0 && unchanged(before, await file.stat()),
      "file changed while packaging",
    );
    return bytes;
  } finally {
    await file.close();
  }
}

function within(root: string, candidate: string) {
  const child = relative(root, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

export async function packageLibrary(
  libraryDirectory: string,
  options: { artifactRoot?: string; now?: Date } = {},
) {
  const packagedAt = date((options.now ?? new Date()).toISOString());
  const requestedSource = resolve(libraryDirectory);
  await noSymlinks(requestedSource);
  check((await lstat(requestedSource)).isDirectory(), "studio must be a directory");
  const source = await realpath(requestedSource);
  const output = resolve(
    projectRoot,
    options.artifactRoot ?? process.env.SHORTS_ARTIFACT_DIR ?? "artifacts",
  );
  await noSymlinks(output, true);
  check(!within(source, output), "output must be outside the saved studio");
  const manifestPath = resolve(source, "library-manifest.json");
  const original = await readExact(manifestPath, await inspect(manifestPath), maximumManifestBytes);
  const value: unknown = JSON.parse(original.toString("utf8"));
  check(
    original.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`)),
    "manifest must use canonical saved-library JSON without duplicate keys",
  );
  const saved = validateManifest(value);
  check(saved.builtAt <= packagedAt, "library build date is after packaging date");
  const readme = Buffer.from(
    `SAP Shorts — saved review studio\n\nExtract the whole archive. Open studio/review.html to review the saved studio. If your browser restricts local media or downloads, serve the studio folder locally. With this project installed: npm run shorts -- serve /path/to/extracted/studio\n\nLibrary built: ${saved.builtAt}\nPackaged: ${packagedAt}\n${saved.episodeCount} scripts; ${saved.videoCount} saved MP4 exports; ${saved.episodePackageCount} episode ZIP downloads; ${saved.voiceSampleCount} voice samples.\n\nThis is an exact saved snapshot, not a new production or source review. News source-review dates and build-time labels remain unchanged. Recheck official sources before sharing any current news. Tutorial verification refers to its saved local demo.\n\nAI-generated narration and local presenters. Companion posts are drafts. Running the current local studio supports Save draft and manual publication records; static copies cannot save edits or claim live publication status. Review/publication state is stored separately on the working Mac and is not part of this ZIP. Snapshots that offer draft recovery can resume edits after a reload in the same tab and address where browser storage is available. Closing the tab, changing the address, or browser restrictions may lose recovery. Download the revised JSON to keep a portable copy. Importing or producing a revision requires the original project, a matching current base, and the selected local voices. The project, model assets, job database, and production credentials are not included.\n\nThe original studio/library-manifest.json records saved media and provenance hashes. The separate package-manifest.json receipt is available alongside the ZIP on its download page; it is not inside this archive. Checksums are not a signature or a renewed factual review.\n`,
  );
  const inventory = new Map<string, Stats>();
  let total = original.length + readme.length;
  for (const name of Object.keys(saved.artifacts).sort()) {
    const info = await inspect(resolve(source, name));
    total += info.size;
    check(total <= maximumBytes, "archive input exceeds 512 MiB");
    inventory.set(name, info);
  }
  const members: Record<string, Uint8Array> = {
    "README.txt": readme,
    "studio/library-manifest.json": original,
  };
  const memberHashes: Record<string, string> = {
    "README.txt": hash(readme),
    "studio/library-manifest.json": hash(original),
  };
  for (const [name, info] of inventory) {
    const bytes = await readExact(resolve(source, name), info, maximumBytes);
    check(hash(bytes) === saved.artifacts[name], `artifact digest differs: ${name}`);
    members[`studio/${name}`] = bytes;
    memberHashes[`studio/${name}`] = hash(bytes);
  }
  const archive = Buffer.from(zipSync(members, { level: 0, mtime: new Date(2000, 0, 1) }));
  const sourceManifestHash = hash(original);
  const page = Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Download saved studio · SAP Shorts</title><style>*{box-sizing:border-box}body{margin:0;background:#102b34;color:#edf6ed;font:18px/1.6 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:clamp(24px,6vw,64px)}small{color:#b9cec8}h1{font-size:clamp(32px,7vw,52px);line-height:1.15}a{color:#c7ebcb}a:focus-visible{outline:3px solid #edcb7c;outline-offset:5px}.download{display:inline-block;background:#c7ebcb;color:#102b34;padding:14px 22px;border-radius:10px;font-weight:700;text-decoration:none}.facts{padding:20px;border:1px solid #52746e;border-radius:12px}.note{color:#d6e5df}code{overflow-wrap:anywhere;font-size:15px}</style></head><body><main><small>SAP SHORTS · PORTABLE REVIEW</small><h1>Take the whole studio with you.</h1><p>Compare the saved deliveries, watch the videos, and keep their episode downloads together.</p><p><a class="download" href="studio.zip" download="sap-shorts-studio.zip">Download studio ZIP · ${(archive.length / 1024 / 1024).toFixed(1)} MiB</a></p><p class="facts">${saved.episodeCount} scripts · ${saved.videoCount} saved MP4s · ${saved.episodePackageCount} episode ZIPs · ${saved.voiceSampleCount} voice samples</p><p>Extract the whole ZIP, then open <code>studio/review.html</code>. Serve that folder locally if your browser restricts local media. Read <code>README.txt</code> for editing and production requirements.</p><p class="note"><strong>Saved snapshot — recheck news sources.</strong> Original source-review dates and build-time labels are preserved. Packaging does not renew factual verification. AI narration and local presenters. Companion posts are drafts; live approval and publication records are not included in this snapshot.</p><p><small>Studio built ${saved.builtAt}<br>Packaged ${packagedAt}</small></p><p><a href="package-manifest.json" download>Download integrity receipt</a></p></main></body></html>`,
  );
  const manifest = {
    schemaVersion: 1 as const,
    kind: "library-package" as const,
    packagedAt,
    libraryBuiltAt: saved.builtAt,
    sourceManifestHash,
    episodeCount: saved.episodeCount,
    videoCount: saved.videoCount,
    episodePackageCount: saved.episodePackageCount,
    voiceSampleCount: saved.voiceSampleCount,
    sourceReviewRenewed: false,
    published: false,
    stockAvatar: "pending" as const,
    archive: {
      filename: "studio.zip",
      sha256: hash(archive),
      bytes: archive.length,
      inputBytes: total,
    },
    memberHashes,
    artifactHashes: { "studio.zip": hash(archive), "review.html": hash(page) },
  };
  await mkdir(output, { recursive: true });
  await noSymlinks(output);
  check(!within(source, await realpath(output)), "output must be outside the saved studio");
  const id = `library-package-${randomUUID()}`;
  const temporary = resolve(output, `.${id}`);
  const directory = resolve(output, id);
  await mkdir(temporary);
  try {
    await writeFile(resolve(temporary, "studio.zip"), archive, { flag: "wx" });
    await writeFile(resolve(temporary, "review.html"), page, { flag: "wx" });
    await writeFile(
      resolve(temporary, "package-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );
    await rename(temporary, directory);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { directory, manifest };
}
