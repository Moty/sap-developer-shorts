# SAP news shorts

The project supports two editorial formats through the same `validate`, `verify`, `preview`, and `narrate` commands. Technical tutorials retain their registered executable demo and live assertions. News episodes summarize dated announcements and retain source-review notes. A news episode must never receive a “technical demo verified” badge or invented execution checks.

The studio now also discovers official RSS stories and creates staged drafts from
article URLs. This path uses paragraph extraction and templates, with structural
validation; it does not run the editorial LLM prompts or independently establish
source support. The [content quality review](CONTENT_QUALITY_REVIEW.md) identifies
its current writing, attribution and date-handling limitations and proposes the
replacement workflow. Review every automatic draft before producing or sharing.

## Start from a news page

For a prepared conversational example, use `NEWS-02@duo`: the Joule Work brief
with Mira (Heart) and Max (Michael), a short comic beat, named captions, and the
same dated source/availability cards as the solo. Produce it with
`npm run shorts -- produce NEWS-02@duo`. The studio keeps both versions and offers
**Revise script** for their wording; a delivery revision never refreshes sources.

1. Read the primary announcement and its linked official detail pages. Record publication dates when supplied and the date you actually read them. The initial source policy accepts HTTPS pages on `sap.com` and its subdomains; adding other publishers requires an explicit policy change.
2. Choose the audience and angle. Rank candidates using editorial relevance, recency, practical impact, and clear availability. A priority in `content/news/backlog.json` is an editorial choice, not an engagement metric or proof of global popularity. Leave unresearched follow-ups as `needs-research`.
3. Copy `content/episodes/NEWS-01.json` to a new `NEWS-NN.json`, set a new ID and revision, and add its `draft-ready` backlog entry only after research. Use the template and news-editor prompt below. Do not turn a tutorial into news by removing its checks.
4. Give each material claim its official source IDs, a section locator, a short paraphrased support note, review date, delivery status, timing, and scope. Use the most specific source. Keep regional limits, early-adopter conditions, customer eligibility, and planned dates. If the source is silent, say what remains unconfirmed rather than guessing.
5. Write seven scenes: hook, context, three announcement cards, editorial takeaway, and CTA. Each card references exactly one claim. Use attribution such as “SAP says” for vendor claims and label your own interpretation. Keep the hook within three seconds and seven words and target 45–60 seconds overall.
6. Run the commands below, inspect source notes and companion copy, and measure narration. Approval remains an editorial step before any provider generation or publication.

```sh
npm run shorts -- validate NEWS-01
npm run shorts -- verify NEWS-01
npm run shorts -- preview NEWS-01
npm run shorts -- narrate NEWS-01
npm run shorts -- serve ARTIFACT_DIRECTORY
```

`verify` checks the saved source-review structure and dates; it does not re-fetch pages or test SAP product behavior. The news contract is `schemas/news-episode.schema.json`. It shares common editorial fields with the tutorial schema but excludes demo commands, captures, and execution checks. Runtime checks enforce official source hosts, consistent review dates, source/claim references, announcement cards, and scene timing.

## Freshness and evidence

The episode carries a visible `news.asOf` date and a review window of at most seven days. Every source read date and every claim check date must match that as-of date. `preview`, `verify`, media planning, and unfinished media jobs reject expired reviews. General content validation still accepts an old draft so unrelated tutorial work can continue. To renew a review, re-read the sources, revise changed facts and dates, increase the revision, and create a fresh run. Changing a date alone does not constitute research.

A published roadmap date remains planned until a fresh official source confirms release. A source's publication date may be `null` when the page does not supply it; do not infer a date from the URL or retrieval date. “Available now” always refers to the dated source review and its stated scope. The stored facts and source dates remain a snapshot even if viewed later.

Newly assembled studios and episode ZIP players add a separate source-review
notice. Cards, narration/watch pages, MP4 players, and script workshops always
show the as-of and inclusive valid-through UTC dates, including without
JavaScript. A seven-day review dated October 15 includes all of October 22 UTC;
October 23 requires rechecking. A small local date check updates the notice on
load, page return, and at most once per visible minute. It makes no source
request and does not declare the facts current.

An expired notice says **Source recheck required** while preserving media,
downloads, and editing. Invalid dates or a device clock before the review date
show **Check source-review dates**. A known expired build remains expired, and
expiry observed during the page session survives clock rollback in that session.
The device clock can still be wrong; the saved dates and manual review guidance
remain visible. Rebuild an older studio to add this behavior. Whole-studio ZIP
packaging preserves the chosen snapshot's exact bytes and does not retrofit
earlier archives or renew the review window.

News stages are `VALIDATED → VERIFYING → SOURCES_CHECKED → PREVIEW_READY`, with failures saved as `FAILED`. Runs save the exact episode, `news-evidence.json`, narration draft, post draft, HTML, layout, source/runtime hashes, and artifact hashes. The news evidence freezes the supplied editorial review; it is not independent proof that the claims are true. An editor must compare the narration and availability wording with the linked sections. URL drafting now extracts article text; the verification command still does not independently re-read or fact-check that article.

Both formats then use the same durable media worker, local speech adapter, measured WAV/caption validation, narration player, and recovery mechanisms. Editing content creates a new request; packaging an existing completed narration reuses its audio. The saved stock presenter and pilot spending preference are unchanged. No paid provider or publishing adapter is enabled.

## Initial source pack

The initial roundup and six-item editorial backlog were prepared from the [SAP Connect 2026 Innovation News Guide](https://www.sap.com/topics/events/connect/innovation-news-guide-2026) and the [October 6 press release](https://news.sap.com/2026/10/sap-connect-sap-puts-autonomous-enterprise-to-work/), read October 14, 2026. This is event coverage, not a claim to include every current SAP announcement. NEWS-02 now provides the Joule Work follow-up, reviewed October 15, 2026; four other follow-ups remain research candidates.

- Script structure: [news script template](../templates/news_script_template.md)
- Editorial role: [news editor prompt](../prompts/v1/news-editor.md)
- Media operations: [narration and recovery](MEDIA_WORKFLOW.md)

Verified local MP4 exports and episode ZIP downloads are available through `produce SELECTOR --serve`. RSS discovery, keyword relevance scoring and URL article extraction are available. Scheduled news monitoring, measured trend scoring, LLM story generation and publishing remain future work. No schedule is created by this implementation.


## Joule Work follow-up

[NEWS-02](../content/episodes/NEWS-02.json) expands the roundup into three cards:
interface, business context, and managed activation. Its review date is October
15, 2026, with a seven-day window valid through October 22 (UTC dates). All three
cards remain labeled rollout. The guide’s broader portfolio availability does
not establish access for a particular customer. Source locators and support
notes remain in the episode and its saved news evidence.

```sh
npm run shorts -- produce NEWS-02 --serve
```

The generated studio and ZIP include the source dates, recorded narrator, measured
captions, transcript, companion draft, and publication status. Source review is
editorial; no Joule Work environment or tenant behavior was tested.
