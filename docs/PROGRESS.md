# Implementation progress

Updated October 15, 2026. Local branch: `codex/project-foundation`.

## Milestone 1: runnable foundation delivered

- Added a pinned npm workspace, lockfile, TypeScript application, formatting/type checks, tests, and CI configuration for Node 22 and 24.
- Added `doctor`, `validate`, `verify`, and `preview` commands. The compiled CLI also runs from `dist/src/cli.js`.
- Defined a versioned episode JSON Schema and runtime checks for claim references, registered execution checks, scene order, timing, and source paths.
- Converted the thirty-topic backlog to structured content with explicit research status. CAP-01 is the single executable pilot; CAP-02 and CAP-03 are the next planned local examples.
- Replaced the incomplete CAP example with a full local project: explicit service projection, seed CSV, pinned runtime/database dependencies, and five live HTTP assertions. Read-only behavior is asserted on the projected entity, and the endpoint path is verified.
- Created a 124-word CAP-01 script with a planned 55-second timeline, official source records, a pronunciation glossary, and a LinkedIn companion draft.
- Added a standalone interactive storyboard using a shared 1080 × 1920 layout, actual source code, and captured API results. The presenter regions and provisional timing are clearly labeled.
- Persisted per-run stages, exact input snapshots, SHA-256 source/artifact hashes, demo evidence, diagnostics, and failure records. Failed verification cannot create a verified preview.
- Revised all four editorial role prompts; corrected the CAP sample and template; flagged the original ABAP script as unverified.
- Added credential/media/state exclusions, a placeholder-only environment example, MIT license, and local development documentation.

## Verification evidence

- A fresh `npm ci` succeeded with the lockfile.
- `npm run check` passed locally on Node 26.8.2 and Node 22.23.3: formatting, TypeScript, 11 workflow tests, five live CAP checks, and validation of all thirty topics plus CAP-01.
- CAP checks verified OData V4 metadata, three exact seeded products, two in-stock results, a 404 for a missing product, and a 405 for a create request.
- Failure tests exercised persisted failures, incomplete/duplicate check evidence, invalid claim references, timeline errors, out-of-repository paths, and HTML escaping.
- `npm run build` and the compiled `doctor` command passed.
- The interactive pilot was generated end to end and inspected in browser layouts for phone and desktop widths. Scene selection displays the matching code or captured results.
- The dependency audit reported zero vulnerabilities at the time of this implementation.
- CI is configured but has not run remotely. No commit, push, avatar purchase, cloud deployment, or public post has been made.

## Next milestone: complete narrated avatar pilot

### Independent Astra review completed

Following the user's request, GPT-6 Astra independently reviewed the foundation and reproduced three P2 issues: unrecorded auto-discovered CAP inputs, compiled JavaScript absent from runtime provenance, and incomplete capture validation. All three were fixed and Astra independently confirmed the fixes with all fifteen workflow tests passing. See [the review and regression evidence](ASTRA_REVIEW.md).

CAP-01 revision 2 now has a clearer service-definition hook, 126 spoken words, visible run/query instructions, and a claim/source/check table. The shared video layout is validated for shape, minimum font size, and content bounds. Final narration and timing remain unmeasured.

Final verification passed on Node 26.8.2 and the declared minimum Node 22.13.0: fifteen workflow tests, five live CAP checks, content validation, and the compiled preview. The build also passed. CI has not run remotely.

The user has since selected a stock presenter and a $5 pilot limit. The local media stage below adds durable jobs and measured narration. Remaining production work requires permitted provider access, the final stock avatar and voice, MP4 composition, and final media verification. FFmpeg and FFprobe were absent during foundation checks.

The foundation artifact remains a silent storyboard with verified technical content. A separate narrated preview now adds local audio and phrase captions. Real avatar media, the final provider voice, an MP4, and publication approval remain pending. The LinkedIn code link awaits a public repository URL.

Publishing/OAuth and persistent scheduling remain later roadmap stages. Media job resumption and local operational recovery are delivered below. The full original roadmap is preserved in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Milestone 2a: durable media jobs and narrated preview

- Recorded the user's stock-presenter choice and $5 first-video limit in `config/production.json`.
- Added a replaceable provider interface, simulated provider, and free macOS system-voice adapter. No live avatar adapter or paid request is enabled.
- Added SQLite job state, exclusive single-host worker leases, persisted submission intent and provider IDs, reconciliation for uncertain submissions, bounded polling, and resumable packaging.
- Added per-episode spending reservations and idempotent job creation. Unknown submissions retain their reservations; simulated budgets are isolated from production spending.
- Generated CAP-01 local narration: **57.468 seconds**, with a **2.094-second hook**, nineteen separately recorded phrase cues, and measured scene timing. The preview uses the audio clock for scene and caption synchronization.
- Added narrated HTML, WAV, WebVTT, timing JSON, and a hashed media receipt. Recorded audio can be packaged again without submitting a new provider job.
- Added a localhost review server with byte-range support. Browser testing caught and resolved seeking restarting at zero under the earlier generic server; the project server now seeks and resumes at the selected scene.
- Added recovery, spending, WAV, caption, package-reuse, and server tests. The current suite has twenty-five workflow tests, in addition to the five live CAP assertions.

The local voice is a temporary timing preview and cost $0. Provider discovery again found the returned avatar/video connectors disabled by the workspace administrator. A permitted provider connection, final avatar/voice selection, and an enforceable maximum charge are needed for the real stock-avatar render. The application does not bypass the connector restriction. No MP4, external upload, public post, commit, or push was performed in this milestone.

See [media workflow and recovery](MEDIA_WORKFLOW.md) for commands, limitations, and the saved-job lifecycle.

## Milestone 2b: SAP news shorts as a second format

- Added a separate `NEWS-NN` episode contract and six-item SAP Connect news backlog. The initial roundup is draft-ready; five follow-ups need research. The original thirty tutorial topics and CAP execution checks remain intact.
- Added dated source records, claim support notes, section locators, availability categories, delivery timing, scope, and an explicit editorial-selection label. Unknown publication dates remain null.
- Added source chronology and reference validation, a maximum seven-day review window before news production, a distinct `SOURCES_CHECKED` stage, and frozen `news-evidence.json`. Automated checks validate the recorded review; they do not fetch pages or independently prove source relevance.
- Added news cards and editorial review tables to the shared vertical preview/player design. News does not show technical-verification badges or simulated product checks.
- Extended the existing narration and durable media workflow to news. Generated NEWS-01: **56.097 seconds**, **1.936-second hook**, 113 spoken words, and eighteen measured phrase captions, using the free local voice.
- Added a reusable news script template, versioned news-editor prompt, and [news authoring guide](NEWS_WORKFLOW.md).

Verification passed on the declared minimum Node 22.13.0: thirty workflow tests, five live CAP checks, formatting, type checks, content validation, and build. The news preview was checked at desktop and 390-pixel phone widths with no horizontal overflow or clipped announcement content. Playback, seeking, and the planned-release card were verified in the browser. Local narration cost $0. No new external provider, paid generation, automation, public post, commit, or push was performed.

Initial sources were read October 14, 2026: the [SAP Connect Innovation News Guide](https://www.sap.com/topics/events/connect/innovation-news-guide-2026) and its linked [SAP press release](https://news.sap.com/2026/10/sap-connect-sap-puts-autonomous-enterprise-to-work/). The preview is an editorial draft with an explicit as-of date, rather than a live feed of all current SAP news.

## Milestone 2c: shared review studio

- Added `library` to build a portable review hub for current tutorial and news drafts. The hub contains format filters, local text search, official sources, measured preview durations, production status, and the remaining topic backlog.
- Added episode navigation with an **All episodes** link above each existing narrated player. Playback files are copied locally into the library, preserving range-based audio seeking without depending on the original artifact folders.
- Added strict selection against the current episode ID, revision, and canonical editorial input. Required source artifacts, evidence, media receipts, media file hashes, WAV frames, and caption timing are checked before inclusion. Matching narrated output is preferred over a newer silent storyboard.
- Added visible recheck labels for expired news during read-only review. New media generation and unfinished-job resumption retain the existing freshness requirement. A static library preserves its build-time assessment and must be rebuilt before production.
- Hardened preview reads against symlinks escaping a run and resolved canonical directory aliases before confinement checks, including macOS temporary paths.
- Added atomic library construction, source/runtime hashes, copied artifact hashes, and selection references in `library-manifest.json`. Incomplete, altered, and mismatched outputs are excluded.

Verification passed on Node 22.13.0: thirty-five workflow tests, five live CAP checks, formatting, types, and content validation. The application build and compiled library command passed. Browser checks covered format filters, no-result search and reset, opening an episode, seeking and playing narration inside the episode frame, and returning to the library. Phone filtering and layout were checked at 390 pixels with no horizontal overflow. The library uses existing local media; it makes no paid provider call and does not publish or schedule content.

See [review studio operations](REVIEW_STUDIO.md). Avatar production and final video export remain the next production milestone requiring permitted provider access.

## Milestone 2d: warm local neural narrator

- Applied the user's warm, conversational female preference with Kokoro Heart (`af_heart`, speed 0.96). Scenes now use continuous generation and short inter-scene pauses, replacing the earlier short-phrase delivery and padded visual slots for new previews.
- Added an optional, isolated Python 3.12 setup with locked dependencies and pinned model/voice assets. Rendering runs offline on the CPU. Runtime fingerprints bind asset hashes and package versions to each saved request; cached scene audio and timing are validated before reuse.
- Kept existing system-voice jobs resumable and introduced a distinct local neural provider. Both local engines record zero spending. No paid speech service or subscription was used.
- Regenerated CAP-01: **58.730 seconds**, **2.975-second opening**, nineteen caption cues. Regenerated NEWS-01: **57.030 seconds**, **2.450-second opening**, eighteen cues. Both pass the local duration and opening checks.
- Disclosed that neural caption boundaries are model estimates. WAV duration and scene boundaries remain sample-measured. Added cache-binding, tamper, timing, text-coverage, and disclosure tests.

Verification passed on minimum Node 22.13.0: thirty-nine workflow tests, five live CAP checks, formatting, types, content validation, and build. The optional model generated both complete episodes on this Apple Silicon Mac. The rebuilt studio selects both new recordings; all eleven copied artifact hashes match. Browser checks confirmed the new voice label, 57.030-second news audio, playback, and seeking/resuming at a selected scene without a media error. A before-and-after sample uses identical opening narration without speed or level changes. The earlier independent Astra review covers the foundation; this narrator extension has not received a separate Astra review. See [voice setup and options](VOICE_OPTIONS.md).

### Built-in voice selection

The user confirmed continuing with Kokoro; Heart remains selected. Added a `voices` command listing the 28 English profiles in the pinned release, including American/British and female/male options. Selection now lives only in `config/production.json`; setup reads it directly instead of requiring a matching edit in the model specification. The synthesis pipeline follows the voice's English accent, and new preview labels identify the recorded voice rather than always saying Heart. Switching requires setup followed by narration/caption regeneration and a library rebuild; it does not train a model or call a paid speech service.

Regression checks validate supported and rejected selections and package Bella/George fixture audio with matching labels and receipts. All forty-one workflow tests and five live CAP checks passed on minimum Node 22.13.0, together with formatting, types, and content validation. The current Heart setup was rerun successfully. These fixture checks do not claim a listening evaluation of all alternate voices.

## Milestone 2e: presentation styles and two-person narration

- Added separate tone (professional/casual/comic), story format, and humor settings. Supported writing formats include explainer, dialogue, myth/fact, countdown, problem/solution, and quiz. The studio's Delivery styles section distinguishes prepared previews from formats needing a script.
- Added three CAP presentation variants alongside the original professional episode. They inherit its technical sources, claims, demo, and visuals and are bound to the base input hash. Structural overrides and stale base bindings are rejected. The studio preserves separate matching previews for each selector.
- Recorded the casual version at **49.805 seconds**, comic solo at **54.080 seconds**, and comic conversation at **58.470 seconds**. Their openings are **2.075**, **2.375**, and **2.600 seconds**, respectively. All pass local timing checks. The existing professional and news recordings remain available.
- Added two local Kokoro speakers: Mira (Heart) and Max (Michael). The renderer generates each declared turn with its assigned voice, inserts short pauses, and keeps speaker names in captions and the active-speaker badge. Names are not spoken as stage directions. Caption attribution is validated against the exact turns; timing boundaries remain model estimates.
- Added cached multi-voice installation and immutable per-job runtime snapshots. Installing a cohost does not change another job's fingerprint. Existing single-voice runtime snapshots are retained; assets and dependency versions are checked before rendering.
- Added an authoring guide, presentation-editor prompt, and `styles` command. Tone and humor affect authored scripts and visual accents; the application does not claim automatic rewriting, emotional voice controls, finished cartoon characters, or final avatar animation.

Verification passed on minimum Node 22.13.0: **46 workflow tests**, five live CAP checks, formatting, types, content validation, and build. Regression coverage includes base/evidence preservation, variant separation, unknown/missing speakers, duplicate voices, caption attribution, stable cohost installation fingerprints, and altered runtime snapshots. The five-preview library has 26 matching artifact hashes. Browser checks confirmed comparison links, dialogue playback/seeking, and matching active-speaker labels and captions for Max and Mira. Both the style library and dialogue player fit a 390-pixel phone viewport without horizontal overflow; the viewport override was reset. All generation remained local and recorded $0. Final MP4 composition and avatar production remain pending.

## Milestone 3a: verified vertical MP4 exports

- Added `render EPISODE_ID` to compose 1080 × 1920 H.264/AAC MP4s from matching, verified narration packages. It handles technical tutorials, dated news cards, and two-person Kokoro dialogue without another speech request or paid provider call.
- Added native Canvas frames using bundled, hash-pinned DejaVu fonts with required license notices. Frames use the saved pixel layout, registered source code, and recorded HTTP results. Text wraps by measured width; oversized content fails instead of clipping. Long headlines can reduce to a readable 56-pixel minimum in the default layout.
- Added visible captions and speaker badges on a 30-fps timeline, retaining model-estimated caption boundaries. Added two-pass loudness normalization, output loudness checks, FFprobe format/duration/frame checks, and full FFmpeg decoding before readiness.
- Added content-derived export keys, atomic manifests, worker locks, recovery for confirmed stopped workers, diagnostic logs, cached verified output, artifact hashes, standalone video review/download pages, and companion drafts. Matching CAP source commits supply an immutable code/setup link.
- Added MP4 selection to the review library. Only intact exports for the exact script and selected narration are offered. Portable libraries include the video, poster, captions, timing, and companion post. Earlier narrated players remain available.

Generated and checked two exports locally with FFmpeg 9.0.2:

| Export | Duration | Audio | File size |
| --- | --- | --- | --- |
| CAP-01@duo | 58.470 seconds | -16.35 LUFS; -4.43 dBTP | 2.50 MiB |
| NEWS-01 | 57.033 seconds | -16.13 LUFS; -4.50 dBTP | 2.40 MiB |

Both use 1080 × 1920 video at 30 fps with AAC 48 kHz stereo. The CAP export cache was exercised without re-encoding. Extracted frames from the actual MP4s were inspected for source code, long URL wrapping, captured results, news availability, and captions. The studio lists two verified MP4s; all 38 saved library artifact hashes match. Browser checks confirmed video dimensions, complete readiness, playback, native seeking, and no media error. The MP4 review page fits a 390-pixel viewport without horizontal overflow, and the viewport override was reset.

Verification passed on minimum Node 22.13.0: **53 workflow tests**, five live CAP checks, formatting, types, content validation, and build. New regressions cover frame timing/gaps, output codecs and missing streams/durations, silent audio, measured wrapping and overflow, every news-card layout, altered/escaping video files, and selecting only matching exports. Source and generated media remain separate; no paid generation, avatar animation, or publishing was performed. See [video export and recovery](VIDEO_EXPORT.md).

## Milestone 3b: independent review, recovery, and job discovery

- GPT-6 Astra independently audited the narration/presentation/export extension,
  reproduced three P2 defects, and verified the focused fixes. See the dated
  [review evidence](ASTRA_REVIEW.md).
- Confirmed free local requests can recover missing/altered source artifacts or
  completed packages through linked attempts while preserving historical jobs.
  Unknown submissions keep their conservative reconciliation path.
- New requests record a narrow synthesis implementation fingerprint in their
  cache identity and scene inputs. Changed generators stop unfinished work.
  Unfinished legacy requests need a fresh local attempt; completed recordings
  remain available for review and repackaging.
- MP4 selection now matches actual selected audio bytes, timing, and captions.
  Repackaging corrected narration no longer offers an older video as a match.
- Added `jobs [SELECTOR]` to discover saved jobs, voices, styles, recorded costs,
  script/settings differences, legacy fingerprints, review paths, and recovery
  commands without advancing work or generating speech.

Verification passes on minimum Node 22.13.0: **56 workflow tests**, five live CAP
checks, formatting, types, content validation, and build. Astra independently ran
26 focused tests and repeated its corrected-audio reproduction. Overnight work
continues under the bounded [work plan](OVERNIGHT_WORK.md).

## Milestone 3c: one-command local production

- Added `produce SELECTOR [--serve]` to check prerequisites, verify content,
  resume/reuse narration, enforce measured timing, render a verified MP4, and
  build a studio with the exact selected media job. Heart → Bella → Heart no
  longer risks selecting a newer recording of the wrong narrator.
- Added atomic production reports, specific blocked outcomes, preservation of
  completed outputs on failure, and `production-status SELECTOR`. Serving starts
  after readiness and cannot turn an otherwise complete package into a failure.
- Added compatible completed-speech reuse for visual/editorial-only revisions.
  Reuse copies verified bytes into an independent package, records hashes and its
  source job, recovers after a crash without the donor, and rechecks copied bytes
  before packaging. Changed speech, voice, speed, model, or generator cannot reuse
  that audio. Separate artifact roots retain separate jobs and packages.
- Stabilized immutable demo links/cache identity across unrelated commits. The
  selected commit must match every registered source byte, belong to the expected
  repository, and be reachable from an origin tracking reference.

Minimum Node 22.13.0 checks pass: **65 workflow tests**, five live CAP assertions,
formatting, types, and content validation; build passed. Astra independently ran
the production/library/video tests and reproduced both audio-reuse fixes and the
source-commit cases. Local end-to-end production reached `READY` with the
58.470-second Heart/Michael conversation. A later run copied the completed speech
without synthesis and produced another verified MP4/studio. Browser verification
confirmed 1080 × 1920 video, playback, and no media error. See
[production workflow](PRODUCTION_WORKFLOW.md).

## Milestone 3d: complete style videos and comparison studio

- Exported all four CAP styles with current local narration: professional,
  casual, comic, and conversation. Together with the existing SAP news video,
  the studio now offers five verified MP4s and five narration previews.
- Added a compact comparison above the episode grid with recorded voice labels,
  measured duration, explicit readiness, saved posters, and primary Watch MP4
  links. It distinguishes unrecorded, timing-review, narration-only, and expired
  saved-media states. Heart remains the default; the conversation keeps Heart
  and Michael.
- Ordinary fragment links preserve the selected style through MP4/narration
  review and browser history. All panels and media links work without JavaScript;
  inert search/filter controls remain hidden. Added a visible keyboard focus
  outline, a phone layout, and a video link from narrated review pages.
- Astra found and reproduced a history bug when returning to the initial
  address. Deterministic selection now restores the correct panel; a regression
  executes the actual page script across Back/Forward.

| CAP style | Video duration | Integrated audio | True peak |
| --- | --- | --- | --- |
| Professional | 58.733 seconds | -16.15 LUFS | -4.45 dBTP |
| Casual | 49.805 seconds | -16.16 LUFS | -4.35 dBTP |
| Comic | 54.080 seconds | -16.05 LUFS | -4.45 dBTP |
| Conversation | 58.470 seconds | -16.31 LUFS | -4.41 dBTP |

All use 1080 × 1920 H.264/AAC at 30 fps and pass decoding/audio checks. The
library's 56 copied artifact hashes match. Minimum Node checks pass: **69 workflow
tests** and five CAP assertions, formatting, types, validation, and build. Astra
independently passed the focused tests and verified the history correction.
Browser checks covered keyboard selection, Back/Forward, saved-video return,
poster loading, 390-pixel layout with no horizontal overflow, and a separate
script-disabled fixture. The temporary viewport override was reset.

## Milestone 3e: listen, choose, and produce with Kokoro

- Added `voice-audition [VOICE_ID...]` for up to three identical-text samples,
  rendered sequentially with the existing local neural speech implementation.
  Samples bind text, pronunciation, voice, speed, runtime, and generator. Their
  completed directories publish atomically; corrupt, incomplete, and outdated
  samples are excluded. Failed attempts retain diagnostics outside playable
  samples and print the exact directory.
- Added `voice-select VOICE_ID`, which validates and atomically changes only
  the global narrator. It performs no setup or generation. `voices SELECTOR`
  explains the effective voices and the exact configuration or presentation
  file to edit. Heart remains selected; authored variant speakers are preserved.
- Added a static Narrators section with native sample players, profile/accent,
  measured duration, speed, default label, and selection/setup instructions.
  Samples copy into the portable studio, with hashes in its manifest. Native
  controls load duration metadata and never autoplay.
- Astra independently verified selection, cache pinning, corrupted audio,
  portable copies, and two concrete fixes: runnable instructions with more than
  three installed voices, and preserved failure logs.

Minimum Node 22.13.0 validation passes: **74 workflow tests**, five live CAP
assertions, formatting, types, content validation, and build. Real local samples
measure Heart **10.350 seconds** and Michael **11.300 seconds** at speed 0.96.
The studio retains five valid MP4s and all **58 copied artifact hashes** match.
Browser checks confirmed both durations, error-free muted playback, paused
handoff, working selection instructions, and a 390-pixel layout without
horizontal overflow. This was a silent playback/structure check; no subjective
listening evaluation of the new passage is claimed.

## Milestone 3f: a second verified CAP lesson

- Added CAP-02, “Seed and query local CAP data,” following Astra's content plan
  and current official CAP initial-data/OData documentation. Its seven scenes
  show the exact registered CSV, all three products ordered by title, and the
  already-asserted combined stock-filter/select/order query.
- Ran the local verifier before promoting CAP-02 in the thirty-topic backlog,
  then the ordinary episode verification and full production workflow. The
  script and companion draft distinguish initial versus development-only data,
  preserve the returned-ID caveat, and label new filters as viewer exercises.
- Video review exposed a presenter-card sentence specific to the first pilot.
  Tutorial opening cards now display their current episode title. A Canvas
  regression verifies that changing the tutorial title changes the opening,
  even with identical overlays/captions. The recorded audio was reused when
  rerendering the corrected video.

The Heart recording measures **53.655 seconds**, a **2.350-second opening**, and
eighteen estimated caption cues. Its 1080 × 1920 H.264/AAC MP4 measures 53.667
seconds, -16.11 LUFS, and -4.44 dBTP; complete decoding and audio checks pass.
The studio retains all prior styles/news and voice samples, with **six MP4s and
69 matching copied artifact hashes**. Browser QA confirmed the new card/search
path, correct opening, native video metadata, paused state, and a 390-pixel phone
layout without horizontal overflow. CSV and filtered-result frames were also
inspected directly. The viewport override was reset.

Minimum Node 22.13.0 checks pass: **75 workflow tests**, five live CAP assertions,
formatting, types, validation, and build. Astra independently validated claims,
exact displayed URLs, saved live evidence, and the title regression/news frames.
See [the CAP data lesson](CAP_DATA_TUTORIAL.md).

## Milestone 3g: downloadable episode packages

- Added ZIP downloads to verified studio cards and video pages. Each package
  contains the exact selected MP4, poster, captions, companion draft, portable
  review, measured transcript/timing, source notes, README, and a hashed manifest.
  The saved narrator and speaker assignments are independent of today's default.
- Generate packages directly from the library's validated byte buffers. Selector,
  source, narration, timing, caption, render, and media-job identities must match.
  No separate latest-package cache or new production stage is needed.
- Dated news retains its reviewed/valid-through dates and availability notes.
  Expired reviews produce saved-package labels and extracted recheck warnings;
  packaging never refreshes sources or publishes a post.
- Pinned the portable, dependency-free `fflate` 0.8.3 ZIP implementation after
  checking its official documentation and published metadata. MP4/PNG bytes are
  stored without recompression. Local configuration, runtime, and paths are omitted.
- Astra reproduced a malformed-export recovery issue in the initial version.
  Shared receipt validation now excludes the candidate before selection, so the
  studio can choose another intact export or preserve narration. Its independent
  replay and twelve focused checks passed after the fix.

Minimum Node 22.13.0 checks pass: **79 workflow tests**, five live CAP assertions,
formatting, types, validation, and build. All six real ZIPs passed independent
Python CRC/member-hash checks; all **75 library artifact hashes** match. A real
browser download matched its saved SHA-256 and ZIP content type. The extracted
CAP-02 review loaded its own 1080 × 1920 video independently of the original
studio. Phone card/download links fit at 390 pixels; the override was reset.

## Milestone 3h: Joule Work announcement short

Added NEWS-02, a focused SAP Connect short about Joule Work's interface,
Knowledge Graph context, and managed activation through SAP for Me. The October
15 review checks the official October 6 release and Connect guide. Claims retain
rollout/selected-customer limits; the script does not imply universal access or
customer-specific eligibility. All news video frames now display the source-review
date, with a Canvas regression covering a headline frame.

The Heart recording measures **53.980 seconds**, with a **2.200-second opening**
and eighteen estimated caption cues. The vertical MP4 passes full decoding and
audio checks at -16.16 LUFS and -4.44 dBTP. The studio retains seven MP4s, seven
download packages, and both voice samples. All **87 artifact hashes** and every
ZIP's CRC/member hashes pass independent verification. Browser metadata and a
390-pixel phone layout pass; playback remains paused and the viewport is reset.

Minimum Node 22.13.0 checks pass: **80 workflow tests**, five live CAP assertions,
formatting, types, validation, and build. Astra independently reviewed the dated
claims and source locators. An initial local scene hit the existing 24-second
limit; retrying resumed the same saved job and completed without resubmission or
cost. Astra recommends a bounded local timeout adjustment as the next fix.

## Milestone 3i: reliable local narration deadlines

Kokoro scene rendering now has a 60-second allowance with a 65-second outer
poll/audition budget. Submission, lookup, other providers, and explicit overrides
retain their limits. Cancellation kills only the disposable rendering process,
waits for its close, and retains the job lease during cleanup. A deadline cannot
be mistaken for success when a late result arrives. Setup/download behavior is
unchanged, and interrupted jobs retain same-job recovery without resubmission.

Structured failure reports include elapsed/allowed time, process/exit/signal
details, and captured output; errors print the exact report path. Official Node
source and a failing regression exposed that execFile's AbortSignal path does
not forward its killSignal setting. Explicit rendering cancellation addresses
that behavior and is tested with a SIGTERM-resistant child, pre-aborted signals,
spawn failure, and confirmed process exit before retry.

Minimum Node 22.13.0 checks pass: **83 workflow tests**, five live CAP assertions,
formatting, types, validation, and build. Astra independently passed 27 focused
tests and subprocess scratch checks. Real Heart and Michael auditions completed
sequentially with no timeout; Heart remains selected. A library rebuild preserves
all seven completed MP4s/packages and two current voice samples; all 87 hashes
match. No paid call or publication occurred.

## Milestone 3j: a verified CAP prediction challenge

Added `CAP-02@quiz`, using Astra's seven-scene question/reveal script and Heart.
The starting CSV and three-row query precede the answer; the reveal keeps the
keyboard (12) and dock (7), excludes the zero-stock monitor arm, and retains the
ID caveat. Sources, claims, checks, captures, exact URLs, and timing slots are
inherited from CAP-02. A companion post is included in the new episode package.

The format gallery now derives readiness from actual prepared entries and links
to recorded examples. It distinguishes unprepared formats, scripts awaiting a
preview, narrated previews, MP4s, and expired saved examples. The four-style
CAP-01 comparison is retained.

The new recording measures **53.005 seconds**, a **2.905-second opening**, and
seventeen estimated caption cues. Its vertical MP4 passes full decoding/audio
checks at -16.08 LUFS and -4.47 dBTP. All eight ZIPs passed CRC/member-hash checks;
the final studio has **99 verified artifact hashes** and two current voice samples.
Prediction/reveal frames, native video metadata, gallery links, and the 390-pixel
phone layout were checked. Playback remains paused; viewport overrides reset.

Minimum Node 22.13.0 checks pass: **85 workflow tests**, five live CAP assertions,
formatting, types, content validation, and build. Astra independently passed
seventeen focused tests and reviewed the factual answer/evidence correspondence.
The normal repeat production reused the same narration and verified MP4.

## Milestone 3k: reusable script workshop

- Added **Revise script** to studio cards, including scripts without recordings.
  The static workshop edits title, narration, headlines, and companion copy while
  keeping format, speaker assignments, scene order/timing, visuals, claims, and
  source dates fixed. Dialogue edits preserve turns and derive joined narration.
- Added live word counts, opening/pacing guidance, clear unmeasured-audio status,
  official sources and claims, accessible labels/focus, responsive layout, and a
  readable original-script/no-JavaScript fallback. Changes remain in the page
  until explicitly downloaded under a new version name.
- Added `script-import JSON_FILE`, sharing the existing variant contract. It
  validates the current base before writes, caps regular input files at 1 MiB,
  refuses symlinks and existing targets, and atomically creates complete files.
  Imported revisions receive no existing media readiness and print a production
  command. Validation preserves evidence structure; wording still needs review.

Minimum Node 22.13.0 checks pass: **96 workflow tests**, five live CAP assertions,
formatting, types, validation, and build. Tests execute the actual workshop script,
check HTML/script-boundary escaping, and cover stale/structural/invalid imports,
collisions, concurrent imports, and failure cleanup. Astra independently reviewed
the editor and passed fifteen focused tests.

Real browser downloads for solo, dialogue, and dated news imported successfully.
The solo's changed narration produced a **53.233-second** verified MP4 and ZIP
(-16.09 LUFS, -4.42 dBTP); browser metadata confirmed its new title and paused video.
The temporary test variant was preserved under ignored overnight evidence after
the full workflow. Final studio retains eight prepared MP4s/packages, eight
workshops, two voice samples, and **107 matching artifact hashes**. All ZIP CRC and
member hashes pass. Keyboard focus, duplicate-name blocking, and phone width were
checked in browser; viewport restored. No money was spent or post published.

## Milestone 3l: conversational SAP news

Added `NEWS-02@duo`, a casual Joule Work briefing with Mira (Heart), Max (Michael),
and light humor. Astra planned the questions/answers, and both official sources
were reread. The 108-word script keeps beginning rollout, selected-customer use,
managed activation, and organization-specific access qualifications distinct.
Its news dates, claims, availability cards, sources, and scene inputs are inherited.
The companion draft identifies fictional AI hosts. The gallery links to both
tutorial and news conversations; the existing CAP comparison remains intact.

The local recording measures **57.005 seconds**, with a **2.530-second opening**
and nineteen estimated caption cues attributed to Mira/Max. Full MP4 decoding and
audio checks pass at -16.21 LUFS and -4.43 dBTP. Rendered frames show the correct
speaker switch, dated source footer, and rollout/scope cards. Browser metadata
and the 390-pixel phone layout pass; no audible playback or subjective listening
assessment is claimed. The news dialogue's real workshop download imported with
all evidence, scene inputs, dates, and speakers preserved.

Minimum Node 22.13.0 checks pass: **98 workflow tests**, five live CAP assertions,
formatting, types, validation, and build. Astra independently passed sixteen
focused tests and found no blocker. The studio has nine prepared MP4s/packages,
nine script workshops, two voice samples, and **120 matching artifact hashes**;
all ZIP CRC/member hashes pass. Heart remains the default; everything is local
and unpublished.

## Milestone 3m: export recovery and consistency boundaries

Astra's broad review reproduced four issues using temporary copies. The studio
now requires captions to match validated timing exactly, and shared video quality
checks require real successful flags, bounded finite duration, and agreement with
selected narration. Invalid candidates fall back to valid previews instead of
becoming downloadable packages.

Damaged READY exports can now recover under their lock: previous attempt files
and diagnostics move to a named recovery directory, then the renderer rebuilds
from saved speech. Earlier recovery directories and the active lock/gate remain.
Foreign full render keys and redirected cache directories are refused. Moving
symlinks themselves prevents repair writes from following their former targets.

Astra also reproduced two stale-lock observers deleting a newly acquired live
lock. A per-cache SQLite immediate transaction now serializes acquisition,
recovery, rendering, and release. It adds no dependency or lease table and closes
even when PID-lock release fails. Process termination releases the gate. Astra's
controlled replay now records one stale observer and one live lock; the competing
attempt is blocked before it can delete anything.

Minimum Node 22.13.0 checks pass: **109 workflow tests**, five live CAP assertions,
formatting, types, validation, and build. Tests cover contradictory caption text
and timestamps, malformed quality metadata, exact narration selection, recovery
preservation, symlink boundaries, real competing processes, and killed-owner
release. Astra independently passed ten focused cache/receipt checks.

A real isolated FFmpeg test copied the saved news dialogue, rendered it, damaged
only that scratch MP4, and repaired the same key/media identifier. Original and
copied narration hashes stayed unchanged. Quarantine retained the damaged bytes
and previous READY receipt; repeat rendering reused the repaired video. Full
decode/audio checks pass, and its rebuilt ZIP passed independent CRC/member
hash verification. Original media and the production jobs database were untouched.

## Milestone 3n: narrator choices for script revisions

The script workshop now offers a labeled voice selector for each existing
speaker. It changes only the new revision's speaker voices, preserving names,
turns, format, evidence, and the project default. Conversations require distinct
voices. The saved-samples link opens a labeled new tab, preserving unsaved edits.

Options come from a read-only, streamed hash check of the pinned local model,
configuration, and individual voice assets. Missing originals remain selected
with setup guidance; damaged alternatives are excluded. No installation,
synthesis, or runtime-snapshot write occurs during discovery. Import stays
portable; actual production rechecks its environment and asset bytes.

Minimum Node 22.13.0 checks/build pass: **119 workflow tests** and five live CAP
assertions. Astra independently reviewed the implementation and passed focused
checks. Browser checks cover solo selection, duplicate/swapped conversation
voices, native JSON downloads, preserved draft while opening samples, keyboard
focus, and 390/1280-pixel layouts without horizontal overflow.

A real browser-saved Heart-to-Michael CAP data revision imported and produced a
59.633333-second MP4 with a 2.725034-second opening, full decode/audio success,
-16.45LUFS and -4.37dBTP. Its narration differs from the original Heart recording;
the original audio remains intact and Heart remains the default. A browser-saved
news conversation with swapped voices imported with every source, claim, news
date, speaker name, and turn unchanged. Temporary test revisions remain outside
prepared content. The final studio retains nine MP4s/packages/workshops and two
voice samples, with 120 matching hashes and all ZIP CRC/member hashes checked.

## Milestone 3o: myth versus fact news delivery

`NEWS-02@myth-fact` adds a professional Heart delivery about distinguishing a
Joule Work announcement from an organization's access. Parent and Astra reread
the official release and innovation guide. The new script keeps the existing
sources, claims, rollout/activation qualifications, source-review dates, visuals,
and planned scene timings. The gallery automatically offers its MP4 and workshop.

Real production measured 57.505167 seconds, a 2.925034-second opening, and 18
caption cues; full decode/audio checks passed at -16.17LUFS/-4.49dBTP. A native
workshop download imported with all sources, claims, dates, scenes, and speakers
preserved. The inherited review window accepts October 22 and rejects October 23.
Phone and desktop review/gallery layouts have no horizontal overflow. No audible
playback or subjective listening assessment is claimed.

Visual review also found tutorial copy on news presenter cards. News now uses
“Official sources. Availability and scope.” and “Official sources in the post.”
Tutorial text and named conversation introductions remain unchanged. Before/after
frame comparisons confirm those boundaries; actual corrected context and CTA
frames were inspected. All four prepared news videos were refreshed sequentially
from unchanged saved narration jobs and WAV hashes. Earlier MP4s remain intact.
The final studio and ZIPs select the corrected exports.

Minimum Node 22.13.0 checks/build pass: **119 workflow tests** and five live CAP
assertions. The prepared studio has ten MP4s/packages/workshops, two voice samples,
and **133 matching hashes**. All ZIP CRC/member hashes pass, including an explicit
check that each news ZIP contains its corrected selected MP4. No paid generation,
stock-avatar rendering, or publishing was performed.

## Milestone 3p: a numbered CAP recipe

`CAP-01@countdown` adds a Heart-narrated three-step recipe: define Products,
expose InventoryService, then run the checked stock query. Its later full-list
capture is explicitly identified as all three products. Technical claims,
sources, commands, captures, and planned timing remain inherited from CAP-01.
Parent reread the official service and SQLite guides; Astra independently reviewed
the wording and preservation of the demo inputs.

The original four-style comparison now uses one shared ordered selector list for
membership and return links. Numbered guides and custom CAP revisions remain
ordinary cards/gallery examples and return to the episode list, preserving the
four original choices. A regression covers both narration and video navigation.

Full minimum Node 22.13.0 checks/build pass: **120 workflow tests**, five live CAP
assertions, formatting, types, and content validation. Astra independently passed
twelve focused studio/history/presentation checks. Real production measured
56.105125 seconds, a 2.675011-second opening, and eighteen caption cues, with full
decode/audio checks at -16.13LUFS/-4.44dBTP. The studio has eleven MP4s/packages/
workshops, two voice samples, and 146 verified hashes. All ZIP CRC/member hashes
pass. A native ZIP download matches the selected package and MP4; a native script
download imports with the same technical inputs, scenes, format, and speakers.

Phone playback fits 390px and remains paused until requested. The numbered
model/service/query frames and the full-list result were visually inspected.
Astra is planning a separate improvement to existing code-line wrapping, which
currently can split identifiers and quoted paths across visual lines. Earlier
artifacts remain intact. No audible playback or subjective listening assessment
is claimed.

## Milestone 3q: readable code lines

Video code panels now prefer whitespace boundaries instead of splitting every
line by character. Quoted paths and keywords stay together when they fit; long
URLs and other oversized tokens still wrap by Unicode code point. Indentation,
repeated/trailing spaces, and blank lines are preserved. Prose, fonts, and height
checks retain their existing behavior; an oversized glyph is rejected.

Astra implemented the bounded change and thirteen focused checks passed. Parent
review and full minimum Node 22.13.0 checks/build pass: **125 workflow tests** and
five live CAP assertions. Regressions exercise actual service/schema/CSV sources,
quoted paths, exact character reconstruction, long URLs, Unicode, whitespace,
prose behavior, and source-height rejection. Controlled before/after rendering of
21 news frames produced identical bytes; the Kokoro generator fingerprint stayed
unchanged.

All seven prepared tutorial MP4s were refreshed sequentially from their saved
jobs and audio. Every original MP4 and WAV hash remains intact. The rebuilt
studio and each tutorial ZIP select the new verified export. All eleven packages
pass CRC/member hashes and 146 studio artifact hashes match. Actual service and
query frames were inspected; the paused browser video was sought to 25.247s using
native controls and checked at desktop and 390px phone widths. Paths and keywords
remain whole in the displayed service code. No audible playback, speech
regeneration, or subjective listening assessment was performed.

## Milestone 3r: whole-studio handoff

Added `library-package LIBRARY_DIRECTORY` to save a complete existing studio as
one ZIP. Astra planned and implemented the bounded archive module and nine
meaningful regressions; parent reviewed its inventory, file reads, and output
handling. The command checks the supported saved manifest, derives the exact
playback inventory, rejects symlinks and unexpected paths, checks regular files
and sizes before loading media, and verifies every saved hash. Unlisted files
are excluded. Separate atomic output prevents archive self-inclusion and keeps
the original library untouched. The supported limits are 4,096 artifacts, a
1 MiB manifest, and 512 MiB of input bytes.

The download page and archive README explain extraction, local serving, script
import requirements, and dated-news rechecks. The original manifest and all
studio bytes remain exact; packaging does not renew factual review. A separate
integrity receipt records original-manifest, archive, and member hashes. No
current content/configuration rebuild, narration, or transcoding is needed.

Full minimum Node 22.13.0 checks/build pass: **134 workflow tests** and five live
CAP assertions. The real 84.0 MiB archive contains 148 members, including the
original manifest and all 146 studio artifacts. Independent extraction verifies
every hash, eleven nested ZIPs, eleven workshops, and two voice samples; all 231
relative links across 45 HTML files resolve inside the extracted studio.

The native browser ZIP download matches the archive hash and ZIP content type.
The extracted studio's conversation video loads, seeks while paused, and keeps
comparison selection on return. Both samples load with their saved durations;
an extracted episode download matches its source ZIP. A workshop revision with
Michael imports with unchanged base/scene content, while global Heart remains
selected. Desktop and a 324px narrow page fit without horizontal overflow.
Viewport overrides were reset, temporary extraction tabs/servers closed, and
the original studio remains available. No audible listening pass is claimed.

## Milestone 3s: date-aware saved news

Newly assembled news cards, narration/watch pages, MP4 players, workshops, and
episode ZIP players now share a source-review notice. Fixed as-of and inclusive
valid-through UTC dates remain visible without JavaScript. A small local date
check changes the notice to **Source recheck required** after expiry, or a
conservative date/clock warning when the window is uncertain. Media readiness,
playback, downloads, editing, original source dates, and source claims remain
independent of that notice. Nothing fetches sources or renews factual review.

The check runs on load, page return, and once per visible minute. Known expired
states remain expired after clock rollback; expiry observed during a page session
is sticky in that session. Repeated decoration can promote a matching notice to
expired while preserving other review windows. Whole-studio ZIP construction
still copies the chosen snapshot exactly; older archives remain unchanged.

Astra planned and implemented the shared helper, then independently reviewed the
integration. Its marker-free player reproduction is fixed by decorating copied
HTML without relying on the return-link marker. Matching existing notices can
also be promoted without changing dates. Restrictive copied-player policies
permit the exact date-check script by SHA-256; existing media and script policies
retain their behavior. No narration or video rendering was needed.

Full minimum Node 22.13.0 checks/build pass: **147 workflow tests** and five live
CAP assertions. Focused regressions cover inclusive expiry, UTC offsets, leap
dates, invalid dates/clocks, overnight updates, sticky expiry, no-script guidance,
script hashes, idempotence, marker-free players, and all news entry points. A
controlled same-time rebuild preserves all **91 tutorial files**, all **24 saved
MP4/WAV/sample files**, all original inputs, and the Kokoro generator fingerprint.

The final studio retains eleven MP4s, eleven episode ZIPs, eleven workshops, two
voice samples, and **146 matching artifact hashes**. Its 148-member whole-studio
ZIP passes independent extraction, all member hashes, eleven nested ZIP checks,
and 231 confined links across 45 HTML files. Native downloads match the archive
and selected episode ZIP. Extracted players run their date checks and load media
without CSP errors; native seeking remains paused. Style return selection and a
news workshop download/import preserve scenes, claims, sources, dates, and Heart
as the default. Desktop 1280px and phone 390px fit without overflow. A separate
known-expired fixture verifies conservative rollback behavior in the real browser.
Temporary test tabs and servers were closed; viewport overrides were reset.
No audible listening pass, paid generation, or publication occurred.

## Milestone 3t: review and restore script changes

The script workshop now offers an optional **Review changes** panel before
download. It compares the same normalized draft that will be saved with its
starting script, including invalid edits. Changed titles, voices, scenes, and
companion posts show Original and Revised wording. Each section can be restored
without losing the version name or other edits. Scene restore includes its
headline and all narration/dialogue turns; starting voices restore together.

Astra planned the feature, implemented the browser behavior and focused tests,
and reviewed integration boundaries. Content is rendered as literal text, the
panel stays open during editing, restored inputs receive focus, and unchanged
draft reads preserve review controls. Invalid scripts and duplicate dialogue
voices still block download. Source claims, dates, base identity, and the global
Heart default remain fixed.

Full minimum Node 22.13.0 checks/build pass: **152 workflow tests** and five live
CAP assertions. Real-browser checks cover keyboard access, solo and conversation
restores, invalid edits, duplicate voices, literal markup, a long multiline post,
and desktop/390px layouts. Three native downloads import into an isolated test
folder with exact base identities, sources, claims, dates, and expected edits.

A controlled same-time rebuild leaves **135 non-editor artifacts** and all
**24 saved MP4/WAV/sample files** byte-identical. The current eleven-workshop
studio passes all 146 hashes and eleven nested ZIP checks. The 84.1 MiB whole
studio download matches its verified archive; independent extraction verifies
148 members, 231 confined links across 45 HTML files, and working comparison and
restore controls. Prior media, studios, and archives remain intact. No speech
generation, transcoding, paid cost, or publication was needed.

## Milestone 3u: complete the tutorial code handoff

Astra's finished-delivery audit checked eleven selected versions, 77 scenes and
202 cues against the saved scripts, transcripts, speaker labels, posts, and
tutorial captures. It found one handoff issue: five older tutorial snapshots
lost their public code links after newer registered dependency files changed.
Those exact eight-file snapshots already match a published source commit.

The code-link resolver now checks a bounded history of published snapshots and
requires every registered hash to match one commit. Wrong repositories,
unpublished or mixed snapshots, missing files, and lookup limits retain the
pending-link fallback. Five history regressions pass; the full minimum Node
22.13.0 checks/build pass with **156 workflow tests** and five live CAP assertions.

The five refreshed exports retain the same saved narration jobs and exact audio,
timing, captions, and MP4 bytes. Only their post's pending placeholder becomes
the matching commit URL. A controlled studio rebuild preserves **130 artifacts**
and all **24 MP4/WAV/sample files** exactly; changes are limited to five posts,
their ZIPs, and the corresponding ZIP download filenames. All prior artifacts
remain intact, and news content and source-review dates are unchanged.

The final studio passes 146 artifact hashes and eleven nested ZIP checks. Its
84.1 MiB whole-studio ZIP passes 148-member extraction, all member hashes, and
231 confined links across 45 HTML files. Native episode and studio downloads
match their source hashes. The corrected code link and AI disclosure appear in
the main and extracted studios; the refreshed conversation player loads paused
without an error. No speech generation, paid cost, or publication occurred.

## Milestone 3v: recover unfinished workshop drafts

The workshop can now recover raw edits after reloading the same browser tab at
the same address. A matching record offers **Resume saved draft** and **Start
with original** before editing or downloading resumes. Version names, wording,
headlines, companion copy, and allowed voices are restored; incomplete drafts
retain their validation errors. Starting facts, source dates, timing, and
presentation structure cannot be restored from browser storage.

Recovery uses a bounded 128 KiB session record tied to the exact editor context
and URL. Corrupt, stale, oversized, unknown-field, and invalid-voice records are
excluded. Blocked or full storage leaves editing and JSON downloading available.
Closing the tab or changing its address/input can lose recovery; the downloaded
JSON remains the portable copy. Existing recordings and global Heart stay fixed.

Astra planned and implemented the behavior and twenty focused workshop tests,
then reviewed integration independently. Real browser testing found that a
reload near the end could leave the pending choice off-screen. A finite,
guarded adjustment after page restoration now brings the choice into view.
Resolving the choice prevents later callbacks from moving focus or scrolling;
ordinary page position remains unchanged.

Full minimum Node 22.13.0 checks/build pass: **163 workflow tests** and five live
CAP assertions. Desktop 1280px and phone 390px show the entire pending prompt
without overflow, with keyboard access. Solo/conversation/news tests preserve
raw spaces, voice choices, unfinished text, validation, and source-review dates.
Targeted restores, downloads, discard/reload, and four isolated JSON imports
pass, including a recovered revision from an extracted portable studio. Blocked
storage and malformed records are covered in actual-template tests.

A controlled rebuild leaves all **135 non-editor artifacts** and **24 saved
MP4/WAV/sample files** byte-identical; only eleven workshops change. The current
studio and extracted 84.2 MiB archive pass 146 hashes, eleven nested ZIP checks,
148 archive members, and 231 confined links across 45 HTML files. The native
studio download matches its archive hash. All earlier artifacts remain intact;
no speech generation, video export, paid cost, or publication was required.

## Security boundary remediation — October 19, 2026

The legacy shared Firebase rules now require the existing editor/admin policy on
every mutable Firestore collection and documented Storage prefix. Schema validity
alone no longer authorizes a write, production ownership can no longer fall back
to `studio-browser`, worker heartbeat writes require editor authority, and the
Storage catch-all denies all access. The anonymous static bridge remains useful
for viewing public exports but is retired as an editing and production client;
the account-based private workspace is the supported remote creation path.

The private workspace rejects plaintext origins outside loopback and defaults to
a loopback listener. An explicit `0.0.0.0` listener is accepted only with a
production HTTPS origin. The local preview server now applies one mutation guard
to workflow, scripts, avatars, auditions, production, and private voice actions:
browser POSTs must use same-origin JSON before any route handler can run.
The private API accepts only its configured Host and browser Origin, preventing a
secure public configuration from also serving a direct plaintext LAN alias.

Focused API/configuration tests and the legacy Auth/Firestore/Storage emulator
test cover the original bypasses plus ordinary authorized behavior. Full local
validation passed with 262 automated tests, five live CAP checks, lint,
TypeScript, content validation, and the compiled build. The rule emulator test
also passed independently. No Firebase project, service, media, or publication
was changed by this remediation.
