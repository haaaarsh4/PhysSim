import { LiquidSolver } from '../simulation/liquid_solver.js';

const s = new LiquidSolver({ width: 1.2, nx: 96, ny: 72, gravity: 9.81, surfaceTension: 0, viscosity: 0, density: 1000, pressureIterations: 400, pressureTolerance: 1e-8 });
s.empty();
s.fillBelow(s.height * 0.5);
const dt = 1 / 120;
for (let n = 0; n < 240; n++) s.step(dt);

const i = Math.round(0.6 / s.dx);
console.log('y      p        hydro   phi/dx');
for (let j = 0; j < s.ny; j += 3) {
  const k = j * s.nx + i;
  const y = (j + 0.5) * s.dx;
  console.log(`${y.toFixed(3)}  ${s.pressure[k].toFixed(3).padStart(8)}  ${(9.81 * (0.5 * s.height - y)).toFixed(2).padStart(6)}  ${(s.phi[k] / s.dx).toFixed(1)}`);
}
let umax = 0, vmax = 0;
for (const q of s.u) umax = Math.max(umax, Math.abs(q));
for (const q of s.v) vmax = Math.max(vmax, Math.abs(q));
console.log(`max|u| ${umax.toExponential(2)}  max|v| ${vmax.toExponential(2)}  iters ${s.lastSolve.iterations} res ${s.lastSolve.residual.toExponential(1)}`);
