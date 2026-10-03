import { MechSystem } from "../simulation/mech_system.js";
import { MECH_SYSTEMS } from "../frontend/mech_systems.js";

const SPACING = 0.84;
const POST_W = 0.06;
const MARGIN = 0.10;
const blockHalf = (m) => Math.max(0.14, Math.min(0.46, 0.24 * Math.pow(Math.max(m, 1e-6), 1 / 6))) / 2;

for (const preset of MECH_SYSTEMS) {
  const spec = preset.spec;
  const s = new MechSystem(spec);
  const inputs = s.inputs();
  const active = s.activeInputs;
  const held = inputs.map((i) => {
    const idx = [];
    for (let k = 0; k < i.b0.length; k++) if (Math.abs(i.b0[k]) > 1e-12) idx.push(k);
    return `${i.kind}[${idx.join(",")}]=${idx.map((k) => i.b0[k]).join(",")}`;
  });

  const steps = Math.round(60 / s.dt);
  const peak = new Array(s.n).fill(0);
  for (let k = 0; k < steps; k++) {
    s.step();
    for (let i = 0; i < s.n; i++) peak[i] = Math.max(peak[i], Math.abs(s.state[i]));
  }
  const half = Math.max(...spec.masses.map((m) => blockHalf(m.m)));
  const room = SPACING * 0.72 - POST_W / 2 - MARGIN - half;
  const worst = Math.max(...peak);

  console.log(
    preset.id.padEnd(17),
    `excit=${spec.excitation.padEnd(5)}`,
    `drive.m=${spec.drive.mass} out=m${spec.output + 1}`,
    `act=${active.length}:${active.map((a) => a.kind).join("+")}`,
    `peaks=[${peak.map((v) => v.toFixed(3)).join(" ")}]`,
    `room=${room.toFixed(3)} ratio=${(worst / room).toFixed(3)} ${worst / room > 0.7 ? "  <-- OVER" : ""}`,
    `| ${held.join("  ")}`,
  );
}
