import { LiquidSolver } from '../simulation/liquid_solver.js';
import { FLUID_LABS } from '../frontend/fluids_labs.js';

const c0 = Math.sqrt(9.81 * 0.576);

function trial({ sigma = 0.072, mu = 0.001, dt = 1 / 120, nx = 128, ny = 96, iters = 60, label }) {
  const s = new LiquidSolver({ width: 1.2, nx, ny, gravity: 9.81, surfaceTension: sigma, viscosity: mu, density: 1000, pressureIterations: iters, pressureTolerance: 1e-4 });
  FLUID_LABS.find((l) => l.id === 'dam').build(s);
  const front = () => { for (let i = s.nx - 1; i >= 0; i--) for (let j = 0; j < s.ny; j++) if (s.phi[j * s.nx + i] < 0) return (i + 0.5) * s.dx; return 0; };
  const mark = [];
  for (let n = 0; n < Math.round(0.1 / dt); n++) {
    s.step(dt);
  }
  let umax = 0, vmax = 0;
  for (const q of s.u) umax = Math.max(umax, Math.abs(q));
  for (const q of s.v) vmax = Math.max(vmax, Math.abs(q));
  const f = front() - 0.384;
  console.log(`${label.padEnd(28)} front ${f.toFixed(3)} m  (ritter ${(2 * c0 * s.time).toFixed(3)})  u ${umax.toFixed(2)}  v ${vmax.toFixed(2)}  vol ${s.volume().toFixed(4)}  iters ${s.lastSolve.iterations}`);
}

trial({ label: 'as shipped' });
trial({ sigma: 0, label: 'no surface tension' });
trial({ mu: 0, label: 'inviscid' });
trial({ sigma: 0, mu: 0, label: 'inviscid, no sigma' });
trial({ dt: 1 / 480, label: 'dt 1/480' });
trial({ dt: 1 / 960, label: 'dt 1/960' });
trial({ nx: 64, ny: 48, dt: 1 / 120, label: '64x48' });
trial({ sigma: 0, mu: 0, dt: 1 / 960, label: 'inviscid, dt 1/960' });
