# Finance short: output and companion review

Reviewed on October 28, 2026, against the [official SAP finance announcement](https://news.sap.com/2026/10/sap-advances-finance-operations-embedded-payments-new-consolidation-capabilities-expanded-ai/).

## Findings and repairs

- Article import previously cut titles, claims, narration, and companion sentences at arbitrary limits. It left numeric HTML entities in prose, recorded the import day as the publication date, and added generic availability/scope assertions. Extraction now preserves complete source sentences, decodes source punctuation, uses publication metadata, and leaves unknown publication dates unknown. If it cannot find three bounded complete sentences, it requests editorial review instead of inventing or truncating claims. Imported excerpts still require a human context and availability review.
- The video advanced past a status badge using the height of its text instead of the height of the badge. The next claim nearly touched it. News cards now reserve the entire badge and measure claim, timing, and scope regions with explicit gutters and a readable minimum claim font.
- A large translucent scene number sat behind multi-line headlines. Scene numbering now occupies the top brand row.
- The rewritten narration and old companion copy had diverged. The corrected edition includes a matching post with the product scope, available countries, planned early-adopter date, discussion question, and official source. The unsupported “zero hallucinations” line was removed from the narration.

## Corrected edition

`NEWS-10` contains the reviewed public source pack. A local `NEWS-10@quality-review` variant retains the user's selected Qwen voice and Ditto photo. Earlier `NEWS-09` base/variant files and artifacts remain available; their base hashes have not been silently rebound to changed evidence. The private voice/profile/photo variant is not included in Git.

The source was published October 12, 2026. The reviewed cards distinguish SAP Pay's US/UK availability from SAP Enterprise Financial Consolidation's data-source capabilities and planned Q1 2027 Early Adopter Care. The latter is not a general-availability date.

## Validation

- 329 automated tests passed both in the active workspace and a clean checkout of the staged public files.
- TypeScript type checking/build, 12 desktop tests, and content validation passed.
- Biome passed for all changed TypeScript/tests and the new episode/backlog entry. Whole-workspace lint still reports existing formatting/lint diagnostics in unrelated files and personal local drafts; those were not changed as part of this repair.
- Seven representative scene frames were inspected, including long claims and the closing question. Regression checks require visible gutters between every news-card region, preserve complete companion/source sentences, decode decimal/hexadecimal entities, and keep source publication dates separate from retrieval dates.
- Local narration measured 47.620 seconds, with a 2.800-second opening. The final MP4 is 47.633 seconds: H.264/AAC, 1080×1920, 30 fps, all 1,429 frames decoded successfully. Audio verification passed at −16.48 LUFS integrated and −4.36 dB true peak.

Evidence and generated outputs are local under `artifacts/output-quality-fix/`; they are not published or distributed in a new installer.

## Completed local render

- Production report: `artifacts/productions/2a93b7e0-0dc3-4aa4-b10c-b79153305bb5/production.json` (`READY`).
- Video: `artifacts/videos/NEWS-10--quality-review/video-a302d4b0664cd7b8/short.mp4`. The matching `publication-draft.txt` begins with the exact saved companion post, has no leftover numeric HTML entities, and includes the narration disclosure.
- Total generation: 10m 4s; narration/alignment 1m 25s; portrait/video/verification 8m 38s. Everything ran locally.
- Seven frames extracted from the encoded MP4 were inspected. The localhost player was checked at phone width, paused on the available-country card with captions visible. The complete companion text was also checked in the browser. Local evidence: `artifacts/output-quality-fix/final-grid.png`, `review-proof.png`, `companion-proof.png`, and `final-evidence.txt`.
- Local preview: `http://127.0.0.1:59725/episodes/NEWS-10%40quality-review/video/review.html`. Earlier editions remain accessible in the workspace.
