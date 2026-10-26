/**
 * simulation/fluid3d.js - a 3D liquid, as particles.
 *
 * The fluids bench used to be a two-dimensional level-set solve extruded into
 * a slab: right for the cross-section and flat as a picture, because a slab has
 * no volume to refract, no crest to break, no stream to neck. This is the
 * volume it was missing.
 *
 * The method is Position Based Fluids (Macklin & Mueller 2013). A cloud of
 * particles carries mass; each frame gravity predicts where they go, a density
 * constraint is evaluated against their neighbours, and a few Gauss-Seidel
 * iterations move them until the density is the rest density again. Velocities
 * are read back off the corrected positions, so the scheme cannot inject energy
 * the way a stiff force can, and it holds together at the frame rates a browser
 * can afford.
 *
 * Neighbour search is a uniform grid with the kernel radius as its cell, and
 * the pairs are collected once per substep into a flat list: the density, the
 * gradient, the correction and the viscosity pass all walk that list, which is
 * what makes six thousand particles fit in a frame.
 *
 * Units are metres, seconds and kilograms. The tank floor is y = 0 and its
 * interior spans x in [0, width], z in [0, depth].
 */

const POLY6 = (h) => 315 / (64 * Math.PI * Math.pow(h, 9));
const SPIKY = (h) => -45 / (Math.PI * Math.pow(h, 6));

/** The three liquids, and the three ways they differ. */
export const FLUID_MATERIALS = {
  water: { density: 1000, viscosity: 0.001, surfaceTension: 0.072 },
  oil: { density: 900, viscosity: 0.09, surfaceTension: 0.032 },
  honey: { density: 1400, viscosity: 0.7, surfaceTension: 0.05 },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* The neighbour list is the solver's hard ceiling, and it has to be larger
   than a *compressed* neighbourhood, not just a settled one. At the rest
   spacing a poly6 kernel of two cells holds 32 neighbours; a pocket that has
   been squeezed to half the spacing holds eight times that, and a list that
   stops at 96 silently under-reports the density of exactly the particles that
   most need to be pushed apart - which is how a pool compresses to half its
   volume and then reports itself at rest. */
const MAX_NEIGHBOURS = 96;

export class Fluid3D {
  constructor({ width = 1.2, height = 0.9, depth = 0.6, spacing = 0.034 } = {}) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.spacing = spacing;
    this.h = spacing * 2.05;
    this.h2 = this.h * this.h;

    this.params = {
      gravity: 9.81,
      viscosity: 0.001,
      surfaceTension: 0.072,
      bodyAccelX: 0,
    };

    const cap = 12000;
    this.maxParticles = cap;
    const f32 = () => new Float32Array(cap);
    this.x = f32(); this.y = f32(); this.z = f32();
    this.vx = f32(); this.vy = f32(); this.vz = f32();
    this.qx = f32(); this.qy = f32(); this.qz = f32();
    this.ox = f32(); this.oy = f32(); this.oz = f32();
    this.density = f32();
    this.lambda = f32();
    this.count = 0;

    this.time = 0;
    this.frame = 0;
    this.iterations = 4;
    this.substeps = 1;
    this.relaxation = 0.7;
    this.cohesion = 0;

    this.ball = { visible: false, x: 0, y: 0, z: 0, r: 0.055, density: 480, vy: 0, ax: 0 };

    this.grid = {
      nx: Math.ceil(width / this.h) + 1,
      ny: Math.ceil(height / this.h) + 1,
      nz: Math.ceil(depth / this.h) + 1,
      cellStart: null, cursor: null,
      order: new Int32Array(cap),
    };
    this.nbrStart = new Int32Array(cap + 1);
    this.nbrList = new Int32Array(cap * MAX_NEIGHBOURS);
    this.nbrCount = new Uint8Array(cap);

    this._poly6 = POLY6(this.h);
    this._spiky = SPIKY(this.h);
    this._W0 = this._poly6 * Math.pow(this.h2, 3);

    /* The rest density of a perfect lattice at this spacing, and the mass that
       makes it read as rho0. Both are measured off the lattice: the density
       functional is this kernel at this h, and a number borrowed from another
       kernel is a different fluid. */
    let sumW = 0;
    const range = Math.ceil(this.h / spacing);
    for (let k = -range; k <= range; k++) {
      for (let j = -range; j <= range; j++) {
        for (let i = -range; i <= range; i++) {
          const r2 = (i * i + j * j + k * k) * spacing * spacing;
          if (r2 >= this.h2) continue;
          const d = this.h2 - r2;
          sumW += d * d * d * this._poly6;
        }
      }
    }
    /* One particle stands for the water in one lattice cell, so the mass is the
       material density times the cell volume. The rest density is then the
       density this kernel actually reports for that lattice - not a textbook
       number, because the discrete sum is not the unit integral. Getting this
       pair the wrong way round is how a particle fluid silently loses half its
       volume. */
    this.mass = 1000 * Math.pow(spacing, 3);
    /* The rest density is the density this kernel reports for the reference
       lattice. It is not a textbook 1000 kg/m3: the discrete sum of a kernel
       whose support is two cells wide is not the unit integral, and borrowing a
       number from the continuum is how a particle fluid ends up either
       levitating or crushed. At this density the initial lattice is in
       equilibrium, so a pool can be poured and then left alone. */
    this.restDensity = this.mass * Math.max(1e-9, sumW);

    this.fluid = "water";
  }

  /* ======================================================================
     building a scene
     ====================================================================== */

  reset() {
    this.count = 0;
    this.time = 0;
    this.frame = 0;
    this._feedDebt = 0;
    this._feedIndex = 0;
    this.ball.visible = false;
    this.ball.vy = 0;
  }

  add(x, y, z, vx = 0, vy = 0, vz = 0) {
    if (this.count >= this.maxParticles) return -1;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    return i;
  }

  addBlock(x0, y0, z0, x1, y1, z1, velocity = [0, 0, 0]) {
    const s = this.spacing, half = s * 0.5;
    for (let y = y0 + half; y < y1; y += s) {
      for (let z = z0 + half; z < z1; z += s) {
        for (let x = x0 + half; x < x1; x += s) {
          this.add(x, y, z, velocity[0], velocity[1], velocity[2]);
        }
      }
    }
  }

  fillBelow(level, surface = null) {
    const s = this.spacing, half = s * 0.5;
    for (let y = half; y < level; y += s) {
      for (let z = half; z < this.depth; z += s) {
        for (let x = half; x < this.width; x += s) {
          const lift = surface ? surface(x, z) : 0;
          if (y + lift > level) continue;
          this.add(x, y + lift, z);
        }
      }
    }
  }

  addSphere(cx, cy, cz, r, velocity = [0, 0, 0]) {
    const s = this.spacing, half = s * 0.5;
    for (let y = cy - r; y <= cy + r; y += s) {
      for (let z = cz - r; z <= cz + r; z += s) {
        for (let x = cx - r; x <= cx + r; x += s) {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          this.add(x, y, z, velocity[0], velocity[1], velocity[2]);
        }
      }
    }
  }

  /**
   * A tap: a lattice sheet entering through a mouth, one particle at a time, at
   * a rate the caller sets in particles per second. The mouth is filled in a
   * rolling cycle so the incoming sheet keeps the lattice spacing it was given
   * instead of clumping at one corner.
   */
  inject(x0, x1, y, z0, z1, vy, rate, dt) {
    this._feedDebt = (this._feedDebt ?? 0) + rate * dt;
    const s = this.spacing;
    const cols = Math.max(1, Math.floor((x1 - x0) / s));
    const rows = Math.max(1, Math.floor((z1 - z0) / s));
    const mouth = cols * rows;
    this._feedIndex = this._feedIndex ?? 0;
    let guard = 0;
    while (this._feedDebt >= 1 && guard++ < 64) {
      this._feedDebt -= 1;
      const k = this._feedIndex++ % mouth;
      const x = x0 + ((k % cols) + 0.5) * s;
      const z = z0 + (Math.floor(k / cols) + 0.5) * s;
      this.add(x, y, z, 0, vy, 0);
    }
  }

  /**
   * Evaluate the density field where the particles are, without moving them.
   * A freshly built lab has no density yet, and a rail that reads zero over a
   * rest density reports a 100% error for a tank that is in perfect balance.
   */
  measureDensity() {
    const n = this.count;
    if (!n) return;
    this.#buildLists();
    const invRest = 1 / this.restDensity;
    const selfW = this.mass * this._W0;
    const poly6 = this._poly6;
    const mass = this.mass;
    const h2 = this.h2;
    const { x, y, z } = this;
    const nbrStart = this.nbrStart, nbrList = this.nbrList, nbrCount = this.nbrCount;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const s0 = nbrStart[i], e = s0 + nbrCount[i];
      for (let k = s0; k < e; k++) {
        const j = nbrList[k];
        const rx = x[j] - x[i], ry = y[j] - y[i], rz = z[j] - z[i];
        const r2 = rx * rx + ry * ry + rz * rz;
        if (r2 >= h2) continue;
        const d = h2 - r2;
        sum += d * d * d;
      }
      this.density[i] = selfW + sum * poly6 * mass;
    }
    void invRest;
  }

  /**
   * Let a freshly poured scene come to rest before anyone is watching it.
   *
   * A lattice dropped onto a floor is at rest density but not in hydrostatic
   * balance: the first tenth of a second is a real settling wave, and a pool
   * that greets the reader with a splash it did not ask for reads as broken.
   * The labs call this after filling and before they add whatever the
   * experiment is about.
   */
  settle(steps = 45) {
    for (let i = 0; i < steps; i++) this.step(1 / 60);
    this.time = 0;
    this.frame = 0;
    this.measureDensity();
  }

  /* ======================================================================
     the step
     ====================================================================== */

  step(dt) {
    if (!this.count) { this.time += dt; return; }
    const sdt = dt / this.substeps;
    for (let k = 0; k < this.substeps; k++) this.#substep(sdt);
    this.time += dt;
    this.frame++;
  }

  #substep(dt) {
    const n = this.count;
    const { x, y, z, vx, vy, vz, qx, qy, qz, ox, oy, oz } = this;
    const g = this.params.gravity;
    const ax = this.params.bodyAccelX;

    for (let i = 0; i < n; i++) {
      vx[i] += ax * dt;
      vy[i] -= g * dt;
      /* q is the position at the start of the step. The velocity is read back
         off the corrected position against it, so the gravity increment is
         spent moving the particle rather than being erased by the solve. */
      qx[i] = x[i];
      qy[i] = y[i];
      qz[i] = z[i];
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      z[i] += vz[i] * dt;
      this.#clamp(i);
    }

    this.#buildLists();

    const rest = this.restDensity;
    const invRest = 1 / rest;
    const h = this.h;
    const spiky = this._spiky;
    const poly6 = this._poly6;
    const mass = this.mass;
    const gscale = mass * invRest;
    const eps = 1e-4;
    const relax = this.relaxation;
    const selfW = mass * this._W0;
    const nbrStart = this.nbrStart;
    const nbrList = this.nbrList;
    const nbrCount = this.nbrCount;

    for (let it = 0; it < this.iterations; it++) {
      /* density */
      for (let i = 0; i < n; i++) {
        const xi = x[i], yi = y[i], zi = z[i];
        let sum = 0;
        const s = nbrStart[i], e = s + nbrCount[i];
        for (let k = s; k < e; k++) {
          const j = nbrList[k];
          const rx = x[j] - xi, ry = y[j] - yi, rz = z[j] - zi;
          const r2 = rx * rx + ry * ry + rz * rz;
          if (r2 >= this.h2) continue;
          const d = this.h2 - r2;
          sum += d * d * d;
        }
        this.density[i] = selfW + sum * this._poly6 * mass;
      }
      /* lambda */
      for (let i = 0; i < n; i++) {
        const C = clamp(this.density[i] * invRest - 1, -this.cohesion, 1.0);
        const xi = x[i], yi = y[i], zi = z[i];
        let gradSq = 0;
        const s = nbrStart[i], e = s + nbrCount[i];
        for (let k = s; k < e; k++) {
          const j = nbrList[k];
          const rx = x[j] - xi, ry = y[j] - yi, rz = z[j] - zi;
          const r2 = rx * rx + ry * ry + rz * rz;
          if (r2 >= this.h2) continue;
          const r = Math.max(Math.sqrt(r2), h * 0.1);
          const d = h - r;
          const gradW = spiky * d * d / r;
          gradSq += r2 * gradW * gradW;
        }
        gradSq *= gscale * gscale;
        this.lambda[i] = -C / (gradSq + eps);
      }
      /* correction */
      for (let i = 0; i < n; i++) {
        const li = this.lambda[i];
        const xi = x[i], yi = y[i], zi = z[i];
        let ddx = 0, ddy = 0, ddz = 0;
        const s = nbrStart[i], e = s + nbrCount[i];
        for (let k = s; k < e; k++) {
          const j = nbrList[k];
          /* ∇W(p_i - p_j), not (p_j - p_i): the gradient of the constraint with
             respect to the position this correction is applied to. */
          const rx = xi - x[j], ry = yi - y[j], rz = zi - z[j];
          const r2 = rx * rx + ry * ry + rz * rz;
          if (r2 >= this.h2) continue;
          const r = Math.max(Math.sqrt(r2), h * 0.1);
          const d = h - r;
          /* ∇W = spiky * (h-r)² * (p_i-p_j)/|p_i-p_j| */
          const gradW = spiky * d * d / r;
          const sc = li + this.lambda[j];
          ddx += rx * gradW * sc;
          ddy += ry * gradW * sc;
          ddz += rz * gradW * sc;
        }
        /* A relaxed step. The constraint is solved Gauss-Seidel, and a free
           surface is a badly conditioned row of the system: taking the full
           Newton step overshoots into the neighbour it was pulled towards and
           the next iteration undoes it on the other side. */
        /* A single Gauss-Seidel step is never allowed to teleport a particle:
           a badly conditioned row (an isolated particle that acquires a
           neighbour) can otherwise throw one across the tank, and the energy it
           leaves behind is what makes a settled pool keep boiling. */
        const cap = h * 0.3;
        ox[i] = clamp(ddx * gscale * relax, -cap, cap);
        oy[i] = clamp(ddy * gscale * relax, -cap, cap);
        oz[i] = clamp(ddz * gscale * relax, -cap, cap);
      }
      for (let i = 0; i < n; i++) {
        x[i] += ox[i];
        y[i] += oy[i];
        z[i] += oz[i];
        this.#clamp(i);
      }
    }

    /* Keep the body from clumping.
     *
     * The density constraint alone lets particles gather into tight pairs while
     * their smoothed density still reads rest: the kernel cannot tell a body of
     * liquid from a jammed packing of the same liquid. A pool then quietly
     * loses a fifth of its depth while every gauge on the bench says it is at
     * rest density. A minimum-separation pass - push any pair closer than a
     * particle diameter apart - costs one walk over the neighbour list and
     * holds the packing, and with it the volume, where the geometry says it
     * should be. */
    const minSep = this.spacing * 1.0;
    const minSep2 = minSep * minSep;
    const sepRelax = 0.7;
    /* Every other step. Separation is a slow constraint - a pocket that is too
       tight stays too tight for longer than one frame - and four sweeps of the
       neighbour list on every step is the single most expensive thing this
       solver does. */
    const sepPasses = 4;
    for (let pass = 0; pass < sepPasses; pass++) {
      for (let i = 0; i < n; i++) {
        const s0 = nbrStart[i], e = s0 + nbrCount[i];
        for (let k = s0; k < e; k++) {
          const j = nbrList[k];
          if (j <= i) continue;
          let rx = x[j] - x[i], ry = y[j] - y[i], rz = z[j] - z[i];
          const d2 = rx * rx + ry * ry + rz * rz;
          if (d2 >= minSep2 || d2 < 1e-10) continue;
          const d = Math.sqrt(d2);
          const push = (minSep - d) * 0.5 * sepRelax;
          const inv = push / d;
          rx *= inv; ry *= inv; rz *= inv;
          x[i] -= rx; y[i] -= ry; z[i] -= rz;
          x[j] += rx; y[j] += ry; z[j] += rz;
        }
      }
      /* One pass over everything at the end, rather than two wall tests per
         pair: the pair loop is the hot one, and a method call it does not need
         is most of the cost of this constraint. */
      for (let i = 0; i < n; i++) this.#clamp(i);
    }

    const invDt = 1 / dt;
    for (let i = 0; i < n; i++) {
      vx[i] = (x[i] - qx[i]) * invDt;
      vy[i] = (y[i] - qy[i]) * invDt;
      vz[i] = (z[i] - qz[i]) * invDt;
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      if (sp > 8) {
        const k = 8 / sp;
        vx[i] *= k; vy[i] *= k; vz[i] *= k;
      }
    }

    this.#viscosity(dt);
    this.#moveBody(dt);
  }

  #buildGrid() {
    const n = this.count, g = this.grid;
    const { nx, ny, nz, order } = g;
    const cells = nx * ny * nz;
    if (!g.cellStart) {
      g.cellStart = new Int32Array(cells + 1);
      g.cursor = new Int32Array(cells);
    }
    const start = g.cellStart, cursor = g.cursor;
    start.fill(0);
    cursor.fill(0);
    const h = this.h;
    for (let i = 0; i < n; i++) {
      const cx = clamp((this.x[i] / h) | 0, 0, nx - 1);
      const cy = clamp((this.y[i] / h) | 0, 0, ny - 1);
      const cz = clamp((this.z[i] / h) | 0, 0, nz - 1);
      start[((cz * ny + cy) * nx + cx) + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    for (let i = 0; i < n; i++) {
      const cx = clamp((this.x[i] / h) | 0, 0, nx - 1);
      const cy = clamp((this.y[i] / h) | 0, 0, ny - 1);
      const cz = clamp((this.z[i] / h) | 0, 0, nz - 1);
      const c = (cz * ny + cy) * nx + cx;
      order[start[c] + cursor[c]++] = i;
    }
  }

  /** Collect every pair once per substep: the four passes below share this. */
  #buildLists() {
    this.#buildGrid();
    const n = this.count;
    const { x, y, z } = this;
    const { nx, ny, nz, cellStart, order } = this.grid;
    const h = this.h, h2 = this.h2;
    const nbrStart = this.nbrStart, nbrList = this.nbrList, nbrCount = this.nbrCount;
    let cursor = 0;
    nbrStart[0] = 0;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i], zi = z[i];
      const cx = clamp((xi / h) | 0, 0, nx - 1);
      const cy = clamp((yi / h) | 0, 0, ny - 1);
      const cz = clamp((zi / h) | 0, 0, nz - 1);
      let c = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const zz = cz + dz;
        if (zz < 0 || zz >= nz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = cy + dy;
          if (yy < 0 || yy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = cx + dx;
            if (xx < 0 || xx >= nx) continue;
            const cell = (zz * ny + yy) * nx + xx;
            const end = cellStart[cell + 1];
            for (let k = cellStart[cell]; k < end; k++) {
              const j = order[k];
              if (j === i) continue;
              const rx = x[j] - xi, ry = y[j] - yi, rz = z[j] - zi;
              if (rx * rx + ry * ry + rz * rz >= h2) continue;
              if (c >= MAX_NEIGHBOURS) break;
              nbrList[cursor + c] = j;
              c++;
            }
          }
        }
      }
      nbrCount[i] = c;
      cursor += c;
      nbrStart[i + 1] = cursor;
      if (cursor + MAX_NEIGHBOURS > nbrList.length) {
        /* keep the flat list inside its buffer, whatever the scene */
        this.nbrList = nbrList.slice(0, cursor + 1);
        break;
      }
    }
  }

  #clamp(i) {
    const pad = this.spacing * 0.5;
    const W = this.width - pad, H = this.height - pad, D = this.depth - pad;
    if (this.x[i] < pad) this.x[i] = pad;
    else if (this.x[i] > W) this.x[i] = W;
    if (this.y[i] < pad) this.y[i] = pad;
    else if (this.y[i] > H) this.y[i] = H;
    if (this.z[i] < pad) this.z[i] = pad;
    else if (this.z[i] > D) this.z[i] = D;

    const b = this.ball;
    if (b.visible) {
      const rx = this.x[i] - b.x, ry = this.y[i] - b.y, rz = this.z[i] - b.z;
      const rr = b.r + this.spacing * 0.3;
      const d2 = rx * rx + ry * ry + rz * rz;
      if (d2 < rr * rr && d2 > 1e-12) {
        const k = rr / Math.sqrt(d2);
        this.x[i] = b.x + rx * k;
        this.y[i] = b.y + ry * k;
        this.z[i] = b.z + rz * k;
      }
    }
  }

  #viscosity(dt) {
    const v = this.params.viscosity;
    /* Water is barely viscous at this scale; honey is nearly a thousand times
       more. The coefficient is mapped onto XSPH's mixing fraction, whose
       ceiling is one - a particle fully adopting its neighbours' mean is as
       thick as this scheme can get. */
    /* The three liquids are three points on this curve, and they have to be
       far apart: water (1 mPa s) must be nearly free of it, olive oil (90) must
       drag, and honey (700) must all but carry its neighbours with it. A linear
       map in the coefficient puts water and oil in the same bucket; this one
       spends its range where the fluids differ. */
    const c = clamp(0.05 + Math.pow(Math.max(v, 0), 0.6) * 1.6, 0.05, 0.985);
    const n = this.count;
    const { vx, vy, vz } = this;
    const nbrStart = this.nbrStart, nbrList = this.nbrList, nbrCount = this.nbrCount;
    if (!this._visX) {
      this._visX = new Float32Array(this.maxParticles);
      this._visY = new Float32Array(this.maxParticles);
      this._visZ = new Float32Array(this.maxParticles);
    }
    const outX = this._visX, outY = this._visY, outZ = this._visZ;
    const h2 = this.h2, poly6 = this._poly6;
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sz = 0, wsum = 0;
      const s = nbrStart[i], e = s + nbrCount[i];
      for (let k = s; k < e; k++) {
        const j = nbrList[k];
        const rx = this.x[j] - this.x[i], ry = this.y[j] - this.y[i], rz = this.z[j] - this.z[i];
        const r2 = rx * rx + ry * ry + rz * rz;
        if (r2 >= h2) continue;
        const d = h2 - r2;
        const w = d * d * d * poly6;
        sx += (vx[j] - vx[i]) * w;
        sy += (vy[j] - vy[i]) * w;
        sz += (vz[j] - vz[i]) * w;
        wsum += w;
      }
      if (wsum > 1e-12) {
        outX[i] = vx[i] + c * (sx / wsum);
        outY[i] = vy[i] + c * (sy / wsum);
        outZ[i] = vz[i] + c * (sz / wsum);
      } else {
        outX[i] = vx[i]; outY[i] = vy[i]; outZ[i] = vz[i];
      }
    }
    for (let i = 0; i < n; i++) {
      vx[i] = outX[i]; vy[i] = outY[i]; vz[i] = outZ[i];
    }
  }

  #moveBody(dt) {
    const b = this.ball;
    if (!b.visible) return;
    const band = (b.r * 2.4) ** 2;
    let top = 0, found = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = this.x[i] - b.x, dz = this.z[i] - b.z;
      if (dx * dx + dz * dz > band) continue;
      if (this.y[i] > top) top = this.y[i];
      found++;
    }
    if (!found) top = 0;
    const submerged = clamp((top - (b.y - b.r)) / (2 * b.r), 0, 1);
    const volume = (4 / 3) * Math.PI * b.r ** 3;
    const liquidDensity = FLUID_MATERIALS[this.fluid]?.density ?? this.restDensity;
    const weight = b.density * volume * this.params.gravity;
    const buoyancy = liquidDensity * volume * submerged * this.params.gravity;
    const drag = 0.5 * liquidDensity * 0.8 * Math.PI * b.r * b.r * b.vy * Math.abs(b.vy);
    const ay = (buoyancy - weight - drag) / (b.density * volume);
    b.vy += ay * dt;
    b.vy *= 0.99;
    b.y = clamp(b.y + b.vy * dt, b.r, this.height - b.r);
    if (b.y <= b.r + 1e-4 && b.vy < 0) b.vy = 0;
  }

  /* ======================================================================
     what the rail reads
     ====================================================================== */

  volume() { return this.count * Math.pow(this.spacing, 3); }

  maxSpeed() {
    let m = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2;
      if (s > m) m = s;
    }
    return Math.sqrt(m);
  }

  meanSpeed() {
    if (!this.count) return 0;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += Math.sqrt(this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2);
    return s / this.count;
  }

  kineticEnergy() {
    let e = 0;
    for (let i = 0; i < this.count; i++) e += this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2;
    return 0.5 * this.mass * e;
  }

  densityError() {
    let e = 0;
    for (let i = 0; i < this.count; i++) e += Math.abs(this.density[i] / this.restDensity - 1);
    return this.count ? e / this.count : 0;
  }

  surfaceHeight() {
    let top = 0;
    for (let i = 0; i < this.count; i++) if (this.y[i] > top) top = this.y[i];
    return top;
  }

  submergedFraction() {
    const b = this.ball;
    if (!b.visible) return 0;
    const band = (b.r * 2.4) ** 2;
    let top = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = this.x[i] - b.x, dz = this.z[i] - b.z;
      if (dx * dx + dz * dz > band) continue;
      if (this.y[i] > top) top = this.y[i];
    }
    return clamp((top - (b.y - b.r)) / (2 * b.r), 0, 1);
  }

  /**
   * How many separate bodies of liquid a vertical line through the tank
   * crosses: one for a pool, more once a sheet has come apart into drops.
   * The line is a slab two rest-spacings wide, and a gap counts when it is
   * longer than a particle spacing and a half.
   */
  columnSegments(x, z = this.depth * 0.5) {
    if (!this.count) return 0;
    const ys = [];
    const reach = this.spacing * 1.2;
    for (let i = 0; i < this.count; i++) {
      if (Math.abs(this.x[i] - x) > reach) continue;
      if (Math.abs(this.z[i] - z) > reach) continue;
      ys.push(this.y[i]);
    }
    if (!ys.length) return 0;
    ys.sort((a, b) => a - b);
    let segments = 1;
    const gap = this.spacing * 1.8;
    for (let i = 1; i < ys.length; i++) {
      if (ys[i] - ys[i - 1] > gap) segments++;
    }
    return Math.min(segments, 9);
  }

  dimensionless() {
    const speed = this.maxSpeed();
    const rho = FLUID_MATERIALS[this.fluid]?.density ?? this.restDensity;
    const L = 0.18;
    const mu = Math.max(1e-6, this.params.viscosity);
    const sigma = Math.max(1e-9, this.params.surfaceTension);
    return {
      reynolds: (rho * speed * L) / mu,
      weber: (rho * speed * speed * L) / sigma,
      ohnesorge: mu / Math.sqrt(rho * sigma * L),
      bond: (rho * this.params.gravity * L * L) / sigma,
    };
  }

  /* ======================================================================
     pages and checkpoints
     ====================================================================== */

  snapshot() {
    const n = this.count;
    return {
      count: n,
      x: Array.from(this.x.subarray(0, n)),
      y: Array.from(this.y.subarray(0, n)),
      z: Array.from(this.z.subarray(0, n)),
      vx: Array.from(this.vx.subarray(0, n)),
      vy: Array.from(this.vy.subarray(0, n)),
      vz: Array.from(this.vz.subarray(0, n)),
      ball: { ...this.ball },
      fluid: this.fluid,
      time: this.time,
    };
  }

  restore(snap) {
    if (!snap || !Number.isFinite(snap.count)) return false;
    const n = Math.min(snap.count, this.maxParticles);
    this.count = n;
    const load = (dst, src) => {
      const arr = src instanceof Float32Array ? src : Float32Array.from(src);
      dst.set(arr.subarray(0, n));
    };
    load(this.x, snap.x); load(this.y, snap.y); load(this.z, snap.z);
    load(this.vx, snap.vx); load(this.vy, snap.vy); load(this.vz, snap.vz);
    this.ball = { ...this.ball, ...snap.ball };
    if (snap.fluid) this.fluid = snap.fluid;
    if (Number.isFinite(snap.time)) this.time = snap.time;
    return true;
  }
}
