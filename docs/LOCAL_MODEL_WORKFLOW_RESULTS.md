# Local writing workflow comparison — October 27, 2026

This follow-up separates ideation, spoken writing, correction and visual planning.
It tests the existing Qwen3.8 27B against newly downloaded Gemma 4 31B IT and
Muse Glimmer 30B on this Mac. All inference uses the loopback LM Studio server.
No hosted inference, speech/portrait render, application-provider integration or
installer release is part of this experiment.

The [first installed-model screen](LOCAL_MODEL_BENCHMARK.md) and subsequent
[provider research](EDITORIAL_PROVIDER_DECISION.md) remain separate experiments.
Both the workflow and sampling changed, so their scores and durations cannot be
compared as a controlled measurement of improvement.

## Decision and observed results

Use **Gemma 4 31B IT as the provisional local writer for the next application
prototype**, with manual editing retained. Its tested configuration is more
reliable across the full workflow, and the empty-result dialogue offers the most
promising conversational example in this screen. It is not a selected production
default or a proven winner among all local models.

Muse handles some availability wording carefully and writes correctly sized
transcripts, but is slower and often procedural. Qwen's recommended profile and
the presence-penalty diagnostic did not resolve its short, fragmented drafts or
grounding failures. None of these configurations demonstrated consistently fun,
ready-to-share SAP storytelling. The next iteration needs approved style examples,
a single strong premise/payoff, and source-aware editing before generation of
actual speech. A paid comparison remains optional and unperformed; these tests
do not establish that external inference is necessary.

Automatic contract success is not factual approval, a measured viewer preference,
or proof of engaging delivery. All 18 workflows are complete.

| Local configuration | Complete mechanical contracts | Four-stage generation time | Observed writing |
| --- | ---: | --- | --- |
| Gemma 4 31B IT, MLX 4-bit | 6/6 | Median 101.1s; range 90.8–132.1s | Coherent, correctly sized drafts and usable scene assignments; tone and source claims still need edits. |
| Qwen3.8 27B, existing MLX 4-bit | 1/6 | Median 97.8s; range 91.5–106.0s | Often fragmented or too short after correction; material grounding failures persist. |
| Muse Glimmer 30B, Q4_K_XL, low reasoning | 2/6 | Median 220.9s; range 214.4–270.2s | Correctly sized selected scripts; often dry, with source-wording edits and one malformed visual-plan envelope. |

The individual contracts show where the failures occur:

| Configuration | Ideas within contract | Selected speech within contract | Valid visual plan |
| --- | ---: | ---: | ---: |
| Gemma | 6/6 | 6/6 | 6/6 |
| Qwen | 4/6 | 1/6 | 6/6 |
| Muse | 3/6 | 6/6 | 5/6 |

Muse's three idea failures exceed the 180-word limit. Its count-plan failure is a
schema-envelope error. Its comic correction fell to 90 words and lost the filter
payoff, so the valid 119-word original was retained. These differences matter:
a lengthy idea list is not the same failure as a missing usable script or plan.

These timings sum generation across three angles → spoken draft → one correction
→ visual plan, including reasoning and excluding model load, downloading and
the user-requested pause, interrupted attempts and separate configuration probes.
They are not total operator waiting time or the length of the resulting video.
Model load was approximately 12.1s for Gemma, 10.1s for Qwen and 8.2s for the
final Muse load. A model download
overlapped Gemma and part of Qwen; this was not a controlled speed comparison.

## Quality matters beyond the schema

Gemma's strongest conversational example was the empty-response dialogue: one
speaker expects an error, the other explains a successful empty collection, and
an ambitious-filter joke pays off at the end. It still calls the sample's monitor
arm a monitor; the visual plan has the correct product name. That small mismatch
would survive JSON checks and needs an editor.

Gemma's Cloud ERP Private news script retains Early Adopter Care and the planned
Q4 date, then incorrectly reassures the viewer that a missing activation button
means they are ahead of the release schedule. The board repeats “Your settings
are fine.” The source does not establish that diagnosis. Its consolidation story
also needs narrower wording about unknown access today. Comedy is mild, and some
openings sound like a lecture. A mechanically reliable writer is not an
unattended editorial service.

Qwen adds “No new license is required” to the managed-integration announcement,
omits its Early Adopter Care boundary, and carries the claim into a visual badge.
Its board invents a “Check Availability” button. Other outputs invent an untested
title-lookup failure, confuse movement in a sort, or remain below the requested
word budget. Correct source-fact identifiers do not prove the attached claims.

Muse preserves the Private ERP early-adopter/planned-GA boundary and avoids the
no-new-license claim, but adds “Joule is separate from that managed service,”
which the supplied facts do not establish. Its consolidation ending incorrectly
turns a planned future early-adopter date into a categorical no-GA-today claim.
The key-lookup and dialogue scripts read UUIDs aloud, and the dialogue lacks the
requested joke. The count storyboard uses a JSON-Schema-like wrapper instead
of the required instance, so the compiler correctly rejects it. These are
configuration-specific observations, not claims about every Muse deployment.

Ideation is also uneven: some groups are three restatements of the same point,
and Muse repeatedly proposes local-scope caveats as a third story. Hooks and
premises can introduce unsupported claims before the narration stage even starts.
These outputs need angle selection and premise checking, not just grammar edits.

The generated visual directions sometimes add a useful demonstration, such as
moving rows, applying a filter or contrasting a row count with stock quantities.
They also use generic icons and repeat unsupported narration. They are plans,
not implemented animations or rendered presentation-quality measurements.
The compiler preserves selected narration exactly; it does not verify the truth
of that narration or of the visual direction.

## Six briefs and four stages

The frozen [briefs](../scripts/editorial/workflow-briefs.json) contain public facts,
scope limits, speaker choices and a proposed rhythm reference. The reference is
not a user-approved series voice. Titles and directions already suggest an
angle; this tests composition from curated evidence, not autonomous news discovery
or ideation from an unstructured article collection.

1. Retrieve a known product by its UUID key; distinguish an absent key from deletion.
2. Contrast three product rows with nineteen stock units and a filtered count of two.
3. Explain planned financial consolidation availability without implying current access.
4. Explain managed Cloud ERP Private integrations without inventing entitlements.
5. A two-person discovery: a successful empty collection versus a missing individual key.
6. A comic sorting/filtering story about a zero-stock monitor arm.

Each workflow generates exactly three proposed angles, a 100–130-word spoken
story, one correction for every draft, then a seven-scene visual plan. The first
spoken line is limited to seven words and the story to 7–14 lines. These are
drafting constraints, not measured 45–60-second narration. Scene JSON references
locked turn IDs and allowed source-fact IDs; deterministic compilation copies
the words and speaker IDs without rewriting them. A failed correction never
silently replaces a mechanically valid original. Both versions remain visible.

Mechanical checks cover response completion, length, speaker/turn constraints,
JSON shape, scene order and exact transcript coverage. Distinct idea quality,
natural speech, humor, causal storytelling and claim support were inspected with
model identity known. No numerical human-quality or preference score is claimed.

Eight additional live CAP checks establish the local evidence: selected titles
retain ID, a known key returns 200, counts are three/two, stock order is as stated,
an empty filter returns 200, an absent key returns 404, and subsequent reads show
the same seed rows. The evidence receipt includes responses, versions and source
hashes. News facts come from the
[SAP Connect guide](https://www.sap.com/topics/events/connect/innovation-news-guide-2026),
reviewed October 27; a publication date and current viewer entitlement are unknown.

Preflight examples used to fix harness assumptions were replaced before the
comparison and are excluded. The CAP cases still share one tiny sample project.
Muse's low setting was selected after a default-setting probe on the first brief;
that part of its test is not an untouched holdout. There is one workflow per
configuration/brief, no seed distribution, no precision ablation, and no hosted
baseline. Results cannot establish that all local models trail paid models.

## Runtime, sampling and provenance

Hardware: Apple M5 Pro, 48 GiB unified memory. Runtime: LM Studio 0.4.26+4,
MLX metal/nax 1.13.1 and llama.cpp metal/advsimd 2.63.0. Models run sequentially
with context 16,384, parallelism one, seed 42, at most 8,192 generated tokens and
a 180-second deadline per stage. The scene-planning call uses temperature 0.2
and presence penalty zero; other stages use the profiles below.

| Configuration | Temperature / top-p / top-k | Other setting |
| --- | --- | --- |
| Qwen3.8 27B | 0.7 / 0.80 / 20 | Non-thinking; presence penalty 1.5 from the model card. |
| Gemma 4 31B IT | 1.0 / 0.95 / 64 | Requested non-thinking; all measured stages report zero exposed reasoning tokens. |
| Muse Glimmer 30B | 1.0 / 0.95 / 64 | Explicit system prefix `Reasoning strength: low.`; reasoning remains enabled. |

The Gemma native catalog omitted reasoning capability metadata. Omission is not
proof of unsupported functionality. For Muse, `reasoning_effort: none` does not
disable thinking. Its pinned model card and embedded template document the
system-prompt strength line; the template respects an existing line instead of
appending its default high setting. No unverified API keyword override is used.
See the pinned
[Muse instructions](https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF/blob/b44f1072cf75e918a1b82a3a17b45c4389b076e7/README.md).

New downloads were pinned and verified locally:

| Model repository | Revision | Installed artifacts |
| --- | --- | ---: |
| `mlx-community/gemma-4-31b-it-4bit` | `696d436c404745a59f30e4939a658162b0a9e57f` | 18,444,420,181 bytes |
| `meta-models/Muse-Glimmer-30B-GGUF` | `b44f1072cf75e918a1b82a3a17b45c4389b076e7` | 19,654,003,608 bytes |

Muse uses `Muse-Glimmer-30B-KQuant-Dynamic-Q4_K_XL.gguf`, SHA256
`ac7023d6a4c704eb9af54ab53e476a66b7f5b6c0ef2fc4a8dde5253c291a6c38`.
Weights and tokenizer files with published LFS SHA256 values were verified
against them. Small non-LFS files were size checked and hashed locally; a false
`matchesPublishedLfsSha256` value for those files means no published LFS digest,
not a failed weight verification. Model manifests retain individual digests and
download timings. License/readme files remain with the models outside Git.
The already installed Qwen copy was reused; it did not receive a new download
integrity claim. No model files are bundled into the repository or DMG.
A network-isolated installation/inference test and a packaged managed runtime
were not tested here; they remain application acceptance work.

Recorded RSS includes LM Studio helper processes. MLX Metal allocations are not
represented consistently by RSS, so these figures cannot compare GPU memory or
establish minimum machine RAM. Successful sequential loading on this 48 GiB Mac
does not establish support for a smaller Mac or simultaneous TTS/portrait work.
The original idle Flint instance is restored with context 262,144 and parallelism
four after the test; the existing LM Studio server remains running.

## Separate diagnostics

The default-reasoning Muse probe took 174.2s for ideas, with its first visible
text at 147.1s. The spoken draft hit 180.1s without visible output. Its correction
was stopped rather than repeating that configuration across six briefs. The
low-reasoning follow-up is recorded separately. The user's pause interrupted its
first correction; completed stages were reused only after request fingerprints
matched. The interrupted stage was not scored as a completed generation.

Qwen's two exploratory first-draft repeats changed **only** presence penalty
from 1.5 to zero, preserving the saved requests, seed and runtime settings.
The key-lookup story became 91 words, still below 100. Dialogue became 128 words,
but used 18 turns and an eight-word opening. Removing the penalty helped length
in these examples without satisfying the complete contract. There was no
correction or visual-plan pass in that diagnostic. It is not a held-out result,
a replacement score, or evidence that a single sampling tweak repairs grounding.

## Reproduce and inspect

The [portable results bundle](../samples/editorial-workflow/2026-10-27-results.json)
contains all 18 workflows, original/revised scripts, plans, timings, manual notes,
source briefs, CAP evidence, environment, model-file digests and configuration
probes. It can rebuild the comparison without installing a model or using a network:

```sh
python3 scripts/editorial/workflow-report.py artifacts/editorial-workflow-replay \
  --bundle samples/editorial-workflow/2026-10-27-results.json
python3 -m http.server 8765 --bind 127.0.0.1 \
  --directory artifacts/editorial-workflow-replay
```

Open `http://127.0.0.1:8765/comparison.html`. Filter by brief/candidate, reveal model
names, compare source facts, and inspect both spoken versions plus the visual plan.
Configuration diagnostics are separate from the scored cards.

Raw requests, visible responses, timing receipts and SSE traces remain in ignored
`artifacts/editorial-workflow-2026-10-27/`. Model-produced text is escaped in the
viewer; no generated script is executed. Private photos, voice recordings and
user drafts are absent from the benchmark inputs and export.

Reports retain fixture, harness and request fingerprints. The harness gained
only the explicit Muse low-prefix profile after the default probe; baseline
Gemma/Qwen request construction and scoring rules were not changed. Earlier
reports retain the earlier harness hash rather than being relabeled as a rerun.

The harness is standard-library Python 3.9+. It requires an already loaded model
and accepts only a bare `http://127.0.0.1:PORT` origin, disables proxy forwarding
and rejects redirects. Snapshot/restore your LM Studio state around a rerun and
hold the same heavy-job gates used by the studio. Do not displace a busy model.
Before the load command below, unload your own idle models through LM Studio
under that coordination. Avoid loading the writer beside Flint or a rendering
model; the benchmark used one heavy model at a time. Restore the saved identifier,
context and parallel settings afterward.

```sh
python3 -m unittest discover -s scripts/editorial -p 'test_*.py' -v
lms load gemma-4-31b-it --identifier shorts-workflow-gemma31 \
  --context-length 16384 --parallel 1
python3 scripts/editorial/workflow-benchmark.py \
  --model shorts-workflow-gemma31 --label gemma31 --profile gemma31 \
  --output artifacts/editorial-workflow-rerun \
  --gate .state/local-model \
  --gate "$HOME/Library/Application Support/SAP Shorts/Desktop/workspace/.state/local-model"
```

Use the equivalent installed model key with profiles `qwen38` or `muse-low` for
the other runs. Use `--label qwen38 --profile qwen38` for Qwen and
`--label muse --profile muse-low` for Muse so the viewer recognizes their reports.
`muse` is the unmodified default-setting probe profile, not the
selected full comparison. Use a fresh output directory when changing prompts or
settings; cached stages require identical request hashes. Load/unload operations
also need the shared heavy-job lock in a full orchestrator. The sample command
assumes that loading is already coordinated; it is not a replacement for the
application's job manager. Model-specific safety and license terms still apply.

For new CAP evidence, run this from `demos/cap/inventory` with Node 22:

```sh
node ../../../scripts/editorial/cap-evidence.cjs /absolute/path/to/new-evidence.json
```

The output must not already exist. This uses an isolated in-memory SQLite database
and leaves existing demo artifacts alone.


## Verification and application boundary

All 22 standard-library tests passed, including transcript/speaker preservation,
failed-correction fallback, duplicate-turn rejection, allowed source enums,
local-origin restrictions, explicit Muse low prompting, complete-bundle export
requirements and escaped viewer text. Python compilation, targeted Biome checks,
source-evidence digests and local documentation links were checked. The eight
extra live CAP checks passed against the exact source hashes retained in the bundle.
The comparison was also replayed from the portable bundle and inspected in the
browser for brief/candidate filtering, model-name reveal and source-fact access.
Production TypeScript, voice/portrait assignments and rendering code are unchanged;
the full application rendering suite was not rerun for this Python/data experiment.

Before app integration, establish a few approved professional, casual, comic and
dialogue examples. Let the writer propose three different viewer questions,
choose a supported premise, and put detailed identifiers in the visual plan.
Keep claims review separate from style review. Preview the selected real voice
and measure actual hook/episode duration; word counts alone cannot replace that.
A local writing setup should unload the heavy writer before Qwen speech or Ditto,
use the shared job gate, and retain manual authoring with no automatic remote
fallback. No application default, installer version or paid provider was changed.
