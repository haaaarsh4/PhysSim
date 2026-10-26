import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
FLUID_LABS.find(l => l.id === "impact").build(s);
s.captureVolume();
const sumV = () => { let a = 0; for (let j = 0; j <= s.ny; j++) for (let i = 0; i < s.nx; i++) { if (j < s.ny && s.phi[j*s.nx+i] < 0 || (j>0 && s.phi[(j-1)*s.nx+i] < 0)) a += s.v[j*s.nx+i]; } return a; };
const names = ["advect","applyGravity","applyViscosity","project","filterInterface","redistance","correctVolume"];
for (const n of names) {
  const o = s[n].bind(s);
  s[n] = (...a) => { o(...a); if (s.time > 0.395 && s.time < 0.44) console.log(`  ${n.padEnd(15)} sumV=${sumV().toFixed(2)} U=${s.maxSpeed().toFixed(3)}`); };
}
for (let n = 0; n < 120 * 0.435; n++) { s.step(1/120); if (s.time > 0.395 && s.time < 0.44) console.log(`t=${s.time.toFixed(3)}`); }
