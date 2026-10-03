import { MechSystem } from "../simulation/mech_system.js";
import { MECH_SYSTEMS } from "../frontend/mech_systems.js";

const SPACING = 0.84;
const POST_W = 0.06;
const room = SPACING * 0.72 - POST_W / 2 - 0.10 - 0.12;   // the worst case, blockHalf 0.12 + margin

for (const preset of MECH_SYSTEMS) {
  const s = new MechSystem({ ...preset.spec });
  let peak = 0, peakAt = 0;
  const seconds = 40;
  const steps = Math.round(seconds / s.dt);
  for (let k = 0; k < steps; k++) {
    s.step();
    for (let i = 0; i < s.n; i++) {
      const v = Math.abs(s.state[i]);
      if (v > peak) { peak = v; peakAt = s.time; }
    }
  }
  const ratio = peak / room;
  console.log(
    preset.id.padEnd(18),
    "n=" + s.n,
    "peak=" + peak.toFixed(3).padStart(8) + " m",
    "room=" + room.toFixed(3),
    "ratio=" + ratio.toFixed(2).padStart(6),
    ratio > 1 ? "  <-- TOO BIG for the bench at 1x" : "",
    " at t=" + peakAt.toFixed(1) + "s",
  );
}
