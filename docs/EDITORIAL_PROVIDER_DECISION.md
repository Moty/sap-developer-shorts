# Editorial providers after the local screen

Researched October 27, 2026. This is online research and a recommended next
experiment. No new weights, hosted inference, account changes or installer
release were performed. The earlier [measured local results](LOCAL_MODEL_BENCHMARK.md)
remain unchanged.

## Decision

Keep local authoring and rendering available, with an explicit optional paid
writing provider. **Do not lock the product to Qwen3.8 or abandon local inference
on the evidence collected so far.** Qwen3.8 is the strongest writing candidate
among the installed configurations tested, not an established winner among all
local models. Include a hosted writer in the next comparison to establish the
quality that is actually available for this task.

For a quality-first prototype, my first hosted challenger is Claude Opus 5.5;
GPT-6.1 Terra is a useful lower-cost writing challenger. These are recommendations
to test, not measured SAP-script winners. Keep Qwen as the installed local control,
and compare Gemma 4 31B IT and Muse Glimmer 30B before selecting a local default.
Use the user's existing Gemini app access for an additional manual baseline,
recording the actual model selected in that account.

Writing providers are independent of speech and portrait engines. A hosted
scriptwriter can receive a public source pack and script text while personal
voice recordings, photos, Kokoro/Qwen speech and Ditto rendering remain local.
An offline workflow remains useful even if a hosted writer wins on polish.

## What the first experiment does and does not establish

Observed: Qwen3.8 produced more natural questions and a clearer news scenario
than the other installed candidates, with roughly 72-second median writing
duration. It still missed constraints and introduced misleading ideas. Native
JSON constraints did not repair those editorial faults. The reasoning/schema
combination also exposed a response-channel compatibility problem.

The experiment combined ideation, seven scenes, source references, visual
directions and a tight narration budget in one response. Its shared JSON example
used a tutorial fact ID and narrator even for other tasks. Some models copied
those values. The tiny synthetic grounding fixture was too simple to establish
domain-review reliability. These are reasons to improve the experimental design,
not reasons to reclassify failures as successes.

There is also a settings gap: the current
[Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B#best-practices)
recommends non-thinking temperature 0.7, top-p 0.80, top-k 20 and presence penalty
1.5. We used a shared 0.8/0.95/20 profile without that presence penalty. Test the
recommended profile separately, recording exact runtime support. It may improve
repetition/adherence; it is not evidence that it will repair our scripts.
For thinking, the card specifies a different sampling profile. Keep response
budgets appropriate to short writing jobs; its large agentic token ceilings are
not a recommendation to spend that many tokens on a one-minute short.

Do not attribute all failures to 4-bit quantization: this work has no paired
full-precision comparison. Do not treat moving the same 27B model onto a paid
server as a demonstrated creative-quality upgrade either.

## Local alternatives worth a bounded comparison

| Candidate | Why it belongs | Practical limit |
| --- | --- | --- |
| Qwen3.8 27B, existing copy | Strongest observed installed writer; test revised workflow and vendor settings as a control. | Its writing and revision failures are real. Resolve channel handling before combining reasoning and constrained output. |
| Gemma 4 31B instruction-tuned | A substantially larger alternative to the E4B tested; Google's model card includes script/content generation among intended uses. Published MLX 4-bit conversion is available. | No SAP-writing result on this machine yet. Loading/runtime/context memory and latency need measurement. |
| Muse Glimmer 30B | Different model lineage; official quantized local releases, desktop-runtime support and a presence in the creative-writing benchmark make it an interesting challenger. | Trained principally for agentic work; its name and benchmark presence do not prove better narration or humor. Validate template/channels and factual fidelity. |
| Gemma 4 26B A4B IT | Lower-compute mixture-of-experts alternative if 31B latency is unsuitable. | Retains all expert weights; active parameter count is not its total memory need. Not tested here. |

Google documents the [Gemma family and approximate loading memory](https://ai.google.dev/gemma/docs/core)
and [creative text use cases](https://ai.google.dev/gemma/docs/core/model_card_4).
The 31B and 26B A4B variants are distinct from E4B. The
[31B MLX conversion](https://huggingface.co/mlx-community/gemma-4-31b-it-4bit)
and [26B conversion](https://huggingface.co/mlx-community/gemma-4-26b-a4b-it-4bit)
are community artifacts, not Google guarantees about these quantizations.
They are plausible trials on this 48 GiB Mac with bounded context and one heavy
model loaded at a time; that is a capacity inference, not a successful load test.

[Meta's download guide](https://dev.meta.ai/docs/muse-glimmer/get-the-model)
lists roughly 17 GB Q4_K_M and 20 GB dynamic K-quant text files, with optional
vision/draft assets. Its [model overview](https://dev.meta.ai/docs/muse-glimmer)
names llama.cpp and LM Studio among the ecosystem. The
[prompting guide](https://dev.meta.ai/docs/muse-glimmer/prompting)
requires correct role/recipient framing and distinguishes private reasoning from
the final answer. Check the installed engine's support before downloading a
large artifact; do not assume generic API compatibility handles those channels.

The [EQ-Bench creative-writing leaderboard](https://eqbench.com/creative_writing)
is relevant supplementary evidence because it evaluates writing, rather than
only coding or math. However, it is LLM judged, its story tasks differ from SAP
explainers, snapshots vary, and its served models are not our local 4-bit builds.
It is a candidate-discovery signal, not a substitute for user preference and
source checking. Do not infer a quantitative quality gain from its Elo gaps.

Other open models were inspected but are lower priorities for this machine.
[GLM-4.7-Flash](https://huggingface.co/zai-org/GLM-4.7-Flash) is a viable 30B-A3B
class deployment candidate, but the supplied evaluations emphasize reasoning,
coding and agents rather than this writing task. The names
[Mistral Small 4](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603)
and [Inkling-Small](https://huggingface.co/thinkingmachines/Inkling-Small)
refer to 119B and 276B total-parameter models. Even ideal four-bit weight storage
alone is about 59.5 GB and 138 GB, before buffers and cache, so they are not
straightforward choices for this 48 GiB Mac. Their small active subsets do not
make all the weights disappear. No system-memory overrides are proposed.

## Hosted alternatives and cost

The current [Claude lineup](https://platform.claude.com/docs/en/models/overview)
recommends Opus 5.5 for most workloads and positions Sonnet 5.5 as its
speed/intelligence balance. Opus is a reasonable quality challenger, but the
vendor's general positioning does not establish superiority on SAP comedy.
Fable's long-running-agent focus is not needed as the first writing experiment.

Official OpenAI documentation describes
[GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
as a model for natural writing and revision;
[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
is a stronger complex-work comparison if Terra misses source/scope constraints.
GPT-6 Astra can serve as a higher-cost quality reference. There is no reason to
start every short at maximum reasoning effort without an observed benefit.

[Google's model catalog](https://ai.google.dev/gemini-api/docs/models)
currently lists Gemini 4 Argon and Gemini 3.8 Flash. Existing Gemini app access
can supply a manual baseline; automated app integration uses the API's billing
and quotas. [API billing](https://ai.google.dev/gemini-api/docs/billing/)
is project/billing-account based. Do not assume that the user's unspecified
Google subscription grants unlimited API calls or a particular credit balance.
Check account entitlements separately before a paid experiment.

Illustrative standard short-context text cost, researched October 27, 2026:

| Provider/model | USD per 1M input | USD per 1M output | Example editorial workflow |
| --- | ---: | ---: | ---: |
| GPT-6.1 Terra | $1 | $5 | $0.05 |
| GPT-6.1 Sol | $2 | $10 | $0.10 |
| Claude Sonnet 5.5 | $2 | $10 | $0.10 |
| Claude Opus 5.5 | $4 | $20 | $0.20 |
| Gemini 4 Argon, current promotional rate | $2 | $10 | $0.10 |
| GPT-6 Astra | $10 | $50 | $0.50 |

The example is **20,000 input tokens plus 6,000 billable output tokens in total
across a workflow**, including any billable reasoning within that output count.
Calculation: `0.020 × input rate + 0.006 × output rate`. It is not a measured
per-episode bill or a spending authorization. Long reasoning, retries and larger
packs increase it. Search tools, media generation, speech, infrastructure, taxes
and caching charges/discounts are excluded. Recheck prices before implementation.
Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
Gemini Argon's listed input/output rates double on December 1, 2026; the table
uses the rate through November 30. Standard paid and contributor/free tiers can
have different data-use terms; select the intended tier explicitly.

For modest production volume, these estimates make editing time a relevant
tradeoff against API charges. They do not prove a paid model will save that time.
The experiment should measure human revisions alongside token cost and latency.

## Change the workflow before selecting a winner

1. Build a dated source pack with explicit supported claims, unknowns and tested
   demo results. Keep the announcement, forecast and measured outcome distinct.
2. Generate three contrasting story angles in a separate step: a surprising
   consequence, a debugging discovery, or a useful disagreement. Each promises
   a payoff. The topic name alone is not an angle.
3. Write the spoken story first, using an approved reference for the series'
   voice. For a conversation, each speaker must cause a useful question, answer
   or reveal. For comedy, the joke should arise from the technical situation.
4. Give the narration a visual plan that contributes information: an annotation
   explains a rejected POST; a stock filter changes the visible rows. Screen
   text should not repeat a paragraph the avatar is already reading.
5. Compile the chosen story into scene JSON in a separate call, using task-specific
   speaker/fact enums. Validate mechanically and review material claims against
   sources. Preserve the chosen voice/photo revisions. A compiler cannot invent
   new product behavior to make a transition work.
6. Allow one targeted correction, then expose unresolved issues for editing.
   Audition the actual voice to measure hook/episode timing before portrait work.

This is a proposed workflow improvement, not a proven fix from the first screen.
More capable writing can improve the words and directions; delivery still
depends on speech performance, pacing and implemented renderer capabilities.
Do not claim that a scriptwriting model itself adds missing animations or acting.

## Next bounded test

Compare Qwen3.8 with the corrected workflow/settings, Gemma 31B, Muse Glimmer,
Claude Opus 5.5 and GPT-6.1 Terra on six held-out briefs: two tutorials, two news
stories, one dialogue and one comic explanation. Gemini is an optional manual
baseline. Use the same source packs, narration budget, style reference and one
revision opportunity. Record model-specific settings explicitly rather than
assuming identical sampling numbers are equivalent across architectures.

Blind and randomize the user-facing comparisons. Judge natural speech, hook and
payoff, explanatory clarity, visual contribution and humor when requested. Check
technical claims separately; an invented claim cannot be offset by a funny line.
Show model load time, first usable draft, revisions and actual API token charges.
Keep held-out briefs separate from prompt-tuning examples.

The existing benchmark harness intentionally accepts loopback only. A paid trial
needs a separate explicit provider path and an approved spending limit, not a
change that silently permits remote calls. Research alone does not authorize
paid inference. Model downloads, paid tests and product implementation remain
next actions. Use a bounded pilot instead of purchasing hardware or fine-tuning
a model before the preferred output style and baseline quality are established.

## Product implication

Offer explicit **Local** and **Online writing** choices, with provider/model,
readiness, expected cost and measured timing. Online writing is opt-in; a local
failure must not silently send content to the cloud. Keep manual import/export
and the offline path. Rendering can continue on the Mac mini or laptop regardless
of the text provider. This is a refinement of the earlier local-first plan, not
a default-provider change already implemented in the application.
