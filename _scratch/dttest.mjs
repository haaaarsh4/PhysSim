import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
for (const dt of [1/120, 1/240, 1/480, 1/960]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 60, pressureTolerance: 1e-4, redistanceEvery: 3 });
  FLUID_LABS.find(l => l.id === "impact").build(s);
  s.captureVolume();
  const ke = [];
  for (let n = 0; n < Math.round(0.9 / dt); n++) {
    s.step(dt);
    if (Math.abs(s.time % 0.15) < dt / 2) ke.push(s.kineticEnergy().toFixed(2));
  }
  console.log(`dt=1/${Math.round(1/dt)}: KE ${ke.join(" ")}  final surf=${s.waterlineAt(s.width*0.5).toFixed(3)}`);
}
