# Editorial role prompts

The active versioned prompts are in [prompts/v1/](prompts/README.md):

1. [Scriptwriter](prompts/v1/scriptwriter.md)
2. [Technical reviewer](prompts/v1/technical-reviewer.md)
3. [Visual director](prompts/v1/visual-director.md)
4. [Distribution editor](prompts/v1/distribution-editor.md)

They replace the original prose approval markers, fixed 130–150-word rule, conflicting framing percentages, and blanket syntax judgments. The roles are separate editorial steps for a future provider adapter. No autonomous agent platform is running in this milestone.

The application validates episode inputs and runs independent technical checks; a model cannot establish execution success by approving a script. Read [the current implementation](README.md) and [development notes](docs/DEVELOPMENT.md) before wiring a provider.
