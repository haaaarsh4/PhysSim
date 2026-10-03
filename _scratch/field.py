"""Measure the hero channel across every tight crop we have.

Each crop is the same design in the same palette at a different moment, so a
cell of the wall that a marble covers in one crop is usually bare in another.
Accumulating per (angle, t) cell over all crops and taking the median across
crops gives a shading field that is measured everywhere, not invented.
"""
import glob, math, os
from PIL import Image, ImageChops, ImageFilter

WANT_LEFT, WANT_RIGHT = (219, 218, 227), (204, 204, 215)
LUMA = lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


def close(a, b, tol=3):
    return all(abs(a[i] - b[i]) <= tol for i in range(3))


def candidates():
    out = []
    for p in sorted(glob.glob('/tmp/freebuff-desktop-pastes/*.png')):
        try:
            im = Image.open(p).convert('RGB')
        except Exception:
            continue
        w, h = im.size
        if not (600 <= w <= 1400 and 300 <= h <= 900):
            continue
        if close(im.getpixel((2, h - 4)), WANT_LEFT, 4) and close(im.getpixel((w - 3, h - 4)), WANT_RIGHT, 4):
            out.append((os.path.basename(p), im))
    return out


def sat_mask(im):
    r, g, b = im.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    s = ImageChops.subtract(mx, mn)
    return s.point(lambda v: 255 if v > 14 else 0).filter(ImageFilter.MaxFilter(9))


def fit_circle(pts):
    n = len(pts)
    sxx = sum(x * x for _, x in pts); syy = sum(y * y for y, _ in pts)
    sxy = sum(x * y for y, x in pts); sx = sum(x for _, x in pts); sy = sum(y for y, _ in pts)
    sxz = sum(x * (x * x + y * y) for y, x in pts); syz = sum(y * (x * x + y * y) for y, x in pts)
    sz = sum(x * x + y * y for y, x in pts)
    A = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]]
    for i in range(3):
        piv = max(range(i, 3), key=lambda r: abs(A[r][i]))
        A[i], A[piv] = A[piv], A[i]
        for r in range(3):
            if r != i:
                f = A[r][i] / A[i][i]
                for c in range(i, 4):
                    A[r][c] -= f * A[i][c]
    a = A[0][3] / A[0][0]; b = A[1][3] / A[1][1]; c = A[2][3] / A[2][2]
    cx, cy = a / 2, b / 2
    return cx, cy, math.sqrt(c + cx * cx + cy * cy)


def robust_fit(pts, tol=2.5, rounds=4):
    pts = list(pts)
    cx = cy = R = 0.0
    for i in range(rounds):
        cx, cy, R = fit_circle(pts)
        keep = [(y, x) for (y, x) in pts if abs(math.hypot(x - cx, y - cy) - R) <= tol]
        if len(keep) < 20:
            break
        pts = keep
    rms = (sum((math.hypot(x - cx, y - cy) - R) ** 2 for y, x in pts) / len(pts)) ** 0.5
    return cx, cy, R, len(pts), rms


def geometry(im, tag):
    W, H = im.size
    px = im.load()
    mask = sat_mask(im).load()

    # the panel split: the last column that is still the flat left panel
    splits = []
    for y in range(0, 24):
        for x in range(W - 5, 4, -1):
            if close(px[x, y], WANT_LEFT, 2):
                splits.append(x + 1)
                break
    split = int(sorted(splits)[len(splits) // 2])

    # outer silhouette, left of the split, sub-pixel at the lip's half rise
    def edge_x(y):
        base = LUMA(px[1, y])
        for x in range(3, split - 2):
            p = px[x, y]
            if mask[x, y]:
                return None
            l = LUMA(p)
            if l > base + 13:
                l0 = LUMA(px[x - 1, y])
                if l > l0:
                    return x - 1 + (base + 6.5 - l0) / (l - l0)
                return float(x)
        return None

    pts = [(y, e) for y in range(H - 2) if (e := edge_x(y)) is not None]
    cx, cy, rout, npts, rms = robust_fit(pts)

    # inner silhouette: inside the mouth the hole is bare panel down to the
    # inner lip, so the first wall pixel down a column is on that lip. Which
    # columns those are is not known until the lip is fitted, so iterate.
    icx = icy = rin = float('nan')
    nipts, irms = 0, 0.0
    frac = 0.62
    for _ in range(4):
        ipts = []
        for x in range(4, W - 4):
            if abs(x - cx) > frac * rout:
                continue
            base = LUMA(WANT_RIGHT if x >= split else WANT_LEFT)
            for y in range(int(cy) + 7, H - 2):
                if mask[x, y]:
                    break
                if LUMA(px[x, y]) > base + 11:
                    ipts.append((y, x))
                    break
        if len(ipts) < 40:
            break
        icx, icy, rin, nipts, irms = robust_fit(ipts)
        frac = rin / rout * 1.12

    print('%-40s %4dx%-4d split=%4d | cx=%7.2f cy=%7.2f rout=%7.2f (rms %.2f, %d pts) | '
          'rin=%7.2f (cx=%7.2f cy=%7.2f, rms %.2f, %d pts) | rout/rin=%.4f' %
          (tag, W, H, split, cx, cy, rout, rms, npts, rin, icx, icy, irms, nipts, rout / rin))
    return {'cx': cx, 'cy': cy, 'rout': rout, 'rin': rin, 'split': split, 'W': W, 'H': H}


def field(im, g, NA, NT):
    px = im.load()
    mask = sat_mask(im).load()
    W, H = im.size
    span = g['rout'] - g['rin']
    acc = [[[0.0, 0.0, 0.0, 0] for _ in range(NT)] for _ in range(NA)]
    for y in range(max(0, int(g['cy'])), H):
        dy = y - g['cy']
        for x in range(max(0, int(g['cx'] - g['rout'])), min(W, int(g['cx'] + g['rout']) + 1)):
            dx = x - g['cx']
            r = math.hypot(dx, dy)
            if r < g['rin'] + 2 or r > g['rout'] - 2 or mask[x, y]:
                continue
            a = math.degrees(math.atan2(dy, dx))
            if a < 0:
                continue
            c = acc[min(NA - 1, int(a / (180.0 / NA)))][min(NT - 1, int((r - g['rin']) / span * NT))]
            p = px[x, y]
            c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; c[3] += 1
    return acc


def med(v):
    v = sorted(v)
    return v[len(v) // 2] if v else None


crops = candidates()
print('crops in the same palette:')
for n, im in crops:
    print('   %-40s %dx%d' % (n, im.size[0], im.size[1]))
print()

geoms = [(n, im, geometry(im, n)) for n, im in crops]
print()

NA, NT = 24, 30
cells = [[[] for _ in range(NT)] for _ in range(NA)]
counts = [[0] * NT for _ in range(NA)]
for n, im, g in geoms:
    acc = field(im, g, NA, NT)
    for si in range(NA):
        for ti in range(NT):
            c = acc[si][ti]
            if c[3] >= 40:
                cells[si][ti].append((c[0] / c[3], c[1] / c[3], c[2] / c[3]))
                counts[si][ti] += 1

print('coverage (how many crops saw this cell bare):')
for si in range(NA):
    print('%5d-%3d ' % (round(si * 180 / NA), round((si + 1) * 180 / NA)) +
          ' '.join(str(counts[si][ti]) for ti in range(NT)))
print()

print('luma field (rows: angle sector, cols: t = inner wall -> outer wall):')
for si in range(NA):
    row = []
    for ti in range(NT):
        v = cells[si][ti]
        row.append('%3d' % round(LUMA([med([x[k] for x in v]) for k in range(3)])) if v else '  .')
    print('%5d-%3d ' % (round(si * 180 / NA), round((si + 1) * 180 / NA)) + ' '.join(row))
print()

print('JS source (median across crops, hex rgb, rows = angle 0..180, cols = t 0..1):')
for si in range(NA):
    row = []
    for ti in range(NT):
        v = cells[si][ti]
        row.append('"' + ('------' if not v else
                           ''.join('%02x' % max(0, min(255, round(med([x[k] for x in v])))) for k in range(3))) + '"')
    print('  [' + ', '.join(row) + '],')
