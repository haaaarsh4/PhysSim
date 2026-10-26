import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';
const c0 = Math.sqrt(9.81 * 0.576);
for (const clampv of [0.25, 0.05, 0]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.001, density: 1000, pressureIterations: 200, pressureTolerance: 1e-6, volumeCorrectionClamp: clampv });
  FLUID_LABS.find((l) => l.id === 'dam').build(s);
  const front = () => { for (let i = s.nx - 1; i >= 0; i--) for (let j = 0; j < s.ny; j++) if (s.phi[j * s.nx + i] < 0) return (i + 0.5) * s.dx; return 0; };
  const dt = 1 / 120;
  const marks = [];
  for (let n = 0; n < Math.round(0.2 / dt); n++) { s.step(dt); if (Math.abs(s.time - 0.1) < dt / 2) marks.push(front().toFixed(3)); }
  console.log(`clamp=${clampv}dx front@0.1=${marks[0]} front@0.2=${front().toFixed(3)} (ritter dist ${(2*c0*0.2).toFixed(2)}) vol=${s.volume().toFixed(4)} target=${s.targetVolume.toFixed(4)}`);
}
