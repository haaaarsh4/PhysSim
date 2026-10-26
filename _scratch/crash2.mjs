import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 120, pressureTolerance: 1e-5 });
FLUID_LABS.find(l => l.id === "impact").build(s);
s.captureVolume();
for (let n = 0; n < Math.round(0.45 * 240); n++) {
  s.step(1/240);
  let cells = 0; for (let k = 0; k < s.phi.length; k++) if (s.phi[k] < 0) cells++;
  if (s.time > 0.26) console.log(`t=${s.time.toFixed(4)} U=${s.maxSpeed().toFixed(4)} KE=${s.kineticEnergy().toFixed(3)} cells=${cells} vol=${s.volume().toFixed(5)} surf=${s.waterlineAt(s.width*0.52).toFixed(3)}`);
}
