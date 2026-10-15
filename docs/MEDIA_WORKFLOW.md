# Media workflow and recovery

The current media stage supports a simulated provider, local Kokoro neural narration, and the earlier macOS system-voice preview. It implements persisted jobs, provider IDs, submission reconciliation, worker exclusion, spending reservations, timed captions, and a narrated HTML review. It does not implement live avatar APIs or publishing.

## Pilot settings

The user selected a stock presenter and authorized at most **$5 for the first real video** on October 14, 2026. The user also selected a warm, conversational female narrator. `config/production.json` records a 500-cent pilot cap and the local Kokoro `af_heart` voice at speed 0.96. `liveProvider` remains null. No paid provider request has been made.

Provider discovery found HeyGen and the other returned avatar/video connectors disabled by the workspace administrator. The application does not route around that restriction. Connecting a permitted provider is the remaining prerequisite for purchasing avatar media; its account access, maximum charge, avatar, and final voice must be known first.

## Durable job lifecycle

```text
PLANNED → SUBMITTING → SUBMITTED → PROCESSING → PACKAGE_PENDING → SUCCEEDED
                 ↘ SUBMISSION_UNKNOWN          ↘ PACKAGE_FAILED
                       (reconcile)        POLL_TIMEOUT

Simulated completion: SIMULATED
Confirmed processing or source failure: FAILED
```

State and provider simulation records are stored in `.state/media/jobs.sqlite`. Job creation and spending reservations use one SQLite transaction. Each job holds an exclusive lease during a step. Another worker cannot process it concurrently. On the same host, a stopped process's lease can be recovered after its PID is confirmed dead. A live or unrecognized host's lease is left intact. The current store is for one local host; distributed workers, a daemon, recurring scheduling, and database migrations are not implemented.

Submission intent is persisted before calling a provider. After a lost response or a crash in `SUBMITTING`, recovery looks up the existing idempotency key. A confirmed provider ID is saved and reused. An unknown lookup leaves the job in `SUBMISSION_UNKNOWN`; the application does not guess that submission failed or send another create request. Polling calls have a bounded deadline; a timeout retains the provider ID for another `media-step`.

Completed provider output is persisted before packaging. A failed package can be retried without submitting again. `media-package` also rebuilds a completed local narration package from its recorded audio. A simulated completion is labeled separately and does not create pretend media.

The request snapshot and its hash are immutable. Matching inputs reuse the existing job. A changed script, source inventory, settings, scenario, or neural runtime fingerprint creates a new request. Preserve the database, source run, provider-output directory, and optional neural runtime together when backing up or moving work. Resume interrupted generation with the same application version; cross-version partial-audio migrations are not implemented.

## Spending records

The ledger reserves a provider's declared maximum before submission and keeps that reservation when submission is uncertain. Reserved plus recorded spending across an episode must stay within its saved cap. A repeated request does not reserve again. Simulated budgets are isolated from production budgets. Local speech quotes and records zero cents.

A future paid adapter must provide an enforceable maximum charge and accurate usage receipts. The ledger is a guard on this application's requests; it cannot prove an external provider's pricing or prevent provider-side overbilling. No current adapter spends money. Raising an existing episode's cap is deliberately not automatic.

## Narration and caption timing

`narrate CAP-01` starts from a verified preview snapshot and checks its artifact hashes. With the current settings, Kokoro synthesizes a complete scene at a time using the saved pronunciation glossary, then converts it to mono 22050 Hz 16-bit PCM. The assembler adds 0.18-second pauses between scenes, without padding to provisional storyboard slots. Audio duration and scene boundaries come from sample counts. Captions use Kokoro token-duration estimates grouped into phrases and are labeled **model timing estimates**. They do not claim forced alignment or word-level accuracy.

`voice-setup` installs locked Python dependencies and downloads the pinned Apache-2.0 Kokoro model and Heart voice to ignored `.state/neural-voice/`. Rendering uses local files with the model clients in offline mode. A runtime fingerprint binds model/voice hashes and installed dependency versions to the job. Completed scene WAVs and timing records are validated before reuse. Scenes too long for one model segment fail explicitly rather than dropping text. See [voice options](VOICE_OPTIONS.md).

The legacy `local-speech` adapter uses macOS `say` and separately recorded phrases. Its assembler pads short speech to the planned scene slots. Existing requests retain that engine and behavior even after the preferred engine changes. A new Kokoro request uses the distinct `local-kokoro` provider ID.

Both paths validate scene continuity, caption order, complete narration text, pronunciation inputs, cached audio hashes, and agreement between the timing file and WAV duration. VTT is generated from the validated cues. Complete audio chunks can be reused after interruption; package rebuilds do not regenerate speech.

The review page plays the recorded WAV and drives scenes and captions from its audio clock. Run `npm run shorts -- serve ARTIFACT_DIRECTORY` for the local player server. It binds to localhost and supports byte-range audio requests, including seeking on Safari/WebKit; a generic file server without range support can restart audio at zero when seeking. Its receipt records artifact digests, packaging-runtime digests, timing checks, and the source-manifest hash. A timing pass is a local preview check, not a final video or publishing approval.

## Commands

```sh
npm run shorts -- voice-setup
npm run shorts -- narrate CAP-01
npm run shorts -- media-simulate CAP-01 success
npm run shorts -- media-simulate CAP-01 lost-submit
npm run shorts -- media-simulate CAP-01 unknown-submit
npm run shorts -- media-simulate CAP-01 poll-timeout
npm run shorts -- media-simulate CAP-01 failure
npm run shorts -- media-status JOB_ID
npm run shorts -- media-step JOB_ID
npm run shorts -- media-package JOB_ID
```

The bounded `narrate` and simulation commands stop on completion or a state needing inspection. Use a saved job ID to resume a poll or rebuild a package. An unknown submission requires reconciliation, not a new job. Terminal processing failures and changed source snapshots remain failed.

The optional Kokoro setup has been exercised on Apple Silicon macOS with Python 3.12 and CPU inference. Its setup command requires `uv`; it is independent of `npm ci`. The legacy system adapter requires macOS and an installed voice. The fake adapter, SQLite lifecycle tests, and generated-PCM package tests run on the CI platforms without speech software or downloaded model weights. FFmpeg is still required for the future MP4 composition stage.
