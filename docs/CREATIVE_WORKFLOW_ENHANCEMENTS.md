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
| 3 · Finished-video review | Local measurements and exact-output review handoff/import. | Findings bind to the actual MP4 hash; changed output invalidates them; caption/audio checks are measured; imported review is labeled external and advisory; no automatic upload. | Complete · integration checks below |
| 4 · Faster revision | Reuse verified unchanged Kokoro scene speech across jobs; retain existing focused scene auditions and show recording provenance. | One changed scene regenerates only that scene; speaker/runtime/pronunciation changes invalidate affected caches; corrupt cache never passes; full output is reassembled and validated. | Complete · integration checks below |
| 5 · Production presets | Save and apply named voice/presenter/delivery/design/pronunciation preferences. | Survives restart; applies only preferences to an editable draft; unavailable assets are reported; never overwrites narration, source evidence or existing versions. | Complete · integration checks below |
| 6 · Library management | Reversible archive, favorites, series and side-by-side version comparison. | Metadata persists separately; filters compose; archived files remain accessible and restorable; comparison identifies actual versions and does not transfer approval. | Complete · integration checks below |

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
- Milestones 3–6 are implemented. Read-only Astra reviews prompted fixes for
  fresh review-page sessions, stale render binding, rendered visual headlines,
  cache privacy/corruption/provenance, concurrent preset saves, missing assets,
  stale responses, recovered pronunciation and library editing/playback races.

## Using the new workflow

1. Open or create a draft. In **Episode details → Writing & presentation
   assistant**, set audience, viewer problem, takeaway and target. Generate
   source-backed angles, choose a direction, then request a rewrite. Proposals
   include matching companion copy and retain existing/source URLs. Applying a
   proposal is explicit and refuses a changed editor snapshot.
2. Ask the presentation assistant for **Show steps**, **Compare ideas**, or a
   **Strong callout**. These bounded layouts render in both the interactive deck
   and exported MP4. Code, captured output and news evidence keep their dedicated
   layouts. The interactive deck expands cards; MP4 follows a fixed timeline.
3. On **Review & publish**, open **Finished-video review**. Measurements show
   saved decode/audio checks, resolution, loudness and caption alignment when
   available. Download the review JSON kit plus the exact MP4 and upload them
   manually to Gemini or another video-capable reviewer. Paste its JSON response
   to save timestamped advisory findings and seek to them. A different MP4 hash,
   render, or out-of-range timestamp is rejected. The player is pinned to checked
   output bytes. No AI import ticks the four human approval checks.
4. Produce a revised version as usual. Valid unchanged Kokoro scene speech can
   be reused from the same workspace's `.state/stock-scene-cache`. Identity covers
   spoken text/phrases, voices, speed, model/runtime and generator hashes. Corrupt
   or unreadable optional cache entries are misses. Captions and the continuous
   track are assembled again. Existing **Hear this scene/line** controls provide
   focused auditions. The Details panel labels counts as original recording
   provenance so later whole-track reuse does not claim new generation.
5. In **Episode details → Production presets**, save a name, load your presets,
   then apply one to a compatible draft. A preset stores voice/photo references,
   avatar calibration/motion, tone/format/humor, theme/motion, pronunciation and
   planned length. It retains the current title, narration, scene order, visual
   evidence and sources. Planned scene windows scale together to the target;
   measured speech still determines the output. Missing photos, changed photo
   hashes, unavailable voices and unaccepted personal-voice revisions fail before
   browser mutation. Review and save as a new version afterward. Reusing a name
   updates that preset (maximum 40).
6. In **My shorts → Organize story**, favorite, assign a series or archive a
   whole story with all its versions. **Library view** switches active/archived/all;
   favorites, series, search, stage and pagination compose. Archived stories stop
   contributing to active stage counts and Needs you; restoring them retains all
   files, version numbers and approvals. **Compare versions** shows two actual
   saved scripts, visual directions, voices/pictures, companion copy, stage and
   planned versus measured duration. MP4 playback checks the selected hash/render,
   starts manually and stops when the comparison closes.

## Storage, scope and limits

- This milestone targets the local source studio/desktop backend. It does not
  deploy new cloud/private-studio controls, replace the installed app, publish a
  post, renew source reviews, change the selected writer or release an installer.
- `artifacts/.creator/studio.sqlite` (or the configured artifact root) stores
  private presets, story metadata and external reviews separately from content.
  SQLite write transactions prevent lost updates across multiple local servers.
  This metadata is not included in static studio ZIPs; keep it in Mac backups.
- Voice samples and photo bytes are not stored in presets or sent to the writer.
  Photo references and calibration stay private. New metadata is not cloud-synced.
- Cross-job scene caching currently covers Kokoro stock speech. Qwen retains its
  existing within-job checkpoints and whole-track reuse. Staged private workers
  keep content caches within each private workspace; shared model directories do
  not collect narration. There is no new partial-MP4 reuse.
- The review kit is a manual handoff, not an automatic audiovisual model review.
  No external upload, paid inference, new voice enrollment or audition acceptance
  happens while implementing or validating these features.
- Labels and jokes remain editorial proposals. Schema/source guards cannot prove
  factual meaning, naturalness or engagement; watch/listen and review sources.

## Validation evidence

- TypeScript build/typecheck passed. Full workflow suite: **423/423** under
  unmodified Node 22.23.4; desktop suite **18/18**; **5 live CAP checks** passed.
  Content validation: 30 tutorial topics, 9 news topics, 9 episodes and 59 variants.
- Regression tests cover exact output/import binding, out-of-range findings,
  scene-cache invalidation/corruption, concurrent processes, preset preservation,
  real duration scaling, malformed recovery, discard reset, archive restoration,
  combined metadata filters and changed-MP4 playback rejection.
- Live UI checks used an isolated metadata root: saved favorites/series, archived
  and restored a story (active count 9→8→9), compared actual versions, downloaded
  a review kit, and imported clearly labeled synthetic feedback without approving
  the video. No media quality assessment is claimed by that synthetic test.
- Interactive composition pilots and Canvas frames were generated for tutorial
  and news scenes; expanded cards stayed within mobile slide bounds. No new
  production-quality voice/video was generated during these checks.
- Scoped lint has no new errors; the six existing CSS specificity warnings remain.
  Final saved-library/package checks and final source preview are recorded below.

- Full saved studio (323 MB) passed strict portable ZIP packaging; its artifact,
  source and runtime inventories were verified. Static HTTP/file copies retain
  saved playback while live review tools require the local API.
- Current source preview: `http://127.0.0.1:56094/review.html`. Direct opening of
  Review & publish established a fresh session and loaded the pinned MP4 (47.58s,
  no media error). The reusable **CAP · Casual Heart** preset was saved and
  applied through the UI; no episode version was saved or rendered by that check.
