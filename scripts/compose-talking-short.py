"""
Composites the neural talking-head video into the full 1080x1920 SAP Short layout.
"""

import sys
import os
import cv2
import numpy as np
import subprocess
import time

def compose_talking_short():
    talking_video_path = "artifacts/broll-test/moty-talking-head.mp4"
    audio_path = "artifacts/broll-test/moty-sample-audio.wav"
    output_mp4 = "artifacts/broll-test/moty-talking-short.mp4"

    cap = cv2.VideoCapture(talking_video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open {talking_video_path}")

    w, h = 1080, 1920
    fps = 30
    duration_sec = 5.0
    total_frames = int(duration_sec * fps)

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
    print(f"Compositing neural talking head short to {output_mp4}...")

    portrait_size = 600
    portrait_x = (w - portrait_size) // 2
    portrait_y = 520

    # Circular mask for avatar badge
    mask = np.zeros((portrait_size, portrait_size), dtype=np.uint8)
    radius = (portrait_size // 2) - 8
    cv2.circle(mask, (portrait_size // 2, portrait_size // 2), radius, 255, -1, lineType=cv2.LINE_AA)
    mask_3d = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR).astype(np.float32) / 255.0

    # Floating particles
    np.random.seed(101)
    num_particles = 40
    part_x = np.random.uniform(50, w - 50, num_particles)
    part_y = np.random.uniform(100, h - 100, num_particles)
    part_speed = np.random.uniform(-0.5, -2.0, num_particles)
    part_size = np.random.uniform(2, 5, num_particles)

    for i in range(total_frames):
        ret, portrait_frame = cap.read()
        if not ret:
            break

        # Resize the 512x512 talking head frame to portrait_size (600x600)
        portrait_resized = cv2.resize(portrait_frame, (portrait_size, portrait_size), interpolation=cv2.INTER_LANCZOS4)

        # Base frame with dark mode navy gradient
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        for y in range(h):
            factor = y / float(h)
            b = int(32 - 14 * factor)
            g = int(17 - 8 * factor)
            r = int(11 - 5 * factor)
            frame[y, :] = (b, g, r)

        # Grid lines
        grid_color = (40, 28, 20)
        for gx in range(0, w, 80):
            cv2.line(frame, (gx, 0), (gx, h), grid_color, 1)
        for gy in range(0, h, 80):
            cv2.line(frame, (0, gy), (w, gy), grid_color, 1)

        # Ambient floating motes
        for p in range(num_particles):
            py = int((part_y[p] + part_speed[p] * i) % h)
            px = int(part_x[p] + np.sin(i * 0.05 + p) * 15)
            color = (255, 210, 80) if p % 3 == 0 else (240, 240, 255)
            cv2.circle(frame, (px, py), int(part_size[p]), color, -1, lineType=cv2.LINE_AA)

        # Composite neural talking head portrait
        roi = frame[portrait_y:portrait_y + portrait_size, portrait_x:portrait_x + portrait_size]
        composited_roi = (portrait_resized.astype(np.float32) * mask_3d + roi.astype(np.float32) * (1.0 - mask_3d)).astype(np.uint8)
        
        # Glowing border around talking head
        cv2.circle(composited_roi, (portrait_size // 2, portrait_size // 2), radius, (245, 190, 56), 3, lineType=cv2.LINE_AA)
        cv2.circle(composited_roi, (portrait_size // 2, portrait_size // 2), radius + 4, (120, 80, 20), 1, lineType=cv2.LINE_AA)
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

        # Subtitle / Caption Card
        card_y = 1240
        card_h = 320
        card_margin = 80
        cv2.rectangle(frame, (card_margin, card_y), (w - card_margin, card_y + card_h), (22, 16, 12), -1)
        cv2.rectangle(frame, (card_margin, card_y), (w - card_margin, card_y + card_h), (60, 45, 30), 2)

        cur_sec = i / float(fps)
        if cur_sec < 3.1:
            line1 = "Joule Work access?"
            line2 = "Check first before assuming."
            sub_color = (255, 235, 120)
        else:
            line1 = "Myth: announcement means access."
            line2 = "Fact: customer rollout is starting."
            sub_color = (120, 235, 255)

        cv2.putText(frame, line1, (card_margin + 50, card_y + 110), cv2.FONT_HERSHEY_DUPLEX, 1.25, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(frame, line2, (card_margin + 50, card_y + 190), cv2.FONT_HERSHEY_DUPLEX, 1.15, sub_color, 2, cv2.LINE_AA)

        # Footer branding
        cv2.putText(frame, "SAP Developer Shorts  *  October 2026", (w // 2 - 250, 1800), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (130, 120, 110), 1, cv2.LINE_AA)

        pipe.stdin.write(frame.tobytes())

    cap.release()
    pipe.stdin.close()
    pipe.wait()
    print("Compositing complete!")

if __name__ == "__main__":
    compose_talking_short()
