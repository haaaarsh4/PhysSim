/**
 * solvers/jacobi.js - Jacobi iteration for the pressure Poisson equation.
 *
 * At every cell, average its 4 neighbors and subtract the local
 * divergence, using only values from the previous sweep (never a value
 * already updated this pass - that's what makes it Jacobi, not
 * Gauss-Seidel). Converges slowly, but every iteration is cheap and
 * trivially parallel, which is why it's the default in real-time GPU
 * fluid solvers.
 */
import { PressureSolver } from "./solver_interface.js";

export class JacobiSolver extends PressureSolver {
  static solverName = "jacobi";
  get name() { return "jacobi"; }

  solve(divergence, solidMask, nx, ny, dx, maxIter = 60, tol = 1e-5) {
    let p = new Float64Array(nx * ny);
    const residuals = [];
    const dx2 = dx * dx;
    let iterations = 0;

    for (iterations = 0; iterations < maxIter; iterations++) {
      const next = new Float64Array(nx * ny);
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = y * nx + x;
          if (solidMask[idx]) { next[idx] = 0; continue; }
          const c = p[idx];
          const l = (x > 0 && !solidMask[idx - 1]) ? p[idx - 1] : c;
          const r = (x < nx - 1 && !solidMask[idx + 1]) ? p[idx + 1] : c;
          const d = (y > 0 && !solidMask[idx - nx]) ? p[idx - nx] : c;
          const u = (y < ny - 1 && !solidMask[idx + nx]) ? p[idx + nx] : c;
          next[idx] = (l + r + u + d - dx2 * divergence[idx]) * 0.25;
        }
      }
      p = next;
      const res = this.residualNorm(p, divergence, solidMask, nx, ny, dx);
      residuals.push(res);
      if (res < tol) { iterations++; break; }
    }

    return { pressure: p, info: { iterations, residuals, solver: this.name } };
  }
}
