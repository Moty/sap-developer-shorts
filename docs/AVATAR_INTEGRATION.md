# Avatar and talking-head architecture

SAP Developer Shorts supports three local presenter paths for its 1080 × 1920
videos. Illustrated characters use canvas-drawn visemes, photographs can use a
fast lightweight effect, and realistic photographs can use the learned Ditto
renderer. No portrait or narration is uploaded for these paths.

## Video layout

[`config/video-layout.json`](../config/video-layout.json) reserves a presenter
slot beside the captions:

```json
{
  "canvas": { "width": 1080, "height": 1920 },
  "captions": { "x": 72, "y": 1380, "width": 600, "height": 240 },
  "presenter": { "x": 696, "y": 1320, "width": 240, "height": 240 }
}
```

The code or evidence panel remains above this slot. Presenter frames are drawn
at the video rate, including pauses, so the face does not jump when caption cues
change.

## Implemented presenter paths

| Path | Input | Motion | Intended use |
| --- | --- | --- | --- |
| Illustrated character | Built-in Mira, Max or narrator profile | Canvas visemes, eyes and gestures | Fast local tutorials and dialogue |
| Lightweight photograph | Uploaded or saved portrait | Mouth calibration plus restrained continuous preview motion | Immediate alignment checks and low-cost output |
| Realistic local portrait | Uploaded or saved portrait plus narration | Learned speech-conditioned face and pose through Ditto | Reviewed, higher-fidelity final output |

`src/media/avatar.ts` draws the illustrated and lightweight paths.
`src/media/portrait-runner.py` performs learned inference, while
`src/media/talking-head.ts` verifies the runtime and generated frame cache.
`src/media/portrait.ts` exposes the same engine as a reusable picture-plus-audio
renderer outside the episode schema.

## Learned local portrait flow

1. Run `npm run shorts -- talking-head-setup` once. The installer creates an
   isolated Python environment, downloads the pinned Ditto source and model
   revision, verifies every recorded checksum, and loads the model stack before
   writing the runtime receipt.
2. In the workshop choose **Custom Photo**, then **Realistic local portrait
   (Ditto)**. Choose Calm, Conversational or Expressive and set the movement
   amount.
3. Production converts narration to mono WAV, generates speech-conditioned
   motion, smooths and limits physical pose angles separately from lip
   expressions, and interpolates the model's native 25 Hz coefficients for every
   30 fps output frame.
4. The compositor places those frames in the presenter slot and completes the
   normal MP4 decode, audio-level, duration, provenance and artifact checks.

The cache key includes the portrait, narration, cues, motion settings, runner
source and installed runtime receipt. Every generated frame has a SHA-256 hash.
Partial or changed caches are retained for diagnosis and regenerated; a realistic
render failure is reported instead of silently substituting the lightweight
effect.

Dialogue narration is masked by speaker cue so one portrait does not mouth the
other speaker's words. Only one local learned render runs at a time to keep
memory use bounded on the tested M4 with 16 GB RAM.

## Standalone picture-to-narration use

The engine is reusable without an SAP episode:

```sh
npm run shorts -- portrait-render ./portrait.png ./narration.wav conversational
```

The result is a verified 512 × 512, 30 fps H.264/AAC MP4 under
`artifacts/portraits/`. See [Local picture-to-narration rendering](LOCAL_PORTRAITS.md)
for accepted files, setup, commands, model provenance, measured render time and
quality limits.

## Practical limits

The learned path animates the face and head while retaining the source torso and
background. It does not invent hand gestures or full-body movement. A single
image cannot establish unseen profile details, and eyes, teeth, hair and the neck
boundary still require review. Voice cadence and script style also affect whether
the speaker feels conversational.

The silent browser preview deliberately uses the lightweight effect so editing
stays responsive. It previews framing and movement intent, not the learned
renderer’s final facial motion. Automated checks prove artifact integrity and
media correctness; they do not certify human-level realism or phoneme-level
lip-sync accuracy.

Cloud avatar providers are not part of the implemented renderer. Adding one
would require a separate privacy, licensing, cost, credential, failure-recovery
and provider-output review rather than a transparent replacement of the local
path.
