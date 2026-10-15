# Review the October 15 overnight build

The local studio contains **eleven narrated vertical videos**, eleven episode
downloads, eleven script workshops, and two narrator samples. Heart remains the
default at speed 0.96. All work is on `codex/project-foundation`; main was not
merged and no posts were published.

## Open the work

- [Review studio](http://127.0.0.1:4173/review.html)
- [Download the entire studio](http://127.0.0.1:60141/review.html) — 84.2 MiB
- [Browse the source branch](https://github.com/Moty/sap-developer-shorts/tree/codex/project-foundation)

These preview addresses use the running local servers. Generated media is saved
on this Mac and excluded from Git. The GitHub branch contains the application,
content, tests, and documentation. The studio ZIP keeps its saved videos, sources,
captions, companion drafts, voice samples, and workshops together.

If a server has stopped, run the corresponding command from the project folder:

```sh
npm run shorts -- serve artifacts/library-f8dddb3a-c2fb-4e8f-8959-cf06d676b24a
```

For the archive download page, serve this directory instead:

```sh
npm run shorts -- serve artifacts/library-package-f29650d4-cb22-47d1-8772-406674037845
```

Each command uses port 4173. Run one at a time with that port free, and use the
printed address. An extracted ZIP can also be served from its `studio` folder.
Importing or producing a revised script requires the project and installed local
voices.

## What to review first

| Subject | Saved deliveries |
| --- | --- |
| CAP: expose a local service | Professional, casual, solo comic, two-person comic, numbered recipe |
| CAP: seed data and query stock | Professional explanation, prediction/reveal quiz |
| SAP Connect announcement roundup | Professional news brief |
| Joule Work rollout and access | Professional explanation, casual conversation, myth vs fact |

Start with **CAP-01 conversation**, **CAP-02 quiz**, and **Joule Work
conversation** to compare humor, two voices, and news delivery. The recordings
use Kokoro Heart and Michael. The presenter area is a labeled graphic; stock
avatar animation remains pending.

The Narrators section contains identical-text samples of Heart and Michael.
Changing the default does not change existing recordings. A workshop can choose
voices for just its new revision; other supported profiles need explicit local
setup before they appear in a rebuilt studio.

## Try a script revision

1. Choose **Revise script** on an episode card. Change wording, headlines, voices,
   or the companion post, and choose a new version name.
2. Open **Review changes**. Restore a title, scene, post, or starting voices
   without losing other edits.
3. If the tab reloads, choose **Resume saved draft** or **Start with original**.
   Recovery depends on the same tab, address, and starting input. Download the
   JSON to keep a portable copy; closing the tab or browser restrictions can lose
   recovery.
4. Download a valid revision. Use the import and production commands printed in
   the workshop. Existing versions are protected from replacement.

Draft counts and pacing are writing guidance. Production measures the actual
audio and validates its duration. Revised wording still needs source review;
editing never renews a news source date.

## Verification and review limits

The feature code passes **163 workflow tests**, five live CAP assertions, type
checks, formatting, content validation, and the build on minimum Node 22.13.0.
GitHub CI also passes on Node 22 and 24. Astra audited eleven selected versions,
77 scenes, 202 caption cues, tutorial evidence, transcripts, speaker attribution,
and companion copy. The historical code-link issue it found is fixed.

All 146 current studio artifact hashes and eleven nested episode ZIPs pass.
Independent whole-studio extraction checks 148 members and 231 local links
across 45 HTML files. Native downloads match their source hashes. Real browser
checks cover desktop/phone layouts, reload recovery, invalid drafts, targeted
restores, and isolated JSON imports. Earlier media and archives remain intact.

No audible listening pass was performed overnight. Caption boundaries use model
timing estimates. Listen for SAP pronunciation, naturalness, dialogue transitions,
and caption placement before sharing a video. News notices retain their saved
as-of and inclusive valid-through UTC dates; later viewing does not renew their
facts. No customer SAP environment was tested for the news announcements.

No paid media, stock-avatar integration, or publishing was performed overnight.
Administrator-disabled providers were not bypassed.

One early Joule Work narration attempt hit its 24-second rendering deadline.
Retry resumed the same saved job successfully. The local rendering allowance
and cancellation handling were then improved and verified. No laptop-sleep
interruption was observed; bounded sleep prevention is set to expire at 7 AM.

## Recommended next work

1. Listen to one tutorial and one news conversation while awake. Record the exact
   words/timestamps needing correction; regenerate only confirmed issues.
2. Combine workshop JSON import and resumable production into one local command,
   preserving collision checks and safe retries of identical definitions.
3. Choose a substantive next SAP developer problem. Build executable evidence for
   its intended result and a meaningful failure before authoring the short.

Stock presenters and publishing remain separate integrations with provider
access, cost limits, and destination authorization to resolve first. Astra
recommends preserving the verified build for the final morning audit.

See [progress](PROGRESS.md), [Astra review](ASTRA_REVIEW.md),
[production](PRODUCTION_WORKFLOW.md), [voice choices](VOICE_OPTIONS.md), and
[news source review](NEWS_WORKFLOW.md) for details.
