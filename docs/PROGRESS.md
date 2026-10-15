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
