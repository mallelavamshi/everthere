"""Minimal vector app-icon concepts (SVG, 1024 px). Geometry is computed here; render.mjs rasterises them."""
import math, os, sys
sys.stdout.reconfigure(encoding="utf-8")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "icon5")
os.makedirs(OUT, exist_ok=True)

def hull(pts):
    pts = sorted(set(pts))
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def circle_pts(cx, cy, r, n=180):
    return [(round(cx + r*math.cos(2*math.pi*i/n), 2), round(cy + r*math.sin(2*math.pi*i/n), 2)) for i in range(n)]

def heart(c1, r1, c2, r2, tip, rounding=0):
    """A heart as the convex hull of two lobes and a tip (lobes may differ: parent and child)."""
    pts = circle_pts(*c1, r1) + circle_pts(*c2, r2) + circle_pts(tip[0], tip[1], max(1, rounding), 24)
    h = hull(pts)
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in h) + " Z"

def heart_concave(c1, r1, c2, r2, tip):
    """Union of two circles and the hull of their bottoms + tip, so the top keeps its dip between the lobes."""
    left = circle_pts(*c1, r1); right = circle_pts(*c2, r2)
    lower = [p for p in left + right if p[1] > min(c1[1], c2[1])] + [tip]
    h = hull(lower + [c1, c2])
    poly = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in h) + " Z"
    return (f'<circle cx="{c1[0]}" cy="{c1[1]}" r="{r1}"/><circle cx="{c2[0]}" cy="{c2[1]}" r="{r2}"/><path d="{poly}"/>')

SUNSET = '''<radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#FFD66B"/><stop offset="0.45" stop-color="#FF8A5C"/><stop offset="1" stop-color="#7A4FD0"/></radialGradient>'''
CORAL = '''<linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="1024"><stop offset="0" stop-color="#FFB24C"/><stop offset="0.55" stop-color="#FF6A5C"/><stop offset="1" stop-color="#C2477F"/></linearGradient>'''
INK = '''<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E2346"/><stop offset="1" stop-color="#1B1530"/></linearGradient>
<linearGradient id="fg" gradientUnits="userSpaceOnUse" x1="300" y1="260" x2="740" y2="780"><stop offset="0" stop-color="#FFC857"/><stop offset="0.6" stop-color="#FF7A59"/><stop offset="1" stop-color="#E0589A"/></linearGradient>'''

def svg(defs, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>{defs}</defs><rect width="1024" height="1024" fill="url(#bg)"/>{body}</svg>'

concepts = {}

# 1. Two-lobe heart: a big lobe (parent) and a small lobe (child) make one heart.
big = ((430, 452), 150); small = ((636, 488), 104); tip = (520, 760)
concepts["1-parent-child-heart-sunset"] = svg(SUNSET, f'<g fill="#FFFFFF">{heart_concave(big[0], big[1], small[0], small[1], tip)}</g>')
concepts["1b-parent-child-heart-ink"] = svg(INK, f'<g fill="url(#fg)">{heart_concave(big[0], big[1], small[0], small[1], tip)}</g>')

# 5. Holding: a thick heart outline (the parent) holding a small solid heart (the child) inside it.
outer = heart_concave((420, 455), 150, (604, 455), 150, (512, 790))
inner = heart_concave((478, 520), 44, (546, 520), 44, (512, 600))
def holding(fill_outer, fill_inner, cut):
    return (f'<g fill="{fill_outer}">{outer}</g>'
            f'<g fill="{cut}" transform="translate(512 548) scale(0.62) translate(-512 -548)">{outer}</g>'
            f'<g fill="{fill_inner}">{inner}</g>')
concepts["5-holding-coral"] = svg(CORAL, holding("#FFFFFF", "#FFFFFF", "url(#bg)"))
concepts["5b-holding-ink"] = svg(INK, holding("url(#fg)", "url(#fg)", "#211A38"))

concepts["1c-parent-child-heart-coral"] = svg(CORAL, f'<g fill="#FFFFFF">{heart_concave(big[0], big[1], small[0], small[1], tip)}</g>')

for name, s in concepts.items():
    open(os.path.join(OUT, name + ".svg"), "w", encoding="utf-8").write(s)
print(len(concepts), "svgs")
