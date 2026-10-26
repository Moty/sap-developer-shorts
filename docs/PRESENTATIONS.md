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

- **Opening/closing:** animated flow cards link to the script's actual demo or
  announcement steps.
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
story steps and a darker visual system. It adds eased headline entrances,
animated process cards, frame-based scene progress, subtle ambient motion and
stock bars/counts derived from captured results. Full code and captured values
remain unchanged. Existing caption bounds, presenter/photo integration, source
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
