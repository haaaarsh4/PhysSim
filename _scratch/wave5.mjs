import { LiquidSolver } from "./solver_cut.mjs";

function decay({ dt, killAir = true, redistanceEvery = 3, label }) {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0, viscosity: 0.001,
    density: 1000, pressureIterations: 120, pressureTolerance: 1e-6, redistanceEvery,
  });
  if (!killAir) s.killAir = () => {};
  const k = (2 * Math.PI * 4) / s.width;
  const h0 = s.height * 0.42;
  for (let j = 0; j < s.ny; j++) {
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx, y = (j + 0.5) * s.dx;
      s.phi[j * s.nx + i] = Math.max(-s.band, Math.min(s.band, y - (h0 + 0.011 * Math.cos(k * x))));
    }
  }
  s.captureVolume();
  const surf = () => {
    const h = [];
    for (let i = 0; i < s.nx; i++) {
      let a = 0;
      for (let j = 0; j < s.ny; j++) a += Math.max(0, Math.min(1, 0.5 - s.phi[j * s.nx + i] / s.dx));
      h.push(a * s.dx);
    }
    let re = 0;
    for (let i = 0; i < s.nx; i++) re += (h[i] - h0) * Math.cos(k * (i + 0.5) * s.dx);
    return (2 / s.nx) * re;
  };
  let peak = 0, n = 0;
  const amps = [];
  for (let t = 0; t < 1.0 - 1e-9; t += dt, n++) {
    s.step(dt);
    const a = surf();
    if (n % 12 === 0) amps.push((a * 1000).toFixed(1));
    peak = Math.max(peak, Math.abs(a));
  }
  console.log(`${label.padEnd(24)} peak ${(peak * 1000).toFixed(1)}mm  a: ${amps.join(" ")}`);
}

decay({ dt: 1 / 60, label: "dt=1/60" });
decay({ dt: 1 / 240, label: "dt=1/240" });
decay({ dt: 1 / 960, label: "dt=1/960" });
decay({ dt: 1 / 240, killAir: false, label: "dt=1/240, keep air vel" });
decay({ dt: 1 / 240, redistanceEvery: 1000, label: "dt=1/240, no redistance" });
