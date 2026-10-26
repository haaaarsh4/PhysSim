import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
for (const [nx, ny, dt] of [[128, 96, 1/240], [256, 192, 1/480]]) {
  const s = new LiquidSolver({ width: 1.2, nx, ny, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 120, pressureTolerance: 1e-5 });
  FLUID_LABS.find(l => l.id === "impact").build(s);
  s.captureVolume();
  const rows = [];
  let next = 0.1;
  for (let n = 0; n < Math.round(0.9 / dt); n++) {
    s.step(dt);
    if (s.time >= next) {
      let crown = -1;
      for (let i = 0; i < s.nx; i++) crown = Math.max(crown, s.waterlineAt((i+0.5)*s.dx));
      rows.push(`${next.toFixed(1)}s KE=${s.kineticEnergy().toFixed(2)} U=${s.maxSpeed().toFixed(2)} surf=${crown.toFixed(3)}`);
      next += 0.15;
    }
  }
  console.log(`${nx}x${ny} dt=1/${Math.round(1/dt)}\n  ` + rows.join("\n  "));
}
