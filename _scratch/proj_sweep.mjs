import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
function go(iters, tol, label) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: iters, pressureTolerance: tol });
  FLUID_LABS.find(l => l.id === "dam").build(s);
  s.captureVolume();
  let worst = 0, peak = 0, t0 = performance.now();
  for (let n = 0; n < 240; n++) { s.step(1/240); worst = Math.max(worst, s.maxDivergence()); peak = Math.max(peak, s.maxSpeed()); }
  const ms = (performance.now() - t0) / 240;
  console.log(`${label.padEnd(20)} ${ms.toFixed(2)} ms/step  div=${worst.toFixed(2)} 1/s (${(worst/(peak/s.dx)*100).toFixed(1)}% of strain)  U=${peak.toFixed(2)}`);
}
go(90, 1e-4, "90 / 1e-4");
go(45, 1e-3, "45 / 1e-3");
go(30, 2e-3, "30 / 2e-3");
go(60, 1e-3, "60 / 1e-3");
