"""Isolated CUDA adapter for the existing normalized narration/alignment contract.

Setup runs only during a trusted image build. Generation loads pinned local
weights, accepts only staged local files, and has no network access.
"""
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import subprocess
import time


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def setup(root, config):
    from huggingface_hub import snapshot_download
    spec = json.loads(config.read_text())
    files = []
    for role, model in spec["models"].items():
        destination = root / "models" / role
        snapshot_download(model["repository"], revision=model["revision"], local_dir=destination,
                          allow_patterns=["*.json", "*.safetensors", "*.txt", "*.tiktoken", "README.md", "LICENSE*", "NOTICE*"])
        for path in sorted(destination.rglob("*")):
            if not path.is_file() or ".cache" in path.parts:
                continue
            if path.is_symlink():
                raise ValueError("Pinned model files must be regular files")
            os.utime(path, ns=(0, 0))
            files.append({"path": str(path.relative_to(root)), "sha256": digest(path),
                          "size": path.stat().st_size, "mtimeNs": "0"})
    packages = {name: importlib.metadata.version(name) for name in
                ["torch", "qwen-tts", "transformers", "numpy", "scipy", "soundfile"]}
    aligner_packages = json.loads(subprocess.check_output([str(root / "aligner-venv/bin/python"), "-c",
        "import json,importlib.metadata as m; print(json.dumps({n:m.version(n) for n in ['torch','qwen-asr','transformers','numpy','scipy','soundfile']}))"]))
    repository = Path(__file__).resolve().parents[2]
    pipeline = {name: digest(repository / name) for name in
                ["src/media/qwen.ts", "src/media/local-voices.ts", "src/media/audio.ts", "src/media/voice-profiles.ts"]}
    runtime = {"schemaVersion": 1, "pipelineHashes": pipeline, "engine": "qwen-cuda", "configHash": digest(config),
               "files": files, "packages": packages, "runnerHash": digest(Path(__file__)), "alignerPackages": aligner_packages,
               "alignerRunnerHash": digest(Path(__file__).with_name("qwen-cuda-align.py"))}
    root.mkdir(parents=True, exist_ok=True)
    (root / "runtime.json").write_text(json.dumps(runtime, sort_keys=True) + "\n")
    compatibility = hashlib.sha256(json.dumps(runtime, sort_keys=True).encode()).hexdigest()
    # The image's operator copies this digest into the approved provider config.
    (root / "compatibility.txt").write_text(compatibility + "\n")
    print("CUDA model inventory prepared. GPU inference still requires a real benchmark.")


def render(root, input_path, output_path, alignment_path):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import socket
    def offline(*_args, **_kwargs):
        raise RuntimeError("Inference network access is disabled")
    socket.socket.connect = offline
    socket.create_connection = offline
    import numpy as np
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    from math import gcd
    from qwen_tts import Qwen3TTSModel
    if not torch.cuda.is_available():
        raise ValueError("This adapter requires an NVIDIA CUDA GPU")
    started = time.monotonic()
    request = json.loads(input_path.read_text())
    runtime = json.loads((root / "runtime.json").read_text())
    if request.get("runtimeHash") != digest(root / "runtime.json") or runtime["runnerHash"] != digest(Path(__file__)):
        raise ValueError("The pinned CUDA runtime changed")
    for name, version in runtime["packages"].items():
        if importlib.metadata.version(name) != version:
            raise ValueError("A pinned CUDA dependency changed")
    torch.manual_seed(request.get("seed", 42))
    torch.set_num_threads(4)
    model = Qwen3TTSModel.from_pretrained(str(root / "models" / "tts"),
                                        device_map="cuda:0", dtype=torch.bfloat16)
    wavs, native_rate = model.generate_voice_clone(text=request["text"], language="English",
        ref_audio=request["sample"], ref_text=request["transcript"], x_vector_only_mode=False,
        temperature=0.7, max_new_tokens=min(4096, 128 + len(request["text"].split()) * 35))
    audio = np.asarray(wavs[0], dtype=np.float32)
    if not len(audio) or not np.isfinite(audio).all() or len(audio) / native_rate > 120:
        raise ValueError("CUDA speech output was invalid")
    divisor = gcd(22050, native_rate)
    audio = resample_poly(audio, 22050 // divisor, native_rate // divisor)
    peak = float(np.max(np.abs(audio)))
    if peak < 0.0001:
        raise ValueError("CUDA speech output was silent")
    sf.write(output_path, audio * min(1.0, 0.98 / peak), 22050, subtype="PCM_16")
    generation_seconds = time.monotonic() - started
    del model, wavs
    gc.collect()
    torch.cuda.empty_cache()
    subprocess.run([str(root / "aligner-venv/bin/python"), str(Path(__file__).with_name("qwen-cuda-align.py")),
                    str(root), str(input_path), str(output_path), str(alignment_path)], check=True, timeout=180)
    aligned = json.loads(alignment_path.read_text())
    aligned.update({"wavHash": digest(output_path), "generationSeconds": generation_seconds,
        "elapsedSeconds": time.monotonic() - started, "nativeSampleRate": native_rate,
        "peakMemoryBytes": max(aligned["peakMemoryBytes"], torch.cuda.max_memory_allocated())})
    alignment_path.write_text(json.dumps(aligned) + "\n")



if __name__ == "__main__":
    operation, location, *paths = sys.argv[1:]
    root = Path(location).resolve()
    if operation == "setup":
        setup(root, Path(paths[0]))
    elif operation == "render":
        render(root, *map(Path, paths))
    else:
        raise ValueError("Unknown CUDA operation")
