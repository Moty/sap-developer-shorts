# Presentation styles

Choose three independent parts of the delivery:

| Part | Options |
| --- | --- |
| Tone | Professional, casual, comic |
| Story format | Clear explainer, two-person conversation, myth vs fact, three quick takeaways, problem to solution, quick challenge |
| Humor | None, light humor, SAP geek humor |

For example, a conversation can be a serious interview or a comic exchange between colleagues. A news brief can stay professional while using a numbered roundup. Humor changes the script; it does not grant Kokoro an emotion or acting control. The model still uses its built-in voices and the configured speed.

## Prepared CAP comparisons

The review studio has a **Delivery styles** section and links to four versions of the CAP service tutorial:

- `CAP-01`: the original professional explainer with Heart.
- `CAP-01@casual`: a colleague explaining the same example with Heart.
- `CAP-01@comic`: a solo comic version with SAP/developer jokes and a warmer visual accent.
- `CAP-01@duo`: a comic conversation between Mira (Heart) and Max (Michael), with two distinct local voices and named captions.

`CAP-01@countdown` is a numbered three-step guide: define Products, expose the
service, then run the checked query. The later full-list capture is explicitly
identified as all three sample products, separate from the positive-stock result.
This is a recipe, not a ranked list. Try `npm run shorts -- produce CAP-01@countdown`.

The CAP data lesson also has `CAP-02@quiz`, a Heart-narrated prediction/reveal:
read the CSV's stock counts, choose which products pass the positive-stock filter,
then see the checked result. Its visuals, exact URLs, and evidence come from CAP-02.
Try `npm run shorts -- produce CAP-02@quiz`.

For SAP news, `NEWS-02@duo` is a casual Joule Work conversation between Mira
(Heart) and Max (Michael), with light humor. It inherits the solo short's dated
sources and rollout/access qualifications. Both the tutorial and news conversation
are linked from the storytelling gallery. Try `npm run shorts -- produce NEWS-02@duo`.

`NEWS-02@myth-fact` uses Heart for a professional question-and-correction delivery
about announced capability versus an organization's access. It preserves the same
source date, selected-customer rollout scope, and activation qualifications. Try
`npm run shorts -- produce NEWS-02@myth-fact`.

These are saved, authored scripts. Clicking a preview opens its recorded version. The studio does not automatically rewrite an arbitrary episode or purchase avatar media. The storytelling gallery links to the best available example for each format and distinguishes a prepared script, preview, or MP4. Problem-to-solution stories still need an authored, reviewed script before a preview exists.

```sh
npm run shorts -- styles
npm run shorts -- voice-setup am_michael
npm run shorts -- validate CAP-01@duo
npm run shorts -- narrate CAP-01@duo
npm run shorts -- library
npm run shorts -- serve LIBRARY_DIRECTORY
```

Run narration jobs one at a time on this Mac. Each provider operation has a bounded deadline; simultaneous CPU-heavy model processes can exceed it. A saved job can resume with `narrate` or `media-step` without losing completed scenes.

## Add a delivery version

For an existing delivery, use **Revise script** on its studio card. The workshop
lets you choose a voice for each existing speaker and edit the title, narration,
on-screen headlines, and companion post. It keeps the format, speaker names,
scene order/timing, visuals, sources, and claims fixed. Voice choices apply only
to the new version; the global default remains unchanged.
Dialogue turns retain their speakers; their text is joined into narration for
you. Choose a new lowercase version name and download the revised script.

Use **Review changes** to compare changed fields with their starting values
before downloading. The count groups edits by title, voices, scene, and post;
renaming the version alone is kept separate. A scene restore returns its headline
and all narration/turns together. Voice restoration returns all speakers to their
starting assignments. Other edits and the new version name stay intact. Invalid
edits appear in the comparison but still block downloading until corrected.

```sh
npm run shorts -- script-import /path/to/CAP-02--my-edit.json
npm run shorts -- produce CAP-02@my-edit --serve
```

Use the path/name printed for your download and import. Import validates against
the current base before writing and refuses existing versions. It does not
generate media. New scripts need their own production result; earlier recordings
remain available under their original selectors. The workshop's word counts and
pacing warnings are draft guidance; narration duration is measured after recording.
Where browser storage is available, the same tab and address can recover edits
after reloading. Choose **Resume saved draft** or **Start with original** before
editing again. Recovery keeps raw wording and voices, including incomplete drafts
that still need correction. It applies only to the exact starting input. Download
the JSON to keep a portable copy; closing the tab, changing the address, or browser
storage restrictions may lose recovery.

Review rewritten claims against the official sources. Structural validation does
not fact-check new wording. Dated news retains its original source-review date;
editing or importing a delivery cannot refresh an expired review. Without
JavaScript, the workshop still exposes the original script and sources.

For a new format or speaker arrangement, author a delivery definition:

Create `content/presentations/EPISODE_ID--VARIANT.json`. The file binds to the base episode's canonical JSON hash and specifies a title, presentation settings, and narration/overlay/dialogue overrides for every scene. The [presentation editor prompt](../prompts/v1/presentation-editor.md) describes the writing task.

```json
{
  "schemaVersion": 1,
  "baseEpisodeId": "CAP-01",
  "baseInputHash": "SHA-256 of JSON.stringify(validated base episode)",
  "title": "A new delivery of the same verified example",
  "presentation": {
    "variant": "interview",
    "tone": "professional",
    "format": "dialogue",
    "humor": "none",
    "speakers": [
      { "id": "host", "name": "Host", "voice": "af_heart" },
      { "id": "expert", "name": "Expert", "voice": "am_michael" }
    ]
  },
  "scenes": [
    {
      "id": "hook",
      "narration": "Where is the API?",
      "dialogue": [{ "speakerId": "host", "text": "Where is the API?" }]
    }
  ]
}
```

The example shows one scene only; real files require all seven scenes in their original order. Each dialogue scene must declare its speaker turns, and their text must join exactly to the scene narration. Both speakers must participate and use distinct installed English Kokoro profiles. Solo formats use one speaker. Speaker names appear in the player and caption files but are not synthesized as narration.

The resolver inherits the base's sources, technical claims, demo, visual inputs, and source-review dates. A delivery file cannot override those fields, scene order, or timing slots. If the base changes, its old hash is rejected until the variant is reviewed and rebound. These checks preserve the evidence; an editor must still judge whether rewritten narration accurately conveys it. News freshness checks apply equally to presentation versions.

## Humor and review

Keep jokes brief and attached to a real developer situation: an entity needing a service introduction, a read-only API banning impulse purchases, or a missing projection causing confusion. Label opinions and wordplay through the delivery; avoid invented product promises, fake benchmarks, or availability jokes that obscure a release status. Aim for one or two useful comic beats per minute and retain the working steps and takeaway.

Two-person audio is generated turn by turn with short pauses. Caption speaker attribution is checked against the declared turns, and the player shows the active speaker. Caption boundaries remain model timing estimates. Installed voices are cached; each job pins an immutable runtime snapshot, so installing a cohost does not invalidate another saved job. Reusing a pinned runtime still requires its original model assets and dependency versions.

Narrated HTML previews can now be exported as captioned vertical MP4s with `render`; see [video export](VIDEO_EXPORT.md). Actor/avatar performance, comic character artwork, and publication remain later production work.
