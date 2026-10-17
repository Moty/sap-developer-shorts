# Creator studio: ideas to publication

The workspace opens on the work list. Every row names the topic and the exact
version, shows its stage, and offers one primary next action. Search, type,
stage and **Needs attention** filters work together. Desktop uses compact rows;
phones use stacked cards and a two-row stage selector. Nothing starts playing
or rendering merely because a stage or version is selected.

| Stage | What it means | Next action |
| --- | --- | --- |
| Ideas | A backlog topic without a prepared script. Research is still required. | Open the idea and its source links. |
| Editing | A prepared script without a matching, verified MP4. It may have a storyboard or recorded narration. | Continue editing, or produce the saved script from More. |
| Producing | The local server has an active job for this version. | View its production progress. |
| To review | A verified MP4 exists; no approval is saved for that exact output. | Review video. |
| To publish | The video has been explicitly approved. | Download, post on your channel, and record its live URL. |
| Published | A person has recorded a post URL for the approved video. | View the publication record or open the post. |

**Published is a manual record, not platform verification.** The app does not
upload, schedule posts, or check whether a URL is still live. Existing rendered
videos start in To review. Existing exports are never inferred to be published.
Needs attention is separate from the stage: timing issues, expired news source
reviews and interrupted/failed production remain visible beside the next action.

## Editing and saving

1. **Script:** edit the title, version name, scene headlines and narration. The
   scene outline provides shortcuts on desktop. Sources stay in a disclosure.
2. **Voice & portrait:** choose local voices and a presenter. Mouth calibration
   and pronunciation tools are optional disclosures. The existing local portrait
   renderer, face calibration, auditions and recovery behavior are preserved.
3. **Review & produce:** edit the companion post, check validation and compare
   changes with the starting script, then produce the video.

The fixed action bar offers **Save draft** in every step. Saving validates the
script, writes a new presentation JSON under `content/presentations/`, and
refreshes the served library without starting narration or rendering. An unchanged
second save reuses that snapshot. Further edits create the next named revision;
previous versions and their recordings remain intact. The new default revision
names avoid growing chains of `-edit` suffixes. You can choose a descriptive name.

Producing a just-saved draft submits its existing selector, avoiding a duplicate
import. Producing unsaved changes saves that revision first. If another job is
running, the request is rejected before importing another revision. Local
production continues when navigating away; the workspace polls its status.
After completion it reloads the refreshed library. An unfinished saved production
report with no active worker is shown as interrupted, not as a running job.

Invalid unfinished edits remain recoverable in the same browser tab, subject to
browser storage availability. **Save draft** requires a valid script. **Download
script** remains available as the portable JSON workflow. Closing a tab can lose
unsaved recovery data. If the library rebuild fails after a successful save, the
editor explicitly reports that the draft was saved but the workspace refresh is
pending; the saved file remains available for CLI production.

## Review and publication

Each produced version has `episodes/SELECTOR/publish.html` with its video, final
review confirmation, MP4/package downloads, companion text, source links and
publication record. Approve only after watching the whole short and checking
speech, face movement, captions and factual accuracy. Copy the post text, publish
on your chosen platform, then enter the live post URL. **Return to review / clear
publication record** removes the local approval and publication record; it does
not remove an external post.

`GET /api/workflow` supplies live state; `POST /api/workflow` handles `approve`,
`publish` and `reopen`. State is stored atomically beneath
`ARTIFACT_ROOT/.studio-workflow/` (normally `artifacts/.studio-workflow/`). Keep
that directory when moving the working studio to another Mac. Records bind the
selector, editorial input hash, render key and actual MP4 digest. Approval checks
the current script, source-review window and MP4 bytes. A new render or changed
script cannot inherit approval. Recording publication requires prior approval
and an HTTP(S) URL without embedded credentials. Review writes reject requests
from a different browser origin. Writes are serialized within the local server.

Static library HTML and ZIPs remain portable snapshots; live review/publication
records are deliberately outside their hashed media inventory. A static copy
cannot claim fresh publication status: it displays the connection limitation.
The original video bytes, captions and packages are unchanged by review actions.

## Hybrid Cloud Studio (Firebase)

In addition to running locally with `npm run shorts -- serve`, the exact same responsive Studio is deployable to **Google Firebase Hosting**, backed by Cloud Firestore and Cloud Storage, with local Apple Silicon Mac render workers:
* **Live Studio**: Viewable and editable on mobile, iPad, or desktop via Firebase Hosting.
* **Local Mac Render Daemon**: `npm run firebase:worker` claims cloud jobs, renders neural Kokoro TTS and Ditto MPS talking-heads on your Mac, and streams results back to Firebase in real time.
* **Dual-Mode Operation**: The same UI operates seamlessly offline on localhost or online via Firebase through a zero-dependency client bridge.
* See [Hybrid Firebase Studio & Local Mac Worker](FIREBASE_HYBRID_STUDIO.md) for architecture, bootstrap, and CLI commands.

## Validation and audit

The original audit found large duplicate-title cards, workflow status buried
below technical details, no publication record, and an editor that combined save
with production. The redesigned screens were inspected at 1440 × 1000 and
390 × 844, with additional 320px overflow checks. Local screenshots are under
`artifacts/reviews/studio-journey-2026-10-17/` (generated artifacts, not Git assets).

Automated workflow tests cover separate lifecycle states, restart persistence,
approval before publication, unsafe URLs, stale scripts/render identities,
changed MP4 bytes, expired source reviews and origin checks. Browser checks
exercise stage/search filters, empty states, all editor steps, two successive
draft saves, approval, publication, reload and return to review in isolated
state. QA draft files are removed after verification. No real episode is marked
published and no external post is created by this work. This is responsive UI
verification, not a comprehensive assistive-technology audit or a new assessment
of portrait realism.
