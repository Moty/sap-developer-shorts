"""Legacy procedural photograph warp retained for historical artifacts.

This is not a learned portrait synthesizer. Current realistic rendering uses
portrait-runner.py and the pinned Ditto models instead.
"""

import hashlib
import importlib.metadata
import json
import math
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


def setup(root, specification):
    import numpy  # noqa: F401
    import PIL  # noqa: F401
    import scipy  # noqa: F401
    import soundfile  # noqa: F401

    spec = json.loads(Path(specification).read_text())
    packages = {
        item.metadata["Name"].lower().replace("_", "-"): item.version
        for item in importlib.metadata.distributions()
        if item.metadata["Name"]
    }
    accelerator = "cpu"
    try:
        import torch

        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            accelerator = "mps"
    except Exception:
        pass

    runtime = {
        "schemaVersion": 1,
        "engine": spec["engine"],
        "version": spec["version"],
        "accelerator": accelerator,
        "fps": spec["fps"],
        "resolution": spec["resolution"],
        "packages": {
            key: packages[key]
            for key in sorted(["numpy", "pillow", "scipy", "soundfile"])
            if key in packages
        },
    }
    write_json(root / "runtime.json", runtime)
    print(
        f"Local talking-head runtime ready ({runtime['engine']} · {accelerator}).",
        flush=True,
    )


def default_landmarks(avatar):
    fl = avatar.get("faceLandmarks")
    if isinstance(fl, dict) and "leftEye" in fl and "rightEye" in fl:
        return fl
    mx = float(avatar.get("mouthX", 0.5))
    my = float(avatar.get("mouthY", 0.68))
    scale = max(0.5, min(2.0, float(avatar.get("mouthScale", 1.0))))
    eye_y = max(0.24, min(0.62, float(avatar.get("eyeY", my - 0.24 * scale))))
    eye_dx = 0.105 * scale
    eye_rx = max(0.032, min(0.11, 0.052 * scale))
    eye_ry = max(0.014, min(0.06, 0.022 * scale))
    return {
        "leftEye": [mx - eye_dx, eye_y, eye_rx, eye_ry],
        "rightEye": [mx + eye_dx, eye_y, eye_rx, eye_ry],
        "jawY": min(0.94, max(0.5, my + 0.15 * scale)),
        "faceX": mx,
        "faceY": (eye_y + my) * 0.5,
        "faceRx": min(0.46, max(0.12, 0.24 * scale)),
        "faceRy": min(0.48, max(0.15, 0.31 * scale)),
    }


def extract_acoustic_features(samples, sr, frame_count, fps):
    import numpy as np

    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    samples = samples.astype(np.float32)
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak > 1e-5:
        samples = samples / peak

    win = max(64, int(round(sr / fps)))
    hann = np.hanning(win).astype(np.float32)
    freqs = np.fft.rfftfreq(win, d=1.0 / sr)
    low_band = (freqs >= 250) & (freqs <= 900)
    high_band = (freqs > 1100) & (freqs <= 3400)

    rms_list = np.zeros(frame_count, dtype=np.float32)
    spread_list = np.zeros(frame_count, dtype=np.float32)
    for idx in range(frame_count):
        center = int(round((idx + 0.5) * sr / fps))
        start = max(0, center - win // 2)
        end = min(len(samples), start + win)
        seg = np.zeros(win, dtype=np.float32)
        if end > start:
            seg[: end - start] = samples[start:end]
        rms = float(np.sqrt(np.mean(seg * seg) + 1e-9))
        spec = np.abs(np.fft.rfft(seg * hann))
        e_low = float(np.sum(spec[low_band])) + 1e-6
        e_high = float(np.sum(spec[high_band])) + 1e-6
        ratio = e_high / (e_low + e_high)
        rms_list[idx] = min(1.0, rms * 2.8)
        spread_list[idx] = (ratio - 0.38) * 2.0

    # Temporal smoothing so jaw/lip motion has organic coarticulation
    kernel = np.array([0.2, 0.6, 0.2], dtype=np.float32)
    if frame_count >= 3:
        rms_list = np.convolve(rms_list, kernel, mode="same")
        spread_list = np.convolve(spread_list, kernel, mode="same")
    # Wider prosody envelope (~0.3s window) for smooth conversational head nods & tilts
    prosody_win = max(3, min(frame_count, int(round(fps * 0.3))))
    prosody_kernel = np.hanning(prosody_win + 2)[1:-1].astype(np.float32)
    prosody_kernel /= float(np.sum(prosody_kernel)) or 1.0
    prosody_env = (
        np.convolve(rms_list, prosody_kernel, mode="same")
        if frame_count >= prosody_win
        else rms_list.copy()
    )
    return rms_list, np.clip(spread_list, -1.0, 1.0), np.clip(prosody_env, 0.0, 1.0)


def render(root, request_path, output_dir):
    import numpy as np
    from PIL import Image
    from scipy.ndimage import map_coordinates
    import soundfile as sf

    req = json.loads(Path(request_path).read_text())
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    size = int(req.get("resolution", 256))
    fps = int(req.get("fps", 30))
    speaker_id = req.get("speakerId", "narrator")
    avatar = req.get("avatar", {})
    cues = req.get("cues", [])
    frame_count = int(req["frameCount"])

    img = Image.open(req["portraitPath"]).convert("RGBA")
    side = min(img.width, img.height)
    left = (img.width - side) // 2
    top = (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.Resampling.LANCZOS
    )
    src = np.asarray(img, dtype=np.float32)

    samples, sr = sf.read(req["wavPath"], dtype="float32")
    rms_env, spread_env, prosody_env = extract_acoustic_features(
        samples, sr, frame_count, fps
    )

    fl = default_landmarks(avatar)
    unit = (size / 140.0) * max(0.5, min(2.0, float(avatar.get("mouthScale", 1.0))))
    mx = size * float(avatar.get("mouthX", 0.5))
    my = size * float(avatar.get("mouthY", 0.68))
    rx = 16.5 * unit
    lip_h = 16.0 * float(avatar.get("mouthAspect", 0.375)) * unit
    ry = max(8.5 * unit, lip_h + 4.5 * unit)
    angle = float(avatar.get("mouthAngle", 0.0))
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)

    face_x = size * float(fl["faceX"])
    face_y = size * float(fl["faceY"])
    head_cy = max(size * 0.24, face_y - size * 0.03)
    max_rx = max(size * 0.14, min(face_x - 4.0, size - 4.0 - face_x))
    max_ry = max(size * 0.16, min(head_cy - 4.0, size - 5.0 - head_cy))
    face_rx = min(max_rx, max(size * 0.36, size * float(fl["faceRx"]) * 2.15))
    face_ry = min(max_ry, max(size * 0.38, size * float(fl["faceRy"]) * 2.05))
    jaw_top = my - ry * 0.35
    jaw_bot = min(size - 4.0, max(my + ry * 1.25, size * min(0.94, float(fl["jawY"]) + 0.03)))
    jaw_span = max(1.0, jaw_bot - jaw_top)
    jaw_rx = min(face_rx * 0.92, max(rx * 2.05, size * float(fl["faceRx"]) * 0.82))
    pivot_y = min(size - 6.0, jaw_bot)

    yy, xx = np.meshgrid(
        np.arange(size, dtype=np.float32),
        np.arange(size, dtype=np.float32),
        indexing="ij",
    )
    r_face = np.hypot((xx - face_x) / face_rx, (yy - head_cy) / face_ry)
    radial_w = np.where(
        r_face <= 0.54,
        1.0,
        np.where(
            r_face < 1.0,
            (1.0 - ((r_face - 0.54) / 0.46) ** 2) ** 2,
            0.0,
        ),
    )
    neck_taper = np.where(
        yy <= pivot_y,
        1.0,
        (1.0 - np.clip((yy - pivot_y) / max(6.0, head_cy + face_ry - pivot_y), 0.0, 1.0)) ** 2,
    )
    w_face = (radial_w * neck_taper).astype(np.float32)

    speaker_offset = 0.4 if speaker_id == "mira" else 1.9 if speaker_id == "max" else 1.1

    for idx in range(frame_count):
        t = (idx + 0.5) / fps
        active_cue = None
        for cue in cues:
            if cue["startSeconds"] <= t < cue["endSeconds"]:
                if not cue.get("speakerId") or cue.get("speakerId") == speaker_id:
                    active_cue = cue
                break

        blink_cycle = (t + speaker_offset) % 3.4
        is_blinking = 3.18 <= blink_cycle <= 3.36
        jaw_open = float(rms_env[idx]) if active_cue else 0.0
        spread = float(spread_env[idx]) if active_cue else 0.0
        speech_drive = float(prosody_env[idx]) if active_cue else 0.0
        is_question = ("?" in active_cue.get("text", "")) if active_cue else False

        tilt_wave = (
            math.sin(t * 1.9 + speaker_offset) * 0.65
            + math.sin(t * 3.3 + speaker_offset * 1.7) * 0.35
        )
        if active_cue:
            head_bob = (
                math.sin(t * 2.8 + speaker_offset * 0.5) * 1.45
                + math.sin(t * 7.4) * 2.25 * (0.42 + speech_drive * 0.58)
            )
            head_tilt = tilt_wave * (
                0.058 + speech_drive * 0.028 + (0.016 if is_question else 0.0)
            )
            head_sway = (
                math.sin(t * 1.45 + speaker_offset * 0.8) * 2.4
                + math.sin(t * 4.3 + speaker_offset) * 1.15 * (0.4 + speech_drive * 0.6)
            )
        else:
            head_bob = math.sin(t * 1.65 + speaker_offset) * 0.8
            head_tilt = math.sin(t * 1.25 + speaker_offset) * 0.026
            head_sway = math.sin(t * 1.05 + speaker_offset) * 0.95
        brow_lift = (1.6 + jaw_open * 1.8) if active_cue else 0.0

        sx = xx.copy()
        sy = yy.copy()

        bob_px = head_bob * (size / 140.0) * 0.88 * w_face
        sway_px = head_sway * (size / 140.0) * 0.85 * w_face
        tilt_rad = head_tilt * 1.05 * w_face
        dx_f = sx - face_x - sway_px
        dy_f = sy - pivot_y - bob_px
        ct = np.cos(tilt_rad)
        st = np.sin(tilt_rad)
        pitch_scale = 1.0 - 0.018 * (head_bob / 5.0) * ((sy - face_y) / face_ry) * w_face
        yaw_scale = 1.0 + 0.022 * (head_sway / 4.0) * (dx_f / face_rx) * w_face
        sx = face_x + (dx_f * ct + dy_f * st) * pitch_scale * yaw_scale
        sy = pivot_y + (-dx_f * st + dy_f * ct) / pitch_scale

        for eye_spec in (fl["leftEye"], fl["rightEye"]):
            ex = size * float(eye_spec[0])
            ey = size * float(eye_spec[1])
            erx = max(size * 0.048, size * float(eye_spec[2]) * 1.28)
            ery = max(size * 0.028, size * float(eye_spec[3]) * 2.05)
            if brow_lift > 0.05:
                bcy = ey - ery * 1.32
                brx = erx * 1.22
                bry = ery * 1.05
                rb2 = ((sx - ex) / brx) ** 2 + ((sy - bcy) / bry) ** 2
                mask_b = rb2 < 1.0
                sy = np.where(
                    mask_b,
                    sy + brow_lift * (size / 140.0) * 0.55 * (1.0 - np.minimum(1.0, rb2)) ** 2,
                    sy,
                )
            if is_blinking:
                edx = sx - ex
                edy = sy - ey
                eu = edx * cos_a + edy * sin_a
                ev = -edx * sin_a + edy * cos_a
                re2 = (eu / erx) ** 2 + (ev / ery) ** 2
                mask_e = re2 < 1.0
                h_fall = np.maximum(0.0, 1.0 - np.minimum(1.0, (eu / erx) ** 2))
                b_eye = np.maximum(0.5, ery * np.sqrt(h_fall))
                lid_meet = b_eye * 0.48 * h_fall
                upper_crease = -b_eye * 0.18
                sev = np.where(
                    ev < lid_meet,
                    -b_eye + ((ev + b_eye) / np.maximum(0.001, lid_meet + b_eye)) * (upper_crease + b_eye),
                    upper_crease + ((ev - lid_meet) / np.maximum(0.001, b_eye - lid_meet)) * (b_eye - upper_crease),
                )
                sx = np.where(mask_e, ex + eu * cos_a - sev * sin_a, sx)
                sy = np.where(mask_e, ey + eu * sin_a + sev * cos_a, sy)

        if jaw_open > 0.015:
            jdx = (sx - mx) / jaw_rx
            in_jaw = (sy > jaw_top) & (sy < jaw_bot) & (np.abs(jdx) < 1.0)
            jx_fall = (1.0 - np.minimum(1.0, jdx * jdx)) ** 2
            jy_norm = np.clip((sy - jaw_top) / jaw_span, 0.0, 1.0)
            jy_fall = np.sin(jy_norm * math.pi) ** 2
            w_jaw = np.where(in_jaw, jx_fall * jy_fall, 0.0)
            sy = sy - (jaw_open * 3.4 * unit) * w_jaw
            sx = sx - (spread * 0.08 * (sx - mx)) * w_jaw

        cavity_shade = np.zeros_like(xx)
        teeth_hi = np.zeros_like(xx)
        if jaw_open > 0.015:
            dx = sx - mx
            dy = sy - my
            u = dx * cos_a + dy * sin_a
            v = -dx * sin_a + dy * cos_a
            r2 = (u / rx) ** 2 + (v / ry) ** 2
            in_mouth = r2 < 1.0
            h_fall = np.maximum(0.0, 1.0 - np.minimum(1.0, (u / rx) ** 2))
            boundary = np.maximum(0.5, ry * np.sqrt(h_fall))
            core = np.minimum(lip_h, boundary * 0.55)
            eps = boundary * 0.01
            up_disp = (-1.6 * jaw_open) * unit * h_fall
            lo_disp = (2.7 * jaw_open) * unit * h_fall
            upper = np.maximum(-boundary + eps, np.minimum(-core * 0.2, -core + up_disp))
            lower = np.minimum(boundary - eps, np.maximum(core * 0.2, core + lo_disp))
            sv = np.where(
                v < upper,
                -boundary + ((v + boundary) / np.maximum(0.001, upper + boundary)) * (boundary - core),
                np.where(
                    v < 0.0,
                    (v / np.minimum(-0.001, upper)) * -core,
                    np.where(
                        v < lower,
                        (v / np.maximum(0.001, lower)) * core,
                        core + ((v - lower) / np.maximum(0.001, boundary - lower)) * (boundary - core),
                    ),
                ),
            )
            fx_lip = spread * 0.08 * jaw_open
            su = u / (1.0 + fx_lip * (1.0 - np.minimum(1.0, r2)) ** 2)
            sx = np.where(in_mouth, mx + su * cos_a - sv * sin_a, sx)
            sy = np.where(in_mouth, my + su * sin_a + sv * cos_a, sy)

            if jaw_open > 0.22:
                inner_w = rx * 0.56
                inner_top = upper * 0.42
                inner_bot = lower * 0.54
                in_cav = in_mouth & (np.abs(u) < inner_w) & (v > inner_top) & (v < inner_bot) & (inner_bot > inner_top + 0.5)
                ux = np.maximum(0.0, 1.0 - np.minimum(1.0, (u / inner_w) ** 2))
                mid_v = (inner_top + inner_bot) * 0.5
                rad_v = np.maximum(0.25, (inner_bot - inner_top) * 0.5)
                vy = np.maximum(0.0, 1.0 - np.minimum(1.0, ((v - mid_v) / rad_v) ** 2))
                open_w = min(1.0, (jaw_open - 0.22) / 0.55)
                aperture = np.where(in_cav, ux * (vy ** 1.4) * open_w, 0.0)
                cavity_shade = aperture * 0.72
                if jaw_open > 0.32:
                    t_center = inner_top + (inner_bot - inner_top) * 0.17
                    t_half = np.maximum(0.15, (inner_bot - inner_top) * 0.17)
                    t_band = np.maximum(0.0, 1.0 - np.abs((v - t_center) / t_half))
                    teeth_hi = np.where(in_cav & (v < inner_top + (inner_bot - inner_top) * 0.34), t_band * ux * open_w * 0.28, 0.0)

        coords = np.array([np.clip(sy, 0, size - 1.001), np.clip(sx, 0, size - 1.001)])
        out = np.empty_like(src)
        for ch in range(4):
            sampled = map_coordinates(src[:, :, ch], coords, order=1, mode="nearest")
            if ch < 3:
                depth = 0.66 if ch == 0 else 0.76 if ch == 1 else 0.79
                sampled = sampled * (1.0 - cavity_shade * depth)
                target = 222.0 if ch == 2 else 234.0
                sampled = sampled * (1.0 - teeth_hi) + target * teeth_hi
            out[:, :, ch] = sampled

        frame_img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="RGBA")
        frame_img.save(out_dir / f"frame-{idx:04d}.png", format="PNG")

    write_json(
        out_dir / "manifest.json",
        {
            "schemaVersion": 1,
            "speakerId": speaker_id,
            "frameCount": frame_count,
            "fps": fps,
            "resolution": size,
        },
    )
    print(json.dumps({"speakerId": speaker_id, "frames": frame_count}), flush=True)


if __name__ == "__main__":
    mode, root_arg, *arguments = sys.argv[1:]
    runtime_root = Path(root_arg).resolve()
    if mode == "setup":
        setup(runtime_root, *arguments)
    elif mode == "render":
        render(runtime_root, *arguments)
    else:
        raise ValueError("Unknown talking-head operation")
