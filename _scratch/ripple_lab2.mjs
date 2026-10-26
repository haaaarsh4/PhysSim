import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
for (const dt of [1/240]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 0.4, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
  FLUID_LABS.find(l => l.id === "ripple").build(s);
  s.captureVolume();
  const h0 = s.height * 0.42, k = (2*Math.PI*4)/s.width;
  const ts = [], as = [];
  for (let n = 0; n < Math.round(8/dt); n++) {
    s.step(dt);
    if (n % 8) continue;
    let re = 0;
    for (let i = 0; i < s.nx; i++) re += (s.waterlineAt((i+0.5)*s.dx) - h0) * Math.cos(k*(i+0.5)*s.dx);
    ts.push(s.time); as.push((2/s.nx)*re);
  }
  const peaks = [];
  for (let i = 2; i < as.length-2; i++) if (as[i] > as[i-1] && as[i] >= as[i+1] && as[i] > 0.004) peaks.push([ts[i], as[i]]);
  console.log(`peaks ${peaks.map(p => `${p[0].toFixed(2)}s:${(p[1]*1000).toFixed(1)}mm`).join(" ")}`);
  console.log(`KE end ${s.kineticEnergy().toFixed(3)}  surface spread ${((Math.max(...Array.from({length:24},(_,i)=>s.waterlineAt((i+0.5)/24*s.width)))-Math.min(...Array.from({length:24},(_,i)=>s.waterlineAt((i+0.5)/24*s.width))))*1000).toFixed(1)} mm`);
}
