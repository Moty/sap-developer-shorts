# Narrate with a recorded voice

**My voice** uses Qwen3-TTS Base locally on Apple Silicon. Record or upload a
sample, confirm its exact words, listen to an audition, and select the accepted
profile for a speaker. Kokoro Heart remains the stock default. Conversations can
mix Qwen and Kokoro or use two distinct personal profiles.

## Install once

Complete [Mac setup](NEW_MAC_SETUP.md), including Node 22.13+, uv, FFmpeg and
FFprobe. From the repository root:

```sh
npm run shorts -- voice-clone-setup
npm run shorts -- voice-clone-status
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

Use the directory printed by `library` and open the localhost address. Qwen is a
separate optional installation; `mac:setup` prepares the stock workflow.
No API key, subscription, training or per-video payment is required.

The tested configuration uses Python 3.12, MLX Audio 0.5.9, **1.7B Base bf16** and
the **0.6B 8-bit forced aligner**. Required model files total **5,820,683,586 bytes
(5.42 GiB)**, plus the Python environment, package caches and temporary audio.
Allow additional free space. Setup checks Apple Silicon/Metal support. Intel
Macs and other operating systems are outside this release. Testing used arm64
macOS 27.0.1; earlier macOS versions have not been verified.

Setup downloads pinned files and checks SHA-256 digests. Versions, revisions and
checksums are committed in [model configuration](../config/qwen-voice.json) and
[Python requirements](../config/qwen-voice-requirements.txt). Subsequent rendering
blocks network connections and loads local files. Missing models fail with setup
guidance. Setup diagnostics are in `.state/qwen-voice/setup.log`.

## Enroll and select a voice

1. Open **Edit a new version → Voice & portrait → My voice**.
2. Upload audio, or choose **Use a reading script** and **Record sample**. Grant
   microphone access if you want to record. Upload is available if access is
   denied or recording is unsupported.
3. Preview a clean excerpt of one speaker. Aim for **10–15 seconds**, without
   music, overlapping voices or long silence. Input limits are two minutes and
   30 MiB; the selected excerpt must be 3–30 seconds.
4. Enter the **exact words in the selected excerpt**, correcting any departure
   from the reading script. Automatic transcription is not included.
5. Name the voice and confirm it is yours or the speaker agreed to its use.
   Choose **Save voice sample on this Mac**.
6. Select the saved profile, choose **Generate audition**, and compare the
   reference and generated audio. **I listened · use this voice** accepts the
   current audition and assigns it to the chosen speaker. Acceptance records
   your listening decision, not an automated quality score.
7. Save the draft, then **Produce video**. Previously accepted profiles also
   appear in each speaker's voice menu. Dialogue requires distinct identities;
   two revisions or names of the same profile do not establish two speakers.

Saving a draft does not generate speech. Narration uses complete scenes or turns,
then aligns pronunciation-expanded words to the final audio. Captions keep
ordinary spelling such as `API`. Qwen captions use forced alignment; Kokoro turns
retain model timing estimates. Final audio is mono 22,050 Hz PCM and drives the
existing captions and portrait renderer.

Sample delivery and script phrasing both affect the result. Use the performance
you want to reproduce, conversational sentences and the pronunciation glossary.
This Base integration does not expose unsupported emotion, laughter or voice
design controls. Listen for technical terms, missing/repeated words and pacing,
then review captions and the complete video before sharing.

## Privacy, deletion and another Mac

Reference samples, transcripts, acceptance records and enrollment auditions live
under ignored `.state/voice-profiles/`, outside served libraries and Git. Browser
recovery stores opaque references rather than audio blobs. Private actions need
a same-origin loopback session. LAN-bound servers disable these controls.

Personal-voice definitions and output are marked **local-only** and excluded from
Firebase synchronization. Cloud jobs cannot invoke an existing local profile.
Firebase export classifies saved output before copying; it rejects a library
containing private or unclassifiable media. For an ordinary cloud studio, build
a separate stock-only library:

```sh
npm run shorts -- library --stock-only
```

Explicit local MP4, episode and studio downloads may include finished synthetic
narration. They never include reference recordings, transcripts or enrollment
auditions. Share finished voice recordings deliberately.

**Delete voice sample** removes every revision of that profile and its enrollment
auditions. Existing generated/exported narration and videos remain playable.
Regeneration needs the original accepted revision or an explicit new voice choice.

Git and portable studio ZIPs do not transfer profiles. On another Mac, install
Qwen, enroll a sample there and choose the new profile in a new script version.
Private profile export/import is deferred. Do not copy virtual environments or
active job databases between machines.

## CLI enrollment

Save a local JSON file describing the excerpt:

```json
{
  "name": "My conversational voice",
  "transcript": "The exact words spoken in this excerpt.",
  "consent": true,
  "startSeconds": 0,
  "endSeconds": 12
}
```

```sh
npm run shorts -- voice-profile-add /absolute/path/sample.wav /absolute/path/enrollment.json
npm run shorts -- voice-profile-list
npm run shorts -- voice-profile-audition PROFILE_ID
# Listen to the printed audition.wav before accepting it.
npm run shorts -- voice-profile-accept PROFILE_ID
```

The list returns the structured `voice` reference for a **schemaVersion: 2**
presentation speaker. Stock version-1 files retain their existing format. To
replace a sample under the same identity, include the UUID as `profileId` in the
enrollment JSON. Changed audio/transcript/trim creates an immutable revision
requiring another audition. Older episodes retain their original references.
`voice-profile-delete PROFILE_ID` removes the entire local profile.

## Recovery and measured limits

Heavy Qwen, alignment, stock narration and Ditto inference share a process lock.
A second operation reports busy; wait and retry. A killed owner releases the
operating-system lock. Completed scene audio and receipts are verified before
reuse; partial/changed scenes are recorded again. Timeouts terminate the child
before releasing the lock. Existing `production-status`, `jobs` and
`produce SELECTOR` commands inspect and resume production.

October 17 integration used a clearly labeled **synthetic Heart reference**, not
a person's recording. A cold 6.16-second audition took 23.8 seconds total and
peaked at 9.0 GiB of MLX memory. A warm single-pass 111-word comparison took
23.0 seconds total, produced 39.0 seconds of speech and peaked at 11.4 GiB.
These describe one Mac and text; performance and pacing vary. See the
[implementation evidence](QWEN_VOICE_CLONING_PLAN.md) for full pipeline checks.

The single-pass comparison was shorter than the 45–60-second editorial target.
Measured timing is reported without silently stretching or cutting speech.
Forced alignment follows supplied text and cannot prove each word was actually
pronounced correctly. Personal resemblance, naturalness and acronym pronunciation
need the intended speaker's listening feedback; the synthetic fixture does not
sign off those qualities.

Upstream references and licenses: [Qwen3-TTS (Apache-2.0)](https://github.com/QwenLM/Qwen3-TTS),
[MLX Audio (MIT)](https://github.com/Blaizzy/mlx-audio),
[Base cloning API](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/README.md),
[alignment API](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/stt/models/qwen3_asr/README.md).
