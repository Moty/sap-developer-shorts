# Download an episode package

Each verified MP4 in a rebuilt studio has a **Download episode package · ZIP**
link on its episode card and video review page. The ZIP contains the exact video
and recording shown in that studio, including a selected presentation variant.

```sh
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

`produce SELECTOR --serve` also builds these downloads automatically. Packaging
uses saved, verified media; it does not synthesize speech, transcode a video, or
publish anything. The default narrator setting does not alter saved recordings.

## What's inside

One named episode folder contains:

- `short.mp4`, `poster.png`, and `captions.vtt`
- The exact exported `publication-draft.txt`
- A portable `review.html` with relative video, poster, caption, and post links
- `timing.json`, `transcript.txt`, and `sources.txt`
- `README.txt` identifying the recorded narrator, duration, caption alignment,
  pending avatar animation, and unpublished status
- `package-manifest.json` with episode/render/media identity, verification time,
  source and audio hashes, source-code commit when available, and member hashes

Open the MP4 in a media player. Serve the extracted folder locally if your browser
restricts file-based media playback. The extracted review has no dependency on
the original studio or artifact directories. Local job databases, installed
models, configuration, and absolute workspace paths are excluded.

## Dated news and saved recordings

News downloads include the source-review date and its inclusive valid-through
date. Packaging does not refresh either date. After expiry, the studio action
says **Download saved package · ZIP**, and the extracted README, source notes,
and review warn that the sources need rechecking before presenting current news.
A package remains a frozen saved export, including when its dates later expire.

## Validation and portability

Packages are built from the validated byte buffers selected for the studio.
Editorial input, media job, audio, captions, timing, selector, and export metadata
must match. Malformed or altered export candidates are excluded before choosing
a video, allowing another intact candidate or narrated preview to remain useful.
An independent package cache cannot select another voice or an earlier script.

The library manifest hashes each ZIP, and the internal package manifest hashes
each member except itself. ZIP dates are fixed, and the same inputs and build
time produce identical bytes. The pinned `fflate` 0.8.3 dependency creates the
archive without a platform-specific ZIP command. Video and image bytes are
stored without recompression; the current per-episode limit is 512 MiB.
