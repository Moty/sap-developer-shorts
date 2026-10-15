# Overnight enhancement work — October 15, 2026

Authorized window: until **7:00 AM Pacific on October 15, 2026**
(`2026-10-15T14:00:00Z`). Stop feature work by 6:45 AM for final checks.

The user authorized autonomous improvements, primary-source research, GPT-6 Astra
planning and difficult decisions, local commits, and pushes to the upstream
`codex/project-foundation` branch. Keep Heart as the default Kokoro narrator.
Do not purchase media, publish posts, merge main, or bypass disabled providers.
Keep generated media and machine state ignored. Render speech sequentially.

## Continuation

- Thread heartbeat: `sap-shorts-overnight-enhancements`, every twenty minutes
  through the deadline, including 7 AM. Read this document at each continuation.
- Sleep prevention is bounded to 7 AM. Local details are in
  `.state/overnight/awake.json`; verified both idle and AC system-sleep assertions.
  The Mac must remain powered on with its lid open and Codex running.
- At or after the deadline, pause the heartbeat through the automation tool,
  stop enhancements, and provide the final results and outstanding limitations.
- Check time between milestones. Complete and test a coherent change before
  starting another. Do useful independent work if a service is unavailable.

## Astra planning and review

GPT-6 Astra (`/root/astra_review`) is reviewing voice, presentation, and MP4
recovery/provenance paths. Its initial priorities are:

1. One local `produce SELECTOR` workflow: preflight, reuse/resume narration,
   render, rebuild the studio, and provide a usable review address. Preserve
   completed speech when only visuals change; make incomplete results explicit.
2. Production status and job discovery with clear next actions, current
   voice/style, duration, and readiness blockers.
3. Complete professional/casual/comic/dialogue MP4 comparison with compact studio
   controls. Prefer a finished comparison over expanding topics or voices.

Implement reproduced audit findings first. Ask Astra to evaluate substantial
implementation choices and independently review completed changes.

## Starting evidence

- Clean branch at `b22036a` (also pushed to upstream).
- 53 workflow tests plus five live CAP assertions passing on minimum Node
  22.13.0. Both Node 22/24 GitHub CI jobs passed for this commit.
- Five narrated previews; two verified vertical MP4s (CAP dialogue and SAP news).
- Current studio: `artifacts/library-308f2b4e-4d10-40ea-b9b3-c3b06b914948`,
  served at <http://127.0.0.1:4173/review.html>.

## Progress and next action

00:30 PT: Bounded continuation and sleep prevention established.

00:38 PT: Astra reproduced three P2 findings; implemented linked local recovery,
synthesis-code cache fingerprints, and exact audio/timing/caption matching for
video selection. Added read-only job discovery. Astra independently verified 26
focused tests and the corrected-audio reproduction. Its follow-up legacy-job
guard is included. Full minimum-Node checks pass: 56 tests + five CAP assertions,
formatting, types, content validation; build passed. Validation log:
`.state/overnight/check-recovery.log`.

The reliability milestone was committed and pushed as `6a6b7ff`; both Node 22/24
GitHub CI jobs passed.

00:56 PT: Delivered `produce SELECTOR [--serve]` and `production-status SELECTOR`,
atomic progress/blocker records, exact narrator selection through export/studio,
and independent copied-audio reuse for compatible visual changes. Astra found
two crash/tamper gaps in the initial reuse implementation; both are fixed and
independently reproduced successfully. The full minimum-Node checks pass:
65 tests + five CAP assertions, formatting, types, content validation; build
passed. See `.state/overnight/check-production.log`.

Real production and reuse both reached `READY` for CAP-01@duo, 58.470 seconds,
2.6-second opening. Latest job: `f6845a49-258e-44aa-9089-1d25753d9048`, copied
from the complete current-generator job `bfafce6f-ed02-40f3-913d-a3495dab0339`.
Latest studio: `artifacts/library-0306fd8a-dd7b-4680-8dc1-30828571618e`.
An earlier equally valid studio from this milestone is served at
<http://127.0.0.1:49853/review.html> (owned exec session 5047), with the conversation
paused and inspected in browser at 17.5 seconds. Proof:
`.state/overnight/production-review.png`. Original port 4173 still serves the
previous saved library; update the owned server to the final studio after the
comparison milestone.

Next: finish committing/pushing this production milestone, exercise its cache
after commit, then complete professional/casual/comic/duo MP4s sequentially.
Astra's UI plan: compact style tabs with actual voice and duration, explicit
readiness/primary Watch MP4, and preserve selection when returning. Keep the
studio static; offer copyable CLI commands rather than adding a write server.

The production milestone was pushed as `bfef24e`; both Node 22/24 CI jobs passed.
Its post-commit run reused the selected audio and MP4 without re-encoding.

01:19 PT: Completed the four CAP MP4s and static style comparison. Added recorded
voice/duration/readiness, posters, exact return fragments, keyboard focus,
phone layout, and no-JavaScript access. Astra found and verified the Back/Forward
fix; the actual page script now has a history regression. All 69 workflow tests,
five CAP checks, formatting, types, validation, and build pass. Evidence:
`.state/overnight/check-comparison.log`, `comparison-phone.png`,
`comparison-studio.png`, and `no-js-evidence.json`.

Current studio: `artifacts/library-bcab87f0-3d40-436a-be74-33f420e47923`, served
on <http://127.0.0.1:4173/review.html#styles>, owned exec session 91903. Five MP4s
and all 56 copied artifact hashes verified. QA no-JS server/session 52496 and
earlier intermediate port-4173 servers have been stopped. Port 49853/session
5047 still serves the earlier saved production studio; it can be stopped when
no longer useful. The main browser output is the current comparison, viewport
reset and no video autoplay.

Next: commit/push the comparison milestone and check CI. Astra is planning the
next bounded enhancement, considering local voice auditions and a safer voice
selection command (an earlier explicit user request) versus additional verified
content. Preserve Heart, and distinguish global narrator selection from explicit
presentation speaker assignments. Continue only within the original 7 AM window.

Keep this section current with changes, exact test evidence, commits, preview
locations, and the next bounded action. Do not label unverified work complete.

01:36 PT: Comparison milestone pushed as `7a30d19`; Node 22/24 CI passed.
Delivered the Astra-planned voice audition/selection workflow. `voice-audition`
records up to three profiles sequentially, `voice-select` updates only the default,
and `voices SELECTOR` explains authored speaker overrides. Static studio samples
show the same passage, accent, actual duration, speed, and current default.
Heart remains selected. Astra independently closed two findings (command length
and lost failure logs). Full checks: 74 workflow tests + five live CAP assertions,
formatting/types/validation/build on minimum Node 22.13.0. Evidence:
`.state/overnight/check-voices.log`, `voices-evidence.json`, `voices-phone.png`,
`voices-studio.png`, and the audition real/reuse logs. One local sample attempt
timed out during concurrent full checks; its diagnostics were preserved and the
sequential retry after checks completed both voices. Avoid synthesis during
heavy tests, in addition to keeping Kokoro renders sequential.

Latest studio: `artifacts/library-bbd06662-fd27-4a1b-bc61-4cadd05a9ad0`, served
at <http://127.0.0.1:4173/review.html#voices> (owned session 92959). Five MP4s,
two native audio samples (Heart 10.350s, Michael 11.300s), 58 verified copied
hashes. Muted playback loaded/advanced without errors; both players were paused
and normal viewport restored. No subjective listening pass claimed.

Next: commit/push voice milestone and check CI. Then implement Astra-planned
CAP-02, “Seed and query local CAP demo data,” using existing registered CSV,
`products`/`filtered` captures and all five demo assertions. Research current
official CAP initial-data and OData guides before writing. Existing verifier
already checks the exact displayed sort and stock>0 query; no schema expansion
needed. Do not claim $select removes ID (it remains in the captured response).
Explain db/data as this sample project's initial data; development-only data
belongs in test/data. Produce one professional Heart MP4, companion draft, and
normal studio card; update backlog after fresh verification. Keep comparison
specifically CAP-01 and preserve all prior valid artifacts. Astra has supplied a
seven-scene ~125-word/58-second draft in its latest review response.

01:48 PT: Voice milestone pushed as `12bf0f9`; Node 22/24 CI passed.
Completed CAP-02 following Astra's plan and official CAP source research.
116-word script, exact registered CSV and observed queries, three sourced claims.
Fresh five-check evidence precedes backlog promotion; normal verification passed.
Full checks pass on minimum Node: 75 workflow tests + five live assertions,
formatting/types/validation/build. Astra independently validated the claims,
exact URLs, evidence, and the generic opening-card fix discovered in browser QA.
Tutorial opening cards now use their episode title; a Canvas regression covers
the original fixed-pilot-copy bug. News/CTA logic is unchanged.

CAP-02 narration job `cf1b7a9e-fa3a-4d51-8324-ee318c028c2a`: 53.655147 seconds,
2.350023 opening, 18 caption cues. Reused that audio for the corrected MP4:
`artifacts/videos/CAP-02/video-6b77fb2fa6b40a4a/short.mp4` (53.666667 seconds,
-16.11 LUFS, -4.44 dBTP). Latest READY production report:
`artifacts/productions/82f86d3f-26c9-4dca-be79-da83669ef356/production.json`.
Current studio: `artifacts/library-4dc7fa79-53f0-4633-a3c8-0bf60539dda2`, served
on port 4173 (owned session 69851), six MP4s and 69 checked artifact hashes.
Browser currently shows CAP-02 video, paused, normal viewport. Evidence:
`.state/overnight/check-cap02.log`, `cap02-evidence.json`, `cap02-fresh-evidence.json`,
`cap02-review.png`, `cap02-phone.png`, and produce/verify logs.

Next: commit/push CAP-02 and check CI, then implement Astra's bounded episode
download package plan. Build a ZIP directly from the already validated selected
LibraryEntry while building the studio; avoid independent/latest bundle caches.
Preserve the receipt selector/voice/media identity and package verified buffers.
Include MP4, poster, captions, exact companion draft, portable review, transcript,
sources, README, and internal provenance/file hashes; exclude local paths/config.
News packages retain dated review/valid-through and conspicuous recheck notices;
bundling never refreshes sources. Use a pinned portable ZIP dependency after
checking current primary metadata (Astra found fflate 0.8.3); keep MP4/PNG stored
without recompression. Add static download links and ZIP content type. Verify
extraction/hash matching, corrupt export exclusion, voice identity selection,
expired-news notices, and portable paths. Full Astra plan is in its latest
message; request its independent review before committing the next milestone.

02:02 PT: CAP-02 pushed as `7e26ef5`; Node 22/24 CI passed.
Completed episode ZIP downloads following Astra's plan, with pinned fflate 0.8.3
confirmed from its official documentation and npm metadata (zero audit findings).
The builder uses exact selected, validated buffers and recorded narrator identity;
six static downloads contain MP4, poster, captions, exact companion draft, portable
review, transcript/timing, source notes, README and internal provenance hashes.
News preserves dated reviews/valid-through and recheck notices. No synthesis or
paid calls were needed. Astra reproduced malformed export metadata blocking the
whole library; shared candidate validation now excludes it before selection.
Its scratch replay confirms the studio rebuilds and retains narration; twelve
focused checks pass with no remaining blocker.

Full minimum-Node checks pass: 79 workflow tests + five CAP assertions, formatting,
types, validation, build. All six real ZIPs passed independent Python CRC/member
hash checks; the final library has 75 verified artifact hashes. Browser downloaded
CAP-02 to `/Users/I851396/Downloads/CAP-02-v1-6b77fb2f.zip`; that saved snapshot's
SHA-256 matches its library record and HTTP content type is application/zip.
The extracted package's video loaded from its own temporary server (53093),
independent of the original studio. QA tab 5 and exec session 19981 were closed.
Phone card/download controls fit at 390 pixels; viewport reset. Evidence:
`.state/overnight/check-packages.log`, `package-evidence.json`, `package-phone.png`.

Final studio for this milestone: `artifacts/library-55d0157b-f0b1-4f68-b0a4-7f784ff95330`,
port 4173 owned session 61726. Previous intermediate port-4173 sessions stopped.
The six existing MP4s, four CAP delivery styles, and two voice samples are retained.

Next: commit/push ZIP milestone and check CI. Then implement Astra's recommended
NEWS-02, “Joule Work: what the rollout means,” adding depth to the Connect roundup.
Use the existing seven-scene news format, three source-backed cards (interface,
Knowledge Graph context, managed activation), Heart, October 15 review, seven-day
limit, 45–60-second MP4 and ZIP. Research the current official Oct6 press release
and SAP Connect guide before writing. Distinguish beginning rollout/selected
customers from universal or customer-specific access; avoid productivity figures
and unverified setup instructions. Astra is preparing concrete claims, locator
support, availability fields and a short script; inspect its latest response.
Do not change schemas/providers or start paid generation/publishing. Continue
only inside the original 7 AM window; keep source research dated and exact.

02:18 PT: ZIP milestone pushed as `a705484`; Node 22/24 CI passed.
Completed NEWS-02, “Joule Work: rollout, context, and access,” after fresh official
release/guide research. Astra independently found no factual/layout blocker.
All news MP4 frames now show their source-review date; the added Canvas regression
covers a headline frame. Full minimum-Node checks pass: 80 workflow tests + five
live CAP assertions, formatting/types/validation/build. Evidence:
`.state/overnight/check-news02.log`, `news02-evidence.json`, `news02-review.png`,
and `news02-phone.png`. All 87 copied hashes and seven ZIP CRC/member hashes pass.

NEWS-02 job `b3237904-94b0-4a3a-bca5-3723c19f0a1c`: 53.980136-second narration,
2.2-second hook, 18 cues. Final MP4:
`artifacts/videos/NEWS-02/video-4a600d6990b2bf4d/short.mp4`, 53.980146 seconds,
-16.16 LUFS, -4.44 dBTP. READY report:
`artifacts/productions/efea1cad-fa9e-4498-bdb8-694dbba51aa7/production.json`.
Studio: `artifacts/library-48b401b0-b320-4112-8e38-c78f51c54b19`, port 4173,
owned session 8360. Seven MP4s/packages and two voice samples retained. Phone
layout has no horizontal overflow; video paused; viewport reset. Previous server
62436 stopped. An attempted unsupported `serve --port` invocation failed without
changes; the normal supported command serves 4173.

Actual interruption: first NEWS-02 scene hit the explicit 24-second subprocess
deadline, despite no concurrent synthesis/checks. Normal retry resumed the same
job to READY; all local cost remains zero. No laptop-sleep interruption observed.

Next: commit/push NEWS-02. Then follow Astra's narrow reliability plan: shared
60-second Kokoro subprocess budget, 65-second Kokoro poll/audition outer budget,
preserve 25-second submit/lookup/other-provider defaults and explicit overrides.
Log elapsed/timeout/exit/signal/killed/stdout/stderr and surface the exact path.
Verify child cancellation before releasing the lease; retain same-job recovery,
no automatic resubmission, no lease/schema migration. Changing neural.ts changes
the generator hash once; preserve completed historical media without bypassing
fingerprints. After independent review/full checks, produce the already-planned
CAP-02@quiz and dynamic format-gallery availability (Astra script in thread).

02:24 PT: NEWS-02 pushed as `f3b00a6`; Node 22/24 CI passed
(run 38711953577). Completed the Astra timeout fix: 60s rendering/65s local poll
and auditions, other operations 25s, explicit overrides preserved. Child close is
confirmed before the Kokoro lease is released; deadline wins over late results.
Structured diagnostics include the exact path and execution evidence. A fast
regression exposed execFile AbortSignal using SIGTERM despite killSignal; official
Node 22.13 source confirmed the omission and explicit local-render cancellation
now sends SIGKILL. Setup/download behavior and historical completed media remain.

Full minimum-Node checks/build pass: 83 workflow tests + five CAP assertions.
Astra independently passed 27 focused tests and success/SIGTERM-resistant process
scratch checks. Real sequential Heart/Michael auditions both recorded successfully
(10.350s/11.300s); no new timeout. Logs: `.state/overnight/check-timeout.log`,
`test-timeout.log`, `audition-timeout.log`, and `library-timeout.log`.
Rebuilt studio `artifacts/library-fe02d84c-bf07-4108-8b13-faa26560ede5` preserves
seven MP4s/packages plus two current samples, all 87 hashes verified. Port 4173
still serves the valid NEWS-02 studio from session 8360; switch it to the next
quiz studio after producing that milestone. Heart remains default; cost zero.

Next: commit/push timeout milestone, then CAP-02@quiz with the Astra-authored
prediction/reveal script and dynamic format gallery. Do not add interaction
states or alter inherited CSV/query/capture/evidence fields. Keep the four-style
CAP-01 comparison. Astra is independently planning the next bounded improvement.

02:30 PT: Timeout milestone pushed as `fd568b9`; Node 22/24 CI passed
(run 38712638071). Completed CAP-02@quiz following Astra's120-word plan. Full
minimum-Node checks/build pass: 85 workflow tests + five CAP assertions. Astra
independently passed seventeen focused tests and reviewed CSV/query/reveal claims.
Gallery readiness/example links now reflect actual entries; phone layout fits.
Initial gallery QA found run-together inline status/link text; block labels fix
it and the final full checks passed. Prediction/reveal frames inspected directly.

Quiz job `9b58520c-d585-4018-b6f1-9e60c83e106e`: 53.005125-second narration,
2.905034-second hook,17 cues. Video:
`artifacts/videos/CAP-02--quiz/video-f046cee7ac269356/short.mp4`, -16.08 LUFS,
-4.47 dBTP, full decoding/audio checks passed. Repeat produce reused narration and
MP4: `artifacts/productions/99460d28-4d21-420e-90e6-a306480e8069/production.json`.
Studio: `artifacts/library-bbeda393-82a9-4b18-af2b-4fd6d221d0e1`, port4173,
owned session1605; eight MP4s/packages, two samples,99 hashes verified. All eight
ZIPs passed CRC/member hashes. Previous8360/25767 servers stopped. Evidence:
`.state/overnight/check-quiz.log`, `produce-quiz-final.log`, `quiz-evidence.json`,
`quiz-review.png`, `quiz-phone.png`, `quiz-formats.png`.

Next: commit/push quiz. Astra recommends “Revise script” in the static studio:
edit title/scene narration/overlays/post for an existing delivery, keep technical
inputs/source dates/format/speakers/order/timing fixed; dialogue edits existing
turns and derives joined narration. Require a new variant name, download existing
presentation JSON with base hash embedded, then safe `script-import PATH` CLI
validation against current base, refuse overwrites, print produce selector.
No automatic rewriting or writable server. Add live word/hook/pacing guidance,
source context, unmeasured timing notice, and no-JS readable fallback. Acceptance:
solo/dialogue/news import, stale hash/unknown fields/structural edits/invalid
selectors/collisions rejected before writes, no old media mislabeled ready,
one small edited CAP variant through full production, phone/keyboard/HTML-escaping
QA. Reuse existing variant validator as authority; no new dependencies needed.
