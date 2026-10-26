import { LiquidSolver } from "../simulation/liquid_solver.js";
function go(sigma, g = 0.4, secs = 8) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: g, surfaceTension: sigma,
    viscosity: 0.001, density: 1000, pressureIterations: 120, pressureTolerance: 1e-5 });
  const k = (2 * Math.PI * 4) / s.width, h0 = s.height * 0.42;
  for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
    const x = (i + 0.5) * s.dx, y = (j + 0.5) * s.dx;
    s.phi[j*s.nx+i] = Math.max(-s.band, Math.min(s.band, y - (h0 + 0.0108 * Math.cos(k*x))));
  }
  s.captureVolume();
  const ts = [], as = [];
  const dt = 1/480;
  for (let n = 0; n < Math.round(secs/dt); n++) {
    s.step(dt);
    if (n % 8) continue;
    let re = 0;
    for (let i = 0; i < s.nx; i++) re += (s.waterlineAt((i+0.5)*s.dx) - h0) * Math.cos(k*(i+0.5)*s.dx);
    ts.push(s.time); as.push((2/s.nx)*re);
  }
  const peaks = [];
  for (let i = 2; i < as.length-2; i++) if (as[i] > as[i-1] && as[i] >= as[i+1] && as[i] > 0.0015) peaks.push([ts[i], as[i]]);
  const per = peaks.slice(1).map((q,i) => q[0]-peaks[i][0]).filter(v => v > 0.3);
  const T = per.reduce((a,b)=>a+b,0)/Math.max(1,per.length);
  console.log(`sigma=${sigma}: periods [${per.map(v=>v.toFixed(2)).join(" ")}] mean ${T.toFixed(2)}  theory ${((2*Math.PI)/Math.sqrt(g*k+(sigma*k**3)/1000)).toFixed(2)}  amps ${peaks.map(p=>(p[1]*1000).toFixed(1)).join(" ")}`);
}
go(0); go(0.072);
