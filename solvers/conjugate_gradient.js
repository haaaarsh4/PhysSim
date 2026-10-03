/**
 * solvers/conjugate_gradient.js - matrix-free Conjugate Gradient.
 *
 * The Poisson matrix is symmetric negative-(semi)definite, a textbook
 * case for CG: each search direction is L-orthogonal to every previous
 * one, so it reaches a given residual in far fewer iterations than
 * Jacobi's uniform averaging. This never forms an explicit matrix - it
 * only ever applies solver_interface's `applyLaplacian` - which is
 * standard practice once a grid is too large to store as a dense matrix.
 */
import { PressureSolver } from "./solver_interface.js";

export class ConjugateGradientSolver extends PressureSolver {
  static solverName = "conjugate_gradient";
  get name() { return "conjugate_gradient"; }

  solve(divergence, solidMask, nx, ny, dx, maxIter = 200, tol = 1e-5) {
    const n = nx * ny;
    let p = new Float64Array(n);
    let r = new Float64Array(n);
    const Ap0 = this.applyLaplacian(p, solidMask, nx, ny, dx);
    for (let i = 0; i < n; i++) r[i] = solidMask[i] ? 0 : divergence[i] - Ap0[i];
    let d = r.slice();

    let rsOld = dot(r, r);
    const residuals = [Math.sqrt(rsOld / n)];
    let iterations = 0;

    if (rsOld < 1e-30) {
      return { pressure: p, info: { iterations: 0, residuals, solver: this.name } };
    }

    for (iterations = 0; iterations < maxIter; iterations++) {
      const Ad = this.applyLaplacian(d, solidMask, nx, ny, dx);
      for (let i = 0; i < n; i++) if (solidMask[i]) Ad[i] = 0;
      const denom = dot(d, Ad);
      if (Math.abs(denom) < 1e-30) break;
      const alpha = rsOld / denom;

      for (let i = 0; i < n; i++) { p[i] += alpha * d[i]; r[i] -= alpha * Ad[i]; }

      const rsNew = dot(r, r);
      residuals.push(Math.sqrt(rsNew / n));
      if (Math.sqrt(rsNew) < tol) { iterations++; break; }

      const beta = rsNew / rsOld;
      for (let i = 0; i < n; i++) d[i] = r[i] + beta * d[i];
      rsOld = rsNew;
    }

    for (let i = 0; i < n; i++) if (solidMask[i]) p[i] = 0;
    return { pressure: p, info: { iterations, residuals, solver: this.name } };
  }
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
