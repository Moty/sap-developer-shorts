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
