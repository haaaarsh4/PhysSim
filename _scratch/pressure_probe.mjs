/* Probe: is the projection giving the pressure a dam break needs? */
import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000 });
FLUID_LABS.find((l) => l.id === 'dam').build(s);

const dt = 1 / 120;
const maxU = () => {
  let m = 0;
  for (let k = 0; k < s.u.length; k++) m = Math.max(m, Math.abs(s.u[k]));
  return m;
};
const hydro = () => {
  // pressure in the column at x=0.1 m (deep inside), expected rho g (ys - y)
  const i = Math.round(0.1 / s.dx);
  const out = [];
  for (let j = 0; j < s.ny; j += 12) {
    const k = j * s.nx + i;
    if (s.phi[k] >= 0) continue;
    const y = (j + 0.5) * s.dx;
    out.push([y.toFixed(2), (s.pressure[k] / 1000).toFixed(3), (9.81 * (0.576 - y)).toFixed(3)]);
  }
  return out;
};

for (let n = 0; n < 12; n++) {
  s.step(dt);
  console.log(`t=${s.time.toFixed(3)}  max|u|=${maxU().toFixed(2)}  max|v|=${(() => { let m = 0; for (const q of s.v) m = Math.max(m, Math.abs(q)); return m; })().toFixed(2)}  iters=${s.lastSolve.iterations}  res=${s.lastSolve.residual.toExponential(1)}`);
}

console.log('\npressure (y, p/rho, hydrostatic) at x=0.1:');
for (const row of hydro()) console.log('  ', row.join('   '));
