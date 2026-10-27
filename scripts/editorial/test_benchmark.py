"""Contract and evidence handling checks; no model, network or third-party imports."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


bench = module("benchmark", "local-benchmark.py")
gallery = module("gallery", "benchmark-report.py")
CASES = {c["id"]: c for c in json.loads((HERE / "briefs.json").read_text())["cases"]}


def review():
    return {"decision": "revision-required", "claims": [
        {"id": c["id"], "verdict": c["expected"], "reason": "Evidence checked."}
        for c in CASES["grounding-review"]["claims"]],
        "missingInformation": ["Publication date and customer entitlement are unknown."]}


def result(document):
    return {"content": json.dumps(document), "error": None, "finishReason": "stop"}


class EvidenceTests(unittest.TestCase):
    def test_expected_answers_never_enter_request(self):
        request = bench.payload(CASES["grounding-review"], "local-model")
        supplied = json.loads(request["messages"][1]["content"].split("BRIEF:\n")[1])
        self.assertTrue(all("expected" not in claim for claim in supplied["claims"]))
        self.assertIn("COMPLIANCE_OVERRIDE", supplied["facts"]["g3"])

    def test_all_grounding_verdicts_correct(self):
        checks = bench.inspect(result(review()), CASES["grounding-review"])
        self.assertEqual(checks["errors"], [])
        self.assertEqual(checks["groundingCorrect"], 4)

    def test_fenced_answer_keeps_format_failure_and_semantic_verdicts(self):
        receipt = result(review())
        receipt["content"] = "```json\n" + receipt["content"] + "\n```"
        checks = bench.inspect(receipt, CASES["grounding-review"])
        self.assertEqual(checks["groundingCorrect"], 4)
        self.assertEqual(checks["format"], "fenced-json")
        self.assertIn("JSON is wrapped in Markdown fences", checks["errors"])

    def test_wrong_or_duplicate_verdict_fails(self):
        document = review()
        document["claims"][0]["verdict"] = "supported"
        document["claims"].append(copy.deepcopy(document["claims"][1]))
        checks = bench.inspect(result(document), CASES["grounding-review"])
        self.assertEqual(checks["groundingCorrect"], 3)
        self.assertIn("Review must identify every claim exactly once", checks["errors"])

    def test_invalid_json_not_silently_repaired(self):
        receipt = {"content": '{"status":"draft",', "error": None, "finishReason": "length"}
        checks = bench.inspect(receipt, CASES["cap-casual"])
        self.assertEqual(checks["format"], "invalid")
        self.assertEqual(len(checks["errors"]), 2)

    def test_reasoning_only_completion_is_not_a_usable_answer(self):
        receipt = {"content": "", "reasoningCharacters": 3000, "error": None, "finishReason": "stop"}
        checks = bench.inspect(receipt, CASES["cap-dialogue"])
        self.assertIn("No visible final response", checks["errors"])
        self.assertNotIn("document", checks)

    def test_nested_type_error_cannot_pass(self):
        document = {"status": "draft", "ideas": [], "selectedAngle": "test", "title": "test",
                    "scenes": [{"id": "hook", "turns": "not an array", "screenText": "title",
                                "visualBeat": "show test", "factIds": []}], "editorNotes": "draft"}
        checks = bench.inspect(result(document), CASES["cap-casual"])
        self.assertTrue(any("turns must be array" in e for e in checks["errors"]))

    def test_native_schema_limits_speakers_and_fact_references(self):
        request = bench.payload(CASES["cap-dialogue"], "local-model", constrained=True)
        schema = request["response_format"]["json_schema"]["schema"]
        scene = schema["properties"]["scenes"]["items"]
        self.assertEqual(scene["properties"]["turns"]["items"]["properties"]["speakerId"]["enum"], ["alex", "sam"])
        self.assertNotIn("c1", scene["properties"]["factIds"]["items"]["enum"])

    def test_gallery_escapes_model_output_and_marks_missing_memory(self):
        receipt = {"case": "cap-casual", "content": '<script>alert("unsafe")</script>',
                   "seconds": 1, "backendRssPeakMiB": 0, "checks": {"errors": ["invalid JSON"]}}
        html = gallery.card("qwen38", 0, receipt)
        self.assertNotIn('<script>alert("unsafe")</script>', html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("unavailable for this backend", html)


if __name__ == "__main__":
    unittest.main()
