import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0, viscosity: 0, density: 1000, pressureIterations: 400, pressureTolerance: 1e-9 });
FLUID_LABS.find((l) => l.id === 'dam').build(s);
const i = Math.round(0.1 / s.dx);
const dt = 1 / 120;

s.step(dt);
console.log('dt', dt, 'dx', s.dx.toFixed(5), 'g dt / dx', (9.81 * dt / s.dx).toFixed(2));
console.log('v at floor column (j=0..4):', [0, 1, 2, 3, 4].map((j) => s.v[j * s.nx + i].toFixed(4)).join(' '));
console.log('phi/dx at that column:', [0, 1, 2, 3, 4].map((j) => (s.phi[j * s.nx + i] / s.dx).toFixed(1)).join(' '));
console.log('div(row0..3):', [0, 1, 2, 3].map((j) => s.divergence[j * s.nx + i].toFixed(3)).join(' '));
console.log('pressure(row0..4):', [0, 1, 2, 3, 4].map((j) => s.pressure[j * s.nx + i].toFixed(3)).join(' '));
// horizontal pressure profile at y = 0.29
const j = 30;
const row = [];
for (let a = 0; a <= 50; a += 5) row.push(`${(a * s.dx).toFixed(2)}:${s.pressure[j * s.nx + a].toFixed(2)}`);
console.log('p across x at y=0.29:', row.join(' '));
