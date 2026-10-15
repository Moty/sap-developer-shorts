# Independent GPT-6 Astra review

Reviewed October 14, 2026 at the user's request, before proceeding to narrated video production. An independent GPT-6 Astra reviewer examined the complete local foundation, reproduced findings in scratch fixtures, and later verified the implemented fixes. No paid media or publishing operation was performed.

## Outcome

The reviewer found three medium-priority correctness gaps (P2), with no P0/P1 finding in the current pilot. **All three original findings are resolved within the current pilot's scope.** Astra independently reran all fifteen workflow tests, including the compiled CLI reproduction, and reported no remaining issue in these fixes that blocks the narrated-avatar milestone.

## Findings and fixes

| Finding | Reproduction | Implemented fix | Regression evidence |
| --- | --- | --- | --- |
| Incomplete CAP input inventory | Add an extra CDS annotation file: metadata changes while the old fixed hash list stays identical | Compare every local demo file against the registered inventory before and after execution and rendering; reject additions, missing files, and symlinks | Extra model, handler, and configuration tests; scratch compiled CLI persists `FAILED` for `db/extra.cds` before verification |
| Compiled runtime missing from provenance | Build, change TypeScript renderer wording, then run the compiled CLI: old JavaScript renders while the edited TypeScript is hashed | Record `runtimeHashes` for the actual `.ts` or `dist/src/*.js` application modules, separately from `sourceHashes` | Real build/edit/run test checks the rendered wording and exact executed JavaScript digest |
| Incomplete evidence validation | Supply expected check names with empty metadata and malformed result collections: the old gate reaches `TECH_VERIFIED` | Validate the full evidence schema, metadata, environment versions, timestamps, product collections, and row types before advancing | Malformed payload tests assert `FAILED` and no `TECH_VERIFIED` history |

The provenance checks are local consistency records, not attestations or a replacement for a reproducible dependency install. Source hashes can differ from a compiled runtime's hashes; the runtime digests identify the application files used by that run. The inventory excludes dependency directories, whose declared versions are recorded in the lockfile, and harmless `.DS_Store` files.

## Improvements included

- Revised CAP-01's opening around its concrete lesson: a data model needs an explicit service to expose an API.
- Displayed `npm run demo` and the exact local filtered endpoint next to the captured results.
- Added a claim-to-source-to-check table for editorial review.
- Added schema and geometry validation for the shared vertical layout, including minimum code size and content bounds.
- Inspected the command, URL, service code, and result panels in the browser for clipping and scrolling.

## Next production step

Start the provider integration with a fake adapter and persisted request/job states. Exercise restart recovery, timeouts, and uncertain submission results before buying media. A real run then requires the presenter identity, voice, permitted provider access, and a spending limit. Measure the narration before aligning scenes and captions; inspect the final MP4 for duration, audio, and phone readability.

The review does not verify an avatar provider, OAuth entitlement, final media, or public publishing. These remain subsequent milestones.

## October 15: narration and MP4 follow-up

At the user's request for overnight work, the same independent GPT-6 Astra
reviewer audited the later Kokoro, presentation, and MP4 implementation. The
baseline's 53 workflow tests passed. Astra reproduced three P2 findings:

| Finding | Fix and regression evidence |
| --- | --- |
| A missing source folder or completed package trapped repeat requests against the same obsolete job | Fresh linked attempts are permitted for confirmed free local failures or invalid saved artifacts. Old jobs remain intact, retries reuse the recovered attempt, and unknown submissions retain conservative handling. Tests remove a source folder and a completed WAV, then verify recovery and predecessor records. |
| Speech cache keys omitted synthesis code | New requests and scene cache inputs bind a narrow fingerprint of the actual TypeScript or compiled JavaScript synthesis implementation, Python runner, and relevant configuration. Changed generators stop unfinished work. Tests distinguish synthesis changes from visual-only changes and reject mixed-generation recovery. |
| The studio could offer an older MP4 after a corrected narration package | Video selection now compares the selected WAV bytes and timing/caption hashes with the export. Tests change one valid audio sample and update its media receipt, then confirm the old MP4 is excluded while narration remains viewable. Timing/caption changes are also covered. |

Astra independently ran all 26 focused media/neural/library tests and repeated
the altered-WAV reproduction successfully. Its follow-up identified one legacy
compatibility gap: unfinished recordings without a generator fingerprint must
not generate further scenes. That guard and a regression are now included;
completed legacy packages remain reviewable and can be repackaged.

The full checks pass on minimum Node 22.13.0: 56 workflow tests, five live CAP
checks, formatting, types, and content validation. Job discovery is read-only and
labels recordings with unrecorded legacy generator fingerprints. These local
checks do not claim a paid avatar integration or publication approval.

### Production coordinator and speech reuse

Astra reviewed the new one-command production workflow, exact narrator selection,
and copied-audio reuse before commit. It independently reproduced two P2 gaps in
the first reuse implementation: altered copied audio was accepted during
packaging, and a crash before the database transition lost access to an intact
copy if its donor disappeared. One shared copied-package validator now binds the
job/request, audio, timing, and captions. Recovery checks the independent copy
first, and packaging consumes the validated buffers.

Astra reran both original scratch reproductions successfully: recovery reaches
`PACKAGE_PENDING` without the donor, altered copied bytes fail, and restored
bytes package again. It also independently checked stable matching public source
commits, unpublished/mismatched sources, and a different remote. All twenty
focused production/library/video tests passed in that review. Additional local
regressions cover separate artifact roots, while the full suite now has 65 tests.
No remaining concrete blocker was reported for the reviewed milestone.
