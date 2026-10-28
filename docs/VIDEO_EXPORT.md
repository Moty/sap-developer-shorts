# Vertical MP4 export

The `render` command turns a matching, verified local narration package into a real 1080 × 1920 MP4. It supports tutorial and news episodes, including two-person Kokoro dialogue. The output uses readable scene cards, captured demo results, visible captions, and speaker badges. Stock avatar animation and publishing are separate stages.

## Requirements and commands

Use Node 22.13+ and run `npm ci`. Install FFmpeg with the `libx264` encoder and `loudnorm` audio filter; the same installation must provide `ffprobe`. On macOS the tested installation is `brew install ffmpeg`. The frame renderer and fonts are included with the project; no browser capture service, speech regeneration, or paid API is needed for an existing narration package.

```sh
npm run shorts -- render CAP-01@duo
npm run shorts -- render NEWS-01
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

Generate narration first if the episode has no matching package. `render` refuses an unverified or out-of-range narration preview. News requires its recorded source review to be fresh at export time, even though older exports remain available for read-only review.

The command prints a standalone review page and MP4 path under ignored `artifacts/videos/`. Rebuild the library to add **Watch MP4** links. The library copies the video, poster, captions, timing, and companion post into a portable directory. It selects exports that match the exact editorial input and chosen narration package, with all exported file hashes intact.

## Composition and timing

Closing questions fit their available space by adjusting heading size from 78px
down to a readable 48px minimum. The full question, narration and captions are
preserved. Before preparing realistic portrait frames, export renders each
distinct scene/caption state at its first and last frame to check text layout.
An unfit layout fails early and directs the editor to **Review script & visuals**,
rather than suggesting a voice or photo setup problem.

Regression verification: the saved personal-voice news episode that previously
failed on a five-line closing question completed as a 53.380-second 1080×1920 MP4.
Its existing narration job and portrait frames were reused; full decode/audio
checks passed. The exported closing frame was visually inspected. The source fix
passed 326 tests, typecheck and build; no installer release was created.

Frames are drawn from registered, hash-matching source code and saved demo evidence. News cards retain the recorded availability category, timing, and scope. Tutorial frames never invent product output. The renderer uses the saved validated pixel layout; it wraps text using bundled font metrics and fails rather than clipping code, captions, or results. Long headlines can reduce to 56 pixels in the default layout. Other main text retains its configured readable size.

Code wraps at whitespace where possible, keeping paths and identifiers together
when they fit. Oversized uninterrupted values, such as long URLs, continue across
visual lines without losing characters. Indentation and blank lines are retained;
font sizes and overflow rejection are unchanged. Verified source files are not
rewritten by the visual wrapping.

Scene and caption transitions follow the recorded audio timeline at 30 frames/second. Quantization adds at most one video frame to a transition; the caption boundaries themselves remain Kokoro model estimates. Names label dialogue speakers visually and in the caption file; they are not spoken as narration. Speaker badges do not imply that stock-avatar animation has been rendered.

Animated presenters are now composited on every output frame, including pauses. Photo presenters selecting `animation: "neural"` use the [local learned portrait renderer](LOCAL_PORTRAITS.md), with calm, conversational or expressive delivery. Its runtime receipt and model/runner fingerprints participate in cache identity. Model failure stops the export rather than switching to lightweight photo animation.

The MP4 uses H.264, `yuv420p`, AAC at 48 kHz stereo, and a fast-start container. Two-pass loudness processing targets -16 LUFS with headroom. Export checks require finite audio measurements, integrated loudness within 1.5 LU of the target, and true peak below -0.5 dBTP. These are this project's review thresholds, not a claim of platform certification.

FFprobe checks dimensions, frame rate, codecs, audio presence, frame count, and stream/container durations against the source audio. FFmpeg must also decode the full video without an error. The final audio is measured again before the export becomes ready.

## Saved output and recovery

Each export has a content-derived key that includes the source input, media receipt, audio/timing hashes, saved layout, encoder profile and versions, application runtime hashes, and bundled fonts. A matching ready export with intact hashes is reused. Visual export changes do not require recording the voices again.

`video-manifest.json` records `RENDERING`, `VERIFYING`, `READY`, or `FAILED`, along with source references, artifact hashes, audio/video measurements, tool versions, and diagnostics. A partially encoded file is never offered as a completed MP4. Repeating the command can rebuild an incomplete or damaged export from its validated saved narration. After acquiring its export lock, recovery moves the previous attempt into a printed `recovery-UUID` directory before rebuilding. Previous bytes and diagnostics remain available; no speech regeneration is needed. A readable full key belonging to another render is left intact.

An immediate SQLite transaction gates each export's lock acquisition, recovery,
and rendering. It uses the already-required Node SQLite runtime, with no lease
table or migration. Competing attempts fail promptly; process exit releases the
gate. The PID/host lock remains for diagnosis and older active workers. A stopped
worker's PID lock is recovered only when its PID is confirmed dead on the same
host; unrecognized locks require inspection. Recovery preserves the gate sidecars
and refuses redirected cache directories. See [SQLite transaction behavior](https://www.sqlite.org/lang_transaction.html).

The work directory retains frames and diagnostic logs for inspection. Saved
caption files must exactly match the validated narration timing. Ready receipts
require actual successful decode/audio flags, a finite 15–90.1-second video (including encoding tolerance), and
duration within 0.1 seconds of the selected narration. Invalid media is excluded
from studio/package readiness. Preserve the source run, narration package, and
export together when backing up. The standalone review page provides downloads
and a transcript. When the verified CAP demo matches a Git commit, its companion
draft replaces the pending code link with a commit-specific project URL.

That lookup can use an older published demo snapshot after newer source changes.
It searches up to 64 recent commits touching the registered demo inputs, newest
first, within a ten-second total budget. Every registered file must match the
saved source hashes in one commit, and that commit must be reachable from a local
`origin` tracking reference for the configured project repository. Missing files,
unpublished snapshots, mixed-version inputs, or an exhausted lookup keep the
pending-link wording. The lookup does not fetch or push anything.

The video has not been published. News facts and availability, caption placement, pronunciation, companion copy, and phone readability still require editorial review. The application does not upload to a network service or treat an export check as publication approval.

Implementation references: [FFmpeg concat demuxer](https://ffmpeg.org/ffmpeg-formats.html#concat), [FFmpeg loudnorm filter](https://ffmpeg.org/ffmpeg-filters.html#loudnorm), and [the Canvas frame renderer](https://github.com/Brooooooklyn/canvas). Unmodified DejaVu fonts and required redistribution notices are in `assets/fonts/` with pinned source hashes.
