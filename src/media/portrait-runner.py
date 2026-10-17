"""On-device Ditto audio-to-motion and learned portrait rendering.

Uses pinned upstream components sequentially to bound memory and propagate errors.
The 25 Hz motion coefficients are interpolated before rendering at the output fps.
No network calls are made by this runner.
"""

import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import pickle
import random
import sys
import time

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MPLCONFIGDIR", str(Path(__file__).resolve().parents[2] / ".state/portrait-runtime/matplotlib"))

PROJECT = Path(__file__).resolve().parents[2]
PROFILES = {
    "calm": {"pose": 0.35, "limit": 5.0},
    "conversational": {"pose": 0.65, "limit": 8.0},
    "expressive": {"pose": 0.9, "limit": 11.0},
}


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n")
    temporary.replace(path)


def verified_spec(root):
    spec = json.loads((PROJECT / "config/portrait-runtime.json").read_text())
    for item in spec["files"]:
        path = root / "checkpoints" / item["path"]
        if not path.is_file() or path.stat().st_size != item["size"] or digest(path) != item["sha256"]:
            raise ValueError(f"Portrait model missing or changed: {item['path']}. Run talking-head-setup.")
    return spec


def load_components(root):
    import numpy as np
    import torch

    torch.set_num_threads(4)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    sys.path.insert(0, str(root / "source"))
    # Upstream's auxiliary factory consumes device without passing it to the
    # ONNX classes. Explicitly use CPU sessions on this local Metal pipeline.
    import importlib
    import inspect
    loader = importlib.import_module("core.utils.load_model")
    def local_aux(model_path, device="cpu", module_name="", package_name="..aux_models.modules", **kwargs):
        kwargs.pop("force_ori_type", None)
        module = getattr(importlib.import_module(package_name, "core.utils"), module_name)
        if "device" in inspect.signature(module).parameters:
            kwargs["device"] = "cpu"
        return module(**kwargs)
    loader.load_force_ori_type = local_aux
    from core.atomic_components.cfg import parse_cfg
    from core.atomic_components.avatar_registrar import AvatarRegistrar
    from core.atomic_components.condition_handler import ConditionHandler
    from core.atomic_components.audio2motion import Audio2Motion
    from core.atomic_components.motion_stitch import MotionStitch
    from core.atomic_components.warp_f3d import WarpF3D
    from core.atomic_components.decode_f3d import DecodeF3D
    from core.atomic_components.wav2feat import Wav2Feat

    cfg_path = root / "checkpoints/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl"
    # This pickle is a fixed upstream artifact, SHA-256 checked before loading.
    with cfg_path.open("rb") as stream:
        config = pickle.load(stream)
    for value in config["base_cfg"].values():
        if "device" in value:
            value["device"] = device if value.get("model_path", "").endswith(".pth") else "cpu"
    config["audio2motion_cfg"]["device"] = device
    configs = parse_cfg(str(cfg_path), str(root / "checkpoints/ditto_pytorch"), config)
    reg_cfg, cond_cfg, motion_cfg, stitch_cfg, warp_cfg, decode_cfg, audio_cfg, defaults = configs
    print(f"Loading local portrait models ({device}).", flush=True)
    registrar = AvatarRegistrar(**reg_cfg)
    condition = ConditionHandler(**cond_cfg)
    motion = Audio2Motion(motion_cfg)
    # Upstream factory moves weights to the device but omits this constructor field.
    motion.lmdm.model.device = device
    stitch = MotionStitch(stitch_cfg)
    warp = WarpF3D(warp_cfg)
    decoder = DecodeF3D(decode_cfg)
    features = Wav2Feat(**audio_cfg)
    return registrar, condition, motion, stitch, warp, decoder, features, defaults, device


def verify(root):
    spec = verified_spec(root)
    *_, device = load_components(root)
    sources = {
        str(path.relative_to(root / "source")): digest(path)
        for path in sorted((root / "source").rglob("*.py"))
    }
    runtime = {
        "schemaVersion": 2, "engine": "ditto", "accelerator": device,
        "sourceCommit": spec["sourceCommit"], "modelRevision": spec["modelRevision"],
        "specSha256": digest(PROJECT / "config/portrait-runtime.json"),
        "runnerSha256": digest(__file__), "sourceHashes": sources,
        "nativeMotionFps": 25, "renderFps": 30,
        "packages": {name: importlib.metadata.version(name) for name in ["torch", "numpy", "onnxruntime", "mediapipe"]},
        "verified": "models-loaded", "verifiedAt": time.time(),
    }
    write_json(root / "runtime.json", runtime)
    print(f"Local learned portrait engine ready ({device}); no cloud service required.", flush=True)


def render(root, request_path, output_dir):
    import cv2
    import numpy as np
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    from scipy.ndimage import gaussian_filter1d

    spec = verified_spec(root)
    req = json.loads(Path(request_path).read_text())
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    fps, frame_count = int(req["fps"]), int(req["frameCount"])
    if fps != 30 or not 1 <= frame_count <= 18000:
        raise ValueError("Portrait render requires 30 fps and at most ten minutes")
    settings = req.get("avatar", {}).get("motion", {})
    profile = PROFILES.get(settings.get("style", "conversational"))
    intensity = float(settings.get("intensity", 0.7))
    if profile is None or not math.isfinite(intensity) or not 0 <= intensity <= 1:
        raise ValueError("Invalid portrait motion settings")
    seed = int(settings.get("seed", 42))
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    started = time.monotonic()
    registrar, condition, motion, stitch, warp, decoder, features, defaults, device = load_components(root)
    from core.atomic_components.motion_stitch import bin66_to_degree
    from core.utils.get_mask import get_mask

    print("Detecting portrait geometry.", flush=True)
    source = registrar(req["portraitPath"], max_dim=1024, crop_scale=2.3, crop_vx_ratio=0,
                       crop_vy_ratio=-0.125, crop_flag_do_rot=True)
    if not source["is_image_flag"] or len(source["x_s_info_lst"]) != 1:
        raise ValueError("Use one clear portrait photograph")
    source_pose = {key: value.copy() for key, value in source["x_s_info_lst"][0].items()}
    for key in ["pitch", "yaw", "roll"]:
        source_pose[key] = bin66_to_degree(source_pose[key]).astype(np.float32)
    condition.setup(source, emo=4, eye_f0_mode=False)
    motion.setup(condition.x_s_info_0, overlap_v2=10, sampling_timesteps=30,
                 online_mode=False, smo_k_d=5)

    samples, rate = sf.read(req["wavPath"], dtype="float32")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if not len(samples) or not np.isfinite(samples).all():
        raise ValueError("Narration must contain finite audio samples")
    cues = req.get("cues", [])
    if any(cue.get("speakerId") for cue in cues):
        # Dialogue: prevent this portrait from mouthing the other speaker's words.
        mask = np.zeros(len(samples), dtype=np.float32)
        for cue in cues:
            if cue.get("speakerId", req["speakerId"]) == req["speakerId"]:
                left = max(0, round(cue["startSeconds"] * rate))
                right = min(len(samples), round(cue["endSeconds"] * rate))
                mask[left:right] = 1
        samples *= gaussian_filter1d(mask, max(1, rate * 0.006))
    divisor = math.gcd(rate, 16000)
    samples = resample_poly(samples, 16000 // divisor, rate // divisor).astype(np.float32)
    print("Analyzing narration and generating speech motion.", flush=True)
    audio_features = features.wav2feat(samples, sr=16000)
    conditioning = condition(audio_features, 0)
    sequence = None
    for start in range(0, len(conditioning), motion.valid_clip_len):
        chunk = conditioning[start:start + motion.seq_frames][None]
        if chunk.shape[1] < motion.seq_frames:
            chunk = np.concatenate([chunk, np.repeat(chunk[:, -1:], motion.seq_frames - chunk.shape[1], axis=1)], axis=1)
        sequence = motion(chunk, sequence)
    sequence = motion._smo(sequence[:, :len(conditioning)], 0, len(conditioning))
    poses = motion.cvt_fmt(sequence)
    for pose in poses:
        for key in ["pitch", "yaw", "roll"]:
            pose[key] = bin66_to_degree(pose[key]).astype(np.float32)
    # Limit and smooth real pose angles, never softmax logits or lip expressions.
    for key in ["pitch", "yaw", "roll", "t"]:
        values = np.stack([pose[key] for pose in poses])
        baseline = values[0].copy()
        delta = gaussian_filter1d(values - baseline, sigma=1.4, axis=0)
        if key != "t":
            limit = profile["limit"]
            delta = limit * np.tanh(delta / limit)
        weight = profile["pose"] * intensity * (0.3 if key == "t" else 1)
        for i, pose in enumerate(poses):
            pose[key] = (baseline + delta[i] * weight).astype(np.float32)
    write_json(out / "motion-summary.json", {
        "engine": "ditto", "style": settings.get("style", "conversational"),
        "intensity": intensity, "seed": seed, "nativeMotionFps": 25,
        "renderFps": fps, "nativeFrames": len(poses), "outputFrames": frame_count,
    })
    stitch.setup(N_d=frame_count, relative_d=True, drive_eye=True,
                 delta_eye_arr=defaults.get("delta_eye_arr"), delta_eye_open_n=0,
                 is_image_flag=True, x_s_info=source_pose, flag_stitching=True)
    frame = source["img_rgb_lst"][0]
    h, w = frame.shape[:2]
    transform = source["M_c2o_lst"][0][:2]
    mask = get_mask(512, 512, 0.9, 0.9)
    mask = cv2.warpAffine(mask, transform, (w, h), flags=cv2.INTER_LINEAR).clip(0, 1)[..., None]
    hashes = []
    print(f"Rendering {frame_count} portrait frames at {fps} fps.", flush=True)
    for index in range(frame_count):
        position = min(len(poses) - 1, (index + 0.5) / fps * 25)
        left = int(position)
        right = min(len(poses) - 1, left + 1)
        fraction = position - left
        pose = {key: (value * (1 - fraction) + poses[right][key] * fraction).astype(np.float32)
                for key, value in poses[left].items()}
        x_source, x_target = stitch(source_pose, pose)
        generated = decoder(warp(source["f_s_lst"][0], x_source, x_target))
        warped = cv2.warpAffine(generated, transform, (w, h), flags=cv2.INTER_LINEAR)
        result = (mask * warped + (1 - mask) * frame).clip(0, 255).astype(np.uint8)
        side = min(w, h)
        result = result[(h - side)//2:(h + side)//2, (w - side)//2:(w + side)//2]
        result = cv2.resize(result, (512, 512), interpolation=cv2.INTER_AREA)
        path = out / f"frame-{index:04d}.png"
        if not cv2.imwrite(str(path), cv2.cvtColor(result, cv2.COLOR_RGB2BGR)):
            raise ValueError("Could not save portrait frame")
        hashes.append(digest(path))
        if index % 30 == 0:
            print(f"Portrait frame {index + 1}/{frame_count}", flush=True)
    write_json(out / "manifest.json", {
        "schemaVersion": 2, "engine": "ditto", "requestHash": req["requestHash"],
        "speakerId": req["speakerId"], "frameCount": frame_count, "fps": fps,
        "resolution": 512, "frameHashes": hashes, "accelerator": device,
        "sourceCommit": spec["sourceCommit"], "modelRevision": spec["modelRevision"],
        "elapsedSeconds": round(time.monotonic() - started, 2),
    })
    print("Portrait render verified and saved.", flush=True)


if __name__ == "__main__":
    mode, root_arg, *arguments = sys.argv[1:]
    runtime_root = Path(root_arg).resolve()
    if mode == "verify":
        verify(runtime_root)
    elif mode == "render":
        render(runtime_root, *arguments)
    else:
        raise ValueError("Unknown portrait operation")
