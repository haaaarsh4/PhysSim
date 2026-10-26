/**
 * frontend/tube.js - the hero's glass channel.
 *
 * The reference is a photograph of a solid glass U: a half torus whose two
 * mouths are cut flat on the bend's centre line, lit from the upper right,
 * sitting on a two-tone backdrop that is split down the middle of the bend.
 * Nothing about it is outlined - the whole read comes from the way light
 * travels across the wall.
 *
 * So it is painted the way it was photographed. The wall's colour is a
 * function of two things only: how far round the bend a point is, and how far
 * across the wall it sits. Both were measured - see FIELD below - and the
 * renderer just samples that.
 *
 * Every number in REF is in reference units - the pixels of the measured
 * frame. Callers scale the whole thing to whatever size they need, which
 * keeps the geometry exact at any viewport.
 */

/* --------------------------------------------------------------------------
   the measured frame
   -------------------------------------------------------------------------- */
export const REF = {
  w: 854,            // frame width
  h: 472,            // frame height
  top: -150,         // headroom above the frame, for marbles on their way in
  cx: 414.6,         // bend centre - the split runs through it
  cy: 86,            // mouth plane, and the bend centre's own height
  rin: 192.5,        // inner wall
  rout: 380.5,       // outer wall
  split: 414.6,      // the seam: the bend's own centre, 48.548% across
};

export const BOX = { w: REF.w, h: REF.h - REF.top };

/* the marble: 57/380.5 of the outer wall, riding 312 out from the centre -
   slightly outside the wall's own midline, the way a ball sits in a trough */
export const BALL = { r: 57, path: 312 };

export const PANEL_LEFT = [233, 232, 240];   // #E9E8F0, = --home-bg-left
export const PANEL_RIGHT = [220, 219, 230];  // #DCDBE6, = --home-bg-right

/* --------------------------------------------------------------------------
   the shading field
   --------------------------------------------------------------------------
   Rows are angle around the bend: 0 is the right mouth, 180 the left, in 24
   steps of 7.5°. Columns are cross-section: t = 0 on the inner wall, t = 1 on
   the outer, in 28 steps.

   Measured, cell by cell, off the reference frame and three other shots of
   the same design - the four of them at different moments, so wherever a
   marble covers the wall in one, another shows it bare. Each shot was
   registered onto the reference by direct search and its palette matched
   before it was read, so every cell is the same picture. The cells no shot
   ever showed (a marble is always somewhere in the middle of the right arm)
   are continued into from the measured field around them; 497 of the 672 are
   direct measurements.

   What it says, in short: the inner lip is the bright edge everywhere (240 at
   its brightest, on the left of the bend), the wall darkens as it turns away,
   and the two sides genuinely differ - right of the seam the shade band sits
   in against the inner wall and the wall reads a dozen or so levels deeper,
   left of it the band has slid out towards the outer wall and the whole wall
   is brighter. */
const FIELD = [
  ['e0dfe8', 'd2d1da', 'cac7d3', 'c7c1ce', 'c3becb', 'c1bcc9', 'bfbbc8', 'bebec9', 'bfbfca', 'c1c1cd', 'c3c3ce', 'c5c5d0', 'c6c7d2', 'c8c9d4', 'cbcbd6', 'cdcdd8', 'cfcfdb', 'd1d2dc', 'd3d4de', 'd5d6e1', 'd7d7e2', 'd8d9e4', 'dadae5', 'dadae5', 'dbdbe6', 'dddde8', 'e2e0ec', 'eae7f3'],
  ['e0dfe9', 'd2d1da', 'cbc8d3', 'c7c2cf', 'c4bfcb', 'c1bdc9', 'bfbdc9', 'bfbfc9', 'c0c0cb', 'c2c2cd', 'c3c3cf', 'c5c5d0', 'c7c7d2', 'c8c9d4', 'cbcbd6', 'cccdd8', 'cecfda', 'd0d1dc', 'd2d2dd', 'd3d4df', 'd5d6e1', 'd6d7e2', 'd7d7e2', 'd8d8e3', 'd9d9e4', 'dcdbe6', 'e1dfea', 'e9e6f2'],
  ['e0dfe8', 'd3d2db', 'cbc8d3', 'c8c2cf', 'c5bfcc', 'c2bdca', 'c1beca', 'c0c0cb', 'c2c2cd', 'c3c3ce', 'c4c4cf', 'c6c6d1', 'c7c8d3', 'cac9d5', 'cccbd6', 'ccccd7', 'ceced9', 'cfcfda', 'd1d0dc', 'd2d1dd', 'd2d2dd', 'd3d3de', 'd4d4df', 'd6d5e0', 'd7d6e2', 'dbd8e4', 'dfdde8', 'e7e6ef'],
  ['e1e0e9', 'd3d2db', 'ccc9d4', 'c8c3d0', 'c5c0cd', 'c4bfcc', 'c4c0cd', 'c4c1cd', 'c4c3ce', 'c4c4cf', 'c5c5d0', 'c6c6d2', 'c8c8d3', 'cacad5', 'cbcbd6', 'cbccd7', 'cdced8', 'ceced9', 'cfceda', 'cfd0db', 'd0d0dc', 'd1d1dc', 'd1d1dd', 'd2d2dd', 'd5d3df', 'd9d6e2', 'dedce7', 'e6e5ef'],
  ['e0dfe9', 'd4d1dd', 'ccc9d5', 'c8c3d0', 'c7c1ce', 'c5c2ce', 'c5c3ce', 'c4c3cf', 'c5c4d0', 'c6c6d1', 'c5c7d1', 'c7c7d2', 'c9c9d4', 'cbcad5', 'cccbd6', 'cccdd7', 'cdcdd8', 'ceced9', 'cfceda', 'ceceda', 'cecfda', 'cecfda', 'cfcfdb', 'd0d0dc', 'd3d1dc', 'd7d4df', 'ddd9e4', 'e6e3ed'],
  ['e1dfea', 'd3d1dc', 'ccc9d5', 'c9c6d2', 'c7c5d1', 'c5c5d0', 'c6c5d0', 'c5c5d0', 'c6c6d1', 'c7c7d2', 'c8c8d3', 'c9c9d4', 'cacad5', 'cbcbd6', 'ccccd7', 'cdcdd8', 'ceced8', 'ceced9', 'cfced9', 'cfcfda', 'cfcfda', 'cfcfda', 'd0d0db', 'd1d0db', 'd3d1dc', 'd3d0dc', 'd8d7e2', 'e3e2ec'],
  ['e0dee9', 'd4d2dc', 'ceccd7', 'ccc9d5', 'c9c7d3', 'c8c7d2', 'c7c7d2', 'c6c7d1', 'c8c8d3', 'c9c9d4', 'cacad4', 'cbcad5', 'cccbd6', 'ccccd7', 'cdcdd7', 'ceced8', 'ceced9', 'cfced9', 'cfcfd9', 'cfcfda', 'cfcfda', 'd0cfda', 'd0d0db', 'd1d0db', 'd2d1dc', 'd5d3de', 'd9d7e2', 'dddbe6'],
  ['e0dee9', 'd6d4df', 'd0ceda', 'cdccd7', 'cbcad6', 'c9cad5', 'c9c9d4', 'c9c9d5', 'cacad5', 'cbcad5', 'cccbd6', 'ccccd7', 'cdcdd7', 'cecdd8', 'ceced8', 'cfced9', 'cfced9', 'cfcfd9', 'd0cfd9', 'd0cfda', 'd0cfda', 'd0d0da', 'd1d0da', 'd1d0db', 'd2d0db', 'd4d1dc', 'd9d5e0', 'e0dee9'],
  ['e1dfea', 'd8d6e1', 'd3d0dc', 'cfceda', 'cdcdd8', 'ccccd7', 'cccbd7', 'cbcbd6', 'cbccd6', 'cdccd7', 'cecdd8', 'ceced8', 'cfced8', 'cfced9', 'cfcfd9', 'd0cfd9', 'd0cfd9', 'd0cfd9', 'd0cfd9', 'd0cfd9', 'd0cfda', 'd1d0da', 'd1d0da', 'd1d0da', 'd1cfda', 'cdcad5', 'd5d3dd', 'dfdde7'],
  ['e2e0e9', 'dad8e2', 'd5d3df', 'd1d1dc', 'cecfda', 'ceced9', 'cdced9', 'cccdd7', 'ceced8', 'cfced9', 'd0cfd9', 'd0cfda', 'd0d0da', 'd1d0da', 'd1d0da', 'd1d0da', 'd1d0da', 'd1d0d9', 'd0d0d9', 'd0cfd9', 'd1d0d9', 'd1d0da', 'd1d0da', 'd2d0da', 'd2d0da', 'd3d1db', 'd7d5de', 'dbdae3'],
  ['e3e1eb', 'dcdae4', 'd7d5e1', 'd3d3de', 'd1d1dc', 'd0d0db', 'cfcfda', 'cfcfd9', 'd0d0db', 'd1d1db', 'd2d1db', 'd2d1db', 'd2d1db', 'd2d1db', 'd2d1db', 'd2d1da', 'd1d0da', 'd1d0da', 'd1d0d9', 'd1d0d9', 'd1d0d9', 'd1d0d9', 'd1d0da', 'd2d1da', 'd3d1db', 'd5d3dd', 'd8d4de', 'd7d6e0'],
  ['e1e0e9', 'dbdae4', 'd7d7e2', 'd5d5e0', 'd3d3de', 'd2d2dd', 'd1d1dc', 'd1d1dc', 'd4d3dd', 'd4d4dd', 'd5d4dd', 'd4d3dd', 'd4d3dd', 'd4d3dc', 'd3d2db', 'd3d2db', 'd2d1da', 'd2d0da', 'd1d0d9', 'd1d0d9', 'd1cfd9', 'd1cfd9', 'd1d0d9', 'd2d1da', 'd4d2db', 'd6d4dd', 'd9d6e1', 'd7d5e1'],
  ['e7e6ef', 'e3e2eb', 'e1e0e9', 'e0dfe8', 'dfdee7', 'dfdde5', 'dad9e2', 'd8d7e1', 'd8d7e1', 'd8d7e0', 'd7d6e0', 'd7d6df', 'd6d5de', 'd6d4dd', 'd5d3dc', 'd4d3db', 'd3d2db', 'd2d1da', 'd1d0d9', 'd1cfd8', 'd0cfd8', 'd0cfd8', 'd1cfd8', 'd2d0d9', 'd4d2db', 'd7d5dd', 'd9d7e0', 'dad8e1'],
  ['edecf4', 'e8e7f0', 'e5e4ec', 'e3e2ea', 'e1e1e9', 'e2e1e9', 'e3dee7', 'dedce5', 'dcdbe4', 'dbdae3', 'dbd9e2', 'dad8e1', 'd8d7e0', 'd7d6df', 'd6d5dd', 'd5d3dc', 'd4d2db', 'd3d1da', 'd1d0d8', 'd0cfd7', 'cfced7', 'cfced6', 'cfced6', 'd1cfd8', 'd3d2da', 'd7d5dd', 'dcdae1', 'dfdde4'],
  ['efeff6', 'eae9f1', 'e7e6ee', 'e5e4ec', 'e3e2eb', 'e2e1ea', 'e1e0e9', 'e2e0e8', 'e0dfe7', 'dfdee5', 'dedbe5', 'dddae4', 'dad9e2', 'd8d8e0', 'd9d6de', 'd7d5dd', 'd4d3db', 'd3d1d9', 'd1d0d8', 'd0ced6', 'ceccd5', 'cdccd4', 'cdccd4', 'cfcdd5', 'd1d0d7', 'd6d5db', 'dedce1', 'eae9ee'],
  ['f1f0f8', 'ebeaf3', 'e8e7f0', 'e7e6ee', 'e6e4ed', 'e5e4ee', 'e4e3eb', 'e3e1ea', 'e1e0e8', 'e0dfe7', 'dedde6', 'dedae5', 'dbd9e3', 'd9d8e1', 'd8d6de', 'd6d5dd', 'd4d3db', 'd2d1da', 'd1d0d8', 'ceced6', 'cccdd5', 'caccd4', 'cbcdd5', 'ccced6', 'd0d0d8', 'd5d4dc', 'dddbe1', 'eae9ef'],
  ['f1f0f8', 'edecf4', 'e9e8f1', 'e8e7ef', 'e7e6ef', 'e6e5ee', 'e6e4ec', 'e4e2eb', 'e2e1ea', 'e1e0e8', 'dedfe6', 'dcdce4', 'dadae3', 'd9d8e1', 'd8d6de', 'd6d4dd', 'd4d2db', 'd3d1da', 'd0cfd8', 'cdced6', 'cbcdd4', 'cbccd4', 'cbccd4', 'cdcdd5', 'd0d0d8', 'd6d4dc', 'dcdbe1', 'e6e5eb'],
  ['efeef7', 'ededf5', 'eaeaf2', 'e9e8f1', 'e8e7f0', 'e8e6f0', 'e8e6ed', 'e7e4ed', 'e6e2ec', 'e1e0ea', 'e0dfe8', 'dedde5', 'dbdae3', 'd9d8e1', 'd8d6df', 'd6d4dd', 'd4d2db', 'd1d1da', 'd0d0d8', 'cdced6', 'caccd4', 'caccd4', 'cbccd4', 'cdced7', 'd0cfda', 'd5d4dd', 'dddbe2', 'e5e5eb'],
  ['eeedf5', 'eeeef5', 'ebeaf2', 'eae8f1', 'e9e8f1', 'e9e7f0', 'eae7ef', 'e6e5ee', 'e4e3ec', 'e2e1ea', 'e1dfe8', 'dfdde6', 'dddbe3', 'dad8e2', 'd8d7df', 'd6d5de', 'd4d3db', 'd2d1da', 'd0cfd9', 'cdcdd7', 'ccccd5', 'ccccd5', 'ccccd5', 'ceced6', 'd1d0d9', 'd5d4dd', 'dcdae2', 'e6e5eb'],
  ['ebebf2', 'efeff6', 'eceaf3', 'ebe9f2', 'e9e8f1', 'e9e8f1', 'e8e7ef', 'e8e6ee', 'e6e4ec', 'e3e1ea', 'e2dfe8', 'dfdde5', 'dcdbe4', 'dad8e2', 'd8d7df', 'd6d5de', 'd4d2dd', 'd2d1db', 'cfd0d9', 'cdced7', 'cbccd5', 'cbccd5', 'cccdd6', 'cdced6', 'd0d1d9', 'd5d4dd', 'dcdae2', 'e5e4eb'],
  ['eae9f1', 'f0eff6', 'eceaf3', 'eae9f1', 'e9e8f1', 'e9e8f1', 'e8e7f0', 'e7e6ee', 'e5e4ec', 'e3e2ea', 'e1dfe8', 'dedde5', 'dcdbe3', 'dad9e1', 'd8d7df', 'd6d5dd', 'd5d3dc', 'd2d1da', 'd1cfd8', 'd0ced7', 'cdccd5', 'cdccd4', 'cecdd6', 'cfced6', 'd2d0d9', 'd5d4dd', 'dbdbe2', 'e5e4eb'],
  ['e8e7ef', 'f0eff6', 'ebeaf3', 'e9e8f1', 'e8e8f0', 'e8e7f0', 'e7e6ef', 'e6e5ee', 'e5e4ec', 'e2e1ea', 'e0dfe8', 'dedde5', 'dcdbe4', 'dad9e2', 'd8d7df', 'd6d5de', 'd4d3dc', 'd2d1da', 'cfd0d8', 'cdcfd6', 'cbcdd5', 'cbcdd5', 'cccdd6', 'cecfd7', 'd2d1d9', 'd6d4dd', 'dbdbe3', 'e4e4ea'],
  ['e7e6ee', 'efeff5', 'eaeaf1', 'e8e7f0', 'e8e6ef', 'e7e6ef', 'e7e6ee', 'e5e4ec', 'e4e3eb', 'e2e1e9', 'e0dfe7', 'dedde5', 'dcdbe3', 'dad9e1', 'd8d7df', 'd6d5de', 'd4d3dc', 'd3d1db', 'd0d0d9', 'cdcfd7', 'cccdd5', 'cbcdd5', 'ccced6', 'cecfd8', 'd2d1da', 'd6d5de', 'dcdbe3', 'e4e4eb'],
  ['e4e2eb', 'efeef6', 'e9e8f1', 'e8e6ef', 'e7e6ee', 'e6e5ed', 'e5e4ed', 'e4e3eb', 'e3e2ea', 'e1e0e9', 'dfdee7', 'dedde5', 'dcdae3', 'dad9e1', 'd8d7df', 'd7d6de', 'd5d4dc', 'd3d2db', 'd2d0d9', 'cfd0d7', 'cdced6', 'cccdd5', 'ccced6', 'cecfd7', 'd2d1da', 'd6d5de', 'dcdbe4', 'e4e4ec'],
];

export const FIELD_SECTORS = FIELD.length;      // 24
export const FIELD_STOPS = FIELD[0].length;     // 28

const SECTORS = FIELD_SECTORS;
const STOPS = FIELD_STOPS;
const SECTOR_DEG = 180 / SECTORS;

/* one flat rgb triple per cell, for bilinear sampling */
const CELL = new Uint8ClampedArray(SECTORS * STOPS * 3);
FIELD.forEach((row, i) => row.forEach((h, j) => {
  const o = (i * STOPS + j) * 3;
  CELL[o] = parseInt(h.slice(0, 2), 16);
  CELL[o + 1] = parseInt(h.slice(2, 4), 16);
  CELL[o + 2] = parseInt(h.slice(4, 6), 16);
}));

/* --------------------------------------------------------------------------
   the marbles
   --------------------------------------------------------------------------
   Sampled off the reference too: every ball reads as the same hue at four
   brightnesses, brightest towards the upper right - light, mid, dark and the
   deepest rim. `glow` is the haze it throws onto the wall behind it. */
export const MARBLES = {
  amber: {
    light: [250, 221, 88], mid: [247, 190, 50], dark: [226, 152, 42],
    deep: [198, 134, 62], glow: [250, 196, 70], rgb: [245, 176, 35],
  },
  teal: {
    light: [0, 227, 210], mid: [0, 200, 185], dark: [0, 167, 154],
    deep: [0, 150, 138], glow: [0, 205, 190], rgb: [0, 201, 192],
  },
  violet: {
    light: [164, 74, 255], mid: [138, 0, 255], dark: [110, 0, 228],
    deep: [92, 0, 194], glow: [130, 0, 255], rgb: [124, 0, 230],
  },
  purple: {
    light: [224, 112, 255], mid: [199, 0, 255], dark: [172, 0, 230],
    deep: [146, 0, 198], glow: [205, 0, 255], rgb: [192, 0, 255],
  },
  pink: {
    light: [255, 142, 200], mid: [255, 26, 138], dark: [230, 0, 110],
    deep: [194, 0, 90], glow: [255, 20, 140], rgb: [255, 0, 132],
  },
  slate: {
    light: [255, 255, 255], mid: [241, 240, 245], dark: [222, 220, 228],
    deep: [199, 197, 207], glow: [228, 226, 234], rgb: [235, 234, 240],
  },
};

export const MARBLE_NAMES = ['amber', 'teal', 'violet', 'purple', 'pink'];

const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

function smooth(a, b, x) {
  const t = (x - a) / (b - a);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/* --------------------------------------------------------------------------
   painting
   -------------------------------------------------------------------------- */

/* the two panels, in canvas pixels */
export function paintPanels(ctx, w, h, scale) {
  const sx = Math.round(REF.split * scale);
  ctx.fillStyle = 'rgb(' + PANEL_LEFT.join(',') + ')';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgb(' + PANEL_RIGHT.join(',') + ')';
  ctx.fillRect(sx, 0, w - sx, h);
}

/**
 * Paint the channel over the panels already on `ctx`.
 * `scale` is device pixels per reference unit; (0,0) in reference space is
 * (0, -REF.top * scale) in canvas space.
 */
export function paintChannel(ctx, w, h, scale) {
  const oy = -REF.top * scale;
  const x0 = Math.max(0, Math.floor((REF.cx - REF.rout - 4) * scale));
  const x1 = Math.min(w, Math.ceil((REF.cx + REF.rout + 4) * scale));
  const y0 = Math.max(0, Math.floor((REF.cy - 4) * scale + oy));
  const y1 = Math.min(h, Math.ceil((REF.cy + REF.rout + 4) * scale + oy));
  if (x1 <= x0 || y1 <= y0) return;

  const span = REF.rout - REF.rin;
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const d = img.data;
  const row = x1 - x0;
  const fall = 2.4 * scale;                 // half-width of the soft edge
  const seam = REF.split * scale;
  /* the seam is a vertical line, and a sector boundary falls within a pixel
     of it, so holding samples to their own side of that boundary keeps the
     seam as crisp as it is in the reference */
  const uSeam = SECTORS / 2 - 0.5;

  for (let py = y0; py < y1; py++) {
    const ry = (py - oy) / scale - REF.cy;
    if (ry < 0) continue;                   // above the mouth there is no channel
    const base = (py - y0) * row;
    for (let px = x0; px < x1; px++) {
      const rx = px / scale - REF.cx;
      const r = Math.sqrt(rx * rx + ry * ry);
      const cov = smooth(REF.rin - fall, REF.rin + fall, r) *
                  (1 - smooth(REF.rout - fall, REF.rout + fall, r));
      if (cov <= 0.003) continue;

      /* bilinear across the measured field: which way round the bend, and
         how far across the wall */
      let u = Math.atan2(ry, rx) * (180 / Math.PI) / SECTOR_DEG - 0.5;
      if (u < 0) u = 0; else if (u > SECTORS - 1) u = SECTORS - 1;
      if (px < seam) { if (u < uSeam) u = uSeam; } else if (u > uSeam) u = uSeam;
      let v = (r - REF.rin) / span * STOPS - 0.5;
      if (v < 0) v = 0; else if (v > STOPS - 1) v = STOPS - 1;

      const i0 = u | 0, j0 = v | 0;
      const i1 = i0 < SECTORS - 1 ? i0 + 1 : i0;
      const j1 = j0 < STOPS - 1 ? j0 + 1 : j0;
      const fu = u - i0, fv = v - j0;
      const a0 = (i0 * STOPS + j0) * 3, a1 = (i1 * STOPS + j0) * 3;
      const b0 = (i0 * STOPS + j1) * 3, b1 = (i1 * STOPS + j1) * 3;
      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv);
      const w01 = (1 - fu) * fv, w11 = fu * fv;
      const o = (py - y0) * row;
      const i = (o + px - x0) * 4;
      const cr = CELL[a0] * w00 + CELL[a1] * w10 + CELL[b0] * w01 + CELL[b1] * w11;
      const cg = CELL[a0 + 1] * w00 + CELL[a1 + 1] * w10 + CELL[b0 + 1] * w01 + CELL[b1 + 1] * w11;
      const cb = CELL[a0 + 2] * w00 + CELL[a1 + 2] * w10 + CELL[b0 + 2] * w01 + CELL[b1 + 2] * w11;
      d[i] += (cr - d[i]) * cov;
      d[i + 1] += (cg - d[i + 1]) * cov;
      d[i + 2] += (cb - d[i + 2]) * cov;
    }
  }
  ctx.putImageData(img, x0, y0);
}

/**
 * One marble. `spec` is an entry from MARBLES, x/y/r are in the caller's
 * current units. Light comes from the upper right, thrown as a soft contact
 * shadow onto the wall, a haze, then the shaded body.
 */
export function paintMarble(ctx, spec, x, y, r) {
  const hx = x + r * 0.46, hy = y - r * 0.52;

  const touch = ctx.createRadialGradient(x, y, r * 0.55, x, y, r * 1.65);
  touch.addColorStop(0, 'rgba(72,68,92,0.26)');
  touch.addColorStop(1, 'rgba(72,68,92,0)');
  ctx.fillStyle = touch;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.65, 0, 6.2832);
  ctx.fill();

  const haze = ctx.createRadialGradient(x, y, r * 0.88, x, y, r * 1.42);
  haze.addColorStop(0, rgba(spec.glow, 0.42));
  haze.addColorStop(1, rgba(spec.glow, 0));
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.42, 0, 6.2832);
  ctx.fill();

  const body = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 1.62);
  body.addColorStop(0, rgba(spec.light, 1));
  body.addColorStop(0.22, rgba(spec.mid, 1));
  body.addColorStop(0.55, rgba(spec.mid, 1));
  body.addColorStop(0.82, rgba(spec.dark, 1));
  body.addColorStop(1, rgba(spec.deep, 1));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 6.2832);
  ctx.fill();
}
