#!/usr/bin/env python3
"""Build an escaped, offline comparison of saved four-stage local writing outputs."""
import argparse
import html
import json
import random
from pathlib import Path

NAMES = {"qwen38": "Qwen3.8 27B MLX 4-bit", "gemma31": "Gemma 4 31B IT MLX 4-bit", "muse": "Muse Glimmer 30B Q4_K_XL · low reasoning"}


def esc(value):
    return html.escape(str(value))


def speech(parsed):
    return "".join(f'<p><small>{esc(t["speakerId"])}</small>{esc(t["text"])}</p>' for t in parsed.get("turns", [])) or "<p>No usable spoken script.</p>"


def complete_bundle(bundle):
    expected = {c["id"] for c in bundle.get("briefs", {}).get("cases", [])}
    reports = bundle.get("reports", {})
    return bool(expected) and set(reports) == set(NAMES) and all(
        r.get("completedAt") and len(r["results"]) == len(expected) and
        {c["case"] for c in r["results"]} == expected for r in reports.values())


def diagnostics(bundle):
    diagnostic = bundle.get("qwenPenaltyDiagnostic", {})
    blocks = []
    for result in diagnostic.get("results", []):
        checks = result["checks"]
        blocks.append(f'<h3>{esc(result["case"])}</h3><p>{result["seconds"]}s · {checks["spokenWords"]} words · {len(checks["errors"])} contract issues</p>{speech(checks)}')
    probe = bundle.get("museDefaultProbe", {})
    probe_html = ""
    if probe:
        ideas, story = probe["ideation"], probe["story"]
        probe_html = f'<h3>Muse default reasoning probe</h3><p>Ideas: {ideas["seconds"]}s; first visible text at {ideas["firstVisibleSeconds"]}s. Spoken draft: {story["seconds"]}s, {len(story["content"])} visible characters, {esc(story["error"])}. Correction interrupted; this is excluded from the six-brief comparison. The separate low-reasoning run uses the documented system-prompt setting.</p>'
    if not blocks and not probe_html:
        return ""
    return '<details class="diagnostics"><summary>Separate configuration diagnostics · exploratory</summary><p>These reuse an already tested brief and do not replace the primary results. Qwen repeats the saved first-draft requests, changing only presence penalty from 1.5 to 0; no correction or visual-plan stage.</p>' + "".join(blocks) + probe_html + '</details>'


def card(label, alias, result, assessment):
    selected = result["transcript"]
    errors = result["ideaChecks"]["errors"] + selected["errors"] + result["boardChecks"]["errors"]
    issues = "".join(f"<li>{esc(e)}</li>" for e in errors)
    visual = result["boardChecks"].get("document", {})
    if not isinstance(visual, dict):
        visual = {}
    scenes = visual.get("scenes", [])
    if not isinstance(scenes, list):
        scenes = []
    def references(value):
        return ", ".join(str(x) for x in value) if isinstance(value, list) else "invalid"
    beats = "".join(f'<li><b>{esc(s.get("screenText", ""))}</b><br>{esc(s.get("visualBeat", ""))}<br><small>Turns: {esc(references(s.get("turnIds", [])))} · Facts: {esc(references(s.get("factIds", [])))}</small></li>' for s in scenes if isinstance(s, dict))
    rows = []
    for stage in result["stages"]:
        first = stage.get("firstVisibleSeconds")
        usage = stage.get("usage") or {}
        reasoning = usage.get("completion_tokens_details", {}).get("reasoning_tokens")
        rows.append(f'<tr><td>{esc(stage["stage"])}</td><td>{stage["seconds"]}s</td><td>{esc(first if first is not None else "none")}</td><td>{esc(reasoning if reasoning is not None else "unavailable")}</td></tr>')
    notes = assessment.get(label, {}).get(result["case"], {})
    observations = "".join(f'<li>{esc(n)}</li>' for n in notes.get("notes", []))
    return f'''<article data-case="{esc(result['case'])}" data-model="{esc(label)}">
<header><h2><span class="blind">Candidate {alias}</span><span class="named" hidden>{esc(NAMES[label])}</span></h2><span class="badge {'warn' if errors else ''}">{'Needs contract fixes' if errors else 'Contract checks passed'}</span></header>
<p class="metrics">{result['generationSeconds']}s across {len(result['stages'])} stages · {selected['spokenWords']} words · {selected['hookWords']}-word opening</p>
<h3>{esc(result['title'])}</h3><p class="notes">Selected {esc(result['selectedStage'])}. {esc(result['selectionReason'])}.</p>
<div class="speech">{speech(selected)}</div>
{f'<div class="observations"><b>{esc(notes.get("decision", "Editorial observations"))}</b><p>Review made with model identity known.</p><ul>{observations}</ul></div>' if observations else ''}
{f'<div class="issues"><ul>{issues}</ul></div>' if issues else ''}
<details><summary>Original spoken draft</summary><p>{result['draftChecks']['spokenWords']} words · {len(result['draftChecks']['errors'])} contract issues</p>{speech(result['draftChecks'])}</details>
<details><summary>Three proposed story angles</summary><pre>{esc(result['stages'][0]['content'])}</pre></details>
<details><summary>Visual plan · no video rendered</summary>{f'<ol>{beats}</ol>' if beats else '<p>No valid visual plan to display.</p>'}</details>
<details><summary>Timing and raw visible outputs</summary><table><thead><tr><th>Stage</th><th>Duration</th><th>First visible (s)</th><th>Reasoning tokens</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<p>Durations include reasoning, exclude model loading. Some runs overlap a model download; inspect the orchestration receipt. RSS is a helper-inclusive process proxy, not GPU memory.</p>
{''.join(f'<h4>{esc(s["stage"])}</h4><pre>{esc(s["content"])}</pre>' for s in result['stages'])}</details></article>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--export-bundle", type=Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.bundle:
        bundle = json.loads(args.bundle.read_text())
    else:
        reports = {}
        for label in NAMES:
            path = root / label / "report.json"
            if path.exists():
                reports[label] = json.loads(path.read_text())
        if not reports:
            parser.error("No workflow reports found")
        bundle = {"schemaVersion": 2, "reports": reports}
        fixture = Path(__file__).with_name("workflow-briefs.json")
        if fixture.exists():
            bundle["briefs"] = json.loads(fixture.read_text())
        for filename, key in [("orchestration.json", "orchestration"), ("assessment.json", "assessment"),
                              ("model-manifest.json", "modelManifest"), ("cap-evidence.holdout.json", "capEvidence"),
                              ("environment.json", "environment"),
                              ("qwen-penalty-diagnostic/report.json", "qwenPenaltyDiagnostic"),
                              ("muse-default-probe/probe.json", "museDefaultProbe")]:
            path = root / filename
            if path.exists():
                bundle[key] = json.loads(path.read_text())
    if args.export_bundle:
        if not complete_bundle(bundle):
            parser.error("Export requires every model to finish every frozen brief")
        args.export_bundle.parent.mkdir(parents=True, exist_ok=True)
        args.export_bundle.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
    reports = bundle["reports"]
    labels = list(reports)
    random.Random(27102026).shuffle(labels)
    aliases = {label: chr(65+i) for i, label in enumerate(labels)}
    cases = {}
    for report in reports.values():
        for result in report["results"]:
            cases[result["case"]] = result["title"]
    cards = "".join(card(label, aliases[label], result, bundle.get("assessment", {})) for label in labels for result in reports[label]["results"])
    tasks = "".join(f'<option value="{esc(key)}">{esc(title)}</option>' for key, title in cases.items())
    options = "".join(f'<option value="{esc(label)}" data-name="{esc(NAMES[label])}" data-blind="Candidate {aliases[label]}">Candidate {aliases[label]}</option>' for label in labels)
    evidence = "".join(f'<details data-evidence-case="{esc(c["id"])}"><summary>Source facts for this brief</summary><ul>{"".join(f"<li><b>{esc(key)}</b> {esc(value)}</li>" for key, value in c["facts"].items())}</ul><p>Sources: {esc(" · ".join(c.get("sources", [])))}</p></details>' for c in bundle.get("briefs", {}).get("cases", []))
    count = sum(len(r["results"]) for r in reports.values())
    complete = complete_bundle(bundle)
    result = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>SAP Shorts · Local writing workflow comparison</title><style>
:root{{font-family:system-ui,sans-serif;color:#213d35;background:#f6f7f0;line-height:1.6}}body{{margin:0}}main{{max-width:1400px;margin:auto;padding:32px}}h1{{font-size:clamp(28px,4vw,46px);line-height:1.15}}h2{{margin:0;font-size:22px}}h3{{font-size:21px}}.intro{{max-width:960px}}.eyebrow{{font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:750;color:#547267}}.toolbar{{position:sticky;top:0;z-index:1;padding:16px;background:#f6f7f0ef;backdrop-filter:blur(12px);display:flex;gap:20px;align-items:end;flex-wrap:wrap;border-block:1px solid #d2ded1;margin:26px 0}}label{{display:grid;gap:4px;font-size:13px}}select,button{{font:inherit;padding:10px;border:1px solid #afc3b5;border-radius:8px;background:white;color:#244d40;max-width:100%}}button{{background:#245944;color:white;cursor:pointer}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;align-items:start}}article{{padding:26px;border:1px solid #d2ded1;border-radius:16px;background:white}}article[hidden]{{display:none}}header{{display:flex;justify-content:space-between;gap:12px;align-items:start}}.badge{{font-size:11px;padding:4px 9px;background:#e6f1e5;border-radius:15px;white-space:nowrap}}.warn{{background:#fff0d5;color:#7f4b00}}.metrics,.notes{{font-size:13px;color:#5b7165}}.speech p{{font-size:17px;margin:15px 0}}small{{font-size:11px;color:#61786a}}.speech small{{display:block;font-weight:750;text-transform:uppercase}}details{{border-top:1px solid #e0e7db;padding:12px 0}}summary{{cursor:pointer;font-weight:650}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f1f5ed;padding:16px;max-height:480px;overflow:auto}}.issues{{font-size:13px;color:#814800}}.observations{{font-size:14px;background:#f1f5ed;border-radius:10px;padding:16px;margin:20px 0}}li{{margin:8px 0}}table{{border-collapse:collapse;width:100%;font-size:12px}}td,th{{text-align:left;padding:6px;border-bottom:1px solid #d2ded1}}footer{{max-width:1020px;font-size:13px;margin:40px 0}}@media(max-width:820px){{main{{padding:18px}}.grid{{grid-template-columns:1fr}}header{{display:block}}.toolbar{{gap:12px}}}}
</style></head><body><main><span class="eyebrow">SAP Shorts · local writing experiments · October 27, 2026</span><h1>Better scripts, one stage at a time.</h1>
<p class="intro">Compare actual local output: three angles, spoken narration, one correction, then a visual plan. The scene compiler copies the selected spoken turns exactly. No audio, portrait or video has been generated.</p>
<p class="intro"><b>Contract success is not factual or editorial approval.</b> Names begin hidden; candidate order is shuffled reproducibly. Editorial observations were made with model identities known. {'Complete comparison' if complete else 'Partial comparison'}: {count} saved workflows.</p>
<div class="toolbar"><label for="brief">Brief<select id="brief">{tasks}</select></label><label for="candidate">Candidate<select id="candidate"><option value="all">Compare all</option>{options}</select></label><button id="names" type="button" aria-pressed="false">Reveal model names</button><span id="count" role="status"></span></div>
{evidence}<div class="grid">{cards}</div>{diagnostics(bundle)}<footer><p>These are new story questions from one local CAP sample and dated SAP Connect source facts. This is a small single-workflow screen, not a measured retention study or a blind user-preference result. Preflight examples used to adjust the harness are excluded. Muse's low setting was selected after a failed default-setting probe on the first brief, so its entire run is not an untouched holdout. Word counts are not measured speech duration. Selected scripts and generated visuals still need source-aware review.</p><p>Compared with the first screen, both the workflow and sampling settings changed. Four-stage duration cannot be compared directly with one-shot drafting. Model load time, runtime settings, pinned model artifacts and any background download are recorded separately.</p></footer>
<script>const task=document.getElementById('brief'),candidate=document.getElementById('candidate'),names=document.getElementById('names');function filter(){{let n=0;document.querySelectorAll('article').forEach(card=>{{card.hidden=card.dataset.case!==task.value||(candidate.value!=='all'&&card.dataset.model!==candidate.value);if(!card.hidden)n++;}});document.querySelectorAll('[data-evidence-case]').forEach(x=>x.hidden=x.dataset.evidenceCase!==task.value);document.getElementById('count').textContent=n+(n===1?' candidate':' candidates');}}task.addEventListener('change',filter);candidate.addEventListener('change',filter);names.addEventListener('click',()=>{{const show=names.getAttribute('aria-pressed')!=='true';names.setAttribute('aria-pressed',String(show));names.textContent=show?'Hide model names':'Reveal model names';document.querySelectorAll('.named').forEach(x=>x.hidden=!show);document.querySelectorAll('.blind').forEach(x=>x.hidden=show);document.querySelectorAll('option[data-name]').forEach(x=>x.textContent=show?x.dataset.name:x.dataset.blind);}});filter();</script></main></body></html>'''
    (root / "comparison.html").write_text(result)
    print(root / "comparison.html")


if __name__ == "__main__":
    main()
