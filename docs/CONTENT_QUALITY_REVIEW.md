# Content quality review and editorial engine proposal

Reviewed October 27, 2026. Status: research and implementation proposal. No new
installer, model integration, paid generation, or replacement of saved episodes
is part of this review.

## Recommendation

Add a capable writing LLM and an editorial workflow before rendering. The current
news drafting path has **no writing LLM**. Its limitations are primarily in story
selection, source interpretation and composition, rather than an existing model
being too small. Keep local Kokoro/Qwen speech and Ditto rendering; a writing
provider is a separate choice from the voice and GPU engine.

The user's preferred architecture is now **local writing**, keeping the workflow
self-contained. Start by testing Qwen3.8-27B in 4-bit MLX format, with Gemma 4
26B A4B as a comparison and a compact Qwen option for smaller Macs. See the
[local model research and revised runtime plan](LOCAL_EDITORIAL_MODELS.md) for
hardware evidence, exact repositories/sizes and implementation behaviour.
External providers remain optional and disabled by default; there is no automatic
cloud fallback. Choose the writing default from blind comparisons of our scripts.
A stronger model alone will not repair paragraph extraction, missing attribution
or repetitive scene design.

Routine changes should be reviewed, tested and committed in the source project.
Batch desktop installers at explicit release milestones; see
[desktop release cadence](MAC_DESKTOP.md#release-cadence).

## What was examined

- The discovery/drafting implementation in `src/news/fetcher.ts` and
  `src/news/generator.ts`, the news contracts, and version 1 editorial prompts.
- CAP-01 and its feed-pop, comic and two-speaker scripts; NEWS-01 and NEWS-02,
  including the myth/fact version; locally saved recent automatic news drafts.
- The completed 56.4-second **AI Release Highlights Q3 2026** presentation,
  including its saved narration text, measured scene timing and rendered slides.
  The actual slides were opened in the browser. They are generated media and
  remain outside Git.
- Reveal presentation generation, Canvas MP4 scene composition and shared motion
  design. The two renderers share content/timing but have different layouts.
- Current primary documentation for writing models, evaluation and video review,
  LinkedIn's creator guidance, and the relevant official SAP announcements.

This is a text, storyboard and rendered-slide assessment. No fresh audio listening
test, audience retention experiment or paid model comparison was performed.
Successful MP4 verification establishes technical integrity, not editorial value.

A read-only Node 22 probe supplied a synthetic article with zero paragraphs or
quotes and the fetcher's normal cloud-angle default. `buildNewsEpisodeFromStory()`
accepted it and returned a schema-valid seven-scene script with invented
announcement/rollout statements. No article was fetched or draft saved. The
local receipt is `.state/private-tests/content-quality/empty-article-probe.json`.
This reproduces the need for M0's evidence checks independently of writing taste.

## Findings from the actual output

| Area | Evidence | Assessment and consequence |
| --- | --- | --- |
| Ideation | `scoreItem()` ranks title/category keywords and selects a stock angle. | A relevance filter, not story ideation. It does not identify a viewer problem, surprising outcome or demonstrable payoff. One AI-related angle is reused across unrelated articles. |
| Automatic writing | `buildNewsEpisodeFromStory()` takes the first selected sentences, prefixes ordinal words, truncates them and inserts a fixed CTA. | The result reads like an abbreviated press release. No composition or editorial rewrite happens. |
| Complete sentences | The Q3 deck's first claim reads “This quarter marks a major step in delivering.” | Punctuation was appended to an incomplete thought. `trimWords()` cuts at a word limit, despite its sentence-preservation comment; context is also cut at 90 characters. |
| Attribution | The Q3 narration speaks in the source author's first-person plural. A later scene refers to an unidentified person as “He.” | Viewers cannot distinguish the presenter, SAP and a quoted customer. Extracting a sentence loses surrounding attribution. |
| Visual relevance | At about 33 seconds, the deck labels a customer productivity expectation as “When it ships.” | The heading, narration and evidence do not answer the same question. A number-containing sentence is not necessarily an availability statement. |
| Evidence quality | Drafting inserts generic release timing, scope and support notes. `fetchStoryDetail()` sets publication dates to the fetch date. | Source-shaped JSON can pass validation while its interpretation is unsupported. A saved draft of the October 6 announcement recorded October 26 as publication. Retrieval must not rewrite publication history. |
| Hook | The rendered Q3 test opens with a general question; generated hooks also make broad enterprise promises. | A short, valid hook can still offer no reason for this audience to keep watching. Keyword substitution can imply claims the article does not establish. |
| Payoff | An editorial instruction about contrasting AI hype and tabular data is read as the presenter's takeaway. | The audience hears the drafting instruction rather than a useful conclusion. |
| Prepared CAP writing | Feed-pop explains the real inventory example; comic and duo versions contain short situational jokes and actual questions. | Better foundation: concrete object, visible result, some personality. Much of the flow still explains each panel in order, and context/model scenes repeat information. |
| Prepared news writing | NEWS-02 preserves rollout/access distinctions and gives claims specific support notes. | More careful than automatic drafts, but repeated qualification and three-point narration can dominate the story. Keep material caveats while making the practical implication the thread. |
| Visual storytelling | News scenes repeatedly show a heading, availability badge and claim card. CAP has code focus, captured rows and a service bridge. | Styling and motion improved; news still lacks a visual explanation of the process. Colours and entrance motion cannot replace a reveal, meaningful comparison or demonstrated change. |
| Quality checks | Existing contracts check fields, IDs, dates, phase order and draft pace; media checks measure speech and validate output. | Valuable checks, but they do not verify semantic support, sentence completeness, hook appeal or whether a slide explains the narration. |

The [October 6 SAP release](https://news.sap.com/2026/10/sap-connect-sap-puts-autonomous-enterprise-to-work/)
confirms that publication date. The
[Q3 article](https://news.sap.com/2026/10/ai-release-highlights-q3-2026/)
places the productivity expectation in a named customer's pilot context. It is
not a product shipping date or a measured universal benefit. These distinctions
need to survive both rewriting and visual design.

## Editorial target

The presenter should sound like an informed colleague sharing a useful discovery.
Write for a named viewer: a CAP developer debugging a service, an architect
evaluating agent integration, or a consultant explaining a release to a client.
One video should deliver one memorable change in understanding.

[LinkedIn's creator guidance](https://www.linkedin.com/business/talent/blog/talent-acquisition/how-create-videos-for-linkedin-feed)
supports a single idea, an early hook, concrete examples and a conversational
delivery. For synthesized presenters we still need exact spoken text, but should
write it with the rhythm of talking points rather than a document being read.
These are editorial hypotheses to test, not promises about feed distribution.

Suggested house rules:

- Open with a recognizable problem, prediction or specific curiosity. Pay it off
  in the same short. Remove introductions that merely announce the topic.
- Give the viewer a concrete object: one invoice, one failing request, one stock
  filter. Explain the concept through what happens to it.
- Use contractions, varied sentence lengths and natural connective phrases.
  Ask questions the next beat actually answers. Remove corporate filler.
- Use one or two short situational jokes when they help the explanation. A joke
  should arise from developer friction, mistaken expectations or the scenario.
  Forced puns, unrelated memes and constant punchlines distract from learning.
- Let narration explain motive, interpretation and consequence; let visuals
  demonstrate state, flow, code changes and results. Keep faithful captions, but
  do not duplicate the full spoken paragraph as the slide body.
- Change something meaningful on screen as an idea develops. A reveal can happen
  within a scene; seven scenes need not mean seven static cards.
- Keep significant availability, scope and evidence qualifications in the story
  where they change its meaning. Put detailed source metadata in the inspector
  and companion post instead of repeatedly reciting administrative checks.
- End with a result and a specific next question. A broad request for thoughts
  should not be the only payoff.

### Formats to generate deliberately

| Format | Story mechanic | Example angle |
| --- | --- | --- |
| Debugging story | Symptom → plausible guess → small fix → checked result | A CAP model exists, but the intended service projection is missing. |
| Predict and reveal | Ask for a prediction → show evidence → explain the surprise | Which of three products survives the positive-stock filter? |
| Colleague conversation | A skeptical question changes the explanation or next action | Two developers trace why an endpoint exposes the wrong thing. |
| Visual analogy | Map a familiar process to the concept; show the limits of the analogy | A dispatcher, specialist and task worker clarify agent roles. |
| News with consequence | One change → one affected workflow → access/limits → next step | What would this announcement change in an architect's evaluation? |
| Light comedy | A real misunderstanding drives the joke and the correction | Treating an entity definition as if the API should magically appear. |

Professional can be warm and lively. Casual can remain precise. Comic requires
authored comic timing. The model must choose a story structure as well as a tone.

## Model options and recommended pilot

Local inference is the preferred pilot. Use the shortlist and managed MLX runtime
in [local writing models](LOCAL_EDITORIAL_MODELS.md). The hosted options below
remain research references for an explicitly requested external comparison;
they are not prerequisites or the default implementation path.

Official product capabilities establish feasibility, not which model writes our
best script. Account access and current prices must be checked when configuring
a provider; this review enables no API billing.

| Option | Proposed use | Boundary |
| --- | --- | --- |
| [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | Optional external writing comparison. | Documented text/image input and structured outputs; lower-cost positioning than Astra. Quality for this series remains to be measured. |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | Review source support, weak explanations and difficult technical choices; optional premium writer. | Text/image input. Do not present it as directly hearing or watching the whole MP4. |
| [Claude Opus 5.5](https://platform.claude.com/docs/en/models/overview) | Comparison writer for voice, analogies and dialogue. | A credible candidate from the current model lineup; no evidence here that it universally outwrites the other models. |
| [Gemini](https://ai.google.dev/gemini-api/docs/video-understanding) | Review final audio and visual streams with timestamps; optional writing comparison. | Native video understanding, with sampling limitations for fast changes. Use a supported model and record its actual ID. |
| [Managed local MLX writer](LOCAL_EDITORIAL_MODELS.md) | Preferred ideation, writing and sequential review path; LM Studio can be an optional development adapter. | Benchmark the selected weights and runtime on the actual Mac. Do not equate Qwen3-TTS with a writing LLM. |

Start with one local provider integrated well, then add local alternatives through
the same contract. Writer and reviewer are sequential workflow steps; separate
autonomous agent infrastructure is unnecessary for this bounded task.

The existing Google subscription can be used for a manual comparison/review if
the required features are available in that account. Do not assume it pays for
embedded API calls: [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
is configured per project/billing account. Public model documentation is not
evidence of the user's particular entitlements.

## Proposed content pipeline

1. **Research pack.** Fetch and preserve official article sections with canonical
   URL, title, author, actual publication date or null, retrieval timestamp,
   content digest and paragraph/section IDs. Preserve attribution around quoted
   claims. Remove navigation/footer material. Reuse valid cached packs.
2. **Fact ledger.** Extract supported facts with exact evidence locations,
   attribution, dates, scope and availability. Mark measured results, forecasts,
   vendor claims, editorial inference and illustrative examples separately.
   Missing availability stays unknown in this ledger; it must not acquire an
   invented rollout label just to satisfy the existing episode schema.
3. **Story proposals.** Produce five genuinely distinct ideas from a source/topic
   pack. Each contains audience, viewer problem, central question, proposed hook,
   promised payoff, visual opportunity, supported facts and research gaps.
   Deduplicate against previous ideas and episodes. Label ranking as editorial.
4. **Choose an angle.** Let the user choose a proposal, tone, format and humor.
   Generate two comparable scripts for the selected angle rather than rendering
   every possibility. Keep model/provider visible and configurable.
5. **Write speech and visual beats together.** Return a structured story plan with
   spoken text, short display text, factual references, scene purpose, meaningful
   visual events and intended delivery. Performance notes are metadata, not words
   for TTS to read. Preserve exact executable code and captured data.
6. **Review and revise.** Check source entailment and technical correctness, then
   review clarity, natural speech, hook/payoff and visual/narration fit. Return
   actionable findings tied to scenes/claims. Allow at most two revision passes;
   unresolved facts or creative problems return to the editor.
7. **Preview cheaply.** Show script and storyboard side by side, allow a hook or
   scene rewrite, then audition the opening plus a representative passage in the
   selected voice. Only then synthesize the full narration, check actual timing
   and render the expensive portrait/video. Preserve the 45–60s and ≤3s hook gates.
8. **Review the output.** Inspect the complete MP4 at phone size with sound on and
   off. Optional Gemini review returns timestamps and observable evidence.
   Approval/publication remain human actions.

## Story plan and rendering contract

Add typed editorial contracts rather than asking a model for arbitrary HTML or
application code. Suggested contracts: `ResearchPack`, `FactLedger`,
`StoryProposal`, `StoryPlan` and `EditorialReview`, each with a version.

A beat should carry `purpose`, `spokenText`, `screenText`, `claimIds`,
`visualTemplate`, `visualDataRef`, `revealCues`, `deliveryIntent` and
`presenterFraming`. Evidence references must resolve to saved facts, code or
captures. Validate model output using application schemas even when the provider
supports structured output. Valid JSON is not evidence of factual quality.

Begin with six reusable visual templates: highlighted code change, illustrated
process flow, before/after state, prediction/reveal, scoped statistic, and
comparison. Label conceptual diagrams as illustrations; real execution panels
retain their checks. A statistic needs its source, subject and measurement type.
Unknown values must not be turned into counters or decorative charts.

Initially compile plans into the existing seven scene slots. The current tutorial
and news contracts fix phase order; presentation variants also preserve visual
inputs. New diagrams and presenter framing therefore require an explicit,
versioned story-plan sidecar and renderer work, not just a new prompt. Both Reveal
and Canvas must consume the same validated beat data. Align reveals to measured
phrase timing; keep a deterministic timeline in MP4 and optional exploration in
the browser deck. Include plan and renderer versions in hashes/receipts. Reject
unsupported templates clearly. Keep older saved episodes and MP4s compatible.

The presenter can establish a point, move into a smaller framing while the
concept is demonstrated, and return for a reaction or payoff. This needs planned
composition; continuous corner narration alone does not create a performance.
Keep selected personal voice/photo revisions through every rewrite. Delivery
intent does not guarantee that Kokoro/Qwen can act an emotion; audition the actual
engine and sample. Do not silently switch voices to obtain a different style.

## Quality assessment and model comparison

Use separate factual checks and creative judgments. A high engagement score
cannot compensate for an invented claim or changed test result.

Factual pass requirements: material speech/display claims have relevant support;
numbers retain subject, attribution and measurement type; dates/status match the
source; quotations are not silently reassigned; technical demos still execute.
Unknowns and disagreements are surfaced rather than filled with stock text.

For creative review, use 1–5 anchored judgments with scene-level evidence:

| Dimension | Weak (1) | Acceptable (3) | Strong (5) |
| --- | --- | --- | --- |
| Audience relevance | Topic announcement | Recognizable problem | Specific consequence the viewer wants resolved |
| Hook/payoff | Generic promise | Clear question answered | Specific curiosity with a satisfying demonstrated answer |
| Spoken delivery | Press-release prose | Understandable speech | Natural rhythm, precise language, purposeful personality |
| Explanation | Product/name list | Coherent explanation | One concrete scenario makes the idea easy to remember |
| Visual contribution | Paragraph repeated | Helpful illustration | Visual reveals explain something speech alone would struggle to convey |
| Pacing | Repetition or rushed density | Manageable content | Each beat advances the question with room to absorb the result |
| Humor/dialogue, when selected | Added reactions/puns | Relevant occasional moments | The interaction helps cause the explanation or payoff |

Scores are editorial signals, not measured retention. Start with a proposed
minimum of 4 for relevance, speech, explanation and visual contribution, no
dimension below 3, and all factual checks passing. Calibrate these thresholds
with the user's preferences before treating them as automated production gates.
Humor is not required for a professional script.

Pilot design: use six representative briefs (two tested tutorials, two news
explainers, one dialogue and one comic version). Compare current output with the
new local workflow, then compare the selected local Qwen and Gemma candidates.
Use equal length budgets, identical evidence and bounded revision opportunities.
Blind and randomize names/order. Record user preferences, concrete findings,
revision counts, latency, peak memory and token counts including reasoning/retries.
Treat six briefs as an initial screening, not a statistically conclusive ranking.

Separate a development set from held-out briefs. Use the user's selections to
calibrate model reviews. [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
supports task-specific comparisons and agreement with human judgments. Store the
benchmark locally as fixtures/results; no dependency on the retiring hosted Evals
product is needed. Measure actual audience completion and useful responses only
after explicitly published pilots, without claiming a model score predicts them.

## Implementation milestones

| Milestone | Concrete changes | Acceptance evidence |
| --- | --- | --- |
| M0: Correct the drafting baseline | Fix real publication-date extraction, sentence handling, attribution and unsupported defaults in fetcher/generator. Show heuristic drafts as needing editorial review. Retain original saved content. | Fixtures for old/unknown dates, missing facts, detached quotations, performance forecasts and heading/content mismatch; sparse sources cannot produce fabricated release scope. |
| M1: Research and provider foundation | Add typed research/fact/proposal contracts, provider interface, settings and durable editorial jobs. Implement one managed local MLX provider plus mock adapter, model setup and offline smoke test. Keep import/export/manual authoring available. | Source IDs/digests survive; malformed responses, cancellation, restart and provider errors preserve drafts; model assets are verified, missing setup has a UI action, and no remote model endpoint is contacted. |
| M2: Ideation and script workshop | Add Generate story ideas, two script choices, targeted rewrite and Compare versions. Version prompts separately from app binaries. Preserve voice/photo assignments. | Distinct proposals with a promised payoff; a rewrite creates a new saved version and retains exact selected presenters; no render is triggered by browsing ideas. |
| M3: Editorial review and voice preview | Add source/technical review, creative rubric and bounded revision loop. Opening/passages audition before full production; timing feedback appears beside the scene. | Review finds the concrete failures in this audit; actual spoken hook passes; unresolved facts cannot be labelled approved; no portrait job for a script awaiting revision. |
| M4: Directed visual storytelling | Implement versioned sidecar and initial templates in both renderers, phrase-linked reveals and presenter framing. Start with one CAP and one news pilot. | Phone-size inspection, mute test, narration/visual consistency, data/claim provenance and deterministic MP4 checks; older episodes still render. |
| M5: Compare and select defaults | Run the blind local-model pilot; add alternatives only through the shared contract. External comparisons/video-review adapters require explicit opt-in. | Stored comparisons, model IDs/revisions, prompt versions, input hashes, memory/time and reviewer agreement; default selected on observed outputs; no automatic cloud fallback. |

Suggested implementation areas are `src/editorial/`, `schemas/editorial/`,
`prompts/v2/` and the existing local API/editor, followed by private-workspace
integration. Keep role names as sequential jobs within one bounded orchestrator.
Create no unbounded background generation loop.

Local writing needs no external provider credential. If an external adapter is
explicitly added, credentials belong in Keychain for desktop and the existing
protected server configuration for hosted workspaces. Store usage/timing per
editorial stage; bound local resources and any approved external spending. Never
silently downgrade a model or activate another provider. Model calls require only
the selected public research/code/text; personal voice recordings and photos are
not writing inputs.
Finished-video review is a separate, explicit transfer when it contains a person.
Source text remains untrusted data, including instructions embedded in a page.

Local writing must share the device's heavy-job scheduling with speech/portrait
rendering. Keep the Mac mini and MacBook Pro as options, with capacity checked
per device. The standalone workflow needs no cloud inference or Firebase login.

## Concrete next pilot

Use the [CAP script and shot-plan example](../samples/editorial_quality_pilot.md)
to agree on the voice of the series. It includes a source-grounded tutorial,
situational humor and visuals that demonstrate the explanation. It is an
editorial draft, not a newly produced or timing-approved video.

Then implement M0–M3 in the source build, compare the first two scripts, and add
M4's visual templates against the selected stories. Batch an installer only when
there is an agreed release to test on another Mac.
