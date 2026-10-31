# Final review, response budgets, and editor navigation

Implemented October 28, 2026 in the local studio source. No new installer was released.

## Use it

Open **Review & produce → Final AI review → Review all content**. It reviews the
current script, companion post, presentation headlines/design and saved evidence
together. It records the model and reviewed-content fingerprint. Source, voice,
photo, speaker assignment, and other media metadata are protected from model edits.

Expand an issue to compare suggested text. Applying proposed fixes updates only
the editor and marks its review outdated. Edits require another review before
that result can describe the changed text; unchanged content saved as another
version retains the match. Review remains advisory and optional. Audio, rendered
pixels and live factual accuracy are outside this stage.

In **Settings → Writing engine → Response length & model budgets**, choose separate budgets
for ordinary writing and final review, or **Provider default · no app token cap**.
Defaults are 8,192/16,384. Save writing preference to use a new budget on future
requests. Jobs retain the budget they started with. Hyperspace retains explicit
per-request cost acknowledgment and no automatic fallback or inference retries.

Local final reviews request [LM Studio schema-constrained output](https://lmstudio.ai/docs/developer/openai-compat/structured-output).
This controls JSON syntax; application checks still validate fields, references,
complete replacements, preserved links, word budgets, and presentation bounds.
Remote models keep the existing compatible chat transport and output validation.

The editor also includes a sticky Script-only **Jump to → Go** navigator for
version/title, the writing assistant, and every scene. Step buttons target real
content headings rather than the sticky controls. Hidden unauditioned players
no longer take up space. Details from the independent GPT-6 Astra review are in
[the usability review](EDITOR_USABILITY_REVIEW.md).

## Verification

- 337 automated tests passed, including full-content review bindings, changed
  evidence, identical saved copies, restart persistence, guarded text edits,
  source-link preservation, local-session/origin enforcement, cost acknowledgment,
  custom budgets, and omitted token-cap parameters in provider-default mode.
- Type checking/build, 12 desktop tests, and content validation passed. All changed
  code passes scoped Biome checks. Whole-workspace lint retains pre-existing
  unrelated code/content and private-draft diagnostics.
- Real Gemma 4 31B review of the unchanged finance episode succeeded in 12.65s;
  2,275 input/55 output tokens were reported. Its actual matching review receipt
  is retained privately in the workspace, without changing the saved provider
  preference. It found no issues in that supplied text; this is not independent
  factual or media approval.
- A deliberately contradictory companion post claimed global SAP Pay access and
  immediate consolidation availability. A local schema-constrained review using
  provider-default output length succeeded in 40.16s and flagged both as high
  severity. Reported usage: 2,112 input/404 output tokens. In the real editor,
  matching that test text showed Needs attention; applying its correction
  preserved the source link and voice selection, and disabled stale Apply.
  The original companion post was restored without saving or producing the test.
- Earlier local probes are retained for diagnosis: Flint exhausted 3,072 and
  12,288 output tokens; an unconstrained Gemma reply failed JSON parsing.
  No incomplete answer altered a draft or triggered a hidden retry. Configurable
  budgets and local schema constraints address these distinct failure modes.
- Budget controls were tested through the real UI: a 32,768-token review budget
  persisted, then provider-default mode saved null and disabled the numeric
  field. Existing completed-job budgets stayed intact.
- The scene-seven → Review/Voice navigation was checked in the browser. GPT-6
  Astra independently verified desktop and 390px mobile heading clearance,
  keyboard continuation, no horizontal overflow, and mounted voice/photo fields.
- Gemma remains loaded as `gemma-4-31b-it` with a 32,768 context and parallelism
  one, as requested. Flint is unloaded. No app provider preference was changed.

Local evidence is under `artifacts/final-review/`, including successful and failed
receipts, model-state snapshots, test logs and screenshots. Private reviews and
voice/photo data are excluded from Git. The current source preview remains at
`http://127.0.0.1:59725/review.html`.
