# Editorial pilot: a colleague explains CAP

October 27, 2026. Proposed writing/visual direction for review. This is a new
editorial example, not a replacement for CAP-01, a schema-importable episode, a
measured voice recording or a verified new video. All times below are provisional.

## Brief

- Viewer: a developer learning how a CAP service exposes an existing data model.
- Situation: the Products model exists; the developer needs the explicit API.
- Promise: show the connection between the model, service and actual query result.
- Tone: warm colleague, light situational humor. Let the demonstration earn attention.
- Format: a small debugging story with a prediction/reveal during the query.
- Presenter: retain the user's chosen voice and photo; do not select a replacement.

## Spoken draft

**Hook:** Nice model. Where's the API?

Products has an ID, a title, and stock. Lovely. Our inventory is organized.
Now let's give it a front door.

In this prepared CAP project, add InventoryService and project Products through
it. That's the connection between the data model and the endpoint.

See the read-only annotation? You can browse. No impulse purchases.

Type npm run demo, then open the Products URL. Three sample products.
Which ones survive a stock-above-zero filter?

The keyboard and dock. The monitor arm has zero stock, so it drops out.
Clear the filter, and all three return.

You've got a local OData version four endpoint. Deployment and authentication
are separate steps. Try the checked project—which entity would you expose first?

Keep API and other technical terms in the pronunciation glossary; the display
text should retain their normal spelling. Generate and listen to the opening in
the selected voice. Five words do not guarantee a measured duration below three
seconds. Revise wording or pacing if needed, without weakening the timing gate.

## Visual story

| Approximate time | What the viewer sees | What the narration contributes |
| --- | --- | --- |
| 0–3s | Products/model tile, endpoint tile, and a visibly missing connection. Hook headline: “Where's the API?” | A specific question rather than a topic introduction. |
| 3–10s | Three field labels appear on the model. Keep the missing connection visible. | Establishes the object and a familiar expectation. |
| 10–22s | Show the actual saved service file. Focus on the projection line; connect model → service → endpoint as it is explained. | Explains why that line matters. |
| 22–29s | Focus `@readonly`; show a query path. Any rejection indicator must use captured write-rejection evidence or be explicitly illustrative. | A short joke makes the read-only behaviour memorable. |
| 29–40s | Show the real command/URL, then the captured three-product table. Briefly invite the prediction. | Creates a reason to watch the result. |
| 40–49s | Apply a fixed animation based on the captured filter result: retain keyboard/dock and dim the zero-stock row. Restore the three-row capture when clearing the filter. | Pays off the question and explains the missing row. |
| 49–58s | Return to the completed connection and a small presenter reaction. Show “Local prototype” and the project action. | States the useful result, its limits and a concrete invitation. |

This direction needs the proposed story-plan/renderer enhancements. The current
editor cannot create all these timed visual events merely by changing narration.
Compile it deliberately into the supported scene contract, then measure actual
audio. Do not stretch or pad it just to fill the provisional timeline.

Use the presenter to establish the question and react to the result. During code
and query beats, give the explanation visual priority. Captions remain faithful
to speech; the main slide body can focus on the code/data rather than another
paragraph of narration. The MP4 prediction is timed; interactive controls belong
to the browser deck.

## Factual boundaries

The example uses the existing checked-in
[data model](../demos/cap/inventory/db/schema.cds),
[service](../demos/cap/inventory/srv/inventory-service.cds),
[sample rows](../demos/cap/inventory/db/data/demo-Products.csv) and
[assertions](../demos/cap/inventory/verify.cjs). The service explicitly exposes
Products and marks it read-only. The positive-stock query returns the keyboard
and dock; the monitor arm has zero stock. Re-run the live checks for a new
production. The missing-connection opening is an illustration of the lesson,
not a claimed capture of a failing request from the prepared complete project.

SAP's [service guide](https://cap.cloud.sap/docs/guides/services/providing-services)
supports the service projection concept. This local example does not establish
cloud deployment, production authentication or every CAP auto-exposure rule.

## A news angle worth trying

For the Q3 AI roundup, choose one question such as **“Who's doing the work?”**
instead of reading three extracted paragraphs. A possible opening is:

> Joule Work. Assistants. Agents. Even the org chart needs an org chart.

Then trace one clearly labelled billing illustration through the interface,
coordinator and task workers, using the
[official Q3 explanation](https://news.sap.com/2026/10/ai-release-highlights-q3-2026/)
as evidence. Preserve human oversight and the relevant availability qualifications.
This is an angle proposal, not a tested workflow or a claim about the viewer's
tenant. Offer a concise professional alternative when humor does not suit the
audience.
