# UX facelift — completed handoff

Completed October 28, 2026 on `ux-facelift`. Read [BRIEF.md](BRIEF.md) for constraints
and [ASTRA_COMPARISON.md](ASTRA_COMPARISON.md) for the independent baseline comparison.
The user authorized continuing the remaining phases and opening a PR to `main`.
No main merge or installer release is part of this continuation.
PR: https://github.com/Moty/sap-developer-shorts/pull/1 (open). GitHub CLI's SAP
Enterprise Managed User cannot create it; it was created through the user's
existing personal GitHub browser session. No auth settings were changed.

## Delivered

| Restore point | Work |
| --- | --- |
| `pre-ux-facelift` · `915a18f` | Main before the facelift |
| `ux-facelift-phase-a` · `e9dab2e` | Quick wins, source notices, news fit/matching, editor polish |
| `ux-facelift-phase-1a` · `fffc268` | Story grouping, version drawers, stage filters, Needs you |
| `ux-facelift-phase-1b` · `b62928b` | Central writing Settings and nearby engine/cost status |
| `ux-facelift-phase-2a` · `2045edb` | Shared episode shell, four review checks, ZIP allowlist repair |
| `ux-facelift-stabilization` · `acfdf1c` | Stable version ledger, matching filter actions, history restore, mobile review shortcut, TAP reporter |
| `ux-facelift-complete` | Integrated Phase 2b, 3a and 3b, independent fixes and final documentation |

The final phases share API/editor/runtime files and are committed as one integrated
milestone. Their scoped notes are [PHASE2B.md](PHASE2B.md), [PHASE3A.md](PHASE3A.md)
and [PHASE3B.md](PHASE3B.md).

- **Produce:** validation-derived checklist, optional post/AI disclosures, history
  timing range, actual stages/elapsed times, stable accepted-job receipt and reload
  recovery. Another active job and transient connection failures recover without
  automatically submitting again. Initial failures do not claim a saved video;
  successful renders wait for served-library indexing before offering review links.
- **Workspace:** real New short sheet (official source, format, tone, planned length,
  narrator), asset-free default/deferred solo drafting, Formats, playable personal
  voice cards, two-step recorder/consent dialog and photo gallery with per-script
  alignment links. Source-based creation preserves complete source/spoken excerpts;
  tone/format metadata is not an implicit LLM rewrite.
- **Launcher/private studio:** common visual tokens, truthful optional-engine
  readiness, matching section names and friendly errors. Existing auth, tenancy,
  rendering-engine registration and consent behavior remain.
- **Safety:** exact-MP4 approval, dated source reviews, explicit paid consent, mounted
  fields, private data boundaries, CSP and portable/static fallbacks remain.

## Verification

- Main suite **403/403**, desktop **14/14**, CAP demo **5 live checks**.
- Typecheck and TypeScript build pass; content validate passes.
- Scoped Biome checks all 39 changed source/test/UI files with no errors (one
  pre-existing private-app `noExplicitAny` warning). `git diff --check` passes.
- GitHub's full `npm run check` is blocked at repository-wide lint by four
  **pre-existing formatting errors**: `src/cli.ts` and `content/drafts/NEWS-03.json`,
  `NEWS-04.json`, `NEWS-05.json`. These paths have no diff from `pre-ux-facelift`.
  No failures are waived in the test suite; this is a separate baseline lint issue.
  Content remains untouched under the brief's explicit data boundary.
- Fresh local library build and verified portable ZIP pass. Evidence paths are in
  `.state/ux-facelift/audit/` (gitignored); no personal photos are committed.
- Read-only CUA checks use **1440×1000** and **390×844**. Workspace, New short,
  editor/Produce, voice library and review flow retain responsive layouts. Phase3b
  mock desktop/sign-in screenshots are under `.state/ux-facelift/phase3b/`.
- Independent GPT-6 Astra review compared against `pre-ux-facelift`, found concrete
  issues, and verified fixes. Final verdict: materially better overall; no remaining
  blockers in reviewed scope. Phone header density remains a tradeoff. This is not
  a user study or a claim of measured faster task completion.
- Tests use mock production stages/API fixtures and temporary artifact roots.
  **No real rendering, enrollment, approval, publishing, model download or paid
  request** was triggered during this work.

## Local state and safe continuation

The user's modified `content/news/backlog.json`, untracked drafts and personal
photos are intentionally untouched/uncommitted. Never add/reset/clean these, or
`config/private/**` and `artifacts/.studio-workflow/**`. For a rollback, prefer a
new branch/worktree at a restore tag; a hard reset would discard tracked edits.

The pre-existing desktop app on **54823** and old preview on **59725** were left
alone. The coordinator rebuilt a separate loopback preview on **4173** for this
work; use its reported URL or rebuild with `npm run shorts -- library` and serve
the printed directory. Stop only a known idle preview owned by this work. Mock
verification servers are temporary and stopped after checks.

Version identities live at `ARTIFACT_ROOT/.studio-versions/order.sqlite` and in
new library manifests. Retained snapshots recover an empty/lost ledger; copy the
ledger or recent library snapshot when migrating machines. Initial legacy order
is seeded once; old true creation dates cannot be inferred retrospectively.

No installer was rebuilt. Generated pages need a library rebuild to gain the new
UI; previously saved media and ZIPs remain unchanged.

## Deferred

- Phone chrome can be further reduced after real user testing.
- Board view, Compare versions, archive old versions and completion notifications.
- Ideas' saved “already a short” indicators refresh on reload after scans.
- Timing references match pipeline shape, not exact hardware or script length;
  their displayed range is approximate, not a promised completion time.
- Source quality and creative wording still need editorial review; format selection
  alone does not produce a new authored narrative.


## October 30 creative-workflow follow-up

The later local-source enhancement milestone adds two-version comparison, whole-story archive/favorites/series, saved production presets, source-backed story briefs, bounded visual compositions, exact-output external review handoff/import and Kokoro scene caching. This supersedes earlier notes that Compare is deferred. See [CREATIVE_WORKFLOW_ENHANCEMENTS.md](../CREATIVE_WORKFLOW_ENHANCEMENTS.md) for the tested scope and limitations. No new installer or cloud deployment is part of this follow-up.
