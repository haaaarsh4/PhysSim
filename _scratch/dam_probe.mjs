/* Probe: the dam break against Ritter's solution, and the pool's settling. */
import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000 });
FLUID_LABS.find((l) => l.id === 'dam').build(s);

const dt = 1 / 120;
const h0 = 0.64 * s.height;
const c0 = Math.sqrt(9.81 * h0);
const width = s.width;

function front() {
  // rightmost column with any liquid at all (phi < 0) above the floor
  for (let i = s.nx - 1; i >= 0; i--) {
    for (let j = 0; j < s.ny; j++) if (s.phi[j * s.nx + i] < 0) return (i + 0.5) * s.dx;
  }
  return 0;
}
function surfaceProfile() {
  const out = [];
  for (let i = 0; i < s.nx; i += 8) {
    let top = 0;
    for (let j = s.ny - 1; j >= 0; j--) if (s.phi[j * s.nx + i] < 0) { top = (j + 0.5) * s.dx; break; }
    out.push(top);
  }
  return out;
}

console.log(`h0 = ${h0.toFixed(3)} m   sqrt(g h0) = ${c0.toFixed(3)}   Ritter front 2c0t`);
const marks = [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.2, 0.3];
let next = 0;
for (let n = 0; n < 0.3 / dt; n++) {
  s.step(dt);
  if (next < marks.length && s.time >= marks[next] - 1e-9) {
    const f = front() - 0.32 * width;          // distance travelled from the gate
    const ideal = 2 * c0 * s.time;
    console.log(`t=${s.time.toFixed(3)}  front=${f.toFixed(3)} m  ritter=${ideal.toFixed(3)} m  ratio=${(f / ideal).toFixed(2)}  vol=${s.volume().toFixed(5)}`);
    next++;
  }
}

console.log('\nsettling (dam, water, 0.004 Pa s as the lab sets it):');
FLUID_LABS.find((l) => l.id === 'dam').build(s);
for (let n = 0; n < 6 / dt; n++) s.step(dt);
const prof = surfaceProfile();
const depths = prof.map((p) => (p - 0).toFixed(3));
console.log('surface at 6 s (x = 0.05 .. 1.15 m):', depths.join(' '));
const mean = prof.reduce((a, b) => a + b, 0) / prof.length;
const spread = Math.max(...prof) - Math.min(...prof);
console.log(`mean depth ${mean.toFixed(3)}  spread ${spread.toFixed(4)}  vol ${s.volume().toFixed(4)}  expected depth ${(s.volume() / width).toFixed(3)}`);
