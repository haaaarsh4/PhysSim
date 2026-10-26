import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
for (const dt of [1/120, 1/240]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
  FLUID_LABS.find(l => l.id === "impact").build(s);
  s.captureVolume();
  const rows = [];
  let next = 0.15;
  for (let n = 0; n < Math.round(1.5 / dt); n++) {
    s.step(dt);
    if (s.time >= next) { rows.push(`${next.toFixed(2)}: KE=${s.kineticEnergy().toFixed(2)} U=${s.maxSpeed().toFixed(2)}`); next += 0.15; }
  }
  console.log(`dt=1/${Math.round(1/dt)}  ${rows.join("  ")}`);
}
