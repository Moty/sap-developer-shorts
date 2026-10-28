# Interactive portrait presentations

Every local workspace entry now has a **Presentation** link beside its main
editing/review action. The deck is generated from that saved script, its source
references and any verified demo capture available for that version. It is a
self-contained Reveal.js presentation with a fixed **1080 × 1920 (9:16)** canvas,
local assets and a dark slate theme. Use **Focus view** to enlarge the story, or
keep the scene index and evidence inspector visible beside it.

Save a revised script before opening its presentation. Unsaved editor text does
not replace the saved version's deck. Existing MP4 files keep their original
appearance until a new production runs.

## Generate or enhance a presentation with a prompt

In the local script editor, open **Writing & presentation assistant**. Choose the
configured local Gemma/LM Studio or SAP Hyperspace model, describe the desired
change, and choose **Generate / enhance presentation**. For example:

> Use ocean colors and snappy motion. Make the opening headline curious, keep
> middle scenes focused on code and evidence, and finish with a clear question.

The model authors short visual headlines and chooses from three palettes
(`electric`, `ocean`, `sunset`), three motion presets (`snappy`, `smooth`,
`minimal`) and per-scene emphasis (`balanced`, `headline`, `evidence`). This is a
bounded design system: the LLM does not generate executable HTML/CSS/JavaScript,
invent charts, replace code, or author numeric results. Existing source cards,
availability/scope labels and data interactions remain grounded in saved inputs.
It complements the narration rather than replacing it with slide text.

Use **Preview proposed presentation**, expand the seven-headline comparison, and
choose **Apply presentation design** after review. The preview is an isolated,
interactive planned deck, with no new speech, portrait animation or demo run.
It does not claim to contain captured results that were never supplied. Preview
does not make another LLM request. Apply changes editor state only; **Save draft**
creates the version whose library deck and next MP4 use the design.

A saved library deck also links back to **Enhance presentation with a prompt**.
Further requests include the current design, so a user can ask for refinements.
Applying a result checks the source, current wording and current design to avoid
overwriting later edits. Voices, photos, pronunciation, companion posts, scene
order and speaker turns remain intact. Design state participates in browser
recovery, change review, download/import and version saving. **Use automatic
presentation design** removes the override; old versions without a design retain
the automatic renderer.

The optional `presentation.design` contract is versioned independently of cloned
voice schema versions. `feedSceneDesign()` resolves it for both renderers; visual
headlines, palette, emphasis and entrance pace share that compiled direction.
Motion follows scene-relative measured time when narration exists. Render hashes
bind the complete episode, compiler and renderer sources. A new design gets a
new video identity; compatible unchanged speech can be reused. Generated visual
headlines are checked with export fonts and safe-area bounds before a proposal
is offered or applied. Browser headings also fit their bounded area; code and
evidence fonts remain unchanged.

Hyperspace design generation uses one completion and requires the same explicit
cost acknowledgment as other writing requests. Local writing does not fall back
to Hyperspace. See [writing setup and privacy](WRITING_ENGINES.md). This UI is in
the local studio; the Firebase hosted editor does not yet dispatch LLM design jobs.

## Flexible short timing

The studio accepts **15–90 seconds of measured audio**, with **45–60 seconds** as
the preferred writing target. Individual scene budgets, a three-second opening,
and seven hook words are recommendations. A 55.5-second episode with a
3.04-second opening can proceed; production does not stretch or truncate speech
to force each original slot. Audio samples, caption coverage, positive contiguous
scene timing and MP4 frame/codec/decoding checks remain strict. Encoding has the
existing 0.1-second tolerance.

This is the application's editorial range, not a universal platform upload limit.
LinkedIn's [sharing guide](https://content.linkedin.com/content/dam/help/linkedin/en-us/LinkedIn-Sharing-Guide.pdf)
suggests 30 seconds to two minutes; [YouTube documents Shorts up to three minutes](https://support.google.com/youtube/answer/15424877?hl=en).
The narrower studio range keeps these tutorials concise while accommodating real
speech. Older blocked attempts within the new range are labeled ready to retry;
restart an old rendering worker with updated source before retrying.

Validation for this update: 324 Node 22 tests, 12 desktop tests, typecheck/build
and the private UI build passed. Live local Gemma generated a valid design in
27.3s (1,576 reported tokens); the original Flint instance was restored afterward.
Live Hyperspace Gemini generated a valid design in 6.7s (2,062 reported tokens).
These are integration observations, not an editorial-quality or pricing ranking.
No installer was built or released for this source update.

## Renderer choice

| Option | Role in this project |
| --- | --- |
| [Reveal.js](https://revealjs.com/) | Selected for interactive browser decks. Its [fixed presentation dimensions](https://revealjs.com/presentation-size/) and [auto animation](https://revealjs.com/auto-animate/) fit a portrait story and local delivery. The dependency is pinned at 6.0.2 and the MIT license is included with each export. |
| [Slidev](https://sli.dev/guide/) | A good Markdown/Vue authoring environment. Its [export documentation](https://sli.dev/guide/exporting.html) distinguishes interactive hosted decks from static exports. It would add another authoring/runtime layer beside our existing scene contracts. |
| [Remotion](https://www.remotion.dev/docs/the-fundamentals) | An alternative React video renderer with frame-based compositions. This implementation keeps the existing verified Canvas/FFmpeg pipeline, including its narration, captions and portrait integration. A future Remotion adapter would need its own compatibility and [license review](https://www.remotion.dev/docs/license/pricing), particularly for a larger organization or hosted automation. |

The existing app remains the content, voice and rendering workspace. No separate
chat UI, hosted artifact service, paid rendering provider or model account is
required. `npm ci` installs Reveal.js with the other project dependencies; no
additional terminal setup is needed for presentations.

## Scene design and interactions

The presentation uses the script's existing order and measured narration timing
when it exists. Script-only decks are explicitly labelled as planned previews.

- **Opening:** a large headline and blue/violet canvas establish the hook immediately.
  CAP scripts with the explicit-service claim use a model → missing service → API
  diagram; other scripts use their own actual story steps.
- **Closing:** one question taken from the narration and an official-source action
  replace the repeated step list.
- **Code:** the complete saved source stays intact. A line inspector and
  expandable explanation help review it. During playback, complete identifiers
  mentioned in the caption highlight their source lines.
- **Captured results:** row counts, stock charts and a minimum-stock slider use
  only the captured rows. The slider explores that saved result; it makes no
  live API call and does not imply a new verified request.
- **News:** availability, timing and scope come from the explicit claim fields,
  with expandable links to their cited sources. Expired source reviews remain
  visibly marked and still block normal production until refreshed.

Play synchronizes scenes and captions to the saved narration, or runs a silent
planned preview when narration does not exist. Seeking, scene buttons and direct
keyboard/touch navigation pause playback for inspection. Interacting with data
or source controls also pauses narration. Returning to playback resets the stock
filter to the captured result. Leaving/hiding the page stops playback.

Reduced-motion preferences remove decorative motion and slide transitions while
retaining navigation, data exploration, timing and the evidence inspector. The
portrait canvas stays in slide mode on narrow screens: Reveal's automatic mobile
[scroll view](https://revealjs.com/scroll-view/) is disabled explicitly.

## MP4 output

The existing deterministic 30 fps video renderer now uses the same script-derived
story steps and a scene-specific visual system. It adds a large, readable opening
from the first frame, bright blue/violet hook and closing scenes, cyan code focus,
lime results, amber news availability, animated connections, rotating result-row
focus, frame-based progress and stock bars/counts derived from captured results.
Full code and captured values remain unchanged. Existing caption bounds, presenter/photo integration, source
checks, duration checks, audio normalization and complete video decoding remain
in the export path.

Interactive controls belong to the browser presentation. An MP4 plays a fixed
animation sequence and cannot carry clickable tabs or sliders. The browser deck
and MP4 share content and timing, with layouts suited to their different jobs;
they are not promised to be pixel-identical renderers.

New local video exports include `presentation.html`, `presentation.json` and
`reveal-LICENSE.txt`, linked from the video review page and included in its ZIP.
The deck uses that MP4's audio track, so the ZIP stays playable without duplicating
private reference recordings or model files. Library decks use the corresponding
saved narration file. Source code that no longer matches a saved run's hash is
not substituted into its verified presentation.

Presentation files are hashed in video receipts and package manifests. A partial
or changed deck fails verification. Older video receipts without a presentation
remain valid. Complete local studio ZIPs also retain the decks and validate their
inventory. Account-based worker downloads retain their existing four-file media
bundle; the MP4 gets the motion improvements, while publishing interactive decks
through that authenticated service is a separate integration.

Renderer/template changes produce a new render identity rather
than overwriting an earlier verified export.

## Implementation

- `src/presentation-deck.ts`: source-derived scene plan and safe HTML generation.
- `templates/presentation.css` and `templates/presentation.js`: local visual
  system, 500 ms transitions, playback, accessibility and interactions.
- `src/video/motion.ts`: deterministic motion and shared story-step selection.
- `src/video/feed-design.ts`: scene roles, palettes and source-derived emphasis.
- `src/video/frames.ts`: frame rendering within the existing mobile safe areas.

Source content is escaped as text. The generated plan is data, not model-written
JavaScript. Reveal, styles and interaction code are bundled locally; the deck's
CSP disables network connections and permits only local media. Official source
links open when the viewer chooses them. No background source fetch or external
analytics is added.

## Verification record

Validated October 25, 2026: 297 automated tests, five live CAP checks, content
validation, typecheck and both builds passed in a clean source-only checkout.
Changed-file lint passed; the repository retains eight pre-existing lint errors
in unrelated files. Tests cover exact source/capture preservation, missing
narration timings, escaped content, availability disclosures, deterministic
motion, changed deck bytes and complete package inventories.

The CAP pilot `CAP-01@casual-v2-edit` was produced locally as a 47.580-second,
1080 × 1920, 30 fps H.264/AAC video. Complete decoding, caption timing and audio
checks passed (−16.18 LUFS integrated, −4.5 dB true peak). Its fresh production
took 113.4 seconds; the final render using completed narration took 41.9 seconds.
These are measurements from this Mac, not promises for other machines. The
interactive deck's three files passed receipt verification, and the complete
approximately 165 MiB local studio was successfully packaged with its presentations.

Browser QA exercised narration-driven scene changes and captions, code
inspection, focus view, results/chart switching, captured-stock filtering and a
news availability scene with expired-source disclosure. Frames extracted from
the final MP4 were visually reviewed across the opening, code, result and closing
scenes. This did not include a new subjective evaluation of speech or portrait
realism. Logs, screenshots and the recorded output checks remain locally under
`.state/private-tests/presentation-*`; generated media is excluded from Git.

## Feed edition and visual comparison

The October 26 feed pass uses a stronger first-frame hierarchy, deliberate color
changes between scene types, larger result numbers and a single closing question.
Code retains the complete source and highlights identifiers in the current caption.
Its advanced inspection controls are collapsed in the browser deck so they do not
compete with the story. Captions and the existing portrait safe area remain intact.
Reduced-motion preferences still suppress decorative browser animation.

The design follows LinkedIn's official guidance to [tell the story visually early
and design for viewing without sound](https://business.linkedin.com/advertise/ads/sponsored-content/video-ads/tips).
That guidance informs the visual choices; this project has not measured feed
retention or engagement uplift. Compare the outputs with the intended audience.
The interactive deck has navigation and data controls; LinkedIn receives the
fixed, animated MP4 when you choose to upload it.

With the standard local Kokoro/FFmpeg setup installed, reproduce the public CAP
comparison sample locally:

```sh
npm ci
npm run build
npm run shorts -- produce CAP-01@feed-pop
```

Use the returned studio link, then open **Presentation** or **Review video** for
that version. The sample keeps the existing casual CAP narration, Heart voice and
source-backed data; its pronunciation dictionary matches the locally reviewed
CAP pilot. A render with completed compatible speech reuses the verified audio.
New generation uses the new visual system; earlier verified MP4s are preserved.

Validated October 26, 2026 in a clean source-only checkout: **300 tests**, five
live CAP checks, typecheck, content validation and both builds passed. Changed-file
lint is clean. The tracked repository still has eight unrelated pre-existing lint
errors; additional local user drafts may also appear in a whole-workspace lint.

The `CAP-01@feed-pop` pilot is 47.580 seconds, 1080 × 1920 at 30 fps. It reused
completed narration from the earlier pilot and took **44.1 seconds** through
render verification (**40.2 seconds** for rendering). Receipt checks, complete
video decoding and audio checks passed. The saved audio content matches the
previous pilot; this comparison evaluates the visuals. Native first-frame and
all-scene frames, the actual exported MP4, CAP code/results interactions and news
availability/source disclosures were visually checked. Private local evidence is
under `.state/private-tests/feed-*`; generated media is excluded from Git.
