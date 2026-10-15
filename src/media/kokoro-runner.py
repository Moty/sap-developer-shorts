"""Optional local neural speech runtime; generation runs with HF networking disabled."""

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def setup(root, specification, voice, *additional_voices):
    from huggingface_hub import hf_hub_download

    spec = json.loads(Path(specification).read_text())
    runtime_path = root / "runtime.json"
    previous = json.loads(runtime_path.read_text()) if runtime_path.exists() else None
    installed = {}
    if previous:
        (root / "runtimes").mkdir(exist_ok=True)
        snapshot = root / "runtimes" / f"{digest(runtime_path)}.json"
        if not snapshot.exists():
            snapshot.write_bytes(runtime_path.read_bytes())
        if previous["repository"] == spec["repository"] and previous["revision"] == spec["revision"]:
            installed = previous.get("voices", {previous["voice"]: previous["files"].get("voice")})
    files = {}
    for name, filename in {
        "config": "config.json", "model": spec["model"],
    }.items():
        downloaded = Path(hf_hub_download(
            repo_id=spec["repository"], revision=spec["revision"], filename=filename,
        )).resolve()
        files[name] = {"path": str(downloaded.relative_to(root)), "sha256": digest(downloaded)}
    for selected in dict.fromkeys([voice, *additional_voices]):
        downloaded = Path(hf_hub_download(repo_id=spec["repository"], revision=spec["revision"],
                                          filename=f"voices/{selected}.pt")).resolve()
        installed[selected] = {"path": str(downloaded.relative_to(root)), "sha256": digest(downloaded)}
    packages = {
        item.metadata["Name"].lower().replace("_", "-"): item.version
        for item in importlib.metadata.distributions()
    }
    runtime = {"schemaVersion": 1, "engine": "kokoro", "repository": spec["repository"],
               "revision": spec["revision"], "voice": voice, "files": files, "voices": dict(sorted(installed.items())),
               "packages": dict(sorted(packages.items()))}
    write_json(root / "runtime.json", runtime)
    print(f"Local Kokoro voice is ready: {voice}.", flush=True)


def render(root, input_path, output_path, alignment_path):
    import numpy as np
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    from kokoro import KModel, KPipeline

    request_bytes = Path(input_path).read_bytes()
    request = json.loads(request_bytes)
    fingerprint = request["voiceRuntimeHash"]
    if len(fingerprint) != 64 or any(c not in "0123456789abcdef" for c in fingerprint):
        raise ValueError("Invalid neural runtime fingerprint")
    runtime_path = root / "runtimes" / f"{fingerprint}.json"
    if not runtime_path.exists():
        runtime_path = root / "runtime.json"
    runtime = json.loads(runtime_path.read_text())
    if digest(runtime_path) != request["voiceRuntimeHash"]:
        raise ValueError("Local voice runtime changed; create a new narration job")
    for name, expected in runtime["packages"].items():
        if importlib.metadata.version(name) != expected:
            raise ValueError(f"Local voice dependency changed: {name}; run voice-setup")
    paths = {}
    assets = {**runtime["files"], **{f"voice:{name}": asset for name, asset in runtime.get("voices", {}).items()}}
    for name, asset in assets.items():
        candidate = (root / asset["path"]).resolve()
        candidate.relative_to(root)
        if digest(candidate) != asset["sha256"]:
            raise ValueError("Local model or voice asset changed; run voice-setup")
        paths[name] = str(candidate)
    if runtime["voice"] != request["voice"]:
        raise ValueError("Requested voice differs from the installed voice")

    torch.set_num_threads(4)
    model = KModel(repo_id=runtime["repository"], config=paths["config"], model=paths["model"])
    cues = []
    audio_parts = []
    offset = 0
    segments = request.get("segments") or [request]
    pipelines = {}
    for index, segment in enumerate(segments):
        language = segment["voice"][0]
        if language not in ("a", "b"):
            raise ValueError("Only American and British English speaker profiles are supported")
        if language not in pipelines:
            pipelines[language] = KPipeline(lang_code=language, model=model, repo_id=runtime["repository"])
        voice_path = paths.get(f"voice:{segment['voice']}")
        if voice_path is None and segment["voice"] == runtime["voice"]:
            voice_path = paths.get("voice")
        if voice_path is None:
            raise ValueError("Speaker voice is not present in the pinned runtime")
        voice = torch.load(voice_path, map_location="cpu", weights_only=True)
        results = list(pipelines[language](segment["spokenText"], voice=voice,
                                           speed=request["speed"], split_pattern=None))
        if len(results) != 1:
            raise ValueError("A spoken turn must fit one continuous model segment; shorten it")
        result = results[0]
        samples = result.audio.numpy()
        if not len(samples) or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.001:
            raise ValueError("Neural voice produced empty or silent audio")
        samples = resample_poly(samples, 147, 160)
        samples = samples * min(1.0, 0.97 / float(np.max(np.abs(samples))))
        duration = len(samples) / 22050
        tokens = []
        cursor = 0
        reconstructed = ""
        for token in result.tokens or []:
            text = token.text + token.whitespace
            tokens.append({"left": cursor, "right": cursor + len(token.text),
                           "start": token.start_ts, "end": token.end_ts})
            reconstructed += text
            cursor += len(text)
        if reconstructed.strip() != segment["spokenText"]:
            raise ValueError("Model token text differs from the requested scene; alignment needs review")
        cursor = 0
        for phrase in segment["phrases"]:
            start = cursor
            stop = start + len(phrase["spokenText"])
            if segment["spokenText"][start:stop] != phrase["spokenText"]:
                raise ValueError("Caption phrase does not match the continuous spoken input")
            covered = [token for token in tokens if token["right"] > start and token["left"] < stop
                       and token["start"] is not None and token["end"] is not None]
            if not covered:
                raise ValueError("A caption phrase has no model timing")
            left, right = covered[0]["start"], covered[-1]["end"]
            if right > duration + 0.15 or left < 0 or right <= left:
                raise ValueError("Model caption timing exceeds the audio")
            left, right = min(left, duration), min(right, duration)
            if cues and offset + left < cues[-1]["endSeconds"]:
                raise ValueError("Model caption boundaries overlap; alignment needs review")
            cues.append({**phrase, "startSeconds": offset + left, "endSeconds": offset + right})
            cursor = stop + 1
        if cursor - 1 != len(segment["spokenText"]):
            raise ValueError("Caption phrases do not cover the scene")
        audio_parts.append(samples)
        offset += duration
        if index < len(segments) - 1:
            pause = np.zeros(round(22050 * 0.14), dtype=samples.dtype)
            audio_parts.append(pause)
            offset += len(pause) / 22050
    samples = np.concatenate(audio_parts)
    duration = len(samples) / 22050
    output = Path(output_path)
    temporary = output.with_suffix(".tmp.wav")
    sf.write(temporary, samples, 22050, subtype="PCM_16")
    temporary.replace(output)
    write_json(alignment_path, {"schemaVersion": 1, "sceneId": request["sceneId"],
               "inputHash": hashlib.sha256(request_bytes).hexdigest(),
               "wavHash": digest(output), "frames": len(samples), "cues": cues})
    print(json.dumps({"sceneId": request["sceneId"], "seconds": duration, "captions": len(cues)}), flush=True)


if __name__ == "__main__":
    mode, root_arg, *arguments = sys.argv[1:]
    runtime_root = Path(root_arg).resolve()
    os.environ["HF_HOME"] = str(runtime_root / "models")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    if mode == "setup":
        setup(runtime_root, *arguments)
    elif mode == "render":
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        render(runtime_root, *arguments)
    else:
        raise ValueError("Unknown neural voice operation")
