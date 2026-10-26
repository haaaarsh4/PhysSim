import { LiquidSolver } from "./solver_cut.mjs";
import { FLUID_LABS } from "../frontend/fluids_labs.js";

/* A first mode of the pool: set the surface to a tilted line (the n=1 slosh
   mode), let it go, read the wall-to-wall difference. */
function sloshFreeDecay() {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 150, pressureTolerance: 1e-6,
  });
  FLUID_LABS.find((l) => l.id === "slosh").build(s);
  const h0 = s.height * 0.42;
  const amp = 0.05;
  for (let j = 0; j < s.ny; j++) {
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx, y = (j + 0.5) * s.dx;
      const surf = h0 + amp * Math.cos((Math.PI * x) / s.width);
      s.phi[j * s.nx + i] = Math.max(-s.band, Math.min(s.band, y - surf));
    }
  }
  s.captureVolume();
  const dt = 1 / 480;
  const ts = [], ds = [];
  for (let n = 0; n < Math.round(4 / dt); n++) {
    s.step(dt);
    if (n % 4) continue;
    ts.push(s.time);
    ds.push(s.waterlineAt(0.03) - s.waterlineAt(s.width - 0.03));
  }
  const cross = [];
  for (let i = 1; i < ds.length; i++) if (ds[i - 1] > 0 && ds[i] <= 0) cross.push(ts[i]);
  const T = cross.length > 1 ? (2 * (cross.at(-1) - cross[0])) / (cross.length - 1) : NaN;
  const H = h0, k = Math.PI / s.width;
  const theory = (2 * Math.PI) / Math.sqrt(9.81 * k * Math.tanh(k * H));
  console.log(`slosh free decay: T=${T.toFixed(3)} vs ${theory.toFixed(3)} (${((T / theory - 1) * 100).toFixed(0)}%)  n=${cross.length}  ` +
    `d(t): ${ds.filter((_, i) => i % 10 === 0).map((v) => (v * 100).toFixed(1)).join(" ")}`);
}

/* The ripple lab as built, against its own quoted period. */
function rippleLab() {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 0.4, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 150, pressureTolerance: 1e-6,
  });
  FLUID_LABS.find((l) => l.id === "ripple").build(s);
  const dt = 1 / 480;
  const h0 = s.height * 0.42;
  const ts = [], as = [];
  for (let n = 0; n < Math.round(5 / dt); n++) {
    s.step(dt);
    if (n % 4) continue;
    let re = 0;
    const kk = (2 * Math.PI * 4) / s.width;
    for (let i = 0; i < s.nx; i++) re += (s.waterlineAt((i + 0.5) * s.dx) - h0) * Math.cos(kk * (i + 0.5) * s.dx);
    ts.push(s.time);
    as.push((2 / s.nx) * re);
  }
  const peaks = [];
  for (let i = 2; i < as.length - 2; i++) if (as[i] > as[i - 1] && as[i] >= as[i + 1] && as[i] > 0.002) peaks.push([ts[i], as[i]]);
  const per = peaks.slice(1).map((q, i) => q[0] - peaks[i][0]).filter((v) => v > 0.5);
  const T = per.reduce((a, b) => a + b, 0) / Math.max(1, per.length);
  console.log(`ripple lab: T=${T.toFixed(3)} [${per.map((v) => v.toFixed(2)).join(" ")}] vs 2.088  n=${peaks.length}  ` +
    `a(t): ${as.filter((_, i) => i % 24 === 0).map((v) => (v * 1000).toFixed(1)).join(" ")}`);
}

sloshFreeDecay();
rippleLab();
