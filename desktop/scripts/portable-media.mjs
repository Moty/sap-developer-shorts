import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function portableMedia(bin, spec) {
  await exec("/usr/bin/which", ["pkg-config"]).catch(() => {
    throw new Error(
      "Builder prerequisite missing: install pkg-config (Homebrew: brew install pkgconf)",
    );
  });
  const cache = resolve("desktop/vendor-cache");
  const source = resolve(cache, "media-source"),
    prefix = resolve(cache, "x264-prefix");
  const compiler = (await exec("/usr/bin/clang", ["--version"])).stdout;
  const fingerprint = sha(
    JSON.stringify({
      spec,
      compiler,
      buildScript: await readFile(new URL(import.meta.url), "utf8"),
    }),
  );
  const readyPath = resolve(cache, "media-ready.json");
  let ready = JSON.parse(await readFile(readyPath, "utf8").catch(() => "null"));
  const archives = {};
  for (const name of ["ffmpeg", "x264"]) {
    const item = spec[name],
      target = resolve(cache, `${name}-source.tar.gz`);
    let bytes = await readFile(target).catch(() => null);
    if (!bytes || sha(bytes) !== item.sha256) {
      console.log(`Downloading pinned ${name} source…`);
      const r = await fetch(item.url, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error(`${name} source download failed (${r.status})`);
      bytes = Buffer.from(await r.arrayBuffer());
      if (sha(bytes) !== item.sha256) throw new Error(`${name} source checksum mismatch`);
      await writeFile(target, bytes);
    }
    archives[name] = target;
  }
  const env = {
    ...process.env,
    CC: "/usr/bin/clang",
    CXX: "/usr/bin/clang++",
    MACOSX_DEPLOYMENT_TARGET: spec.targetMacOS,
    PKG_CONFIG_LIBDIR: resolve(prefix, "lib/pkgconfig"),
    GIT_CEILING_DIRECTORIES: source,
  };
  for (const key of [
    "CFLAGS",
    "CXXFLAGS",
    "CPPFLAGS",
    "LDFLAGS",
    "LIBRARY_PATH",
    "CPATH",
    "PKG_CONFIG_PATH",
  ])
    delete env[key];
  const run = (binary, args, cwd) =>
    new Promise((done, reject) => {
      const child = spawn(binary, args, { cwd, env, stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? done() : reject(new Error(`${binary} exited ${code}`)),
      );
    });
  const ffmpeg = resolve(source, spec.ffmpeg.directory),
    x264 = resolve(source, spec.x264.directory);
  if (
    ready?.fingerprint !== fingerprint ||
    !(await readFile(resolve(ffmpeg, "ffmpeg"))
      .then((bytes) => sha(bytes) === ready.ffmpeg)
      .catch(() => false)) ||
    !(await readFile(resolve(ffmpeg, "ffprobe"))
      .then((bytes) => sha(bytes) === ready.ffprobe)
      .catch(() => false))
  ) {
    await rm(source, { recursive: true, force: true });
    await rm(prefix, { recursive: true, force: true });
    await mkdir(source, { recursive: true });
    for (const archive of Object.values(archives))
      await run("/usr/bin/tar", ["-xzf", archive, "-C", source], cache);
    await writeFile(resolve(ffmpeg, "VERSION"), `${spec.ffmpeg.version}\n`);
    const flag = `-mmacosx-version-min=${spec.targetMacOS}`;
    console.log(`Building x264 for macOS ${spec.targetMacOS}+…`);
    await run(
      "/bin/sh",
      [
        "configure",
        `--prefix=${prefix}`,
        "--enable-static",
        "--enable-pic",
        "--disable-cli",
        "--disable-opencl",
        `--extra-cflags=${flag}`,
        `--extra-ldflags=${flag}`,
      ],
      x264,
    );
    const jobs = `-j${Math.min(8, availableParallelism())}`;
    await run("/usr/bin/make", [jobs], x264);
    await run("/usr/bin/make", ["install-lib-static"], x264);
    console.log(`Building FFmpeg ${spec.ffmpeg.version} for macOS ${spec.targetMacOS}+…`);
    await run(
      "/bin/sh",
      [
        "configure",
        "--prefix=/usr/local/sap-shorts",
        "--arch=arm64",
        "--cc=/usr/bin/clang",
        "--disable-autodetect",
        "--disable-network",
        "--disable-shared",
        "--enable-static",
        "--disable-doc",
        "--disable-debug",
        "--disable-ffplay",
        "--disable-audiotoolbox",
        "--disable-videotoolbox",
        "--enable-gpl",
        "--enable-version3",
        "--enable-libx264",
        "--enable-zlib",
        `--extra-cflags=${flag}`,
        `--extra-ldflags=${flag}`,
      ],
      ffmpeg,
    );
    await run("/usr/bin/make", [jobs], ffmpeg);
    ready = {
      fingerprint,
      ffmpeg: sha(await readFile(resolve(ffmpeg, "ffmpeg"))),
      ffprobe: sha(await readFile(resolve(ffmpeg, "ffprobe"))),
    };
    await writeFile(readyPath, JSON.stringify(ready));
  }
  const versions = {};
  for (const name of ["ffmpeg", "ffprobe"]) {
    const target = resolve(bin, name);
    await copyFile(resolve(ffmpeg, name), target);
    await chmod(target, 0o755);
    await exec("/usr/bin/codesign", ["--force", "--sign", "-", target]);
    const refs = (await exec("/usr/bin/otool", ["-L", target])).stdout
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(" (compatibility")[0])
      .filter(Boolean);
    if (refs.some((ref) => !ref.startsWith("/usr/lib/") && !ref.startsWith("/System/Library/")))
      throw new Error(`Non-system dependency remains in ${name}`);
    const build = (await exec("/usr/bin/vtool", ["-show-build", target])).stdout;
    if (!build.includes(`minos ${spec.targetMacOS}`))
      throw new Error(`Unexpected minimum macOS target for ${name}`);
    versions[name] = (await exec(target, ["-version"])).stdout.split("\n").slice(0, 3);
    if (!versions[name][0].startsWith(`${name} version ${spec.ffmpeg.version} `))
      throw new Error("Media release version does not match its pinned source");
  }
  const encoders = (await exec(resolve(bin, "ffmpeg"), ["-hide_banner", "-encoders"])).stdout;
  const filters = (await exec(resolve(bin, "ffmpeg"), ["-hide_banner", "-filters"])).stdout;
  if (!encoders.includes("libx264") || !filters.includes("loudnorm"))
    throw new Error("Portable FFmpeg needs libx264 and loudnorm");
  const notices = resolve(bin, "../notices/source");
  await mkdir(notices, { recursive: true });
  for (const name of ["ffmpeg", "x264"])
    await copyFile(archives[name], resolve(notices, `${name}-source.tar.gz`));
  await copyFile(new URL(import.meta.url), resolve(notices, "build-media.mjs"));
  await copyFile(resolve(x264, "COPYING"), resolve(notices, "X264-COPYING.txt"));
  return {
    versions,
    minimumMacOS: spec.targetMacOS,
    sources: spec,
    compiler: compiler.split("\n")[0],
    configuration: "Static CPU build; libx264, zlib, no networking. Only system dynamic libraries.",
  };
}
