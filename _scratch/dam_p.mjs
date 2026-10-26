import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

for (const iters of [60, 600]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000, pressureIterations: iters, pressureTolerance: 1e-8 });
  FLUID_LABS.find((l) => l.id === 'dam').build(s);
  const i = Math.round(0.1 / s.dx);
  s.step(1 / 120);
  const out = [];
  for (let j = 0; j < 60; j += 4) {
    const k = j * s.nx + i;
    const y = (j + 0.5) * s.dx;
    out.push(`${y.toFixed(2)}:${s.pressure[k].toFixed(2)}/${(9.81 * (0.576 - y)).toFixed(1)}`);
  }
  console.log(`iters ${iters} (used ${s.lastSolve.iterations}, res ${s.lastSolve.residual.toExponential(1)})`);
  console.log('  ', out.join('  '));
}
