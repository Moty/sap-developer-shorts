# SAP Developer Shorts — repository review and implementation plan

Reviewed October 14, 2026. Repository: [Moty/sap-developer-shorts](https://github.com/Moty/sap-developer-shorts). Reviewed commit: `b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461`.

Local checkout: `/Users/I851396/__Code/sap-developer-shorts`.

The requested production style is an **AI presenter or avatar**. This plan assumes English videos for your personal LinkedIn profile, starting with CAP examples that can run locally. Language, budget, avatar identity, hosting and posting times remain configurable decisions.

## Assessment

The repository is an editorial blueprint with useful content pillars, a 30-topic backlog, four prompt roles, a script template and two example scripts. It is an early foundation for the series. It currently has **no executable application, dependency manifest, demo projects, video renderer, LinkedIn integration, persistent job state, scheduler or automated checks**. Its four agents are prompt definitions; no software currently connects or runs them.

The next useful milestone is one complete, reviewed CAP episode: verified code, an avatar, readable demonstration, accurate captions and LinkedIn copy. Establish publishing access alongside that work, then automate the proven workflow.

## Review findings, in priority order

### 1. P1 — The CAP example cannot produce the demonstrated API as written

The [CAP sample](https://github.com/Moty/sap-developer-shorts/blob/b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461/samples/sample_script_02_sap_cap_60s.md#L24) defines `Products` in `db/schema.cds`, mentions exposing a service in the narration, and then runs `cds watch`. It never supplies that service definition. A database entity alone does not create the demonstrated OData service.

**Verified:** using the SAP CDS compiler included in `@sap/cds-dk` 10.1.0, the sample model contains zero services. Compiling OData metadata fails with: “There are no service definitions found at all in given model(s).” A corrected model with an explicit service compiles one metadata document.

A minimal correction to turn into a checked-in demo project is:

```cds
// db/schema.cds
namespace demo;
entity Products {
  key ID : UUID;
  title  : String;
  stock  : Integer;
}
```

```cds
// srv/inventory-service.cds
using { demo } from '../db/schema';
service InventoryService {
  entity Products as projection on demo.Products;
}
```

Also document Node, CAP tooling, dependency installation and the development database setup; include seed data, an HTTP test and the actual endpoint. Rename the promise from “production-grade enterprise API” to “local OData prototype.” Production readiness requires additional work. SAP's [getting-started guide](https://cap.cloud.sap/docs/get-started/) explicitly introduces a service before demonstrating the endpoint.

### 2. P1 — The ABAP refactor does not explain changed missing-row behavior

The [ABAP sample](https://github.com/Moty/sap-developer-shorts/blob/b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461/samples/sample_script_01_modern_abap.md#L14) implies that replacing `READ TABLE` is an unconditional modernization. In its original code, a failed lookup leaves `lv_name` unchanged. A direct table expression can raise `CX_SY_ITAB_LINE_NOT_FOUND`; the `OPTIONAL` variant returns an initial value. These choices need explicit explanation and tests. It also loses the distinction between a missing customer and an existing customer with an empty name.

The `VALUE #( ... OPTIONAL )` construct should **not** be reported as a confirmed syntax error: SAP documents type inference from table-expression arguments. No ABAP backend was available to compile this exact script. The displayed “100% Passed” badge has no accompanying test implementation in the repository.

Revise the topic to “Table expressions: handle missing rows deliberately,” add complete types and fixture data, and run ABAP Unit for present, absent and empty-name cases on a named ABAP release. SAP's [constructor examples](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/05_Constructor_Expressions.md) show the supported pattern; [SAP's refactoring implementation](https://github.com/SAP/abap-cleaner/blob/main/com.sap.adt.abapcleaner/src/com/sap/adt/abapcleaner/rules/commands/ReadTableRule.java) explicitly warns about changed behavior when no row is found.

### 3. P1 — The pipeline needs enforceable contracts and evidence

[The reviewer prompt](https://github.com/Moty/sap-developer-shorts/blob/b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461/AGENT_SYSTEM_PROMPTS.md#L34) returns a prose approval marker. It has no required source citations, release matrix, compilation result, persisted outcome or retry limit. A model's approval cannot establish that an SAP example executes.

Introduce validated episode data, source records, reproducible demo projects and explicit stage outcomes. Keep the four existing roles as separate generation/review steps in one orchestrator. Start with bounded calls and deterministic checks; a distributed agent platform would add operational work before the basic workflow exists. Separate validity, style preferences, performance claims and product entitlements in the reviewer rules. A blanket label such as “obsolete” for `SELECT *` is too broad.

### 4. P1 — LinkedIn publishing and recovery are unspecified

There is no OAuth integration, member identity verification, upload processing check, publication record or duplicate protection. Build these before introducing unattended publishing.

LinkedIn documents `w_member_social` for posting as an authenticated member through [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin). The current [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) replaces `ugcPosts`. Its [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api) supports member ownership and a separate upload/finalization process. This establishes a documented route, but **your developer app's product access, permissions and successful native-video publication remain unverified**.

Treat account setup and an approved proof post as an early feasibility gate. Do not build against old `ugcPosts` examples merely because they appear in the self-serve overview. Publishing access also does not guarantee member read access or analytics access: `r_member_social` is restricted in the Posts documentation.

### 5. P2 — Narration and timing constraints contradict the samples

Measured counts below use the quoted `Voiceover` lines only, split on whitespace. Visual instructions and separately listed loop anchors are excluded. Spoken code pronunciation can increase the effective length, so audio must still be measured.

| Sample | Claimed words | Measured words | Hook words | Hook duration at 150 words/minute |
|---|---:|---:|---:|---:|
| ABAP-01 | approximately 138 | 115 | 19 | 7.6 seconds |
| CAP-01 | approximately 132 | 97 | 14 | 5.6 seconds |

Both hooks exceed their three-second allocation at that illustrative speaking rate. Neither meets the prompt's 130–150-word rule. ABAP's declared runtime is 56 seconds while its sections run to 60. CAP's 52-second script includes a “45 seconds” promise without consistently identifying what that timer measures.

Generate the narration first, measure its audio, then align scenes and captions. Aim for a short opening of roughly 5–7 words and a 45–60-second finished episode. Treat total word count as a drafting aid. Add a pronunciation glossary for ABAP, CAP, RAP, CDS, BTP, Joule and OData.

### 6. P2 — Visual specifications need one coordinate system

The [visual prompt](https://github.com/Moty/sap-developer-shorts/blob/b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461/AGENT_SYSTEM_PROMPTS.md#L57) uses a 60/40 split; the [master plan](https://github.com/Moty/sap-developer-shorts/blob/b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461/SAP_SHORTS_AGENT_PLAN.md#L191) lists 15%, 55%, 30% and another 10% safe zone without clarifying overlap. “250% zoom” and “20pt” do not define readability after cropping.

Create a single 1080 × 1920 template with pixel bounds, platform overlay masks and a minimum final rendered text size. Use an avatar intro/outro and a smaller presenter region during code demonstrations. Validate the final frame on a phone; exact region dimensions should follow the pilot. Produce source code and output panels from the verified demo, with an explicit distinction between actual execution footage and animated explanation.

### 7. P2 — Public-repository setup is incomplete

The [.gitignore](https://github.com/Moty/sap-developer-shorts/blob/b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461/.gitignore) lacks environment-file, token, runtime-database and generated-media exclusions. Add those before credentials and video jobs are introduced, plus a placeholder-only `.env.example`. Generated media and job state belong in ignored storage or an artifact store.

The [README](https://github.com/Moty/sap-developer-shorts/blob/b300eb69c5a0c99f66ffe9b4fcef4b9117ad8461/README.md#L64) declares MIT, but the reviewed tree has no `LICENSE` file. Add the intended license with the owner's copyright details. Record provenance and usage rights for avatars, voices, fonts, music and screenshots as part of asset metadata.

### 8. P2 — The backlog and success measures need LinkedIn-specific validation

Keep the 30 topics, but attach prerequisites, current official sources, supported release, demonstrated outcome and last verification date to each. BTP account offers, AI entitlements, Joule availability and deployment steps need individual checks before scripting. The existing repo does not establish that every claim is current.

Start with three local CAP topics: expose an OData service, seed and query demo data, and demonstrate a tested validation handler. Schedule ABAP/RAP after a target system is available. Claims such as “10x faster,” “four clicks” or “zero code changes” need evidence and stated conditions.

The existing viewed-versus-swiped KPI is oriented toward Shorts. For LinkedIn, use available impressions, video engagement and meaningful discussion as an initial baseline; record metrics manually until authorized API access is proven. The numerical targets in the blueprint are hypotheses, not demonstrated channel benchmarks.

## Recommended first implementation

### Video product

- One consistent AI presenter and voice, with a brief introduction and closing.
- Most screen space devoted to readable code, real results and synchronized captions.
- One topic, one working example and one practical takeaway per episode.
- A downloadable code sample and official-source links in the companion material.
- LinkedIn native video and tailored post copy first; add other channels after the workflow is reliable.

**Avatar provider recommendation:** evaluate HeyGen for the first pilot behind a replaceable provider interface. Its current [Create Video API](https://developers.heygen.com/reference/create-video) accepts avatar/script or audio inputs, supports vertical output and returns a job ID. [Get Video](https://developers.heygen.com/reference/get-video) supplies status, duration and output URLs. Use the documented API available to the selected account; do not assume old v2 examples are current. Persist the job ID before polling and use supported idempotency keys for retried creation requests.

A stock presenter is a reasonable pilot default. If the desired presenter is your own digital twin, add enrollment to setup: HeyGen requires the depicted person's [consent recording](https://help.heygen.com/en/articles/12092609-recording-your-consent-video). The choice of avatar identity and paid API plan is still open. The HeyGen plugin discovered in this workspace is disabled by the administrator; using its connector is not an available implementation route here. Any separate API use needs the organization's permitted access path.

### Application shape

| Component | Proposed implementation | Purpose |
|---|---|---|
| Orchestrator | TypeScript command-line application and worker | Explicit stages, resumability and clear logs |
| Episode contract | JSON Schema with runtime validation | Stable inputs for script, visual, caption and publishing stages |
| Research and writing | Provider adapter; OpenAI Responses API is one suitable option | Source-grounded scripts and structured scene plans |
| Technical verification | Checked-in CAP fixtures and tests; ABAP target checks when available | Evidence independent of the writing model |
| Avatar | Replaceable HeyGen adapter | Consistent presenter and narration |
| Visuals | Controlled HTML code panels, Playwright capture, FFmpeg composition | Predictable layout and reproducible video assembly |
| Storage | SQLite and local artifacts for a single worker; object storage when hosted | Durable jobs, assets, approvals and publication receipts |
| Distribution | Dedicated LinkedIn OAuth, video and post adapters | Isolated credentials and recoverable publication |
| Scheduling | One always-on worker with persisted due times | Predictable scheduling through restarts |

OpenAI [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) can enforce the supported response schema; application validation and technical execution still need to check the content. Choose the model through a quality/cost pilot and configuration. No model purchase or account entitlement is assumed.

[Playwright supports browser video capture](https://playwright.dev/docs/videos); configure the capture dimensions explicitly instead of accepting its small default. [FFmpeg](https://ffmpeg.org/ffmpeg.html) can assemble the final assets. `node`, `npm`, `git` and `gh` are present on this machine; `ffmpeg`, `ffprobe` and a global `cds` command were not found on PATH during review. The compiler verification used an isolated local dependency, outside the repository.

```text
Topic + official sources
    → script and technical review
    → executable demo verification
    → avatar job and code visuals
    → caption alignment and media checks
    → preview and publication decision
    → scheduled LinkedIn upload and post
    → publication receipt and observed results
```

### Episode and job records

An episode record should contain its ID, topic, audience, language, technical environment, source URLs with retrieval dates, claim-to-source mapping, full narration, spoken-code pronunciation, scene plan, demo paths, test evidence, avatar/voice configuration, artifact hashes, caption files, LinkedIn copy and estimated/measured costs.

A job record should persist stage status, attempts, provider request IDs, generation configuration, source/prompt/model versions, timestamps and failures. Use explicit states such as:

```text
PLANNED → SCRIPT_READY → TECH_VERIFIED → MEDIA_PENDING → RENDERED
        → QA_PASSED → APPROVED → SCHEDULED → UPLOADING → PUBLISHED

Exceptional states: REVISION_REQUIRED, FAILED, PUBLISH_UNKNOWN, CANCELLED
```

The initial review decision covers a specific video hash and exact post copy. Edits create a new version for review. Once several pilots meet the quality bar, enable unattended publishing for an agreed set of topics and checks, with a queue pause control. This is a proposed rollout policy, not an approval requested for the current repository review.

### LinkedIn publication sequence

1. Configure a developer app and obtain the member's OAuth grant. Verify the authenticated identity matches the intended personal profile. Keep credentials outside Git and redact them from logs.
2. Validate current product access with a small, approved end-to-end proof. Configure a supported `LinkedIn-Version` and monitor its sunset date.
3. Initialize a video upload, persist its video URN and upload instructions, then upload the exact byte ranges returned by LinkedIn. Save part identifiers, finalize the upload and wait for `AVAILABLE`. Stop on processing failure or timeout. See the [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api).
4. Submit the reviewed text and video URN to `/rest/posts`, then save the returned `x-restli-id`, asset hash and publish timestamp. See the [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).
5. Give the local publication intent a unique account/episode/version key and acquire a worker lease before sending. If a post request times out after transmission, enter `PUBLISH_UNKNOWN` and reconcile it before another create request. Do not claim exactly-once publishing without provider support; member read permissions may limit automated reconciliation.
6. Track token expiry and support reauthorization. LinkedIn documents programmatic refresh tokens for [approved Marketing Developer Platform partners](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens); assume interactive reauthorization may be required for this app until its access is known.

Store scheduling instants in UTC and the chosen display timezone separately. The initial proposed cadence is the blueprint's three videos per week, subject to pilot quality and the desired posting timezone. No scheduler or recurring automation was created during this review.

## Delivery roadmap

Estimates below are engineering effort for one developer, assuming credentials, provider access and design decisions are available. Allow roughly **3–4 working weeks** for the initial operational version. External account setup and approvals may extend the calendar.

| Stage | Effort | Deliverables | Completion evidence |
|---|---|---|---|
| 0. Access and format proof | 1–2 days | Confirm LinkedIn member access; choose presenter/voice; determine API pricing and spending limits | A locally reviewed avatar test and a feasible native-video posting route; any public proof post approved separately |
| 1. Repository foundation | 2–3 days | TypeScript app, episode schema, machine-readable backlog, revised prompts, corrected CAP fixture, CI, `.env.example`, ignores and license | One clean command validates the episode and runs the CAP test; repeatable dependency install |
| 2. Complete avatar pilot | 4–6 days | Provider adapter, code visuals, captions, FFmpeg template, preview package, cost reporting | One 45–60-second MP4 with readable code, verified results, aligned captions and reviewed LinkedIn copy |
| 3. Publishing and scheduling | 3–4 days | OAuth storage, upload/process/publish stages, durable scheduler, receipts, retries and recovery | Approved native-video post; a worker restart does not lose state; ambiguous failures do not blindly duplicate a post |
| 4. Operational pilot | 2–3 days plus observation | Three CAP episodes, documented runbook, backup/restore, queue pause, performance baseline | Repeatable production with measured review time and cost; decision on enabling selected unattended publishing |

### First development tickets

1. **Bootstrap the application:** dependency manifest and lockfile, TypeScript, test runner, lint/type checks and a `doctor` command for prerequisites.
2. **Make CAP-01 reproducible:** complete project, development dependency setup, seed data, endpoint assertions and actual output capture.
3. **Define episode contracts:** versioned schemas for sources, script, scenes, technical review, media and publication.
4. **Rewrite prompt contracts:** sources and release requirements, evidence-based claims, bounded revisions, measured timing and structured results.
5. **Implement the avatar adapter:** configuration, asset selection, persisted job ID, timeout handling, output download and cost accounting.
6. **Implement the video template:** avatar and demo composition, captions, safe zones, thumbnail and output verification.
7. **Add review and job state:** preview package, artifact hashes, revision handling and restart recovery.
8. **Add LinkedIn integration:** OAuth, profile binding, upload finalization, post creation and persisted receipts.
9. **Add the scheduler and operations:** durable due jobs, one active worker per job, bounded retries, spending limits, queue pause and backup instructions.
10. **Run the three-episode pilot:** measure generation failures, technical corrections, editing effort and available LinkedIn results; then prioritize ABAP/RAP support or broader distribution.

Suggested repository additions:

```text
src/cli/                 commands and configuration
src/pipeline/            stages and transitions
src/providers/           writing, avatar and LinkedIn adapters
src/render/              composition and media validation
src/state/               jobs, approvals and publication receipts
schemas/                 episode and output contracts
content/topics/          machine-readable backlog and source records
content/episodes/        versioned editorial inputs
demos/cap/               executable fixtures and assertions
demos/abap/              complete snippets and target-system test instructions
prompts/                 versioned prompts by role
tests/                   meaningful checks for failure and recovery paths
.github/workflows/       CI and manually triggered generation
docs/                    plan, access setup and operations
```

Keep generated MP4s, audio, temporary captures and the runtime database outside versioned source. Retain final deliverables and run manifests in a durable artifact directory or object store. A hosted worker needs its own persistent storage and backup strategy; a sleeping laptop will not reliably run scheduled jobs.

## Quality and cost controls

Before publication, verify the demo's expected behavior, every material claim's supporting source, supported SAP release, complete prerequisites, narration duration, captions, final code readability, audio presence and final post text. Test recovery using simulated provider failures, expired tokens, rate limits, failed video processing and a lost publication response. Use actual backend compilation for ABAP validation; a prompt review or local syntax approximation is insufficient evidence of target compatibility.

Track the provider's billed units for each attempt. Cache approved scripts and completed avatar jobs so a visual correction does not automatically purchase another avatar render. Limit technical-revision cycles and media retries. Determine episode and monthly spending limits from the selected account's current API prices before the first paid run; no price or subscription entitlement was verified here.

At three episodes a week, planning volume is about 13 finished episodes per month. Estimate the monthly cost as:

```text
13 × (avatar generation + any separate voice cost + model usage
      + rendering/storage + expected failed-attempt cost)
```

Measure accepted episodes, minutes of human revision and total cost per accepted episode before increasing volume. For early LinkedIn feedback, compare topics and opening styles against your own baseline and record only metrics the account can actually access.

## Work completed in this review

- Cloned the GitHub repository to `/Users/I851396/__Code/sap-developer-shorts` and verified `origin` and the checked-out commit.
- Read all seven tracked repository files at the reviewed commit.
- Counted the samples' narration and checked their timing assumptions.
- Compiled the original and corrected CAP models in an isolated scratch workspace: original has zero services and fails metadata generation; corrected has one service and one metadata document.
- Checked current official LinkedIn, SAP, HeyGen, OpenAI, Playwright and FFmpeg documentation for the proposed path.
- Saved this plan locally. No executable pipeline was implemented, credentials used, video purchased, public post created, commit made or push performed.

The CAP verification establishes model compilation and metadata generation only; it does not constitute a complete running-service, Fiori preview or production-deployment test. No ABAP backend was connected. No LinkedIn or avatar account was authenticated or exercised.

The checkout exists as a separate local repository. Adding it to the Codex sidebar could not be completed: Computer Use refuses access to the Codex app, and the available project tools do not expose project registration. The remaining UI step is **Open folder** (`⌘O`) and choose `/Users/I851396/__Code/sap-developer-shorts`; see [official project setup guidance](https://learn.chatgpt.com/docs/quickstart#setup-app-select-workspace).
