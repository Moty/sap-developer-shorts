# Writing engines: local Gemma and SAP Hyperspace AI

Implemented October 27, 2026 for the **local studio and desktop source build**.
This is an optional writing assistant for existing source-backed scripts. It
suggests three angles, proposes revised narration/headlines, and reviews wording
and source alignment. It does not automatically research new sources, change
the visual plan, generate speech, render a video, or publish anything.

## Configure it in the UI

1. Start the rebuilt local studio and open **Writing engine** in the sidebar.
2. Choose **Local · LM Studio** or **SAP Hyperspace AI · LiteLLM**.
3. Expand **Connection & API key** to change the local service address. For
   Hyperspace, paste its proxy key and choose **Save setup & test connection**.
   The form clears the key after saving; it never reads the saved value back.
4. Use **Check connection & refresh models**, choose an advertised chat model,
   and **Save writing preference**. Model IDs are preserved exactly, including
   suffixes such as `[1m]`. Embedding/speech models cannot be used as writers.
5. Open a short's editor, choose **Script**, and expand **Writing assistant**.
   Select a wording style and, optionally, a concrete direction. Choose
   **Suggest 3 angles**, **Draft / rewrite script**, or **Review current script**.
6. Compare a rewrite with the current title, headlines and narration, then choose
   **Apply wording to this editor**. Review it and use the existing **Save draft**
   action when ready. Applying wording alone does not save or produce an episode.

Setup is available entirely through the UI. There is no terminal command needed
to select a provider, switch models, replace/remove a proxy key, or run a writing
request. The underlying LM Studio or Hyperspace application must already be
installed and running on the same Mac as the studio server.

## Local option

The default provider is local. **Gemma 4 31B IT** is the provisional recommendation
from the [measured local comparison](LOCAL_MODEL_WORKFLOW_RESULTS.md), not a
guarantee of factual or editorial quality. In LM Studio, load the downloaded
model with a suitable bounded context and start its local API server. The
default address is `http://127.0.0.1:1234/v1`.

Discovery uses both the OpenAI-compatible model catalog and LM Studio's native
loaded-instance metadata. Downloaded models remain visible, but writing requires
the selected instance to be loaded. Refresh the catalog after loading it. If LM
Studio gives the instance a custom identifier, select that advertised identifier.
The assistant never downloads weights, loads/unloads models, changes their memory
configuration, or substitutes another model. LM Studio remains responsible for
model lifetime and memory. Avoid keeping large writer and rendering models loaded
together; request admission shares the studio's heavy-model gate, but it cannot
reserve memory against unrelated LM Studio clients.

Gemma uses the tested temperature `1.0`, top-p `0.95`, top-k `64`, and requested
non-thinking profile, with a bounded output budget. Other local chat models can
be selected, but their SAP writing quality and runtime settings are not certified
by this integration. There is **no automatic Hyperspace fallback**.

## SAP Hyperspace option and costs

Run Hyperspace AI and its LLM Proxy on the SAP Mac. The LiteLLM base is
`http://127.0.0.1:6655/litellm/v1`, not `/v1` directly. The server discovers models
with authenticated `GET /models` and sends standard chat requests to
`POST /chat/completions`, using the selected model ID and Bearer authentication.
The active account's catalog determines the choices; the application does not
maintain a copied model list or choose an expensive model automatically.

The UI explains that the local gateway forwards text to a downstream service.
**Every Hyperspace writing request requires an explicit cost acknowledgment**;
the checkbox resets after submission. Ideas and reviews make one completion
request. Rewriting makes a draft and one correction request, so it can incur
charges for two completions. There are no hidden inference retries or provider
switches. The selected provider/model is frozen for each admitted job.

Receipts show elapsed generation time, submitted attempts and provider-reported
input/output/total tokens. Missing counts are displayed as unavailable, never as
zero. These are usage observations, **not a dollar-price estimate**. Hyperspace's
account pricing, quota and billing determine actual charges. Canceling or timing
out may not cancel work already processed downstream, and may still incur cost.

Only the current title/headlines/narration, user-entered writing direction, and
the saved episode's minimal source/claim/availability/visual-subject context enter
the prompt. Voice samples, profile identifiers, photos, face landmarks, media
paths and companion posts are excluded. Text typed into the script or direction
is still text sent to the selected provider; review it before acknowledging use.

The user-provided [Hyperspace endpoint guide](https://ai-docs.portal.hyperspace.tools.sap/llm-proxy/configuration/api-endpoints/)
was inspected through its supplied screenshot; this development environment
could not resolve the internal documentation host. The actual running local
proxy independently verified the LiteLLM route, authentication, model discovery
and chat completions. Model availability can change; use **Refresh models**.

## Other AI tasks and voice support

**Review current script** is an additional use of either writing engine. It
checks conversational delivery, clarity and alignment with supplied source
context. It does not listen to the audio, inspect the video, re-fetch sources,
or approve factual correctness. Treat feedback as suggestions.

The inspected proxy catalog advertised chat/text and embedding models, with no
speech-generation model or documented speech endpoint. Consequently, voice
rendering stays with **Kokoro (Heart remains the default)** or personal-voice
Qwen, and realistic portraits stay with Ditto. No voice sample is uploaded to
Hyperspace. A future speech adapter needs an advertised supported endpoint,
voice/privacy controls, and its own explicit cost consent; a chat model name is
not evidence of speech-generation capability.

## Preservation and failure behavior

- Proposals retain the seven existing scene IDs, order, timings and speaker-turn
  slots. The model can author only a title, headlines and spoken words. Voices,
  portraits, pronunciation, visual/code assets, claims, dates, version name and
  companion post stay intact. Rewrites undergo output checks and full episode
  validation before they can be applied.
- Hooks, narration length and per-scene word budgets are writing checks, not
  measured audio guarantees. Production still measures the selected voice and
  can request a timing edit. Sources and technical scope still need human review.
- If correction fails validation or transport but the first draft was valid, the
  first proposal is kept with a visible warning. Explicit cancellation does not
  publish that intermediate result as a completed proposal.
- The canonical source hash, original editor snapshot and settings hash prevent
  applying a proposal to another episode, overwriting later edits, or silently
  starting with a model changed in another tab. A stale result remains readable
  for comparison. The editor checks again immediately before applying.
- One writing job runs per workspace. A transaction lease coordinates multiple
  local preview processes. Restarted jobs become interrupted only after their
  owner has released the lease. They are never replayed automatically.
- **Recent writing requests** shows the newest twelve requests, their episode,
  model, outcome and times, with links back to the matching script. Closing a
  browser tab does not stop server work. Cancel targets the active request, even
  while viewing an older result. A stopped studio can interrupt a request.

## Storage, boundaries and development

Preferences live in `.state/editorial/settings.json`; safe receipts and generated
text live in `.state/editorial/jobs/`, with a separate SQLite admission lease.
These are private per-workspace data, ignored by Git. The API key is kept in this
Mac's Keychain under the `editorial-hyperspace` account using the existing native
helper. It is not in settings, scripts, receipts, prompts, exports or browser
recovery. Remove or replace it from the connection panel. A terminal deployment
can instead set `SHORTS_HYPERSPACE_API_KEY` server-side; the UI identifies that
override and requires its removal before editing the Keychain credential.

Only HTTP loopback service URLs and the two known provider base paths are
accepted. Transport does not follow redirects or use a system forwarding proxy,
and bounds response bytes and request time. Upstream errors are sanitized. The
browser calls only its own studio server; it never receives the saved key.
Writing routes require the same local session and same-origin JSON protections
as other local studio actions. Preview sessions use distinct cookie names so
different localhost ports do not overwrite one another's session cookie.

This implementation is for the local studio. The Firebase hosted private
workspace does not yet expose these writing controls or dispatch writing jobs to
registered Macs. `localhost` means the Mac running the studio server, not an
arbitrary browser user's machine. Existing registered rendering workers and
personal voice/photo behavior are unchanged.

Code is in `src/editorial/`, with a shared panel and browser template. Test
coverage includes transport/authentication, secrets, source/media boundaries,
schemas, correction fallback, races, cancellation, restart recovery and editor
preservation. Use Node 22.13+ for project checks. This source update does not
create or publish a new installer.

## Validation evidence

Live integration checks used the running Hyperspace proxy's catalog (32 entries,
including three embeddings disabled for writing) and public CAP tutorial text:

- `gemini-3.8-flash`: three valid story angles, 9.9s, 2,172 reported total tokens.
- `claude-sonnet-4-6`: valid rewrite applied to unsaved editor fields; two
  completions, 8.0s combined, 962 reported total tokens. Its correction failed
  output checks, and the valid first proposal was retained and labeled.
- `gpt-6.1-sol`: valid structured editorial feedback on the revised text, 29.2s,
  2,282 reported total tokens.
- Local Gemma 4 31B IT: three valid story angles through the same production
  adapter, 24.3s, 1,344 reported total tokens. The smoke test held both repository
  and desktop heavy-model gates, loaded only Gemma, then restored the original
  idle Flint instance with its 262,144 context and parallelism of four.

These are integration checks, not a comparative quality ranking or pricing
benchmark. Provider-reported token counts are retained as reported. No episode
was saved, rendered or published by these live checks.

Validation: all 318 Node 22 tests, 12 desktop tests, five live CAP checks,
TypeScript checking/build and content validation passed. Scoped Biome checks for
all changed code passed. The repository-wide `npm run check` stops at pre-existing
formatting/lint errors in news code/content and additional local user content;
those files were not reformatted as part of this feature. The content-contract
test now requires the four seed episodes and unique IDs while allowing additional
valid saved episodes, so a populated studio can run the suite.
