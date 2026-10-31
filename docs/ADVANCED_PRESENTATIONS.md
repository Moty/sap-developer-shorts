# Advanced presentations

The local source studio now supports richer presentation design in both the
interactive deck and the Canvas/FFmpeg MP4 renderer. Existing designs keep their
previous defaults; no episode or image is migrated automatically.

## Controls

Open an episode's **Writing & visuals → Advanced presentation** panel.

- **Backgrounds:** Classic, Aurora glow, Architectural blueprint, Spotlight and
  Clean editorial. Theme still selects Electric, Ocean or Sunset colors.
- **Effects:** None, Gentle drift and Subtle particles. **Minimal / static** freezes
  decorative motion in the deck and exported frames. Animation follows scene time,
  so seeking reproduces the same geometry rather than using a wall-clock loop.
- **Layouts:** Hero callout, step cards, comparison, connected flow and milestone
  sequence. Flow/milestones support two to four short labels on presenter scenes.
  A sequence is ordered; factual dates remain in saved source evidence.
- **Charts:** Captured output scenes can show data rows, horizontal bars or a dot
  plot. Charts read the existing scene's verified inventory capture, use a zero
  baseline and retain exact product/stock values. The deck includes a data table
  and captured request/command details. Oversized charts fail readable bounds
  instead of truncating values silently.
- **Images:** Upload local PNG/JPEG/WebP (up to 8 MB / 24 megapixels), then select
  a framed illustration or a dimmed background. Contain/cover, horizontal and
  vertical focus, alt text and a caption control presentation. A framed image
  occupies an explanatory presenter scene; code and source cards retain their
  evidence layout. Background images can accompany those protected scenes.

Apply changes to the editable draft, then **Preview current scene** for an actual
representative PNG from the video renderer. Preview uses planned timing and a
verified saved capture when one exists; it does not generate narration or a
neural portrait. Reload controls if the draft changed while they were open.
Previewing applies current controls to the draft. **Save draft** creates a version;
that version's deck and next MP4 use the saved design. Image upload alone never
changes a scene. Older versions and approvals retain their exact-output binding.

## Assets and privacy

Images have their own library, separate from presenter photos. Uploads are
aspect-preserving, metadata-stripped normalized JPEGs (up to 1600 pixels on the
longest side); transparency is flattened onto the dark presentation surface.
They live under `.state/visual-assets/` in the active local workspace, with
private directory/file permissions. Include this folder in workspace backups.

References use the normalized image SHA-256, with no arbitrary paths, remote
image URLs, SVG or HTML ingestion. Completed bytes are published atomically.
Duplicate uploads reuse the first label/credit; re-uploading an exact original
repairs damaged bytes while keeping diagnostics. Missing/tampered assets fail
before narration starts. The library shows an explicit restore notice/placeholder
when an image is unavailable, while keeping previously exported MP4s available.
Export pins the selected image and metadata digests and
checks them again before accepting the MP4.

Only selected images are embedded in saved presentation HTML/JSON. Portable
studio and episode ZIPs therefore retain them without an API or image library;
unselected images and original uploads are excluded. Credits remain visible.

The writing model can choose background/effect/layout and captured chart display.
It receives only a boolean indicating a framed image occupies a scene. Asset IDs,
image bytes, alt text and captions stay local. Existing images are preserved when
an AI design is applied. Schema/source checks still cannot judge an image's
accuracy or phone-sized legibility: inspect the frame and finished video.

Production presets now carry global background/effect preferences alongside theme
and motion. Story-specific image references, layout labels and chart bindings are
kept with the episode rather than copied to unrelated stories. Visual-only changes
retain the existing narration-reuse identity.

## Current scope

This is a local source-studio enhancement. It does not update an installed app,
release an installer, add cloud/private-web controls or extend remote-worker
transport for presentation image files. No new model, external visual library,
paid inference or external image service is required.

Charts currently use captured CAP inventory data. Other business metrics/trends
need a separate structured, source-backed dataset import. The procedural effects
are restrained motion graphics; uploaded footage and an arbitrary animation
editing timeline remain future extensions.

## Validation

- TypeScript build and the complete 429-test workflow suite passed, including
  six new actual-asset/geometry/schema/render/writer/recovery tests.
- All 18 desktop tests, five live CAP checks, content validation, scoped lint and
  a fresh portable studio package also passed.
- Astra independently reviewed the implementation and ran 49 focused tests.
  Its crop/layering, long-label, AI-occupancy, chart-preservation and atomic-upload
  findings were fixed before handoff.
- Tests cover simultaneous uploads, repair after corruption, raster/pixel limits,
  traversal rejection, deterministic/minimal geometry, zero-baseline exact values,
  common crop geometry, protected scenes, real PNG/deck output and local-image
  preservation without asset references in provider prompts.
- Live UI checks uploaded a locally drawn diagram, applied/previewed a flow,
  framed illustration and captured bar chart. No new episode was saved or
  narration generated by these checks.
- Four schema-valid standalone design pilots and an 8-second silent motion study
  were rendered. FFmpeg fully decoded the sample; FFprobe reported H.264,
  1080×1920, 30 fps and 240 frames. The sample is a visual demonstration, with
  scene progress compressed for comparison, rather than a new approved short.
