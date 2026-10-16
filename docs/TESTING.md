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
