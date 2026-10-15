# Narration choices

The selected style is a **warm, conversational female narrator**. The default local preview now uses Kokoro's American English **Heart** voice (`af_heart`) at speed 0.96. Each scene is generated continuously, preserving sentence flow; the old system preview generated short phrases separately and padded scenes to their planned slots.

## Local setup

Use Node 22.13+, macOS, and [uv](https://docs.astral.sh/uv/getting-started/installation/):

```sh
npm ci
npm run shorts -- voice-setup
npm run shorts -- narrate CAP-01
npm run shorts -- narrate NEWS-01
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

Use the directory printed by `library`. Setup downloads Python 3.12 if needed, an isolated environment, the English text-processing model, and pinned Kokoro assets. Allow several gigabytes of disk space. Subsequent synthesis runs offline on the CPU; no script is sent to a speech service. Installed dependencies and model/voice files are fingerprinted in `.state/neural-voice/runtime.json`. That directory is ignored by Git and is not part of the portable review library.

## Change the built-in voice

The active voice has one setting: `localPreview.voice` in `config/production.json`. Model revision and asset filenames are pinned separately in `config/neural-voice.json`; that file no longer duplicates the voice selection. List the 28 supported American and British English voices with:

```sh
npm run shorts -- voices
```

Examples include Heart (`af_heart`), Bella (`af_bella`), Nicole (`af_nicole`), Sarah (`af_sarah`), Michael (`am_michael`), and British voices Emma (`bf_emma`) and George (`bm_george`). Names identify built-in voice profiles; choose the delivery by listening rather than assuming a particular character from the name. The [official voice list](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) provides the full catalog.

Presentation variants can declare their own speaker voices, including a second cohost; these override the global voice for that variant. Install extra profiles with `npm run shorts -- voice-setup am_michael`. For ordinary single-narrator episodes, the global setting applies.

To compare the installed Heart and Michael profiles without changing the default:

```sh
npm run shorts -- voice-audition af_heart am_michael
npm run shorts -- library
```

The audition command renders up to three profiles sequentially, using identical
text and pronunciation at the configured speed. It prints a standalone sample
page; rebuilt studios include the samples under **Narrators**. Samples are separate
from episode evidence. Cache identity binds the passage, pronunciation, voice,
speed, runtime, and generator; changed or incomplete audio is excluded.

To audition Bella, then choose her as the default:

```sh
npm run shorts -- voice-setup af_bella
npm run shorts -- voice-audition af_bella
npm run shorts -- voice-select af_bella
npm run shorts -- produce CAP-01 --serve
```

`voice-select` validates the profile and atomically updates only
`localPreview.voice`; it does not install, synthesize, or change authored speakers.
Inspect effective voices and the precise file to edit with
`npm run shorts -- voices CAP-01@duo`. The professional CAP pilot and news brief
use the global default; prepared casual/comic/dialogue styles declare their own
speakers. Heart remains the shipped default.

Setup reuses the installed environment and cached model, downloads the requested
voice file if missing, and preserves existing profiles. The English text pipeline
follows the voice's American or British accent. No training, speaker recording,
or paid service is required. Regeneration measures new audio and creates captions
because pacing can change. Check duration and SAP pronunciations before use.

Run generation jobs one at a time to avoid CPU contention. Jobs now retain immutable runtime snapshots: installing another voice does not change a saved job's fingerprint. Resuming still requires the pinned model/voice files and original dependency versions. Completed previews remain playable with their saved audio. Changing the setting alone does not rewrite an existing episode or library.

To use the legacy system preview instead, set `localPreview.engine` to `system` and `localPreview.voice` to an installed macOS voice such as `Samantha`. Saved jobs retain their original engine and audio. Other Kokoro languages are outside the current English episode workflow and require additional text processing and caption checks.

## Current results

| Episode | Local neural duration | Opening | Captions |
| --- | --- | --- | --- |
| CAP-01 revision 2 | 58.730 seconds | 2.975 seconds | 19 |
| NEWS-01 revision 1 | 57.030 seconds | 2.450 seconds | 18 |

Audio and scene durations are measured from WAV samples. Caption boundaries use **model estimates**, not forced alignment; the player discloses this. Publishing should include a listening pass for SAP pronunciations and caption placement. No subjective comparison against a paid provider has been performed.

## Kokoro or ElevenLabs?

| Option | Fit | Cost and access |
| --- | --- | --- |
| Local Kokoro | Reusable local narrator with continuous sentence delivery; selected default for these previews | No per-video API fee. Model download and local compute required. The [official model repository](https://github.com/hexgrad/kokoro) identifies the weights as Apache-2.0; the [voice reference](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) describes the available voices. |
| ElevenLabs | Hosted alternative to audition if more expressive delivery or voice selection is needed; its API supports timestamped speech | Requires an account and service access. Check [current pricing](https://elevenlabs.io/pricing/api) and the [commercial-use requirements](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform). The free plan does not include a commercial license. |

Start with the local samples and choose by listening. ElevenLabs has not been connected, purchased, or integrated. A future adapter should use its [timestamped speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps), preserve source/job provenance, enforce an agreed spending limit, and remeasure the resulting audio. The existing $5 first-video limit remains in effect; it is not an authorization to purchase a subscription.
