/**
 * solvers/solver_interface.js - pluggable pressure-Poisson solver interface.
 *
 * Every fluid step needs to solve L·p = d for p, where d is velocity
 * divergence and L is the discrete Laplacian (5-point stencil, Neumann
 * boundary at solid cells / domain walls). Jacobi and Conjugate Gradient
 * (solvers/jacobi.js, solvers/conjugate_gradient.js) both subclass this
 * and share `applyLaplacian`, so a runtime/iteration-count comparison
 * between them is measuring the solvers, not the discretization.
 *
 * Fields are flattened Float64Array, row-major, index = y*nx + x - plain
 * numbers, no framework dependency, runs under Node or in the browser.
 */

export class PressureSolver {
  static solverName = "abstract";

  /** L·p, matrix-free: a solid or off-grid neighbor mirrors back to the
   * center value, which is the discrete equivalent of zero flux there. */
  applyLaplacian(p, solidMask, nx, ny, dx) {
    const out = new Float64Array(nx * ny);
    const invDx2 = 1 / (dx * dx);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = y * nx + x;
        if (solidMask[idx]) { out[idx] = 0; continue; }
        const c = p[idx];
        const l = (x > 0 && !solidMask[idx - 1]) ? p[idx - 1] : c;
        const r = (x < nx - 1 && !solidMask[idx + 1]) ? p[idx + 1] : c;
        const d = (y > 0 && !solidMask[idx - nx]) ? p[idx - nx] : c;
        const u = (y < ny - 1 && !solidMask[idx + nx]) ? p[idx + nx] : c;
        out[idx] = (l + r + u + d - 4 * c) * invDx2;
      }
    }
    return out;
  }

  /**
   * @returns {{pressure: Float64Array, info: {iterations:number, residuals:number[], solver:string}}}
   */
  solve(_divergence, _solidMask, _nx, _ny, _dx, _maxIter, _tol) {
    throw new Error("PressureSolver.solve must be implemented by a subclass");
  }

  residualNorm(p, divergence, solidMask, nx, ny, dx) {
    const lap = this.applyLaplacian(p, solidMask, nx, ny, dx);
    let sumSq = 0;
    for (let i = 0; i < lap.length; i++) {
      const r = divergence[i] - lap[i];
      sumSq += r * r;
    }
    return Math.sqrt(sumSq / lap.length);
  }
}
