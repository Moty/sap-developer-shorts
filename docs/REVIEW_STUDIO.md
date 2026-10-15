# Review studio

Use **Revise script** on an episode card to open its script workshop. Edit an
existing delivery, choose voices for its speakers, download a new named version, then use `script-import` and the
printed production command. Source/claim/demo inputs and source-review dates stay
fixed. Edits are held only in the page until downloaded; existing versions and
recordings are preserved. See [presentation styles](PRESENTATION_STYLES.md).

The local studio brings tutorial and news episode previews into one library. It provides format filters, text search, official source links, measured narration durations, production status, future news ideas, and the remaining tutorial backlog. Episode players keep an **All episodes** link above the existing review page. The studio does not generate media, edit content, approve publication, or call an external service.

## Compare presentation styles

The **Delivery styles** section compares Professional, Casual, Comic, and
Conversation versions of the CAP pilot. Each choice shows the recorded Kokoro or
system voice, measured duration, and a specific readiness label. Valid MP4s have
a primary **Watch MP4** action and a saved opening-frame image; narration remains
available separately. Production instructions live in a small disclosure.

The selection is part of the address, for example
`review.html#compare-CAP-01--duo`. Returning from the MP4 or narration player keeps
that selection. Standard links support keyboard navigation and browser history;
the page does not move focus or start playback when switching styles.

Without JavaScript, all comparison panels and their media/production links remain
available. Search and filtering stay hidden because they need the enhancement.
On phones, the four choices use two columns and the video action spans the panel.
New writing formats still require an authored script; the interface does not
rewrite an episode automatically.

```sh
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

Replace `LIBRARY_DIRECTORY` with the path printed by the build command. The server binds to localhost on port 4173. If an older preview server is already using that port, stop it before serving the library. The library contains local copies of its selected HTML, audio, captions, and timing, so serving it does not depend on the original run folders still being present. Playback retains byte-range support for audio seeking.

## Preview selection

The **Narrators** section contains identical-text Kokoro samples, with profile ID,
accent, duration, speed, and the current default. Native audio controls never
autoplay. Record installed voices with `voice-audition af_heart am_michael`, then
rebuild the library. Supported profiles without a sample show the relevant
setup or audition command; installation is explicit.

Samples are separate from episode verification. Their identity binds passage,
pronunciation, voice, speed, synthesis code, and pinned local runtime. Only
complete samples with matching WAV hashes are copied into the portable library;
changed, outdated, and incomplete samples are excluded. The library manifest
records those identities and copied audio hashes. Choosing a default is a CLI
action. The script workshop can override a new revision's speaker voices while
keeping the global default and existing recordings. Its choices use a build-time
inventory of hash-checked local model/config/voice assets. Missing originals are
retained with a setup notice; other missing or damaged voices are not offered.
Production checks current assets and dependencies again. Dialogue requires
different voices; speaker names and turns stay fixed. A saved draft can still be
imported on a machine without its voices installed.

The collector reads completed preview runs inside the configured artifact root. An episode must match the current ID, revision, and exact canonical editorial input. Original artifacts and evidence must pass the existing preview loader's checks. For narration, the media receipt must identify the same source manifest and job, the required media files must match their saved hashes, and WAV samples and caption timing must agree with the episode.

A matching narrated preview is preferred over a newer silent storyboard. Within the same preview kind, the most recent source run is selected. The selection does not compare historical runtime hashes with today's application code: those hashes identify the implementation that created the original output. Modified, incomplete, or mismatched runs are excluded. A damaged media package may fall back to its intact silent storyboard. The library makes no claim to verify arbitrary code changes against an old tutorial run; its technical labels refer to the frozen evidence in that run.

Source review dates remain visible on news cards. A saved news preview can be inspected after its review expires, with a recheck label in the library and player header. This read-only exception does not apply to new media jobs, resumed unfinished jobs, or new news preview preparation. A static saved library retains its build-time freshness assessment; rebuild it before production to refresh the assessment. Re-reading and updating the editorial sources is still a manual task.

Each build creates `artifacts/library-<UUID>/` with a root `review.html`, nested episode players, and `library-manifest.json`. The manifest records exact input hashes, source-run references, copied artifact hashes, library inputs/runtime hashes, and the count of excluded run/media packages. Only selected playback files are copied; the job database and unrelated workspace files are not included. Output is assembled in a hidden staging directory and renamed after successful construction. A failed build may leave an ignored hidden staging directory for diagnosis, never a completed library.

The studio is a snapshot. Rebuild it to include new episodes or revised content.
Use `library-package LIBRARY_DIRECTORY` to make a single verified handoff ZIP
from an existing snapshot. It preserves the saved files and original manifest;
it does not rebuild the studio or refresh news sources. See
[studio handoff](STUDIO_PACKAGES.md).
Verified MP4s include [episode ZIP downloads](EPISODE_PACKAGES.md), generated from
the same selected recording. A dated news download retains its source-review
window and shows a saved-package warning when that window has expired.
Filters and search work locally in the browser. It links to validated MP4s from
the local production workflow. Expired news retains its saved media with a
source-recheck notice on the card and video page. There is no live feed,
server-side authoring API, paid provider call, or publishing action in the studio.
