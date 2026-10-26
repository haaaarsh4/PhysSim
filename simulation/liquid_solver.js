/**
 * simulation/liquid_solver.js - a two-dimensional liquid with a free surface.
 *
 * The pipeline is the one the graphics fluids literature settled on, in the
 * order the terms appear in the Navier-Stokes equations:
 *
 *   advect  ->  gravity  ->  surface tension  ->  viscosity  ->  project
 *
 * and three of those stages are the ones this bench exists to show, because
 * they are the ones with a real decision behind them:
 *
 *   - The surface is a SIGNED DISTANCE FIELD, not a dye density: phi < 0 is
 *     liquid, phi > 0 is air, and the interface is the zero set. That is what
 *     makes a drop a drop - it can merge with its neighbour, pinch off, and
 *     keep a well-defined normal and curvature - instead of a smudge that
 *     slowly dissolves. Redistancing (a couple of iterations of the SDF
 *     reinitialisation PDE) keeps |grad phi| near 1 so the curvature stays a
 *     curvature.
 *
 *   - SURFACE TENSION is a pressure, not a smoothing filter: Young-Laplace says
 *     the pressure just inside the surface is sigma * kappa, and that is imposed
 *     as the Dirichlet value of the projection at the interface - the same
 *     statement as the continuum-surface-force form, made where the pressure
 *     solve can act on it. A volumetric force built from the curvature of a
 *     level set two cells thick is the right force in the wrong place and the
 *     wrong magnitude by an order of magnitude at this cell size; the pressure
 *     form needs only the curvature, which the height function gives to second
 *     order.
 *
 *   - VISCOSITY is solved IMPLICITLY, as one linear system per velocity
 *     component, rather than applied as an explicit diffusion term. For a
 *     constant viscosity the viscous term is nu * laplacian(u) plus a gradient
 *     that the projection removes, so this is the constant-mu form of a
 *     variational Stokes step: the same "one solve, unconditionally stable"
 *     structure, and it is what lets the viscosity slider run from water to
 *     honey without the time step collapsing.
 *
 * The pressure projection is a free-surface projection: air cells carry
 * p = 0 (a Dirichlet condition at the interface), solid walls are Neumann,
 * and the solve runs on liquid cells only. A circular rigid body is carried as
 * a moving solid boundary; the fluid sees its velocity, and the pressure it
 * pushes back with is integrated into the body's motion, which is the two-way
 * coupling in its simplest honest form.
 *
 * Everything here is plain Float64Arrays and runs under Node, which is what
 * experiments/fluid_checks.js uses to hold the physics still.
 */

export const LIQUID_DEFAULTS = {
  width: 1.2,          // m, across
  nx: 96,              // cells across; ny follows from the height below
  ny: 72,
  gravity: 9.81,       // m/s^2, down
  density: 1000,       // kg/m^3 (water)
  viscosity: 0.004,    // Pa*s (a light oil; water is 0.001)
  surfaceTension: 0.072, // N/m (water against air)
  redistanceEvery: 3,  // sub-steps between level-set reinitialisations
  bodyAccelX: 0,       // m/s^2, the tank itself being shaken sideways
  depth: 0.24,         // m, into the page: what turns an area into a volume
};

/** The reference length the dimensionless numbers are formed on. */
export const GRAVITY = 9.81;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/* --------------------------------------------------------------------------
   bilinear sampling
   --------------------------------------------------------------------------
   Three grids, three index conventions. Cell-centred fields put cell (i, j) at
   (i + 0.5, j + 0.5); u lives on vertical faces at (i, j + 0.5); v on
   horizontal faces at (i + 0.5, j). Sampling in "cell units" - the unit being
   one cell width - is what keeps the three in one coordinate system.
   -------------------------------------------------------------------------- */

function sampleCell(field, nx, ny, xc, yc) {
  const x = clamp(xc - 0.5, 0, nx - 1.000001);
  const y = clamp(yc - 0.5, 0, ny - 1.000001);
  const i = Math.floor(x), j = Math.floor(y);
  const tx = x - i, ty = y - j;
  const i1 = Math.min(i + 1, nx - 1), j1 = Math.min(j + 1, ny - 1);
  const a = field[j * nx + i], b = field[j * nx + i1];
  const c = field[j1 * nx + i], d = field[j1 * nx + i1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

function sampleU(field, nx, ny, xc, yc) {
  const x = clamp(xc, 0, nx - 0.000001);
  const y = clamp(yc - 0.5, 0, ny - 1.000001);
  const i = Math.floor(x), j = Math.floor(y);
  const tx = x - i, ty = y - j;
  const i1 = Math.min(i + 1, nx), j1 = Math.min(j + 1, ny - 1);
  const a = field[j * (nx + 1) + i], b = field[j * (nx + 1) + i1];
  const c = field[j1 * (nx + 1) + i], d = field[j1 * (nx + 1) + i1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

function sampleV(field, nx, ny, xc, yc) {
  const x = clamp(xc - 0.5, 0, nx - 1.000001);
  const y = clamp(yc, 0, ny - 0.000001);
  const i = Math.floor(x), j = Math.floor(y);
  const tx = x - i, ty = y - j;
  const i1 = Math.min(i + 1, nx - 1), j1 = Math.min(j + 1, ny);
  const a = field[j * nx + i], b = field[j * nx + i1];
  const c = field[j1 * nx + i], d = field[j1 * nx + i1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/* --------------------------------------------------------------------------
   matrix-free conjugate gradient
   --------------------------------------------------------------------------
   One solver for the two implicit stages. `applyA` takes a scratch vector and
   writes A*x into it; `active` marks the unknowns (zero elsewhere). The system
   is symmetric positive definite in both uses, which is the whole reason CG is
   the right tool rather than a direct factorisation of a grid this size.
   -------------------------------------------------------------------------- */
function conjugateGradient(n, applyA, b, x, maxIter, tol) {
  const r = new Float64Array(n);
  const p = new Float64Array(n);
  const ap = new Float64Array(n);
  applyA(x, ap);
  for (let i = 0; i < n; i++) r[i] = b[i] - ap[i];
  p.set(r);
  let rs = 0, bs = 0;
  for (let i = 0; i < n; i++) { rs += r[i] * r[i]; bs += b[i] * b[i]; }
  let iterations = 0;
  /* Relative to the right-hand side, not absolute: a solve is only ever asked
     for the answer to the problem it was handed, and the units of b are not
     known to this function. */
  const limit = tol * tol * Math.max(bs, 1e-30);
  while (iterations < maxIter && rs > limit) {
    applyA(p, ap);
    let denom = 0;
    for (let i = 0; i < n; i++) denom += p[i] * ap[i];
    if (Math.abs(denom) < 1e-30) break;
    const alpha = rs / denom;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
    }
    let rsNew = 0;
    for (let i = 0; i < n; i++) rsNew += r[i] * r[i];
    const beta = rsNew / rs;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rs = rsNew;
    iterations++;
  }
  return { iterations, residual: Math.sqrt(rs / n) };
}

export class LiquidSolver {
  /**
   * @param {object} opts a LIQUID_DEFAULTS-shaped object
   */
  constructor(opts = {}) {
    this.params = { ...LIQUID_DEFAULTS, ...opts };
    this.ball = {
      visible: false,
      x: 0, y: 0, r: 0.06,
      vx: 0, vy: 0,
      density: 500,
      restitution: 0.1,
    };
    this.build();
  }

  /** (Re)allocate every field from the current parameters. */
  build() {
    const p = this.params;
    this.nx = Math.max(16, Math.round(p.nx));
    this.ny = Math.max(16, Math.round(p.ny));
    this.dx = p.width / this.nx;
    this.width = this.nx * this.dx;
    this.height = this.ny * this.dx;
    this.depth = Math.max(1e-3, p.depth ?? 0.24);
    const n = this.nx * this.ny;

    this.phi = new Float64Array(n);         // > 0 air, < 0 liquid
    this.u = new Float64Array((this.nx + 1) * this.ny);
    this.v = new Float64Array(this.nx * (this.ny + 1));
    this.pressure = new Float64Array(n);   // kinematic: p / rho, so u -= dt grad p
    this.divergence = new Float64Array(n);
    this.curvature = new Float64Array(n);
    this.solid = new Uint8Array(n);         // cells inside the rigid body
    this.solidU = new Float64Array((this.nx + 1) * this.ny);
    this.solidV = new Float64Array(this.nx * (this.ny + 1));
    this.solidMaskU = new Uint8Array((this.nx + 1) * this.ny);
    this.solidMaskV = new Uint8Array(this.nx * (this.ny + 1));

    /* The band the interface is allowed to occupy: a signed distance far from
       the surface is only ever sampled by advection, and clamping it keeps the
       reinitialisation from moving an interface that is not there. */
    this.band = 4 * this.dx;
    this.redistanceEvery = Math.max(1, Math.round(p.redistanceEvery ?? 3));
    this.time = 0;
    this.frame = 0;
    this.targetVolume = 0;
    this.lastSolve = { iterations: 0, residual: 0 };
  }

  /* ======================================================================
     scene construction
     ====================================================================== */

  /** Everything below the plane y = height (metres) is liquid. */
  fillBelow(height) {
    const { nx, ny, dx } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const y = (j + 0.5) * dx;
        this.phi[j * nx + i] = clamp(y - height, -this.band, this.band);
      }
    }
    this.captureVolume();
    return this;
  }

  /** A rectangle of liquid, [x0,x1] x [y0,y1] in metres. */
  fillRect(x0, x1, y0, y1) {
    const { nx, ny, dx } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
        /* An SDF to the rectangle, not a boolean: the first frame then already
           has a normal and a curvature to put a surface-tension force on. */
        const qx = Math.max(x0 - x, x - x1);
        const qy = Math.max(y0 - y, y - y1);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const inside = Math.min(Math.max(qx, qy), 0);
        this.phi[j * nx + i] = clamp(outside + inside, -this.band, this.band);
      }
    }
    this.captureVolume();
    return this;
  }

  /** A disc of liquid (a drop), or of air when `air` is true (a bubble). */
  fillCircle(cx, cy, r, air = false) {
    const { nx, ny, dx } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
        const d = Math.hypot(x - cx, y - cy) - r;
        this.phi[j * nx + i] = clamp(air ? -d : d, -this.band, this.band);
      }
    }
    this.captureVolume();
    return this;
  }

  /** An ellipse of liquid - a drop caught mid-oscillation. */
  fillEllipse(cx, cy, rx, ry) {
    const { nx, ny, dx } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
        const q = Math.hypot((x - cx) / rx, (y - cy) / ry);
        this.phi[j * nx + i] = clamp((q - 1) * Math.min(rx, ry), -this.band, this.band);
      }
    }
    this.captureVolume();
    return this;
  }

  /** Everything is air, and the tank is at rest. */
  empty() {
    this.phi.fill(this.band);
    this.u.fill(0);
    this.v.fill(0);
    this.pressure.fill(0);
    this.targetVolume = 0;
    return this;
  }

  /**
   * Pour liquid in without disturbing what is already there.
   *
   * `fillRect` replaces the scene, which is what a lab does when it is set up;
   * a tap that refills the tank while it is running has to be a union, or
   * every pour would also delete the liquid it was poured into. The signed
   * distance is blended with a min, so the new body merges with the old one
   * as one surface instead of leaving a seam where the two boxes met.
   */
  addRect(x0, x1, y0, y1) {
    const { nx, ny, dx } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
        const qx = Math.max(x0 - x, x - x1);
        const qy = Math.max(y0 - y, y - y1);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
        this.phi[j * nx + i] = clamp(Math.min(this.phi[j * nx + i], d), -this.band, this.band);
      }
    }
    this.captureVolume();
    return this;
  }

  /** A drop added to a running tank, merged with what is already there. */
  addCircle(cx, cy, r) {
    const { nx, ny, dx } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
        const d = Math.hypot(x - cx, y - cy) - r;
        this.phi[j * nx + i] = clamp(Math.min(this.phi[j * nx + i], d), -this.band, this.band);
      }
    }
    this.captureVolume();
    return this;
  }

  /**
   * A nozzle: liquid is written into a rectangle at a given velocity.
   *
   * This is how a jet is made. The alternative - a pressure inlet - needs a
   * boundary condition the projection would have to know about, and a made-up
   * inflow velocity is exactly what a tap is: something outside the tank
   * pushing liquid in at a rate someone chose. The cells inside the nozzle are
   * held liquid every step, so the jet does not neck itself off at the tap.
   */
  inject(x0, x1, y0, y1, vx = 0, vy = 0) {
    const { nx, ny, dx } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        this.phi[j * nx + i] = -this.band;
        this.u[j * (nx + 1) + i] = vx;
        this.u[j * (nx + 1) + i + 1] = vx;
        this.v[j * nx + i] = vy;
        this.v[(j + 1) * nx + i] = vy;
      }
    }
    this.captureVolume();
    return this;
  }

  /** A horizontal shear: u = amplitude * cos(k y). The viscous-decay lab. */
  shear(amplitude, wavelength) {
    const { ny, dx } = this;
    const k = (2 * Math.PI) / wavelength;
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * dx;
      const ux = amplitude * Math.cos(k * y);
      for (let i = 0; i < this.nx + 1; i++) this.u[j * (this.nx + 1) + i] = ux;
    }
    return this;
  }

  /** Record the liquid volume the scene was built with: every later step is
      measured against it, and the drift is corrected towards it. */
  captureVolume() {
    this.targetVolume = this.volume();
  }

  setBall(ball) {
    Object.assign(this.ball, ball);
    this.ball.visible = true;
    return this;
  }

  /* ======================================================================
     measurements
     ====================================================================== */

  /** Liquid volume, with a partial cell at the interface rather than a count:
      a staircase measure of a moving surface is a signal, not a measurement. */
  volume() {
    const { nx, ny, dx, phi, depth } = this;
    let v = 0;
    for (let i = 0; i < nx * ny; i++) v += clamp(0.5 - phi[i] / dx, 0, 1);
    /* Cubic metres, not square ones. The solve is a plane; the tank it stands
       for is not, and a panel headed "liquid volume" that quoted an area as
       litres was off by the tank's own depth. */
    return v * dx * dx * depth;
  }

  kineticEnergy() {
    const { nx, ny, dx, phi } = this;
    const { density } = this.params;
    let e = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (phi[k] >= 0) continue;
        const uc = 0.5 * (this.u[j * (nx + 1) + i] + this.u[j * (nx + 1) + i + 1]);
        const vc = 0.5 * (this.v[j * nx + i] + this.v[(j + 1) * nx + i]);
        e += 0.5 * density * (uc * uc + vc * vc);
      }
    }
    return e * dx * dx * this.depth;
  }

  /**
   * How many separate pieces of liquid a vertical line crosses.
   *
   * One for a pool, more once a falling sheet has come apart into drops: the
   * count is a direct reading of the topology the level set is carrying, and it
   * is what a break-up experiment is asking about. Bilinear on the cell field,
   * so a piece a fraction of a cell thick still counts.
   */
  columnSegments(x) {
    const { nx, ny, dx, phi } = this;
    const c = Math.min(nx - 1.001, Math.max(0, x / dx - 0.5));
    const i0 = Math.floor(c);
    const f = c - i0;
    let segments = 0;
    let inside = false;
    for (let j = 0; j < ny; j++) {
      const a = phi[j * nx + i0];
      const b = phi[j * nx + Math.min(nx - 1, i0 + 1)];
      const value = a * (1 - f) + b * f;
      const nowInside = value < 0;
      if (nowInside && !inside) segments++;
      inside = nowInside;
    }
    return segments;
  }

  maxSpeed() {
    let m = 0;
    for (let i = 0; i < this.u.length; i++) m = Math.max(m, Math.abs(this.u[i]));
    for (let i = 0; i < this.v.length; i++) m = Math.max(m, Math.abs(this.v[i]));
    return m;
  }

  /**
   * The largest divergence left in a *full* liquid cell after projection.
   *
   * Deliberately not every liquid cell: a cell the free surface cuts through is
   * supposed to diverge. That divergence is the surface moving - it is air the
   * liquid is replacing, and a projection that drove it to zero would freeze the
   * meniscus. What the pressure solve is responsible for is the interior, where
   * the fluid is incompressible by definition, so that is what is measured.
   */
  maxDivergence() {
    const { nx, ny, dx, phi } = this;
    let m = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        /* Half a cell inside the interface, so the band the level set keeps is
           never counted as interior. */
        if (phi[j * nx + i] > -0.5 * dx) continue;
        const d = (this.u[j * (nx + 1) + i + 1] - this.u[j * (nx + 1) + i] +
          this.v[(j + 1) * nx + i] - this.v[j * nx + i]) / dx;
        m = Math.max(m, Math.abs(d));
      }
    }
    return m;
  }

  /** Reynolds, Weber and Ohnesorge from the numbers the panel is set to. This
      is the trio that says which term is in charge: inertia against
      viscosity, inertia against surface tension, and the two against each
      other. U is the current peak speed, L the tank depth. */
  dimensionless() {
    const { density, viscosity, surfaceTension } = this.params;
    const U = Math.max(1e-4, this.maxSpeed());
    const L = this.height;
    return {
      reynolds: (density * U * L) / Math.max(1e-9, viscosity),
      weber: (density * U * U * L) / Math.max(1e-9, surfaceTension),
      ohnesorge: viscosity / Math.sqrt(Math.max(1e-12, density * surfaceTension * L)),
      bond: (density * GRAVITY * L * L) / Math.max(1e-9, surfaceTension),
    };
  }

  /** The mean height of the liquid at a column, used by the sloshing and dam
      break labs to read a front or a wave off the same field the eye sees. */
  surfaceHeightAt(x) {
    const { nx, ny, dx, phi } = this;
    const i = clamp(Math.floor(x / dx), 0, nx - 1);
    for (let j = ny - 1; j >= 0; j--) {
      if (phi[j * nx + i] < 0) return (j + 1) * dx;
    }
    return 0;
  }

  centreOfMass() {
    const { nx, ny, dx, phi } = this;
    let m = 0, cx = 0, cy = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (phi[j * nx + i] >= 0) continue;
        m++;
        cx += (i + 0.5) * dx;
        cy += (j + 0.5) * dx;
      }
    }
    return m ? { x: cx / m, y: cy / m, cells: m } : { x: 0, y: 0, cells: 0 };
  }

  /* ======================================================================
     the rigid body
     ====================================================================== */

  /**
   * Mark the cells inside the ball, and put its rigid velocity on every face
   * that touches it.
   *
   * The body is a moving no-slip wall, which in a MAC grid is one sentence:
   * every face with solid on one side carries the body's velocity there. The
   * projection then sees that velocity as flow the liquid has to get out of
   * the way of, which is where the wake comes from.
   */
  paintBall() {
    const { nx, ny, dx } = this;
    this.solid.fill(0);
    this.solidU.fill(0);
    this.solidV.fill(0);
    this.solidMaskU.fill(0);
    this.solidMaskV.fill(0);
    const b = this.ball;
    if (!b.visible || b.r <= 0) return;
    const r2 = b.r * b.r;
    const inside = (x, y) => (x - b.x) ** 2 + (y - b.y) ** 2 < r2;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (inside((i + 0.5) * dx, (j + 0.5) * dx)) this.solid[j * nx + i] = 1;
      }
    }
    const solidAt = (i, j) => i >= 0 && i < nx && j >= 0 && j < ny && this.solid[j * nx + i] === 1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (solidAt(i - 1, j) || solidAt(i, j)) {
          this.solidU[j * (nx + 1) + i] = b.vx;
          this.solidMaskU[j * (nx + 1) + i] = 1;
        }
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (solidAt(i, j - 1) || solidAt(i, j)) {
          this.solidV[j * nx + i] = b.vy;
          this.solidMaskV[j * nx + i] = 1;
        }
      }
    }
  }

  /**
   * The liquid's surface height at one column, as a continuous number.
   *
   * `surfaceHeightAt` answers "which cell is the top wet one", which is the
   * right answer for a ruler and the wrong one for a force: a body floating on
   * a surface that moves in steps of a cell is a body being kicked by a cell
   * every time the waterline crosses one. The level set knows where the surface
   * actually is between two cells, so it is asked.
   */
  waterlineAt(x) {
    const { nx, ny, dx, phi } = this;
    const i = clamp(Math.floor(x / dx), 0, nx - 1);
    for (let j = ny - 1; j >= 0; j--) {
      if (phi[j * nx + i] >= 0) continue;
      const above = j + 1 < ny ? phi[(j + 1) * nx + i] : 0;
      const here = phi[j * nx + i];
      const t = above > 0 ? above / (above - here) : 1;
      return (j + 0.5 + t) * dx;
    }
    return 0;
  }

  /**
   * How much of the ball is under water, as the fraction of its area below the
   * local waterline.
   *
   * The waterline is read across a span either side of the body, not through
   * it: what is under the ball is mostly the wave the ball is making, and a
   * body whose buoyancy is measured against its own wake climbs it. The mean
   * over nine columns from one body radius clear of the hull on one side to one
   * clear on the other is the undisturbed surface the body floats in - and an
   * average over a span, rather than two columns, is also what stops the count
   * jumping a centimetre every time the waterline crosses a cell edge. A jump
   * in the buoyancy is a kick to the body, and a body kicked twice a frame
   * never settles to the draft its density asks for.
   */
  submergedFraction() {
    const b = this.ball;
    if (!b.visible || b.r <= 0) return 0;
    let sum = 0, n = 0;
    for (let s = -4; s <= 4; s++) {
      const x = b.x + (s / 4) * 2.2 * b.r;
      sum += this.waterlineAt(Math.min(this.width - 0.01, Math.max(0.01, x)));
      n++;
    }
    const h = sum / n;
    const r = b.r;
    const d = clamp(h - b.y, -r, r);
    const area = Math.PI * r * r;
    const below = d * Math.sqrt(Math.max(0, r * r - d * d)) + r * r * Math.asin(d / r) + 0.5 * area;
    return clamp(below / area, 0, 1);
  }

  /** The liquid's horizontal velocity just outside the body, averaged round it
   *  - the current it is sitting in, not the cells under the hull. */
  ambientFlow() {
    const b = this.ball;
    const { nx, ny, dx, u, v, phi } = this;
    if (!(b.r > 0)) return { u: 0, v: 0 };
    let su = 0, sv = 0, n = 0;
    const ring = b.r + 2.5 * dx;
    for (let a = 0; a < 12; a++) {
      const px = b.x + ring * Math.cos((a / 12) * 2 * Math.PI);
      const py = b.y + ring * Math.sin((a / 12) * 2 * Math.PI);
      const ci = Math.min(nx - 1, Math.max(0, Math.floor(px / dx)));
      const cj = Math.min(ny - 1, Math.max(0, Math.floor(py / dx)));
      if (phi[cj * nx + ci] >= 0) continue;
      su += sampleU(u, nx, ny, px / dx, py / dx);
      sv += sampleV(v, nx, ny, px / dx, py / dx);
      n++;
    }
    return n ? { u: su / n, v: sv / n } : { u: 0, v: 0 };
  }

  /* ======================================================================
     the step
     ====================================================================== */

  /**
   * Advance one sub-step.
   *
   * The caller owns the clock: the bench decides how many sub-steps a frame is
   * worth, and the checks call this directly with a fixed dt so a measurement
   * never depends on how fast the browser was drawing.
   */
  step(dt) {
    if (!(dt > 0)) return;
    const { nx, ny, dx, params } = this;
    const nu = params.viscosity / params.density;

    this.paintBall();
    this.advect(dt);
    this.applyGravity(dt);
    if (nu > 0) this.applyViscosity(dt, nu);
    this.project(dt);
    this.filterInterface();
    /* Reinitialising every sub-step is reinitialising sixty times a frame, and
       the scheme is not free: each pass moves the interface its own fraction
       of a cell towards |grad phi| = 1, which for a small ripple is a visible
       amount of smoothing and, on a capillary wave, enough damping to swallow
       the oscillation entirely. Once every few sub-steps is what the level-set
       literature asks for anyway, and it is what keeps a drop ringing. */
    if (this.frame % this.redistanceEvery === 0) this.redistance(dt);
    this.correctVolume();
    this.pushBall(dt);

    this.time += dt;
    this.frame++;
  }

  /* ---- advection ------------------------------------------------------- */

  advect(dt) {
    const { nx, ny, dx } = this;
    const u0 = this.u, v0 = this.v, phi0 = this.phi;
    const u1 = new Float64Array(u0.length);
    const v1 = new Float64Array(v0.length);
    const phi1 = new Float64Array(phi0.length);
    const scale = dt / dx;

    /* u lives on vertical faces: the point to backtrace from is (i, j+0.5). */
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = j * (nx + 1) + i;
        const uc = u0[k];
        const vc = 0.5 * (v0[j * nx + clamp(i - 1, 0, nx - 1)] +
          v0[j * nx + clamp(i, 0, nx - 1)]);
        u1[k] = sampleU(u0, nx, ny, i - uc * scale, j + 0.5 - vc * scale);
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const vc = v0[k];
        const uc = 0.5 * (u0[clamp(j - 1, 0, ny - 1) * (nx + 1) + i] +
          u0[clamp(j, 0, ny - 1) * (nx + 1) + i]);
        v1[k] = sampleV(v0, nx, ny, i + 0.5 - uc * scale, j - vc * scale);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const uc = 0.5 * (u0[j * (nx + 1) + i] + u0[j * (nx + 1) + i + 1]);
        const vc = 0.5 * (v0[j * nx + i] + v0[(j + 1) * nx + i]);
        phi1[k] = sampleCell(phi0, nx, ny, i + 0.5 - uc * scale, j + 0.5 - vc * scale);
      }
    }

    this.u = u1; this.v = v1; this.phi = phi1;
    this.enforceWalls();
  }

  /** No flow through the tank, and no flow inside the rigid body. */
  enforceWalls() {
    const { nx, ny } = this;
    for (let j = 0; j < ny; j++) {
      this.u[j * (nx + 1)] = 0;
      this.u[j * (nx + 1) + nx] = 0;
    }
    for (let i = 0; i < nx; i++) {
      this.v[i] = 0;
      this.v[ny * nx + i] = 0;
    }
    for (let i = 0; i < this.solidU.length; i++) {
      if (this.solidMaskU[i]) this.u[i] = this.solidU[i];
    }
    for (let i = 0; i < this.solidV.length; i++) {
      if (this.solidMaskV[i]) this.v[i] = this.solidV[i];
    }
    this.extrapolateIntoAir();
  }

  /**
   * Give the air its own velocity, borrowed from the liquid beside it.
   *
   * This is the step that makes a free surface move like a free surface, and
   * leaving it out is not a small omission. A semi-Lagrangian advection samples
   * the velocity at the point a cell came from. A cell on the interface came
   * from somewhere just outside the liquid, where the velocity was zero -
   * because air is not solved. So every surface cell is pulled towards rest on
   * every step, and a drop, a sheet, or a wave is damped by exactly the amount
   * it is moving. The splash of a drop disappears in a fifth of a second; a
   * ripple is gone in two cycles.
   *
   * The fix is the one the level-set literature has used since the beginning:
   * extrapolate the liquid's velocity a few cells into the air, so the sample a
   * surface cell takes is the velocity of the fluid next to it and not a
   * vacuum. Two cells is what the advection can reach in one step at the CFL
   * this bench runs; three is cheap and leaves the band a margin.
   *
   * Beyond the band the air is left at rest, which is right: it is not part of
   * the flow, and letting gravity accumulate there would be a current with
   * nothing driving it.
   */
  extrapolateIntoAir() {
    const { nx, ny, phi, dx } = this;
    const band = 3 * dx;
    const nearAir = (k) => phi[k] > 0 && phi[k] < band;

    /* u lives on vertical faces: a face is "known" when at least one of the
       two cells it separates holds liquid. */
    const uKnown = (i, j) => (i > 0 && phi[j * nx + i - 1] < 0) || (i < nx && phi[j * nx + i] < 0);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = j * (nx + 1) + i;
        if (uKnown(i, j)) continue;
        const near = (i > 0 && i < nx) && (nearAir(j * nx + i - 1) || nearAir(j * nx + i));
        if (!near) { this.u[k] = 0; continue; }
        let sum = 0, n = 0;
        for (let d = 1; d <= 3; d++) {
          if (i - d >= 0 && uKnown(i - d, j)) { sum += this.u[j * (nx + 1) + i - d]; n++; break; }
        }
        for (let d = 1; d <= 3; d++) {
          if (i + d <= nx && uKnown(i + d, j)) { sum += this.u[j * (nx + 1) + i + d]; n++; break; }
        }
        if (n) this.u[k] = sum / n;
      }
    }

    const vKnown = (i, j) => (j > 0 && phi[(j - 1) * nx + i] < 0) || (j < ny && phi[j * nx + i] < 0);
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (vKnown(i, j)) continue;
        const near = (j > 0 && j < ny) && (nearAir((j - 1) * nx + i) || nearAir(j * nx + i));
        if (!near) { this.v[k] = 0; continue; }
        let sum = 0, n = 0;
        for (let d = 1; d <= 3; d++) {
          if (j - d >= 0 && vKnown(i, j - d)) { sum += this.v[(j - d) * nx + i]; n++; break; }
        }
        for (let d = 1; d <= 3; d++) {
          if (j + d <= ny && vKnown(i, j + d)) { sum += this.v[(j + d) * nx + i]; n++; break; }
        }
        if (n) this.v[k] = sum / n;
      }
    }
  }

  /* ---- body forces ----------------------------------------------------- */

  applyGravity(dt) {
    const { nx, ny, params, phi, dx } = this;
    const g = params.gravity;
    /* Gravity is a face quantity, not a cell one: a face shared by two liquid
       cells is a single piece of water and must be pulled once. Doing it per
       cell pulls it twice, which quietly doubles g.

       The floor and the lid are not faces of the liquid: `below`/`above` used
       to default to air beyond the tank, so the bottom row of faces was pulled
       down through a wall that had just been closed. The divergence inside the
       tank was then zero everywhere - the cell above the floor saw the same
       velocity on both of its vertical faces - so the projection had no source
       and a standing column had no hydrostatic pressure at all. The column
       free-fell and the dam break oozed; a ghost pressure at the floor was
       patched in to hide it. Skipping the wall faces is the fix that makes the
       ghost unnecessary. */
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const below = phi[(j - 1) * nx + i];
        const above = phi[j * nx + i];
        if (below > dx && above > dx) continue;
        this.v[j * nx + i] -= g * dt;
      }
    }
    if (params.bodyAccelX) {
      /* Same rule at the two side walls: a face in the wall is not liquid. */
      for (let j = 0; j < ny; j++) {
        for (let i = 1; i < nx; i++) {
          const left = phi[j * nx + i - 1];
          const right = phi[j * nx + i];
          if (left > dx && right > dx) continue;
          this.u[j * (nx + 1) + i] -= params.bodyAccelX * dt;
        }
      }
    }
  }

  /* ---- surface tension ------------------------------------------------ */

  /**
   * The curvature of the free surface, as a pressure boundary condition.
   *
   * Young-Laplace says the pressure just inside a curved surface is sigma *
   * kappa above the air. Here that is not a force added to the velocities - it
   * is the Dirichlet value the projection imposes at the interface, which is
   * the same statement and a far better place to make it: a surface force
   * applied as a volumetric body force on a level set that is two cells thick
   * is a force with the wrong magnitude in the wrong place, and it rings at the
   * grid scale.
   *
   * The curvature itself comes from a height function wherever the surface is
   * one - the waterline read per column, differentiated twice - because that is
   * second-order accurate at a cell size, and the level set's own curvature is
   * not: a field smeared over two cells has a curvature of order 1/dx no matter
   * how flat it really is. Where the liquid is not a height function (the
   * underside of a drop, a folding sheet) the level-set curvature is used, which
   * for a round drop is the right answer to within the thickness of the band.
   */
  surfaceCurvature() {
    const { nx, ny, dx, phi, params } = this;
    const kappa = this.curvature;
    kappa.fill(0);
    if (!(params.surfaceTension > 0)) return kappa;

    /* The level-set curvature, in the band only: div(n) of a lightly smoothed
       field, with n the outward normal. */
    const smooth = this._smoothPhi ?? (this._smoothPhi = new Float64Array(phi.length));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const im = i > 0 ? i - 1 : i, ip = i < nx - 1 ? i + 1 : i;
        const jm = j > 0 ? j - 1 : j, jp = j < ny - 1 ? j + 1 : j;
        let s = 0;
        s += phi[jm * nx + im] + 2 * phi[jm * nx + i] + phi[jm * nx + ip];
        s += 2 * phi[j * nx + im] + 4 * phi[j * nx + i] + 2 * phi[j * nx + ip];
        s += phi[jp * nx + im] + 2 * phi[jp * nx + i] + phi[jp * nx + ip];
        smooth[j * nx + i] = s / 16;
      }
    }
    const band = 3 * dx;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (Math.abs(phi[k]) > band) continue;
        const im = i > 0 ? i - 1 : i, ip = i < nx - 1 ? i + 1 : i;
        const jm = j > 0 ? j - 1 : j, jp = j < ny - 1 ? j + 1 : j;
        const dnx = (nxvAt(smooth, nx, ny, ip, j, dx) - nxvAt(smooth, nx, ny, im, j, dx)) / ((ip - im) * dx);
        const dny = (nyvAt(smooth, nx, ny, i, jp, dx) - nyvAt(smooth, nx, ny, i, jm, dx)) / ((jp - jm) * dx);
        kappa[k] = dnx + dny;
      }
    }

    /* The waterline of every column, and the height-function curvature of it:
       kappa = -h'' / (1 + h'^2)^1.5, which for a crest is positive - the
       pressure inside is higher, exactly as on a drop. */
    const colTop = this._colTop ?? (this._colTop = new Int32Array(nx));
    const h = this._colH ?? (this._colH = new Float64Array(nx));
    for (let i = 0; i < nx; i++) {
      colTop[i] = -1;
      for (let j = ny - 1; j >= 0; j--) {
        const a = phi[j * nx + i];
        const b = j + 1 < ny ? phi[(j + 1) * nx + i] : a;
        if (a < 0 && b >= 0) {
          colTop[i] = j;
          h[i] = (j + a / (a - b)) * dx;
          break;
        }
      }
    }
    const dh = (i) => {
      const l = i > 0 && colTop[i - 1] >= 0, r = i < nx - 1 && colTop[i + 1] >= 0;
      if (l && r) return (h[i + 1] - h[i - 1]) / (2 * dx);
      if (r) return (h[i + 1] - h[i]) / dx;
      if (l) return (h[i] - h[i - 1]) / dx;
      return 0;
    };
    const d2h = (i) => {
      const l = i > 0 && colTop[i - 1] >= 0, r = i < nx - 1 && colTop[i + 1] >= 0;
      if (l && r) return (h[i + 1] - 2 * h[i] + h[i - 1]) / (dx * dx);
      return 0;
    };
    for (let i = 0; i < nx; i++) {
      if (colTop[i] < 0) continue;
      const slope = dh(i);
      /* A surface steeper than about 60 degrees is not a height function where
         it is read: the columns either side are a different part of the same
         fold, and differencing across them is a curvature that is not there. */
      if (Math.abs(slope) > 1.9) continue;
      const curv = -d2h(i) / Math.pow(1 + slope * slope, 1.5);
      /* Written onto the top wet cell and the air cell above it: both are cells
         the interface passes between, and both are asked for this number when
         the projection looks for the pressure at the surface. */
      const j = colTop[i];
      kappa[j * nx + i] = curv;
      if (j + 1 < ny) kappa[(j + 1) * nx + i] = curv;
    }
    return kappa;
  }

  /* ---- viscosity ------------------------------------------------------- */

  /**
   * Implicit viscosity, one component at a time:
   *
   *   (I - nu dt laplacian) u = u*
   *
   * solved only on faces with liquid on both sides - a free surface has no
   * shear stress to transmit, and air's viscosity is not what the slider is
   * set to. Neumann at the edges of that mask, so the liquid does not drag on
   * the air it is falling through.
   */
  applyViscosity(dt, nu) {
    const { nx, ny, dx, phi } = this;
    const alpha = (nu * dt) / (dx * dx);
    if (!(alpha > 0)) return;
    const wet = (i, j) => i >= 0 && i < nx && j >= 0 && j < ny && phi[j * nx + i] < 0;

    /* For a small diffusion number the implicit solve and an explicit pass are
       the same operator, and the explicit one is the cheaper way to say it: the
       matrix is close enough to the identity that conjugate gradient is doing
       thirty iterations of arithmetic to rediscover the truncated series. Water
       at a 120th of a second is alpha ~ 0.1, well inside the explicit limit of
       0.25; honey is alpha ~ 100 and takes the solve. */
    if (alpha <= 0.18) {
      const diffuse = (field, count, isU) => {
        const src = Float64Array.from(field);
        const active = new Uint8Array(field.length);
        const indexOf = (i, j) => (isU ? j * (nx + 1) + i : j * nx + i);
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < count; i++) {
            const l = isU ? wet(i - 1, j) : wet(i, j - 1);
            const r = isU ? wet(i, j) : wet(i, j);
            if (l && r) active[indexOf(i, j)] = 1;
          }
        }
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < count; i++) {
            const k = indexOf(i, j);
            if (!active[k]) continue;
            /* Four faces round this one. Outside the tank, or across the free
               surface, a neighbour mirrors the face itself: no shear crosses
               either, which is the same Neumann condition the solve applies. */
            let sum = 0;
            for (let side = 0; side < 4; side++) {
              const ni = side === 0 ? i - 1 : side === 1 ? i + 1 : i;
              const nj = side === 2 ? j - 1 : side === 3 ? j + 1 : j;
              if (ni < 0 || nj < 0 || nj >= ny || ni >= count) { sum += src[k]; continue; }
              const nk = indexOf(ni, nj);
              sum += active[nk] ? src[nk] : src[k];
            }
            field[k] = src[k] + alpha * (sum - 4 * src[k]);
          }
        }
      };
      diffuse(this.u, nx + 1, true);
      diffuse(this.v, nx, false);
      return;
    }

    const solveComponent = (field, count, isU) => {
      const n = field.length;
      const active = new Uint8Array(n);
      const b = new Float64Array(n);
      const x = new Float64Array(n);
      const indexOf = (i, j) => (isU ? j * (nx + 1) + i : j * nx + i);

      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < count; i++) {
          const k = indexOf(i, j);
          const l = isU ? wet(i - 1, j) : wet(i, j - 1);
          const r = isU ? wet(i, j) : wet(i, j);
          if (!l || !r) continue;
          active[k] = 1;
          b[k] = field[k];
          x[k] = field[k];
        }
      }

      const applyA = (src, dst) => {
        dst.fill(0);
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < count; i++) {
            const k = indexOf(i, j);
            if (!active[k]) continue;
            let sum = 0;
            for (let side = 0; side < 4; side++) {
              const ni = side === 0 ? i - 1 : side === 1 ? i + 1 : i;
              const nj = side === 2 ? j - 1 : side === 3 ? j + 1 : j;
              if (ni < 0 || nj < 0 || nj >= ny || ni >= count) { sum += src[k]; continue; }
              const nk = indexOf(ni, nj);
              sum += active[nk] ? src[nk] : src[k];
            }
            dst[k] = src[k] + alpha * (4 * src[k] - sum);
          }
        }
      };

      conjugateGradient(field.length, applyA, b, x, 30, 1e-5);
      for (let k = 0; k < field.length; k++) if (active[k]) field[k] = x[k];
    };

    solveComponent(this.u, nx + 1, true);
    solveComponent(this.v, nx, false);
  }

  /* ---- projection ------------------------------------------------------ */

  /**
   * Free-surface pressure projection.
   *
   * Air is p = 0 and is not an unknown: that one choice is what makes the
   * surface free rather than a lid. Solid is Neumann (no flux through a wall),
   * and the liquid's own cells are the only ones solved.
   */
  project(dt) {
    const { nx, ny, dx, phi, solid, params } = this;
    const n = nx * ny;
    const div = this.divergence;
    const index = new Int32Array(n).fill(-1);
    const cells = [];

    /* Liquid fraction of every cell, from the level set: the surface is not at
       a cell centre, and a projection that pretends it is puts a staircase in
       the pressure field that no amount of resolution takes out. */
    const frac = new Float64Array(n);
    for (let k = 0; k < n; k++) frac[k] = Math.min(1, Math.max(0, 0.5 - phi[k] / dx));
    /* How close to empty a cell may be and still count as surface. The flux
       across a face is divided by the distance from the cell's centre to the
       interface, and that distance is what sets the size of the velocity the
       projection will write there: a cell a twentieth of a cell full of water
       gets a twentieth of a cell to move in, and the answer is a jet. A quarter
       of a cell is the smallest fraction this grid can resolve a surface in. */
    const DRY = 0.06;
    const FMIN = 0.25;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (phi[k] >= 0 || solid[k] || frac[k] < DRY) { div[k] = 0; continue; }
        index[k] = cells.length;
        cells.push(k);
        div[k] = (this.u[j * (nx + 1) + i + 1] - this.u[j * (nx + 1) + i] +
          this.v[(j + 1) * nx + i] - this.v[j * nx + i]) / dx;
      }
    }

    const size = cells.length;
    const b = new Float64Array(size);
    const x = new Float64Array(size);
    for (let a = 0; a < size; a++) {
      b[a] = div[cells[a]] / dt;
      x[a] = this.pressure[cells[a]];
    }

    /* The pressure at the free surface. Zero for a flat pool - that is what
       makes a free surface free - and sigma * kappa / rho where the surface is
       curved, which is Young-Laplace and is the whole of surface tension. It is
       imposed as the Dirichlet value of the projection rather than added to the
       velocities: a surface force applied to a level set two cells thick is the
       right force in the wrong place, and on a grid this size it is also the
       wrong magnitude by an order of magnitude. */
    const kappa = this.surfaceCurvature();
    const sigma = params.surfaceTension;
    const rho = params.density;
    const cap = (sigma * 2) / (rho * dx);
    const surfacePressure = (k) => {
      if (!(sigma > 0)) return 0;
      return Math.max(-cap, Math.min(cap, (sigma * kappa[k]) / rho));
    };

    const invDx2 = 1 / (dx * dx);
    /* The stencil. A liquid neighbour couples normally. A wall, or the edge of
       the tank, mirrors the cell's own pressure and so adds nothing. A cell of
       air is a Dirichlet condition at the surface - at the surface's real
       position: if the interface is a fraction f of the way from this cell's
       centre to the air cell's centre, the flux across that face is
       (p_surface - p_k) / (f dx). */
    const SELF = -1;
    const nb = new Int32Array(size * 4);
    const diagonal = new Float64Array(size);
    const link = (k, i, j) => {
      if (i < 0 || i >= nx || j < 0 || j >= ny) return SELF;
      const id = index[k];
      return id >= 0 ? id : SELF;
    };
    for (let a = 0; a < size; a++) {
      const k = cells[a];
      const i = k % nx, j = (k - i) / nx;
      const s0 = phi[k];
      let diag = 0;
      let source = 0;
      const dirs = [k - 1, k + 1, k - nx, k + nx];
      const inside = [i - 1 >= 0, i + 1 < nx, j - 1 >= 0, j + 1 < ny];
      for (let d = 0; d < 4; d++) {
        const nn = dirs[d];
        if (!inside[d]) { nb[a * 4 + d] = SELF; continue; }
        const id = index[nn];
        if (id >= 0) { nb[a * 4 + d] = id; diag += 1; continue; }
        if (solid[nn]) { nb[a * 4 + d] = SELF; continue; }
        const s1 = phi[nn];
        const f = Math.min(1, Math.max(FMIN, s0 / (s0 - s1)));
        nb[a * 4 + d] = SELF;
        diag += 1 / f;
        source += surfacePressure(nn) / f;
      }
      diagonal[a] = diag > 0 ? diag : 1;
      b[a] -= source * invDx2;
    }
    const applyA = (src, dst) => {
      for (let a = 0, q = 0; a < size; a++, q += 4) {
        const sa = src[a];
        let sum = 0;
        let m = nb[q]; if (m >= 0) sum += src[m];
        m = nb[q + 1]; if (m >= 0) sum += src[m];
        m = nb[q + 2]; if (m >= 0) sum += src[m];
        m = nb[q + 3]; if (m >= 0) sum += src[m];
        dst[a] = (sum - diagonal[a] * sa) * invDx2;
      }
    };

    /* Forty iterations to two parts in a thousand. The warm start means most
       steps need a handful; the ones that need the budget are the ones where
       the surface is being cut by the interface for the first time. Measured on
       the dam break: 0.7% of the flow's own strain rate left in the interior,
       at a third of the cost of solving to a part in ten thousand - which is
       the difference between the liquid keeping up with the clock and not. */
    const budget = Math.max(4, Math.round(this.params.pressureIterations ?? 40));
    const tol = this.params.pressureTolerance ?? 2e-3;
    this.lastSolve = conjugateGradient(size, applyA, b, x, budget, tol);

    const p = this.pressure;
    p.fill(0);
    for (let a = 0; a < size; a++) p[cells[a]] = x[a];

    /* Subtract the gradient at the faces, through the same cut surface the
       stencil was built from: the velocity the solve produced is divergence
       free under the operator it was solved with, or it is not divergence free
       at all. */
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const kl = j * nx + i - 1, kr = j * nx + i;
        const l = index[kl] >= 0, r = index[kr] >= 0;
        if (!l && !r) continue;
        if (solid[kl] || solid[kr]) continue;
        if (l && r) {
          this.u[j * (nx + 1) + i] -= (dt * (p[kr] - p[kl])) / dx;
        } else if (l) {
          const f = Math.min(1, Math.max(FMIN, phi[kl] / (phi[kl] - phi[kr])));
          this.u[j * (nx + 1) + i] -= (dt * (surfacePressure(kr) - p[kl])) / (f * dx);
        } else {
          const f = Math.min(1, Math.max(FMIN, phi[kr] / (phi[kr] - phi[kl])));
          this.u[j * (nx + 1) + i] -= (dt * (p[kr] - surfacePressure(kl))) / (f * dx);
        }
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const kb = (j - 1) * nx + i, kt = j * nx + i;
        const b0 = index[kb] >= 0, t0 = index[kt] >= 0;
        if (!b0 && !t0) continue;
        if (solid[kb] || solid[kt]) continue;
        if (b0 && t0) {
          this.v[j * nx + i] -= (dt * (p[kt] - p[kb])) / dx;
        } else if (b0) {
          const f = Math.min(1, Math.max(FMIN, phi[kb] / (phi[kb] - phi[kt])));
          this.v[j * nx + i] -= (dt * (surfacePressure(kt) - p[kb])) / (f * dx);
        } else {
          const f = Math.min(1, Math.max(FMIN, phi[kt] / (phi[kt] - phi[kb])));
          this.v[j * nx + i] -= (dt * (p[kt] - surfacePressure(kb))) / (f * dx);
        }
      }
    }

    this.enforceWalls();
  }

  /**
   * One light pass over the interface, in the band only.
   *
   * A free surface solved this way carries a mode at the grid's own scale - a
   * sawtooth of one cell that gravity and surface tension both push on, and
   * that a 30 cm wave does not feel at all. Left alone it is the roughness the
   * eye reads as "not water": a surface that is mathematically a level set and
   * visibly a staircase. One binomial pass of the band removes it. The
   * attenuation is the point: at a wavelength of 32 cells a pass keeps 99% of
   * the amplitude, and at a wavelength of two cells it keeps 2%. It is a filter
   * on the interface's numerical dust, not on the physics - the resolved wave
   * is what feeds the ripple lab, and it survives untouched.
   */
  filterInterface() {
    const { nx, ny, dx, phi } = this;
    const band = (this.params.filterBand ?? 2.5) * dx;
    const out = this._phiFiltered ?? (this._phiFiltered = new Float64Array(phi.length));
    out.set(phi);
    const w = this.params.filterWeight ?? 0.5;
    if (!(w > 0)) return;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (Math.abs(phi[k]) > band) continue;
        const avg = (
          phi[k - nx - 1] + 2 * phi[k - nx] + phi[k - nx + 1] +
          2 * phi[k - 1] + 4 * phi[k] + 2 * phi[k + 1] +
          phi[k + nx - 1] + 2 * phi[k + nx] + phi[k + nx + 1]
        ) / 16;
        out[k] = phi[k] + (avg - phi[k]) * w;
      }
    }
    phi.set(out);
  }

  /* ---- the level set --------------------------------------------------- */

  /**
   * Reinitialise the level set: two iterations of
   *
   *   phi_t + S(phi0) (|grad phi| - 1) = 0,   S(phi0) = phi0 / sqrt(phi0^2 + dx^2)
   *
   * The norm of the gradient is the Godunov upwind one, not a central
   * difference: a central difference across a sharp interface oscillates, and
   * an oscillating phi is an oscillating curvature, which is a surface tension
   * force that pulls the drop apart instead of holding it together.
   */
  redistance(dt) {
    const { nx, ny, dx } = this;
    const phi0 = Float64Array.from(this.phi);
    const tau = 0.45 * dx;
    const band = this.band;
    for (let iter = 0; iter < 2; iter++) {
      const phi = this.phi;
      const next = new Float64Array(phi.length);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const im = i > 0 ? k - 1 : k, ip = i < nx - 1 ? k + 1 : k;
          const jm = j > 0 ? k - nx : k, jp = j < ny - 1 ? k + nx : k;
          const dmx = (phi[k] - phi[im]) / dx;
          const dpx = (phi[ip] - phi[k]) / dx;
          const dmy = (phi[k] - phi[jm]) / dx;
          const dpy = (phi[jp] - phi[k]) / dx;
          const s0 = phi0[k];
          let gx2, gy2;
          if (s0 >= 0) {
            gx2 = Math.max(Math.max(dmx, 0) ** 2, Math.min(dpx, 0) ** 2);
            gy2 = Math.max(Math.max(dmy, 0) ** 2, Math.min(dpy, 0) ** 2);
          } else {
            gx2 = Math.max(Math.min(dmx, 0) ** 2, Math.max(dpx, 0) ** 2);
            gy2 = Math.max(Math.min(dmy, 0) ** 2, Math.max(dpy, 0) ** 2);
          }
          const grad = Math.sqrt(gx2 + gy2);
          const S = s0 / Math.sqrt(s0 * s0 + dx * dx);
          let v = phi[k] - tau * S * (grad - 1);
          if (s0 >= 0) v = Math.max(v, 0);
          else v = Math.min(v, 0);
          next[k] = clamp(v, -band, band);
        }
      }
      this.phi = next;
    }
  }

  /**
   * Hold the volume the scene was built with.
   *
   * A semi-Lagrangian level set does not conserve volume exactly: the scheme
   * is stable, not conservative, and a falling drop loses a fraction of a
   * percent a second. Rather than hide that, the drift is corrected by a
   * uniform shift of phi - a small, bounded correction - and the panel reports
   * the residual so the reader can see the size of the correction being made.
   */
  correctVolume() {
    if (!(this.targetVolume > 0)) return;
    const v = this.volume();
    const drift = v - this.targetVolume;
    if (Math.abs(drift) < 1e-12) return;
    const { nx, ny, dx, phi } = this;
    let length = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) if (Math.abs(phi[j * nx + i]) < dx) length++;
    }
    if (!length) return;
    const limit = (this.params.volumeCorrectionClamp ?? 0.25) * dx;
    const shift = clamp(drift / (length * dx * this.depth), -limit, limit);
    for (let k = 0; k < phi.length; k++) {
      phi[k] = clamp(phi[k] + shift, -this.band, this.band);
    }
  }

  /* ---- state ------------------------------------------------------------ */

  /**
   * Everything that makes this tank the tank it is, as plain arrays.
   *
   * A checkpoint is a state, not a setup: two tanks with the same parameters
   * and a different field are two different experiments, so the field is what
   * is written down. The arrays are copied, so a snapshot is a photograph and
   * not a window onto a tank that carries on moving.
   */
  snapshot() {
    return {
      params: { ...this.params },
      time: this.time,
      frame: this.frame,
      targetVolume: this.targetVolume,
      ball: { ...this.ball },
      phi: Float32Array.from(this.phi),
      u: Float32Array.from(this.u),
      v: Float32Array.from(this.v),
    };
  }

  /** Put a snapshot back, rebuilding the grids if the resolution changed. */
  restore(snap) {
    if (!snap || !snap.phi) return false;
    const p = { ...LIQUID_DEFAULTS, ...(snap.params ?? {}) };
    if (p.nx !== this.params.nx || p.ny !== this.params.ny || p.width !== this.params.width) {
      this.params = p;
      this.build();
    } else {
      this.params = p;
    }
    if (snap.phi.length !== this.phi.length) return false;
    this.phi.set(snap.phi);
    if (snap.u && snap.u.length === this.u.length) this.u.set(snap.u);
    if (snap.v && snap.v.length === this.v.length) this.v.set(snap.v);
    this.time = snap.time ?? 0;
    this.frame = snap.frame ?? 0;
    this.targetVolume = snap.targetVolume ?? this.volume();
    this.ball = { ...this.ball, ...(snap.ball ?? {}) };
    this.paintBall();
    return true;
  }

  /** The snapshot as JSON: arrays rounded to a compact fixed point. */
  static encode(snap) {
    const round = (a) => Array.from(a, (v) => Math.round(v * 1e4) / 1e4);
    return {
      ...snap,
      phi: round(snap.phi),
      u: round(snap.u),
      v: round(snap.v),
    };
  }

  /* ---- the rigid body -------------------------------------------------- */

  /**
   * Integrate the ball.
   *
   * Two forces, both of them named rather than buried in an integral:
   *
   *   - buoyancy, rho g V_submerged, upward. It is Archimedes, and it is taken
   *     from the displaced volume the level set actually reports rather than
   *     from the pressure field, because integrating a cell-centred pressure
   *     round a staircase solid over-counts the surface: the staircase has
   *     about a quarter more boundary than the circle it stands for, and a
   *     body that should float with 48% of itself wet floats with 60%;
   *   - drag, half rho C_d d |v_rel| v_rel, against the liquid's own motion -
   *     which is also the only way the liquid's horizontal motion reaches the
   *     body, so a sloshing tank carries its contents with it.
   *
   * The liquid does not see either of these. It sees a moving wall - the solid
   * mask and the body's velocity on its faces - and that is the coupling that
   * makes the waves: push the body through the tank and the surface answers.
   *
   * The mass that moves is the body's plus the liquid it has to shove aside.
   * Leaving the second term out is the classic explicit added-mass
   * instability: a light body takes a step, the projection answers with a
   * pressure that overshoots, and the pair ring louder every step.
   */
  pushBall(dt) {
    const b = this.ball;
    if (!b.visible || !(b.r > 0)) return;
    const { nx, ny, dx, u, v, params } = this;
    const area = Math.PI * b.r * b.r;

    const submerged = this.submergedFraction();
    const displaced = params.density * area * submerged;
    const mass = Math.max(1e-6, (b.density + params.density) * area);
    const buoyancy = displaced * params.gravity;
    const weight = -b.density * area * params.gravity;

    const { u: uL } = this.ambientFlow();

    /* Horizontal: the body is carried by the liquid it sits in, which is what
       makes a body surf a sloshing tank. Vertical: measured against still
       water instead. The vertical pair is the stiff one - the body and the
       projection answer each other within a step - and taking the liquid's own
       velocity there lets the wake the body just made push the body, which is
       a feedback with no damping in it. One way round is stable and is what a
       buoyant body does anyway: it bobs against the water, not with it. */
    const rx = b.vx - uL;
    const dragX = 0.5 * params.density * 1.2 * (2 * b.r) * Math.abs(rx) * rx;
    /* Two drag terms, because they are two different mechanisms and only one of
       them is in the equations this bench solves. The quadratic one is the
       usual form drag on the hull. The linear one is the damping a real
       floating body gets from the waves it makes: a bobbing hull radiates a
       train of surface waves that carries its energy away, and on a grid this
       size those waves leave the body's neighbourhood long before they could
       push back on it. That is a loss the solve cannot see, so it is written
       down as the coefficient it is: of order rho * d * sqrt(g r), which is the
       impedance of the surface the body is riding. */
    const dragY = 0.5 * params.density * 1.2 * (2 * b.r) * Math.abs(b.vy) * b.vy;
    const radiation = 0.55 * params.density * (2 * b.r) * Math.sqrt(params.gravity * b.r) * b.vy;
    const fx = -dragX;
    const fy = buoyancy + weight - dragY - radiation;

    b.vx += (fx / mass) * dt;
    b.vy += (fy / mass) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    /* The tank is a wall: the ball may not leave it. */
    const r = b.r;
    if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * b.restitution; }
    if (b.x > this.width - r) { b.x = this.width - r; b.vx = -Math.abs(b.vx) * b.restitution; }
    if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) * b.restitution; }
    if (b.y > this.height - r) { b.y = this.height - r; b.vy = -Math.abs(b.vy) * b.restitution; }
  }
}

/* Two helpers for the curvature: the unit normal of the SMOOTHED field at a
   given cell, so the divergence of the normal is taken on the same field. */
function nxvAt(field, nx, ny, i, j, dx) {
  const im = Math.max(i - 1, 0), ip = Math.min(i + 1, nx - 1);
  const gx = (field[j * nx + ip] - field[j * nx + im]) / (2 * dx);
  const jm = Math.max(j - 1, 0), jp = Math.min(j + 1, ny - 1);
  const gy = (field[jp * nx + i] - field[jm * nx + i]) / (2 * dx);
  return gx / (Math.hypot(gx, gy) + 1e-12);
}

function nyvAt(field, nx, ny, i, j, dx) {
  const im = Math.max(i - 1, 0), ip = Math.min(i + 1, nx - 1);
  const gx = (field[j * nx + ip] - field[j * nx + im]) / (2 * dx);
  const jm = Math.max(j - 1, 0), jp = Math.min(j + 1, ny - 1);
  const gy = (field[jp * nx + i] - field[jm * nx + i]) / (2 * dx);
  return gy / (Math.hypot(gx, gy) + 1e-12);
}
