import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

// A uniform velocity field with no forces: the interface must move with the fluid.
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 0, surfaceTension: 0, viscosity: 0, density: 1000 });
FLUID_LABS.find((l) => l.id === 'dam').build(s);
s.params.gravity = 0;
for (let j = 0; j < s.ny; j++) for (let i = 0; i <= s.nx; i++) s.u[j * (s.nx + 1) + i] = 1.0;
const front = () => { for (let i = s.nx - 1; i >= 0; i--) for (let j = 0; j < s.ny; j++) if (s.phi[j * s.nx + i] < 0) return (i + 0.5) * s.dx; return 0; };
const f0 = front();
const dt = 1 / 120;
for (let n = 0; n < 12; n++) {
  for (let j = 0; j < s.ny; j++) for (let i = 0; i <= s.nx; i++) s.u[j * (s.nx + 1) + i] = 1.0;
  s.step(dt);
}
console.log(`uniform u=1 m/s after ${(12*dt).toFixed(3)} s: front moved ${(front()-f0).toFixed(4)} m, expected ${(1*12*dt).toFixed(4)} m; vol ${s.volume().toFixed(4)} (target ${s.targetVolume.toFixed(4)})`);
