"""Separate ASR environment preserves upstream dependency pins without --no-deps."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
import socket

def offline(*_args, **_kwargs):
    raise RuntimeError("Alignment network access is disabled")
socket.socket.connect = offline
socket.create_connection = offline

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
import torch
from qwen_asr import Qwen3ForcedAligner
root, request_path, wav_path, output_path = map(Path, sys.argv[1:])
runtime = json.loads((root / "runtime.json").read_text())
if hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != runtime["alignerRunnerHash"]:
    raise ValueError("CUDA alignment code changed")
for package, version in runtime["alignerPackages"].items():
    if importlib.metadata.version(package) != version:
        raise ValueError("CUDA alignment dependencies changed")
request = json.loads(request_path.read_text())
audio, rate = sf.read(wav_path, dtype="float32")
if rate != 22050:
    raise ValueError("Alignment requires normalized narration")
model = Qwen3ForcedAligner.from_pretrained(str(root / "models/aligner"),
                                        device_map="cuda:0", dtype=torch.bfloat16)
items = model.align(audio=(resample_poly(audio, 320, 441).astype(np.float32), 16000),
                    text=request["text"], language="English")[0]
words = [{"text": item.text, "startSeconds": float(item.start_time),
          "endSeconds": float(item.end_time)} for item in items]
if not words:
    raise ValueError("Alignment returned no words")
output_path.write_text(json.dumps({"words": words, "frames": len(audio),
    "alignmentSampleRate": 16000, "peakMemoryBytes": torch.cuda.max_memory_allocated()}) + "\n")
