# SAP Developer Shorts

A local preparation workflow for SAP shorts: hands-on developer tutorials and dated SAP news briefings, with a shared vertical preview, narration, captions, and companion post workflow.

The implementation turns the editorial blueprint into a reproducible pilot package: a script, vertical storyboard, live demo evidence, companion post copy, and local Kokoro narration. It now exports verified vertical MP4s with visible captions, speaker labels, and local animated presenters. Publishing remains a reviewed manual step. No provider credentials are needed for the local workflow.

Photo presenters support learned, audio-driven face and head animation entirely on Apple Silicon, with calm, conversational and expressive delivery. See [local portrait narration](docs/LOCAL_PORTRAITS.md). A separate [lightweight photo effect](docs/PHOTO_AVATARS.md) remains available for quick previews.

**My voice** can narrate from a recorded sample using local Qwen3-TTS on Apple
Silicon. It supports individual speakers and mixed conversations while keeping
Heart as the stock default. Run `npm run shorts -- voice-clone-setup`, then enroll
and audition a sample in **Voice & portrait**. Personal voices are local-only;
see [setup, privacy, CLI and quality limits](docs/QWEN_VOICES.md).

## Start on another Mac (Turnkey Bootstrap)

For Apple Silicon Macs (including Apple M-series laptops and Mac minis), run the automated bootstrap:

```sh
git clone https://github.com/Moty/sap-developer-shorts.git
cd sap-developer-shorts
npm ci
npm run mac:setup
```

This installs and verifies Node 22, Homebrew tools (`ffmpeg`, `uv`), MediaPipe face calibration models, Kokoro neural voices, and the Ditto Apple Silicon MPS runtime in one step. See the [fresh Mac setup guide](docs/NEW_MAC_SETUP.md) for step-by-step instructions.

## Hybrid Cloud Studio & Local Render Worker

In addition to running locally, the studio runs as a cloud-hosted web application on Google Firebase with local Mac background rendering:
* **Cloud Web Studio**: Access the responsive studio anywhere at `https://sap-shorts-160871.web.app/review.html`.
* **Local Mac Render Worker**: Run `npm run firebase:worker` on your Mac. It claims production jobs from Cloud Firestore, renders speech (Kokoro) and talking-head video (Ditto MPS) locally with zero cloud API costs, and uploads results to Cloud Storage.
* See [Hybrid Firebase Studio & Mac Worker](docs/FIREBASE_HYBRID_STUDIO.md) for full architecture and commands.

A separate [private workspace studio](docs/PRIVATE_WORKSPACES.md) now adds
email/password login, tenant-scoped Firebase storage, personal voice enrollment,
and registered Mac mini/MacBook Pro rendering engines. Run `npm run private:build`
and follow the guide for the isolated local Firebase emulators. The Mac worker
path has real local render evidence; the optional CUDA cloud adapter remains
behind a disabled budget gate pending a real GPU/container staging test.
The earlier hybrid studio above remains a shared deployment. See the
[architecture plan](docs/FIREBASE_AUTH_CLOUD_RENDERING_PLAN.md) and
[implementation evidence](docs/PRIVATE_WORKSPACE_IMPLEMENTATION.md) for scope.

## Browse the review studio

To prepare a complete local video and refreshed studio in one command:

```sh
npm run shorts -- produce CAP-01@duo --serve
```

This checks prerequisites, verifies content, resumes/reuses local narration,
exports a checked MP4, and serves the studio at an available local address. Install the
voices and FFmpeg first; see [production and recovery](docs/PRODUCTION_WORKFLOW.md).
Use `production-status CAP-01@duo` to inspect the latest saved attempt.

```sh
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

Use the library directory printed by the first command. The workspace separates ideas, editing, active production, videos to review, approved videos to publish, and recorded publications. Each version has a visible name and next action; stage, type, search and attention filters work together on desktop and phones. The library prefers validated narrated output over silent storyboards and excludes previews that no longer match the current script or whose saved files have changed. See [the creator journey](docs/CREATOR_STUDIO.md).

Each entry also opens an [interactive 9:16 presentation](docs/PRESENTATIONS.md)
with local Reveal.js playback, code inspection, captured-result charts and filters,
or source-backed news cards. New MP4 productions include the refreshed motion
design and an interactive deck in the episode package.

An optional [writing assistant](docs/WRITING_ENGINES.md) now suggests angles,
rewrites existing scripts and provides editorial feedback. Configure **Writing
engine** in the sidebar, then open **Writing & presentation assistant** in a script's editor.
It also generates or enhances presentation designs from a user prompt, with a
preview before applying. Saved designs drive both the interactive deck and next MP4.
Use local Gemma through LM Studio, or explicitly select SAP Hyperspace AI through
its local LiteLLM proxy. Models, connection and secure key storage are managed in
the UI. Each Hyperspace request requires acknowledgment of possible usage costs;
there is no automatic remote fallback. Voice samples and portraits stay local.
Review proposals before applying and saving them.

Production accepts 15–90 seconds of measured audio. The 45–60-second target,
three-second opening and individual scene timings are guidance; small overruns
do not block a valid short. Captions and scenes follow actual speech.

The [local comparison](docs/LOCAL_MODEL_WORKFLOW_RESULTS.md) explains the Gemma
recommendation and remaining editorial limits. The [content quality audit](docs/CONTENT_QUALITY_REVIEW.md)
and [conversational example](samples/editorial_quality_pilot.md) describe the
creative direction. The news URL drafter still uses paragraph extraction and
templates; automatic source research and managed writer installation remain future work.

This is a portable, saved library. Rebuild it after creating or revising episodes, then serve the new directory. It does not purchase media or publish posts. Expired news remains viewable with a source-recheck label; new news production still requires a fresh review. See [review studio details](docs/REVIEW_STUDIO.md).

Use **Download episode package · ZIP** on a verified episode to save its video,
captions, companion draft, transcript, sources, and portable review together.
Packages retain the voice and style shown in the studio. See
[episode downloads](docs/EPISODE_PACKAGES.md).

To share the complete saved studio as one download, run
`npm run shorts -- library-package LIBRARY_DIRECTORY`. It checks the saved files
and creates a separate `studio.zip` containing all its videos, comparisons,
voice samples, script workshops, and episode downloads. Extract the ZIP and open
`studio/review.html`. See [studio handoff](docs/STUDIO_PACKAGES.md) for local
serving and the saved-news review requirement.

## Run the pilot

Use Node.js **22.13+** and npm; Node 22 LTS is the recommended development version. No global CAP tools or SAP cloud account are required.

```sh
npm ci
npm run doctor
npm run check
npm run pilot
```

Open the `review.html` path printed by the pilot command in a browser. The standalone page lets you play or scrub through a **silent storyboard with provisional timing**. It shows the actual checked-in code and the results captured by the verification run. Presenter regions are explicitly marked as pending.

Each invocation creates a separate directory under ignored `artifacts/`:

| File | Purpose |
| --- | --- |
| `review.html` | Interactive storyboard, technical checks, sources, and post draft |
| `episode.json` | Exact editorial input used by this run |
| `narration.md` | Draft scene narration and pronunciation glossary |
| `demo-evidence.json` | Actual HTTP results, passed checks, and runtime versions |
| `demo.log` | Demo execution diagnostics |
| `linkedin.txt` | Companion post draft; code link awaits repository publication |
| `video-layout.json` | Shared layout in final 1080 × 1920 output pixels |
| `manifest.json` | Persisted stages, source hashes, artifact hashes, and any failure |

The silent storyboard uses provisional timing. A warm, conversational female narration preview is also available: the current CAP pilot measures 58.7 seconds, with a 3.0-second hook and nineteen captions using model timing estimates. This is a local voice preview; the final avatar-provider voice must be measured again.

The second tutorial, [CAP-02](content/episodes/CAP-02.json), shows the checked-in
CSV seed data, all three products ordered by title, and the exact asserted
stock-above-zero query. Its current Heart recording measures 53.7 seconds.
Run `npm run shorts -- produce CAP-02 --serve` to prepare or resume the complete
short. See [the CAP data lesson](docs/CAP_DATA_TUTORIAL.md) for the queries,
source notes, and initial-data/test-data distinction.

## Create SAP news shorts

News episodes use official SAP sources and record when each announcement was checked. Each card distinguishes availability, rollout, early access, planned release, or announcement only. News source reviews have their own evidence and do not claim that a product demo was executed.

The first news draft, [NEWS-01](content/episodes/NEWS-01.json), uses the [SAP Connect 2026 guide](https://www.sap.com/topics/events/connect/innovation-news-guide-2026). It is an editorial selection from that event, with sources checked October 14, 2026. The [news backlog](content/news/backlog.json) contains six ideas: this roundup, the prepared Joule Work follow-up, and four research candidates.

```sh
npm run shorts -- validate NEWS-01
npm run shorts -- preview NEWS-01
npm run shorts -- narrate NEWS-01
```

Use the printed artifact directory with `npm run shorts -- serve ARTIFACT_DIRECTORY`. The same player, timed captions, saved media jobs, and local voice work for both episode formats. Run the voice setup below before the first narration. A news run writes `news-evidence.json` with dated source notes instead of CAP evidence. Production refuses a news review older than its configured limit (at most seven days). Validation can still inspect an older draft.

The NEWS-01 warm local preview measures **57.0 seconds**, with a **2.5-second hook** and eighteen captions using model timing estimates. A verified vertical MP4 is available; stock avatar animation remains pending.

The follow-up [NEWS-02](content/episodes/NEWS-02.json) focuses on Joule Work’s interface, business context, and managed activation, with sources reviewed October 15, 2026. It preserves the distinction between an announced rollout and access for a particular customer. Prepare its local video and ZIP with `npm run shorts -- produce NEWS-02 --serve`, or use `NEWS-02@duo` for Mira and Max’s casual conversation with light humor. Use `NEWS-02@myth-fact` for a professional question-and-correction version about announced capability versus customer access. All three have editable scripts in the studio.

See [the news workflow](docs/NEWS_WORKFLOW.md), [reusable news script template](templates/news_script_template.md), and [news editor prompt](prompts/v1/news-editor.md). Research is currently an editorial step; this does not automatically discover or rank global SAP news, watch pages, or publish posts.

Newly assembled studios and episode downloads show the news review's inclusive
UTC dates. When opened after expiry, a separate **Source recheck required** notice
keeps the saved video available while reminding you to revisit the official
sources. This date check uses the device clock and does not renew factual review.
Rebuild a saved studio to include the notices; earlier archives stay unchanged.

## Generate and resume narration

Use **Continue editing** or **More → Edit a new version** to adapt a delivery.
The editor guides you through **Script**, **Voice & portrait**, and **Review &
produce**. **Save draft** keeps a validated version on this Mac without rendering;
**Produce video** starts the local production job. Download/import remains available
for portable scripts with `npm run shorts -- script-import PATH`.
Select a narrator or a different voice for each conversation speaker. This changes only
the new version; Heart remains the project default and existing recordings are
kept. Choices reflect checked local voice assets when the studio was built.
Install another profile explicitly, then rebuild the studio to offer it.

Open **Review changes** before downloading to compare revised wording and voices
with the starting script. Restore the title, post, one scene, or the starting
voices while keeping the version name and other edits. The comparison uses the
same draft as the download; invalid drafts still need correction.

The workshop can keep unfinished edits for recovery after a reload in the same
tab at the same address. Choose **Resume saved draft** or **Start with original**
before editing again. Save a draft to keep it on this Mac, or download the JSON for a portable copy; closing the tab,
changing the address, or browser storage restrictions may lose recovery.

Presentation can vary independently of the episode's subject. The studio includes a **Delivery styles** section with professional, casual, comic, and two-person CAP comparisons, plus `CAP-01@countdown` for a numbered three-step recipe and `CAP-02@quiz` for a predict-the-result challenge. Set tone, story format, and humor in a presentation variant; the conversation uses Heart and Michael with speaker captions. Try `npm run shorts -- produce CAP-02@quiz` or `npm run shorts -- narrate CAP-01@duo` after `npm run shorts -- voice-setup am_michael`. See [presentation styles](docs/PRESENTATION_STYLES.md) for supported formats, authoring, and review. New style scripts must be authored before generation; the format gallery shows each available example's actual readiness.

The default is Kokoro's **Heart** voice, selected for a warm, conversational female narrator. On macOS, install [uv](https://docs.astral.sh/uv/getting-started/installation/) and run the one-time setup. It installs a separate Python environment and downloads the pinned model; narration then runs locally without sending the script to a speech service.

```sh
npm run shorts -- voice-setup
npm run shorts -- narrate CAP-01
```

The command verifies the demo, creates or reuses a persisted media job, and writes a narrated `review.html`, `narration.wav`, `captions.vtt`, `timing.json`, and `media-manifest.json`. It synthesizes each scene as a continuous sentence group with short pauses between scenes, avoiding the old phrase-by-phrase delivery and padded visual slots. The player uses the measured audio clock; caption boundaries are model estimates, not forced alignment. Serve the printed output directory with `npm run shorts -- serve ARTIFACT_DIRECTORY`. The built-in server supports audio seeking.

The chosen pilot settings are a **stock presenter and a $5 total limit** in [production settings](config/production.json). Local narration has no per-video service charge. The earlier macOS system-voice adapter remains available for saved jobs. See [voice options and setup](docs/VOICE_OPTIONS.md). No live avatar adapter is enabled. Avatar connectors found in this workspace are disabled by the administrator; real generation requires a permitted provider connection.

To compare installed voices, run `npm run shorts -- voice-audition af_heart am_michael`, then rebuild the library. The **Narrators** section has identical-text samples and explains how to choose another voice. To explore Bella, for example:

```sh
npm run shorts -- voice-setup af_bella
npm run shorts -- voice-audition af_bella
npm run shorts -- voice-select af_bella
npm run shorts -- produce CAP-01 --serve
```

`voice-select` changes only the default narrator; it does not download or record anything. Authored styles retain their speaker assignments: inspect them with `npm run shorts -- voices CAP-01@duo`. Heart remains the shipped default. Supported profiles cover American and British English female and male voices; no voice training or paid service is needed.

Portable recovery exercises use the simulated provider:

```sh
npm run shorts -- media-simulate CAP-01 lost-submit
npm run shorts -- media-simulate CAP-01 poll-timeout
npm run shorts -- media-status JOB_ID
npm run shorts -- media-step JOB_ID
npm run shorts -- media-package JOB_ID
```

Find saved jobs without copying identifiers from old output:

```sh
npm run shorts -- jobs
npm run shorts -- jobs CAP-01@duo
```

The list shows the saved voice, presentation, phase, cost, review path, and next
recovery command. It flags earlier scripts, changed voice settings, and recordings
made before synthesis-code fingerprints were recorded. Listing does not advance
jobs or generate speech. Export still validates the saved media and timing.

SQLite job state lives in ignored `.state/media/`. Submission intent and provider IDs survive restarts. Unconfirmed submissions are reconciled without automatic resubmission; polling and packaging can resume using the saved job. Packaging rebuilds reuse recorded audio. See [media workflow and recovery](docs/MEDIA_WORKFLOW.md).

## Export a vertical video

Install FFmpeg and FFprobe, then export an existing narrated preview:

```sh
npm run shorts -- render CAP-01@duo
npm run shorts -- render NEWS-01
npm run shorts -- library
```

Serve the new library directory to use its **Watch MP4** links. The export is a 1080 × 1920 H.264/AAC MP4 with visible captions, source-backed visuals, normalized narration, and the selected local presenter animation. It reuses the saved audio, checks complete decoding and timing, and records hashes and quality measurements. Publication remains a reviewed manual step. See [video export and recovery](docs/VIDEO_EXPORT.md).

## Work with the demo

```sh
npm run demo
```

Open [Products](http://localhost:4004/odata/v4/inventory/Products) or [OData metadata](http://localhost:4004/odata/v4/inventory/$metadata). This is a read-only development sample that permits anonymous reads. It seeds three products into in-memory SQLite each time it starts.

```sh
npm run test:demo
npm run shorts -- validate CAP-01
npm run shorts -- verify CAP-01
npm run shorts -- preview CAP-01
```

The verifier checks OData V4 metadata, all three seeded products, two products matching a stock filter, a missing product returning 404, and a create request returning 405. Production authentication, authorization policy, and deployment require additional work. See [demo setup](demos/cap/inventory/README.md).

## Develop the workflow

See [testing and current verification](docs/TESTING.md) for model-free automated
checks, local speech/video integration, and the limits of Firebase validation.

```sh
npm run check       # Formatting, types, workflow tests, live CAP checks, content validation
npm run build       # Compile the TypeScript application
node dist/src/cli.js doctor
```

CI is configured to repeat checks on Node 22 and 24. `.env.example` contains placeholders for later provider adapters. The foundation does not automatically load `.env`; `SHORTS_ARTIFACT_DIR` can be supplied as an environment variable. See [local development and review](docs/DEVELOPMENT.md).

## Project map

- [New Mac setup](docs/NEW_MAC_SETUP.md): prerequisites, clean-checkout checks, local narration/video setup, and exact-recording transfer.
- [Hybrid Firebase Studio & Mac Render Worker](docs/FIREBASE_HYBRID_STUDIO.md): Firebase Hosting UI, Firestore job queues, Apple Silicon local rendering, and single-command bootstrap.
- [Private workspaces and Mac fleet](docs/PRIVATE_WORKSPACES.md): login, isolated storage, device pairing, production, setup, deployment gates, and recovery.
- [Accounts and registered rendering engines plan](docs/FIREBASE_AUTH_CLOUD_RENDERING_PLAN.md): email/password accounts, private workspace storage, Mac mini/MacBook Pro registration and scheduling, optional cloud GPUs, tenant isolation, implementation milestones, and acceptance tests.
- [Quality review](docs/QUALITY_REVIEW.md): revised casual narration, pronunciation corrections, and an audiovisual review prompt.
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): original assessment and full roadmap.
- [Progress](docs/PROGRESS.md): delivered scope, evidence, and next milestone.
- [Media workflow](docs/MEDIA_WORKFLOW.md): narration, job recovery, spending records, and current provider limitations.
- [Production workflow](docs/PRODUCTION_WORKFLOW.md): one-command local preparation, saved progress, compatible speech reuse, and explicit narrator selection.
- [Voice options](docs/VOICE_OPTIONS.md): warm local narration, setup, timing limitations, and the ElevenLabs option.
- [Qwen voice cloning plan](docs/QWEN_VOICE_CLONING_PLAN.md): proposed local speaker-sample narration, private voice profiles, caption alignment, implementation milestones, and acceptance checks; not yet implemented.
- [Presentation styles](docs/PRESENTATION_STYLES.md): professional, casual, comic, dialogue, humor settings, and reusable delivery variants.
- [Video export](docs/VIDEO_EXPORT.md): vertical MP4 composition, quality checks, downloads, and saved render recovery.
- [Local portrait narration](docs/LOCAL_PORTRAITS.md): picture-plus-audio rendering on Apple Silicon, conversational motion controls, setup, and quality limits.
- [Studio handoff](docs/STUDIO_PACKAGES.md): one verified ZIP containing the saved studio, videos, workshops, voice samples, and episode packages.
- [News workflow](docs/NEWS_WORKFLOW.md): source review, availability, freshness, and adding future SAP news episodes.
- [Independent Astra review](docs/ASTRA_REVIEW.md): three reproduced gaps, their fixes, and the verification outcome.
- [Episode contract](schemas/episode.schema.json): versioned structure plus application-level timing and evidence checks.
- [CAP-01 editorial input](content/episodes/CAP-01.json): script, source records, and claim references.
- [30-topic backlog](content/topics/backlog.json): one pilot-ready topic; other topics require research and environment verification.
- [Versioned role prompts](prompts/README.md): separate writing, technical review, visual direction, and distribution steps for a future provider adapter.
- [Original strategy](SAP_SHORTS_AGENT_PLAN.md): historical program blueprint; the executable contracts and current progress supersede its production assumptions.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses. Bundled DejaVu fonts include their [required redistribution notices](assets/fonts/LICENSE_DEJAVU). Downloaded voice models and generated media remain outside versioned source.

## Mac desktop installer

An Apple Silicon desktop launcher and local-test DMG build are available. The app
bundles its core tools and offers guided setup for local voice and portrait engines.
See [Mac desktop distribution](docs/MAC_DESKTOP.md) for builds, installation, data
storage and the signing/notarization requirements for public distribution.

See the [creative workflow guide](docs/CREATIVE_WORKFLOW_ENHANCEMENTS.md) for story planning, dynamic visual layouts, finished-MP4 review kits, production presets, verified stock-scene reuse and library organization. These source enhancements do not automatically update an installed desktop app.

The [advanced presentation guide](docs/ADVANCED_PRESENTATIONS.md) covers local backgrounds/effects, flows and milestones, captured-data charts, image uploads/cropping, and representative frame previews.
