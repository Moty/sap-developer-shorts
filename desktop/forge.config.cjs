const { resolve } = require("node:path");
const manifest = require("./payload/manifest.json");
const release = process.env.DESKTOP_RELEASE === "1";
if (release && (!process.env.DESKTOP_SIGN_IDENTITY || !process.env.DESKTOP_NOTARY_PROFILE))
  throw new Error("A public release requires DESKTOP_SIGN_IDENTITY and DESKTOP_NOTARY_PROFILE");
module.exports = {
  packagerConfig: {
    name: "SAP Shorts",
    executableName: "SAP Shorts",
    appBundleId: "com.sapdevelopershorts.studio",
    appCategoryType: "public.app-category.video",
    asar: true,
    icon: resolve(__dirname, "payload/app.icns"),
    darwinDarkModeSupport: true,
    appVersion: manifest.version,
    extraResource: [resolve(__dirname, "payload")],
    // Keep build tooling and all development dependency trees outside the application archive.
    ignore: (path) =>
      !["", "/package.json", "/main.cjs", "/preload.cjs", "/core.cjs", "/ui"].includes(path) &&
      !path.startsWith("/ui/"),
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Record a voice sample that you choose to use for local narration.",
      NSHighResolutionCapable: true,
      LSMinimumSystemVersion: manifest.minimumMacOS || "13.0",
    },
    ...(release
      ? {
          osxSign: {
            identity: process.env.DESKTOP_SIGN_IDENTITY,
            hardenedRuntime: true,
            optionsForFile: () => ({ entitlements: resolve(__dirname, "entitlements.plist") }),
          },
          osxNotarize: { keychainProfile: process.env.DESKTOP_NOTARY_PROFILE },
        }
      : {}),
  },
  rebuildConfig: { onlyModules: [] },
  makers: [{ name: "@electron-forge/maker-zip", platforms: ["darwin"] }],
};
