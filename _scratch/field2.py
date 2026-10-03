"""The channel's shading field, measured.

The reference crop is the anchor: its geometry is the one the renderer already
uses, so anything measured in it is exact by construction. Everything else on
disk that shows the same design at the same moment-to-moment variety - three
more tight crops and the full-size screenshots - is calibrated onto the anchor
(scale of the ring, and a per-channel affine for the palette difference) and
then used to fill the cells of the wall that a marble happens to cover in the
anchor. Marbles move between shots, so between them they cover everything.
"""
import glob, math, os
from PIL import Image, ImageChops, ImageFilter

LUMA = lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
ANCHOR = '/tmp/freebuff-desktop-pastes/paste-1790354373712-2610946.png'
ANCHOR_G = {'cx': 414.6, 'cy': 86.0, 'rin': 192.5, 'rout': 380.5, 'split': 416}
DESIGN_RATIO = 380.5 / 192.5


def sat_mask(im):
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


def robust_fit(pts, tol=2.0, rounds=5):
    pts = list(pts)
    cx = cy = R = 0.0
    for _ in range(rounds):
        cx, cy, R = fit_circle(pts)
        keep = [(y, x) for (y, x) in pts if abs(math.hypot(x - cx, y - cy) - R) <= tol]
        if len(keep) < 30:
            break
        pts = keep
    rms = (sum((math.hypot(x - cx, y - cy) - R) ** 2 for y, x in pts) / len(pts)) ** 0.5
    return cx, cy, R, len(pts), rms


def load(path):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    px = im.load()
    pl, pr = px[3, H - 4], px[W - 4, H - 4]
    mask = sat_mask(im).load()

    splits = []
    for y in range(2, 30):
        for x in range(W - 6, 4, -1):
            if all(abs(px[x, y][k] - pl[k]) <= 2 for k in range(3)):
                splits.append(x + 1)
                break
    split = int(sorted(splits)[len(splits) // 2])

    # outer silhouette: on each row, the first pixel brighter than either panel
    thr = max(LUMA(pl), LUMA(pr)) + 11
    pts = []
    for y in range(H - 2):
        for x in range(2, split - 2):
            if mask[x, y]:
                break
            if LUMA(px[x, y]) > thr:
                pts.append((y, x + 0.5))
                break
    cx, cy, rout, npts, rms = robust_fit(pts)
    return {'path': path, 'name': os.path.basename(path), 'im': im, 'px': px, 'mask': mask,
            'W': W, 'H': H, 'split': split, 'cx': cx, 'cy': cy, 'rout': rout, 'rms': rms,
            'npts': npts, 'pl': pl, 'pr': pr}


def bare(s, x, y, rin, rout):
    if not (0 <= x < s['W'] and 0 <= y < s['H']):
        return False
    if s['mask'][x, y]:
        return False
    r = math.hypot(x - s['cx'], y - s['cy'])
    return rin + 2 <= r <= rout - 2


def cell_of(s, x, y, rin, rout, NA, NT):
    dy = y - s['cy']
    if dy < 0:
        return None
    r = math.hypot(x - s['cx'], dy)
    if r < rin or r > rout:
        return None
    a = math.degrees(math.atan2(dy, x - s['cx']))
    if a < 0 or a > 180:
        return None
    return (min(NA - 1, int(a / (180.0 / NA))), min(NT - 1, int((r - rin) / (rout - rin) * NT)))


def accumulate(s, rin, rout, NA, NT):
    """per-cell mean colour, or None where the wall is covered in this source"""
    acc = [[[0.0, 0.0, 0.0, 0] for _ in range(NT)] for _ in range(NA)]
    for y in range(max(0, int(s['cy']) - 2), s['H']):
        for x in range(max(0, int(s['cx'] - rout) - 2), min(s['W'], int(s['cx'] + rout) + 2)):
            if not bare(s, x, y, rin, rout):
                continue
            c = cell_of(s, x, y, rin, rout, NA, NT)
            if c is None:
                continue
            cell = acc[c[0]][c[1]]
            p = s['px'][x, y]
            cell[0] += p[0]; cell[1] += p[1]; cell[2] += p[2]; cell[3] += 1
    return [[(None if acc[i][j][3] < 24 else [acc[i][j][k] / acc[i][j][3] for k in range(3)])
             for j in range(NT)] for i in range(NA)]


PALETTES = [((219, 218, 227), (204, 204, 215)), ((236, 235, 241), (219, 218, 227))]


def is_hero(path):
    try:
        im = Image.open(path).convert('RGB')
    except Exception:
        return None
    w, h = im.size
    if w < 600 or h < 300:
        return None
    pl, pr = im.getpixel((3, h - 5)), im.getpixel((w - 4, h - 5))
    for a, b in PALETTES:
        if all(abs(pl[k] - a[k]) <= 3 for k in range(3)) and all(abs(pr[k] - b[k]) <= 3 for k in range(3)):
            return path
    return None


SOURCES = []
for p in sorted(glob.glob('/tmp/freebuff-desktop-pastes/*.png')):
    if not is_hero(p):
        continue
    try:
        s = load(p)
    except Exception as e:
        print('skip %-40s (%s)' % (os.path.basename(p), e))
        continue
    if s['npts'] < 120 or s['rms'] > 0.6:
        print('skip %-40s (%d pts, rms %.2f)' % (s['name'], s['npts'], s['rms']))
        continue
    SOURCES.append(s)

print()
print('sources (outer silhouette fit; rout is where the wall crosses panel+11 luma):')
for s in SOURCES:
    print('  %-40s %4dx%-5d split=%4d cx=%8.2f cy=%8.2f rout=%8.2f rms=%.2f n=%d  panels %s / %s'
          % (s['name'], s['W'], s['H'], s['split'], s['cx'], s['cy'], s['rout'], s['rms'], s['npts'], s['pl'], s['pr']))

anchor = [s for s in SOURCES if s['name'] == os.path.basename(ANCHOR)][0]
others = [s for s in SOURCES if s is not anchor]
print()
print('anchor: %s rout=%.2f  (ring true edges %.1f .. %.1f)' % (anchor['name'], anchor['rout'], ANCHOR_G['rin'], ANCHOR_G['rout']))
print()

NA, NT = 24, 28
RINGS = {}
RINGS[id(anchor)] = (ANCHOR_G['rin'], ANCHOR_G['rout'])
A_FIELD = accumulate(anchor, ANCHOR_G['rin'], ANCHOR_G['rout'], NA, NT)


def affine(pairs):
    """least squares v_ref = A*v_src + B per channel"""
    out = []
    for k in range(3):
        n = len(pairs)
        sx = sum(p[1][k] for p in pairs); sy = sum(p[0][k] for p in pairs)
        sxx = sum(p[1][k] ** 2 for p in pairs); sxy = sum(p[0][k] * p[1][k] for p in pairs)
        d = n * sxx - sx * sx
        A = 1.0 if abs(d) < 1e-6 else (n * sxy - sx * sy) / d
        B = (sy - A * sx) / n
        out.append((A, B))
    return out


def shared_pairs(s, field, rin, rout):
    pairs = []
    for i in range(NA):
        for j in range(NT):
            a = field[i][j]
            if a is None:
                continue
            t = (j + 0.5) / NT
            r = ANCHOR_G['rin'] + t * (ANCHOR_G['rout'] - ANCHOR_G['rin'])
            ang = math.radians((i + 0.5) * 180 / NA)
            x = int(round(ANCHOR_G['cx'] + r * math.cos(ang)))
            y = int(round(ANCHOR_G['cy'] + r * math.sin(ang)))
            if not bare(s, x, y, rin, rout):
                continue
            pairs.append((a, list(s['px'][x, y])))
    return pairs


print('ratio calibration: rin = rout/ratio per source, then how well sources agree with the anchor')
print('  ratio   | disagreement with anchor (mean |luma| over shared cells)')
best = None
for ratio in [1.90, 1.93, 1.96, 1.977, 2.00, 2.03, 2.06, 2.10]:
    errs = []
    for s in others:
        ring = (s['rout'] * (ANCHOR_G['rout'] / anchor['rout']) / ratio, s['rout'] * (ANCHOR_G['rout'] / anchor['rout']))
        pairs = shared_pairs(s, A_FIELD, ring[0], ring[1])
        if len(pairs) < 30:
            continue
        ab = affine(pairs)
        e = [abs(LUMA([ab[k][0] * p[1][k] + ab[k][1] for k in range(3)]) - LUMA(p[0])) for p in pairs]
        errs.append((s['name'], len(pairs), sum(e) / len(e)))
    tot = sum(x[2] * x[1] for x in errs) / max(1, sum(x[1] for x in errs))
    print('  %.3f   | %.2f   %s' % (ratio, tot, ' '.join('%s:%.2f' % (n[:12], e) for n, _, e in errs)))
    if best is None or tot < best[1]:
        best = (ratio, tot)

print()
print('best ratio %.3f (weighted mean disagreement %.2f luma)' % best)
RATIO = best[0]

FIELDS = {id(anchor): A_FIELD}
for s in others:
    rout = s['rout'] * (ANCHOR_G['rout'] / anchor['rout'])
    rin = rout / RATIO
    f = accumulate(s, rin, rout, NA, NT)
    pairs = shared_pairs(s, A_FIELD, rin, rout)
    ab = affine(pairs)
    print('  %-40s ring %.1f..%.1f  affine %s  shared=%d'
          % (s['name'], rin, rout, ['%.4f/%.2f' % c for c in ab], len(pairs)))
    for i in range(NA):
        for j in range(NT):
            v = f[i][j]
            if v is not None:
                f[i][j] = [max(0.0, min(255.0, ab[k][0] * v[k] + ab[k][1])) for k in range(3)]
    FIELDS[id(s)] = f

print()
print('coverage (sources bare per cell):')
for i in range(NA):
    print('%4d-%3d ' % (round(i * 180 / NA), round((i + 1) * 180 / NA)) +
          ' '.join('%2d' % sum(1 for s in SOURCES if FIELDS[id(s)][i][j]) for j in range(NT)))
print()

med = lambda v: sorted(v)[len(v) // 2]
print('luma field:')
for i in range(NA):
    row = []
    for j in range(NT):
        v = [FIELDS[id(s)][i][j] for s in SOURCES if FIELDS[id(s)][i][j]]
        row.append('%3d' % round(LUMA([med([x[k] for x in v]) for k in range(3)])) if v else '  .')
    print('%4d-%3d ' % (round(i * 180 / NA), round((i + 1) * 180 / NA)) + ' '.join(row))
print()

print('JS source: SECTOR x STOP hex, angle 0 (right mouth) -> 180 (left), t 0 (inner wall) -> 1:')
for i in range(NA):
    row = []
    for j in range(NT):
        v = [FIELDS[id(s)][i][j] for s in SOURCES if FIELDS[id(s)][i][j]]
        if not v:
            row.append('"------"')
        else:
            row.append('"' + ''.join('%02x' % max(0, min(255, round(med([x[k] for x in v])))) for k in range(3)) + '"')
    print('  [' + ', '.join(row) + '],')
