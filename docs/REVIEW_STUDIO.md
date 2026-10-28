# Review studio

Start with the [creator journey](CREATOR_STUDIO.md) for the stage-based workspace,
guided editor, local draft saving and manual publication tracking. Use **Continue
editing** or **More → Edit a new version** to open the editor. Save a validated
draft on this Mac or download JSON for `script-import`; produce when ready.
Source/claim/demo inputs and source-review dates stay fixed. Existing versions
and recordings are preserved. See [presentation styles](PRESENTATION_STYLES.md).

The episode editor now uses a focused workspace: a shared episode header with a
version switcher and the four steps (Script · Voice & presenter · Produce ·
Review & publish), a desktop scene outline for the Script step, a compact phone
drawer, one scene card at a time and a sticky save bar. Episode details, writing
tools, voice/portrait and three production views have separate destinations;
Review & publish, the watch page, MP4 details and the deck share the same header. See [editing and saving](CREATOR_STUDIO.md#editing-and-saving).
Rebuild the studio to update existing generated editor pages; saved scripts and
media are preserved. This UI change does not require a new installer release.

Where browser storage is available, unfinished edits can be recovered after
reloading the same tab at the same address. Choose **Resume saved draft** or
**Start with original** before editing or downloading again. Recovery restores
only editable wording, version naming, and allowed voice choices for the exact
starting input. Invalid edits retain their validation messages. The saved record
is limited to 128 KiB and does not travel with the studio ZIP or revised JSON.
Closing the tab, changing the address or starting input, or browser restrictions
can prevent recovery. Storage failures leave editing and downloading available;
downloaded JSON is the portable copy to keep.

The optional **Review changes** panel compares only edited sections with the
starting script: title, voices, scene headlines/narration, and companion post.
It shows the text that will be downloaded, including invalid edits that still
need correction. Restore one scene, title, or post independently; restore a
conversation's starting voices together. These controls keep the version name,
other edits, source dates, claims, and project default. The panel stays open
while editing, and restoring a section returns focus to its input. A new version
name alone is not counted as a wording or voice change.

The local studio brings tutorial and news stories into one library (one row per
story, with a drawer of its saved versions), with stage
and type filters, text search, source links, measured narration durations, live
production status and an idea backlog. Its local server supports draft saves,
production, exact-video approval and manually recorded post URLs. It does not
upload or schedule external posts. Portable static libraries remain readable but
need the running local server to save changes or show live publication status.

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

Replace `LIBRARY_DIRECTORY` with the path printed by the build command. The CLI
serves port 4173 and prints local and LAN addresses, allowing a phone on the same
network to use the studio. If an older server is using that port, stop it before
serving the library. The library contains copies of its selected HTML, audio,
captions and timing; playback does not depend on the original run folders and
retains byte-range support for seeking.

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

Source review dates remain visible on news cards. A saved news preview can be inspected after its review expires. Newly assembled cards, players, and workshops show a separate source-review notice with fixed as-of and inclusive valid-through UTC dates. A local date check changes the notice to **Source recheck required** after expiry; playback, downloads, and editing stay available. Without JavaScript, the dates and manual recheck guidance remain readable. The watch page frames the saved review, so the notice appears once there. Invalid dates or a clock before the review date receive a conservative warning. An observed expired state stays expired within that page session, and an expired build remains expired after clock rollback.

The date check runs on load, page return, and once per visible minute. It uses
the device clock and does not fetch sources, verify current facts, or renew the
review. Media readiness still describes the saved media, and production still
checks source age independently. This read-only exception does not apply to new
media jobs, resumed unfinished jobs, or new news preview preparation. Re-reading
and updating editorial sources remains manual. Rebuild an older library to add
the notices; existing saved files and archives remain unchanged.

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
