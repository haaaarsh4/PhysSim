import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 120, pressureTolerance: 1e-5 });
FLUID_LABS.find(l => l.id === "impact").build(s);
s.captureVolume();
const U = () => s.maxSpeed();
const names = ["advect","applyGravity","applyViscosity","project","filterInterface","redistance","correctVolume"];
const orig = {};
for (const n of names) { orig[n] = s[n].bind(s); }
for (let n = 0; n < Math.round(0.5 * 240); n++) {
  const t0 = s.time;
  for (const nm of names) {
    s[nm] = (...a) => {
      const before = U();
      orig[nm](...a);
      if (t0 > 0.42 && t0 < 0.47) console.log(`  t=${t0.toFixed(3)} ${nm.padEnd(15)} U ${before.toFixed(2)} -> ${U().toFixed(2)}`);
    };
  }
  s.step(1/240);
}
