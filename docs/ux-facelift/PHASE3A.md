# Phase 3a — workspace creation, formats, voices and presenters

Implementation on the existing `ux-facelift` checkout; coordinator owns commits, API wiring, runtime/package registration, independent review and final full verification.

## Implemented

- **Formats** replaces Delivery styles in the workspace navigation. Six existing storytelling structures have a responsive gallery, prepared-example links and **Use format**, which opens New short with that selection. Existing CAP comparison examples remain available and old `#styles` links still work.
- **New short** is a native, keyboard-accessible dialog. It accepts a scanned official SAP story or article URL and saves format, tone, planned length and narrator choices. Default / decide later allows drafting before any voice assets are installed; explicitly selected voices must be installed. Conversation additionally requires a second distinct installed voice. The Ideas URL form and story-card actions open the same dialog. Inactive source fields are disabled so a hidden invalid URL cannot block story selection. Request errors keep all selections available for retry; creation disables its controls until the request finishes. If the draft saves but the served library does not update, the sheet retains the saved ID, blocks repeat creation, and provides a safe Refresh My shorts link instead of navigating to a missing editor. The source-based generator makes no writing-model request.
- Delivery validation runs through `parseNewShortDelivery(value, availableStockIds, defaultNarrator = "af_heart")` before fetching or persistence. The optional contract preserves existing API clients. `applyNewShortDelivery` copies the episode, retains complete narration, claims, evidence, sources and companion text, rescales provisional scene timing and stores presentation choices. Conversation assigns complete, unchanged scene narration to alternating speakers.
- **Voices & presenters** retains stock audio samples, default selection, installation and local actions. Personal recordings gain playable cards while keeping the existing saved-recording selector, filters, exact audition acceptance binding and deletion confirmation.
- **Add a voice style** progressively upgrades the existing enrollment details into a two-step native dialog. The existing recorder, upload, excerpt, transcript, explicit consent, save and subsequent audition handlers remain mounted. Closing the dialog stops microphone capture and audio playback while retaining the completed take. Save returns to the library; making a style available still requires its separate generated audition and explicit listened acceptance.
- **Presenters** shows saved local photos with friendly labels and honest per-script alignment states. Actions open the existing editor at Voice & presenter for alignment and motion preview. Photo upload reuses `/api/avatars` and generates a fresh name to avoid overwriting an existing photo. Personal photo bytes are requested from the local API and are not copied into a portable library.

## Boundaries and deviations

- The sheet offers supported sourced news creation paths. It does not offer blank or unresearched tutorial creation; prepared tutorial scripts remain accessible through My shorts. There is no existing safe base-episode API for the prototype's other source types.
- Format and tone are saved delivery metadata, explicitly described as such. They do not invoke an LLM or invent new quiz answers, myths, jokes, claims or narrative structure. Users review and edit the resulting text in the editor.
- Planned length is provisional scene timing, not a guarantee about recorded speech. Existing production validation remains authoritative; actual speech must satisfy the existing duration policy.
- New short defaults to the configured stock narrator (Heart when no default is configured), with asset setup deferred until production. Explicit stock voice choices require installed assets. Personal styles are selected after creation in the existing editor, which preserves its private-session authorization and accepted-audition checks.
- Alignment belongs to a script and may become stale if a photo changes. Gallery labels say **Alignment saved in a script** or **Needs alignment in a script**, and route to the existing per-script checks. There is no new global alignment or simulated motion preview.
- Native dialog support is a progressive enhancement. Static/no-JavaScript output keeps existing sections, stock audio players, anchors and enrollment details. No external scripts, fonts or image sources were added; the existing CSP is retained.

## Changed files

- `src/library-review.ts`: workspace labels, format actions, new workspace assets and panels; coordinator's production-history pass-through preserved.
- `src/workspace-panels.ts`: New short markup and presenter reference metadata.
- `src/news/new-short-delivery.ts`: pure delivery parser/application helpers.
- `src/news/generator.ts`: optional delivery application before draft persistence.
- `templates/workspace-panels.js` / `.css`: progressive dialogs, personal voice cards, presenter gallery/upload and responsive layouts.
- `templates/library.js`: shared New short entry points, preserving legacy creation fallback.
- `templates/library-navigation.js`: Formats and Voices & presenters headings; existing routes retained.
- `templates/voice-profiles.js`: read-only profile access, card selection bridge and lifecycle notifications; existing recording/acceptance safety logic retained.
- `tests/new-short-delivery.test.ts`: invalid/unavailable explicit-delivery rejection, asset-free default drafting, and all six formats at 15/45/90-second timing limits, with exact source/spoken-text preservation.
- `tests/workspace-panels.test.ts`: mocked request carrying all selections, retry/error behavior, inactive-source validation state, zero-stock drafting, saved-but-unindexed recovery without duplicate submission, safe markup and supported source choices.
- `tests/library-browser.test.ts`, `tests/library.test.ts`, `tests/voice-choice.test.ts`: intended heading assertions.

Coordinator registered both new templates/source modules in portable/runtime allowlists and wired optional `body.delivery` parsing (with the configured default narrator) into `/api/news/create` before invoking the generator. New UI requests use `promote: true` and open the saved base episode editor after library regeneration.

## Verification

- `npm run typecheck`: passes.
- Scoped Biome over all 14 changed implementation/test files: passes.
- `node --import tsx --test tests/new-short-delivery.test.ts tests/workspace-panels.test.ts tests/voice-profile-ui.test.ts tests/library-browser.test.ts tests/library-polling.test.ts tests/library.test.ts tests/voice-choice.test.ts`: **44/44 pass**.
- All new request tests use mocks. No production, enrollment, paid writing, approval, download or model installation was performed.
- Full suite, package verification, independent review and 1440/390-pixel CUA screenshots are coordinated by the parent agent after preview regeneration; no preview server was changed by this implementation agent.
