# Local picture-to-narration rendering

The realistic portrait path uses a learned Ditto audio-to-motion model and a learned face renderer on this Mac. The earlier `neural` path was a procedural photograph warp; existing scripts selecting `animation: "neural"` now use the learned engine. Lightweight animation remains an explicit, separate option.

## Use it

Install FFmpeg and `uv`, then run the one-time local setup:

```sh
npm run shorts -- talking-head-setup
npm run shorts -- portrait-status
```

Setup downloads about 2.32 GB of pinned model files plus Python dependencies into `.state/portrait-runtime/`. It verifies every model's checksum and loads the model stack before marking it ready. Apple Silicon uses PyTorch MPS for the learned motion/face networks; auxiliary ONNX models use CPU. The Python environment is isolated from the existing Kokoro voice environment. Setup needs the internet; rendering sends neither the portrait nor narration to a cloud service.

For an independent picture and recording, with no episode schema required:

```sh
npm run shorts -- portrait-render ./portrait.png ./narration.wav conversational
# A previously uploaded portrait filename also works:
npm run shorts -- portrait-render moty-profile.png ./narration.wav calm
```

The first argument accepts a registered `assets/avatars/` filename or an explicit image path. Images imported by path are normalized to a square and saved under a content-derived name. Use PNG, JPEG or WebP up to 4 MB, with one clear, near-frontal face, visible eyes and mouth, and room around the head. The audio can be any format FFmpeg can decode. Output is a 512 × 512, 30 fps H.264/AAC MP4 in `artifacts/portraits/`, alongside a receipt. The existing episode workflow can generate the narration locally from text with Kokoro.

In the workshop, select **Custom Photo**, a saved or uploaded picture, then **Realistic local portrait (Ditto)**. Choose **Conversational** delivery and adjust **Movement amount**. **Save & Produce Video** generates the portrait from the actual narration. The silent alignment preview is a lightweight effect; it does not preview the learned model's final facial movement. Mouth alignment sliders apply to that lightweight effect; the learned renderer detects its own face geometry.

For existing episodes:

```sh
npm run shorts -- render NEWS-02@myth-fact-edit
npm run shorts -- library
```

`render` reuses the verified narration. `produce` can create or resume narration as well. Rebuild the studio to expose the updated controls and saved MP4.

## Delivery settings

Motion settings belong to each speaker's avatar and survive download, import and draft recovery:

```json
{
  "mode": "photo",
  "imageId": "moty-profile.png",
  "animation": "neural",
  "motion": { "style": "conversational", "intensity": 0.7, "seed": 42 }
}
```

| Setting | Behavior |
| --- | --- |
| `calm` | Smaller pose changes for restrained explanations |
| `conversational` | Moderate, speech-driven motion; the default |
| `expressive` | Wider pose range, still bounded and smoothed |
| `intensity`, 0–1 | Scales head rotation and translation, independently of lip motion |
| `seed`, unsigned 32-bit integer | Repeats the sampling setup; exact GPU arithmetic may vary by runtime/hardware |

The learned model generates speech-conditioned motion in overlapping windows. Rotation is converted to physical angles before smoothing and limiting; lip expressions are kept separate. Its native 25 Hz motion is interpolated before rendering each 30 fps output frame. The compositor also draws every frame through silent gaps. Dialogue audio is masked per speaker so both portraits do not mouth the same words.

The lightweight preview uses a separate continuous, seeded motion track with occasional nods, slow posture changes and variable, smoothly closing blinks. It does not reset the head at caption boundaries or bob continuously with a sine wave. Both paths share the same delivery settings, but they do not produce identical motion.

## Reliability and practical limits

- A requested realistic render fails clearly if model setup or generation fails. It never silently substitutes a photo warp.
- Cache identity includes the image, narration, speaker/cues, delivery settings, runner and installed runtime. Every generated frame is hashed; partial or altered sequences are preserved for diagnosis and regenerated. One local model job runs at a time to limit memory pressure.
- The standalone MP4 is fully decoded and checked for dimensions, frame rate, frame count, audio and duration before it is offered as complete. Episode exports retain their existing loudness, provenance and media checks.
- Generation is offline work, not a live webcam effect. A four-second, 120-frame sample took about 98 seconds on the tested M4/16 GB Mac, including model startup. The 58.63-second episode generated 1,759 unique portrait frames in 21.96 minutes, before scene composition/encoding. Longer videos and two-speaker output take longer. Start with a short sample when choosing a new picture.
- This animates the face and head. It does not generate conversational hand gestures or full-body motion. Voice cadence still comes from the narration; changing head motion does not rewrite an anchor-like script or voice performance.
- A single picture cannot establish unseen facial details. Teeth, eyes, hair, profile turns and the neck boundary still need visual review. Automated integrity checks establish that a render completed correctly; they do not certify human-level naturalness or calibrated lip-sync quality.

## Implementation and provenance

`src/media/portrait-runner.py` adapts upstream components to Metal/CPU and executes them sequentially, propagating failures to the caller. `src/media/talking-head.ts` manages setup, caching and frame integrity. `src/media/portrait.ts` is the independent picture-plus-audio entry point. `src/media/portrait-motion.js` supplies the lightweight continuous preview.

The pinned upstream source is [antgroup/ditto-talkinghead](https://github.com/antgroup/ditto-talkinghead/tree/c3e47eee2e626500017a0556b470d6d4182f85e8). Model revision and per-file checksums are recorded in `config/portrait-runtime.json`; dependency versions are locked in `config/portrait-requirements.txt`. Ditto's source is Apache-2.0. Its downloaded auxiliary models have their own terms; the source license alone does not establish commercial rights to every model. The legacy procedural runner remains in the repository for historical compatibility but is no longer selected by realistic rendering.

Run `npm test`, `npm run typecheck`, and `npm run build` for model-free checks. A real model render is a separate, explicit integration check; tests do not unexpectedly launch a large GPU job when models happen to be installed.
