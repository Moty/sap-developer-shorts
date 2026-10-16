# Produce a local short

Starting on another Mac? Use [New Mac setup](NEW_MAC_SETUP.md) for prerequisites
and the first end-to-end test before running production.

The local production command combines verification, saved narration, vertical
MP4 export, and a refreshed review studio:

```sh
npm run shorts -- produce CAP-01@duo
npm run shorts -- produce NEWS-01
```

Run `npm ci` first. Install FFmpeg/FFprobe and run `voice-setup` before the first
Kokoro production. For the two-person script, also install Michael:

```sh
npm run shorts -- voice-setup am_michael
```

The default remains Heart. Presentation variants can explicitly assign their
own voices; the conversation assigns Heart and Michael. This command does not
download a voice automatically, purchase media, animate an avatar, or publish.

## What completion means

1. Preflight validates the chosen script, dated news freshness, installed voice
   selection, and video tools before starting narration.
2. The normal verification stage creates a frozen technical/news source run.
3. A matching local media job resumes or reuses completed output. New visual-only
   revisions can copy compatible verified speech into a separate package.
4. Measured audio must last 45–60 seconds, with an opening at most three seconds.
5. The selected narration is rendered to MP4 and checked for format, complete
   decoding, duration, and loudness.
6. The refreshed studio must contain that same narration and matching MP4.

`READY` means this local package passed these checks. It is still a review
artifact; a dated news script still needs editorial approval before publishing.

Each attempt writes an atomic `production.json` under ignored
`artifacts/productions/UUID/`, including the selected job, voices, presentation,
measured duration, completed output paths, stopped stage, and next action.

```sh
npm run shorts -- production-status CAP-01@duo
npm run shorts -- jobs CAP-01@duo
```

These show saved work. A saved `READY` report describes that attempt; files may
have been moved or the draft changed afterward. Rerun `produce` to validate the
current draft and its saved media before using it.

## Open the result

Use the printed studio directory with `serve`, or start an available localhost
port directly:

```sh
npm run shorts -- produce CAP-01@duo --serve
```

The final `Review:` address opens the studio with local video seeking and
downloads. Stop the server with Ctrl+C. Serving starts after production reaches
`READY`; a server error does not change the completed production report.

## Reuse and recovery

Rerun the same command after an interruption. It uses the saved job lifecycle;
completed speech is not submitted again for an MP4 or studio failure. Unknown
submissions, polling interruptions, and packaging failures stop with a saved
identifier and a specific recovery command. Incomplete production exits nonzero.

Each local Kokoro scene has a bounded 60-second rendering allowance; polling and
voice auditions allow five additional seconds for cancellation cleanup. Other
provider operations retain their shorter limits. Cancellation stops the local
render process and waits for it to close before releasing the job for retry.
Scene failures print an exact diagnostic path with elapsed time, configured
limit, exit/signal details, and captured output. Retry the saved job after checking
that report; a polling timeout does not authorize a second submission.

Speech reuse requires matching ordered narration/scene IDs, pronunciation,
speaker assignments, voice settings, synthesis implementation, and model/voice
fingerprint. System narration also binds planned scene timing because that engine
pads its visual slots. A title, overlay, layout, or post-copy edit can reuse
speech. A spoken-text, voice, speed, model, or synthesis-code edit cannot.

Reused bytes are copied into the new job's own directory and checked against a
saved receipt before packaging. The receipt records the original job and copied
hashes. Subsequent changes to the original package do not change the copy. Old
completed recordings without synthesis-code fingerprints remain reviewable;
they are not silently labeled compatible with a new generator.

The chosen media identifier is carried into both rendering and library
construction. Switching Heart → Bella → Heart therefore keeps the chosen Heart
recording even when a newer Bella recording is also present.

See [media recovery](MEDIA_WORKFLOW.md), [video verification](VIDEO_EXPORT.md),
[voice options](VOICE_OPTIONS.md), and [presentation styles](PRESENTATION_STYLES.md).
