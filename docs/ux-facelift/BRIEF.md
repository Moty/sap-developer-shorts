# SAP Shorts UX facelift — shared brief for all implementation agents

Repo: /Users/I851396/__Code/sap-developer-shorts  (branch `ux-facelift`, restore tag `pre-ux-facelift`)

## Design spec (read before coding)
- Analysis (findings + roadmap): `docs/ux-facelift/prototype/analysis.html`
- Clickable prototype: `docs/ux-facelift/prototype/index.html` (screens are rendered from `js/shell.js`, `js/ws1.js`, `js/ws2.js`, `js/ep.js`; styles in `styles.css`).
  Open a screen with `index.html#<id>` or `index.html#<id>~phone`. Screen ids: setup, signin, shorts, new, ideas, formats, voices, addvoice, settings, script, voice, produce, review, deck.
- Current-state ("before") screenshots, `prototype/current/`, were intentionally NOT committed (they contain the user's personal photo), so image tiles in `analysis.html` are blank in the repo copy. That is expected.
The prototype is the *target look and structure*. It is NOT code to paste: adapt it to the existing DOM, CSS variables and behaviour.

## Ground rules
1. **Reuse what works.** Most features are functional and tested. Prefer restyling/re-arranging existing markup, CSS and JS over rewrites. Rewrite only when it is clearly simpler and you keep behaviour identical.
2. **Never commit, push, stash, reset, clean, switch branches or `git add`.** The coordinator commits explicit paths. Do not run `git checkout -- <file>` on files you did not change.
3. **Do not modify user data**: `content/**`, `assets/avatars/**`, `config/private/**`, `artifacts/.studio-workflow/**`. The working tree contains the user's uncommitted drafts and personal photos — leave them alone.
4. **Do not trigger** production/rendering, approvals, publication records, model installs/downloads, voice enrollment or paid writing requests. Browsing the UI read-only is fine. Do not touch the running desktop app (port 54823).
5. **Keep constraints**: the generated pages ship strict per-page Content-Security-Policy meta tags (default-src 'none'; inline script/style only; `review.html` has `img-src 'self'` with no `data:`). No external fonts/CDNs/scripts. Use inline `<svg>` for icons and the system font stack. Keep no-JS fallbacks, static/portable library behaviour (see `src/library-package.ts` allowlist), same-origin API usage, keyboard/focus/labels, `prefers-reduced-motion`, and existing light/dark handling if present.
6. **Preserve safety semantics**: exact-MP4 approval binding, source-review windows, explicit cost consent for paid (Hyperspace) requests, draft recovery, "fields stay mounted" in the editor, existing versions/recordings preserved.
7. Keep changes surgical and scoped to your phase. Update tests whose expectations change because of intended UI changes (don't delete coverage; adjust assertions to the new markup). Add tests for new pure logic (e.g. grouping).
8. Update user-facing docs briefly where behaviour/labels change (`docs/CREATOR_STUDIO.md`, `docs/REVIEW_STUDIO.md`).

## Validation (required before you report)
- `npm run typecheck` → must pass.
- `npm test` → baseline is 340/341 passing; the single pre-existing failure is
  `tests/api-revisions.test.ts` "a produced revision stays visible…" (Node 26 prints `ℹ pass 1` instead of `# pass 1`). No new failures.
- `npx biome check <every file you changed>` → no new errors (baseline errors: `src/cli.ts`, `src/web/private/app.ts`, `templates/library.css`, plus content JSON).
- Visual check: `npm run shorts -- library` (prints the new library directory), then serve it in async mode with `npm run shorts -- serve <dir>` (port 4173; stop it when done). Screenshot with
  `node docs/ux-facelift/tools/shot.mjs <url> <out.png> <width> <height> [fullPage 0|1] [clickSelector]`
  (the tool imports `playwright-core`: run `npm i --no-save playwright-core@1.56` or run it from a scratch dir that has it; it launches the Chromium at `~/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/...` — edit the `exe` path in the script, or install one with `npx playwright-core@1.56 install chromium`, if yours differs)
  at 1440×1000 and 390×844. It prints overflow and console errors — both must be clean. Save screenshots under `.state/ux-facelift/<phase>/` and look at them.
  Editor pages: `http://localhost:4173/episodes/NEWS-06%40draft-revision-7/edit.html`; produced video: `episodes/NEWS-10%40quality-review/publish.html`, `.../watch.html`, `.../video/review.html`, `.../presentation.html`.

## Report back
Changed files (with one-line purpose each), what you reused vs rewrote, test/typecheck/lint results, screenshot paths, known gaps or deviations from the prototype and why.
