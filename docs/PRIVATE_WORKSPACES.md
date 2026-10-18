# Private workspaces and registered rendering engines

This is the new account-based studio. It runs separately from the existing local
review library and the earlier shared Firebase bridge. The browser uses Firebase
email/password authentication; the API stores workspace metadata in Firestore
and media in private Cloud Storage. Rendering uses registered Macs or the optional
Cloud Run GPU adapter. Publishing stays manual.

Implementation status and evidence: [implementation log](PRIVATE_WORKSPACE_IMPLEMENTATION.md).
Architecture and future team access: [detailed plan](FIREBASE_AUTH_CLOUD_RENDERING_PLAN.md).

## Try locally with Firebase emulators

Prerequisites: Node 22.13 or later, npm, Java 21 for Firestore/Storage emulators,
and FFmpeg/FFprobe for upload normalization and result validation. On macOS:

```sh
brew install openjdk@21 ffmpeg
npm ci
npm run private:build
```

In one terminal, start the isolated demo services. The `demo-` project cannot
fall back to a live Firebase project:

```sh
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
npm run private:emulators
```

In another terminal:

```sh
export SHORTS_PRIVATE_CONFIG=config/private/emulator.example.json
npm run private:serve
```

Open [the private studio](http://127.0.0.1:5890) and
[Firebase Emulator UI](http://127.0.0.1:4000). The footer labels this as a local
test workspace. It does not store files in a deployed Firebase project.

The example allows `creator@example.test` and `second@example.test`. Create a test
account, then follow the verification link printed by the Auth emulator or shown
in its UI; no real email is sent. Alternatively, the explicit fixture command
creates/verifies disposable accounts and checks API isolation:

```sh
npm run private:test:integration
npm run private:test:library
```

That command's synthetic creator account uses the emulator-only password in
`scripts/private/integration.ts`. Use your own password for a real deployment.
Emulators are development tools, not a secure multiuser deployment. Their data
is temporary unless exported with the Firebase emulator export command. Avoid
using irreplaceable recordings as test fixtures.

## Register the Mac mini and MacBook Pro M5

On **each rendering Mac**, install the project and the desired local engines:

```sh
npm ci
npm run mac:setup
# Required when this Mac should clone a speaker's voice:
npm run shorts -- voice-clone-setup
npm run worker:capabilities
```

A worker needs Node, local model runtimes, FFmpeg, and Apple Command Line Tools
(including Swift for the Keychain helper). See [new Mac setup](NEW_MAC_SETUP.md)
for the system prerequisites. It does not need Java or
Firebase Admin credentials when connecting to a deployed private studio. Both
Mac mini and M5 use their native Apple Silicon acceleration; capabilities depend
on installed runtimes rather than the friendly device name.

Register the Mac mini against the actual studio origin:

```sh
npm run worker:register -- https://YOUR_PRIVATE_STUDIO "Mac mini"
```

Open the printed pairing link while signed in as workspace owner/admin. Confirm
the device and its six-digit code. The CLI stores a scoped device credential in
macOS Keychain, never in the repository. Start the worker:

```sh
npm run worker:start
```

Repeat on the laptop with the name `MacBook Pro M5`. For local emulator testing on
this same Mac, use `http://127.0.0.1:5890` as the origin. A second physical Mac
cannot reach another machine through that machine's `127.0.0.1`; use the deployed
HTTPS studio to test two physical Macs together.

The **Rendering engines** page shows online, busy, draining, stale/offline, or
revoked devices; installed voice/video capabilities; last-seen time; and current
job. Each Mac has one heavy-inference slot, shared with its local studio through
the existing model lock. Two Macs can process independent jobs simultaneously.

Workers connect outbound over HTTPS. No inbound ports, SSH credentials, developer
Firebase CLI token, or project service-account key is needed on a rendering Mac.
The process fetches only assigned inputs into a separate private attempt directory
and deletes scratch data afterward. It never synchronizes the Mac's existing
photos, drafts, `.state/voice-profiles`, or generated library.

Owner/admin controls can rename, pause/drain, resume, or revoke a device. CLI:

```sh
npm run worker:status
npm run worker:unregister
```

Unregistration revokes the server-side device before removing its local Keychain
credential. If the server is unreachable, use the studio's Revoke control when it
is available. A revoked/expired credential needs a new registration. Credentials
last 30 days and can be renewed before expiry; restart the worker periodically
until unattended renewal is enabled.

Keep the Mac mini running for queued work. Laptop sleep/disconnection causes
heartbeat/lease expiry and prevents late results from being accepted. Workers do
not alter power settings. Opt-in startup service/LaunchAgent management remains
a follow-up; the worker currently runs in the terminal.

## Save a voice and produce from another device

1. Sign in and create a script from a source-backed starting template.
2. In **My voices**, select **Add a voice**. Record or upload in step 1, then
   choose **Next: Review & save**. In step 2, name the voice, check its exact
   transcript, and confirm consent and trusted Macs. Save the sample.
3. Select a rendering destination in the top toolbar and generate an audition.
   Stay in **My voices**: the selected voice shows its queued/running state and
   playback when ready. Listen through the audition, then choose **Accept this
   voice**. The status changes to **Ready to produce** for that destination.
4. Open the script. Each presenter has independent voice and photo controls.
   Choose the saved voice, upload a portrait if wanted, and save the script.
5. Choose **Next available compatible Mac**, or pin a particular device, and
   produce. The job continues when the browser closes.
6. Return from any signed-in device to watch/download the completed result.

### Guided reference recordings

In **My voices → Add a voice → 1 · Record**, choose a passage under
**Read one short passage**:

- **Warm conversation** (recommended): a friendly explanation and a question.
- **Professional explanation**: calm, clear presentation delivery.
- **SAP & developer walkthrough**: technical language with spaced **S A P** and **A P I** letters.
- **News & announcements**: a concise update with questions and emphasis.
- **Casual story**: everyday words and a light, expressive ending.

Click **Use this text as transcript**, then **Record sample**, read the displayed
passage, and stop when finished. The recorder stops automatically at 29 seconds,
leaving room for encoder padding within the 30-second reference limit. Listen
back before saving. If you change a word or skip a sentence, edit the transcript
to match exactly or record again. Browsing another passage does not replace your
transcript; clicking the transcript button does. The passage, transcript, upload,
and save controls are locked while the microphone is recording.

Aim for 10–20 seconds at your natural pace, in the delivery style you want for the
narration. A quiet room, a steady microphone distance, and one speaker help. There
is no need to read every option or exaggerate your accent. These original passages
provide convenient variety, not a guarantee of optimal phonetic coverage or a
replacement for auditioning the generated voice. Qwen conditions cloning on the
reference audio **and its matching text**; see the
[official voice-cloning documentation](https://github.com/QwenLM/Qwen3-TTS#voice-clone).

The private studio preserves complete 3–30-second samples, including readings
longer than 15 seconds. It rejects overlong uploads instead of silently shortening
them. Browser WebM recordings are decoded to determine their actual duration even
when their container has no duration header. No transcription service is used.

The offline script workshop offers the same five passages under **My voice**.
New microphone recordings use their complete audio unless you edit the excerpt
controls. Uploaded recordings still have explicit excerpt controls (up to two
minutes of source audio); the transcript must match only the selected excerpt.
Rebuild saved local workshop pages to pick up the new reading choices. Existing
saved voice samples and accepted auditions do not need to be recreated.

Heart remains the stock default. Local-only profiles are not silently uploaded
or selected. Enroll an explicit workspace copy if you want cross-device access.
Approval is bound to the sample revision and portable runtime identity. Another
Mac with the same compatible runtime can use it; a different runtime or CUDA
engine needs another audition. A synthetic stock-reference fixture is not your
personal voice, and the selected identity appears in script controls/history.

The episode editor has separate **Script**, **Voice & portrait**, and **Review &
produce** views. Scene sections expand individually. Saving remains available
without approving a voice; production provides a direct **Review voice audition**
action for any personal voice that still needs approval. Stock voices do not need
this enrollment step.

If you see “Listen to and accept an audition for qwen-mlx first” in an older
build, your recording can still be saved correctly. Open **My voices**, select
that voice, choose **Listen to audition**, listen to the end, and select **Accept
this voice**. A completed audition has not been accepted merely because its
status is SUCCEEDED. You do not need to record the sample again. Approval is
specific to the sample and engine runtime, so a changed runtime needs another
audition. The app checks current approval records, not just old accepted-job
labels. Deleted voices are hidden from the normal selector; their history stays
available.

Generation history is ordered by submission time, newest first. Completed entries
are collapsed; expand one to watch/download or inspect details. It shows work
stage, engine/device, measured generation time, media duration, queue wait, and
time until ready. Changing a script does not change an already produced video.
Retries use the frozen revision and selected engine; changed scripts require a
new production. Identical active submissions are deduplicated.

### Narration timing review

A completed voice recording can still pause production at the narration check.
The current episode limits are **45–60 seconds total** and an opening clip of
**at most 3 seconds**. A 51-second recording with a 3.4-second opening misses only
the opening limit. This is a script-timing check; it does not mean the voice
sample or its approval failed. The added scene-transition pause is not included
in the opening's `speechSeconds` measurement; model-generated pauses within the
recorded clip are included.

History labels these attempts **Needs script edit**, shows opening and total
measurements separately, and offers **Edit opening** or **Edit narration** instead
of a retry button. The action opens the current saved draft and adds guidance next
to the spoken first line without rewriting it. If the draft has changed since
the failed attempt, the note identifies that distinction. Revise the narration,
save, and produce its new revision. Plain retry resubmits the earlier saved
revision and does not shorten the words. Normal retries remain available for
engine failures and cancellations.

Private media is fetched through the authenticated API into temporary browser
blobs, including playback/seeking and downloads. There are no permanent public
Firebase download tokens. Signing out clears private UI/media state. This pilot
uses a bounded proxy rather than issuing signed playback URLs.

## Manage presenter photos and retired engines

**My photos** is the reusable private portrait library. Upload and name a portrait,
rename it, or archive/restore it. Photos uploaded from the episode editor also
appear here. Archiving hides a photo from new selections while preserving the
file, voice links, existing scripts and produced videos. Restoring brings it back.

Under **My voices**, expand **Photos for this voice**. Link up to 20 library photos
to a personal voice and select its default. Save the links. This changes presentation
preferences only; the voice sample revision and accepted audio audition remain valid.
Concurrent link edits receive a revision conflict instead of silently overwriting.

In an episode, each presenter can choose a saved photo, upload another, or use
**Use voice's default photo**. Linked photos appear first in the selector. Defaults
are an explicit shortcut: changing a voice's photos does not alter saved episodes.
Stock narrators can also use any saved photo through the episode selector.

After revoking an engine and allowing its active attempt to stop, use **Archive
engine**. Retired registrations are kept under the collapsed **Archived engines**
section so previous productions retain their device names. They are excluded from
render destinations and trusted-device choices. Re-register a Mac to reconnect it.
Render/voice smoke tests unregister and archive their temporary workers in `finally`
blocks, including failures. Blank rules-test images are archived automatically.

## Explicit private Firebase deployment

The supplied container recipes use multi-stage builds and compiled JavaScript;
the final images install production Node dependencies only. The API and GPU
worker run as non-root users. The compiled worker path was tested on this Mac;
the Docker images still require their staging build verification.

No live project was changed during implementation. Use a separate staging project
with billing/region/retention approved before uploading real samples. Do not
reuse the old public bridge deployment commands or rules for this studio.

1. Create/select the intended private Firebase project. Enable email/password
   Auth, configure password policy and email enumeration protection, and configure
   authorized domains plus verification/reset email templates.
2. Choose Firestore/Storage locations deliberately. Confirm the Storage billing
   plan and private bucket IAM/public-access prevention. Use separate development,
   staging and production configurations.
3. Copy `config/private/production.example.json` into an ignored location such as
   `.state/private-config.json`; fill in the actual web config, HTTPS origin,
   and invited email list. Do not commit private operator configuration.
4. Deploy `infra/private/firestore.rules` and `infra/private/storage.rules` through
   `firebase.private.json`, explicitly naming the approved project. Both deny
   direct browser access. The API authenticates/authorizes privileged server calls.
5. Prepare a reviewed, committed container context:

   ```sh
   npm run private:runtime-package
   # Use the printed context directory, not the working tree containing personal files.
   docker build --platform linux/amd64 -f PRINTED_CONTEXT/infra/private/Dockerfile.api \
     -t YOUR_REGISTRY/private-api:REVIEWED_COMMIT PRINTED_CONTEXT
   ```

6. Run the API container on Cloud Run with the private configuration mounted via
   Secret Manager and `SHORTS_PRIVATE_CONFIG` pointing to it. Attach a dedicated
   API service account with the needed Firestore and private-bucket permissions,
   plus `firebaseauth.users.get` for revoked-token and account-status checks
   (a narrowly scoped custom role or Firebase Authentication Viewer). Avoid
   project Owner/Editor. Limit instances/concurrency and set budgets.
7. The API can serve the app shell at the same HTTPS origin. If adding Firebase
   Hosting in front, configure `/v1/**` rewrites to this service, matching region
   and origin, plus CSP/no-store headers. The supplied private Hosting folder is
   an app shell; it contains no workspace media or scripts.
8. Run the two-account/two-device staging checks before admitting real samples.
   An existing shared deployment needs explicit ownership migration and revocation
   of old public/tokenized copies; copying into a private bucket is insufficient.

The Firebase API key in browser configuration is public app configuration. API
service credentials are workload identities and must never be shipped to the
browser or paired Macs. A consumer Google/Gemini subscription does not establish
Firebase/Google Cloud billing coverage.

## Optional Google Cloud GPU provider

The source includes a bounded Cloud Run Jobs dispatcher, job-scoped worker
credentials, CUDA Qwen/aligner adapters, and GPU container recipe. **It has not
been benchmarked on a real NVIDIA GPU or built locally with Docker**; Docker and
an NVIDIA GPU are unavailable on this Mac. No paid cloud execution was started.
Keep the provider disabled until its real staging gate passes.

The upstream TTS and ASR distributions pin incompatible Transformers versions
(4.57.3 and 4.57.6), so the container deliberately uses separate Python environments.
Linux/Python 3.12 dependencies were resolved independently with hashes into
`config/qwen-cuda.lock` and `config/qwen-cuda-align.lock`. Model revisions are pinned
in `config/qwen-cuda.json`. Image setup records model checksums and runtime identity.
Inference is offline after staging inputs.

Prepare the committed context above, then build `infra/private/Dockerfile.gpu` for
`linux/amd64`. This downloads public model weights during image construction.
Deploy by immutable image digest to a dedicated L4 job: one task, parallelism one,
4 vCPU, at least 16 GiB RAM, no zonal redundancy, 900-second timeout, native retries
zero. The worker service account needs no Firestore/Storage administration; it
uses a short-lived capability restricted to its assigned job.

Before enabling the provider, run an approved-budget synthetic audition and full
45–60-second Qwen/illustrated episode. Verify speech, alignment, video integrity,
startup time, resource usage and actual cost. Accept personal voices separately
on this runtime. Cloud stock/realistic photo combinations currently fail preflight;
use a registered Mac for those. Ditto CUDA/auxiliary-model rights remain a later gate.

After verification, add an explicit operator configuration:

```json
{
  "cloud": {
    "enabled": false,
    "jobName": "projects/PRIVATE_PROJECT/locations/APPROVED_REGION/jobs/APPROVED_JOB",
    "runtimeDigest": "COPY_THE_VERIFIED_IMAGE_COMPATIBILITY_DIGEST",
    "budgetCents": 0,
    "attemptCents": 50
  }
}
```

The zero budget and disabled flag prevent accidental activation. Set a reviewed
allocation and runtime digest only after approval. The global application permit
allows one cloud execution at a time across all workspaces, including separate
Cloud Run executions. A launch whose response is ambiguous is held for operator
reconciliation and never automatically repeated. Dispatch uses Jobs API retries
disabled. Completion checks the actual execution, not just an operation acknowledgment.

Run `npm run private:dispatch` under a dedicated dispatcher identity with access
only to approved Jobs invocation/override and execution status, plus controller
metadata and `firebaseauth.users.get` for account revocation checks. Invoke it repeatedly through an approved scheduler/CPU controller to
launch queued work and reconcile completion. No scheduler is created automatically.
The initial controller uses Firestore's durable outbox directly instead of adding
Cloud Tasks; a task wakeup can be added without changing job authority.

Compute allocation is conservative: each completed/failed execution consumes its
reserved application allocation. This is not an invoice or a hard Cloud Billing
cap. Storage, transfer, registry, builds, controller and other services are
separate charges. Budget alerts do not stop spending. Cloud mode never activates
as an automatic fallback from Mac mode.

## Recovery, deletion, and pilot bounds

- Offline Macs leave jobs waiting. Revoke/cancel prevents further input access or
  publication; a running process stops when lease renewal fails.
- **Check interrupted jobs** fences expired attempts. Retry uses a new attempt;
  a stale worker cannot finalize it. Model work is killed as a process group
  before cleanup/release when its lease is lost.
- Local diagnostic failures are bounded/redacted in
  `.state/registered-worker/last-error.log`; samples and raw enrollment transcripts
  are not sent to cloud logs. Scratch directories are removed after attempts.
- Deleting a voice removes its reference/audio auditions, approvals and enrollment
  transcripts from revision documents and job snapshots; it blocks pending use.
  Existing completed episode videos stay available, as described by the UI.
- Initial bounds: 30 MiB per audio/output transfer, 4 MB portrait uploads, 24 MP
  decoded portraits, 3–30-second reference range, 10 pending jobs, 200 scripts,
  500 history jobs, and 500 files/512 MiB storage per workspace. These are explicit
  pilot limits to avoid silent query truncation. General archive/pagination and
  self-service account/workspace deletion need completion before wider rollout.
- Team invitation/role-management UI, managed device auto-start, fully automatic
  expired-job cleanup, larger resumable transfers and realistic CUDA portraits
  remain follow-ups. Data authorization already uses tenant IDs and membership
  roles; the current UI creates personal workspaces.

## Verification commands

```sh
npm run check
npm run build
npm run private:build
# With the isolated emulators + API running:
npm run private:test:integration
npm run private:test:library
# Explicit real-model integration tests; synthetic references only:
npm run private:test:render
npm run private:test:voice
# Optional longer checks, still restricted to the loopback demo project:
SHORTS_TEST_COMPILED=1 npm run private:test:render
SHORTS_TEST_VOICE_EPISODE=1 npm run private:test:voice
```

Ordinary unit tests use in-memory stores and fake cloud launchers; they never
start paid GPU work. Run the full checks from a source-only checkout if personal
untracked scripts are present. The supplied smoke scripts use only local demo
services and clearly labeled synthetic content. Do not point them at production.

Production Node dependency audit: `npm audit --omit=dev` passed with zero
vulnerabilities during implementation. Development-only Firebase CLI dependencies
still have upstream advisories; do not expose the Emulator UI to the network or
include development tools in production images. See the evidence log for scope.
