# Phase 2b — Produce workspace

Completed October 28, 2026. Reuses the existing script/media validation, save and
produce action, source-date notices, optional AI review, consent and production
stages. No rendering engine or approval policy was changed.

## Behavior

- One checklist covers script, selected voice, presenter, sources, post and optional
  AI review. Voice readiness uses the existing verified inventory/audition state;
  presenter runtime/alignment is checked during production. Save draft remains
  separate from producing. Existing fields/media stay mounted.
- Post and AI controls live in native disclosures. Save & produce is available in
  the sidebar and shared header/phone action; blocked reasons remain visible.
  Detailed timing/voice guidance is collapsed below the primary action.
- A rough timing range uses matching fresh voice/portrait pipelines, excludes
  reused audio/video and identifies its sample count/limitations. No history means
  no ETA. No synthetic completion percentages are shown in the enhanced pane.
- Explicit start reveals/focuses progress once. Actual Preparation, Audio & captions,
  Portrait & MP4 and Update workspace stages show elapsed/measured times.
- API job UUID and persisted production receipt UUID now match. Read-only
  `/api/production-context` restores an exact accepted job, reports lost workers
  as interrupted, and follows another active job without auto-resubmission.
  Tab receipts use the originating selector independently of mutable draft hashes.
- READY is exposed after the served library refresh; a refresh failure reports the
  saved result without an unavailable review link. A failed initial submission
  does not claim a saved revision. Reconnection handles blocked browser storage.
- Upcoming/secondary text meets normal-text contrast requirements. Native static
  controls, strict CSP and unchanged exact-MP4 approval remain intact.

## Verification

Main suite: 403/403. Desktop: 14/14. Typecheck/build and 5 live CAP demo checks pass.
Production tests use mock stages/HTTP and temporary artifact roots, including
interruption, exact-job reload after changed draft hashes, another-job completion,
connection failure, unavailable storage, focus and served-library indexing.
No real render, enrollment, setup download, approval or paid call was performed.

Local screenshots/logs: `.state/ux-facelift/audit/` (gitignored). Independent review:
[ASTRA_COMPARISON.md](ASTRA_COMPARISON.md). The runtime/portable allowlists include
all new source/template files. Rebuild the studio to update generated pages;
there is no new installer release.
