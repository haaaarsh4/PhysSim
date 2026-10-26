import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 40, pressureTolerance: 2e-3 });
FLUID_LABS.find(l => l.id === "dam").build(s);
s.captureVolume();
let best = 0;
for (let n = 0; n < 240; n++) {
  s.step(1/240);
  for (let j = 0; j < s.ny; j++) for (let i = 0; i <= s.nx; i++) {
    const u = Math.abs(s.u[j*(s.nx+1)+i]);
    if (u > best) { best = u; if (u > 4) console.log(`t=${s.time.toFixed(3)} u=${u.toFixed(2)} at (${(i*s.dx*100).toFixed(1)},${(j*s.dx*100).toFixed(1)})cm phiL=${i>0?s.phi[j*s.nx+i-1].toFixed(4):"-"} phiR=${i<s.nx?s.phi[j*s.nx+i].toFixed(4):"-"}`); }
  }
  for (let j = 0; j <= s.ny; j++) for (let i = 0; i < s.nx; i++) {
    const v = Math.abs(s.v[j*s.nx+i]);
    if (v > best) { best = v; if (v > 4) console.log(`t=${s.time.toFixed(3)} v=${v.toFixed(2)} at (${(i*s.dx*100).toFixed(1)},${(j*s.dx*100).toFixed(1)})cm`); }
  }
}
console.log("peak", best.toFixed(2));
