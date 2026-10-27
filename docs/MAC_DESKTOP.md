# Mac desktop app and DMG

The desktop edition packages the local studio in an Electron app. It includes a
compatible Node runtime, FFmpeg/FFprobe with their non-system libraries, uv, the
backend's locked npm dependencies, presentation renderer, public scripts, and a
compiled macOS Keychain helper. Recipients do not install Homebrew, Git, Node,
npm, Python or Xcode separately.

## Install and use

Open the DMG, drag **SAP Shorts.app** into **Applications**, eject the image and
open the app. The setup window prepares a separate desktop workspace. Choose
**Open creator studio** to edit scripts and explore presentations immediately.
Install **Stock narration** to produce a video. The supplied voices include Heart
(the default) and Michael. **Make a sample video** produces `CAP-01@feed-pop`.

Engine downloads require internet access and available disk space. uv manages
Python 3.12 and separate pinned Python environments; the existing engine installers
download and verify their model assets. Qwen is optional (5.42 GiB of model files,
plus its environment). Ditto portraits are optional (2.32 GB, plus their environment).
Photo alignment is a separate small model. Once installed, generation runs locally.
A private temporary shortcut gives the phoneme engine a short data path; it contains
no voice recordings and is removed when the backend exits normally. Stock-voice
setup checks this lookup before completing.
The first edition is an online setup installer; a fully offline model-pack edition
is not implemented.

Use **Rendering engine** to enter your studio's HTTPS origin and a device name.
Use **Open online studio** and approve the displayed pairing code in your signed-in
workspace, then start the worker. Run one worker per physical Mac; stop a source-checkout
worker before starting the desktop worker. The worker uses the desktop app's installed models. No cloud project,
Firebase administrator credential or paid rendering is configured by installation.

Closing a window keeps work running. Use the app menu to return to setup, reopen
the studio, or quit. Active local jobs keep the Mac from idle system sleep while
the app is running. This cannot override a closed laptop lid, shutdown or forced
sleep. Quitting interrupts work; follow the saved production status to recover.

## Data and upgrades

The default data directory is:

```
~/Library/Application Support/SAP Shorts/Desktop/
```

It contains `workspace/` (content, private models, recordings, photos and generated
videos), `python/`, `cache/`, `phonemes/`, `worker/`, `shell/` and `backend.log`. **Open app data**
reveals it in Finder. Credentials are saved in macOS Keychain; desktop worker
configuration is separate from a source-checkout worker. No private local data is
included in the installer. Even tracked portrait images are excluded from the
public seed list.

The packaged program and template files are copied from a checksummed manifest
into the managed workspace. Application code is repaired/refreshed on launch;
existing content, production preferences, voices, photos, artifacts and job state
are preserved. Runtime dependencies remain inside the app bundle. Replace the app
with a newer version to update; automatic update delivery is not included yet.
Model or voice-runtime changes may require a new audition, as in the source app.
Deleting the app does not delete its data folder. Back up that folder separately.
Do not copy another Mac's Python environments as an installation shortcut.

### Release cadence

Routine source, editorial and UI updates do not trigger a desktop version bump,
DMG build or notarization submission. Develop and test in the source checkout,
commit and push complete milestones, and batch desktop packages for an explicitly
requested release. Documentation/research changes need no installer.

An installed app runs its packaged code; pulling the source repository does not
update it. When an installed-app fix or another-Mac test is needed, agree on a
release milestone and package the accumulated tested changes. Automatic updates
and independently downloadable executable patches are not implemented.

The source-checkout workspace remains separate. Migration of its personal voices,
portraits and resumable jobs is not automatic. Existing portable studio ZIPs can
still be viewed using their documented playback workflow.

## Build on an Apple Silicon Mac

Build prerequisites: Node 22.13+, npm, Git, Xcode Command Line Tools (Swift compiler,
SDK, `codesign`, `hdiutil`, `make`) and `pkg-config` on the builder's PATH. FFmpeg **9.0.2** and x264 are compiled from checksum-pinned source for
macOS **13.0**; the build does not copy this Mac's Homebrew media binaries. Builder tools are not required on the receiving Mac.

```sh
npm ci
npm run test:desktop
npm run desktop:build
```

The build installs the separate locked desktop and backend dependencies, compiles
the main application, downloads checksum-pinned Node **22.23.4** and uv **0.13.5**,
compiles the Keychain helper, and builds static FFmpeg executables whose dynamic
dependencies are system libraries only. Their source archives and build script
are included under `payload/notices/source/`. The media build is cached; its first
compilation takes longer.
It packages with Electron Forge and creates/verifies the disk image using macOS
`hdiutil`. The public seed allowlist is explicit. It never copies `.state/`,
`artifacts/`, `.env`, credentials, personal portraits or uncommitted drafts.
Public editorial content comes from Git's committed version.

Output:

```
desktop/out/SAP Shorts-darwin-arm64/SAP Shorts.app
desktop/out/SAP-Shorts-0.1.1-arm64-local-test.dmg
desktop/out/SAP-Shorts-0.1.1-arm64-local-test.dmg.sha256
desktop/out/build-report.json
```

`npm run desktop:prepare` prepares the payload without packaging; after that,
`npm run desktop:start` opens the development launcher. `desktop:build --
--skip-prepare` repackages a completed payload. An isolated test may set
`SAP_SHORTS_DESKTOP_DATA_DIR` to an empty folder. `--smoke-test` writes a startup
report there and exits; it does not record a microphone, pair a worker, or install
models. These generated outputs are excluded from Git.

## Public release requirements

The default output is a **local test build**. It has no Developer ID identity or
Apple notarization ticket. It is not a public distribution candidate. Do not tell
recipients to disable Gatekeeper or remove quarantine as an installation step.

To verify signing, notarization and installation on your own Macs while public
redistribution review is still pending, create a clearly labeled **signed preview**:

```sh
DESKTOP_SIGN_IDENTITY="Developer ID Application: Your Organization (TEAMID)" \
DESKTOP_NOTARY_PROFILE="sap-shorts-notary" \
npm run desktop:build -- --signed-preview
```

This creates `SAP-Shorts-0.1.1-arm64-signed-preview.dmg` with Apple's signature and
notarization checks. Its manifest and build report retain `notarized-preview` and
`redistributionReviewed: false`. Apple notarization does not grant redistribution
rights for the bundled dependencies. In particular, the CAP demo currently bundles
`@sap/cds`, `@sap/cds-compiler` and `@sap/cds-fiori` under SAP Developer License terms;
resolve permission to redistribute them, or move their installation to a separate
recipient-initiated prerequisite, before public release. The open source notices
inventory must also be completed. Optional portrait models are downloaded separately.
The public `--release` gate remains closed without the completed review flag.

For public distribution, install a Developer ID Application identity and configure
notary credentials in the builder's Keychain. Do not put private keys or passwords
in source control. Complete the third-party redistribution review, then build:

```sh
DESKTOP_SIGN_IDENTITY="Developer ID Application: Your Organization (TEAMID)" \
DESKTOP_NOTARY_PROFILE="sap-shorts-notary" \
DESKTOP_REDISTRIBUTION_REVIEWED=1 \
npm run desktop:build -- --release
```

The release path requests Hardened Runtime signing and app notarization through
Forge, then signs, notarizes, staples and verifies the DMG. A release build fails
without the required configuration. Setting the review flag documents a completed
review; it does not grant licenses or perform that review automatically.

The FFmpeg build enables GPL components including libx264. Complete the applicable
notices/corresponding-source inventory for the chosen FFmpeg and native libraries
before sharing publicly. `payload/notices/media-build.json` records the included
pinned source archives, deployment target and build configuration. Node, uv, fonts and the application have
notices included; npm dependencies retain their license files. Ditto auxiliary
models have their own terms and need review separately from Ditto's source license.
Signing/notarization also needs a fresh-Mac Gatekeeper test of the downloaded
artifact, plus verification of nested native libraries and microphone permissions.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Forge signing](https://www.electronforge.io/guides/code-signing/code-signing-macos),
[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[FFmpeg licensing](https://www.ffmpeg.org/legal.html).

## Verification

See the latest verification record below for what was actually tested. A successful
local startup alone does not establish compatibility with older macOS releases,
public Gatekeeper acceptance, or subjective voice/portrait quality.


## Set up your Apple signing identity

Use the Mac that will build releases. Your Apple Developer Program membership
must be active; Apple requires the Account Holder role to create a Developer ID
certificate through the portal.

1. In Keychain Access, use Certificate Assistant to request a certificate. Enter
   your email and a descriptive key name, leave the certificate-authority email
   blank, and save the CSR to disk. The matching private key stays in Keychain.
2. Open [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)
   and add a **Developer ID Application** certificate. Upload the CSR and download
   the resulting `.cer` file.
3. Double-click the `.cer` file to install it in the login keychain. In **My
   Certificates**, expand it and confirm the matching private key is present.
4. Verify it with `security find-identity -v -p codesigning`. Record the complete
   identity name for `DESKTOP_SIGN_IDENTITY`; never send private keys or passwords
   in chat or commit them.
   If a matching identity is listed without `-v`, but there are no valid identities
   with `-v`, check for a missing intermediate. For a G2 Developer ID certificate,
   install **Developer ID - G2** from [Apple PKI](https://www.apple.com/certificateauthority/)
   into the login keychain using its default trust settings. No trust override or
   keychain reset is required. When multiple certificates have the same name, use
   the chosen certificate's SHA-1 fingerprint as `DESKTOP_SIGN_IDENTITY`.
5. Create notarization credentials locally with the interactive command below.
   Supply your Apple ID, Team ID and an app-specific password in Terminal's prompts,
   or use your organization's approved App Store Connect API-key workflow. Do not
   put passwords in shell commands, repository configuration or screenshots.

```sh
xcrun notarytool store-credentials sap-shorts-notary
```

At the initial API-key-path prompt, press Return to use Apple ID authentication.
Alternatively, specify the non-secret account and team explicitly so only the
app-specific password is prompted:

```sh
xcrun notarytool store-credentials sap-shorts-notary \
  --apple-id "YOUR_APPLE_ID_EMAIL" --team-id "YOUR_TEAM_ID"
```

Generate the password in [Apple Account](https://account.apple.com/) under
**Sign-In and Security → App-Specific Passwords**, signed in to the same account
associated with your Developer team. This is separate from the CSR's email field.
`xcrun notarytool history --keychain-profile sap-shorts-notary` verifies access
without displaying the stored password. An empty history is normal before the
first submission.

Use `sap-shorts-notary` as `DESKTOP_NOTARY_PROFILE` in the release build. Creating
an Installer or Mac App Store certificate does not substitute for the Developer ID
Application identity used by this DMG's app. The setup process does not revoke
existing certificates or change Keychain trust settings.

Official references: [Apple's CSR guide](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/),
[Developer ID certificates and required role](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).


## Local test build verification — October 26, 2026

On this Apple Silicon Mac running macOS 27.0.1:

- A clean source-only checkout passed **301 workflow tests**, **10 desktop tests**,
  five CAP checks, typecheck, content validation and both builds. Changed-file lint
  passed. The source repository retains eight unrelated pre-existing lint errors.
- Desktop tooling and backend dependency audits reported zero vulnerabilities.
- The actual DMG was verified, mounted read-only and copied to a new folder outside
  the repository. The copied app started with an empty, separate data directory,
  served its studio successfully, and used its bundled Node/FFmpeg/FFprobe/uv paths.
  Its CAP preview passed the five assertions without parent-repository npm modules.
- A fresh managed Python 3.12.15/Kokoro installation through the app installed Heart
  and Michael. The complete `CAP-01@feed-pop` production passed decoding, receipt,
  captions and audio checks: 47.580 seconds, 1080 × 1920, 30 fps H.264/AAC,
  −16.15 LUFS and −4.39 dB true peak. Audio was generated fresh; production through
  the verified MP4 took 113.3 seconds (74.6 audio/captions, 38.7 rendering).
- Photo-alignment installation, creator-studio navigation, video-review display and
  rejection of an insecure remote worker origin were checked in the native app.
  Workspace repair preserved installed models and the produced video. Existing
  source-checkout voice files/settings were unchanged; all six current personal
  profiles remained accepted, including the profile added independently during work.

No microphone recording or personal photo/voice enrollment was performed in the
installer test. Optional Qwen and Ditto fresh downloads, live online worker pairing,
older macOS hardware, Developer ID signing and Apple notarization have not been
validated with this DMG. The executable deployment target is macOS 13.0; that is a
build target, not a substitute for testing on each supported OS. A fully offline
model-pack installer and automatic updates remain future work.

Git history is not installed. Historical demo-commit lookup is therefore skipped;
a companion post can show a pending code permalink. Review that line before posting;
the demo and official source references are included locally.

Local evidence is retained under `.state/private-tests/desktop-*`. The installer,
build cache, test models, voices and generated video are excluded from Git.

## Signed preview verification — October 26, 2026

The signed preview was built from commit `4e49fea` using the newer Developer ID
Application certificate and credentials stored in the builder's Keychain. No
password, private key or exported signing identity is included in the repository.

- The 12 desktop tests passed, including the separate signed-preview and public
  release gates; changed-file lint passed.
- Apple accepted the app with no issues: submission
  `221ce90a-ac27-4dad-b8cc-32878e5abaee`.
- A copy extracted from the exact submitted app archive started outside the
  repository using an empty data directory. Its studio returned HTTP 200.
- All 20 native Mach-O files passed explicit signature checks, carried the expected
  Developer ID team, a secure timestamp and Hardened Runtime. The signing
  certificate fingerprint matched the newer identity selected for the build.
- The bundled signed Node loaded Canvas and rendered a PNG, executed a SQLite
  query, and passed all five live CAP demo checks in the isolated workspace.
- Apple accepted the DMG with no issues: submission
  `fcac9490-6218-4ea8-bc01-a1ddd2172a11`. Both app and DMG tickets were stapled and
  validated. Gatekeeper accepted both as **Notarized Developer ID**.
- The final DMG was mounted read-only and its app copied outside the repository.
  The copied app passed signature/ticket/Gatekeeper checks, opened its setup screen
  with **Core tools ready**, and opened the creator studio with 13 public scripts.
  The isolated test app was then quit normally; the source studio remained running.

Final artifact: `desktop/out/SAP-Shorts-0.1.0-arm64-signed-preview.dmg`
(345,310,895 bytes). SHA-256:

```text
9883ffe3ddf2dcfe5ea1af453076998473f1ee24df297376e32e6aef3382fde5
```

This is a notarized-preview workflow, not a completed public redistribution review.
The package retains the CAP redistribution prerequisite above. Another physical Mac,
older macOS versions, microphone recording, personal voice enrollment and a full
Ditto render still require separate testing.

## Desktop 0.1.1 — saved revisions and production recovery

Version 0.1.1 fixes a saved-version discovery bug: **Produce video** now refreshes
the workspace immediately after saving a revision, and again when production
stops. Previously a revision created through Produce could remain absent from
the workspace if narration was blocked, despite its voice/photo settings being
saved correctly. Opening the original version then showed its original narrator.

Matching browser drafts now recover automatically into an editable form, with
**Start with original** available to undo recovery. Restored portrait controls
show the saved Ditto/lightweight choice and motion settings. A saved-version
link opens the version that owns the chosen voice and photo.

A blocked job is labeled **Needs script edit** or **Setup needed**, and the editor
explicitly says **Video not produced**. Timing results include measured total and
opening duration, with a button to return to the opening. Narration completion is
not treated as MP4 completion. The video still requires 45–60 seconds total and an
opening of at most three seconds; a five-word title can take longer when it contains
dates and numbers. Shorten only the opening in a new revision when appropriate.

Managed Python launchers are installed inside the desktop data directory rather
than attempting to replace an existing `~/.local/bin/python3.12`.
Updating the app keeps personal voices, photos, scripts and produced artifacts.
Save current edits before quitting to replace the app; browser recovery is scoped
to its original tab/address, while **Save draft** stores a version on disk.

Verification for 0.1.1 (source commit `021d874`):

- All **302 workflow tests**, **12 desktop tests**, typecheck, five live CAP checks,
  content validation and both builds passed in a clean source workspace. Changed
  files passed lint; the previously recorded repository-wide lint issues remain.
- A personal Qwen narrator and realistic Ditto portrait completed an isolated news
  production after shortening only its opening. The verified output is **56.433
  seconds**, 1080 × 1920, 30 fps H.264/AAC, with a **0.96-second opening**. Full decode,
  captions and audio checks passed (−16.24 LUFS, −4.49 dB true peak). Generation took
  **13 minutes 9 seconds**: 91 seconds for audio/alignment and 698 seconds for portrait
  animation, video rendering and checks. These are measurements on this Mac, not an
  estimate for every device. The private test media is not committed or bundled.
- Browser testing confirmed automatic recovery keeps fields editable and restores
  voice, photo, portrait mode and movement settings. Undo returned to the saved
  Ditto configuration. The completed video appeared in **To review**; approval and
  publication were left pending. The running user's editor was preserved.
- Apple accepted the app (`d302b92c-f1ba-41f0-b165-908e87f9bc51`) and DMG
  (`e8e7f492-c8c3-422c-9055-4f143ccc6d66`) with no issues. Tickets validated and
  Gatekeeper accepted the app and DMG as **Notarized Developer ID**.
- The final DMG was mounted read-only and its app copied outside the repository.
  That copy started with an empty data directory and served its studio with HTTP
  200. All **20 native binaries** passed signature, timestamp, team and Hardened
  Runtime checks; all **338 seed files** passed their checksums.

Signed preview: `desktop/out/SAP-Shorts-0.1.1-arm64-signed-preview.dmg`
(350,125,260 bytes). SHA-256:

```text
2fbc93b77d0bcb175a83b68965c868583785e5af095455f92d092a217c36e2c3
```

Quit the installed app after saving current edits, replace it from the DMG, then
reopen. Tests used separate workspaces; the currently running installed app is not
silently replaced or restarted. Public redistribution review remains pending.
