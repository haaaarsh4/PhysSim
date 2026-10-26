import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000, pressureIterations: 200, pressureTolerance: 1e-6 });
FLUID_LABS.find((l) => l.id === 'dam').build(s);
const dt = 1 / 120;

function draw() {
  const rows = [];
  for (let j = s.ny - 1; j >= 0; j -= 3) {
    let row = '';
    for (let i = 0; i < s.nx; i += 2) {
      const p = s.phi[j * s.nx + i] / s.dx;
      row += p < -2 ? '#' : p < 0 ? '+' : p < 2 ? '.' : ' ';
    }
    rows.push(row);
  }
  console.log(rows.join('\n'));
}

for (const t of [0, 0.1, 0.3]) {
  while (s.time < t - 1e-9) s.step(dt);
  console.log(`\n===== t = ${s.time.toFixed(2)} s =====`);
  draw();
}
