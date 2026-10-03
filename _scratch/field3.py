"""The channel's shading field, measured from every hero shot we have.

The reference crop is the anchor and its geometry is the one the renderer
already draws with, so the field is expressed in the anchor's own angles and
radii: t = 0 on the inner lip, t = 1 on the outer lip.

Every other shot is registered onto the anchor by direct search over ring
scale and offset, minimising the luma error over pixels that are bare in both
(which also solves the palette difference between shots). A shot whose
registration cannot get the error down is not the same design and is dropped.

Each cell of the wall is then measured off whichever shots show it uncovered.
"""
import glob, math, os, random
from PIL import Image, ImageChops, ImageFilter

LUMA = lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
ANCHOR_PATH = '/tmp/freebuff-desktop-pastes/paste-1790354373712-2610946.png'
A = {'cx': 414.6, 'cy': 86.0, 'rin': 192.5, 'rout': 380.5}
PALETTES = [((219, 218, 227), (204, 204, 215)), ((236, 235, 241), (219, 218, 227))]


def sat_mask(im):
    r, g, b = im.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    return ImageChops.subtract(mx, mn).point(lambda v: 255 if v > 14 else 0).filter(ImageFilter.MaxFilter(11))


def load(path):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    px = im.load()
    pl, pr = px[3, H - 5], px[W - 4, H - 5]
    ok = False
    for a, b in PALETTES:
        if all(abs(pl[k] - a[k]) <= 3 for k in range(3)) and all(abs(pr[k] - b[k]) <= 3 for k in range(3)):
            ok = True
    if not ok:
        return None
    return {'path': path, 'name': os.path.basename(path), 'px': px, 'mask': sat_mask(im).load(),
            'W': W, 'H': H, 'pl': pl, 'pr': pr}


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


def silhouette_centre(s):
    px, mask, W, H = s['px'], s['mask'], s['W'], s['H']
    thr = max(LUMA(s['pl']), LUMA(s['pr'])) + 11
    pts = []
    limit = min(W - 3, int(W * 0.6))
    for y in range(H - 2):
        for x in range(2, limit):
            if mask[x, y]:
                break
            if LUMA(px[x, y]) > thr:
                pts.append((y, x))
                break
    if len(pts) < 60:
        return None
    for _ in range(4):
        cx, cy, R = fit_circle(pts)
        keep = [(y, x) for (y, x) in pts if abs(math.hypot(x - cx, y - cy) - R) <= 2.0]
        if len(keep) < 30:
            break
        pts = keep
    return cx, cy, R, len(pts)


def bare(s, x, y):
    if not (0 <= x < s['W'] and 0 <= y < s['H']):
        return False
    if s['mask'][x, y]:
        return False
    r = math.hypot(x - s['cx'], y - A['cy'])
    return True


def affine(pairs):
    out = []
    for k in range(3):
        n = len(pairs)
        sx = sum(p[1][k] for p in pairs); sy = sum(p[0][k] for p in pairs)
        sxx = sum(p[1][k] ** 2 for p in pairs); sxy = sum(p[0][k] * p[1][k] for p in pairs)
        d = n * sxx - sx * sx
        a = 1.0 if abs(d) < 1e-6 else (n * sxy - sx * sy) / d
        out.append((a, (sy - a * sx) / n))
    return out


anchor = load(ANCHOR_PATH)
apx, amask = anchor['px'], anchor['mask']

# sample points on and around the channel, in the anchor's own frame
random.seed(7)
SAMP = []
for _ in range(4000):
    r = A['rin'] - 30 + random.random() * (A['rout'] - A['rin'] + 60)
    a = math.radians(random.random() * 180)
    x = int(round(A['cx'] + r * math.cos(a)))
    y = int(round(A['cy'] + r * math.sin(a)))
    if 0 <= x < anchor['W'] and 0 <= y < anchor['H'] and not amask[x, y]:
        SAMP.append((x, y, apx[x, y]))
print('anchor sample points: %d' % len(SAMP))

SOURCES = []
for p in sorted(glob.glob('/tmp/freebuff-desktop-pastes/*.png')):
    s = load(p)
    if s is None:
        continue
    got = silhouette_centre(s)
    if got is None:
        print('skip %-40s (no silhouette)' % s['name'])
        continue
    s['cx'], s['cy'], s['rout'], s['npts'] = got
    scale0 = s['rout'] / A['rout'] if s['rout'] > 0 else 1.0
    best = None
    for si in range(-12, 13):
        scale = scale0 * (1 + si * 0.005)
        for dxi in range(-3, 4):
            for dyi in range(-3, 4):
                dx = dxi * 1.5; dy = dyi * 1.5
                pairs = []
                for (x, y, c) in SAMP:
                    xs = int(round(s['cx'] + (x - A['cx']) * scale + dx))
                    ys = int(round(s['cy'] + (y - A['cy']) * scale + dy))
                    if 0 <= xs < s['W'] and 0 <= ys < s['H'] and not s['mask'][xs, ys]:
                        pairs.append((c, list(s['px'][xs, ys])))
                if len(pairs) < 200:
                    continue
                ab = affine(pairs)
                e = sum(abs(LUMA([ab[k][0] * q[1][k] + ab[k][1] for k in range(3)]) - LUMA(q[0]))
                        for q in pairs) / len(pairs)
                if best is None or e < best[0]:
                    best = (e, scale, dx, dy, len(pairs), ab)
    if best is None:
        print('skip %-40s (no registration)' % s['name'])
        continue
    e, scale, dx, dy, n, ab = best
    print('%-40s %4dx%-5d ring-scale %.4f  offset (%+.1f,%+.1f)  fits %d pts  affine %s  residual %.2f luma'
          % (s['name'], s['W'], s['H'], scale, dx, dy, s['npts'], ['%.3f/%+.1f' % c for c in ab], e))
    if e > 3.5:
        print('   dropped: residual too high to be the same design')
        continue
    s['scale'] = scale; s['dx'] = dx; s['dy'] = dy; s['affine'] = ab
    SOURCES.append(s)

NAP, NTP = 24, 28
span = A['rout'] - A['rin']
FIELDS = []
for s in SOURCES:
    inc = 1 if s['scale'] > 1.4 else 2
    acc = [[[0.0, 0.0, 0.0, 0] for _ in range(NTP)] for _ in range(NAP)]
    for ys in range(0, s['H'], inc):
        for xs in range(0, s['W'], inc):
            if s['mask'][xs, ys]:
                continue
            x = A['cx'] + (xs - s['cx'] - s['dx']) / s['scale']
            y = A['cy'] + (ys - s['cy'] - s['dy']) / s['scale']
            dx_, dy_ = x - A['cx'], y - A['cy']
            r = math.hypot(dx_, dy_)
            if r < A['rin'] + 2 or r > A['rout'] - 2 or dy_ < 2:
                continue
            a = math.degrees(math.atan2(dy_, dx_))
            if a < 0 or a > 180:
                continue
            c = acc[min(NAP - 1, int(a / (180.0 / NAP)))][min(NTP - 1, int((r - A['rin']) / span * NTP))]
            p = s['px'][xs, ys]
            for k in range(3):
                c[k] += max(0.0, min(255.0, s['affine'][k][0] * p[k] + s['affine'][k][1]))
            c[3] += 1
    FIELDS.append([[None if acc[i][j][3] < 30 else [acc[i][j][k] / acc[i][j][3] for k in range(3)]
                    for j in range(NTP)] for i in range(NAP)])

print()
print('coverage (sources bare per cell):')
for i in range(NAP):
    print('%4d-%3d ' % (round(i * 180 / NAP), round((i + 1) * 180 / NAP)) +
          ' '.join('%2d' % sum(1 for f in FIELDS if f[i][j]) for j in range(NTP)))

med = lambda v: sorted(v)[len(v) // 2]
GRID = [[None] * NTP for _ in range(NAP)]
for i in range(NAP):
    for j in range(NTP):
        v = [f[i][j] for f in FIELDS if f[i][j]]
        if v:
            GRID[i][j] = [med([x[k] for x in v]) for k in range(3)]

measured = sum(1 for i in range(NAP) for j in range(NTP) if GRID[i][j])
hole = [(i, j) for i in range(NAP) for j in range(NTP) if not GRID[i][j]]
print()
print('%d of %d cells measured; %d filled by smooth continuation of the measured field'
      % (measured, NAP * NTP, len(hole)))

# the cells a marble never stopped covering: continue the field into them by
# relaxation, so every value stays a smooth extension of measured neighbours
for (i, j) in hole:
    vals = [f[i][j] for f in FIELDS if f[i][j]]
    GRID[i][j] = [med([x[k] for x in vals]) for k in range(3)] if vals else [0.0, 0.0, 0.0]
W8 = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
      (-1, -1, 0.6), (-1, 1, 0.6), (1, -1, 0.6), (1, 1, 0.6)]
for _ in range(900):
    for (i, j) in hole:
        acc = [0.0, 0.0, 0.0]; tw = 0.0
        for (di, dj, w) in W8:
            ii, jj = i + di, j + dj
            if 0 <= ii < NAP and 0 <= jj < NTP:
                c = GRID[ii][jj]
                for k in range(3):
                    acc[k] += w * c[k]
                tw += w
        GRID[i][j] = [a / tw for a in acc]


def cell(i, j):
    return GRID[i][j]

print()
print('luma field (rows: angle 0=right mouth -> 180=left, cols: t 0=inner wall -> 1=outer):')
for i in range(NAP):
    row = []
    for j in range(NTP):
        c = cell(i, j)
        row.append('%3d' % round(LUMA(c)) if c else '  .')
    print('%4d-%3d ' % (round(i * 180 / NAP), round((i + 1) * 180 / NAP)) + ' '.join(row))

print()
print()
print('JS FIELD: %d sectors (angle 0 -> 180) x %d stops (t 0 -> 1), hex rrggbb' % (NAP, NTP))
for i in range(NAP):
    row = []
    for j in range(NTP):
        c = cell(i, j)
        row.append('"' + ('------' if c is None else
                          ''.join('%02x' % max(0, min(255, round(v))) for v in c)) + '"')
    print('  [' + ', '.join(row) + '],')
