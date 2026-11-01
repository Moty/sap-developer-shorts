# Independent UX comparison

Reviewed October 28, 2026 by GPT-6 Astra at the user's request: restore tag
`pre-ux-facelift` (`915a18f`) versus the completed facelift. The original handoff's
model assignments were disregarded. Astra reviewed the existing phases, the
stabilization and remaining implementation independently, then verified reported
fixes. This is code, mocked regression and screenshot evidence, not a controlled
usability study. Task completion speed and satisfaction have not been measured.

**Verdict: materially better overall, with improvements beyond appearance.**

| Workflow | Before | Completed facelift | Assessment |
| --- | --- | --- | --- |
| Find a story/version | 62 flat rows in this local library | Nine story rows; stable version numbers; searchable drawers; stage-matching primary actions | Better; story counts can overlap stages because different versions can be in different stages. |
| Start a short | Separate Ideas/URL workflow | One source, format, tone, planned length and narrator sheet | Better; source-based drafting is not automatically an LLM rewrite. Default/deferred narration works before stock assets are installed. |
| Edit a script | Long stacked sections | Focused scene, previous/next, outline, shared identity and version selector | Better desktop orientation; phone chrome uses more space than before. Fields and recovery stay mounted. |
| Produce | Separate post/review/produce views and sparse progress | Validation checklist, optional disclosures, approximate history range, actual stages and exact-job recovery | Better; no invented ETA, completion percentage or implicit model job. |
| Settings/setup | Repeated provider controls and technical setup | Central Settings; nearby model/cost status; launcher distinguishes optional engines | Better; history restores refresh current settings and cost consent. |
| Review/publish | Less continuity between pages | Shared shell, transcript/source/detail tabs, four specific checks and mobile checklist shortcut | Better; approval still binds to the exact MP4. |
| Accessibility/portable output | Existing native links and static output | Native dialogs/disclosures, keyboard handling, reduced motion and strict CSP retained | Preserved and improved in reviewed paths; not a full assistive-technology audit. |

## Findings fixed before completion

- Mutable activity dates could reorder version identity and supersede the wrong
  review. An append-only selector/ordinal SQLite ledger separates identity from
  activity. Full order travels in portable manifests; retained snapshots can
  restore empty/lost ledgers. Legacy true creation order cannot be reconstructed;
  its former chronological display is seeded once. Activity still ranks stories.
- Stage filters could offer an action from an unrelated version. They now choose
  a matching action while keeping large drawers collapsed. Search still reveals
  matching versions.
- Returning from Settings through browser history could retain stale offline or
  running state. Editors refresh configuration/catalog, clear completed jobs and
  invalidate cost consent when the settings hash changes. No request is submitted.
- Phone approval was disabled while its checklist was buried. **Review 4 checks**
  now takes the user to the checklist; actual approval remains gated.
- Navigation ticks implied readiness merely from visiting a step. Navigation now
  marks location; the Produce checklist derives readiness from existing validation.
- No installed stock voices blocked new drafting, and a hidden invalid URL could
  block the selected source. Default/deferred solo narration and disabled inactive
  source fields fix both problems. Explicit/dialogue voices remain validated.
- A mutable draft-recovery hash could lose the accepted production after saving.
  The exact receipt now uses the originating saved selector, with in-memory
  recovery when tab storage is blocked. It never automatically retries.
- Another job finishing, or a temporary connection failure while waiting for it,
  could leave Produce disabled. Read-only polling now follows both cases.
- Explicit starts could leave live progress below the phone viewport. Starting
  reveals and focuses progress once; later updates do not steal focus.
- READY could precede the served workspace refresh. It now waits for indexing;
  refresh failures identify the saved result without offering a missing link.
- New checklist/estimate/stage text had insufficient contrast. Corrected normal
  text ratios are 6.23:1 on white, 5.40:1 on pale green and 6.27:1 for stopped stages.

Astra also verified corrections for empty-ledger recovery, custom artifact-root
propagation, activity dates and writing jobs finishing while the editor is away.
Its final statement after fixes: **no remaining blockers in the reviewed scope**.

## Limits and next evaluation

No real render, voice enrollment, model download, approval, publication or paid
request was triggered for this review. Mock regression tests cover submission,
recovery, validation and error states; saved existing media was inspected read-only.
The coordinator's full suite passes 403/403, desktop tests 14/14, and CAP demo
checks 5/5. Desktop/phone checks use 1440×1000 and 390×844 viewports.

Phone header density remains the main design tradeoff. Story Board view, version
comparison/archive, completion notifications and an empirical task study remain
future work. Timing ranges are deliberately approximate and can combine different
hardware or script lengths with the same voice/portrait pipeline.
