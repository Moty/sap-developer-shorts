# UX facelift — handoff (paused after Phase 2a)

Self-contained: everything needed to resume is here plus `BRIEF.md` (rules every implementation agent must follow).

## Goal
Implement the redesign in `docs/ux-facelift/prototype/` (open `prototype/index.html`; `#<screen-id>` or `#<id>~phone`).
`prototype/analysis.html` has the findings and roadmap (its "before" image tiles are blank in the repo — expected, see BRIEF).
The prototype is the target look/structure, not code to paste: adapt it to the existing DOM, CSS variables and behaviour.
Prototype screen ids: setup, signin, shorts, new, ideas, formats, voices, addvoice, settings, script, voice, produce, review, deck.

## Repo state
- Repo `sap-developer-shorts`, branch `ux-facelift` (tracks `origin/ux-facelift`), HEAD = `2045edb` (Phase 2a), pushed.
- Uncommitted by design: `content/**`, `assets/avatars/**` (the user's own drafts and personal photos — **never commit, edit or delete**; also never `config/private/**`, `artifacts/.studio-workflow/**`).
- `docs/ux-facelift/` and the `biome.json` lint exclusion are committed with this handoff.
- `.state/ux-facelift/<phase>/` holds local screenshot evidence (gitignored; not available on another machine).

## Restore points (all pushed to origin)
| Tag | Commit | Meaning |
|---|---|---|
| `pre-ux-facelift` | `915a18f` | `main` before the facelift |
| `ux-facelift-phase-a` | `e9dab2e` | Phase A |
| `ux-facelift-phase-1a` | `fffc268` | Phase 1a |
| `ux-facelift-phase-1b` | `b62928b` | Phase 1b |
| `ux-facelift-phase-2a` | `2045edb` | Phase 2a (current HEAD) |

Tags are annotated (`git rev-parse <tag>` gives the tag object; use `<tag>^{commit}` for the commit).
Revert: on the branch `git reset --hard <tag>` — **warning:** this keeps untracked user files but would discard uncommitted edits to tracked files (e.g. `content/news/backlog.json` is user-modified). Stash/copy those first, and **never run `git clean`**. Safer alternative: `git switch -c ux-facelift-rollback <tag>`.
When finished, open a PR `ux-facelift` → `main` (`gh pr create`).

## Working method (one phase at a time)
1. Implementation agent (Claude Sonnet 5.5 for normal phases, Claude Opus 5.5 for high-risk ones) works uncommitted.
2. Separate Claude Opus 5.5 code-review pass on the uncommitted diff; fixes applied.
3. Coordinator verifies (typecheck, tests, screenshots), commits **explicit paths only** (never `git add -A`), tags `ux-facelift-phase-<x>`, pushes branch + tag (`git push origin ux-facelift ux-facelift-phase-<x>`).

Implementation prompt template:
> Read docs/ux-facelift/BRIEF.md and follow it exactly. Target: prototype screens `<ids>`. Scope: `<bullets>`. Verify per the brief; screenshots under .state/ux-facelift/`<phase>`/. Report changed files, reused vs rewritten, test/lint results, deviations.

Review prompt:
> Review uncommitted changes (`git diff -- src templates tests docs desktop` + untracked new files) against docs/ux-facelift/BRIEF.md; real bugs only: semantics, CSP, XSS, a11y, package allowlist, no-JS; file:line, severity, fix; don't modify files.

## DONE
- **Phase A** (Sonnet + Opus review): single source-review notice on `watch.html`; compact workspace hero; removed "Explore ideas ↗"; global **New short** button (currently just focuses the Ideas URL field); news cards show a fit meter + "Already a short" badge (`src/news/story-fit.ts`, conservative URL / truncated-title matching); editor SVG icons, brand sliders, "Next:" labels, friendly portrait names, single status line.
- **Phase 1a** (Sonnet + Opus review): My shorts grouped by story (`src/library-stories.ts` + mirror `templates/library-stories.js`); representative-version rule Producing > To review > To publish > Editing > Published, superseded reviews ignored; versions drawer v1..vN; pipeline counts; Needs-you cards; tests incl. live-polling DOM bridge (`tests/library-polling.test.ts`).
- **Phase 1b** (Sonnet + Opus review): Writing engine moved to Settings (`#settings`, legacy `#writing` still works); editor and final review show a status chip + "Change in Settings"; preference-hash recheck before requests; per-request Hyperspace consent unchanged.
- **Phase 2a** (Opus + Opus review): shared episode shell (`src/episode-shell.ts`, `templates/episode-shell.*`) on edit/publish/watch/video-review/presentation pages; 4 steps **Script · Voice & presenter · Produce · Review & publish**; `publish.html` rewritten (chapters, Transcript/Sources/Details, four approval checks gating the unchanged approve request, locked steps); live stage labels where CSP allows; deck phone fixes; fixed a pre-existing portable-ZIP allowlist gap (writing-assistant, final-review, editor-workspace templates).

## NEXT (nothing started — the Phase 2b agent was stopped before editing anything)
### Phase 2b — Produce step (Opus 5.5; high risk) · prototype screen `produce`
- Pre-flight checklist replacing the Companion post / AI review / Produce tabs. Rows: Script, Voice, Presenter, Sources, Companion post, optional AI review. **Derive state from existing validation; don't re-implement it.**
- ETA from generation history; "Save & produce vN" reusing the existing produce action.
- Live staged progress from the existing production status (must survive reload); done/failed states; phone bottom bar.
- Verify with **mocked APIs** (Playwright route interception). Never start a real production.

### Phase 3a (Sonnet) · screens `voices`, `addvoice`, `formats`, `new`
- Voices & presenters workspace section: playable voice cards, presenter gallery with friendly names / alignment status, two-step "Add voice style" sheet reusing the existing recorder + consent.
- Formats gallery (replaces Delivery styles).
- Real **New short** sheet (source, format, tone, length, narrator) over the existing news-create/draft APIs (replaces the Phase A focus-the-URL-field behaviour).

### Phase 3b (Sonnet; may run in parallel with 3a — disjoint files) · screens `setup`, `signin`
- Desktop launcher `desktop/ui/*`: restyle to shared tokens + readiness checklist. Also run `npm run test:desktop`.
- Private studio `src/web/private/*`: section names aligned (Shorts, Ideas, Voices & presenters, Settings) + friendlier error text.

### Wrap-up
Opus review of phase 3 → final full verification (typecheck, `npm test`, biome on changed files, `npm run shorts -- library` + `library-package`, screenshots at 1440 and 390) → update `docs/CREATOR_STUDIO.md` (and `docs/REVIEW_STUDIO.md` if labels changed) → open the PR.

### Known deferred items
Board view, Compare versions, archive old versions (Shorts); Ideas cards don't refresh "already a short" until reload after a rescan.

## Baseline / validation
- `npm run typecheck` clean.
- `npm test`: currently 375/376. The **only** allowed failure is pre-existing `tests/api-revisions.test.ts` "a produced revision stays visible…" (Node 26 prints `ℹ pass 1`, test expects `# pass 1`). BRIEF.md still quotes the older 340/341 baseline; the failing test is the same.
- Biome: run on changed files only (`npx biome check <files>`). Repo baseline has errors in `content/**` JSON formatting (user data), `src/cli.ts`, `src/web/private/app.ts`, `templates/library.css`. `npx biome check docs/ux-facelift biome.json` must stay clean (prototype/ is excluded; `.md` isn't linted).
- Generated pages carry a strict CSP (`default-src 'none'`, inline script/style only, no external resources; `review.html` has no `data:` images). Keep inline SVG, system fonts, no-JS fallbacks, same-origin APIs, `prefers-reduced-motion`.
- Visual check: `npm run shorts -- library` (prints the dir) → `npm run shorts -- serve <dir>` (port 4173, async; stop afterwards) → `node docs/ux-facelift/tools/shot.mjs <url> <out.png> <w> <h> [full] [clickSel]` at 1440×1000 and 390×844. Output must show no overflow or console errors. Setup for the tool and Chromium path adaptation: see BRIEF.md (`npm i --no-save playwright-core@1.56`; Chromium expected at `~/Library/Caches/ms-playwright/chromium-1248/...`, otherwise edit `exe` in `shot.mjs`).
- Example pages use the user's local content (`episodes/NEWS-06%40draft-revision-7/edit.html`, `episodes/NEWS-10%40quality-review/publish.html`); on another machine pick any episode present in the generated library.

## Hard rules (recap)
- Never commit user data (`content/**`, `assets/avatars/**`, `config/private/**`).
- Never trigger production, approval, publication, model installs/downloads, voice enrollment or paid requests during verification.
- Never touch the desktop app instance on port 54823.
- Never `git add -A`, `git clean`, or force-push; implementation and review agents don't commit, stash or reset at all.
- Preserve safety semantics: exact-MP4 approval binding, source-review windows, explicit per-request cost consent, draft recovery, editor "fields stay mounted", existing versions/recordings.
