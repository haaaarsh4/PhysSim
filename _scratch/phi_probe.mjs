import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000, pressureIterations: 60, pressureTolerance: 1e-4 });
FLUID_LABS.find((l) => l.id === 'dam').build(s);

function row(j) {
  const out = [];
  for (let i = 0; i < s.nx; i += 4) out.push(Math.round(s.phi[j * s.nx + i] / s.dx));
  return out;
}
function com() {
  let m = 0, mxx = 0;
  for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
    const k = j * s.nx + i;
    const w = Math.max(0, Math.min(1, -s.phi[k] / s.dx + 0.5));
    m += w; mxx += w * (i + 0.5) * s.dx;
  }
  return mxx / m;
}
const dt = 1 / 120;
console.log('phi/dx along j=0 (floor row), every 4 cells:');
console.log('t=0   ', row(0).join(' '));
console.log('com', com().toFixed(3));
for (let n = 0; n < 12; n++) s.step(dt);
console.log('t=0.1 ', row(0).join(' '));
console.log('com', com().toFixed(3), 'u at front:', (() => { const i = Math.round(0.45 / s.dx); return s.u[3 * (s.nx + 1) + i].toFixed(2); })());
for (let n = 0; n < 12; n++) s.step(dt);
console.log('t=0.2 ', row(0).join(' '));
console.log('com', com().toFixed(3));
