"""Pinned local Qwen Base inference. Enrollment input stays in private work space."""
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time
import urllib.request


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def setup(root, config):
    spec = json.loads(config.read_text())
    inventory = []
    for role, model in spec["models"].items():
        for entry in model["files"]:
            target = root / "models" / role / entry["name"]
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists() or digest(target) != entry["sha256"]:
                print(f"Downloading {role}/{entry['name']}", flush=True)
                url = f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{entry['name']}?download=true"
                temporary = target.with_name(target.name + ".partial")
                with urllib.request.urlopen(url, timeout=120) as response, open(temporary, "wb") as output:
                    while block := response.read(1024 * 1024):
                        output.write(block)
                if temporary.stat().st_size != entry["size"] or digest(temporary) != entry["sha256"]:
                    raise ValueError("Downloaded model checksum mismatch")
                temporary.replace(target)
            inventory.append({"path": str(target.relative_to(root)), "sha256": entry["sha256"],
                              "size": target.stat().st_size, "mtimeNs": str(target.stat().st_mtime_ns)})
    import mlx.core as mx
    if not mx.metal.is_available():
        raise ValueError("Qwen voice cloning requires Apple Silicon Metal")
    runtime = {"schemaVersion": 1, "engine": "qwen-mlx", "configHash": digest(config),
               "files": inventory, "packages": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}}
    (root / "runtime.json").write_text(json.dumps(runtime, indent=2) + "\n")
    print("Pinned Qwen and aligner assets verified; Metal available.", flush=True)


def render(root, input_path, output_path, alignment_path):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    # Inference is deliberately unable to make network connections.
    import socket
    def offline(*_args, **_kwargs):
        raise RuntimeError("Network access is disabled during local voice rendering")
    socket.socket.connect = offline
    socket.create_connection = offline
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    from mlx_audio.tts.utils import load_model
    started = time.monotonic()
    request = json.loads(input_path.read_text())
    if request.get("runtimeHash"):
        runtime_path = root / "runtime.json"
        if digest(runtime_path) != request["runtimeHash"]:
            raise ValueError("The voice runtime changed; start a new recording")
        runtime = json.loads(runtime_path.read_text())
        for name, version in runtime["packages"].items():
            if importlib.metadata.version(name) != version:
                raise ValueError("A pinned voice dependency changed; run voice-clone-setup")
    mx.random.seed(request.get("seed", 42))
    model = load_model(str(root / "models" / "tts"))
    print("Generating local speech", flush=True)
    results = list(model.generate(text=request["text"], ref_audio=request["sample"],
                                 ref_text=request["transcript"], lang_code="English",
                                 temperature=0.7, max_tokens=min(4096, 128 + len(request["text"].split()) * 35),
                                 verbose=False))
    if not results:
        raise ValueError("Qwen returned no speech")
    native = np.concatenate([np.asarray(result.audio, dtype=np.float32) for result in results])
    native_rate = results[0].sample_rate
    if not np.isfinite(native).all() or not len(native) or len(native) / native_rate > 120:
        raise ValueError("Qwen returned invalid or excessive audio")
    from math import gcd
    divisor = gcd(22050, native_rate)
    audio = resample_poly(native, 22050 // divisor, native_rate // divisor)
    peak = float(np.max(np.abs(audio)))
    if peak < 0.0001:
        raise ValueError("Qwen returned silent audio")
    audio = audio * min(1.0, 0.98 / peak)
    sf.write(output_path, audio, 22050, subtype="PCM_16")
    generation_seconds = time.monotonic() - started
    del model, results, native
    gc.collect()
    mx.clear_cache()
    print("Aligning local speech", flush=True)
    from mlx_audio.stt import load
    aligner = load(str(root / "models" / "aligner"))
    # This aligner's feature extractor expects actual 16 kHz samples.
    final_audio, _ = sf.read(output_path, dtype="float32")
    align_audio = resample_poly(final_audio, 320, 441).astype(np.float32)
    aligned = aligner.generate(audio=align_audio, text=request["text"], language="English")
    words = [{"text": item.text, "startSeconds": item.start_time, "endSeconds": item.end_time} for item in aligned]
    if not words:
        raise ValueError("Aligner returned no words")
    alignment_path.write_text(json.dumps({"words": words, "frames": len(final_audio),
        "wavHash": digest(output_path), "generationSeconds": generation_seconds,
        "elapsedSeconds": time.monotonic() - started, "peakMemoryBytes": mx.get_peak_memory(),
        "nativeSampleRate": native_rate, "alignmentSampleRate": 16000}) + "\n")


if __name__ == "__main__":
    operation, root_arg, *args = sys.argv[1:]
    root = Path(root_arg).resolve()
    if operation == "setup":
        setup(root, Path(args[0]))
    elif operation == "render":
        render(root, Path(args[0]), Path(args[1]), Path(args[2]))
    else:
        raise ValueError("Unknown Qwen operation")
