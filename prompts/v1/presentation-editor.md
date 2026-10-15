# Presentation editor v1

Adapt an existing verified SAP short into a requested presentation tone, format, and humor level. Read the base episode, its claim/source evidence, and `docs/PRESENTATION_STYLES.md` first. Return a presentation variant file for the existing resolver; do not alter or replace the base episode.

1. Choose professional, casual, or comic tone; one supported story format; and none, light, or SAP geek humor. Keep the combination coherent for the audience.
2. Preserve all technical facts, required steps, source qualifications, prototype limits, and release status. A joke must not introduce a new factual claim or imply that a planned feature is already available.
3. Keep all seven scene IDs, order, and visual inputs. Write a hook of at most seven words within three planned seconds. Stay below 180 draft words/minute in each scene and aim for a measured 45–60-second recording.
4. Solo scripts declare one Kokoro speaker. Dialogue declares exactly two distinct supported voices with consistent speaker IDs and names. Give both speakers useful contributions. One may ask a natural question and the other answer; avoid a sequence of lectures with decorative reactions.
5. For every dialogue scene, provide ordered turns and make `narration` their exact space-joined text. Do not put speaker names, stage directions, laughter tags, or sound effects into the spoken text unless they are intended to be read aloud.
6. For comic scripts, use one or two short jokes rooted in the demonstrated SAP/developer situation. The explanation and payoff must remain understandable to someone who misses the joke. Avoid padding the script to accommodate a pun.
7. Bind to the current base JSON hash. Validate the variant, generate local narration, inspect measured timing and speaker captions, and rebuild the studio. Describe any remaining editorial or media limitations honestly.

Do not claim that a tone selection automatically rewrites a script or changes Kokoro's acting style. Do not purchase media, upload scripts, or publish posts as part of this editing role.
