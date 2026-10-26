import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
function go(opts, label) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 0.4, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4, ...opts });
  FLUID_LABS.find(l => l.id === "ripple").build(s);
  s.captureVolume();
  const h0 = s.height * 0.42, k = (2*Math.PI*4)/s.width;
  const out = [];
  let next = 0.5;
  for (let n = 0; n < Math.round(6 / (1/240)); n++) {
    s.step(1/240);
    if (s.time >= next) {
      let re = 0;
      for (let i = 0; i < s.nx; i++) re += (s.waterlineAt((i+0.5)*s.dx) - h0) * Math.cos(k*(i+0.5)*s.dx);
      out.push(`${next.toFixed(1)}:${((2/s.nx)*re*1000).toFixed(1)}`);
      next += 0.5;
    }
  }
  console.log(`${label.padEnd(34)} ${out.join(" ")} mm`);
}
go({}, "default (w .5 band 2.5)");
go({ filterWeight: 0.25 }, "w .25");
go({ filterWeight: 0.25, filterBand: 2 }, "w .25 band 2");
go({ redistanceEvery: 8 }, "redist 8");
go({ filterWeight: 0.25, filterBand: 2, redistanceEvery: 8 }, "all");
go({ filterWeight: 0 }, "filter off");
