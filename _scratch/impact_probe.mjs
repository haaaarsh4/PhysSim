import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
FLUID_LABS.find(l => l.id === "impact").build(s);
s.captureVolume();
for (let n = 0; n < 120 * 1.2; n++) {
  s.step(1 / 120);
  if (n % 12 === 0) {
    // count how many separate bodies exist mid-tank
    console.log(`t=${s.time.toFixed(2)} U=${s.maxSpeed().toFixed(2)} KE=${s.kineticEnergy().toFixed(2)} seg=${s.columnSegments(s.width*0.52)} surf=${s.waterlineAt(s.width*0.52).toFixed(3)} it=${s.lastSolve.iterations}`);
  }
}
