#!/usr/bin/env python3
"""Render saved local benchmark receipts as a portable, escaped HTML comparison."""
import argparse
import html
import json
import re
from pathlib import Path

NAMES = {"flint": "Flint Q4_K_M", "qwen38": "Qwen3.8 27B MLX 4-bit",
         "qwen36": "Qwen3.6 35B A3B Q6_K", "gemma4": "Gemma 4 E4B Q4_K_M",
         "nemotron": "Nemotron 3 Nano Omni Q4_K_M", "huihui": "Huihui Qwen3.8 27B Q4_K_S"}
CASES = {"cap-casual": "Casual CAP tutorial", "news-professional": "Professional SAP news",
         "cap-dialogue": "Comic developer dialogue", "grounding-review": "Factual review challenge"}


def esc(value):
    return html.escape(str(value))


def card(label, index, result):
    checks = result.get("checks", {})
    document = checks.get("document", {})
    if not isinstance(document, dict):
        document = {}
    errors = checks.get("errors", [])
    name = NAMES.get(label, label)
    paragraphs, beats = [], []
    scenes = document.get("scenes", [])
    for scene in scenes if isinstance(scenes, list) else []:
        if not isinstance(scene, dict):
            continue
        turns = scene.get("turns", [])
        for turn in turns if isinstance(turns, list) else []:
            if not isinstance(turn, dict):
                continue
            paragraphs.append(f'<p><small>{esc(turn.get("speakerId", ""))}</small>{esc(turn.get("text", ""))}</p>')
        beats.append(f'<li><b>{esc(scene.get("screenText", ""))}</b> {esc(scene.get("visualBeat", ""))}</li>')
    if not paragraphs:
        extracted = []
        if not document:
            for match in re.finditer(r'"text"\s*:\s*("(?:\\.|[^"\\])*")', result.get("content", "")):
                try:
                    extracted.append(json.loads(match.group(1)))
                except json.JSONDecodeError:
                    pass
        if extracted:
            paragraphs = ['<p class="issues">Narration extracted for reading from invalid JSON. The original still fails the format check.</p>']
            paragraphs.extend(f'<p>{esc(text)}</p>' for text in extracted)
        else:
            paragraphs = [f'<pre>{esc(json.dumps(document, ensure_ascii=False, indent=2) if document else result.get("content") or result.get("error") or "No visible answer")}</pre>']
    idea_list = document.get("ideas", [])
    ideas = "".join(f'<li><b>{esc(x.get("hook", ""))}</b> {esc(x.get("angle", ""))} → {esc(x.get("payoff", ""))}</li>' for x in (idea_list if isinstance(idea_list, list) else []) if isinstance(x, dict))
    issues = "".join(f'<li>{esc(error)}</li>' for error in errors)
    usage = result.get("usage") or {}
    reason = usage.get("completion_tokens_details", {}).get("reasoning_tokens")
    first_visible = result.get("firstVisibleSeconds")
    first_label = f'{first_visible}s' if first_visible is not None else 'no final text'
    metrics = f'{result.get("seconds")}s · first visible {first_label}'
    if "spokenWords" in checks:
        metrics += f' · {checks["spokenWords"]} spoken words'
    if reason is not None:
        metrics += f' · {reason} reasoning tokens'
    if checks.get("groundingTotal"):
        metrics += f' · {checks["groundingCorrect"]}/{checks["groundingTotal"]} claim verdicts correct'
    rss = result.get("backendRssPeakMiB")
    rss_label = f'{rss} MiB' if rss else 'unavailable for this backend'
    return f'''<article data-case="{esc(result["case"])}" data-model="{esc(label)}">
<header><div><span class="eyebrow">{esc(CASES.get(result["case"], result["case"]))}</span>
<h2><span class="blind">Model {chr(65 + index)}</span><span class="named" hidden>{esc(name)}</span></h2></div>
<span class="badge {'warn' if errors else ''}">{len(errors)} structural/check issues</span></header>
<p class="metrics">{esc(metrics)}</p>{f'<h3>{esc(document["title"])}</h3>' if document.get("title") else ''}
<div class="script">{"".join(paragraphs)}</div>
{f'<details><summary>Three story ideas</summary><ol>{ideas}</ol></details>' if ideas else ''}
{f'<details><summary>Visual directions</summary><ol>{"".join(beats)}</ol></details>' if beats else ''}
{f'<div class="issues"><ul>{issues}</ul></div>' if issues else ''}
<p class="notes">{esc(document.get("editorNotes", ""))}</p>
<details><summary>Raw response and measured receipt</summary><p>Backend process RSS proxy: {esc(rss_label)}. This is not GPU/unified memory allocation.</p>
<a href="{esc(label)}/{esc(result['case'])}.json">Open saved receipt</a><pre>{esc(result.get("content", ""))}</pre></details></article>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--bundle", type=Path, help="Replay a checked-in measurement bundle without a model")
    parser.add_argument("--profile", default="first-pass")
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    bundled = None
    if args.bundle:
        bundle = json.loads(args.bundle.read_text())
        bundled = bundle["profiles"].get(args.profile)
        if not bundled:
            parser.error("Unknown or empty bundle profile")
    reports = []
    for label in NAMES:
        path = directory / label / "report.json"
        if bundled and label in bundled:
            report = bundled[label]
            reports.append((label, report))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(report, indent=2) + "\n")
            for result in report["results"]:
                if result["case"] not in CASES:
                    parser.error("Unknown case in bundle")
                (path.parent / (result["case"] + ".json")).write_text(json.dumps(result, indent=2) + "\n")
        elif not bundled and path.exists():
            reports.append((label, json.loads(path.read_text())))
    if not reports:
        parser.error("No benchmark reports found")
    cards = "".join(card(label, i, result) for i, (label, report) in enumerate(reports)
                    for result in report["results"])
    present = {r["case"] for _, report in reports for r in report["results"]}
    options = "".join(f'<option value="{esc(key)}">{esc(value)}</option>' for key, value in CASES.items() if key in present)
    models = "".join(f'<option value="{esc(label)}" data-name="{esc(NAMES[label])}" data-blind="Model {chr(65 + i)}">Model {chr(65 + i)}</option>' for i, (label, _) in enumerate(reports))
    rows = "".join(f'<tr><td>{esc(NAMES[label])}</td><td>{esc(result["case"])}</td><td>{result["seconds"]}</td><td>{esc(result.get("firstVisibleSeconds"))}</td><td>{len(result.get("checks", {}).get("errors", []))}</td></tr>' for label, report in reports for result in report["results"])
    follow_up = any(report.get("revisionOf") for _, report in reports)
    notice = 'This is a follow-up: one revision with explicit technical feedback and native JSON-schema constraints. It is a different task from the first pass.' if follow_up else 'First pass: the same briefs, source facts and sampling settings for all candidates; thinking capability and runtime differ.'
    run_date = min(report.get("startedAt", "unknown") for _, report in reports)[:10]
    output = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>SAP Shorts · Local writing comparison</title><style>
:root{{font-family:system-ui,sans-serif;color:#213d35;background:#f6f7f0;line-height:1.6}}
body{{margin:0}}main{{max-width:1380px;margin:auto;padding:32px}}h1{{font-size:clamp(28px,4vw,46px);line-height:1.15;margin:8px 0 16px}}h2{{margin:2px 0;font-size:23px}}h3{{font-size:20px}}.intro{{max-width:900px}}.eyebrow{{text-transform:uppercase;letter-spacing:.11em;font-size:11px;font-weight:700;color:#587568}}
.toolbar{{position:sticky;top:0;z-index:1;padding:16px;background:#f6f7f0ee;backdrop-filter:blur(12px);display:flex;gap:20px;align-items:end;border-block:1px solid #d5dfd2;margin:24px 0;flex-wrap:wrap}}label{{display:grid;gap:4px;font-size:13px}}select,button{{font:inherit;padding:10px;border:1px solid #b7c9bd;border-radius:8px;background:white;color:#244d40}}button{{cursor:pointer;background:#245944;color:white}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;align-items:start}}article{{padding:26px;border:1px solid #d5dfd2;border-radius:16px;background:white}}article[hidden]{{display:none}}header{{display:flex;justify-content:space-between;gap:16px;align-items:start}}.badge{{font-size:11px;border-radius:15px;background:#e4f1e5;padding:5px 9px;white-space:nowrap}}.warn{{background:#fff1d7;color:#7b4b05}}.metrics,.notes{{font-size:13px;color:#5b7165}}.script p{{font-size:17px;margin:16px 0}}.script small{{display:block;color:#6b8174;font-size:11px;text-transform:uppercase;font-weight:700}}details{{border-top:1px solid #e4e9df;padding:12px 0}}summary{{cursor:pointer;font-weight:650}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f2f5ef;padding:16px;max-height:420px;overflow:auto}}li{{margin:10px 0}}.issues{{font-size:13px;color:#824900}}a{{color:#235b49}}table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{border-bottom:1px solid #d5dfd2;padding:10px;text-align:left}}footer{{margin:40px 0;font-size:13px;max-width:980px}}@media(max-width:800px){{main{{padding:18px}}.grid{{grid-template-columns:1fr}}header{{display:block}}.toolbar{{gap:12px}}}}
</style></head><body><main><span class="eyebrow">SAP Shorts · local model experiment · {esc(run_date)}</span><h1>Which script would you watch?</h1>
<p class="intro">Compare actual local model output for the same brief. Names start hidden so you can judge the writing first. These are script and storyboard drafts; no narration or portrait video has been rendered.</p>
<p class="intro">{esc(notice)}</p>
<p class="intro"><strong>Zero structural issues does not mean the facts or writing are approved.</strong> These drafts still need editorial review.</p>
<div class="toolbar"><label>Brief<select id="case">{options}</select></label><label>Candidate<select id="model"><option value="all">Compare all</option>{models}</select></label><button id="names" type="button" aria-pressed="false">Reveal model names</button><span id="count" role="status"></span></div>
<div class="grid">{cards}</div><footer><p>Each candidate receives the same source facts, creative brief and draft constraints. A successful structure check does not establish factual accuracy, funny dialogue or an engaging video. This is a small single-run screening; editorial observations and timing measurements are separate.</p><p>Thinking settings and response budgets are recorded in each request. First-visible time includes any preceding reasoning. Model load time is separate; OS caches were not controlled. The initial 4,096-token Flint probe is preserved separately; interrupted partial requests are not scored. Process RSS is a proxy and excludes some GPU/Metal allocation.</p>
<details><summary>All measured results · reveals model identities</summary><table><thead><tr><th>Model</th><th>Brief</th><th>Total seconds</th><th>First visible</th><th>Check issues</th></tr></thead><tbody>{rows}</tbody></table></details></footer>
<script>const task=document.getElementById('case'),model=document.getElementById('model'),names=document.getElementById('names');function filter(){{let n=0;for(const card of document.querySelectorAll('article')){{card.hidden=card.dataset.case!==task.value||(model.value!=='all'&&card.dataset.model!==model.value);if(!card.hidden)n++;}}document.getElementById('count').textContent=n+(n===1?' candidate':' candidates');}}task.addEventListener('change',filter);model.addEventListener('change',filter);names.addEventListener('click',()=>{{const show=names.getAttribute('aria-pressed')!=='true';names.setAttribute('aria-pressed',String(show));names.textContent=show?'Hide model names':'Reveal model names';document.querySelectorAll('.named').forEach(x=>x.hidden=!show);document.querySelectorAll('.blind').forEach(x=>x.hidden=show);document.querySelectorAll('#model option[data-name]').forEach(x=>x.textContent=show?x.dataset.name:x.dataset.blind);}});filter();</script></main></body></html>'''
    (directory / "comparison.html").write_text(output)
    summary = [{"label": label, "name": NAMES[label], "model": report["model"],
                "results": [{k: v for k, v in r.items() if k not in ["content", "checks"]} |
                            {"errors": r.get("checks", {}).get("errors"), "spokenWords": r.get("checks", {}).get("spokenWords"),
                             "groundingCorrect": r.get("checks", {}).get("groundingCorrect"), "groundingTotal": r.get("checks", {}).get("groundingTotal")}
                            for r in report["results"]]} for label, report in reports]
    (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(directory / "comparison.html")


if __name__ == "__main__":
    main()
