# Review the actual video and sound

Use the finished MP4 for a delivery review. Scripts, extracted frames, waveform
measurements, and successful exports cannot establish whether a voice sounds
natural. Keep an unchanged baseline and compare one revised version at a time.

## CAP casual revision

The user supplied a Gemini review of the 49.8-second `CAP-01@casual` recording.
It reported robotic cadence, API sounding like I-P-I, the awkward instruction
"Run npm run demo", static code, and an abrupt filtered-result transition.
Its general conclusion that the voice engine must be replaced is an opinion;
it was not established by a controlled engine comparison.

An independent Astra review and a local test of the installed Kokoro/Misaki
pipeline reproduced a concrete glossary error without synthesizing audio:

| Input | Model phonemes | Meaning |
| --- | --- | --- |
| `ay pee eye` | `ˈI pˈi ˈI` | I-P-I |
| `A P I` | `ˈA pˈi ˈI` | A-P-I |

`CAP-01@casual-v2` keeps Heart at speed 0.96 and adds pronunciation overrides
for API, npm, and URL. Captions keep the normal written terms. Connected
sentences and "type npm run demo" replace the repetitive instruction; the
payoff explicitly clears the filter to explain why all three products return.
No unplanned next episode is promised.

New video exports highlight complete code identifiers mentioned in the active
caption. Code stays fully visible at its existing size and position. This is
caption-level emphasis, not verified word-level alignment or continuous motion.
The original scripts and saved studio remain intact for comparison.

The first revised export measures 47.730 seconds, with a 1.950-second spoken
hook and 16 caption cues. Full decoding, 1080×1920 H.264/AAC at 30 fps, and audio
level checks pass (−16.14 LUFS). The rebuilt studio selects all twelve MP4s;
all 146 artifact hashes from the original eleven-video studio remain unchanged.
The full minimum-Node-22.13 checks/build pass: 166 workflow tests and five live
CAP checks. These results verify production integrity, not perceived delivery.

Generate the revision:

```sh
npm run shorts -- produce CAP-01@casual-v2 --serve
```

Then listen to the original and revised recordings, ideally without revealing
which is newer. Check the hook, both API occurrences, the command, and the
query-to-payoff transition. Do not label pronunciation or naturalness as audibly
verified until a listening review has occurred.

## Reusable audiovisual review

Upload one finished MP4 to [Gemini](https://gemini.google.com/) using **Add files
→ Upload files**. A localhost URL is only reachable on the creator's computer.
See [Google's supported uploads](https://support.google.com/gemini/answer/14903178?hl=en).

Suggested prompt:

> Review the complete attached SAP developer short as a video editor and audio
> producer. The intended narrator is a warm, knowledgeable colleague. Evaluate
> the actual audio and visuals; state explicitly if either is unavailable.
> Assess intonation, rhythm, pronunciation, pauses, dialogue transitions where
> applicable, phone readability, caption synchronization, hook, and payoff.
> Give up to five high-impact issues in a table: approximate timestamp, observed
> evidence, impact, and concrete fix. Distinguish observations from assumptions.
> Separate script, editing, visual, and voice-engine recommendations. Preserve
> what already works. Do not infer voice quality from captions or claim a
> different engine is required without explaining why simpler fixes fall short.

For a second pass, attach both versions and request an evidence-based comparison.
Treat AI judgments and timestamp estimates as review guidance. Retain a human
listening decision before sharing.
