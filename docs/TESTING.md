# Test the local workflow

Start with [New Mac setup](NEW_MAC_SETUP.md), then run from the repository root:

```sh
npm ci
npm run check
npm run build
node dist/src/cli.js doctor
npm run pilot
```

The automated suite must work without `.state/neural-voice/`, downloaded models,
provider credentials, or a cloud project. HTTP audition tests use deterministic
PCM audio through an injected speech function, so they test request validation,
arguments, WAV transport, and headers without requiring synthesis. Actual Kokoro
generation is a separate local integration check.

## Local speech and video checks

With uv and FFmpeg/FFprobe installed:

```sh
npm run shorts -- voice-setup am_michael
npm run shorts -- produce CAP-01@casual-v2 --serve
```

Wait for `READY`, open the printed local address, and check the MP4 and script
workshop. The local server exposes `/api/health`, `/api/status`, `/api/voices`,
and the workshop's phrase-audition and production endpoints. Its default binding
is `127.0.0.1`, so the API is available on the same computer.

Test one pronunciation audition before running a complete production, and run
Kokoro requests sequentially. Try the tutorial's API/npm/URL terms, then confirm
that displayed captions retain their normal spelling. Existing version names
must reject changed scripts; production must never silently fall back to
another saved version after a collision.

Check animation at multiple times within a spoken cue and at scene transitions.
Presenter mouth shapes are inferred from cue text and estimated cue timing;
the implementation is not measured phoneme-level lip synchronization. Keep code
and captions readable on a phone. A successful decode does not establish natural
delivery or accurate lip synchronization; use a listening review as described in
[Quality review](QUALITY_REVIEW.md).

For the lightweight mouth-only photo effect, center the calibration guide on the lips and size it around
the mouth. Test several shapes and check that the neck, collar, eyes, and
background remain stationary. Mouth-only mode keeps the portrait fixed and clips
speech animation to that guide; illustrated characters retain their head motion.
`tests/photo-motion.test.ts` compares pixels outside the mouth in both the actual
workshop canvas code and the video renderer, at multiple sizes and mouth scales.

The [learned local portrait path](LOCAL_PORTRAITS.md) has separate integration
checks. Its automated regressions cover continuous preview motion, full 30 fps
sampling through pauses, motion-setting persistence, missing-model failures,
changed engine files and damaged frame caches. A real model render is explicitly
run outside the model-free suite; inspect its output with the narration playing.

## October 16, 2026 verification

Testing the upstream `70edb52` version first reproduced four formatting failures.
After formatting, its 173 tests passed on a Mac with installed voices, but an
isolated checkout reproduced the audition test's dependency on missing models.

The corrected suite passes **174 workflow tests**, five live CAP assertions,
content validation, compilation, compiled doctor, and the silent pilot under
minimum Node 22.13.0 without installed voice assets. Regression checks also
cover duplicate edited scripts, default loopback binding, and fingerprints for
the actual compiled API/avatar modules. Astra independently reviewed these
corrections.

A separate real HTTP audition exercised Heart at speed 0.96 with API/npm
pronunciation overrides. It returned a valid 3.325-second mono WAV, the expected
spoken input, and zero service cost. Invalid audition input returned 400.
The browser workshop's line-audition button also completed with a playable
1.95-second result and displayed the expected `cap A P I` pronunciation.

A complete `CAP-01@casual-v2` production also reached `READY`: 47.730 seconds
of sequential Kokoro narration and 284 generated animation/caption frames,
exported as 1080×1920 H.264/AAC at 30 fps. Full video/audio decoding passed;
measured loudness was −16.22 LUFS and true peak was −4.41 dB. Two extracted
frames within one cue showed changing presenter mouth shapes while preserving
readable code and captions. This technical check does not replace listening.

Firebase configuration JSON was parsed locally. Firestore/Storage rules have
not been exercised against Firebase emulators or a deployed project in this
verification. No cloud deployment, paid provider call, or publication was made.

## Photo alignment and texture motion

`tests/photo-motion.test.ts` exercises the actual workshop renderer and video
badge renderer, checks pixel stability outside the mouth at different scales,
and verifies rotated masks and landmark rejection. `tests/face-assets.test.ts`
checks local module/WASM serving, the asset allowlist, and image-hash mismatch
rejection. Workshop tests cover calibration import and recovery, including native
select semantics; narration tests preserve reuse for avatar-only changes.

For a browser smoke test, install the model with `avatar-setup`, rebuild/serve the
library, and choose a saved single-person photo in the workshop. Check automatic
alignment and Test Lip Motion. Reload, Resume saved draft, and confirm the photo
and guide survive. Move a slider while detection is loading: the late detection
must not overwrite it. Start an upload, then select another photo: the late upload
may be saved but must not replace the newer selection. Replace a same-named file,
then Detect mouth automatically: it must load fresh bytes. Produce a new version
and compare the video with the preview; inspect the neck/collar for motion.

Model inference is a local browser smoke test, not a CI network download. CI uses
synthetic textured fixtures; private portraits and generated proof media stay
outside the committed test fixtures. See [PHOTO_AVATARS.md](PHOTO_AVATARS.md).

Local validation on 2026-10-16 (macOS): 186 automated tests plus 5 live CAP checks
passed on Node 22.13.0, and the compiled build completed. In the in-app browser,
MediaPipe aligned both a saved user portrait and a bundled portrait; reload/resume
retained the latter selection and geometry. A 47.73-second Heart-narrated photo
variant rendered successfully and passed the exporter's format, full-decode,
timing and audio-level checks. Astra reviewed the implementation and the fixes
for stale loads/uploads and native-select recovery. These checks establish
workflow correctness; naturalness still needs human review of the resulting video.

Photo-motion visibility follow-up (2026-10-16): the previous automatic calibration
produced subpixel movement (approximately 0.26px for open-A at a 140px portrait).
The moving lip core now has explicit displacement inside a larger stationary
feather boundary. A colored-lip fixture measures displacement after downsampling
to 64, 140 and 200px, alongside unchanged-pixel and rest/reset checks. All 187
tests and 5 live CAP checks pass. A new 47.73-second photo variant was rendered
using verified existing narration; original videos remain available. Astra's
review confirmed monotonic mapping and visible open/closed pose differences,
while noting stretched photo texture remains a limitation.
