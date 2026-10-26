import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
for (const f of [0.35, 0.5, 0.6, 0.7, 0.8, 0.9, 1.1]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 40, pressureTolerance: 2e-3 });
  FLUID_LABS.find(l => l.id === "slosh").build(s);
  s.captureVolume();
  const dt = 1/240;
  let amp = 0;
  for (let n = 0; n < Math.round(7 / dt); n++) {
    s.params.bodyAccelX = 2.4 * Math.sin(2 * Math.PI * f * s.time);
    s.step(dt);
    if (s.time > 2) amp = Math.max(amp, Math.abs(s.waterlineAt(0.04) - s.waterlineAt(s.width - 0.04)));
  }
  console.log(`f=${f.toFixed(2)} Hz  peak end-to-end ${(amp * 100).toFixed(1)} cm`);
}
