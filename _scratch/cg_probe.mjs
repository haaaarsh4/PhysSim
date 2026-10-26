import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

const dt = 1 / 120, c0 = Math.sqrt(9.81 * 0.576);
for (const [iters, tol] of [[30, 2e-3], [120, 1e-4], [400, 1e-5]]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000, pressureIterations: iters, pressureTolerance: tol });
  FLUID_LABS.find((l) => l.id === 'dam').build(s);
  const front = () => { for (let i = s.nx - 1; i >= 0; i--) for (let j = 0; j < s.ny; j++) if (s.phi[j * s.nx + i] < 0) return (i + 0.5) * s.dx; return 0; };
  for (let n = 0; n < Math.round(0.25 / dt); n++) s.step(dt);
  const i = Math.round(0.1 / s.dx);
  const samp = [];
  for (const j of [4, 20, 36, 52]) { const k = j * s.nx + i; if (s.phi[k] < 0) samp.push(`y=${((j+0.5)*s.dx).toFixed(2)} p=${s.pressure[k].toFixed(2)}/${(9.81*(0.576-(j+0.5)*s.dx)).toFixed(2)}`); }
  console.log(`iters=${iters} tol=${tol}: front=${front().toFixed(3)} (ritter ${(2*c0*s.time).toFixed(3)}) lastIters=${s.lastSolve.iterations} res=${s.lastSolve.residual.toExponential(1)} | ${samp.join(' ')}`);
}
