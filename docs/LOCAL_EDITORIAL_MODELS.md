# Local writing models for SAP Shorts

Researched October 27, 2026. Preferred architecture: local inference for ideation,
writing, revision and editorial review. Status: six installed models have now
been screened; application integration remains proposed. See the
[measured comparison and reproducible outputs](LOCAL_MODEL_BENCHMARK.md).
No additional writing weights were downloaded for that experiment.

This supersedes the cloud-first pilot suggested in the initial
[content quality review](CONTENT_QUALITY_REVIEW.md). External writing providers
are optional, explicit integrations, disabled by default. There must be no
automatic remote fallback when a local model is unavailable or produces weak text.

## Separate the three models

| Responsibility | Model/runtime |
| --- | --- |
| Turn source material into ideas, narration and visual directions | New local instruction-tuned writing LLM |
| Generate speech in the selected personal voice | Existing Qwen3-TTS Base through MLX Audio; Kokoro remains the stock option |
| Animate the selected photo from the generated audio | Existing Ditto portrait runtime |

The existing Qwen voice model is specialized for speech. Sharing the Qwen family
name does not make it a general scriptwriter. Adding a writing model preserves
the user's selected voice/photo and does not require replacing either renderer.

## Hardware checked

The current development Mac reports **Apple M5 Pro, 48 GiB unified memory** and
about **141 GiB available disk space** at research time. This is a credible target
for testing a 4-bit 27B-class writer with a bounded context, loaded separately
from speech and portrait inference. This is a capacity estimate, not measured
inference performance. The Mac mini's current memory was not inspected; its
setup should choose a supported model after checking its own resources.

Local inventory then found **Qwen3.8-27B MLX 4-bit already downloaded in LM
Studio**, with all three weight shards referenced by its index present (about
16.05 GB). The catalog recognizes it as `qwen/qwen3.8-27b@4bit`. File presence and
catalog recognition are not checksum verification or a successful inference test.
Use this existing copy for the first experiment rather than downloading a duplicate.
It is an `lmstudio-community` conversion, distinct from the `mlx-community`
repository whose revision is listed below.

The same catalog contains Qwen3.6-35B-A3B in Q6_K format (about 29.42 GB including
its associated assets) and Gemma 4 E4B (a smaller variant, not the proposed 26B
comparison). **Flint Q4_K_M is also already downloaded and loaded** as
`recursivesi/flint`, with 24.17 GB reported by the catalog. It was idle with no
queued requests when inspected. Include it in the initial comparison before
downloading any additional model. No model was unloaded, loaded or asked to
generate during the initial inventory research. The subsequent authorized
benchmark loaded candidates sequentially and restored the original Flint state.

Do not infer runtime memory from model parameters or download size alone. Model
weights, context/cache, compute buffers, the OS and other applications all matter.
A mixture-of-experts model retains its full set of weights even though only a
subset participates in a token's computation.

## Candidate shortlist

Except for the labelled installed Flint GGUF, sizes below are sums of published
`.safetensors` file sizes from Hugging Face metadata read on October 27.
Units are decimal GB. Tokenizers, runtime
packages, context/cache and temporary download space are additional. MLX builds
are community conversions; the original authors' model cards describe the base
models, not a guarantee about the quantized conversion's quality.

| Candidate and published conversion | Weight files | Proposed role |
| --- | --- | --- |
| [Flint, existing LM Studio GGUF Q4_K_M](https://huggingface.co/lmstudio-community/flint-GGUF) | 24.17 GB catalog size for the installed file | First available baseline because it is already loaded; compare writing and technical review against Qwen. |
| [Qwen3.8-27B, MLX 4-bit](https://huggingface.co/mlx-community/Qwen3.8-27B-4bit) | 16.05 GB / 14.95 GiB | First quality-oriented writer to test on this 48 GiB Mac. |
| [Gemma 4 26B A4B instruction-tuned, MLX 4-bit](https://huggingface.co/mlx-community/gemma-4-26b-a4b-it-4bit) | 15.34 GB / 14.29 GiB | Comparison writer for explanation, dialogue and storytelling; evaluate without assuming a winner. |
| [Qwen3.5-9B, MLX 4-bit](https://huggingface.co/mlx-community/Qwen3.5-9B-4bit) | 5.95 GB / 5.54 GiB | Compact choice for Macs with less memory, subject to an actual capacity/quality test. |
| [Qwen3.6-35B-A3B, MLX 4-bit](https://huggingface.co/mlx-community/Qwen3.6-35B-A3B-4bit) | 20.40 GB / 19.00 GiB | Optional later throughput comparison. A3B does not mean it only needs memory for 3B weights. |

[Recursive's Flint model card](https://huggingface.co/RecursiveSI/flint) describes
a 39.8B mixture-of-experts model with about 2.5B active parameters per token,
specialized for coding agents. It supports text input/output, reasoning and tool
use. That makes it a plausible technical-review candidate and a writing model to
test, but its coding results do not establish creative-script quality. It is
text-only and cannot directly inspect presentation images or listen to narration.
The installed GGUF runs through LM Studio's llama.cpp backend, not the proposed
managed MLX path. Preserve an optional local GGUF/LM Studio adapter rather than
excluding an already available model. A later bundled runtime needs separate
validation for this exact architecture and quantization.

Qwen's [27B model card](https://huggingface.co/Qwen/Qwen3.8-27B) documents a
general instruction model with thinking and non-thinking modes. These modes can
support separate planning, writing and review passes; neither establishes that
its jokes or spoken scripts are good. Use the correct chat template and benchmark
bounded generation settings. Do not select a code-specialized model solely
because these shorts concern developers.

Google's [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)
explicitly includes script and creative-text generation among intended uses, and
its [getting-started guide](https://ai.google.dev/gemma/docs/get_started)
identifies the 26B A4B variant as a starting point with lower resource requirements.
It remains a candidate to test against Qwen on our exact briefs. General model
benchmarks are not evidence of better SAP humor or narration.

The inspected original/converted model cards identify Apache-2.0 licenses. Preserve
the exact notices with installed models and verify the selected revision's terms
when preparing the model manifest. Do not substitute a similarly named community
fine-tune or a hosted-only creative model without checking its actual weights,
provenance and runtime compatibility.

### Revisions inspected

These identify the metadata consulted, not installed or approved model manifests:

| Repository | Revision | Weight bytes |
| --- | --- | ---: |
| `mlx-community/Qwen3.8-27B-4bit` | `10c35caafbb80f7dc6a7a432cdd11af10a6d4818` | 16,054,541,349 |
| `mlx-community/gemma-4-26b-a4b-it-4bit` | `0d77464eeb233a2da68ebf9d7dc4edaac7db956d` | 15,341,205,776 |
| `mlx-community/Qwen3.5-9B-4bit` | `8b2b98c00a6b4d291155e4890773ca8f769aee53` | 5,950,221,072 |
| `mlx-community/Qwen3.6-35B-A3B-4bit` | `38740b847e4cb78f352aba30aa41c76e08e6eb46` | 20,402,204,271 |

## Runtime choice

Use a separately managed Python environment with
[MLX LM](https://github.com/ml-explore/mlx-lm) as the initial text runtime. It
supports text generation and quantized models on Apple Silicon. The Qwen
conversion cards publish local MLX server usage. Validate the exact package/model
combination, chat template and response handling before committing a runtime lock.
Use an appropriate multimodal runtime separately if later image review needs it.

The app should own a bounded sidecar process and communicate through a narrow
JSON job protocol, following the existing speech runtime pattern. This avoids
requiring a separate model-manager application or a permanently running server.
If an HTTP adapter is used for development, bind it to loopback with the same
local-access controls as other studio operations.

[LM Studio](https://lmstudio.ai/docs/developer/core/server) is a useful optional
prototype/bring-your-own-runtime adapter. It is not required for the self-contained
desktop path. Its compatible API does not mean requests are sent to OpenAI.
Likewise a model downloaded from Hugging Face runs locally after setup; the
repository is the download source, not the inference provider.

## Product behaviour

- Add **Writing engine** beside narration and portrait setup. Offer a recommended
  quality model and a compact option; show download size, available disk and
  hardware requirements before installation. No terminal commands are required.
- Download selected, revision-pinned weights once, verify the manifest/digests and
  retain license notices. Support interrupted-download recovery and a short local
  writing test. Models stay outside Git and outside the base DMG.
- Keep local content authoring functional without a login or Firebase. Account
  storage and registered remote workers remain optional product paths.
- Apply the same research → facts → idea choices → script → review → voice preview
  flow described in the quality plan, with a local provider for every text step.
  Use sequential writer/reviewer prompts; initially one model can fill both roles.
  A second local model is an optional diversity check, not an independent source
  of truth. Technical execution and human review remain relevant.
- Preserve approved voice/profile/photo references during rewrites. A writing
  model receives the public source pack, verified code and chosen style, not
  private acoustic reference recordings or portrait originals.
- Load one heavy model at a time. Release the writer and its cache before Qwen
  speech or Ditto starts. Respect the shared heavy-job lock; do not promise
  simultaneous writing and rendering merely because the weights fit separately.
- Bound source context, reasoning/output tokens and revision passes. Start with
  a small evidence pack rather than passing an entire article collection. Record
  cold-load time, time to first token, generation/review duration, peak memory and
  actual failure/revision reasons.
- After installation, test generation with model-hub access offline and verify
  that no external model endpoint is contacted. Missing weights must produce a
  setup action, not a cloud request. Fetching new official news still needs
  internet; previously saved sources can be used offline with their dated status.
- Keep explicit model identity and readiness in the UI. A smaller model may be
  offered when resources are insufficient, but cannot silently replace the model
  chosen for an existing editorial job.

Local storyboard-image review is possible with a supported vision model, but
text/image capability does not establish full audio/video assessment. Validate
that separately before promising local equivalents of Gemini's complete MP4
review. Existing transcript, timing, audio and frame checks still apply.

## First experiment and acceptance

The [installed-model screen](LOCAL_MODEL_BENCHMARK.md) is complete: three writing
briefs and one synthetic review per candidate, plus bounded Qwen follow-ups.
Qwen3.8 is a provisional writer candidate; no configuration is approved for
unattended production. These results do not replace the held-out/user preference
and actual audio-timing checks below.

1. Use the already loaded Flint as the first available baseline, then compare the
   already downloaded Qwen3.8-27B 4-bit sequentially when device capacity is
   available. Do not displace an unrelated workload without coordinating its use.
   Test the same source-grounded CAP pilot, one sourced SAP news explanation and
   a two-person/light-comic brief. Include deliberately incomplete evidence to
   check that each model asks for missing facts.
2. Measure resource use and judge script quality against the current heuristic
   draft and authored example. Screen for complete sentences, supported claims,
   genuinely different story angles, natural speech, useful visual beats and a
   hook that pays off. Inspect generated JSON using the app's own validation.
3. If the first model is weak on dialogue, humor or explanation, compare Gemma
   using the same evidence, length budget and user-blinded review. Do not download
   the entire shortlist by default. Try the compact model when smaller-Mac support
   is the question.
4. Implement the selected runtime and the M0–M3 workflow in the source build;
   retain manual authoring and old episodes. Add rendering-side story beats as
   M4. A better local writer alone does not add missing visual templates.

Initial success means the user prefers the new scripts, source support passes,
generation stays within device memory without system-setting overrides, and
offline inference works. It does not mean parity with every flagship hosted
model. Measured latency and specific editorial failures are now available in the
screening report; the application acceptance criteria remain unmet.

Routine source changes follow the documented release cadence. Build another DMG
only for an explicitly requested release milestone.
