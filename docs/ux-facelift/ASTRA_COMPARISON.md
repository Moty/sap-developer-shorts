# Independent UX comparison

Reviewed October 28, 2026 by GPT-6 Astra at the user's request: `pre-ux-facelift`
(`915a18f`) versus completed Phase 2a (`dede5c4`). Model assignments in the old
handoff were disregarded. This is a code, prototype and screenshot review, not a
controlled usability study; task speed and satisfaction have not been measured.

| Workflow | Assessment | Evidence and limit |
| --- | --- | --- |
| Finding stories and versions | Better overall | 62 separate entries become nine story rows, with searchable version drawers. Stage-filter actions and stable version order needed correction. |
| Starting a short | Slightly better discovery | New short is prominent; it still opens the existing Ideas/URL workflow. The complete creation sheet is pending Phase 3a. |
| Editing a script | Better orientation; mixed phone density | Shared identity and four steps connect edit, watch, review and deck. Existing controls remain mounted. The phone shell consumes more space. |
| Writing settings | Better separation | One Settings page reduces repeated configuration; model/cost chips stay near requests. Returning through browser history needed refresh handling. |
| Reviewing/publishing | Better on desktop | Four specific checks, measured chapters and transcript/source/detail tabs improve clarity. The phone checklist was too far below the transcript. |
| Accessibility and portable output | Mostly preserved | Native disclosures, keyboard tab handling, no-JS content and strict CSP remain. No full assistive-technology audit was performed. |

## Confirmed issues and stabilization

- Version labels, Latest and supersession used mutable update/render timestamps.
  An append-only selector/ordinal ledger now separates identity from activity.
  It is transactionally allocated under `ARTIFACT_ROOT/.studio-versions/order.sqlite`.
  Full order is also saved in portable library manifests; empty/lost local ledgers
  recover from retained snapshots. Legacy order is seeded once from the former
  display order: true historic creation dates cannot be reconstructed.
- Stage filters matched any version but left an unrelated representative action.
  The primary action now comes from a version in the chosen stage; searching still opens and highlights matching versions.
- On phones, review checks followed the full transcript while Approve was disabled.
  The bottom action now says **Review 4 checks** and focuses the checklist. Only
  after all checks are complete does it submit the unchanged approval action.
- Returning from Settings via browser history could preserve stale offline/running
  state. Restored editors refresh settings/catalog and clear completed job state;
  changed settings clear remote cost consent. No model job is automatically submitted.
- Navigation ticks reflected visited steps, not validated readiness. Phase 2b must
  derive checklist readiness from existing validation and actual production status.

A separate Astra code review found and verified corrections for empty-ledger
recovery, custom artifact-root propagation, story activity dates and writing jobs
finishing while the editor is away. Regression tests cover these behaviors.

## Phase 2b guardrails

Reuse existing script/media validation and the production API. Optional AI review
must stay optional. Estimates must identify their history basis and uncertainty.
Progress must represent the actual saved job, survive reload and report a lost
worker as interrupted. Verification uses mock jobs, never real rendering or paid
requests. Phone actions must explain blocked states and provide direct fixes.
