"""Meaningful contract checks for transcript preservation and local-only requests."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("workflow", HERE / "workflow-benchmark.py")
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)
report_spec = importlib.util.spec_from_file_location("workflow_report", HERE / "workflow-report.py")
report_view = importlib.util.module_from_spec(report_spec)
report_spec.loader.exec_module(report_view)
FIXTURE = json.loads((HERE / "workflow-briefs.json").read_text())
CASE = {"facts": {"k2": "Unit-test fixture: the response includes ID and title."},
        "evaluationNotes": ["Do not send this evaluator note to the model"]}


def transcript():
    lines = ["NARRATOR: Why is ID still here?"]
    body = [
        "I asked our local service for product titles, and the returned JSON had something extra.",
        "The identifier stayed beside each title, while stock was absent from the checked response.",
        "Three sample products remained in alphabetical order, including the keyboard, monitor arm and dock.",
        "That is a useful reminder to inspect the real output before describing an optimization.",
        "This observation belongs to our local CAP example, and does not describe every API.",
        "No production benchmark was performed here, so check the response before claiming measured savings. Choosing a field list and verifying the actual JSON are two separate steps worth remembering.",
    ]
    return workflow.parse_story("\n".join(lines + ["NARRATOR: " + t for t in body]), ["narrator"])


def board(turns):
    return {"title": "The extra field", "scenes": [
        {"id": scene, "turnIds": [turn["id"]], "screenText": "Inspect the response",
         "visualBeat": "Highlight the ID field in the captured JSON.", "factIds": ["k2"]}
        for scene, turn in zip(workflow.SCENES, turns)], "editorNotes": "Local example only."}


class WorkflowTests(unittest.TestCase):
    def test_non_loopback_and_redirect_origins_are_rejected(self):
        for origin in ["https://example.com", "http://localhost:1234", "http://127.0.0.1:1234/path",
                       "http://user@127.0.0.1:1234", "http://:secret@127.0.0.1:1234"]:
            with self.assertRaises(ValueError):
                workflow.loopback_origin(origin)
        self.assertEqual(workflow.loopback_origin("http://127.0.0.1:1234"), "http://127.0.0.1:1234")

    def test_notes_never_leak_to_model_brief(self):
        self.assertNotIn("evaluationNotes", workflow.public_case(CASE))
        self.assertEqual(workflow.public_case(CASE)["facts"], CASE["facts"])

    def test_transcript_counts_only_spoken_words(self):
        parsed = transcript()
        self.assertEqual(parsed["errors"], [])
        self.assertEqual(parsed["hookWords"], 5)
        self.assertEqual(len(parsed["turns"]), 7)
        self.assertTrue(all("NARRATOR:" not in t["text"] for t in parsed["turns"]))

    def test_plain_solo_narration_does_not_need_role_labels(self):
        original = transcript()
        text = "\n".join(t["text"] for t in original["turns"])
        parsed = workflow.parse_story(text, ["narrator"])
        self.assertEqual(parsed["turns"], original["turns"])
        self.assertEqual(parsed["errors"], [])

    def test_extra_commentary_and_invented_speaker_fail(self):
        parsed = workflow.parse_story("NARRATOR: A short hook.\n# Here is the explanation.\nROBOT: Surprise.", ["narrator"])
        self.assertEqual(len(parsed["turns"]), 1)
        self.assertTrue(any("Unexpected non-transcript" in e for e in parsed["errors"]))

    def test_invalid_revision_does_not_replace_valid_draft(self):
        valid = transcript()
        invalid = workflow.parse_story("NARRATOR: Too short.", ["narrator"])
        self.assertEqual(workflow.choose_story(valid, invalid)[0], "story")

    def test_compiler_preserves_text_and_speakers_exactly(self):
        turns = transcript()["turns"]
        checked = workflow.inspect_board(json.dumps(board(turns)), CASE, turns)
        self.assertEqual(checked["errors"], [])
        actual = [t for scene in checked["compiledScenes"] for t in scene["turns"]]
        self.assertEqual(actual, turns)

    def test_duplicate_or_reordered_turns_cannot_be_compiled(self):
        turns = transcript()["turns"]
        document = board(turns)
        document["scenes"][2]["turnIds"] = [turns[1]["id"]]
        checked = workflow.inspect_board(json.dumps(document), CASE, turns)
        self.assertIn("Every spoken turn must appear once, in order", checked["errors"])
        self.assertEqual(checked["compiledScenes"], [])

    def test_new_narration_field_and_unknown_fact_are_rejected(self):
        turns = transcript()["turns"]
        document = board(turns)
        document["scenes"][0]["narration"] = "A new unsupported sentence."
        document["scenes"][0]["factIds"] = ["made-up-fact"]
        checked = workflow.inspect_board(json.dumps(document), CASE, turns)
        self.assertTrue(checked["errors"])
        self.assertNotIn("compiledScenes", checked)

    def test_stage_sampling_and_request_boundaries(self):
        request = workflow.request("local-writer", "qwen38", [], "story")
        self.assertEqual(request["presence_penalty"], 1.5)
        self.assertEqual(request["reasoning_effort"], "none")
        self.assertNotIn("response_format", request)
        self.assertEqual(workflow.request("local-writer", "qwen38", [], "board")["temperature"], 0.2)

    def test_muse_low_uses_documented_system_prompt_without_mutating_messages(self):
        messages = [{"role": "system", "content": "Write a short."}, {"role": "user", "content": "Example"}]
        request = workflow.request("local-writer", "muse-low", messages, "story")
        self.assertTrue(request["messages"][0]["content"].startswith("Reasoning strength: low.\n"))
        self.assertEqual(messages[0]["content"], "Write a short.")
        self.assertNotIn("reasoning_effort", request)
        self.assertNotIn("chat_template_kwargs", request)

    def test_viewer_escapes_untrusted_output_and_survives_bad_visuals(self):
        parsed = transcript()
        parsed["turns"][0]["text"] = '<img src=x onerror="unsafe()">'
        result = {"case": "test", "title": "test", "transcript": parsed,
                  "ideaChecks": {"errors": []}, "draftChecks": transcript(),
                  "boardChecks": {"errors": ["Malformed plan"], "document": {"scenes": None}},
                  "selectedStage": "revision", "selectionReason": "Test fixture",
                  "generationSeconds": 1, "stages": [{"stage": "ideas", "seconds": 1,
                      "content": "<script>unsafe()</script>"}]}
        rendered = report_view.card("gemma31", "A", result, {})
        self.assertNotIn('<img src=x onerror="unsafe()">', rendered)
        self.assertIn("&lt;img", rendered)
        self.assertNotIn("<script>unsafe()</script>", rendered)

    def test_export_requires_all_models_and_every_brief(self):
        bundle = {"briefs": {"cases": [{"id": "one"}, {"id": "two"}]}, "reports": {
            name: {"completedAt": "test", "results": [{"case": "one"}, {"case": "two"}]}
            for name in report_view.NAMES}}
        self.assertTrue(report_view.complete_bundle(bundle))
        del bundle["reports"]["muse"]["results"][1]
        self.assertFalse(report_view.complete_bundle(bundle))


if __name__ == "__main__":
    unittest.main()
