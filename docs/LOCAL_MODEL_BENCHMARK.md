# Local editorial model screening — October 27, 2026

Six already installed models were tested on this Mac, sequentially, through LM
Studio's loopback API. No weights were downloaded and no external model was
called. **Qwen3.8 27B is the most promising next writer candidate in this screen,
but none of the first-pass configurations is ready for unattended production.**
This is a development experiment, not an integration into episode production.

## What was tested

Hardware: Apple M5 Pro, 48 GiB unified memory, macOS 27.0.1. Runtime: LM Studio
0.4.26+4, CLI commit `43d4b26`. The installed conversion/runtime combinations
matter; these results are not rankings of entire model families.

| Installed candidate | Format / quantization | Catalog size | Backend |
| --- | --- | ---: | --- |
| Flint (`recursivesi/flint`) | GGUF Q4_K_M | 24.17 GB | llama.cpp |
| Qwen3.8 27B | MLX 4-bit | 16.08 GB | MLX |
| Qwen3.6 35B A3B | GGUF Q6_K | 29.42 GB | llama.cpp |
| Gemma 4 **E4B** | GGUF Q4_K_M | 6.33 GB | llama.cpp |
| Nemotron 3 Nano Omni | GGUF Q4_K_M | 26.10 GB | llama.cpp |
| Huihui Qwen3.8 27B Abliterated | GGUF Q4_K_S | 16.56 GB | llama.cpp |

The installed Gemma is the small E4B variant, **not** the proposed Gemma 26B A4B
comparison. The Qwen3.6 copy is Q6_K, not the researched MLX 4-bit conversion.
The Huihui checkpoint is a modified model, distinct from the original Qwen.
No additional download is justified by this experiment alone.

Each candidate received the same three writing briefs and one review fixture:

- A casual CAP debugging story, with a stock-filter prediction/reveal and a
  situational developer joke.
- A professional SAP news explainer, using a labelled billing illustration to
  distinguish interface, assistant and agent.
- An Alex/Sam developer conversation, with a mistaken expectation, useful
  question, demonstrated answer and light humor.
- A synthetic grounding challenge: unknown publication date/access, a pilot's
  **expected** 25% improvement, and an instruction embedded in untrusted source
  text. Four claim verdicts were checked; expected answers were removed from
  the model request.

The public [briefs](../scripts/editorial/briefs.json) include the source facts.
CAP facts come from the checked local demo, including the actual POST rejection
and filter results. The news evidence is a bounded paraphrase of
[SAP's Q3 article](https://news.sap.com/2026/10/ai-release-highlights-q3-2026/),
reviewed October 27. A source-fact pack improves traceability; it does not prove
that a model's narration faithfully uses the facts it cites.

## Settings and interpretation

All first-pass runs used context 16,384, parallelism 1, temperature 0.8, top-p
0.95, top-k 20, seed 42 and a 12,288-token response ceiling. The deadline was
240 seconds, checked during streaming with a socket timeout. Different
backends need not interpret sampling parameters or seeds identically.

Flint only exposes reasoning-on in this runtime. Other candidates used
`reasoning_effort: none` for the first pass. Reasoning settings and budgets are
recorded, rather than treating Flint's planning tokens as free. An initial
4,096-token Flint probe spent **54.0 seconds** on reasoning and produced no
visible answer before exhausting its budget. It is preserved separately; the
interrupted following request is not scored.

The requested result was a benchmark JSON contract: three ideas, seven ordered
scenes, permitted speakers/fact references, 100–130 spoken words, a hook of at
most seven words and headlines of at most eight. These are **editorial drafts**,
not validated production-episode JSON. Word counts do not establish actual
45–60-second audio timing. No narration, portrait or video was generated here.

## First-pass measurements

Times are wall-clock request duration, including reasoning, excluding model
loading. There was one run per brief; ranges and medians cover the three writing
tasks only. A mechanical pass means the listed contract checks passed, not
editorial or factual approval.

| Candidate | Writing median | Writing range | Mechanical passes | Grounding verdicts |
| --- | ---: | ---: | ---: | ---: |
| Flint | 131.2 s | 130.4–202.7 s | 2/3 | 4/4 |
| Qwen3.8 27B | 71.9 s | 68.4–73.6 s | 1/3 | 4/4 |
| Qwen3.6 35B A3B | 11.4 s | 10.6–13.7 s | 0/3 | 4/4 |
| Gemma 4 E4B | 15.1 s | 13.9–15.6 s | 0/3 | 4/4 |
| Nemotron 3 Nano Omni | 16.1 s | 15.0–29.5 s | 0/3 | 4/4 |
| Huihui Qwen3.8 27B | 46.2 s | 36.7–70.1 s | 0/3 | 4/4 |

All six got the four synthetic verdicts right. Qwen3.8 and Gemma wrapped that
review JSON in Markdown fences; Qwen3.6 omitted the requested missing-evidence
list. Thus verdict accuracy and response-contract success differ. The collector
reads fenced JSON to assess its claims while retaining the format failure.
Broken JSON is never silently repaired into a passing result.

The shared JSON example used `narrator` and `c1` even when the brief specified
dialogue speakers or news IDs. Some models copied those example values. This is
a prompt-design confound and a concrete improvement for the next workflow:
generate examples from the selected task's own enums. The original requests are
preserved; the reported first-pass results have not been rerun with a corrected
example. These are observed configuration failures, not claims about a model's
best achievable capability.

Qwen3.8 first visible text arrived in roughly 3–4 seconds. Flint's writing
answers began after roughly 117–182 seconds. Faster first text can support a
streaming editor, but the complete result still needs validation before use.

Model load times were recorded separately: 31.2 seconds for Qwen3.8, 25.0 for
Qwen3.6, 2.5 for Gemma E4B, 9.7 for Nemotron and 7.7 for Huihui in this sequence.
OS caches were not controlled; these are observed loads, not cold-start promises.
Process RSS was sampled as a proxy. The sampler missed MLX's Node-hosted backend,
so its zero samples are exported as **unavailable**. RSS is not a measurement of
total Metal/unified-memory allocation; do not use it to size another Mac.

## Editorial findings

The assessment below is a human-readable review by the coding assistant that
ran the experiment. Model identities were known. The gallery initially hides
names for the user's comparison, but order is fixed and this was not a blind or
randomized preference study. No viewer-retention result has been measured.

| Candidate | What helped | Concrete limitation |
| --- | --- | --- |
| Qwen3.8 | Clearest colleague-like questions and a concrete billing flow; readable GET/POST contrast in dialogue. | News hook was too long and cited nonexistent `c1`; dialogue had 93 words. An unused idea said a service must be bound to run the app. The casual story's filter sequence is confusing. |
| Qwen3.6 | Very fast, compact drafts; useful baseline for low-latency experiments. | Scripts were only 57–74 words. Dialogue answered a write-restriction question with “Production has separate auth,” leaving the technical distinction unclear. It barely attempted the humor or reveal. |
| Flint | Returned complete-length news/dialogue scripts and correctly identified missing evidence in the small review test. | Casual JSON was malformed; dialogue took 202.7 seconds and included “What stock-above-zero query returns?” and the misleading “stopped create, not all writes.” Narration recited a full endpoint. |
| Gemma E4B | Quick output and correct verdicts in the simple review fixture. | All three writing outputs had broken JSON. It substituted an untested PUT in the dialogue and confused deliberate read-only design with missing write configuration. |
| Nemotron | Quick drafting and a clean grounding response. | Claimed “CAP projections are read-only by design,” which is false. News JSON was malformed; dialogue added an unrequested narrator. |
| Huihui | Its news draft separated interface, coordinator and agents clearly. | News/dialogue were 57/64 words. The casual story invented that the missing service was “just a local shortcut.” No convincing comedic payoff. |

The strongest first-pass output still needs editing. For example, Qwen3.8's
“So I can read, but not buy?” makes the developer's mistaken expectation clear,
but its follow-up reverts to generic instructions instead of a satisfying joke
or discovery. Flint saying “I joked the database was avoiding me” describes a
joke rather than delivering one. More words or more reasoning alone do not
establish an engaging performance.

The existing heuristic baseline has more serious source-attribution and sentence
problems documented in the [content audit](CONTENT_QUALITY_REVIEW.md). The local
LLMs improved sentence construction and scenario choices in some outputs, but
they introduced different errors. The authored
[CAP pilot](../samples/editorial_quality_pilot.md) remains an editorial reference,
not a model-generated result or measured audience-preference winner.

## Bounded follow-ups

Both Qwen candidates received their own original dialogue plus identical,
explicit correction feedback, native JSON-schema constraints and a 4,096-token
ceiling in non-thinking mode. This combines feedback and constrained decoding;
it does not isolate either intervention.

- Qwen3.6: **12.5 seconds**, valid JSON, still 74 words and an eight-word hook.
  The weak production-auth answer remained.
- Qwen3.8: **61.6 seconds**, valid JSON, still 93 words and an eight-word hook.
  It essentially repeated the prior script.

These particular correction calls did **not** repair the writing-budget or
engagement problems. Schema constraints can limit shape and speaker/fact IDs;
they cannot guarantee technical truth, a spoken duration or a funny conversation.
[LM Studio documents](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
the native structured-output facility used here. Exact requests are retained
locally.

A second settings probe revised the **same original** draft with the same
feedback and schema, rather than chaining repeated revisions. Qwen3.6 used its
default reasoning-on mode with a 12,288-token ceiling. It returned 111 words,
a six-word hook and no mechanical check errors, but took **219.7 seconds**
(206.4 seconds to visible text; 9,708 reasoning tokens). It explicitly corrected
the claim that projections are automatically read-only. The conversation still
has awkward scope explanations and little comedic payoff; its visual direction
shows a filtered list while speech says all inventory. Thus this is a format and
length improvement, not an editorial approval.

Qwen3.8 with reasoning set to `low` completed in **59.1 seconds**, but supplied
no visible final response. The streamed reasoning channel contained a JSON
draft; the content channel was empty. That internal draft was not promoted into
a usable answer. This exact reasoning/schema/runtime combination needs adapter
investigation; it is not evidence that a higher reasoning setting improves
writing. The portable bundle includes the failure and channel/token counts,
without exporting raw reasoning.

## Replay and inspect

Use Python 3.9 or newer; the scripts use the standard library. The checked-in
[measurement bundle](../samples/editorial-benchmark/2026-10-27-results.json)
contains visible outputs, checks, settings and timings. It excludes raw reasoning,
model weights, recordings and photos.

```sh
python3 -m unittest discover -s scripts/editorial -p 'test_*.py' -v
python3 scripts/editorial/benchmark-report.py artifacts/editorial-comparison \
  --bundle samples/editorial-benchmark/2026-10-27-results.json
python3 -m http.server 8765 --bind 127.0.0.1 --directory artifacts/editorial-comparison
```

Open `http://127.0.0.1:8765/comparison.html`. To inspect the correction profile,
generate a separate directory with `--profile refinement`. Generation of these
galleries does not load a model or contact an inference service.
The reasoning settings probe is available with `--profile thinking`.

To repeat inference, first inspect `lms ps --json`, ensure the device is idle,
and explicitly load **one** installed candidate. For example:

```sh
lms load qwen/qwen3.8-27b --identifier shorts-benchmark-qwen38 \
  --context-length 16384 --parallel 1
python3 scripts/editorial/local-benchmark.py \
  --model shorts-benchmark-qwen38 --label qwen38 \
  --output artifacts/editorial-rerun --reasoning none \
  --gate .state/local-model \
  --gate "$HOME/Library/Application Support/SAP Shorts/Desktop/workspace/.state/local-model"
```

Do not displace a user's busy model. Restore the previous loaded state afterward.
The harness requires an already loaded exact instance, rejects redirects and
non-loopback inference origins, disables HTTP proxies, records exact requests,
and holds the app's shared heavy-job SQLite locks while generating. It does not
download or silently load models. Raw streams, request files and the initial
Flint probe remain in local ignored `artifacts/editorial-benchmark-2026-10-27`.
The collector exports a consistently reassessed bundle without modifying them.

Inference requests targeted the loopback server with proxies disabled. A
network-isolated/offline installation test was not performed; that remains an
acceptance check for a managed application runtime. Installed model revisions
were identified through LM Studio's catalog, not cryptographically pinned and
verified by this experiment.

An initial restoration attempt failed because its log filename included the
model identifier's slash. The subsequent runner used a safe filename and
restored the original Flint identifier/context/parallelism. The existing LM
Studio server remains available. This was an experiment-script issue, not an
episode-production change.

## Recommended next step

Proceed locally with **Qwen3.8 as a provisional writer candidate**, retaining
manual authoring. Separate story selection from the seven-scene JSON compiler;
then validate length, sources and speaker assignments before bounded revision.
Do not add an automatic approval or rendering step based on JSON success.
The small synthetic review pass is insufficient to appoint any candidate as an
independent SAP fact checker. Use executable demos and source-aware editorial
review, followed by the user's actual voice preview.

Before selecting a default, test held-out stories and have the user compare the
scripts. A later Gemma 26B comparison is a separate download/capacity decision.
The next application work remains the M0–M3 local editorial workflow in the
[quality plan](CONTENT_QUALITY_REVIEW.md). Voice, photo and production assignments
stay intact. No installer release is part of this experiment.

## Verification

The benchmark's nine standard-library tests cover hidden expected answers,
unsupported/duplicate verdicts, fenced versus broken JSON, reasoning-only
responses, malformed nested types, permitted schema enums and escaped HTML.
All passed. Python compilation, targeted Biome checks for both JSON files and
local Markdown-link checks passed. The CAP demo's five live checks also passed.
The generated gallery was inspected in the browser: task/candidate filtering and
model-name reveal worked. This did not rerun the full application test suite;
production TypeScript and rendering behavior were not changed.
