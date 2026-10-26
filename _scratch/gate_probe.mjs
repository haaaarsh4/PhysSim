import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

for (const iters of [30, 300]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000, pressureIterations: iters, pressureTolerance: 1e-6 });
  FLUID_LABS.find((l) => l.id === 'dam').build(s);
  const j = 30;                       // y = 0.29 m, well under the surface
  const cells = [];
  for (let i = 30; i <= 50; i++) cells.push(Math.round(s.phi[j * s.nx + i] / s.dx));
  const dt = 1 / 120;
  s.step(dt);
  const press = [];
  for (let i = 30; i <= 50; i += 2) press.push(s.pressure[j * s.nx + i].toFixed(1));
  const vel = [];
  for (let i = 30; i <= 50; i += 2) vel.push(s.u[j * (s.nx + 1) + i].toFixed(2));
  console.log(`iters ${iters}: phi/dx ${cells.join(',')}`);
  console.log(`   p ${press.join(' ')}`);
  console.log(`   u ${vel.join(' ')}   iters used ${s.lastSolve.iterations} res ${s.lastSolve.residual.toExponential(1)}`);
}
