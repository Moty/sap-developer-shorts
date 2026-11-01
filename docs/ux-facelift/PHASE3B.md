# Phase 3b — desktop setup and private workspace

Implemented against the `setup` and `signin` prototype screens on the shared
`ux-facelift` checkout. This phase owns desktop UI, private studio UI, and focused
UI/error tests. The coordinator owns integration, general creator/review docs,
commits, and the final PR.

## Changes

- `desktop/ui/index.html`, `style.css`: shared forest/mint light palette, rendering
  tool checklist, studio entry card, responsive layout, inline SVG icons, readable
  activity/error state, and an explicit JavaScript fallback. All existing setup,
  refresh, sample-video, pairing, worker, studio, and app-data controls remain.
- `desktop/ui/app.js`: derive the checklist from the runner's existing `engines`
  booleans and `task.action`. Unknown tools stay “Checking”; installed tools show
  “Ready”; active setup shows “Installing” or “Verifying / repairing”. A tool being
  repaired is omitted from the ready count until the next diagnostic state.
  Workspace availability uses the existing `studioUrl`; setup errors take priority
  over the general ready badge and open the existing troubleshooting log.
- `src/web/private/index.html`, `app.css`: responsive two-column sign-in screen,
  system fonts and shared palette. Primary sections are **Shorts**, **Ideas**,
  **Voices & presenters**, and **Settings**. The existing voice and photo panels
  sit behind **Voices** / **Presenters** subnavigation. Settings keeps the existing
  rendering-engine and pairing controls. Expanded setup commands wrap on phones.
- `src/web/private/app.ts`: preserve panel IDs and `showTab("photos")` /
  `showTab("engines")` callers, including pairing links. Track the primary group
  independently of the visible presenter panel and expose selection with
  `aria-current`. Replace the hardcoded backend address in error copy with a
  useful connection recovery message.
- `src/web/private/error-messages.ts`: extract the existing sign-in error map and
  add network, invitation/access, and pairing recovery copy. Invalid-credential and unknown-account
  responses remain indistinguishable. Preserve detailed server validation and
  revision-conflict messages; update old “My voices” / “My photos” labels in those
  messages for the new navigation.
- `desktop/tests/ui.test.cjs`: execute the actual renderer against a minimal mocked
  desktop bridge/DOM to exercise readiness, unknown/absent engines, active setup
  and repair, sample gating, worker locking/pause, error recovery, and navigation.
- `tests/private-error-messages.test.ts`: cover generic credential errors, safe
  account-creation copy, network/pairing guidance, malformed errors, and preserved
  server validation details.

## Reuse and deliberate differences

The renderer still calls the existing desktop bridge and the private studio still
uses the existing Firebase and tenant-scoped API functions. No backend, installer,
authentication, tenant selection, security, consent, revision, or job semantics were
rewritten. Existing mounted editor and voice form fields remain mounted.

The prototype's percentages, ETA, disk-space and hardware examples are omitted:
the current runner supplies checked booleans and active action/time, not reliable
per-download progress, hardware or capacity metrics. The activity bar remains
indeterminate. No tool is universally marked “Required”; which engines are needed
depends on the selected voice/presenter, and existing action validation remains the
authority. Opening the studio still waits for its actual URL.

Sign-in retains the real **Create account**, **Reset password**, and verification
controls. A **Request an invite** action would require a new backend flow, so it
was not fabricated. The existing unchecked persistence preference is unchanged.
The sign-in artwork is decorative CSS with generic text and no personal photos.

## Verification

- `npm run typecheck`: passed.
- `npm run test:desktop`: **14/14 passed**, including 2 new renderer regressions.
  Existing packaging tests only exercise their early refusal gates; no installer
  was built.
- `node --import tsx --test tests/private-error-messages.test.ts tests/private-voice-status.test.ts tests/private-workspace.test.ts`:
  **24/24 passed**, including account/workspace isolation, device revocation,
  pairing, voice consent/audition binding, revision concurrency, and paid fallback.
- `npx biome check desktop/ui desktop/tests/ui.test.cjs src/web/private tests/private-error-messages.test.ts`:
  passed with **one pre-existing warning**, `lint/suspicious/noExplicitAny` on
  `let data: any` in `src/web/private/app.ts` (baseline line 143, now line 135).
  No new warnings/errors and no unrelated private-app reformatting.
- `git diff --check` on the changed UI/test paths: passed.
- Visual checks used CUA against a loopback-only mock server on port **4184**.
  Desktop bridge actions were inert; Firebase imports were replaced only in the
  preview bundle with a local stub; API responses were in-memory fixtures.
  No real sign-in, setup install, model download, recording/enrollment, production,
  approval, cloud request, or running desktop interaction took place.
- At **1440×1000** and **390×844**, desktop and sign-in had no horizontal overflow
  or console warnings/errors. Presenter and Settings navigation, the Ideas URL
  form, installing/failure states, and generic mocked sign-in rejection were also
  checked. The expanded Settings command block initially overflowed on phone;
  wrapping was added and the same check then returned document width 390.

Local evidence (gitignored) is in `.state/ux-facelift/phase3b/`:
`desktop-1440.jpg`, `desktop-390.jpg`, `signin-1440.jpg`, `signin-390.jpg`,
`presenters-1440.jpg`, `presenters-390.jpg`, `settings-390.jpg`,
`desktop-installing-390.jpg`, and `desktop-failed-390.jpg`.
The mock-server script is kept there for reproducibility and stopped after checks.

Independent Astra review found no material Phase 3b issues. Coordinator combined
verification passes the main suite (403/403), desktop tests (14/14) and typecheck. General docs should refer to **Settings → Rendering engines** and
**Voices & presenters → Presenters** for the private studio.
