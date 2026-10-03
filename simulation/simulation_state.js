/**
 * simulation/simulation_state.js - grid state for the fluid solver.
 *
 * Everything the 2D Eulerian fluid solver mutates each step lives here:
 * velocity (u, v), the dye field used for visualization, pressure,
 * divergence, vorticity, and a boolean solid mask marking obstacle
 * cells. All fields are flattened Float64Array, row-major
 * (index = y*nx + x) - plain typed arrays, no dependency, so this class
 * is usable identically from the browser frontend and from a Node
 * script in experiments/.
 */
export class SimulationState {
  constructor(nx, ny, dx = 1, dt = 0.016) {
    this.nx = nx; this.ny = ny; this.dx = dx; this.dt = dt;
    this.time = 0; this.frame = 0;
    this.reset();
  }

  reset() {
    const n = this.nx * this.ny;
    this.u = new Float64Array(n);
    this.v = new Float64Array(n);
    this.dye = new Float64Array(n * 3);
    this.pressure = new Float64Array(n);
    this.divergence = new Float64Array(n);
    this.vorticity = new Float64Array(n);
    this.solidMask = new Uint8Array(n);
    this.time = 0;
    this.frame = 0;
  }

  idx(x, y) { return y * this.nx + x; }

  /** Cell-center world coordinates for cell (x, y). */
  worldPos(x, y) { return [x * this.dx, y * this.dx]; }

  memoryReportMB() {
    const bytes =
      this.u.byteLength + this.v.byteLength + this.dye.byteLength +
      this.pressure.byteLength + this.divergence.byteLength +
      this.vorticity.byteLength + this.solidMask.byteLength;
    return bytes / 1e6;
  }
}
