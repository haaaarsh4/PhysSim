import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
FLUID_LABS.find(l => l.id === "impact").build(s);
s.captureVolume();
const names = ["advect","applyGravity","applyViscosity","project","filterInterface","redistance","correctVolume"];
const orig = {};
for (const n of names) {
  orig[n] = s[n].bind(s);
  s[n] = (...a) => { orig[n](...a); if (s.time > 0.44 && s.time < 0.56) console.log(`  t=${s.time.toFixed(3)} after ${n}: U=${s.maxSpeed().toExponential(2)}`); };
}
for (let n = 0; n < 120 * 0.56; n++) s.step(1 / 120);
