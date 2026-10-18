# Private workspace implementation evidence

Plan: [accounts and registered rendering engines](FIREBASE_AUTH_CLOUD_RENDERING_PLAN.md).

Setup: [private studio runbook](PRIVATE_WORKSPACES.md).

Implemented October 17, 2026, from `main` at `ab1608b`.

## Delivered source

- Separate Firebase email/password studio with verification/reset/session flows,
  invite-only bootstrap, personal tenants and membership authorization. Existing
  offline/local studio remains usable independently.
- Private Firestore/Storage API, default-deny direct client rules, authenticated
  media playback/download, explicit upload consent, quotas and bounded uploads.
  No permanent Firebase media download tokens or private static export.
- Source-backed template scripts, revision conflict checks, frozen production
  snapshots, independent speaker voice/photo controls and generation history.
- Mac mini/MacBook registration with expiring single-use pairing and macOS
  Keychain credentials; capability registry, online/busy/stale/offline status,
  pool/pinned scheduling, drain/revoke/unregister and credential rotation.
- Outbound-only isolated worker, shared local inference gate, transactional claims,
  expiring/fenced attempts, cancellation, retry, duplicate submission prevention,
  interrupted-job recovery and account/membership/voice revocation checks.
- Workspace Qwen enrollment and auditions; owner-only samples; exact sample/runtime
  acceptance; explicit trusted Macs versus separate cloud processing consent.
  Re-auditions target the installed runtime, not a stale accepted runtime.
- Controller verifies file digests, WAV duration, full MP4 decoding, captions and
  ZIP contents against the submitted script. History reports queue wait,
  generation time, total time until ready and actual voice/device identity.
- Disabled Cloud Run Jobs adapter with durable outbox, globally serialized launch,
  bounded allocations, ambiguous-response protection, scoped attempt credentials,
  pinned Qwen CUDA/alignment environments and non-root container recipes.

The model-dependent tests use a **synthetic Kokoro Heart reference**. No user voice
or portrait was uploaded to a live Firebase project. Existing local Moty profiles,
photos, drafts and videos were preserved and excluded from new commits/builds.
No production deployment or paid compute was started.

## Checks and actual local evidence

Runtime: Apple Silicon Mac, Node **22.13.0**, Java **21**, installed FFmpeg,
existing Kokoro/MLX Qwen model installations. Ordinary tests do not need models.

| Check | Result |
| --- | --- |
| `npm run check` from a source-only staged checkout | Passed: lint, typecheck, **242 unit tests**, CAP demo checks and content validation |
| `npm run build` | Passed |
| `npm run private:build` | Passed |
| `npm run private:test:integration` | Passed against real Auth/Firestore/Storage emulators: verified login, bootstrap, save, cross-account/forged/anonymous denial; unverified, uninvited and disabled accounts denied |
| Direct Firestore/Storage REST rules checks | Existing objects deny read/write to anonymous, owner and unrelated signed-in clients (12 requests) |
| Compiled API + compiled isolated stock worker | Real 47.730-second episode completed; video/audio/VTT/ZIP verified |
| Workspace Qwen audition and full episode | Real synthetic sample enrollment, private storage, audition, runtime acceptance and 45.300-second episode completed |
| Disposable macOS Keychain helper | Put/get/delete round trip passed; secret sent via stdin, never command arguments |
| CUDA scripts | Python syntax compilation passed; Linux/Python 3.12 hash-locked dependencies resolved independently for TTS and alignment |
| Production Node dependencies | `npm audit --omit=dev`: **0 vulnerabilities** |

The 14 new protocol tests cover tenant isolation, revision conflicts, local voice
reference rejection, pairing secrets/replay/guess limits, engine races, pinned and
busy scheduling, stale/cancelled attempts, account/device revocation, sample
ownership, runtime acceptance and re-audition, disabled paid fallback, ambiguous
cloud launches, scoped credentials, deduplication and voice deletion/transcript
erasure. The other 228 tests cover the existing local project.

Latest successful synthetic jobs (ephemeral local emulator data):

| Job | ID | Media duration | Generation | Time until ready |
| --- | --- | ---: | ---: | ---: |
| Compiled stock episode | `54b2c1da-e74b-4099-9625-f28b44410fc2` | 47.730 s | 81.796 s | 82.832 s |
| Qwen audition | `40391d7d-a21e-45db-8b74-1dfd0388bd3f` | 7.440 s | 6.747 s | 7.206 s |
| Full workspace Qwen episode | `6d5c569e-8a1c-4510-888e-67968305cd60` | 45.300 s | 81.163 s | 82.147 s |

These are single-device measurements with installed/warm local models, not
portable performance estimates. No audio/video reuse was used for either episode.
Voice identity/naturalness still needs listening review; successful decoding and
alignment do not establish that subjective quality.

During testing, early runtime staging failures were fixed before the passing stock
runs. Qwen also correctly blocked scripts outside the existing 45–60-second/3-second
opening gate. A shortened opening and additional source-supported narration were
used only in the synthetic fixture; the timing gate was retained. Timing failures
now report measured durations and explain how to revise. The source-only checkout
also kept unrelated personal variants out of content validation.

Ignored local evidence/logs are under `.state/private-tests/`; recordings, tokens
and generated media are deliberately not committed. Reproduce using the runbook.
The browser was checked for authenticated history, personal versus stock voices,
independent photo/animation controls and registered-engine availability.

## Remaining release gates and deliberate limits

- **Live Firebase activation is pending**: choose the staging project, regions,
  billing/budget and invitation list; configure IAM, email delivery, private bucket
  and hosting; run real two-account/two-device tests. Nothing was deployed.
- Mac execution was tested on this physical Mac. Mini/M5 competition is covered
  by protocol tests, but simultaneous work on two physical Macs, sleep/wake and
  external-device playback need staging evidence.
- **Docker and an NVIDIA GPU are unavailable on this Mac.** The recipes and CUDA
  adapter have not been built or benchmarked on that hardware. Keep cloud disabled
  until an explicitly budgeted image build, synthetic audition and full episode
  pass quality, memory, timing, cost and IAM checks. Realistic CUDA Ditto and cloud
  stock Kokoro remain unsupported; registered Macs support those combinations.
- TTS and forced alignment have incompatible upstream Transformers pins (4.57.3
  and 4.57.6), so the CUDA recipe has separate Python environments and hashed locks.
  The build context comes from reviewed HEAD, excludes all portrait/variant folders,
  and restores only approved stock templates.
- The first controller uses Firestore's durable outbox, not Cloud Tasks. Run the
  explicit dispatcher repeatedly through an approved scheduler after activation.
  No automatic scheduler, public publishing or paid fallback is installed.
- Media uses authenticated bounded proxy/blob delivery rather than signed URLs.
  Audio/output uploads cap at 30 MiB; workspace caps are documented in the runbook.
- Team invitation/UI, account/workspace self-service deletion, automated retention,
  legacy private-data migration, broad pagination/archiving and unattended Mac
  startup/renewal remain production-expansion work. Voice deletion is implemented.
- Full development dependency audit reports 6 advisories (3 high, 3 moderate),
  through Firebase CLI's braces/chokidar, re2 and OpenTelemetry/PubSub dependencies.
  Production dependencies have zero reported advisories. Containers omit development
  dependencies, and emulators remain loopback-only development services.

## Local preview handoff

Private studio: <http://127.0.0.1:5890>. Auth 9099, Firestore 8080,
Storage 9199, Emulator UI 4000. The signed-in synthetic account is
`creator@example.test`; the emulator-only password is in
`scripts/private/integration.ts`. A disposable local worker named **This Mac ·
local test worker** is running for this preview, without changing the real worker
Keychain registration. The original local studio remains separate.

This is test data in local emulators, not live cloud persistence. Export emulator
data explicitly if it needs to survive restarting the emulators. Do not use this
preview as the only copy of irreplaceable recordings. Real setup on each Mac uses
`worker:register` and `worker:start` as described in the runbook.
