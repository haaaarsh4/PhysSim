import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS } from "../frontend/fluids_labs.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
FLUID_LABS.find(l => l.id === "impact").build(s);
s.captureVolume();
const liquid = () => { let n = 0; for (let k = 0; k < s.phi.length; k++) if (s.phi[k] < 0) n++; return n; };
for (let n = 0; n < 120 * 0.5; n++) {
  s.step(1 / 120);
  if (s.time > 0.28) {
    let iv = 0, imax = 0;
    for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
      if (s.phi[j*s.nx+i] >= 0) continue;
      const v = s.v[j*s.nx+i];
      iv += v; imax = Math.max(imax, Math.abs(v));
    }
    console.log(`t=${s.time.toFixed(3)} U=${s.maxSpeed().toFixed(3)} sumV=${iv.toFixed(2)} maxV=${imax.toFixed(2)} liquid=${liquid()} vol=${s.volume().toFixed(4)}`);
  }
}
