# Episode editor usability review

GPT-6 Astra reviewed the editor flow on October 28, 2026 at the user's request,
using source inspection and a read-only desktop browser check. It recommended
keeping the three steps: Script, Voice & portrait, and Review & produce.

## Bounded improvements implemented

1. Step changes previously scrolled the sticky step bar itself. After navigating
   deep into scene seven, Review & produce could land below the companion post
   and final-review card; Voice & portrait could skip the presenter choices.
   Step changes now scroll a real destination card/heading after revealing its
   pane, using the measured navigation height as clearance.
2. The desktop scene outline scrolled away and disappeared below 800px. A
   Script-only Jump to selector and explicit Go button now share a sticky
   container with the three steps. Version/title, the writing assistant, and
   every scene remain reachable on desktop and phone layouts. Selecting an
   option with keyboard arrows does not navigate until Go is activated.
3. Navigation measures the sticky container on jumps and resize, including
   responsive wrapping. It focuses destination headings/cards with preventScroll,
   avoiding an unexpected mobile keyboard. All editor cards and their fields stay
   mounted, retaining values, voice/photo setup, and recovery behavior.
4. A CSS cascade made hidden, unauditioned audio players visible. A targeted
   hidden-player rule removes these disabled controls and the unused space.
   Completed auditions continue to show their player normally.
5. Production failure recovery no longer opens Voice and then focuses a hidden
   narration input. Script issues focus the opening scene; voice issues focus
   the visible voice/photo section.

Implementation: `src/script-editor.ts`, `templates/script-editor.js`, and
`templates/script-editor.css`. The same navigation is used by writing setup and
review-history actions. No installer release is required for the source preview.

## Recommended follow-ups

- Add direct edit links from each review/validation issue and compact review/job
  status in the persistent controls.
- Audit recovery of pronunciation edits: they are saved in a draft, but current
  session recovery enumerates DOM fields separately from the live glossary.
- Consider restoring each step's previous scroll position after the explicit
  landing behavior is validated. Keep a clear way to return to a step's start.
- Consider optional scene collapsing only if the simpler navigation still leaves
  editing cumbersome. Avoid hiding active input, losing audition state, or
  changing voice/photo handling during a layout refactor.

The review did not initiate generation, save drafts, or change voice/photo data.
