"""Put a real app screenshot onto a scene's chroma-green device screen (item 3).

Finds the green screen, fits its four corners, warps the screenshot into that quad (perspective), and keeps only the
pixels that were green (so rounded corners, bezels and any fingers over the screen stay). The edge is feathered and
green spill on the surrounding pixels is removed. A soft glass sheen and the scene's own softness are matched.

Usage: python -I compose.py            (all picks below)
Output: scripts/marketing/out/final/<scene>.jpg and .png
"""
import os
import sys

import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

# scene key -> (candidate number, screenshot in out/raw)
PICKS = {
    "01-daycare-tablet-mia-mommy": (2, "tablet-mommy-16"),
    "02-daycare-tablet-leo-daddy": (2, "tablet-leo-daddy"),
    "03-daycare-phone-mia-daddy": (2, "phone-daddy-17"),
    "04-daycare-phone-ava-mommy": (1, "phone-ava-mommy"),
    "05-home-nanny-tablet-leo-daddy": (2, "tablet-leo-daddy-b"),
    "06-home-nanny-phone-sam-mama": (1, "phone-sam-mama"),
    "07-mom-home-phone": (2, "parent-summary-rich"),
    "08-dad-office-phone": (2, "parent-alerts"),
    "09-dad-home-phone": (1, "parent-sessions"),
    "10-mom-office-phone": (3, "parent-transcript"),
    "11-dad-commute-phone": (2, "parent-alerts"),
}


def green_mask(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (40, 110, 90), (85, 255, 255))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        raise RuntimeError("no green screen found")
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.where(labels == big, 255, 0).astype(np.uint8)


def order(pts):
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def quad(mask):
    """Four corners of the screen. Rounded corners are fitted by intersecting lines fitted to each side."""
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    for eps in np.linspace(0.01, 0.08, 30):
        a = cv2.approxPolyDP(hull, eps * peri, True)
        if len(a) == 4:
            break
    else:
        a = cv2.boxPoints(cv2.minAreaRect(c))
    q = order(a)
    # Refine: fit a line to the contour points near each side, intersect neighbours (sharp corners of the glass).
    pts = c.reshape(-1, 2).astype(np.float32)
    lines = []
    for i in range(4):
        p, r = q[i], q[(i + 1) % 4]
        seg = r - p
        L = np.linalg.norm(seg)
        n = np.array([-seg[1], seg[0]]) / L
        t = ((pts - p) @ seg) / (L * L)
        dist = np.abs((pts - p) @ n)
        sel = pts[(t > 0.15) & (t < 0.85) & (dist < max(6, 0.03 * L))]
        if len(sel) < 10:
            return q
        vx, vy, x0, y0 = cv2.fitLine(sel, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        lines.append((np.array([x0, y0]), np.array([vx, vy])))
    out = []
    for i in range(4):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        A = np.array([d1, -d2]).T
        if abs(np.linalg.det(A)) < 1e-6:
            return q
        t = np.linalg.solve(A, p2 - p1)
        out.append(p1 + t[0] * d1)
    return order(out)


def compose(scene_path, shot_path, out_base):
    scene = cv2.imread(scene_path)
    shot = cv2.imread(shot_path)
    mask = green_mask(scene)
    q = quad(mask)
    h, w = shot.shape[:2]
    # Match the screenshot to the screen's orientation (a landscape screen gets a landscape shot and vice versa).
    side_w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    side_h = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    if (side_w > side_h) != (w > h):
        raise RuntimeError(f"orientation mismatch: screen {side_w:.0f}x{side_h:.0f}, shot {w}x{h}")
    # Downscale with area averaging to about the screen's size on the photo first (a 2400 px screenshot warped straight
    # into a ~400 px quad aliases badly: jagged text and edges), then warp with cubic interpolation.
    scale = min(1.0, 1.25 * max(side_w / w, side_h / h))
    shot = cv2.resize(shot, (max(2, round(w * scale)), max(2, round(h * scale))), interpolation=cv2.INTER_AREA)
    h, w = shot.shape[:2]
    src = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(src, q)
    warped = cv2.warpPerspective(shot, H, (scene.shape[1], scene.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

    # Screen look: slightly lower contrast and a touch of the scene's warmth, a soft diagonal sheen, mild softness.
    warped = warped.astype(np.float32)
    warped = warped * 0.93 + 10
    sheen = np.zeros(scene.shape[:2], np.float32)
    x0, y0 = q[0]
    x2, y2 = q[2]
    yy, xx = np.mgrid[0 : scene.shape[0], 0 : scene.shape[1]].astype(np.float32)
    diag = ((xx - x0) / max(1, x2 - x0) + (yy - y0) / max(1, y2 - y0)) / 2
    sheen = np.clip(1 - np.abs(diag - 0.3) / 0.25, 0, 1) * 14
    warped = np.clip(warped + sheen[..., None], 0, 255)
    warped = cv2.GaussianBlur(warped, (0, 0), 0.4)

    # Alpha: the green area, grown 2 px to cover the anti-aliased fringe, feathered.
    # Straight edges come from the fitted quad (drawn anti-aliased at 4x); the green mask, grown a little, keeps the
    # rounded corners and anything in front of the screen (fingers).
    S = 4
    poly = np.zeros((scene.shape[0] * S, scene.shape[1] * S), np.uint8)
    cv2.fillPoly(poly, [np.round(q * S).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    poly = cv2.resize(poly, (scene.shape[1], scene.shape[0]), interpolation=cv2.INTER_AREA)
    grown = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=3)
    alpha = np.minimum(poly, grown).astype(np.float32) / 255
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.7)[..., None]
    out = scene.astype(np.float32) * (1 - alpha) + warped * alpha

    # Despill: pixels around the screen that still lean green get their green capped at max(red, blue).
    ring = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=6) > 0
    b, g, r = out[..., 0], out[..., 1], out[..., 2]
    cap = np.maximum(r, b) + 6
    g[ring] = np.minimum(g[ring], cap[ring])
    out = np.clip(out, 0, 255).astype(np.uint8)

    cv2.imwrite(out_base + ".png", out)
    cv2.imwrite(out_base + ".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    left = cv2.inRange(cv2.cvtColor(out, cv2.COLOR_BGR2HSV), (40, 110, 90), (85, 255, 255))
    return int(np.count_nonzero(left))


def main():
    final = os.path.join(OUT, "final")
    os.makedirs(final, exist_ok=True)
    only = sys.argv[1:]
    for key, (n, shot) in PICKS.items():
        if only and key not in only:
            continue
        scene = os.path.join(OUT, "scenes", key, f"{n}.png")
        try:
            left = compose(scene, os.path.join(OUT, "raw", shot + ".png"), os.path.join(final, key))
            print(f"{key}: ok ({shot}; {left} green px left)")
        except Exception as e:  # noqa: BLE001
            print(f"{key}: FAILED {e}")


if __name__ == "__main__":
    main()
