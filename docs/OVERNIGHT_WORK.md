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

Next: commit/push the reviewed reliability milestone, then implement `produce`
with the selected job explicitly carried into render/library selection (Astra
identified the Heart → Bella → Heart case). Reuse validated completed audio for
visual-only updates as a new package; do not generate additional legacy scenes.

Keep this section current with changes, exact test evidence, commits, preview
locations, and the next bounded action. Do not label unverified work complete.
