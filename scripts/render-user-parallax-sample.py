"""
Option 2: 2.5D Parallax Demo with User Uploaded Picture and SAP Shorts Text & Audio.
Renders a complete 1080x1920 vertical short with 3D portrait parallax, typography, and synced narration.
"""

import sys
import os
import cv2
import numpy as np
import subprocess
import time

def ease_in_out(t):
    return (1.0 - np.cos(np.pi * t)) / 2.0

def create_parallax_portrait_frame(img, depth, shift_x, shift_y, scale, target_size=640):
    """
    Renders a 2.5D parallax displaced portrait of the given size.
    """
    h_in, w_in = img.shape[:2]
    # Resize input to target size + padding buffer
    pad = int(target_size * 0.12)
    work_size = target_size + 2 * pad
    
    img_work = cv2.resize(img, (work_size, work_size), interpolation=cv2.INTER_LANCZOS4)
    depth_work = cv2.resize(depth, (work_size, work_size), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    depth_work = cv2.GaussianBlur(depth_work, (5, 5), 0)

    cx, cy = work_size / 2.0, work_size / 2.0
    grid_x, grid_y = np.meshgrid(np.arange(work_size, dtype=np.float32), np.arange(work_size, dtype=np.float32))

    # Focus depth = face depth (~0.60)
    focus = 0.55
    depth_weight = depth_work - focus

    map_x = grid_x + shift_x * depth_weight + (grid_x - cx) * (1.0 - scale)
    map_y = grid_y + shift_y * depth_weight + (grid_y - cy) * (1.0 - scale)

    warped = cv2.remap(
        img_work,
        map_x.astype(np.float32),
        map_y.astype(np.float32),
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101
    )

    # Crop out the central target_size region
    cropped = warped[pad:pad + target_size, pad:pad + target_size]
    return cropped

def render_sample_video():
    img_path = "assets/avatars/moty-profile.png"
    depth_path = "artifacts/broll-test/moty-depth.png"
    audio_path = "artifacts/broll-test/moty-sample-audio.wav"
    output_mp4 = "artifacts/broll-test/moty-parallax-sample.mp4"

    t0 = time.time()
    img = cv2.imread(img_path)
    if img is None:
        raise ValueError(f"Missing {img_path}")
    depth = cv2.imread(depth_path, cv2.IMREAD_GRAYSCALE)
    if depth is None:
        raise ValueError(f"Missing {depth_path}")

    # Video parameters
    w, h = 1080, 1920
    fps = 30
    duration_sec = 5.0
    total_frames = int(duration_sec * fps)

    # Subtitles timing for 5.0 seconds
    # Scene 1: 0.0s - 3.1s -> "Joule Work access? Check first."
    # Scene 2: 3.1s - 5.0s -> "Myth: announcement means access today."

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{w}x{h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",
        "-i", audio_path,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-preset", "fast",
        "-crf", "18",
        "-shortest",
        "-movflags", "+faststart",
        output_mp4
    ]

    pipe = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    print(f"Rendering {total_frames} frames to {output_mp4} with audio...")

    portrait_size = 600
    portrait_x = (w - portrait_size) // 2
    portrait_y = 520

    # Create circular mask for portrait with anti-aliased edge
    mask = np.zeros((portrait_size, portrait_size), dtype=np.uint8)
    radius = (portrait_size // 2) - 8
    cv2.circle(mask, (portrait_size // 2, portrait_size // 2), radius, 255, -1, lineType=cv2.LINE_AA)
    mask_3d = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR).astype(np.float32) / 255.0

    # Ambient light motes
    np.random.seed(101)
    num_particles = 40
    part_x = np.random.uniform(50, w - 50, num_particles)
    part_y = np.random.uniform(100, h - 100, num_particles)
    part_speed = np.random.uniform(-0.5, -2.0, num_particles)
    part_size = np.random.uniform(2, 5, num_particles)

    for i in range(total_frames):
        t = i / float(total_frames - 1)
        ease = ease_in_out(t)

        # Base background: deep modern navy enterprise gradient (#0b1120 -> #080d1a)
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        # Vertical gradient
        for y in range(h):
            factor = y / float(h)
            b = int(32 - 14 * factor)
            g = int(17 - 8 * factor)
            r = int(11 - 5 * factor)
            frame[y, :] = (b, g, r)

        # Draw subtle background grid lines
        grid_color = (40, 28, 20)
        for gx in range(0, w, 80):
            cv2.line(frame, (gx, 0), (gx, h), grid_color, 1)
        for gy in range(0, h, 80):
            cv2.line(frame, (0, gy), (w, gy), grid_color, 1)

        # Floating ambient dust particles
        for p in range(num_particles):
            py = int((part_y[p] + part_speed[p] * i) % h)
            px = int(part_x[p] + np.sin(i * 0.05 + p) * 15)
            color = (255, 210, 80) if p % 3 == 0 else (240, 240, 255) # cyan / warm white
            cv2.circle(frame, (px, py), int(part_size[p]), color, -1, lineType=cv2.LINE_AA)

        # 3D Parallax Portrait parameters
        # Dolly scale: 1.0 -> 1.08
        dolly = 1.0 + 0.08 * ease
        # Subtle horizontal pan: -22px to +22px
        shift_x = 22.0 * (ease - 0.5) * 2.0
        # Subtle vertical tilt: -10px to +10px
        shift_y = -10.0 * (ease - 0.5) * 2.0

        portrait = create_parallax_portrait_frame(img, depth, shift_x, shift_y, dolly, portrait_size)

        # Composite circular portrait
        roi = frame[portrait_y:portrait_y + portrait_size, portrait_x:portrait_x + portrait_size]
        composited_roi = (portrait.astype(np.float32) * mask_3d + roi.astype(np.float32) * (1.0 - mask_3d)).astype(np.uint8)
        
        # Draw glowing ring border around circular portrait
        cv2.circle(composited_roi, (portrait_size // 2, portrait_size // 2), radius, (245, 190, 56), 3, lineType=cv2.LINE_AA) # cyan glow
        cv2.circle(composited_roi, (portrait_size // 2, portrait_size // 2), radius + 4, (120, 80, 20), 1, lineType=cv2.LINE_AA) # outer soft halo
        frame[portrait_y:portrait_y + portrait_size, portrait_x:portrait_x + portrait_size] = composited_roi

        # Top Badge: "SAP BUSINESS AI · JOULE WORK"
        badge_text = "SAP BUSINESS AI  *  JOULE WORK"
        cv2.rectangle(frame, (w // 2 - 270, 220), (w // 2 + 270, 280), (35, 25, 16), -1)
        cv2.rectangle(frame, (w // 2 - 270, 220), (w // 2 + 270, 280), (245, 180, 50), 2)
        cv2.putText(frame, badge_text, (w // 2 - 240, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 220, 100), 2, cv2.LINE_AA)

        # Main Headline: "Announcement vs. Access"
        cv2.putText(frame, "Announcement vs. Access", (w // 2 - 380, 370), cv2.FONT_HERSHEY_DUPLEX, 1.6, (250, 250, 250), 3, cv2.LINE_AA)

        # Speaker Name Tag under Portrait: "Moty  *  Host"
        tag_bg_w = 260
        tag_bg_h = 50
        tag_y = portrait_y + portrait_size - 25
        tag_x = (w - tag_bg_w) // 2
        cv2.rectangle(frame, (tag_x, tag_y), (tag_x + tag_bg_w, tag_y + tag_bg_h), (25, 18, 12), -1)
        cv2.rectangle(frame, (tag_x, tag_y), (tag_x + tag_bg_w, tag_y + tag_bg_h), (80, 60, 40), 1)
        cv2.putText(frame, "Moty  *  Host", (tag_x + 35, tag_y + 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (230, 230, 230), 2, cv2.LINE_AA)

        # Subtitle / Caption Card (Bottom Area)
        card_y = 1240
        card_h = 320
        card_margin = 80
        cv2.rectangle(frame, (card_margin, card_y), (w - card_margin, card_y + card_h), (22, 16, 12), -1)
        cv2.rectangle(frame, (card_margin, card_y), (w - card_margin, card_y + card_h), (60, 45, 30), 2)

        # Dynamic captions based on audio time:
        cur_sec = i / float(fps)
        if cur_sec < 3.1:
            line1 = "Joule Work access?"
            line2 = "Check first before assuming."
            sub_color = (255, 235, 120) # Bright cyan-gold
        else:
            line1 = "Myth: announcement means access."
            line2 = "Fact: customer rollout is starting."
            sub_color = (120, 235, 255) # Electric cyan

        cv2.putText(frame, line1, (card_margin + 50, card_y + 110), cv2.FONT_HERSHEY_DUPLEX, 1.25, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(frame, line2, (card_margin + 50, card_y + 190), cv2.FONT_HERSHEY_DUPLEX, 1.15, sub_color, 2, cv2.LINE_AA)

        # Footer branding: "SAP Developer Shorts"
        cv2.putText(frame, "SAP Developer Shorts  *  October 2026", (w // 2 - 250, 1800), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (130, 120, 110), 1, cv2.LINE_AA)

        pipe.stdin.write(frame.tobytes())

    pipe.stdin.close()
    pipe.wait()
    t1 = time.time()
    print(f"Sample video with portrait parallax and audio finished in {t1 - t0:.2f}s!")

if __name__ == "__main__":
    render_sample_video()
