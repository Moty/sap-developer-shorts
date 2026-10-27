#!/usr/bin/env python3
"""Export public-text benchmark receipts, with consistent checks and no raw reasoning.

Usage: collect-results.py artifacts/editorial-benchmark-YYYY-MM-DD output.json
Raw receipts remain unchanged. Input profiles are first-pass, refinement and thinking.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS = ["flint", "qwen38", "qwen36", "gemma4", "nemotron", "huihui"]
PROFILES = {"first-pass": ".", "refinement": "refinement", "thinking": "thinking"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("benchmark", HERE / "local-benchmark.py")
    bench = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bench)
    cases = {c["id"]: c for c in json.loads((HERE / "briefs.json").read_text())["cases"]}
    bundle = {"schemaVersion": 1, "environment": json.loads((args.directory / "environment.json").read_text()),
              "assessmentHarnessSha256": hashlib.sha256((HERE / "local-benchmark.py").read_bytes()).hexdigest(),
              "notes": ["Public SAP facts and synthetic fixtures only; no voice/photo inputs",
                        "One run per model/brief/profile; different runtimes and quantizations",
                        "Raw reasoning/SSE and exact requests remain in local ignored artifacts",
                        "Zero RSS samples from an unrecognized backend are exported as unavailable"],
              "profiles": {}}
    for profile, subdirectory in PROFILES.items():
        reports = {}
        for label in LABELS:
            path = args.directory / subdirectory / label / "report.json"
            if not path.exists():
                continue
            report = json.loads(path.read_text())
            if not report.get("completedAt"):
                raise RuntimeError("Do not export an incomplete run: " + str(path))
            if report.get("revisionOf"):
                report["revisionOf"] = label + "/cap-dialogue.json (first-pass)"
            for result in report["results"]:
                result["originalCheckErrors"] = result.get("checks", {}).get("errors", [])
                result["checks"] = bench.inspect(result, cases[result["case"]])
                if not result.get("backendRssPeakMiB"):
                    result["backendRssPeakMiB"] = None
                request = path.parent / (result["case"] + ".request.json")
                if request.exists():
                    result["savedRequestFileSha256"] = hashlib.sha256(request.read_bytes()).hexdigest()
            reports[label] = report
        if reports:
            bundle["profiles"][profile] = reports
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
