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

These are saved, authored scripts. Clicking a preview opens its recorded version. The studio does not automatically rewrite an arbitrary episode or purchase avatar media. Myth/fact, countdown, story, and quiz are supported writing formats; additional scripts must be authored and reviewed before their previews exist.

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
