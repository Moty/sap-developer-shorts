# Review studio

The local studio brings tutorial and news episode previews into one library. It provides format filters, text search, official source links, measured narration durations, production status, five future news ideas, and the remaining tutorial backlog. Episode players keep an **All episodes** link above the existing review page. The studio does not generate media, edit content, approve publication, or call an external service.

```sh
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

Replace `LIBRARY_DIRECTORY` with the path printed by the build command. The server binds to localhost on port 4173. If an older preview server is already using that port, stop it before serving the library. The library contains local copies of its selected HTML, audio, captions, and timing, so serving it does not depend on the original run folders still being present. Playback retains byte-range support for audio seeking.

## Preview selection

The collector reads completed preview runs inside the configured artifact root. An episode must match the current ID, revision, and exact canonical editorial input. Original artifacts and evidence must pass the existing preview loader's checks. For narration, the media receipt must identify the same source manifest and job, the required media files must match their saved hashes, and WAV samples and caption timing must agree with the episode.

A matching narrated preview is preferred over a newer silent storyboard. Within the same preview kind, the most recent source run is selected. The selection does not compare historical runtime hashes with today's application code: those hashes identify the implementation that created the original output. Modified, incomplete, or mismatched runs are excluded. A damaged media package may fall back to its intact silent storyboard. The library makes no claim to verify arbitrary code changes against an old tutorial run; its technical labels refer to the frozen evidence in that run.

Source review dates remain visible on news cards. A saved news preview can be inspected after its review expires, with a recheck label in the library and player header. This read-only exception does not apply to new media jobs, resumed unfinished jobs, or new news preview preparation. A static saved library retains its build-time freshness assessment; rebuild it before production to refresh the assessment. Re-reading and updating the editorial sources is still a manual task.

Each build creates `artifacts/library-<UUID>/` with a root `review.html`, nested episode players, and `library-manifest.json`. The manifest records exact input hashes, source-run references, copied artifact hashes, library inputs/runtime hashes, and the count of excluded run/media packages. Only selected playback files are copied; the job database and unrelated workspace files are not included. Output is assembled in a hidden staging directory and renamed after successful construction. A failed build may leave an ignored hidden staging directory for diagnosis, never a completed library.

The studio is a snapshot. Rebuild it to include new episodes or revised content. Filters and search work locally in the browser. No live feed, server-side authoring API, paid provider, scheduler, final MP4 renderer, or publishing workflow is added by the studio.
