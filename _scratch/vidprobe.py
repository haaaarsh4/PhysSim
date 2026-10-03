"""Can the video be used as a photometric source?

It has an obvious screen/camera brightness falloff (the panels read 199..177
where the crop reads 219/204). If that falloff is smooth, it can be measured
off the panels and divided out - and the test of whether that worked is
whether the frame's wall profile then lands on the crop's.
"""
import math, glob
from PIL import Image, ImageChops, ImageFilter

LUMA = lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
A = {'cx': 414.6, 'cy': 86.0, 'rin': 192.5, 'rout': 380.5}
PL, PR = 219.3, 204.4          # the crop's own flat panel luma


def mask_of(im):
    r, g, b = im.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    return ImageChops.subtract(mx, mn).point(lambda v: 255 if v > 14 else 0).filter(ImageFilter.MaxFilter(9))


def fit_circle(pts):
    n = len(pts)
    sxx = sum(x * x for _, x in pts); syy = sum(y * y for y, _ in pts)
    sxy = sum(x * y for y, x in pts); sx = sum(x for _, x in pts); sy = sum(y for y, _ in pts)
    sxz = sum(x * (x * x + y * y) for y, x in pts); syz = sum(y * (x * x + y * y) for y, x in pts)
    sz = sum(x * x + y * y for y, x in pts)
    M = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]]
    for i in range(3):
        p = max(range(i, 3), key=lambda r: abs(M[r][i]))
        M[i], M[p] = M[p], M[i]
        for r in range(3):
            if r != i:
                f = M[r][i] / M[i][i]
                for c in range(i, 4):
                    M[r][c] -= f * M[i][c]
    a = M[0][3] / M[0][0]; b = M[1][3] / M[1][1]; c = M[2][3] / M[2][2]
    return a / 2, b / 2, math.sqrt(c + (a / 2) ** 2 + (b / 2) ** 2)


im = Image.open('_scratch/vf/full_001.png').convert('RGB')
px = im.load()
W, H = im.size
mask = mask_of(im).load()

# left silhouette: the first pixel on each row that is brighter than the panel
pts = []
for y in range(H - 2):
    if mask[2, y]:
        continue
    base = LUMA(px[2, y])
    for x in range(6, int(W * 0.55)):
        if mask[x, y]:
            break
        if LUMA(px[x, y]) > base + 12:
            pts.append((y, x))
            break
for _ in range(4):
    cx, cy, R = fit_circle(pts)
    keep = [(y, x) for (y, x) in pts if abs(math.hypot(x - cx, y - cy) - R) <= 2.5]
    if len(keep) < 40:
        break
    pts = keep
print('video frame %dx%d  silhouette fit cx=%.2f cy=%.2f rout=%.2f (%d pts)' % (W, H, cx, cy, R, len(pts)))

# register to the anchor: source = scale*(anchor - A) + (cx,cy) + (dx,dy)
SAMP = []
for ry in range(60, H - 60, 7):
    for rx in range(60, W - 60, 7):
        if mask[rx, ry]:
            continue
        SAMP.append((rx, ry))
print('sample pixels:', len(SAMP))

scale0 = R / A['rout']
best = None
for si in range(-10, 11):
    scale = scale0 * (1 + si * 0.004)
    for dxi in range(-3, 4):
        for dyi in range(-3, 4):
            dx = dxi * 2.0; dy = dyi * 2.0
            # how well does the panel field predict the flat anchors?
            errs = []
            for (rx, ry) in SAMP[::4]:
                xa = A['cx'] + (rx - cx - dx) / scale
                ya = A['cy'] + (ry - cy - dy) / scale
                # only pixels that are panel in the anchor (outside the ring)
                if math.hypot(xa - A['cx'], ya - A['cy']) < A['rout'] + 12:
                    continue
                errs.append(LUMA(px[rx, ry]))
            if len(errs) < 200:
                continue
            var = max(errs) - min(errs)
            if best is None or var < best[0]:
                best = (var, scale, dx, dy, len(errs))
print('registration by flattest panel field: scale=%.4f offset=(%.1f,%.1f) spread=%.1f luma over %d px'
      % (best[1], best[2], best[3], best[0], best[4]))
scale, dx, dy = best[1], best[2], best[3]


def to_anchor(rx, ry):
    return (A['cx'] + (rx - cx - dx) / scale, A['cy'] + (ry - cy - dy) / scale)


# panel samples: pixels that are panel in the anchor
P = []
for ry in range(2, H - 2, 3):
    for rx in range(2, W - 2, 3):
        if mask[rx, ry]:
            continue
        xa, ya = to_anchor(rx, ry)
        r = math.hypot(xa - A['cx'], ya - A['cy'])
        if r < A['rout'] + 20:
            continue
        k = PL if xa < A['cx'] else PR
        v = LUMA(px[rx, ry])
        if v < 40:
            continue
        P.append((rx, ry, k / v))
print('panel samples for the falloff fit:', len(P))

# smooth 2-D cubic fit of the correction factor
TERMS = [(i, j) for i in range(4) for j in range(4) if i + j <= 3]


def design(rx, ry):
    return [((rx / W) ** i) * ((ry / H) ** j) for (i, j) in TERMS]


n = len(TERMS)
M = [[0.0] * (n + 1) for _ in range(n)]
for (rx, ry, c) in P[:: 2]:
    d = design(rx, ry)
    for i in range(n):
        for j in range(n):
            M[i][j] += d[i] * d[j]
        M[i][n] += d[i] * c
for i in range(n):
    p = max(range(i, n), key=lambda r: abs(M[r][i]))
    M[i], M[p] = M[p], M[i]
    for r in range(n):
        if r != i:
            f = M[r][i] / M[i][i]
            for c in range(i, n + 1):
                M[r][c] -= f * M[i][c]
coef = [M[i][n] / M[i][i] for i in range(n)]


def corr(rx, ry):
    d = design(rx, ry)
    return sum(coef[i] * d[i] for i in range(n))


# check the panels come out flat
vals = [LUMA(px[rx, ry]) * corr(rx, ry) for (rx, ry, _) in P[:: 37]]
left = [v for (rx, ry, _), v in zip(P[:: 37], vals) if rx < cx]
right = [v for (rx, ry, _), v in zip(P[:: 37], vals) if rx >= cx]
print('corrected panel: left mean %.1f (spread %.1f)   right mean %.1f (spread %.1f)   [crop is %.1f / %.1f]'
      % (sum(left) / len(left), max(left) - min(left), sum(right) / len(right), max(right) - min(right), PL, PR))

# the frame's wall profile vs the crop's, at angles where nothing covers it
crop = Image.open('/tmp/freebuff-desktop-pastes/paste-1790354373712-2610946.png').convert('RGB')
cpx = crop.load()
for ang in [160, 140, 120, 60, 40, 20]:
    row_a, row_b = [], []
    for i in range(13):
        t = i / 12
        r = A['rin'] + t * (A['rout'] - A['rin'])
        xa = A['cx'] + r * math.cos(math.radians(ang))
        ya = A['cy'] + r * math.sin(math.radians(ang))
        row_a.append(round(LUMA(cpx[int(xa), int(ya)])))
        rx = cx + (xa - A['cx']) * scale + dx
        ry = cy + (ya - A['cy']) * scale + dy
        v = LUMA(px[int(rx), int(ry)]) * corr(int(rx), int(ry))
        row_b.append(round(v))
    print('  %3d  crop %s' % (ang, ' '.join('%3d' % v for v in row_a)))
    print('       vid  %s' % ' '.join('%3d' % v for v in row_b))
