import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(repo);
const release = process.argv.includes("--release");
if (
  release &&
  (!process.env.DESKTOP_SIGN_IDENTITY ||
    !process.env.DESKTOP_NOTARY_PROFILE ||
    process.env.DESKTOP_REDISTRIBUTION_REVIEWED !== "1")
)
  throw new Error(
    "Public packaging requires a Developer ID identity, a notary Keychain profile, and a completed third-party redistribution review. See docs/MAC_DESKTOP.md.",
  );
const env = { ...process.env, DESKTOP_RELEASE: release ? "1" : "0" };
const run = (binary, args, cwd = repo) =>
  new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? done() : reject(new Error(`${binary} exited ${code}`)),
    );
  });
if (!process.argv.includes("--skip-prepare"))
  await run(process.execPath, ["desktop/scripts/prepare.mjs"]);
await run(
  process.execPath,
  [
    "node_modules/@electron-forge/cli/dist/electron-forge.js",
    "package",
    "--platform=darwin",
    "--arch=arm64",
  ],
  resolve("desktop"),
);
const output = resolve("desktop/out"),
  staging = resolve(output, "dmg-stage");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
const app = resolve(output, "SAP Shorts-darwin-arm64/SAP Shorts.app");
await run("/usr/bin/ditto", [app, resolve(staging, "SAP Shorts.app")]);
await symlink("/Applications", resolve(staging, "Applications"));
await copyFile("docs/MAC_DESKTOP.md", resolve(staging, "Read me first.md"));
const version = JSON.parse(await readFile("desktop/package.json", "utf8")).version;
const dmg = resolve(output, `SAP-Shorts-${version}-arm64${release ? "" : "-local-test"}.dmg`);
await rm(dmg, { force: true });
await run("/usr/bin/hdiutil", [
  "create",
  "-volname",
  "SAP Shorts",
  "-srcfolder",
  staging,
  "-ov",
  "-format",
  "UDZO",
  dmg,
]);
if (release) {
  await run("/usr/bin/codesign", ["--sign", process.env.DESKTOP_SIGN_IDENTITY, "--timestamp", dmg]);
  await run("/usr/bin/xcrun", [
    "notarytool",
    "submit",
    dmg,
    "--keychain-profile",
    process.env.DESKTOP_NOTARY_PROFILE,
    "--wait",
  ]);
  await run("/usr/bin/xcrun", ["stapler", "staple", dmg]);
  await run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose", app]);
}
await run("/usr/bin/hdiutil", ["verify", dmg]);
const bytes = await readFile(dmg),
  digest = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${dmg}.sha256`, `${digest}  ${dmg.split("/").at(-1)}\n`);
await writeFile(
  resolve(output, "build-report.json"),
  JSON.stringify(
    {
      version,
      release,
      signed: release,
      notarized: release,
      app,
      dmg,
      sha256: digest,
      bytes: bytes.length,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  `\n${release ? "Signed and notarized" : "LOCAL TEST ONLY (no Developer ID signature/notarization)"}: ${dmg}`,
);
