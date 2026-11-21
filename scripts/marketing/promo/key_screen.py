"""Key a real app screen recording into the moving chroma-green device screen of a Wan clip.

Per frame: find the green screen (compose.green_mask), fit its four corners (compose.quad), smooth the corners over
time (so the inserted screen doesn't jitter), warp the matching frame of the screen recording into that quad, and
keep only the pixels that were green (fingers and bezels stay in front). Edge feather and green despill as in the
stills (compose.py).

Usage: python -I promo/key_screen.py <wan.mp4> <screen.mp4|screen.png> <out.mp4> [--start 12.5] [--speed 1.0]
  --start  seconds into the screen recording that line up with the clip's first frame
  --speed  playback speed of the screen recording (1.0 = real time)
"""
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from compose import green_mask, quad  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")


def read_frames(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    return frames, fps


def smooth_quads(qs, radius=2):
    """Median of each corner over a small window: kills single-frame detection jumps, keeps real motion."""
    arr = np.array(qs)  # n x 4 x 2
    out = np.empty_like(arr)
    for i in range(len(arr)):
        a, b = max(0, i - radius), min(len(arr), i + radius + 1)
        out[i] = np.median(arr[a:b], axis=0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wan")
    ap.add_argument("screen")
    ap.add_argument("out")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--anchor3", action="store_true",
                    help="the screen's bottom-right corner gets covered (a child's head): track the top-left, top-right "
                         "and bottom-left extremes and carry the first frame's shape to place the hidden corner")
    a = ap.parse_args()

    clip, cfps = read_frames(a.wan)
    still = cv2.imread(a.screen) if a.screen.lower().endswith((".png", ".jpg", ".jpeg")) else None
    cap = None if still is not None else cv2.VideoCapture(a.screen)
    sfps = (cap.get(cv2.CAP_PROP_FPS) if cap else 30) or 30
    masks, qs = [], []
    for f in clip:
        m = green_mask(f)
        masks.append(m)
        qs.append(quad(m))
    if a.anchor3:
        def three(m):
            ys, xs = np.nonzero(m)
            p = np.stack([xs, ys], 1).astype(np.float32)
            return np.array([p[np.argmin(p[:, 0] + p[:, 1])], p[np.argmax(p[:, 0] - p[:, 1])], p[np.argmax(p[:, 1] - p[:, 0])]], np.float32)
        q0 = np.asarray(qs[0], np.float32)  # unoccluded first frame: TL, TR, BR, BL
        src3 = np.array([q0[0], q0[1], q0[3]], np.float32)
        out = []
        for m in masks:
            tl, tr, bl = three(m)
            A = cv2.getAffineTransform(src3, np.array([tl, tr, bl], np.float32))
            br = A @ np.array([q0[2][0], q0[2][1], 1.0], np.float32)
            out.append(np.array([tl, tr, br, bl], np.float32))
        qs = out
    qs = smooth_quads(qs)

    h, w = clip[0].shape[:2]
    vw = cv2.VideoWriter(a.out + ".tmp.mp4", cv2.VideoWriter_fourcc(*"mp4v"), cfps, (w, h))
    for i, (f, m, q) in enumerate(zip(clip, masks, qs)):
        t = a.start + i / cfps * a.speed
        if still is not None:  # a real screenshot of the app (when no screen recording is available)
            ok, shot = True, still.copy()
        else:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * sfps)))
            ok, shot = cap.read()
        if not ok:
            vw.write(f)
            continue
        q = q.astype(np.float32)
        side_w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
        side_h = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
        sh, sw = shot.shape[:2]
        scale = min(1.0, 1.25 * max(side_w / sw, side_h / sh))
        shot = cv2.resize(shot, (max(2, round(sw * scale)), max(2, round(sh * scale))), interpolation=cv2.INTER_AREA)
        sh, sw = shot.shape[:2]
        src = np.array([[0, 0], [sw - 1, 0], [sw - 1, sh - 1], [0, sh - 1]], dtype=np.float32)
        warped = cv2.warpPerspective(shot, cv2.getPerspectiveTransform(src, q), (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        warped = warped.astype(np.float32) * 0.93 + 10
        S = 4
        poly = np.zeros((h * S, w * S), np.uint8)
        cv2.fillPoly(poly, [np.round(q * S).astype(np.int32)], 255, lineType=cv2.LINE_AA)
        poly = cv2.resize(poly, (w, h), interpolation=cv2.INTER_AREA)
        grown = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=3)
        alpha = cv2.GaussianBlur(np.minimum(poly, grown).astype(np.float32) / 255, (0, 0), 0.7)[..., None]
        out = f.astype(np.float32) * (1 - alpha) + warped * alpha
        ring = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=6) > 0
        b, g, r = out[..., 0], out[..., 1], out[..., 2]
        cap_g = np.maximum(r, b) + 6
        g[ring] = np.minimum(g[ring], cap_g[ring])
        vw.write(np.clip(out, 0, 255).astype(np.uint8))
    vw.release()
    import imageio_ffmpeg
    import subprocess

    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-i", a.out + ".tmp.mp4", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", a.out], check=True)
    os.remove(a.out + ".tmp.mp4")
    print("keyed", a.out, len(clip), "frames")


if __name__ == "__main__":
    main()
