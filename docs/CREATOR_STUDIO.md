# Creator studio: ideas to publication

Local Apple Silicon studios also offer **Voice & presenter → My voice** for
recording/uploading a sample, auditioning Qwen narration and assigning an accepted
profile to each speaker. The default stays Heart. See [personal voice setup and
privacy](QWEN_VOICES.md). This feature is local-only; hosted studios use stock voices.

The workspace opens on the work list. **My shorts** shows one row per story (one
episode id such as CAP-01), however many versions you saved. A row shows the
opening frame (or a placeholder for drafts), the latest title, the id, type,
length (measured or planned), the story's stage, its last update and one primary
next action. **N versions ▾** opens a drawer listing every saved version, newest
first, as v1…vN using stable saved-version ordinals; the real selector
(for example `NEWS-01@my-edit`) stays visible beside each label, with its own
stage, length, voice, last update, Edit/Review action, Presentation link and
More menu. Drawers start collapsed; without JavaScript they stay open.

The row's stage and primary action come from the story's **representative
version**: the most advanced actionable state wins in this order — Producing
(active job) > To review > To publish > Editing > Published. Ties go to the most
newest saved version ordinal. With a stage filter, the action comes from a version in that stage. So a story with an unreviewed video offers **Review
video** even if you are also editing a newer draft; open the drawer to continue
the draft.

A **Needs you** strip (up to three cards, hidden when empty) comes from live
status: stories waiting for review (oldest first), the latest version of a story
whose production failed or was interrupted (Ready to retry), news whose source
review has expired or ends within three days, and the number of official SAP
stories that have no short yet. The stage row below shows how many stories have at
least one version in each stage; **All** counts stories. Search, type, stage and
the **Needs attention** chip work on stories: a story matches when any version
does, and searching opens the drawers of matching stories and highlights the
matching versions. Phones scroll the stage row and the needs-you cards sideways.
Nothing starts playing or rendering merely because a stage or version is selected.

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

Every page of one version shares the same header and four steps:
**1 Script · 2 Voice & presenter · 3 Produce · 4 Review & publish**. The header
returns to **Shorts**, shows the story thumbnail, title, episode ID and a version
switcher (v1 = oldest; each entry shows its stage and opens that version's
editor or Review & publish page; it is a plain list of links without JavaScript).
Steps 1–3 are the editor panes; step 4 opens `publish.html` once this version has
a verified MP4 and is otherwise shown locked with "Produce the video first". The
watch page, MP4 details page and deck preview use the same header with an
**Open Review & publish** or **Edit script** action. On phones the stepper shows
numbered dots with the current step's label, and the step's main action sits in a
bottom bar.

1. **Script:** choose a scene in the left outline, then edit its headline and
   narration in a focused card. **Previous / Next scene** moves through the story
   without showing seven stacked forms. **Episode details** holds the title and
   version name; **Writing & visuals** opens the writing/presentation assistant. It shows a status
   chip for the saved engine (model · provider · Free or May incur cost ·
   Connected) with a **Change in Settings ↗** link; engine, budgets and API key
   are configured once in the workspace **Settings** (`review.html#settings`,
   the older `#writing` link still works).
   On desktop, an on-screen text cue previews the current headline and narration.
   It is a text preview, not the rendered deck; **Open saved deck** shows that deck.
2. **Voice & presenter:** choose local voices and a presenter. Mouth calibration
   and pronunciation tools are optional disclosures. The existing local portrait
   renderer, face calibration, auditions and recovery behavior are preserved.
3. **Produce:** one checklist covers Script, Voice, Presenter, Sources, Companion
   post and optional AI review. Readiness comes from the existing draft/voice
   validation. Presenter runtime and alignment are checked during production;
   the checklist does not claim a render has already passed. Open **Companion
   post** or **Optional AI content review** only when needed. AI review remains
   optional, with the selected provider and a visible Hyperspace cost notice.

The sticky header offers **Saved deck**, **Save draft**, and one status line.
**Next: Voice & presenter** and **Next: Produce** navigate the first two steps.
In Produce, **Save & produce** invokes the same explicit production action as
its checklist sidebar; the phone bottom bar mirrors that action and its blocked
state. Earlier steps are not marked complete merely because you visited them.
Saved portraits appear by a readable name (for example **Moty headshot 2026**, or
**Uploaded photo 1** for generated file names); the stored image is unchanged. The left outline (Episode details, Scenes, Writing &
visuals) belongs to step 1 and is shown on desktop while editing the script;
on phones, **Episode sections** opens it as a drawer. Choosing an entry closes it;
Escape dismisses it. **Sources** opens a separate evidence drawer with the saved
source dates and claims. Navigation changes visibility only: fields, personal
voice selections, portrait canvases, auditions and unsaved edits stay mounted.
Scene/review links are addressable by fragment. Invalid saves reveal production
validation instead of leaving the problem in a hidden panel.

Saving validates the
script, writes a new presentation JSON under `content/presentations/`, and
refreshes the served library without starting narration or rendering. An unchanged
second save reuses that snapshot. Further edits create the next named revision;
previous versions and their recordings remain intact. The new default revision
names avoid growing chains of `-edit` suffixes. You can choose a descriptive name.

Producing a just-saved draft submits its existing selector, avoiding a duplicate
import. Producing unsaved changes saves that revision first. If another job is
running, the request is rejected before importing another revision. Local
production continues when navigating away; the workspace polls its status.
The Produce pane reveals the active stages after an explicit start, records the
exact accepted job in this tab and reconnects after a reload, including after the
saved draft acquires a new suggested version name. It never automatically retries
a job. An unfinished saved receipt with no active worker is shown as interrupted.

The timing range uses comparable fresh generation history, excluding reused
speech/video. It states its sample count and pipeline basis; hardware, script
length and caches can differ. With no comparable history it offers no ETA.
Elapsed time and completed stage times come from the actual job. **Review &
publish** appears only after the server has refreshed the workspace; a failed
refresh reports the saved result without offering an unavailable editor/video.

Invalid unfinished edits remain recoverable in the same browser tab, subject to
browser storage availability. **Save draft** requires a valid script. **Download
script** remains available as the portable JSON workflow. Closing a tab can lose
unsaved recovery data. If the library rebuild fails after a successful save, the
editor explicitly reports that the draft was saved but the workspace refresh is
pending; the saved file remains available for CLI production.


## Starting a short and managing presenters

**New short** opens a source/format/tone/planned-length/narrator sheet. Choose a
scanned official SAP story or paste its official article URL. Creating fetches
complete source excerpts and saves an editable seven-scene draft; it does not
make an LLM request. Format/tone are delivery settings and do not rewrite facts
or narration. A conversation assigns complete scenes to two distinct installed
stock voices. Use the writing assistant to rewrite and review the actual words.
**Default / decide later** permits a solo draft before voices are installed;
select an accepted personal voice in the editor when ready. Tutorials still
start from prepared scripts in My shorts. A saved draft whose workspace refresh
fails is identified by ID and cannot be accidentally submitted again in that sheet.

**Formats** pairs format descriptions with prepared examples. **Voices &
presenters** keeps personal styles, stock samples and saved photos together.
**Add a voice style** opens the existing record/upload, transcript and consent
controls in two steps. Saving a sample still requires a generated audition,
your listening and acceptance before it is offered for episodes. Search/filter
personal recordings by name or style; cards play saved recordings or auditions.
Photos show friendly names and links to a script for alignment. Alignment is
saved per script, so a gallery label is not a global guarantee for every use.

The desktop launcher now separates core studio, writing, voice, portrait and
worker readiness. Private-studio section names match the creator workflow; its
existing sign-in, workspace isolation and render-engine controls are unchanged.

## Review and publication

Each produced version has `episodes/SELECTOR/publish.html`, step 4 of the
episode workspace. The player shows chapter markers per scene when measured
timing is available; **Transcript**, **Sources** (with the dated source-review
notice) and **Details** (generation time as a stacked bar) sit below it. The
final check has four boxes — speech, face and lip movement, captions, and facts
against the sources including the review-valid-through date — and **Approve
video** stays disabled until all four are ticked. Approval still sends the same
single confirmation to the workflow API. **Download & post** (MP4/package
downloads, a social-post preview with character count and **Copy post text**)
and **Record where it’s live** stay locked until the video is approved; without
the running studio (a static copy) nothing is locked and the page explains that
review status is unavailable. **Needs changes · edit as new version** opens the
editor. Copy the post text, publish on your chosen platform, then enter the live
post URL. **Return to review / clear
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
* **Legacy hosted studio**: Existing public exports remain viewable on mobile, iPad, or desktop; anonymous editing and production writes are retired.
* **Private workspace**: Account-based editing, portrait upload, production, and review use the authenticated API and registered-worker flow.
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


## Run voice and setup actions from the local UI

In **Voice library**, use **Generate voice sample** to save and play the comparison
passage, **Install voice** for another Kokoro profile, or **Set as default narrator**
to select an installed voice. Generating or installing a sample keeps the current
default. Prepared scripts retain their explicit speaker choices. Terminal
alternatives are kept in collapsed details.

The script editor has setup controls for a missing selected stock voice, personal
voice tools (Qwen), automatic face alignment, and realistic portrait rendering.
Personal voice setup appears in My voice; portrait tools are grouped under
**Local portrait tools**. Setup downloads the existing pinned model/runtime files
and may take several minutes. System prerequisites such as uv and FFmpeg still
need to be installed on the Mac. These controls do not install or register a
different physical Mac; use the private workspace's engine registration flow
for remote rendering devices.

Actions show progress and errors, finish in the background while the user
navigates, and retain up to 20 results until the server restarts. Repeated clicks
on the same active action reuse its job. A different action or production waits
for it to finish. Model execution shares the normal lock with render workers.
Generated samples remain saved independently of the in-memory action history.
Voice actions refresh the served library; the page offers **Refresh voice library**
when needed. Setup in an editor preserves the draft fields.

The API accepts only named actions and supported voice IDs. It requires the
existing loopback-only session cookie and same-origin JSON. It never accepts a
terminal command from the page. Exported/static copies keep these buttons
disabled, with a message to open the running localhost studio. The account-based
workspace continues to manage registered workers separately.

Validated October 25, 2026: 274 automated tests, five live CAP checks, typecheck,
content validation and both builds passed in a source-only checkout. Browser QA
generated and played a real 10.35-second Heart sample, preserved the default
settings, checked install/default availability, and verified the editor's Qwen,
face and portrait setup controls. Downloads for other model setups were not
repeated during QA. Upstream repository lint already fails on news formatting
and code diagnostics; the baseline check and change check are recorded under
`.state/private-tests/local-actions-*-lint.log`. Personal photos and presentation
files were preserved and excluded from the commit.


## Reusable personal delivery recordings

**Voice library → My voice styles** now shares the episode editor's recorder,
upload, excerpt, transcript, consent and audition controls. **Add a voice style**
uses a two-step record/review form, with the speaker name retained for the next
take. Professional, calm, comic, upbeat, sad/reflective, conversational, casual
and news deliveries have reading guidance. Saved recordings can be filtered by
style and auditioned independently before becoming available in episode editors.
See [personal voice styles](VOICE_OPTIONS.md#personal-voice-styles-in-the-library).

The library does not require an open episode and does not assign an episode
speaker when a recording is accepted. Existing profiles keep their original
audio, revisions and approvals; optional style labels live in a separate sidecar.
The recorder releases the microphone on navigation and cancels a pending capture
request if the page changes before permission resolves.

Validated October 25, 2026: 282 automated tests passed with no skips, plus five
live CAP checks, typecheck, content validation and both builds in a source-only
checkout. Isolated HTTP tests saved separate professional, calm and upbeat
synthetic samples and checked consent, invalid styles and older enrollment
requests. Browser QA verified the style passages, saved-recording filters and
shared episode editor, including its portrait selector. All four existing local
profiles retained their approvals, the Qwen runtime remained ready, and the
narrator default stayed unchanged. No personal sample was recorded, cloned or
accepted during QA; delivery quality still requires listening to each audition.
Changed-file lint passed. Repository lint retains eight pre-existing errors in
unmodified files; validation logs and screenshots are saved locally under
`.state/private-tests/voice-style-*`.

## Browse a growing workspace

A **New short** button tops the sidebar (top right of the header strip on phones). For now it
opens Ideas → Official stories and focuses the article URL field.

The sidebar switches between **My shorts**, **Ideas**, **Delivery styles**, and
**Voice library**. Only the selected section is shown. Existing comparison,
editor return and voice-library links still open their matching section; browser
Back and Forward follow section navigation. Static copies keep all content
readable when JavaScript is disabled.

My shorts shows ten stories per page by default. Search examines every saved
version of every story, including narration, rather than only the current page.
Combine it with the stage, tutorial/news and attention filters. Sort by **Recently
updated**, **Oldest updated**, **Title A–Z**, or **Episode ID**. A story's update
time is its newest version's: the later of the local script file modification and
its recorded preview time; after a fresh clone, script dates reflect the
checkout. Choose 10, 20 or 40 per page, use Previous/Next, or jump directly to a
page at either end of the list. Result counts read like “9 stories · 62
versions” and distinguish filtered matches from the complete library.

Ideas separates official stories, staged drafts, the news backlog and tutorial
ideas. Story cards show a five-step **fit** meter (High, Good or Low; the numeric
score is in the tooltip). A story that already has a saved short or staged draft
shows **Already a short · NEWS-06 · 8 versions** with an **Open** link and a
secondary **New angle** button; only stories without one get **Start short**. Each collection has its own search, sort and page controls. New drafts
open in the staged view even if its previous search would hide them. Story
refreshes update the existing collection. Both the saved stock samples and the
complete stock voice catalog are paged and searchable; personal recordings have
name/style search alongside their delivery-style filter.

Search, sorting, page size and page number are remembered separately for each
collection in this browser tab's session storage. Shorts also remember their
stage/type/attention filters and which version drawers you opened, so returning
from a video review lands on the same view. Filtering or changing sort/page size returns to the
first page; live workflow polling keeps the current page, clamping it if the
result list becomes shorter. Storage being unavailable does not prevent browsing.
Switching sections pauses their media and stops any active microphone recording,
keeping a completed take available for review without saving or accepting it.

Validated October 25, 2026: all 289 automated tests, five live CAP checks,
typecheck, content validation and both builds passed in a source-only checkout.
Browser QA exercised the 47-entry local library, both page controls, a direct
last-page jump, title sorting, full-list search, empty-state reset, return from a
video review with filters preserved, separate idea views and personal/stock
voice searches. The 28-entry stock catalog and tutorial backlog each show six
items per page. Single-page lists hide unnecessary pagination. No browser
console errors were observed. Microphone cancellation and preserved-take behavior
use synthetic automated tests; QA did not capture a real microphone or trigger
production, installation, approval or publication. Changed-file lint passes;
eight pre-existing repository lint errors remain in unrelated files. Local
evidence is under `.state/private-tests/library-browser-*`.

## Explore the generated presentation

Each saved short has a **Presentation** link in its workspace row. This opens the
episode header around a dark 9:16 interactive deck generated from the saved script and its available
evidence. Play the narration, inspect code lines, switch captured results to a
stock chart, explore a captured-row filter, or expand news scope and sources.
Focus view enlarges the canvas. New MP4 exports use the refreshed motion design
and include the interactive deck in their portable package. See
[Interactive portrait presentations](PRESENTATIONS.md) for the renderer choice,
data boundaries, local setup and export behavior.

### Stable version history

Version numbers are assigned once in `ARTIFACT_ROOT/.studio-versions/order.sqlite`;
rendering or touching an older file updates activity without changing its number
or superseding a newer review. Removed versions leave gaps. Library manifests
carry the ledger, so keeping a recent library snapshot can restore a lost local
index. Keep the ledger or a recent snapshot when moving a working studio between
Macs. The first migration preserves the existing display order; it cannot infer
historical creation dates that were never recorded. Stage filters choose the primary action from a matching version without expanding
long drawers; searching still opens and highlights matching versions.


The [creative workflow enhancements](CREATIVE_WORKFLOW_ENHANCEMENTS.md) add saved story briefs, visual compositions, exact-output external review, verified stock-scene reuse, production presets, and story organization/version comparison to the local source studio. See that guide for controls, storage and current limits.
