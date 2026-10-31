# Creative workflow enhancements

Authorized October 30, 2026: implement enhancements 1–6 from the project review.
GPT-6 Astra is used for planning and independent reviews. Work stays on
`ux-facelift`; installer releases are a separate explicitly requested milestone.

## Delivery and preservation rules

- Keep existing stories, versions, recordings, photos, approvals and source dates.
  Do not edit or commit the user's existing `content/**`, private configuration,
  avatar files or workflow records. Tests use temporary data.
- Reuse the existing writer, local renderers, editor and library. Gemma remains
  the local writing option; Hyperspace runs only when selected, with its visible
  cost notice and no repeated confirmation checkbox. No automatic remote fallback.
- Generated plans are proposals. Preserve factual scope and source references;
  source review and human listening remain distinct from automated validation.
- New metadata is private per workspace. Archive is reversible and never deletes
  scripts or media. A preset never enrolls a voice or accepts an audition.
- No paid inference, public posting, new model installation or new installer is
  required for implementation tests. Heavy local jobs remain sequential.

## Milestones and acceptance

| Milestone | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| 1 · Story planning | Persist audience, viewer problem, useful takeaway, chosen angle and target length; connect source-backed angle choices to rewriting. | Round trips through save/recovery; prompts receive only editorial text/evidence; changed snapshots reject stale proposals; tutorial and news fixtures retain claims, speakers and dates. | Complete · 411 tests, build, Astra review |
| 2 · Visual storytelling | Add bounded visual patterns to the shared presentation design and render them in the interactive deck and MP4. | Old designs still render; callout/comparison/steps share a compiler; readable bounds and reduced motion; saved code and evidence remain intact. | Complete · both renderers, mobile expanded-card check |
| 3 · Finished-video review | Local measurements and exact-output review handoff/import. | Findings bind to the actual MP4 hash; changed output invalidates them; caption/audio checks are measured; imported review is labeled external and advisory; no automatic upload. | Planned |
| 4 · Faster revision | Reuse valid unchanged scene speech across jobs; expose focused scene previews and reuse evidence. | One changed scene regenerates only that scene; speaker/runtime/pronunciation changes invalidate affected caches; corrupt cache never passes; full output is reassembled and validated. | Planned |
| 5 · Production presets | Save and apply named voice/presenter/delivery/design/pronunciation preferences. | Survives restart; applies only preferences to an editable draft; unavailable assets are reported; never overwrites narration, source evidence or existing versions. | Planned |
| 6 · Library management | Reversible archive, favorites, series and side-by-side version comparison. | Metadata persists separately; filters compose; archived files remain accessible and restorable; comparison identifies actual versions and does not transfer approval. | Planned |

## Validation and handoff

Each milestone receives focused regression tests, typecheck, build and scoped
format/lint checks. Broader workflow checks and library/portable packaging follow
integration. Read-only UI checks use the supported computer-use tools. Independent
Astra review findings are repaired before reporting completion. Existing unrelated
repository formatting and local private-content differences are not silently
changed to make global checks green.

Current baseline: commit `137bf41`, 405 workflow tests and 18 desktop tests. The
signed 0.1.2 installer predates the source migration repair and these enhancements.
See [desktop notes](MAC_DESKTOP.md) for that distinction.

## Evidence and next steps

- Initial architecture review confirmed an existing source-bound writer and
  presentation compiler, per-job Kokoro scene checkpoints, whole-audio reuse and
  separate workflow/version metadata. Extend those paths rather than duplicate them.
- Astra's six-phase plan confirms these integration points. Its first two reviews
  found and prompted repairs for old browser-draft migration, atomic companion
  application, exact companion URL retention, fractional duration compatibility,
  expanded-card scrolling and reduced-motion parity. Regression tests cover these.
- Source import still creates an evidence draft without an automatic model call.
  It opens the story planner, where the user chooses an angle and explicitly asks
  the selected writer for authored narration and matching companion copy. Older
  proposals remain readable but require regeneration against the new saved brief.
- Custom compositions apply to explanatory presenter scenes. Verified code,
  captured-result and news-card scenes retain their original evidence layouts.
  Labels are editorial proposals; validation cannot establish semantic truth.
- Milestones 1–2: 411/411 workflow tests passed under Node 22.23.4; TypeScript build passed. Actual Canvas PNGs and six interactive pilot decks were generated. Expanded step cards were checked at mobile width; their scroll area stays above the caption/footer.
- Next: implement the
  finished-video review handoff, cross-job scene reuse, presets and library tools.
