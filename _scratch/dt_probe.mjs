import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';
const c0 = Math.sqrt(9.81 * 0.576);
for (const [nx, ny, dts] of [[128, 96, 1/120], [128, 96, 1/480], [96, 72, 1/240], [64, 48, 1/240], [64, 48, 1/120]]) {
  const s = new LiquidSolver({ width: 1.2, nx, ny, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000, pressureIterations: 120, pressureTolerance: 1e-6 });
  FLUID_LABS.find((l) => l.id === 'dam').build(s);
  const front = () => { for (let i = s.nx - 1; i >= 0; i--) for (let j = 0; j < s.ny; j++) if (s.phi[j * s.nx + i] < 0) return (i + 0.5) * s.dx; return 0; };
  let n = 0;
  while (s.time < 0.2 - 1e-9) { s.step(dts); n++; }
  console.log(`${nx}x${ny} dt=${dts.toFixed(5)} steps=${n} front=${front().toFixed(3)} travelled=${(front()-0.384).toFixed(3)} ritter=${(2*c0*0.2).toFixed(2)} ratio=${((front()-0.384)/(2*c0*0.2)).toFixed(2)} vol=${s.volume().toFixed(4)}`);
}
