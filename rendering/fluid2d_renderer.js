/**
 * rendering/fluid2d_renderer.js - the Fluids tank, seen flat.
 *
 * The 3D bench answers "what shape is the liquid" by walking view rays through
 * a density field. This one answers the same question in a single plane: a
 * cross-section through the middle of the tank, drawn the way a side elevation
 * of a tank is drawn - not a photograph of the glass.
 *
 * The slice is a projection rather than a cut. Every particle contributes in
 * proportion to how close its depth is to the tank's mid-plane, with a
 * Gaussian falloff, so the picture is smooth and never shows the gap between
 * two layers of particles. The particles are splatted into a grid; the grid is
 * measured for its own surface level with the same percentile rule the 3D bench
 * uses, so both views put the free surface at the same height; and the
 * silhouette is sampled from that field at three times the grid's resolution,
 * so the edge is a curve instead of a staircase.
 *
 * Everything after that is the 3D bench's own grammar: the same three optical
 * palettes, the same speed and pressure tints, the same absorption with depth
 * (a thin film is bright, a deep body is dark), the same pale studio
 * background and the same one-pixel frame. Switching views is a change of
 * viewpoint, not a change of bench.
 *
 * Nothing here decides physics. It reads the solver and draws it.
 */
import * as THREE from "three";

import { PanZoomController2D } from "./camera.js";
/* The palettes come from the 3D bench on purpose: two views of one tank that
   disagreed about what water looks like would be two tanks. */
import { LIQUID_LOOKS } from "./fluid3d_renderer.js";

/* The stage's own background, the one the 3D view clears to. */
const STAGE_BG = "#e9e7f0";
const FRAME = "rgba(88, 84, 104, 0.55)";
const GRID_LINE = "rgba(88, 84, 104, 0.045)";
const FLOOR_SHADOW = "rgba(70, 64, 92, 0.16)";

/* The same stops as the 3D bench's speed ramp, in the same order, so a fast jet
   is the same colour in both views. */
const SPEED_RAMP = [
  [0.0, [31, 59, 143]],
  [0.25, [26, 134, 201]],
  [0.5, [47, 192, 180]],
  [0.75, [232, 210, 74]],
  [1.0, [232, 88, 47]],
];

const BALL_LIGHT = "rgba(243, 240, 251, 1)";
const BALL_MID = "rgba(207, 202, 221, 1)";
const BALL_DARK = "rgba(150, 143, 174, 1)";

const hexBytes = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

function rampLookup(stops) {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    }
    const span = b[0] - a[0] || 1;
    const f = Math.min(1, Math.max(0, (t - a[0]) / span));
    table[i * 3] = Math.round(a[1][0] + (b[1][0] - a[1][0]) * f);
    table[i * 3 + 1] = Math.round(a[1][1] + (b[1][1] - a[1][1]) * f);
    table[i * 3 + 2] = Math.round(a[1][2] + (b[1][2] - a[1][2]) * f);
  }
  return table;
}

const SPEED_TABLE = rampLookup(SPEED_RAMP);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a) => a * a * (3 - 2 * a);

export class Fluid2DRenderer {
  constructor(canvas, sim, opts = {}) {
    this.canvas = canvas;
    this.sim = sim;
    this.ctx = canvas.getContext("2d", { alpha: false });

    /* The grid is the field's resolution, in cells across the tank. Eight
       millimetres a cell is fine enough to round a meniscus and coarse enough
       that splatting twelve thousand particles is a fraction of a frame. */
    this.gridX = opts.gridX ?? 160;
    this.gridY = opts.gridY ?? 120;
    this.superSample = opts.superSample ?? 3;

    const nx = this.gridX;
    const ny = this.gridY;
    const n = nx * ny;
    const iw = nx * this.superSample;
    this.field = new Float32Array(n);
    this.speedField = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.mask = new Uint8Array(iw * ny * this.superSample);
    this.image = null;
    this.lineTop = new Float32Array(iw);
    this.lineHas = new Uint8Array(iw);
    this.bins = new Uint32Array(256);

    /* Left unset until `setLook` runs, which is what gives the first palette
       its values: a default written here would make that call a no-op. */
    this.preset = null;
    this.fieldMode = null;
    this.speedScale = 1.4; // m/s at the top of the speed ramp, as in the 3D view
    this.palette = null;
    this.iso = Infinity;
    this.level = 0;
    this.levelFrames = 0;
    this.dirty = true;
    this.lastFrame = -1;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;

    /* The camera is the app's own 2D pan/zoom, on a frustum that is never
       looked through: the numbers it keeps - target and zoom height - are what
       this renderer maps the world through. One implementation of "drag to pan,
       wheel to zoom" in the whole app, not two. */
    this.view = new PanZoomController2D(new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60), canvas, {
      target: { x: sim.width / 2, y: sim.height * 0.45 },
      zoomHeight: 1.05,
      minZoom: 0.2,
      maxZoom: 2.4,
      onInteract: () => { this.#limitView(); this.dirty = true; },
    });

    this.setLook("water", "surface");
    this.fit();
  }

  /* ============================================================================
     view
     ============================================================================ */

  /** Keep the view on the bench: no panning into the void, no zoom past the
   *  point where a meniscus fills the screen. */
  #limitView() {
    const { sim } = this;
    const v = this.view;
    v.zoomHeight = clamp(v.zoomHeight, v.minZoom, v.maxZoom);
    v.target.x = clamp(v.target.x, -0.15, sim.width + 0.15);
    v.target.y = clamp(v.target.y, -0.15, sim.height + 0.15);
  }

  /** Frame the whole tank, with a margin. Called when the 2D view is entered,
   *  so the first thing it shows is the whole experiment. */
  fit() {
    const { sim } = this;
    this.#measure();
    const aspect = this.width / Math.max(1, this.height);
    const margin = 1.14;
    const byHeight = sim.height * margin;
    const byWidth = (sim.width * margin) / Math.max(0.2, aspect);
    this.view.target.x = sim.width / 2;
    this.view.target.y = sim.height * 0.47;
    this.view.zoomHeight = Math.min(this.view.maxZoom, Math.max(this.view.minZoom, Math.max(byHeight, byWidth)));
    this.dirty = true;
  }

  zoom(factor) {
    this.view.zoom(factor);
    this.dirty = true;
  }

  setLook(preset, fieldMode = this.fieldMode ?? "surface") {
    const mode = fieldMode ?? "surface";
    if (preset === this.preset && mode === this.fieldMode) return;
    const look = LIQUID_LOOKS[preset] ?? LIQUID_LOOKS.water;
    this.preset = preset;
    this.fieldMode = mode;
    this.palette = {
      shallow: hexBytes(look.shallow),
      deep: hexBytes(look.deep),
      sky: hexBytes(look.sky),
      absorb: look.absorb,
    };
    this.absorbLut = null;
    this.dirty = true;
  }

  setField(mode) {
    this.setLook(this.preset, mode);
  }

  /** Something outside the simulation changed the picture (a lab was rebuilt, a
   *  field was re-tinted): draw again even if the clock has not moved. */
  invalidate() {
    this.dirty = true;
    /* A rebuilt scene is not the old one easing into the new one: the level is
       measured afresh rather than interpolated from the tank that has just been
       thrown away. */
    this.levelFrames = 0;
  }

  resize() {
    this.#measure();
    this.dirty = true;
  }

  #measure() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  /* ============================================================================
     frame
     ============================================================================ */

  update() {
    if (this.width < 2 || this.height < 2) return;
    const frame = this.sim.frame;
    if (!this.dirty && frame === this.lastFrame) return;
    this.lastFrame = frame;
    this.dirty = false;

    this.#buildField();
    this.#measureLevel();
    const image = this.#paint();
    this.#draw(image);
  }

  /* ============================================================================
     the field
     ============================================================================ */

  /**
   * Splat the particles into the cross-section.
   *
   * The depth weighting is what makes this a slice: a particle at the mid-plane
   * counts fully, one at the glass counts for a few percent. That is why the
   * picture is smooth - the alternative, taking only the particles inside a thin
   * slab, shows the pool in horizontal bands as the lattice drifts through the
   * slab.
   *
   * The wall reflections are the 3D bench's fix for the same problem it has: a
   * kernel that is a disc loses the half of itself that lies outside the tank,
   * so the density at the glass reads half of the tank's and the surface pulls
   * a cell in from the wall. Mirroring the particle through each wall it can
   * reach restores the missing half, and the liquid then meets the glass
   * exactly.
   */
  #buildField() {
    const sim = this.sim;
    const nx = this.gridX;
    const ny = this.gridY;
    const field = this.field;
    const speedField = this.speedField;
    const mode = this.fieldMode;
    /* Only the speed tint needs a second field: pressure is read off the depth
       below the free surface, which the picture already knows. */
    const dataView = mode === "speed";
    field.fill(0);
    if (dataView) speedField.fill(0);

    const W = sim.width, H = sim.height, D = sim.depth;
    const cellX = W / nx;
    const cellY = H / ny;
    const reach = sim.spacing * 1.4;
    const radius = Math.max(3, reach / cellX);
    const r2 = radius * radius;
    const invR2 = 1 / r2;
    const zMid = D * 0.5;
    const sigma = Math.max(0.02, D * 0.13);
    const inv2s2 = 1 / (2 * sigma * sigma);
    const zCut = 2.4 * sigma;

    const splat = (px, py, weight, sample) => {
      const gx = px / cellX - 0.5;
      const gy = py / cellY - 0.5;
      const x0 = Math.max(0, Math.ceil(gx - radius));
      const x1 = Math.min(nx - 1, Math.floor(gx + radius));
      const y0 = Math.max(0, Math.ceil(gy - radius));
      const y1 = Math.min(ny - 1, Math.floor(gy + radius));
      for (let j = y0; j <= y1; j++) {
        const dy = j - gy;
        const dy2 = dy * dy;
        const row = j * nx;
        for (let i = x0; i <= x1; i++) {
          const dx = i - gx;
          const d2 = dx * dx + dy2;
          if (d2 > r2) continue;
          const w = 1 - d2 * invR2;
          const ww = w * w * w * weight;
          field[row + i] += ww;
          if (dataView) speedField[row + i] += ww * sample;
        }
      }
    };

    for (let p = 0; p < sim.count; p++) {
      const x = sim.x[p], y = sim.y[p], z = sim.z[p];
      if (!(x >= 0 && x <= W && y >= 0 && y <= H)) continue;
      const dz = z - zMid;
      if (dz > zCut || dz < -zCut) continue;
      const wz = Math.exp(-dz * dz * inv2s2);
      if (wz < 0.005) continue;

      const sample = dataView ? Math.hypot(sim.vx[p], sim.vy[p], sim.vz[p]) : 0;

      splat(x, y, wz, sample);
      if (x < reach) splat(-x, y, wz, sample);
      if (W - x < reach) splat(2 * W - x, y, wz, sample);
      if (y < reach) splat(x, -y, wz, sample);
      if (H - y < reach) splat(x, 2 * H - y, wz, sample);
      /* Corners: only a particle within reach of two walls at once needs both
         reflections, which is the handful in the bottom corners of the pool. */
      if (x < reach && y < reach) splat(-x, -y, wz, sample);
      if (W - x < reach && y < reach) splat(2 * W - x, -y, wz, sample);
      if (x < reach && H - y < reach) splat(-x, 2 * H - y, wz, sample);
      if (W - x < reach && H - y < reach) splat(2 * W - x, 2 * H - y, wz, sample);
    }

    /* Three 1-2-1 passes in each direction. The splat radius is just wide
       enough to close the gaps between particles, which leaves the lattice
       faintly in the field; these take that out and leave the contour smooth
       enough that a wave reads as a curve and not as a run of cells. */
    this.#blur(field);
    this.#blur(field);
    this.#blur(field);

    if (dataView) {
      this.#blur(speedField);
      this.#blur(speedField);
      for (let i = 0; i < field.length; i++) {
        const f = field[i];
        speedField[i] = f > 1e-6 ? speedField[i] / f : 0;
      }
    }
  }

  #blur(a) {
    const nx = this.gridX;
    const ny = this.gridY;
    const tmp = this.scratch;
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      tmp[row] = (a[row] * 3 + a[row + 1]) * 0.25;
      for (let i = 1; i < nx - 1; i++) {
        tmp[row + i] = (a[row + i - 1] + 2 * a[row + i] + a[row + i + 1]) * 0.25;
      }
      tmp[row + nx - 1] = (a[row + nx - 2] + a[row + nx - 1] * 3) * 0.25;
    }
    for (let i = 0; i < nx; i++) {
      a[i] = (tmp[i] * 3 + tmp[nx + i]) * 0.25;
      for (let j = 1; j < ny - 1; j++) a[j * nx + i] = (tmp[(j - 1) * nx + i] + 2 * tmp[j * nx + i] + tmp[(j + 1) * nx + i]) * 0.25;
      a[(ny - 1) * nx + i] = (tmp[(ny - 2) * nx + i] + tmp[(ny - 1) * nx + i] * 3) * 0.25;
    }
  }

  /**
   * Where the free surface is, measured from the field itself.
   *
   * The splatted density is in arbitrary units - it depends on the spacing, the
   * kernel and the number of particles - so a threshold written down as a
   * number would put the surface in a different place every time the tank
   * changed. The 72nd percentile of the occupied cells is the body's own
   * density, and half of that is the halfway point of its surface; the 3D bench
   * measures its level the same way, which is why the two views agree about
   * where the water is.
   */
  #measureLevel() {
    const field = this.field;
    let peak = 0;
    let occupied = 0;
    for (let i = 0; i < field.length; i++) {
      const v = field[i];
      if (v > 1e-4) { occupied++; if (v > peak) peak = v; }
    }
    if (!occupied) {
      this.iso = Infinity;
      this.lineHas.fill(0);
      return;
    }

    const bins = this.bins;
    bins.fill(0);
    for (let i = 0; i < field.length; i++) {
      const v = field[i];
      if (v <= peak * 0.02) continue;
      bins[Math.min(255, ((v / peak) * 256) | 0)]++;
    }
    let level = peak * 0.72;
    const goal = occupied * 0.72;
    let acc = 0;
    for (let b = 0; b < 256; b++) {
      const next = acc + bins[b];
      if (next >= goal) {
        const within = bins[b] ? (goal - acc) / bins[b] : 0.5;
        level = ((b + within) / 256) * peak;
        break;
      }
      acc = next;
    }
    /* Eased, so a level that moves by a hair between frames is a hair of motion
       and not a shimmer along every edge. Not eased on the first frame: the
       level starts as a guess, and easing from there is the pool visibly
       swelling for the first second on a bench nobody has started. */
    const target = Math.max(1e-5, level * 0.5);
    this.level = this.levelFrames > 1 ? this.level * 0.86 + target * 0.14 : target;
    this.levelFrames++;
    this.iso = this.level;
  }

  /* ============================================================================
     the picture
     ============================================================================ */

  /**
   * The liquid, as an RGBA image the canvas scales over the tank with its own
   * smoothing.
   *
   * Two passes, and the order matters. The first samples the field and decides
   * one thing only - is this pixel inside the liquid - into a mask. The second
   * walks each column of that mask from the top down, so every pixel knows
   * which surface it hangs from: the drop falling through the air is shaded
   * from its own underside, and the pool under it from the pool. That is also
   * where the waterline is recorded, which is why the highlight drawn later
   * sits exactly on the edge that was drawn.
   */
  #paint() {
    const nx = this.gridX;
    const ny = this.gridY;
    const ss = this.superSample;
    const iw = nx * ss;
    const ih = ny * ss;
    const sim = this.sim;
    const H = sim.height;

    if (!this.image || this.image.width !== iw || this.image.height !== ih) {
      this.image = new ImageData(iw, ih);
      this.mask = new Uint8Array(iw * ih);
      this.offscreen = document.createElement("canvas");
      this.offscreen.width = iw;
      this.offscreen.height = ih;
      this.offCtx = this.offscreen.getContext("2d");
    }
    const img = this.image;
    const px = img.data;
    const mask = this.mask;
    const out = this.offscreen;
    const octx = this.offCtx;
    const field = this.field;
    const iso = this.iso;
    const mode = this.fieldMode;
    const look = this.palette ?? { shallow: [95, 198, 216], deep: [13, 106, 125], sky: [169, 215, 228], absorb: 0.34 };
    const [sr, sg, sb] = look.shallow;
    const [dr, dg, db] = look.deep;

    if (!Number.isFinite(iso)) {
      px.fill(0);
      mask.fill(0);
      this.lineHas.fill(0);
      octx.putImageData(img, 0, 0);
      return out;
    }

    /* Coverage starts below the surface level, at 0.42 of it, for a reason that
       is about the sheet rather than the pool: a film a centimetre or two thick
       cannot reach the density a body of water does, because the splat kernel is
       wider than the film is. Judged at the surface level it would be a ghost;
       judged at a little under half of it, it is a sheet, and the pool's own
       silhouette barely moves - its surface crosses that band in a third of a
       cell, the film rises through it over a centimetre. The ramp itself stays
       narrow: it is the antialiasing, not a haze. */
    const lo = iso * 0.42;
    const invSpan = 1 / (iso * 0.1);

    /* Pass one: coverage. */
    for (let row = 0; row < ih; row++) {
      /* Where in the tank this row sits, and which two field rows it falls
         between. The image's first row is the top of the tank and the field's
         first row is the bottom, so one of them counts backwards. */
      const gy = (ih - 1 - row + 0.5) / ss - 0.5;
      const j0 = clamp(Math.floor(gy), 0, ny - 1);
      const j1 = Math.min(ny - 1, j0 + 1);
      const fy = clamp(gy - j0, 0, 1);
      const rowA = j0 * nx;
      const rowB = j1 * nx;
      let at = row * iw;
      for (let c = 0; c < iw; c++, at++) {
        const gx = (c + 0.5) / ss - 0.5;
        const i0 = clamp(Math.floor(gx), 0, nx - 1);
        const i1 = Math.min(nx - 1, i0 + 1);
        const fx = clamp(gx - i0, 0, 1);
        const topA = field[rowA + i0] * (1 - fx) + field[rowA + i1] * fx;
        const botA = field[rowB + i0] * (1 - fx) + field[rowB + i1] * fx;
        const v = topA * (1 - fy) + botA * fy;
        let a = (v - lo) * invSpan;
        mask[at] = a <= 0 ? 0 : (smoothstep(a > 1 ? 1 : a) * 255) | 0;
      }
    }

    /* Absorption as a lookup over depth: the per-pixel path is arithmetic and
       not a hundred and fifty thousand exponentials. */
    const depthMax = 0.6;
    const lutN = 256;
    let lut = this.absorbLut;
    if (!lut) {
      lut = this.absorbLut = new Float32Array(lutN);
      for (let i = 0; i < lutN; i++) lut[i] = 1 - Math.exp(-((i / (lutN - 1)) * depthMax) / look.absorb);
    }

    const speedField = this.speedField;
    const speedInv = 1 / this.speedScale;
    const yStep = H / ih;

    /* Pass two: colour, per column, so the shading knows its own surface. */
    this.lineHas.fill(0);
    for (let c = 0; c < iw; c++) {
      let runTop = -1;
      for (let row = 0; row < ih; row++) {
        const at = row * iw + c;
        const cover = mask[at];
        if (!cover) {
          /* Cleared, not skipped: an image that keeps the pixels the liquid has
             left is the pool's whole history stacked up behind it. */
          px[at * 4 + 3] = 0;
          runTop = -1;
          continue;
        }
        const yWorld = H - (row + 0.5) * yStep;
        if (runTop < 0) {
          runTop = H - (row - 0.5) * yStep;
          if (!this.lineHas[c]) { this.lineTop[c] = runTop; this.lineHas[c] = 1; }
        }
        let d = runTop - yWorld;
        if (!(d > 0)) d = 0;
        const a = cover / 255;

        const col = at * 4;
        let r, g, b, alpha;
        if (mode === "surface") {
          /* A body of water in section is seen through the tank's depth, not
             through the distance below its own surface: even the shallowest
             pool is half a metre of water to look through, which is why a
             pool is a colour and not a tint. The depth below the surface then
             darkens it the rest of the way, so a wave has a light lip and a
             trough is the deep colour. */
          const t = 0.38 + 0.62 * lut[clamp((d / depthMax) * (lutN - 1), 0, lutN - 1) | 0];
          r = sr + (dr - sr) * t;
          g = sg + (dg - sg) * t;
          b = sb + (db - sb) * t;
          /* The first millimetres of a body catch the room: the bright lip the
             3D view gets from its own rim term. */
          const lit = d < 0.06 ? 1 - d / 0.06 : 0;
          const glow = lit * lit * 0.24;
          if (glow > 0) {
            r += (255 - r) * glow;
            g += (255 - g) * glow;
            b += (255 - b) * glow;
          }
          alpha = (0.95 + 0.048 * t) * a;
        } else if (mode === "speed") {
          /* The speed field is indexed from the bottom of the tank, the image
             from the top. */
          const jf = clamp(ny - 1 - Math.floor(row / ss), 0, ny - 1);
          const vx = speedField[jf * nx + clamp(Math.round((c + 0.5) / ss - 0.5), 0, nx - 1)];
          const speed = Math.min(1, Math.max(0, vx * speedInv));
          const k = ((speed * 255) | 0) * 3;
          r = SPEED_TABLE[k];
          g = SPEED_TABLE[k + 1];
          b = SPEED_TABLE[k + 2];
          alpha = 0.95 * a;
        } else {
          /* The 3D bench's pressure tint, at this column's own depth. */
          const t = clamp(d / Math.max(0.05, H * 0.7), 0, 1);
          r = (0.24 + 0.75 * t) * 255;
          g = (0.78 - 0.45 * t) * 255;
          b = (0.92 - 0.55 * t) * 255;
          alpha = 0.93 * a;
        }
        px[col] = r;
        px[col + 1] = g;
        px[col + 2] = b;
        px[col + 3] = alpha * 255;
      }
    }

    octx.putImageData(img, 0, 0);
    return out;
  }

  /** Draw the floor, the glass, the body and the liquid, in that order. */
  #draw(liquid) {
    const { ctx, sim } = this;
    const W = sim.width, H = sim.height;
    const w = this.width, h = this.height;
    const dpr = this.dpr;
    const scale = h / this.view.zoomHeight;
    const ox = w / 2 - this.view.target.x * scale;
    const oy = h / 2 + this.view.target.y * scale;
    const left = ox;
    const bottom = oy;
    const right = ox + W * scale;
    const top = oy - H * scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, w, h);

    /* The bench the tank stands on. The 3D view has a pale disc under it, and a
       tank with nothing under it reads as a rectangle floating in the page. */
    const shadow = ctx.createLinearGradient(0, bottom, 0, bottom + 14);
    shadow.addColorStop(0, FLOOR_SHADOW);
    shadow.addColorStop(1, "rgba(70, 64, 92, 0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(left, bottom, right - left, 14);

    /* The glass: a breath of white inside the frame, as in the 3D walls. */
    const glass = ctx.createLinearGradient(0, top, 0, bottom);
    glass.addColorStop(0, "rgba(255, 255, 255, 0.4)");
    glass.addColorStop(0.55, "rgba(255, 255, 255, 0.22)");
    glass.addColorStop(1, "rgba(255, 255, 255, 0.12)");
    ctx.fillStyle = glass;
    ctx.fillRect(left, top, right - left, bottom - top);

    /* Ten-centimetre rulings: faint enough to sit under the liquid, precise
       enough to read a depth off without measuring anything. */
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.1; x < W - 0.05; x += 0.1) {
      const sx = Math.round(left + x * scale) + 0.5;
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, bottom);
    }
    for (let y = 0.1; y < H - 0.05; y += 0.1) {
      const sy = Math.round(bottom - y * scale) + 0.5;
      ctx.moveTo(left, sy);
      ctx.lineTo(right, sy);
    }
    ctx.stroke();

    /* The body, drawn under the liquid: a sphere seen in section is a disc, and
       the part of it above the water is the part the 3D view shows too. */
    const ball = sim.ball;
    if (ball.visible) {
      const bx = left + ball.x * scale;
      const by = bottom - ball.y * scale;
      const br = Math.max(1.5, ball.r * scale);
      const grad = ctx.createRadialGradient(bx - br * 0.38, by - br * 0.42, br * 0.08, bx, by, br * 1.05);
      grad.addColorStop(0, BALL_LIGHT);
      grad.addColorStop(0.55, BALL_MID);
      grad.addColorStop(1, BALL_DARK);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(84, 78, 108, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* The liquid, clipped to the tank, so a surface that reaches the glass is
       cut by the glass and not spilt over the frame. */
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(liquid, left, top, right - left, bottom - top);
    this.#surfaceLine(ctx, left, bottom, scale);
    ctx.restore();

    /* The frame, drawn last and outside the clip: the liquid never covers it. */
    ctx.strokeStyle = FRAME;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(right - left), Math.round(bottom - top));

    /* The floor of the tank, a shade heavier than the walls it meets. */
    ctx.beginPath();
    ctx.moveTo(left, Math.round(bottom) + 0.5);
    ctx.lineTo(right, Math.round(bottom) + 0.5);
    ctx.strokeStyle = "rgba(88, 84, 104, 0.72)";
    ctx.stroke();
  }

  /**
   * The waterline: the one place a liquid catches the light as a line rather
   * than as a body of colour.
   *
   * Only the top boundary is drawn. A rim all the way round would read as a
   * white line inside the water, which is exactly what a body of water does not
   * have. The points are the mask's own first liquid pixel per column, smoothed
   * across three of them - the field's contour is a curve, but a curve sampled
   * once a column still steps, and a stepped line is the one thing the eye
   * finds immediately on a still pool.
   */
  #surfaceLine(ctx, left, bottom, scale) {
    const iw = this.lineTop.length;
    const has = this.lineHas;
    const top = this._smoothTop ??= new Float32Array(iw);
    top.set(this.lineTop);
    for (let pass = 0; pass < 2; pass++) {
      let prev = top[0];
      for (let i = 1; i < iw - 1; i++) {
        const here = top[i];
        top[i] = has[i] && has[i - 1] && has[i + 1] ? (prev + 2 * here + top[i + 1]) * 0.25 : here;
        prev = here;
      }
    }

    const path = new Path2D();
    let drawing = false;
    for (let c = 0; c < iw; c++) {
      if (!has[c]) { drawing = false; continue; }
      const x = left + ((c + 0.5) / iw) * this.sim.width * scale;
      const y = bottom - top[c] * scale;
      if (drawing) path.lineTo(x, y);
      else { path.moveTo(x, y); drawing = true; }
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    /* A soft halo first, the crisp line over it: the other way round and the
       glow is what the eye sees along the waterline. */
    ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
    ctx.lineWidth = 3.5;
    ctx.stroke(path);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.2;
    ctx.stroke(path);
  }

  dispose() {
    this.view.dispose();
    this.offscreen = null;
  }
}
