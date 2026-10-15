# Versioned editorial prompts

Prompt version: **1**. These define sequential editorial roles and a separate news-writing role in one future orchestrator. No model provider or autonomous agent fleet is connected in the current application.

1. [Scriptwriter](v1/scriptwriter.md): produces episode JSON from researched topics and verified code.
2. [Technical reviewer](v1/technical-reviewer.md): checks claims and reports evidence gaps.
3. [Visual director](v1/visual-director.md): plans composition using the shared pixel layout.
4. [Distribution editor](v1/distribution-editor.md): prepares channel copy from reviewed material.
5. [News editor](v1/news-editor.md): prepares dated announcement briefs using a separate news contract and source-review evidence.

The episode contract is `schemas/episode.schema.json`. Application checks and executable demo assertions are required regardless of a model's review result. Allow at most two script revision passes per generation job; if unresolved, return a specific revision request. Record prompt version, provider/model, sources, usage, and review results when the generation adapter is implemented.

News uses `schemas/news-episode.schema.json`, with availability, scope, and freshness checks. See [the news workflow](../docs/NEWS_WORKFLOW.md). These prompts are local editorial instructions; no model API is invoked by the current command-line workflow.
