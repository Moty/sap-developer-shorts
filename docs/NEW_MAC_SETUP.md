# Set up and test on another Mac

Start from `main`. The full local workflow has been exercised on Apple Silicon
macOS; Intel Mac narration with the pinned Python packages has not been verified.
Use a native Apple Silicon Terminal session when applicable (`uname -m` reports
`arm64`). No SAP account, global CAP install, GPU, paid provider, or API key is
needed for these local tests.

## 1. Install the tools

You need Git, Node.js 22.13 or newer, npm, uv, and FFmpeg/FFprobe. The repository's
`.nvmrc` selects Node 22, and CI verifies Node 22 and 24. A current Node 22 release
is the recommended starting point.

If Git/developer tools are missing, run `xcode-select --install` and complete the
macOS installer. Install [Homebrew](https://brew.sh/) following its official
instructions and the printed shell setup. See [supported Mac requirements](https://docs.brew.sh/Installation).

Clone the project into a folder of your choice:

```sh
git clone --branch main https://github.com/Moty/sap-developer-shorts.git
cd sap-developer-shorts
brew bundle install --file=Brewfile --no-upgrade
export PATH="$(brew --prefix node@22)/bin:$PATH"
```

The [Brewfile](../Brewfile) installs Node 22, uv, and FFmpeg, including FFprobe.
Node 22 is a [versioned, keg-only formula](https://formulae.brew.sh/formula/node@22),
so the PATH line selects it for this Terminal session. Repeat that line in a new
Terminal tab. If you already use nvm, you can instead use `nvm install` and
`nvm use` in the repository, then `brew install uv ffmpeg` for the other tools.
`--no-upgrade` preserves tools already installed by Homebrew. If its installed
Node 22 is older than 22.13, run `brew upgrade node@22` before continuing.

Confirm the tools are available:

```sh
git --version
node --version
npm --version
uv --version
ffmpeg -version
ffprobe -version
```

FFmpeg must include the `libx264` encoder and `loudnorm` audio filter. You can
inspect them with `ffmpeg -hide_banner -h encoder=libx264` and
`ffmpeg -hide_banner -h filter=loudnorm`. Homebrew's FFmpeg formula supplies the
needed components. Homebrew installs current formula releases; it does not lock
their exact versions. See [Homebrew Bundle](https://docs.brew.sh/Brew-Bundle-and-Brewfile).

For an existing clean checkout, use `git switch main` and `git pull --ff-only`
instead of cloning. Preserve any local edits before switching or updating.

## Turnkey Bootstrap (Recommended for Apple Silicon / M-Series)

Instead of stepping through manual installs, run the all-in-one bootstrap:

```sh
npm ci
npm run mac:setup
```

This automated runner checks Node >= 22.13, verifies `ffmpeg` and `uv`, downloads the MediaPipe face landmark model, installs Kokoro neural voice profiles, checks the Apple Silicon Ditto MPS runtime, and builds the initial studio library.

To connect your Mac as a background render worker for the Firebase Studio:
```sh
npm run firebase:worker
```
See [Hybrid Firebase Studio & Local Mac Worker](FIREBASE_HYBRID_STUDIO.md) for full cloud configuration.

## 2. Verify a fresh checkout (Manual Steps)

Run these commands from the repository root:

```sh
npm ci
npm run doctor
npm run check
npm run build
node dist/src/cli.js doctor
npm run pilot
```

`npm ci` installs the root application and CAP demo workspace from the committed
lockfile. It includes the native Canvas dependency used for video frames. Keep
optional dependencies enabled. There is no separate npm installation inside the
demo folder, and no global `cds` command is required.

Expected results: checks, build, and the five live CAP assertions pass; the pilot
prints a new `artifacts/CAP-01-v2-.../review.html`. The pilot is a **silent
storyboard**. It does not need Python, downloaded voices, or an existing media
database. `doctor` reports video tools but does not verify the Python voice
runtime or prove that a narration sounds natural.

Tests intentionally exercise rejected requests such as 404 and 405. Read the
final test summary; those expected responses are not setup failures.

## 3. Install the local narrators

```sh
npm run shorts -- voice-setup am_michael
npm run shorts -- voices
```

This installs the default Heart voice and Michael for the prepared two-person
scripts. [uv](https://docs.astral.sh/uv/guides/install-python/) obtains Python 3.12
if needed. Setup creates an isolated environment and downloads the pinned Python
dependencies, English language model, Kokoro model, and selected voices. Allow
several gigabytes of free space and internet access to the Python package
registry, GitHub, Hugging Face, and uv's Python distribution host during setup.
Speech generation subsequently runs locally on the CPU with model networking
disabled. Run only one narration/production command at a time.

The committed requirements and model revision are in
[`config/neural-voice-requirements.txt`](../config/neural-voice-requirements.txt)
and [`config/neural-voice.json`](../config/neural-voice.json). Heart at speed 0.96
remains the shipped default. Setup records the actual installed package and
asset hashes on this Mac. Do not copy another Mac's virtual environment or active
job database as an installation shortcut; paths, packages, and worker ownership
are local to that installation.

Optional voice comparison, generated sequentially with identical text:

```sh
npm run shorts -- voice-audition af_heart am_michael
```

## 4. Produce the revised video

For realistic picture-based presenters, first run `npm run shorts -- talking-head-setup`.
This optional engine downloads about 2.32 GB of models and renders locally using
Apple Silicon's Metal accelerator. Choose **Realistic local portrait (Ditto)**
and a delivery style in the workshop. See [local portrait setup and limits](LOCAL_PORTRAITS.md).

```sh
npm run shorts -- produce CAP-01@casual-v2 --serve
```

Wait for `Production: READY`, then open the printed `Review:` address **on the
new Mac**. The command verifies the demo, generates narration and captions,
exports and checks the MP4, builds a studio, and serves it on an available port.
Use **Casual revised → Watch MP4 → Download MP4** for the Gemini review.

The earlier revision measured 47.7 seconds on the original Mac. New production
must pass the measured 45–60-second duration and at-most-three-second hook checks;
tool versions and hardware can change the generated file. Listen to SAP terms,
the command, and the transition to all three products. Captions retain normal
API/npm/URL spelling; this revision has its own pronunciation overrides.

Stop the preview server with Ctrl+C. To resume production after a failure, rerun
the same command and follow its printed recovery guidance. For diagnosis:

```sh
npm run shorts -- production-status CAP-01@casual-v2
npm run shorts -- jobs CAP-01@casual-v2
```

To generate the conversation too, stop the server and run
`npm run shorts -- produce CAP-01@duo --serve`. The original casual comparison is
`CAP-01@casual`. A fresh studio shows only the videos produced or restored on
that machine; having the scripts in Git does not create recordings automatically.

## 5. Bring the exact existing recordings

Git contains the application, all scripts/presentation variants, templates,
schemas, fonts and licenses, configuration, dependency pins, tests, prompts,
and documentation. It excludes `node_modules/`, `dist/`, `.state/`, downloaded
models, generated `artifacts/`, videos/audio, and local credentials.

To review the **same existing twelve recordings** on the new Mac, create a
portable studio on the original Mac:

```sh
npm run shorts -- library-package LIBRARY_DIRECTORY
```

Use the actual saved library directory printed by production or `library`.
Transfer its resulting `studio.zip` with AirDrop, a drive, or another method you
choose. Extract the entire ZIP. Open `studio/review.html`, or serve the extracted
folder from your new checkout:

```sh
npm run shorts -- serve /absolute/path/to/extracted/studio
```

This playback route needs no voice setup or speech regeneration. The ZIP keeps
its videos, captions, sources, voice samples, workshops, and episode downloads
together. It does not install models or restore resumable production jobs. A
`127.0.0.1` address from the original Mac cannot open its files on the new Mac.
See [studio packages](STUDIO_PACKAGES.md) and [quality review](QUALITY_REVIEW.md).

## Troubleshooting

| Symptom | Next action |
| --- | --- |
| `node:sqlite` is missing or Node is too old | Select Node 22.13+ in this Terminal, confirm `node --version`, then rerun `npm ci`. |
| Canvas/native-module loading fails | Confirm native architecture with `uname -m`, use the intended Node version, and rerun `npm ci` on this Mac with optional dependencies enabled. |
| `uv`, `ffmpeg`, or `ffprobe` is missing | Complete Homebrew shell setup and the Brewfile installation; confirm the tool versions in this Terminal. |
| Local neural voice is not set up, or Michael is missing | Run `npm run shorts -- voice-setup am_michael` in this checkout. |
| Voice setup stops during downloads or installation | Check the reported package/network error, available disk space, and host access, then rerun setup. Keep the pinned requirements; do not substitute random package versions. |
| A scene reaches its render time limit | Close other heavy work, inspect the printed diagnostic log, and retry the same production command; see [production recovery](PRODUCTION_WORKFLOW.md). |
| `EADDRINUSE` when serving a saved folder | Stop the other local preview with Ctrl+C. `produce ... --serve` chooses an available port automatically. |
| No videos appear after `git pull` | Produce them locally or transfer the saved studio ZIP as described above. |
| News production says source review is stale | Re-read official sources and update the dated editorial evidence; see [news workflow](NEWS_WORKFLOW.md). Copying or regenerating media does not renew source dates. |
| Two Macs generate different hashes | Compare runtime/tool versions; use the saved studio ZIP when the exact prior recording is required. |

Keep local `.env` files and credentials out of Git. Local testing does not need
them. Avatar animation and publishing remain pending; these setup steps do not
connect or purchase a hosted provider.

## Verification on the original Mac

On October 15, 2026, a separate clone of `main` on Apple Silicon macOS passed
`npm ci`, both source and compiled `doctor`, the full 166-test workflow suite,
five live CAP checks, the build, and `npm run pilot` under Node 22.13.0. The clone
started without `node_modules/`, `.state/`, `artifacts/`, or `.env`. System tools
were already installed. This verifies the source-only application setup; it is
not a test of Homebrew installation or fresh voice downloads on the destination
Mac. The narration/video path was exercised separately on the original Mac.

## Optional automatic photo-mouth alignment

Run `npm run shorts -- avatar-setup` after `npm ci`, then rebuild and serve the
studio. The workshop detects lips locally when a photo is selected or uploaded;
manual correction remains available. See [photo presenter setup, privacy and
limitations](PHOTO_AVATARS.md). Copy personal portraits privately between machines;
they and the optional detector model are not supplied by a Git pull.
