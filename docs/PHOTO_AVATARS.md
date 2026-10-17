# Local photo presenters

This guide describes the lightweight photo effect. For learned face/head motion
driven by narration, choose **Realistic local portrait (Ditto)** and follow
[local portrait narration](LOCAL_PORTRAITS.md).

The workshop can locate the mouth automatically and animate the photograph's
own lip pixels. It uses Google's **MediaPipe Face Landmarker** for alignment and
a shared pixel-deformation renderer for preview and video export. This is a
restrained photo effect: it does not generate unseen teeth, a new mouth interior,
natural head movement, or a photorealistic talking-face video.

## Setup on a new machine

After `npm ci`, run:

```sh
npm run shorts -- avatar-setup
npm run shorts -- library
npm run shorts -- serve
```

`avatar-setup` downloads the approximately 3.6 MiB model from Google's official
model storage and verifies its SHA-256. The model is stored under
`.state/face-landmarker/face_landmarker.task`. It is optional: without it, the
workshop reports setup instructions and manual mouth adjustment still works.
No API key, paid service, Python runtime, or GPU is required for alignment.

In **Revise script**, choose **Custom Photo / Uploaded Portrait**, then select or
upload a clear, front-facing photo containing one person. Uploads are normalized
to a square before detection. New selections automatically locate the lips;
**Detect mouth automatically** repeats detection using fresh photo bytes.
Check the guide in the enlarged 200px preview, press **Test Lip Motion**, and
adjust the three sliders if needed. This button runs a silent sequence of sample
mouth poses; it does not play or analyze narration.
Save a new version and produce its video. Avatar-only changes can reuse matching
verified narration; voice or script changes still require their own recording.

The detected center, size, angle, aspect ratio, image hash and detector version
travel with the script. Replacing a photo under the same filename invalidates its
automatic calibration: select it and detect again before rendering. Reloading a
tab can recover the selected photo and calibration with the rest of the draft.

## Privacy and portability

Portraits are processed in the browser on this machine. The local server serves
both the MediaPipe JavaScript/WASM and the model; there is no CDN fallback or
portrait transmission to Google. The initial CLI setup downloads a public model
without sending any image. Upload Photo sends the image only to the localhost
studio and saves it in `assets/avatars/`.

Downloaded scripts contain configuration, not the portrait. Copy the relevant
portrait privately to `assets/avatars/` on another machine, or upload it there
and recalibrate. Install the model on each machine. Portable studio ZIPs preserve
finished media but do not include detector runtimes or the optional model; serve
an editable studio through this project's local server to use detection.

## Pinned components and limits

- NPM: `@mediapipe/tasks-vision@0.10.32` (Apache-2.0 package license).
- Model: Face Landmarker, float16, version 1, from
  [Google's model storage](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task).
- Model SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
- [Official web integration guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
  and [model overview](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).

No face, multiple faces, heavy head tilt, a small/obscured mouth or an unavailable
model leaves manual controls usable. Detection is an estimate, not a promise of
perfect placement. Browser inference runs once per selection on the main thread;
initial WASM startup may briefly pause a slower device. Detection centers movement
on the inner mouth opening. Lip motion maps the original pixels between explicit
upper/lower lip positions and a stationary feather boundary. Older calibrations
can be refreshed with **Detect mouth automatically**. The neck,
collar and background are not animated. Photo eyes, eyelids and eyebrows also
stay still; blink/brow motion currently applies only to illustrated presenters. Existing videos are not rewritten;
produce a new version to see this renderer.

For neural talking-head generation, [MuseTalk](https://github.com/TMElyralab/MuseTalk)
provides audio-driven lip synthesis but its official setup targets CUDA/NVIDIA.
[LivePortrait](https://github.com/KlingAIResearch/LivePortrait) supports Apple
Silicon but requires a driving video/template rather than narration alone.
Neither is installed or called by this workflow.
