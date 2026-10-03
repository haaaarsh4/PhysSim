import { MechSystem } from "../simulation/mech_system.js";
import { MECH_LABS } from "../frontend/mech_labs.js";

const SPACING = 0.84;
const POST_W = 0.06;
const MARGIN = 0.10;
const blockHalf = (m) => Math.max(0.14, Math.min(0.46, 0.24 * Math.pow(Math.max(m, 1e-6), 1 / 6))) / 2;

console.log("lab".padEnd(18), "t".padStart(5), "peak".padStart(8), "room".padStart(7), "ratio".padStart(6), "  drawnScale");
for (const lab of MECH_LABS) {
  const s = new MechSystem(lab.spec);
  const seconds = Math.max(lab.hold ?? 20, 30);
  const steps = Math.round(seconds / s.dt);
  const peak = new Array(s.n).fill(0);
  for (let k = 0; k < steps; k++) {
    s.step();
    for (let i = 0; i < s.n; i++) peak[i] = Math.max(peak[i], Math.abs(s.state[i]));
  }
  const half = Math.max(...lab.spec.masses.map((m) => blockHalf(m.m)));
  const room = SPACING * 0.72 - POST_W / 2 - MARGIN - half;
  const worst = Math.max(...peak);
  const scale = worst > room ? room / worst : 1;
  const o = s.observe();
  console.log(
    lab.id.padEnd(18),
    String(seconds).padStart(5),
    worst.toFixed(3).padStart(8),
    room.toFixed(3).padStart(7),
    (worst / room).toFixed(2).padStart(6),
    "  " + scale.toFixed(3),
    scale < 1 ? "  <-- picture must shrink" : "",
    " | modes " + s.modes.map((m) => m.frequency.toFixed(3)).join(" ") + " Hz",
    "| x0 " + o.x.map((v) => v.toFixed(3)).join(" "),
  );
}

/* The friction pair's own transfer function, against the formula its aim quotes. */
const friction = MECH_LABS.find((l) => l.id === "friction-pair");
const sys = new MechSystem(friction.spec);
const t = sys.transfer("force", 0);
console.log("\nfriction pair: H(s) numerator", t.num.map((v) => Number(v.toPrecision(4)).toString()).join(", "),
  "\n                denominator", t.den.map((v) => Number(v.toPrecision(4)).toString()).join(", "));
const dc = sys.frequencyResponse("force", 0, 0.4 * 2 * Math.PI);
console.log("               |H| at 0.4 Hz =", dc.magnitude.toPrecision(4), "phase", (dc.phase * 180 / Math.PI).toFixed(1));

const qc = MECH_LABS.find((l) => l.id === "quarter-car");
const q = new MechSystem(qc.spec);
console.log("\nquarter car modes:", q.modes.map((m) => `${(m.frequency).toFixed(3)} Hz [${m.shape.length}]`).join(", "));
