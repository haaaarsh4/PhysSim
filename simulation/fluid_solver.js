/**
 * simulation/fluid_solver.js - the incompressible fluid pipeline.
 *
 * Jos Stam's "stable fluids": unconditionally-stable semi-Lagrangian
 * advection, vorticity confinement, then a pressure projection that
 * removes divergence. The pressure solve is delegated to a pluggable
 * solvers.PressureSolver (Jacobi or Conjugate Gradient, see solvers/):
 * swap it and every other stage is unaffected, which is the entire
 * point of the solver_interface abstraction.
 *
 * Pipeline per step:
 *   advect velocity -> advect dye -> vorticity confinement
 *     -> divergence -> solve pressure (pluggable) -> subtract gradient
 *     -> enforce solid boundaries
 *
 * Every stage is wrapped in `profiler?.time(name)` if a Profiler
 * (profiling/timers.js) is supplied, giving a real per-stage breakdown.
 */

export function bilinearSample(field, nx, ny, x, y, stride = 1) {
  x = Math.min(Math.max(x, 0), nx - 1.001);
  y = Math.min(Math.max(y, 0), ny - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1);
  const tx = x - x0, ty = y - y0;
  const out = new Array(stride).fill(0);
  const i00 = (y0 * nx + x0) * stride, i10 = (y0 * nx + x1) * stride;
  const i01 = (y1 * nx + x0) * stride, i11 = (y1 * nx + x1) * stride;
  for (let s = 0; s < stride; s++) {
    const top = field[i00 + s] * (1 - tx) + field[i10 + s] * tx;
    const bot = field[i01 + s] * (1 - tx) + field[i11 + s] * tx;
    out[s] = top * (1 - ty) + bot * ty;
  }
  return out;
}

function semiLagrangianAdvect(field, u, v, nx, ny, dt, dx, stride = 1) {
  const out = new Float64Array(field.length);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const idx = y * nx + x;
      const backX = x - (u[idx] * dt) / dx;
      const backY = y - (v[idx] * dt) / dx;
      const sample = bilinearSample(field, nx, ny, backX, backY, stride);
      for (let s = 0; s < stride; s++) out[idx * stride + s] = sample[s];
    }
  }
  return out;
}

function computeDivergence(u, v, nx, ny, dx) {
  const out = new Float64Array(nx * ny);
  for (let y = 1; y < ny - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const idx = y * nx + x;
      const dudx = (u[idx + 1] - u[idx - 1]) / (2 * dx);
      const dvdy = (v[idx + nx] - v[idx - nx]) / (2 * dx);
      out[idx] = dudx + dvdy;
    }
  }
  return out;
}

function computeCurl(u, v, nx, ny, dx) {
  const out = new Float64Array(nx * ny);
  for (let y = 1; y < ny - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const idx = y * nx + x;
      const dvdx = (v[idx + 1] - v[idx - 1]) / (2 * dx);
      const dudy = (u[idx + nx] - u[idx - nx]) / (2 * dx);
      out[idx] = dvdx - dudy;
    }
  }
  return out;
}

function applyVorticityConfinement(u, v, curl, nx, ny, strength, dt, dx) {
  if (strength <= 0) return;
  for (let y = 1; y < ny - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const idx = y * nx + x;
      const gx = (Math.abs(curl[idx + 1]) - Math.abs(curl[idx - 1])) / (2 * dx);
      const gy = (Math.abs(curl[idx + nx]) - Math.abs(curl[idx - nx])) / (2 * dx);
      const n = Math.hypot(gx, gy) + 1e-5;
      const nx_ = gx / n, ny_ = gy / n;
      const c = curl[idx];
      u[idx] += strength * (ny_ * c) * dt;
      v[idx] += strength * (-nx_ * c) * dt;
    }
  }
}

function subtractPressureGradient(u, v, p, solidMask, nx, ny, dx) {
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const idx = y * nx + x;
      if (solidMask[idx] || x === 0 || x === nx - 1 || y === 0 || y === ny - 1) {
        u[idx] = 0; v[idx] = 0; continue;
      }
      u[idx] -= (p[idx + 1] - p[idx - 1]) / (2 * dx);
      v[idx] -= (p[idx + nx] - p[idx - nx]) / (2 * dx);
    }
  }
}

export class FluidSolver {
  constructor(pressureSolver, opts = {}) {
    this.pressureSolver = pressureSolver;
    this.vorticityStrength = opts.vorticityStrength ?? 4.0;
    this.velocityDissipation = opts.velocityDissipation ?? 0.998;
    this.dyeDissipation = opts.dyeDissipation ?? 0.994;
    this.pressureIters = opts.pressureIters ?? 40;
    this.pressureTol = opts.pressureTol ?? 1e-5;
  }

  step(state, profiler = null) {
    const t = profiler ? (name, fn) => profiler.time(name, fn) : (_name, fn) => fn();
    const { nx, ny, dx, dt } = state;

    let u, v, dye;
    t("advect_velocity", () => {
      u = semiLagrangianAdvect(state.u, state.u, state.v, nx, ny, dt, dx);
      v = semiLagrangianAdvect(state.v, state.u, state.v, nx, ny, dt, dx);
      for (let i = 0; i < u.length; i++) { u[i] *= this.velocityDissipation; v[i] *= this.velocityDissipation; }
    });
    t("advect_dye", () => {
      dye = semiLagrangianAdvect(state.dye, u, v, nx, ny, dt, dx, 3);
      for (let i = 0; i < dye.length; i++) dye[i] *= this.dyeDissipation;
    });

    let curl;
    t("vorticity_confinement", () => {
      curl = computeCurl(u, v, nx, ny, dx);
      applyVorticityConfinement(u, v, curl, nx, ny, this.vorticityStrength, dt, dx);
    });

    for (let i = 0; i < u.length; i++) if (state.solidMask[i]) { u[i] = 0; v[i] = 0; }

    let divergence;
    t("divergence", () => { divergence = computeDivergence(u, v, nx, ny, dx); });

    let pressure, solverInfo;
    t("pressure_solve", () => {
      const result = this.pressureSolver.solve(
        divergence, state.solidMask, nx, ny, dx, this.pressureIters, this.pressureTol
      );
      pressure = result.pressure; solverInfo = result.info;
    });

    t("project", () => { subtractPressureGradient(u, v, pressure, state.solidMask, nx, ny, dx); });

    state.u = u; state.v = v; state.dye = dye;
    state.pressure = pressure; state.divergence = divergence; state.vorticity = curl;
    state.frame++; state.time += dt;

    return solverInfo;
  }

  /** Inject velocity + dye at world position (x, y) - an emitter jet or a
   * mouse-driven splat. `color` is [r,g,b] in 0..1. */
  splat(state, x, y, dxVel, dyVel, color, radius = 3) {
    const { nx, ny, dx } = state;
    for (let gy = 0; gy < ny; gy++) {
      for (let gx = 0; gx < nx; gx++) {
        const wx = gx * dx, wy = gy * dx;
        const d2 = (wx - x) ** 2 + (wy - y) ** 2;
        const falloff = Math.exp(-d2 / (2 * radius * radius));
        const idx = gy * nx + gx;
        state.u[idx] += dxVel * falloff;
        state.v[idx] += dyVel * falloff;
        state.dye[idx * 3 + 0] += color[0] * falloff;
        state.dye[idx * 3 + 1] += color[1] * falloff;
        state.dye[idx * 3 + 2] += color[2] * falloff;
      }
    }
  }
}

export { semiLagrangianAdvect, computeDivergence, computeCurl };
