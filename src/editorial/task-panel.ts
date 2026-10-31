/** Independent AI tools: selecting a task never starts a request. */
export function writingTaskPanel(): string {
  return `<div class="writing-workbench" aria-labelledby="writing-task-heading">
<div class="writing-task-heading"><h3 id="writing-task-heading">What would you like help with?</h3><p>Choose one independent task. You can use any of these on its own.</p></div>
<div class="writing-tasks" role="tablist" aria-label="AI task">${[
    ["ideas", "Find an angle", "3 hooks &amp; payoffs"],
    ["rewrite", "Rewrite script", "Narration, title &amp; post"],
    ["review", "Review script", "Feedback only"],
    ["presentation", "Design slides", "Headlines, layout &amp; motion"],
  ]
    .map(
      ([action, label, detail]) =>
        `<button type="button" role="tab" id="writing-${action}" data-writing-task="${action}" aria-selected="${action === "rewrite"}" aria-controls="writing-task-body" tabindex="${action === "rewrite" ? 0 : -1}"><strong>${label}</strong><small>${detail}</small></button>`,
    )
    .join("")}</div>
<div id="writing-task-body" role="tabpanel" aria-labelledby="writing-rewrite">
<div class="writing-task-scope"><div><span>Result</span><p id="writing-task-result">A proposal for the title, narration and on-screen text, with companion copy when returned.</p></div><div><span>How to use it</span><p id="writing-task-next">Compare the proposal, apply it to your draft, then Save draft. Produce later to hear the new narration.</p></div></div>
<div class="writing-request-fields"><label for="writing-style"><span id="writing-style-label">Narration wording style</span><select id="writing-style" aria-labelledby="writing-style-label" aria-describedby="writing-style-help"><option value="conversational">Warm &amp; conversational</option><option value="professional">Professional &amp; clear</option><option value="comic">Playful · SAP geek humor</option></select><small id="writing-style-help">Guides this rewrite’s words. Your narrator voice and episode delivery format stay as selected.</small></label><label for="writing-direction"><span id="writing-direction-label">Optional rewrite direction</span><textarea id="writing-direction" maxlength="1200" rows="3" placeholder="Make the opening sound like a colleague asking a useful question. Keep one light SAP joke."></textarea></label></div>
<div id="writing-visual-hints" hidden><p class="writing-help">Add a slide-design hint to the instruction. These buttons do not generate or apply anything.</p><div class="writing-buttons" aria-label="Slide-design hints"><button type="button" data-visual-direction="Explain the mechanism with two or three steps on explanatory scenes.">Show steps</button><button type="button" data-visual-direction="Contrast two source-backed ideas with a comparison on explanatory scenes.">Compare ideas</button><button type="button" data-visual-direction="Use one memorable callout on explanatory scenes.">Strong callout</button></div></div>
<div class="writing-cost" id="writing-cost" role="note" hidden><strong>SAP Hyperspace usage may incur cost.</strong><p>Running the selected task sends your script and source context to the selected service. Photos, voice recordings and voice profiles are never sent.</p></div>
<div class="writing-run-row"><button type="button" id="writing-run" data-writing-action="rewrite" aria-describedby="writing-request-help writing-hint">Generate rewrite proposal</button><button type="button" id="writing-cancel" hidden>Cancel request</button><p id="writing-request-help" class="writing-help">Uses the current draft, story brief, selected style and instruction. A rewrite uses a draft and one correction request.</p></div>
<p class="writing-help writing-request-boundary">Selecting a task or changing these fields does not edit your episode or start an AI request. Generated proposals appear below for you to review.</p><p id="writing-hint" class="writing-hint" role="status" aria-live="polite" hidden></p>
</div></div>`;
}
