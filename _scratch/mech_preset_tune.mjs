import { MechSystem } from "../simulation/mech_system.js";
import { MECH_SYSTEMS } from "../frontend/mech_systems.js";

const BLOCK_UNIT = 0.24, BLOCK_MIN = 0.14, BLOCK_MAX = 0.46;
const SPACING = 0.84, POST_W = 0.06, MARGIN = 0.10;
const half = (m) => Math.max(BLOCK_MIN, Math.min(BLOCK_MAX, BLOCK_UNIT * Math.pow(Math.max(m, 1e-6), 1 / 6))) / 2;

for (const preset of MECH_SYSTEMS) {
  const s = new MechSystem({ ...preset.spec });
  // the mass the drive acts on (or the output for a base drive), for the room
  const driven = preset.spec.drive.mass ?? 0;
  const room = SPACING * 0.72 - POST_W / 2 - MARGIN - half(preset.spec.masses[driven].m);
  let peak = 0, peakAt = 0;
  const steps = Math.round(60 / s.dt);
  for (let k = 0; k < steps; k++) {
    s.step();
    for (let i = 0; i < s.n; i++) {
      const v = Math.abs(s.state[i]);
      if (v > peak) { peak = v; peakAt = s.time; }
    }
  }
  const target = 0.6 * room;
  const factor = target / peak;
  const isBase = preset.spec.excitation === "base";
  const amp = isBase ? preset.spec.base.amplitude : preset.spec.drive.amplitude;
  console.log(
    preset.id.padEnd(17),
    "peak=" + peak.toFixed(3).padStart(7),
    "room=" + room.toFixed(3),
    "peak/room=" + (peak / room).toFixed(2).padStart(5),
    "amp=" + String(amp).padStart(6),
    "-> suggest amp=" + (amp * factor).toPrecision(3),
    "(target peak " + target.toFixed(3) + " at t=" + peakAt.toFixed(0) + "s)",
  );
}
