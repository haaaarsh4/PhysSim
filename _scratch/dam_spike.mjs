import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
FLUID_LABS.find(l => l.id === "dam").build(s);
s.captureVolume();
for (let n = 0; n < 12; n++) {
  s.step(1 / 120);
  // where is the peak?
  let best = 0, bi = -1, bj = -1, bu = true;
  for (let j = 0; j < s.ny; j++) for (let i = 0; i <= s.nx; i++) {
    const u = Math.abs(s.u[j*(s.nx+1)+i]); if (u > best) { best = u; bi = i; bj = j; bu = true; }
  }
  for (let j = 0; j <= s.ny; j++) for (let i = 0; i < s.nx; i++) {
    const v = Math.abs(s.v[j*s.nx+i]); if (v > best) { best = v; bi = i; bj = j; bu = false; }
  }
  console.log(`step ${n} U=${best.toFixed(2)} at (${(bi*s.dx*100).toFixed(1)}, ${(bj*s.dx*100).toFixed(1)}) cm ${bu?"u":"v"}  phi=${s.phi[Math.min(s.phi.length-1, bj*s.nx+bi)].toFixed(4)}`);
}
