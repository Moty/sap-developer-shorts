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
