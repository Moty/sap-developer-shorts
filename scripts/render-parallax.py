"""
2.5D Parallax Camera Motion Renderer.
Takes an image and an estimated depth map, applies 3D virtual camera motion,
and outputs a silky-smooth cinematic 9:16 vertical video.
"""

import sys
import os
import cv2
import numpy as np
import subprocess
import time

def ease_in_out(t):
    # Smooth cubic / cosine easing
    return (1.0 - np.cos(np.pi * t)) / 2.0

def render_parallax_video(
    image_path: str,
    depth_path: str,
    output_mp4: str,
    duration_sec: float = 5.0,
    fps: int = 30,
    dolly_zoom: float = 0.08,       # 8% forward push-in
    parallax_shift_x: float = 28.0,  # horizontal parallax offset (pixels)
    parallax_shift_y: float = -14.0, # vertical parallax tilt (pixels)
    focus_depth: float = 0.5,        # depth pivot point
    target_width: int = 1080,
    target_height: int = 1920,
):
    t0 = time.time()
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not load image: {image_path}")

    depth = cv2.imread(depth_path, cv2.IMREAD_GRAYSCALE)
    if depth is None:
        raise ValueError(f"Could not load depth map: {depth_path}")

    # Resize both to target resolution
    img = cv2.resize(img, (target_width, target_height), interpolation=cv2.INTER_LANCZOS4)
    depth = cv2.resize(depth, (target_width, target_height), interpolation=cv2.INTER_LINEAR)

    # Normalize depth map to 0.0 (far) - 1.0 (near)
    depth_norm = depth.astype(np.float32) / 255.0
    
    # Smooth depth slightly to avoid hard pixel tearing on complex micro-edges
    depth_smooth = cv2.GaussianBlur(depth_norm, (7, 7), 0)

    total_frames = int(duration_sec * fps)
    h, w = target_height, target_width
    cx, cy = w / 2.0, h / 2.0

    # Grid coordinates
    grid_x, grid_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))

    # Pre-scale image slightly (e.g. 10%) so the camera has a buffer margin and never shows empty borders
    buffer_scale = 1.10
    M_buf = cv2.getRotationMatrix2D((cx, cy), 0, buffer_scale)
    img_padded = cv2.warpAffine(img, M_buf, (w, h), borderMode=cv2.BORDER_REFLECT)
    depth_padded = cv2.warpAffine(depth_smooth, M_buf, (w, h), borderMode=cv2.BORDER_REFLECT)

    # Setup ffmpeg process pipe for fast streaming encoding
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{w}x{h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "18",
        "-movflags", "+faststart",
        output_mp4
    ]

    pipe = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    print(f"Rendering {total_frames} frames ({duration_sec}s @ {fps}fps) to {output_mp4}...")

    # Optional: add subtle floating cyan/amber bokeh dust particles that travel at high speed in foreground
    np.random.seed(42)
    num_particles = 35
    particles_x = np.random.uniform(0, w, num_particles)
    particles_y = np.random.uniform(0, h, num_particles)
    particles_size = np.random.uniform(2, 6, num_particles)
    particles_speed_y = np.random.uniform(-0.8, -2.5, num_particles)
    particles_alpha = np.random.uniform(0.2, 0.6, num_particles)

    for i in range(total_frames):
        progress = i / float(total_frames - 1)
        ease = ease_in_out(progress)

        # Dynamic camera values
        # 1. Forward dolly zoom: scale grows from 1.0 to 1.0 + dolly_zoom
        scale = 1.0 + dolly_zoom * ease
        
        # 2. Camera pan (X) and tilt (Y): foreground moves opposite direction from background
        cur_shift_x = parallax_shift_x * (ease - 0.5) * 2.0
        cur_shift_y = parallax_shift_y * (ease - 0.5) * 2.0

        # Displace each pixel based on its depth relative to focus_depth
        # Near pixels (depth > focus) shift more than far pixels (depth < focus)
        depth_weight = depth_padded - focus_depth

        map_x = grid_x + cur_shift_x * depth_weight + (grid_x - cx) * (1.0 - scale)
        map_y = grid_y + cur_shift_y * depth_weight + (grid_y - cy) * (1.0 - scale)

        # Remap using bilinear interpolation
        frame = cv2.remap(
            img_padded,
            map_x.astype(np.float32),
            map_y.astype(np.float32),
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101
        )

        # Draw subtle atmospheric foreground floating motes
        for p in range(num_particles):
            py = int((particles_y[p] + particles_speed_y[p] * i) % h)
            px = int((particles_x[p] + cur_shift_x * 1.5) % w)
            rad = int(particles_size[p])
            color = (255, 220, 100) if p % 2 == 0 else (200, 255, 255) # cyan / gold
            # Soft glowing circle
            cv2.circle(frame, (px, py), rad, color, -1, lineType=cv2.LINE_AA)

        pipe.stdin.write(frame.tobytes())

    pipe.stdin.close()
    pipe.wait()
    t1 = time.time()
    print(f"Parallax rendering finished in {t1 - t0:.2f}s!")

if __name__ == "__main__":
    img_in = sys.argv[1] if len(sys.argv) > 1 else "artifacts/broll-test/hana-vector-concept.jpg"
    depth_in = sys.argv[2] if len(sys.argv) > 2 else "artifacts/broll-test/hana-vector-depth.png"
    mp4_out = sys.argv[3] if len(sys.argv) > 3 else "artifacts/broll-test/hana-vector-parallax.mp4"
    render_parallax_video(img_in, depth_in, mp4_out)
