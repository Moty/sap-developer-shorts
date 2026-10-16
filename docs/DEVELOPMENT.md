# Local development and episode review

For a fresh checkout on another Mac, begin with [New Mac setup](NEW_MAC_SETUP.md).
It covers system tools, locked application dependencies, core checks, optional
voice setup, and transferring saved recordings separately from Git.

## Content contracts

The application also accepts the separate `NEWS-NN` format for dated news briefs. Its source-review evidence and availability checks do not replace tutorial execution checks. News uses the same preview and narration commands; see [news authoring and freshness](NEWS_WORKFLOW.md).

`content/topics/backlog.json` retains all thirty strategy topics. `needs-research` means that the topic's original title and claims are unverified. Changing it to `pilot-ready` requires sources, a named supported release, a verification date, and prerequisites. CAP-02 and CAP-03 are the next local topics; ABAP/RAP require a real target system.

Episode inputs live at `content/episodes/<ID>.json`. The JSON Schema rejects extra fields and missing prerequisites, sources, claims, scene information, and distribution copy. Additional runtime checks enforce unique IDs, valid claim references, the full registered demo-check set, exactly three demo scenes, a continuous 45–60-second timeline, and a hook of at most seven words in three seconds. Each scene is capped at a draft pace of 180 words per minute. These checks establish consistency; a human must still review whether sources actually support each claim.

Only registered demo programs are executable. Episode JSON cannot supply arbitrary commands. Code panels must use registered demo files, and file resolution rejects paths or symlinks outside the repository.

All local files under the demo directory must match its registered inventory. Adding a model, handler, configuration, or data file requires registration before a run can advance. Dependency directories and `.DS_Store` are excluded; local demo symlinks are rejected. This prevents CAP's automatic discovery from loading unrecorded inputs.

`schemas/demo-evidence.schema.json` validates the complete evidence payload before technical verification: nonempty metadata, runtime versions, timestamps, collection structure, UUID keys, titles, and numeric stock. Behavioral assertions remain in the executable CAP verifier. `schemas/video-layout.schema.json` and geometry checks validate the 1080 × 1920 layout, minimum font sizes, and critical content bounds.

## Commands and results

`validate` checks inputs without running the demo. For tutorials, `verify` executes live CAP assertions and saves evidence. For news, it validates the dated editorial source review and saves that review. `preview` adds the standalone HTML storyboard and draft text. All three are local commands, with no generation or publishing API calls.

Run stages are persisted through atomic manifest replacement:

```text
VALIDATED → VERIFYING → TECH_VERIFIED → PREVIEW_READY
                      ↘ FAILED
```

Any verification or preview error records `FAILED` with diagnostic text. A failed verification never advances to `TECH_VERIFIED` or produces a storyboard. A preview failure may leave partial files in the failed run directory; use the manifest's status to interpret them.

Every run has its own UUID directory and exact episode snapshot. SHA-256 digests identify source inputs, the episode, captured evidence, and review outputs. `runtimeHashes` separately identifies application modules used in a run: `.ts` with `tsx`, or emitted `.js` with the compiled CLI. Editable source may differ from a compiled build; runtime hashes identify that build. The pipeline checks the inventory and recorded files again during verification and preview creation and fails if it detects changes. These are local provenance checks, not signatures or external attestations.

Foundation verification runs restart from validation. The separate media stage now implements SQLite jobs, single-host leases, saved provider IDs, reconciliation, and resumable polling/packaging. See [media workflow and recovery](MEDIA_WORKFLOW.md). A scheduler, publication approval, unattended publishing, and cross-version partial-media migration are not implemented. Do not treat either manifest as a publication receipt.

## Local configuration

Generated files default to ignored `artifacts/`. Set `SHORTS_ARTIFACT_DIR` to use another local path; keep that destination out of source control. The application does not load `.env` automatically. For explicit loading:

```sh
cp .env.example .env
node --env-file=.env --import tsx src/cli.ts doctor
```

`doctor` checks the Node version, local CAP dependencies, and content. It reports FFmpeg and FFprobe as optional for the core workflow; both are required by the `render` command. It does not test avatar credentials, publishing entitlement, or production systems.

## Next milestone: narrated avatar pilot

Choose a permitted avatar provider, presenter identity, voice, and budget. Then implement a replaceable provider adapter with a persisted job ID, timeout handling, output download, and cost records. Measure real audio before aligning scenes and generating captions. Use the shared pixel layout, verified source files, and captured results for video composition. Verify duration, audio, captions, and phone readability in the final MP4.

LinkedIn integration follows a working pilot and requires an authenticated member, confirmed native-video API access, exact-copy and video review, upload finalization, receipts, and recovery for ambiguous publication responses. No public posting is implemented in the foundation.
