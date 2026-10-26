import { LiquidSolver } from "./solver_cut.mjs";

function run({ g, sigma, amp = 0.0108, secs = 4, label }) {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: g, surfaceTension: sigma,
    viscosity: 0.001, density: 1000, pressureIterations: 150, pressureTolerance: 1e-6,
  });
  const k = (2 * Math.PI * 4) / s.width;
  const h0 = s.height * 0.42;
  for (let j = 0; j < s.ny; j++) {
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx, y = (j + 0.5) * s.dx;
      s.phi[j * s.nx + i] = Math.max(-s.band, Math.min(s.band, y - (h0 + amp * Math.cos(k * x))));
    }
  }
  s.captureVolume();
  const dt = 1 / 480;
  const ts = [], as = [];
  for (let n = 0; n < Math.round(secs / dt); n++) {
    s.step(dt);
    if (n % 2) continue;
    let re = 0;
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx;
      re += (s.waterlineAt(x) - h0) * Math.cos(k * x);
    }
    ts.push(s.time); as.push((2 / s.nx) * re);
  }
  const cross = [];
  for (let i = 1; i < as.length; i++) if (as[i - 1] > 0 && as[i] <= 0) cross.push(ts[i]);
  const T = cross.length > 1 ? (2 * (cross.at(-1) - cross[0])) / (cross.length - 1) : NaN;
  const wa = 2 * Math.PI / T;
  const theory = Math.sqrt(g * k + (sigma * k ** 3) / 1000);
  console.log(`${label.padEnd(22)} T=${Number.isFinite(T) ? T.toFixed(3) : "---"} (ω=${Number.isFinite(wa) ? wa.toFixed(2) : "--"}) ` +
    `theory T=${((2 * Math.PI) / theory).toFixed(3)} (ω=${theory.toFixed(2)})  ` +
    `gravity ω=${Math.sqrt(g * k).toFixed(2)}  capillary ω=${Math.sqrt((sigma * k ** 3) / 1000).toFixed(2)}`);
}

run({ g: 0.4, sigma: 0, label: "g=0.4, no tension" });
run({ g: 0.4, sigma: 0.072, label: "g=0.4, water" });
run({ g: 0, sigma: 0.072, label: "g=0, pure capillary" });
run({ g: 9.81, sigma: 0, label: "g=9.81, no tension" });
