# Share a saved studio

Create one download from an existing review library:

```sh
npm run shorts -- library-package LIBRARY_DIRECTORY
npm run shorts -- serve PACKAGE_DIRECTORY
```

Use the saved library path for the first command and the new package directory
it prints for the second. Stop another preview server before using port 4173.
The download page offers `studio.zip`; you can also copy that file directly.
The package is a separate saved artifact. Creating it does not change the
original library or generate new narration or video.

## Open the download

Extract the entire ZIP, keeping its folders together, then open
`studio/review.html`. The studio includes its saved comparison controls, episode
players, voice samples, script workshops, and individual episode ZIPs. For
browsers that restrict local media files, serve the extracted `studio` directory
with the project's `serve` command. A basic static server also works; byte-range
support enables native media seeking.

The extracted studio is independent of the original artifact folders. Script
editing and JSON downloads work in the browser. Importing a revision, installing
voices, or producing new media requires the project and its prerequisites.
Voice choices describe the assets available when the library was built; another
machine checks its own installed assets during production.

## Snapshot and source dates

The archive preserves the exact original `library-manifest.json` and all its
listed files. Its root `README.txt` identifies the studio's build time and
explains how to open it. The outer `package-manifest.json` binds the archive to
the original manifest and records packaging time and hashes. Download that
receipt separately from the download page if you want to keep it with the ZIP.

Packaging checks file integrity. It does not re-run a tutorial or re-read news
sources. News cards and episode downloads retain their saved source-review and
expiry dates, and a static studio retains its build-time freshness labels.
Re-read the official sources before presenting a saved short as current news.
Companion posts remain unpublished drafts; avatar animation remains pending.

## What is included

Only recognized playback and workshop paths listed in a supported saved library
manifest are eligible. Changed, missing, unexpected, escaping, or symlinked
inputs stop packaging. Unlisted files are excluded, including files added to a
library directory after it was built. Configuration, installed models, job
databases, and credentials are not part of the library's playback inventory.
The command accepts the supported manifest format written by `library`; rebuild
a library whose manifest was manually reformatted or changed. Use real directory
paths rather than symbolic-link aliases for the source and destination.

The command validates the inventory and input sizes before loading media. It
supports at most 4,096 listed artifacts, a 1 MiB manifest, and 512 MiB of saved
input bytes. Video and audio are stored without recompression using the existing
pinned ZIP library. Output is assembled separately and becomes visible as a
completed package only after all inputs pass verification.

The manifest's hashes detect changes to a saved snapshot; they are not a
signature proving the publisher's identity. Only open a studio from a source
you trust, because its HTML contains the original interactive page scripts.
