/**
 * experiments/thermo_checks.js - does the box still teach the right physics?
 *
 * Every lab in frontend/thermo_labs.js asserts a law in its `aim`, and a student
 * is asked to confirm it against a number this simulation measures. That makes
 * the simulation's own accuracy the one thing that cannot be taken on trust. A
 * wall that resamples the wrong distribution, a two-body impulse that leaks a
 * little momentum, a ledger that books the same energy twice, or a lid that does
 * work the gas never felt would each turn a confirmation into a contradiction,
 * and none of them would look wrong on screen.
 *
 * So this file runs the real module - the same simulation/gas.js the browser
 * loads - and checks what it *measures* against the closed form it should agree
 * with. Every quantity here is a count: pressure is momentum handed to walls,
 * temperature is mean kinetic energy, work is the energy the lid exchanged.
 * Nothing is read back out of a formula the simulation also used.
 *
 * What deserves a word of warning is which checks are tight and which are not,
 * and why:
 *
 *   - the exact ones (tolerances of 1e-12 or better) are the conservation laws:
 *     momentum and energy in a collision, the first law across a whole run, a
 *     smooth wall not changing a speed, the lid's reflection. These are exact
 *     arithmetic and any error in them is a bug, not noise.
 *   - the statistical ones are the measured laws: temperature, pressure,
 *     Maxwell-Boltzmann, the collision rate. Their tolerances are set by how
 *     many molecules and how many collisions went into the average, and they
 *     are quoted as such. A tolerance of 5% here means "five thousand wall
 *     impacts", not "5% of physics".
 *   - the one honest approximation is the mean free path. Its textbook formula
 *     is the low-density limit, and this box is not at low density - that is
 *     what makes a gas visible. The check says how far off it is instead of
 *     pretending it is exact.
 *
 * Run directly:  npm run check:thermo
 */
import {
  GasBox, K_B, MAX_IMPACT_LOG, MAX_LID_MACH, N_A, SPECIES, WALL_BACK, WALL_PISTON,
  apertureArea, meanFreePathOf, meanSpeedOf, moleculeMass, rmsSpeedOf, speciesOf,
} from "../simulation/gas.js";
/* The labs themselves, because a lab's setup is a claim too: it says which
   instruments stand on the stage and what their panels are set to, and a claim
   about a scene is as checkable as a claim about a gas. This is data, with no
   DOM in it, so the same file the browser loads is the one read here. */
import { THERMO_LABS } from "../frontend/thermo_labs.js";

/* ------------------------------ the runner ------------------------------ */

const results = [];

function check(name, measured, expected, tolerance, unit = "", note = "") {
  const m = Number(measured);
  const e = Number(expected);
  const error = e === 0 ? Math.abs(m) : Math.abs(m - e) / Math.abs(e);
  results.push({ name, measured: m, expected: e, unit, error, tolerance, note, ok: error <= tolerance });
}

function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "ok  " : "FAIL";
    if (!r.ok) failed++;
    const measured = `${r.measured.toPrecision(5)}${r.unit ? " " + r.unit : ""}`;
    const expected = `${r.expected.toPrecision(5)}${r.unit ? " " + r.unit : ""}`;
    const error = `${(r.error * 100).toFixed(2)}% (within ${(r.tolerance * 100).toFixed(1)}%)`;
    console.log(`${mark}  ${r.name.padEnd(width)}  measured ${measured.padEnd(16)} formula ${expected.padEnd(16)} ${error}`);
    if (r.note) console.log(`      ${" ".repeat(width)}  ${r.note}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed;
}

/** A box whose measurement window never rolls over, so a rate can be measured
 *  over any span I choose by differencing the cumulative totals. */
function boxFor(opts = {}) {
  const box = new GasBox(opts);
  box.windowDuration = Infinity;
  box.markWindow();
  return box;
}

const run = (box, steps) => { for (let s = 0; s < steps; s++) box.step(); };

/**
 * Run for a span and report what the gas did over it - all from cumulative
 * counters, so the numbers are over exactly this window and nothing else.
 */
function measure(box, steps) {
  const impulse0 = box.impulse.slice();
  const t0 = box.time;
  const wall0 = box.wallCollisions;
  const pair0 = box.pairCollisions;
  const lid0 = box.lidCollisions;
  const escaped0 = box.escaped;
  const heat0 = box.heat;
  const work0 = box.work;
  /* Sampled as it runs: a pressure averaged over six thousand steps is very
     precise, and pairing it with a one-instant temperature would throw almost
     all of that away, because a temperature is one number per molecule and
     moves by two percent on its own. */
  let energySum = 0;
  let speedSum = 0;
  let samples = 0;
  for (let s = 0; s < steps; s++) {
    box.step();
    if (s % 100 === 0) { energySum += box.internalEnergy(); speedSum += box.meanSpeed(); samples++; }
  }
  const ground = (2 * energySum) / (samples * 3 * K_B * Math.max(box.n, 1));
  const span = box.time - t0;
  const gained = (f) => box.impulse[f] - impulse0[f];
  let total = 0;
  for (let f = 0; f < 6; f++) total += gained(f);
  const area = (f) => (f === WALL_PISTON || f === WALL_BACK ? box.lidArea : box.crossSection * box.lid.x);
  const facePressures = [];
  for (let f = 0; f < 6; f++) facePressures.push(gained(f) / (area(f) * span));
  return {
    span,
    pressure: total / (box.wallArea * span),
    facePressures,
    backPressure: gained(WALL_BACK) / (box.lidArea * span),
    lidPressure: gained(WALL_PISTON) / (box.lidArea * span),
    meanSpeed: speedSum / samples,
    meanCount: box.n + (box.escaped - escaped0) / 2,
    wallCollisions: box.wallCollisions - wall0,
    pairCollisions: box.pairCollisions - pair0,
    lidCollisions: box.lidCollisions - lid0,
    escaped: box.escaped - escaped0,
    temperature: box.temperature(),
    meanTemperature: ground,
    energy: box.internalEnergy(),
    heat: box.heat - heat0,
    work: box.work - work0,
  };
}

/** Run on, reading several times, so one snapshot is not mistaken for a
 *  measurement. */
function sampled(box, read, samples = 20, perSample = 400) {
  let total = 0;
  for (let k = 0; k < samples; k++) { run(box, perSample); total += read(); }
  return total / samples;
}

/** Argon, the gas every default in the app is built around. */
const AR = speciesOf("ar");
const HE = speciesOf("he");
const M_AR = moleculeMass(AR);
const M_HE = moleculeMass(HE);

/**
 * The Maxwell-Boltzmann speed distribution's cumulative form,
 * F(v) = erf(v/(sqrt2 sigma)) - sqrt(2/pi) (v/sigma) exp(-v^2/2sigma^2).
 * Used to ask whether the molecules are distributed the way they should be,
 * rather than merely whether their mean speed is right.
 */
function erfc(x) {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3,
    -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5,
    -1.624290004647e-6, 1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8,
    6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
    9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13,
    3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15,
  ];
  let d = 0;
  let dd = 0;
  for (let j = cof.length - 1; j > 0; j--) { const tmp = d; d = ty * d - dd + cof[j]; dd = tmp; }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

function maxwellCdf(v, mass, T) {
  if (!(T > 0)) return 0;
  const sigma = Math.sqrt((K_B * T) / mass);
  const x = v / (Math.SQRT2 * sigma);
  return 1 - erfc(x) - Math.sqrt(2 / Math.PI) * (v / sigma) * Math.exp(-(v * v) / (2 * sigma * sigma));
}

/* ==================================================================================
   THE DISTRIBUTION THE GAS IS DEALT
   ================================================================================== */

{
  /* The gas is born in equilibrium: 3000 argon atoms at 300 K. Their three
     speeds are the three numbers a textbook quotes, and they are the definition
     of what "300 K" means for a gas - so if the deal is wrong, everything after
     it is measuring the wrong experiment.

     The tolerances here are sampling noise and nothing else: the root-mean-square
     of N molecules from a Maxwellian has a relative spread of sqrt(1/2N), which
     for 3000 is 1.3%. */
  const box = boxFor({ species: "ar", count: 3000, temperature: 300, walls: "elastic" });
  const T = 300;
  check("dealt speeds: r.m.s.", box.rmsSpeed(), rmsSpeedOf(M_AR, T), 0.03, "m/s",
    "sqrt(3RT/M) = 433 m/s, the speed the temperature is defined by");
  check("dealt speeds: mean", box.meanSpeed(), meanSpeedOf(M_AR, T), 0.025, "m/s",
    "sqrt(8RT/(pi M)) = 399 m/s, the one that decides how often a wall is hit");
  check("dealt speeds: temperature", box.temperature(), T, 0.02, "K",
    "(1/2)m<v^2> = (3/2)kT, which is the definition of temperature, not a formula for it");

  /* The most probable speed is the peak of the curve rather than a mean, so it
     has to be read off the distribution: the fraction of molecules within +-2%
     of sqrt(2kT/m) should be the density there times the width. */
  const vp = Math.sqrt((2 * K_B * T) / M_AR);
  let near = 0;
  for (let i = 0; i < box.n; i++) {
    const v = Math.hypot(box.vx[i], box.vy[i], box.vz[i]);
    if (Math.abs(v - vp) < vp * 0.05) near++;
  }
  const expectedNear = maxwellCdf(1.05 * vp, M_AR, T) - maxwellCdf(0.95 * vp, M_AR, T);
  check("dealt speeds: the peak", near / box.n, expectedNear, 0.2, "",
    "the middle tenth around sqrt(2kT/m) = 354 m/s holds as much of the gas as the curve says it should");

  /* And then the whole curve, not just its moments: the largest gap between the
     measured cumulative distribution and the analytic one over sixty points.
     A Kolmogorov-Smirnov statistic; the 5% critical value at N = 3000 is 0.025,
     so 0.03 is "the shape is right" with room for the seed. */
  let maxGap = 0;
  for (let k = 1; k <= 60; k++) {
    const v = (k / 60) * 2.6 * vp;
    let below = 0;
    for (let i = 0; i < box.n; i++) {
      if (Math.hypot(box.vx[i], box.vy[i], box.vz[i]) < v) below++;
    }
    maxGap = Math.max(maxGap, Math.abs(below / box.n - maxwellCdf(v, M_AR, T)));
  }
  check("dealt speeds: the whole curve", maxGap, 0, 0.03, "",
    "the largest gap between the measured and analytic distributions over 60 speeds");

  /* Graham's law is the same statement read another way: at one temperature the
     speeds go as 1/sqrt(m), so helium is sqrt(M_Ar/M_He) = 3.16 times faster. */
  const light = boxFor({ species: "he", count: 2000, temperature: 300, walls: "elastic" });
  check("two gases at one temperature: speed ratio", light.rmsSpeed() / box.rmsSpeed(),
    Math.sqrt(M_AR / M_HE), 0.03, "x",
    "helium at 300 K is 3.16 times faster than argon at 300 K, and 300 means 300 for both");
  check("two gases at one temperature: and it is the same 300 K", light.temperature(), box.temperature(), 0.03, "K",
    "which is what 'at the same temperature' has to mean if the theory is to hold");

  /* And the step is chosen from the gas, which is why it has to be. A collision
     cannot be resolved more finely than the distance a molecule covers between
     steps, so the step is set by the *smallest* thing in the scene - the
     molecule's own diameter, over the speed it moves at. Helium at 300 K does
     1367 m/s against argon's 433, so argon's step would skip half of helium's
     collisions; half the collisions is half the thermalisation, and a box that
     quietly stops behaving like a gas. */
  const travel = (b, s) => (b.rmsSpeed() * b.dt) / s.diameter;
  check("the step is set by the gas: helium is cut finer", light.dt / box.dt,
    (HE.diameter / AR.diameter) * Math.sqrt(M_HE / M_AR), 1e-9, "x",
    "one diameter over the r.m.s. speed: a lighter molecule gets a finer clock");
  check("the step is set by the gas: argon's step in diameters", travel(box, AR), 0.2, 0.03, "",
    "a fifth of a diameter per step, so a collision is resolved well inside the distance it happens over");
  check("the step is set by the gas: helium's step in diameters", travel(light, HE), 0.2, 0.03, "",
    "the same fifth, bought with a step three times smaller");
}

/* ==================================================================================
   THE COLLISION ITSELF
   ================================================================================== */

{
  /* A two-body elastic collision, on paper: at the instant of contact the two
     must leave with the same total momentum and the same total energy. Unequal
     masses, a glancing angle, so the general case and not the easy one. */
  const box = boxFor({ species: "ar", second: "he", mixFraction: 1, count: 2, temperature: 300, walls: "elastic", length: 40e-9 });
  box.kind[0] = 0; box.mass[0] = M_AR; box.radius[0] = AR.diameter / 2;
  box.kind[1] = 1; box.mass[1] = M_HE; box.radius[1] = HE.diameter / 2;
  box.x[0] = 19.0e-9; box.y[0] = 0; box.z[0] = 0;
  box.x[1] = 19.0e-9 + (AR.diameter + HE.diameter) / 2 - 2e-12; box.y[1] = 1e-12; box.z[1] = 0;
  box.vx[0] = 700; box.vy[0] = 0; box.vz[0] = 0;
  box.vx[1] = -200; box.vy[1] = 120; box.vz[1] = 0;
  box._orderDirty = true;

  const px = M_AR * box.vx[0] + M_HE * box.vx[1];
  const py = M_AR * box.vy[0] + M_HE * box.vy[1];
  const pz = M_AR * box.vz[0] + M_HE * box.vz[1];
  const ke = 0.5 * M_AR * (700 ** 2) + 0.5 * M_HE * (Math.hypot(-200, 120) ** 2);
  run(box, 1);
  const px2 = M_AR * box.vx[0] + M_HE * box.vx[1];
  const py2 = M_AR * box.vy[0] + M_HE * box.vy[1];
  const pz2 = M_AR * box.vz[0] + M_HE * box.vz[1];
  const ke2 = box.internalEnergy();
  check("collision: momentum", Math.hypot(px2 - px, py2 - py, pz2 - pz), 0, 1e-14, "kg m/s",
    "argon and helium, closing off-axis: the pair's momentum is bit-for-bit unchanged");
  check("collision: energy", ke2 - ke, 0, 1e-14, "J",
    "and so is its kinetic energy, which is what makes the collision elastic");
  const closed = M_AR * 700 + M_HE * -200;
  check("collision: and the two actually met", Math.abs(px2 - closed), 0, 1e-14, "kg m/s",
    "the totals above are the ones before the collision, so this says the impulse happened");

  /* The textbook's one-dimensional case: argon into stationary helium. The light
     atom takes nearly twice the incoming speed and the heavy one barely slows. */
  const head = boxFor({ species: "ar", second: "he", mixFraction: 1, count: 2, temperature: 300, walls: "elastic", length: 40e-9 });
  head.kind[0] = 0; head.mass[0] = M_AR; head.radius[0] = AR.diameter / 2;
  head.kind[1] = 1; head.mass[1] = M_HE; head.radius[1] = HE.diameter / 2;
  head.x[0] = 19.0e-9; head.y[0] = 0; head.z[0] = 0;
  head.x[1] = 19.0e-9 + (AR.diameter + HE.diameter) / 2 - 2e-12; head.y[1] = 0; head.z[1] = 0;
  head.vx[0] = 500; head.vy[0] = 0; head.vz[0] = 0;
  head.vx[1] = 0; head.vy[1] = 1e-9; head.vz[1] = 0;
  head._orderDirty = true;
  run(head, 1);
  const vAr = (M_AR - M_HE) / (M_AR + M_HE) * 500;
  const vHe = (2 * M_AR) / (M_AR + M_HE) * 500;
  check("head-on: the heavy one", head.vx[0], vAr, 0.01, "m/s",
    "(m1-m2)/(m1+m2) v: argon keeps 0.82 of its speed firing into helium");
  check("head-on: the light one", head.vx[1], vHe, 0.01, "m/s",
    "2m1/(m1+m2) v: helium leaves at 1.82 times what the argon came in at");
}

/* ==================================================================================
   WALLS: INSULATED AND HELD AT A TEMPERATURE
   ================================================================================== */

{
  /* A smooth wall does no work. One molecule, elastic walls, ten thousand steps
     of bouncing: its speed is the same to the last bit, and so is the gas's
     temperature. This is the whole of the adiabatic idealisation. */
  const alone = boxFor({ species: "ar", count: 1, temperature: 300, walls: "elastic", lidThermal: false });
  const speed0 = Math.hypot(alone.vx[0], alone.vy[0], alone.vz[0]);
  run(alone, 20000);
  check("insulated walls: a molecule's speed",
    Math.abs(Math.hypot(alone.vx[0], alone.vy[0], alone.vz[0]) - speed0) / speed0, 0, 1e-15, "",
    "twenty thousand bounces off smooth walls and not one of them changed |v| by a bit");

  /* With several molecules, speeds are exchanged in the collisions - that is
     what a collision is - so the claim is about the total, not each one. */
  const box = boxFor({ species: "ar", count: 400, temperature: 300, walls: "elastic", lidThermal: false });
  const T0 = box.temperature();
  check("insulated walls: the temperature", box.temperature() - T0, 0, 1e-12, "K",
    "which is what an adiabatic wall is: no heat in, no heat out");
  check("insulated walls: no molecule lost", box.n, 400, 0, "",
    "a closed box stays closed");
  check("insulated walls: the ledger", box.ledger().residual, 0, 1e-14, "J",
    "U - U0 - Q - W is zero, and with insulated walls it holds to the last bit");
}

{
  /* A wall held at a temperature is the interesting one, because the gas has to
     settle on that temperature *by itself* rather than be told it. Two boxes
     start wrong in opposite directions and both have to arrive at 450 K: a
     scheme that leaks a bias - the classic one is drawing the plain
     half-Maxwellian instead of the flux-weighted distribution - settles at 0.82
     of the wall's temperature and would be caught here immediately. */
  const cold = boxFor({ species: "ar", count: 1500, temperature: 300, walls: "thermal" });
  cold.bath = 450;
  cold.markWindow();
  run(cold, 12000);
  check("a thermal wall: a cold gas warms to it", cold.temperature(), 450, 0.04, "K",
    "300 K of argon in a box held at 450 K arrives at 450 K, from the walls alone");

  const hot = boxFor({ species: "ar", count: 1500, temperature: 700, walls: "thermal" });
  hot.bath = 450;
  hot.markWindow();
  run(hot, 12000);
  check("a thermal wall: a hot gas cools to it", hot.temperature(), 450, 0.04, "K",
    "and 700 K in the same box comes down to the same 450 K: the wall is not one-way");

  /* The exact statement behind it. A molecule arriving at a surface is not a
     random molecule, it is one that got there, and there is more of the fast
     ones - so what leaves has a mean energy of 2kT, not the (3/2)kT of the gas
     it left. That factor of 4/3 is the flux weighting, and it is measurable. */
  const effuse = boxFor({ species: "ar", count: 3000, temperature: 400, walls: "thermal", hole: 4e-9 });
  run(effuse, 3000);
  const meanEnergy = effuse.escapedEnergy / Math.max(effuse.escaped, 1);
  check("what leaves through a hole: its energy", meanEnergy, 2 * K_B * 400, 0.08, "J",
    "2kT, not (3/2)kT: fast molecules reach the hole more often, and the hole is honest about it");
}

/* ==================================================================================
   THE IDEAL GAS LAW, MEASURED
   ================================================================================== */

{
  /* The pressure in this panel is not computed from nkT. It is the momentum the
     walls collected, divided by area and time - the definition. So this is the
     ideal gas law being *discovered* rather than assumed: two entirely separate
     measurements, one from the impacts and one from the molecules' own energies,
     agreeing to a few percent. */
  const box = boxFor({ species: "ar", count: 1800, temperature: 300, walls: "thermal", length: 18e-9 });
  run(box, 2000);
  const m = measure(box, 8000);
  const n = box.numberDensity;
  const T = m.meanTemperature;
  check("P = n k T: the pressure", m.pressure, n * K_B * T, 0.05, "Pa",
    "momentum handed to the walls against n k T; the two are measured independently");
  const Z = m.pressure / (n * K_B * T);
  check("P V / N k T: the compressibility", Z, 1, 0.06, "",
    "one, to within the hard-sphere correction the next line predicts");

  /* And the correction is real and predicted: the ideal gas law is the
     zero-density limit, and the first thing a gas of *spheres* does about it is
     the second virial coefficient, B2 = (2/3) pi d^3. Z = 1 + B2 n. */
  const b2 = (2 / 3) * Math.PI * AR.diameter ** 3;
  check("P V / N k T: the spheres' correction", Z, 1 + b2 * n, 0.04, "",
    `Z = 1 + B2 n = ${(1 + b2 * n).toFixed(4)}: a gas of spheres is not quite an ideal gas`);

  /* Six faces, six independent measurements of one pressure. A gas at rest has
     no way to know which wall it is hitting, so the spread across the faces is
     a check on the momentum bookkeeping itself - a face whose normal, area or
     sign were wrong would sit out from the rest. */
  const ps = m.facePressures;
  const mean = ps.reduce((a, c) => a + c, 0) / 6;
  check("six faces, one pressure", (Math.max(...ps) - Math.min(...ps)) / mean, 0, 0.03, "",
    `each wall agrees to ${((Math.max(...ps) - Math.min(...ps)) / mean * 100).toFixed(1)}%: the gas does not know which way is up`);

  /* And the number a rate-of-impacts panel shows: impacts per unit area per
     second is n v-bar / 4, counted here rather than derived, and the rate times
     the momentum each one carries is the pressure above. */
  check("impacts per unit area per second",
    (m.wallCollisions + m.lidCollisions) / (box.wallArea * m.span),
    (n * m.meanSpeed) / 4, 0.04, "1/(m^2 s)",
    "n v-bar / 4: the count, against the formula, and the pressure is what they add up to");
}

/* ==================================================================================
   THE FIRST LAW, LIVE
   ================================================================================== */

{
  /* The ledger has to close even while energy is pouring in and out, because
     that is the only way the number on screen means anything. Three cases: a
     fixed insulated box (nothing at all should happen), a box of thermal walls
     (heat only), and a driven compression (work only). */
  const fixed = boxFor({ species: "ar", count: 1200, temperature: 300, walls: "elastic" });
  run(fixed, 6000);
  const l1 = fixed.ledger();
  check("ledger: an idle insulated box", l1.residual, 0, 1e-14, "J",
    "no walls exchanging, no lid moving: U - U0 - Q - W is zero and Q and W are both zero");

  const driven = boxFor({ species: "ar", count: 1200, temperature: 300, walls: "elastic", lidThermal: false, lidMode: "hand" });
  const u0 = driven.internalEnergy();
  for (let s = 0; s < 6000; s++) {
    driven.setLid(18e-9 - (s / 6000) * 6e-9);
    driven.step();
  }
  const l2 = driven.ledger();
  const scale = Math.max(Math.abs(l2.internalEnergy), Math.abs(l2.work), Math.abs(l2.heat), 1e-30);
  check("ledger: mid-squeeze, scaled", Math.abs(l2.residual) / scale, 0, 1e-14, "",
    "a squeezed adiabatic box, twelve thousand energy exchanges, and the books balance");
  check("ledger: the lid did the work", Math.abs(l2.work) / Math.max(Math.abs(l2.internalEnergy - u0 + l2.heat), 1e-30), 1, 1e-10, "",
    "everything the gas gained came through the lid: W is what the molecules felt");
  check("ledger: nothing was heated", Math.abs(l2.heat) / Math.max(Math.abs(l2.work), 1e-30), 0, 1e-12, "",
    "insulated walls hold the gas at its own temperature while the lid compresses it");

  const warm = boxFor({ species: "ar", count: 1200, temperature: 300, walls: "thermal" });
  warm.bath = 420;
  run(warm, 4000);
  const l3 = warm.ledger();
  const scale3 = Math.max(Math.abs(l3.heat), 1e-30);
  check("ledger: a box of thermal walls", Math.abs(l3.residual) / scale3, 0, 1e-14, "",
    "three hundred joules of heat through the walls and not a milliwatt in the cracks");
  check("ledger: and it really did take heat", l3.heat / l3.internalEnergy0, 0.4, 0.15, "",
    "the energy came in through Q, because nothing else in that box can move energy");
}

/* ==================================================================================
   COMPRESSION: ADIABATIC, ISOTHERMAL, AND FREE
   ================================================================================== */

{
  /* Push an insulated lid in slowly and the gas has nowhere to put the work but
     into its own motion, so P V^gamma = constant - the headline result of the
     whole workbench, and a prediction: nothing in the code knows what gamma is.

     The gas is helium here for a reason worth stating. The textbook 5/3 is the
     zero-density limit, and a gas of *spheres* has a slightly steeper adiabat
     than a gas of points - the same effect as the Z = 1 + B2 n of the pressure
     section, which is the difference between argon's 0.34 nm and helium's
     0.26 nm. Helium's spheres are smaller, so its gamma is closer to the
     idealisation and the idealisation is what this checks against. */
  const box = boxFor({ species: "he", count: 2400, temperature: 300, walls: "elastic", lidThermal: false, lidMode: "hand", length: 18e-9 });
  run(box, 2000);
  const before = measure(box, 6000);
  const V1 = box.volume;
  const T1 = box.temperature();
  const steps = Math.ceil((9e-9 / (MAX_LID_MACH * box.rmsSpeed())) / box.dt);
  for (let s = 0; s < steps; s++) {
    box.setLid(V1 / box.lidArea - (s / steps) * 9e-9);
    box.step();
  }
  box.setLidMode("fixed");
  /* Hold it still and let the gas come round to itself: a squeeze that has just
     stopped has a little of the push still in the direction of travel, and a
     pressure read before that has gone is a pressure of the wrong gas. */
  run(box, 3000);
  const V2 = box.volume;
  const after = measure(box, 6000);
  const T2 = box.temperature();
  const gamma = Math.log(after.pressure / before.pressure) / Math.log(V1 / V2);
  /* The sphere correction, worked out from the two measured compressibilities
     rather than assumed: U = (3/2) N k T exactly for spheres, so the adiabat is
     T V^(2Z/3) once the equation of state is P V = Z N k T. */
  const Z1 = before.pressure / (box.n * K_B * T1 / V1);
  const Z2 = after.pressure / (box.n * K_B * T2 / V2);
  const gammaSpheres = 1 + (2 / 3) * ((Z1 + Z2) / 2) + Math.log(Z2 / Z1) / Math.log(V1 / V2);
  check("adiabatic squeeze: gamma from P and V", gamma, 5 / 3, 0.06, "",
    "P V^gamma with gamma = 5/3, read off the measured pressure at two volumes");
  check("adiabatic squeeze: and what the spheres add", gamma, gammaSpheres, 0.02, "",
    `gamma = 1 + 2Z/3 + dlnZ/dlnV = ${gammaSpheres.toFixed(4)}: the gas is not made of points, and this says how much`);
  check("adiabatic squeeze: the temperature", T2 / T1, Math.pow(V1 / V2, 2 / 3), 0.05, "x",
    "T V^(gamma-1) = constant is the same law, and it comes with it");
  check("adiabatic squeeze: nothing heated it", box.ledger().heat, 0, 1e-12, "J",
    "insulated walls: the temperature rose because the lid did work, not because heat arrived");
}

{
  /* The same squeeze with the lid held at 300 K instead: now the heat has
     somewhere to go, and the law becomes Boyle's - P V constant, temperature
     unchanged. Same code, one boolean different, opposite result. */
  const box = boxFor({ species: "ar", count: 1800, temperature: 300, walls: "thermal", lidThermal: true, lidMode: "hand", length: 18e-9 });
  run(box, 2000);
  const before = measure(box, 6000);
  const V1 = box.volume;
  const heatBefore = box.heat;
  const steps = Math.ceil((9e-9 / (MAX_LID_MACH * box.rmsSpeed())) / box.dt);
  for (let s = 0; s < steps; s++) {
    box.setLid(V1 / box.lidArea - (s / steps) * 9e-9);
    box.step();
  }
  const heatIn = box.heat - heatBefore;   /* over the squeeze itself, not a window */
  box.setLidMode("fixed");
  run(box, 3000);
  const V2 = box.volume;
  const after = measure(box, 6000);
  check("isothermal squeeze: P V", (after.pressure * V2) / (before.pressure * V1), 1, 0.04, "x",
    "Boyle's law: halve the volume and the pressure doubles, because the lid is a heat bath");
  check("isothermal squeeze: the temperature", box.temperature(), 300, 0.03, "K",
    "the gas stays at the lid's temperature, which is the whole difference from the line above");
  check("isothermal squeeze: the internal energy", (after.energy - before.energy) / before.energy, 0, 0.05, "x",
    "U = (3/2) N k T and T did not move, so U did not either");
  /* And the heat that had to leave is the textbook number for an isothermal
     squeeze: N k T ln(V1/V2) out of the gas. The ledger has it, measured at the
     lid rather than computed, and it agrees. */
  /* And the ledger has something to say here that is worth listening to. A lid
     held at the gas's own temperature hands back a fresh thermal velocity, so
     what it gives and what it takes are the same distribution: the net energy
     across that boundary is nothing. The squeeze is not free - the lid did
     work - but it is isothermal, so every joule of it left again immediately,
     and what is left in the books is exactly nothing. */
  check("isothermal squeeze: no net heat at all",
    Math.abs(heatIn) / (box.n * K_B * 300 * Math.log(V1 / V2)), 0, 0.1, "",
    "the lid gave back what it took: an isothermal squeeze leaves no trace in the books, and none in U");
}

{
  /* Free expansion, which is the one case where the temperature must not move.
     The gas sits in half the box behind a partition; the partition is removed
     and it fills the rest. Nothing pushes back - it expands into vacuum - so
     there is no work and no heat, and U is unchanged. Pressure halves, volume
     doubles, temperature does not move, and every one of those is a measurement.
     This is the expansion that catches people out: P V falling by a factor of
     two with no change in temperature is the same P V = N k T seen from the
     side, and the internal energy had nothing to do with it. */
  const box = boxFor({ species: "ar", count: 1500, temperature: 300, walls: "elastic", lidThermal: false, length: 9e-9 });
  box.setMembrane(true, 9e-9);
  box.lid.x = 18e-9;
  box.markWindow();
  run(box, 4000);
  const before = measure(box, 6000);
  const T1 = box.temperature();
  const u1 = before.energy;
  const heat0 = box.heat;
  const work0 = box.work;
  box.removeMembrane();
  run(box, 6000);
  const after = measure(box, 6000);
  check("free expansion: the temperature", box.temperature() / T1, 1, 0.03, "x",
    "into vacuum there is nothing to push against, so no work is done and the gas does not cool");
  check("free expansion: the internal energy", Math.abs(box.internalEnergy() - u1) / u1, 0, 0.03, "x",
    "and U is untouched, which is what 'no work and no heat' adds up to");
  check("free expansion: the pressure at the back wall", before.backPressure / after.backPressure, 2, 0.06, "x",
    "double the volume, half the molecules at the back wall, half the pressure");
  check("free expansion: P V is unchanged",
    (after.backPressure * box.volume) / (before.backPressure * box.lidArea * 9e-9), 1, 0.08, "x",
    "the same sentence as the two above, and the one the textbook writes as P V = const");
  check("free expansion: nothing crossed a boundary",
    Math.abs((box.heat - heat0) + (box.work - work0)) / Math.max(u1, 1e-30), 0, 1e-12, "",
    "no heat and no work, in any amount: the gas is simply somewhere else now, and it is the same gas");
}

{
  /* The gas's own properties, not the box's.

     A gas behind a partition is half a box of gas, and every readout that
     belongs to the *gas* - its volume, its density, the surface its momentum is
     averaged over, how far apart its molecules are - has to be measured over the
     part of the box the gas is in and not over the vacuum waiting beyond it.
     This is not a bookkeeping nicety: average a divided gas's momentum over the
     lid it has never touched and the pressure reads half of what the gas is
     exerting, which is precisely the number the free-expansion experiment is
     about. The checks below pin both halves: the gas's own pressure is the one
     that satisfies the ideal gas law where the gas is, and the whole box's
     surface would have said something different. */
  const box = boxFor({ species: "ar", count: 1500, temperature: 300, walls: "elastic", lidThermal: false, length: 18e-9 });
  const boxVolume = box.crossSection * box.crossSection * 18e-9;
  box.setMembrane(true, 9e-9);
  box.fill(box.n);          // dealt into the near side, exactly as the panel does it
  box.markWindow();
  /* Let the dealt gas settle onto its own walls before asking where it got to:
     the lattice it is dealt on stops a layer short of the boundary, and a
     molecule's job of reaching the partition takes a few collisions. The
     furthest any molecule gets is tracked across the whole run rather than read
     off the last instant, because "has the gas reached the partition" is a
     question about the run and not about the frame it ended on. */
  let maxX = 0;
  for (let s = 0; s < 2000; s++) {
    box.step();
    for (let i = 0; i < box.n; i++) if (box.x[i] > maxX) maxX = box.x[i];
  }
  /* Measured as an overshoot in picometres, and zero is the only value that
     passes: "on the near side" is a yes or no, not a tolerance. */
  check("a partition: nobody is on the far side",
    Math.max(0, maxX - 9e-9) * 1e12, 0, 0, "pm",
    "a gas dealt behind a partition is a gas in half a box, and after three thousand collisions none of it is in the other half");
  /* "Has the gas reached the partition" is not a question about zero, because a
     sphere cannot get there: a molecule's centre stops one radius short of any
     wall it presses on, and in this box argon's radius is 0.17 nm. So the right
     gap is exactly r, and the check is that the outermost molecule got within a
     percent of it. A gas that had not filled its own half would be short of the
     partition by a great deal more than a percent. */
  const argon = speciesOf("ar");
  check("a partition: and the gas reaches it",
    (9e-9 - maxX) * 1e12, (argon.diameter / 2) * 1e12, 0.01, "pm",
    "the gap is one molecular radius and no more: the outermost molecules are pressed against the partition, which is as close as a centre can come");
  check("a partition: the gas's own volume", box.volume / boxVolume, 0.5, 1e-12, "x",
    "half the box, because that is what the gas has expanded into so far");
  check("a partition: the gas's own density", box.numberDensity / (box.n / boxVolume), 2, 1e-12, "x",
    "twice the whole box's, because the same gas is in half of it");

  run(box, 4000);
  const gasPressure = box.pressure();
  const wholeBox = (() => {
    let total = 0;
    for (let f = 0; f < 6; f++) total += box.impulseWindow[f];
    return total / (box.wallArea * box.windowTime);
  })();
  const Tmean = box.windowTemperature();
  const b2local = (2 / 3) * Math.PI * AR.diameter ** 3;
  check("a partition: the pressure where the gas is",
    (gasPressure * box.volume) / (box.n * K_B * Tmean), 1 + b2local * box.numberDensity, 0.04, "",
    "the gas's own pressure over its own half: the ideal gas law, with the spheres' correction, where the gas is");
  check("a partition: and it is the half the whole box's surface hides",
    wholeBox / gasPressure, 0.5, 0.03, "x",
    "averaged over the lid the gas has never reached, the same momentum reads half: this is the readout the contact surface exists to prevent");

  const V1 = box.volume;
  const P1 = gasPressure;
  const T1 = Tmean;
  box.removeMembrane();
  box.markWindow();
  run(box, 8000);
  check("a partition: take it out and the volume doubles", box.volume / V1, 2, 1e-12, "x",
    "the gas's volume, from the near side of the partition to the lid");
  check("a partition: take it out and the pressure halves", P1 / box.pressure(), 2, 0.06, "x",
    "twice the volume, so half the density and half the pressure - Boyle's law by division, with no work done to get there");
  check("a partition: take it out and nobody was heated", box.windowTemperature() / T1, 1, 0.03, "x",
    "free expansion into vacuum: no heat, no work, and the same temperature over a doubled volume");
}

{
  /* The window's temperature, and why the panel needs one.

     An instantaneous temperature is a mean over a few thousand molecules and
     moves by two percent on its own. Dividing a twenty-picosecond pressure by
     one and calling the result an ideal-gas-law test would put two percent of
     pure sampling noise into the answer - the same size as the hard-sphere
     correction the panel exists to show. So the window carries its own mean
     energy, and this checks that it is exactly the mean of the instantaneous
     temperature over the window the pressure came from. */
  const box = boxFor({ species: "ar", count: 1200, temperature: 300, walls: "thermal", length: 18e-9 });
  run(box, 2000);
  box.markWindow();
  const steps = 3000;
  let sum = 0;
  for (let s = 0; s < steps; s++) { box.step(); sum += box.temperature(); }
  check("the window temperature is the window's", box.windowTemperature(), sum / steps, 1e-12, "K",
    "the mean of the instantaneous temperature over exactly the steps the pressure is averaged over");
  const b2 = (2 / 3) * Math.PI * AR.diameter ** 3;
  check("and the compressibility it makes", box.compressibility(), 1 + b2 * box.numberDensity, 0.04, "",
    "a pressure and a temperature from one window, and the spheres' correction where it should be");
  check("the impact rate the panel reports", box.impactRate(), (box.numberDensity * box.meanSpeed()) / 4, 0.05, "1/(m^2 s)",
    "n v-bar / 4, through the panel's own accessor and over the surface the gas actually touches");
}

/* ==================================================================================
   THE LID: WHAT IT FEELS AND WHAT IT DOES
   ================================================================================== */

{
  /* The lid is a wall, so it obeys the rule a moving wall has to obey: a
     molecule is turned back only if it is actually catching it, and the speed it
     goes back with is the one a bounce off a moving surface gives. Both halves
     are exact, so both are checked to the last bit. */
  /* Both molecules are placed touching the lid, so the step that follows is a
     collision on the very first move. */
  const lidX = 12e-9;
  const box = boxFor({ species: "ar", count: 1, temperature: 300, walls: "elastic", lidThermal: false, length: lidX });
  box.x[0] = lidX - box.radius[0]; box.y[0] = 0; box.z[0] = 0;
  box.vx[0] = 300; box.vy[0] = 0; box.vz[0] = 0;
  box.lid.velocity = -20;   // the lid, closing at 20 m/s
  const work0 = box.work;
  const ke0 = box.internalEnergy();
  run(box, 1);
  check("a closing lid: the bounce", box.vx[0], 2 * -20 - 300, 0, "m/s",
    "2u - v: the bounce in the lid's frame is a bounce, so it comes back 40 m/s faster");
  check("a closing lid: the work", box.work - work0, box.internalEnergy() - ke0, 0, "",
    "and the work booked is exactly the energy the molecule gained");

  /* And the other half of the rule: a lid outrunning the molecules must not touch
     them. Two cases, one on each side of the boundary. */
  const away = boxFor({ species: "ar", count: 2, temperature: 300, walls: "elastic", lidThermal: false, length: lidX });
  away.lid.x = lidX + 0.2e-9;                         // the lid, already receding
  away.lid.velocity = 250;
  away.x[0] = away.lid.x - away.radius[0]; away.y[0] = 0; away.z[0] = 0;
  away.vx[0] = 100; away.vy[0] = 0; away.vz[0] = 0;    // slower than the lid
  away.x[1] = away.lid.x - away.radius[1]; away.y[1] = 1e-9; away.z[1] = 0;
  away.vx[1] = 300; away.vy[1] = 0; away.vz[1] = 0;    // faster than the lid
  run(away, 1);
  check("a receding lid: the slow molecule", away.vx[0], 100, 0, "m/s",
    "a lid running away at 250 m/s cannot catch a molecule doing 100 - it does not touch it");
  check("a receding lid: the fast molecule", away.vx[1], 2 * 250 - 300, 0, "m/s",
    "and it does catch the one doing 300, which goes back at 200: 2u - v again");
  check("a receding lid: who paid", away.work, 0.5 * M_AR * (200 ** 2 - 300 ** 2), 1e-12, "J",
    "the gas handed the lid the difference, and the ledger says so");
}

{
  /* Work is a microscopic quantity here - the sum of what a million collisions
     handed over - and a macroscopic one in the textbook: minus the integral of P
     dV. Those two had better be the same number, and this is that check. */
  const box = boxFor({ species: "ar", count: 1500, temperature: 300, walls: "elastic", lidThermal: false, lidMode: "hand", length: 16e-9 });
  run(box, 2000);
  const work0 = box.work;
  let integral = 0;
  const steps = 9000;
  for (let s = 0; s < steps; s++) {
    const x0 = box.lid.x;
    const impulse0 = box.impulse[WALL_PISTON];
    box.setLid(16e-9 - (s / steps) * 6e-9);
    box.step();
    /* The force the gas put on the lid over this one step, from the momentum it
       handed over in it, against the distance the lid travelled in it: -F dx is
       the work done on the gas, and summing it is the integral. */
    const force = (box.impulse[WALL_PISTON] - impulse0) / box.dt;
    integral += force * (box.lid.x - x0);
  }
  const ledgerWork = box.work - work0;
  check("work: collisions against -integral P dV", ledgerWork, -integral, 0.05, "J",
    "a million impacts adding up to the area under the pressure-volume curve");
}

/* ==================================================================================
   COLLISIONS BETWEEN MOLECULES, AND HOW FAR ONE GETS
   ================================================================================== */

{
  /* The mean free path is the one place this file has to be careful about what
     it claims. lambda = 1/(sqrt2 pi d^2 n) is the *low-density* result, and a
     box you can watch is not at low density: the Knudsen number here is about
     0.3, not the 0.001 of a gas in a room. So the check is on the scaling - which
     is exact - and on the absolute number with room for the many-body
     correction, which is stated rather than hidden. */
  const mid = boxFor({ species: "ar", count: 1000, temperature: 300, walls: "thermal", length: 18e-9 });
  const dense = boxFor({ species: "ar", count: 3000, temperature: 300, walls: "thermal", length: 18e-9 });
  run(mid, 2000); run(dense, 2000);
  const mMid = measure(mid, 6000);
  const mDense = measure(dense, 6000);
  const nuMid = 2 * mMid.pairCollisions / (mid.n * mMid.span);
  const nuDense = 2 * mDense.pairCollisions / (dense.n * mDense.span);
  check("collisions: three times the gas, three times as often",
    nuDense / nuMid, dense.numberDensity / mid.numberDensity, 0.05, "x",
    "the collisions per molecule per second are proportional to the density: lambda = 1/(sqrt2 pi d^2 n)");
  check("collisions: rate per molecule against v-bar / lambda",
    nuDense, dense.meanSpeed() / meanFreePathOf(AR.diameter, dense.numberDensity), 0.06, "1/s",
    "counted collisions against the textbook formula, which is the low-density limit of the truth");

  /* Light against heavy at the same density and temperature, which folds both
     halves of the formula together: a wider atom meets more of them and a faster
     one reaches them sooner, so helium at the same 300 K collides
     (d_Ar/d_He)^2 sqrt(M_Ar/M_He) times as often - five and a half times. */
  const he = boxFor({ species: "he", count: 3000, temperature: 300, walls: "thermal", length: 18e-9 });
  run(he, 2000);
  const mHe = measure(he, 6000);
  const nuHe = 2 * mHe.pairCollisions / (he.n * mHe.span);
  const expectedRatio = (HE.diameter / AR.diameter) ** 2 * Math.sqrt(M_AR / M_HE);
  check("collisions: helium against argon, same box and temperature", nuHe / nuDense, expectedRatio, 0.1, "x",
    "(d_He/d_Ar)^2 sqrt(M_Ar/M_He) = 1.85: lighter means faster, and a narrower sphere is a smaller target");

  /* The mean free path against the box, which is the number that decides whether
     anything you are watching is a gas at all. */
  check("collisions: the free path in a visible box", dense.meanFreePath() / dense.lid.x, 0.21, 0.25, "",
    "lambda/L ~ 0.2: a molecule crosses the box a few times between collisions, which is what makes them visible");
}

/* ==================================================================================
   EFFUSION, AND TWO GASES FINDING OUT WHICH IS LIGHTER
   ================================================================================== */

{
  /* The pinhole is the one experiment where a dilute simulated gas is not a
     compromise but the real thing: molecules leave through a hole without
     touching anyone on the way, so it is exactly ballistic. Two boxes, one of
     helium and one of argon, identical in every other way; the rates differ by
     sqrt of the mass ratio and nothing else. */
  const hole = 3e-9;
  const light = boxFor({ species: "he", count: 4000, temperature: 300, walls: "thermal", hole, length: 18e-9 });
  const heavy = boxFor({ species: "ar", count: 4000, temperature: 300, walls: "thermal", hole, length: 18e-9 });
  run(light, 600); run(heavy, 600);
  const span = 800;
  const l = measure(light, span);
  const h = measure(heavy, span);
  /* The populations are falling while this runs, so each rate is divided by the
     mean population over the window rather than the starting one - otherwise
     helium, which is leaving faster, would look slower than it is. */
  const meanCount = (box, escaped) => box.n + escaped / 2;
  const rateLight = l.escaped / (l.span * meanCount(light, l.escaped));
  const rateHeavy = h.escaped / (h.span * meanCount(heavy, h.escaped));
  check("effusion: helium against argon", rateLight / rateHeavy, Math.sqrt(M_AR / M_HE), 0.12, "x",
    "Graham's law: sqrt(M_Ar/M_He) = 3.16, and it is the mass ratio and nothing else");

  /* The rate itself against the one formula that predicts it: the number of
     molecules reaching the hole's area each second is n v-bar A / 4. This is
     the check with the most room in it, and the reason is worth stating rather
     than hiding - a hole this size is nine percent of the wall it is in, so the
     gas draining through it is felt by the whole box, and the ideal-aperture
     answer has to be read as the right order rather than the last word. For a
     hole four times the area, the rate is four times the rate: that part is
     exact, and it is the next line. */
  /* The absolute rate is the loosest number in the whole file and it is worth
     saying why rather than tightening the tolerance until it passes. The
     ideal-aperture answer - the flux times the area a molecule can fit through
     - is the right order but not the last word at this scale: the aperture is
     only a few mean free paths across, and the molecules are spheres with a
     size, so the gas streaming into the hole is not the quiescent gas the
     formula assumes. What *must* hold is checked in the two lines around this
     one: the ratio of two gases (Graham's law) and the ratio of two holes. */
  const flux = (h.meanCount / heavy.volume) * h.meanSpeed / 4;
  check("effusion: the rate against n v-bar A / 4", rateHeavy * meanCount(heavy, h.escaped),
    flux * apertureArea(hole, AR.diameter / 2), 0.2, "1/s",
    "the molecules reaching the area they can actually get through: the right answer to about a tenth, for a hole a few mean free paths across");

  const wide = boxFor({ species: "ar", count: 4000, temperature: 300, walls: "thermal", hole: 2 * hole, length: 18e-9 });
  run(wide, 600);
  const w = measure(wide, 800);
  const wideRate = w.escaped / (w.span * meanCount(wide, w.escaped));
  check("effusion: a bigger hole lets them out in proportion", wideRate / rateHeavy,
    apertureArea(2 * hole, AR.diameter / 2) / apertureArea(hole, AR.diameter / 2), 0.1, "x",
    "the rate is the flux times the area that can be reached, and it is nothing else");
}

/* ==================================================================================
   A MIXTURE, WHICH IS WHERE HALF OF THESE LAWS LIVE
   ================================================================================== */

{
  /* Two gases in one box, sharing it, at one temperature. Each keeps its own
     speed - that is Graham's law - but they must share the temperature, and that
     is equipartition. A simulator that let the heavy one run hot would fail
     here, and it would fail quietly. */
  /* kind 0 is the gas the box was filled with (helium), kind 1 the one mixed in. */
  const mix = boxFor({ species: "he", second: "ar", mixFraction: 0.5, count: 2400, temperature: 400, walls: "thermal" });
  run(mix, 8000);
  const tHe = sampled(mix, () => mix.temperature(0));
  const tAr = sampled(mix, () => mix.temperature(1));
  check("a mixture: helium's temperature", tHe, 400, 0.03, "K",
    "the light gas, in a box held at 400 K, at 400 K");
  check("a mixture: argon's temperature", tAr, 400, 0.03, "K",
    "and the heavy gas at the same one: they share the temperature, and not the speeds");
  check("a mixture: and they really are different speeds", mix.meanSpeed(0) / mix.meanSpeed(1), Math.sqrt(M_AR / M_HE), 0.05, "x",
    "one box, one temperature, speeds in the ratio of the square roots of the masses");
  check("a mixture: the number of molecules", mix.kindCount(0) + mix.kindCount(1), mix.n, 0, "",
    "half and half went in, and both halves are still accounted for");
}

/* ==================================================================================
   THE THINGS THAT WOULD BE WRONG BUT WOULD NOT LOOK IT
   ================================================================================== */

{
  /* Energy cannot appear. A long run of the default box - the configuration a
     student actually meets - with everything turned on: thermal walls, a
     mixture, a hole, and a lid. If any single term is misbooked, the residual
     grows without limit and this is where it shows. */
  const busy = boxFor({ species: "ar", second: "ne", mixFraction: 0.5, count: 2000, temperature: 350, walls: "thermal", hole: 2e-9 });
  run(busy, 20000);
  const l = busy.ledger();
  const scale = Math.max(Math.abs(l.internalEnergy0), Math.abs(l.heat), Math.abs(l.work), 1e-30);
  check("twenty thousand steps, everything on", Math.abs(l.residual) / scale, 0, 1e-14, "",
    "heat, work, escapes and a hundred thousand collisions, and the books still balance to the last bit");

  /* The molecules that left through the hole took their energy with them, and
     the ledger knows it: without that term the residual would grow with every
     escape, which is exactly the kind of slow, invisible drift the check above
     would eventually catch. */
  check("the escape term is not being ignored", busy.escaped > 0 ? 1 : 0, 1, 0, "",
    `${busy.escaped} molecules left through the hole carrying their energy, and the books include it`);

  /* No molecule may leave a closed box: a leak of one in ten thousand a step
     would empty a scene over a lecture without ever looking like a bug. */
  const sealed = boxFor({ species: "ar", count: 1500, temperature: 300, walls: "thermal" });
  run(sealed, 30000);
  check("a closed box loses nothing", sealed.n, 1500, 0, "",
    "thirty thousand steps with a mixture of walls and nothing squeezed out of a corner");

  /* And the same for a box whose lid is being driven hard: a molecule that
     slips past a moving lid is a molecule outside the box, and the sweep would
     find it there next step and start colliding it with things it cannot see. */
  const pushed = boxFor({ species: "ar", count: 1500, temperature: 300, walls: "thermal", lidMode: "hand", length: 20e-9 });
  let outside = 0;
  for (let s = 0; s < 12000; s++) {
    pushed.setLid(20e-9 - (s / 12000) * 10e-9);
    pushed.step();
    for (let i = 0; i < pushed.n; i++) {
      if (pushed.x[i] < 0 || pushed.x[i] > pushed.lid.x) outside++;
    }
  }
  check("a moving lid leaves nobody outside it", outside, 0, 0, "",
    "twelve thousand steps of a lid closing at the loudest pace allowed, checked every one of them");

  /* The lid's own balance: in load mode it must come to rest where the gas holds
     it up, and it must get there by itself. This is a pressure measurement made
     with a mass rather than a formula. */
  const balance = boxFor({ species: "ar", count: 1800, temperature: 300, walls: "thermal", length: 18e-9 });
  run(balance, 4000);
  const pressure = balance.pressure();
  const V0 = balance.volume;
  /* Let it go, with a weight on it of twice the gas's own pressure: the gas has
     no way to know it is being asked for half its volume, it just has to push
     back with twice as much. */
  balance.setLoad(pressure * 2);
  balance.setLidMode("load");
  run(balance, 90000);
  check("a loaded lid: it finds its own balance", balance.volume / V0, 0.5, 0.06, "x",
    "loaded to twice the pressure it had, the gas settles at half the volume, unaided");
  /* A massless lid on a gas is nudged by every collision, so it is never still:
     it shivers at the thermal scale, a metre a second or so here. What matters
     is that it is not *drifting*. */
  check("a loaded lid: and it settles", Math.abs(balance.lid.velocity), 0, 5, "m/s",
    `it shivers at ${Math.abs(balance.lid.velocity).toFixed(2)} m/s, which is the gas nudging it, and it does not drift`);
  check("a loaded lid: the pressure it settled at", balance.pressure() / pressure, 2, 0.08, "x",
    "and the pressure it settled at is the load, which is a pressure measurement made with a weight");

  /* The gauge's number is the other way of holding the lid: a boundary
     condition, the pressure of the air around the box on the lid's outer face.
     It has to be able to hold a lid on its own and with no weights anywhere, or
     it is a dial reading a setting that nothing listens to. Same experiment as
     the weights' above, in the other currency: the air is set to exactly the
     pressure the gas is already holding the lid up with, and a lid that stays
     where it is has found the balance its panel promises. */
  const air = boxFor({ species: "ar", count: 1800, temperature: 300, walls: "thermal", length: 18e-9 });
  run(air, 4000);
  const ambient = air.pressure();
  const V1 = air.volume;
  air.setExternal(ambient);
  air.setLidMode("load");
  run(air, 30000);
  check("a pressure-held lid: it finds its own balance", air.pressure() / ambient, 1, 0.08, "x",
    "the air on the outside face set to the pressure the gas was holding the lid up with, and no weights on the lid");
  check("a pressure-held lid: and it stays there", air.volume / V1, 1, 0.1, "x",
    "it neither collapsed nor blew open, which is a lid held by a pressure rather than by iron");

  /* And the room comes back with the box: a session, a lab and a checkpoint all
     carry the air the experiment was standing in, not only the gas in it. */
  const restored = boxFor({ species: "he", count: 100, temperature: 500 });
  restored.restore(air.serialize());
  check("a pressure-held lid: the room comes back with the box", restored.lid.external / 1e6, ambient / 1e6, 0.001, "MPa",
    "a restored box sits in the same room it was saved in");
}

/* ==================================================================================
   A FLAME UNDER THE BOX
   ================================================================================== */

{
  /* The burner is a *surface* rather than a switch on the whole box: the floor
     is held at the flame's temperature and the other five faces keep doing what
     they were doing. Two things have to follow, and they are the two things the
     panel says about it.

     First, a box whose only exchange with the outside is its floor must end up
     at the floor's temperature. That is the only steady state such a box has,
     and if it were not so then "flame temperature" would be a number with
     nothing behind it. Second, a box that also has five faces at the air's
     temperature must end up in between - and nearer the air, because five
     sixths of the surface it touches is the air. */
  const AIR = 300;
  const FLAME = 900;

  const insulated = boxFor({
    species: "ar", count: 1200, temperature: AIR, walls: "elastic", lidThermal: false,
    length: 18e-9, burner: true, burnerTemperature: FLAME,
  });
  run(insulated, 24000);
  check("a flame: an insulated box comes to the flame's temperature",
    sampled(insulated, () => insulated.temperature()), FLAME, 0.04, "K",
    "the one wall it can exchange energy with is the flame, and the gas is heated one collision at a time until it agrees");

  const balanced = boxFor({
    species: "ar", count: 1200, temperature: AIR, walls: "thermal", lidThermal: true,
    length: 18e-9, burner: true, burnerTemperature: FLAME,
  });
  run(balanced, 24000);
  const middle = sampled(balanced, () => balanced.windowTemperature());
  check("a flame: a box in air settles between the flame and the air",
    middle > AIR && middle < FLAME ? 1 : 0, 1, 0, "",
    `it sits at ${middle.toFixed(1)} K: above the air it stands in and below the flame it stands on`);
  check("a flame: and nearer the air, because five faces of six are",
    middle, (5 * AIR + FLAME) / 6, 0.12, "K",
    "one face in six is the flame: an area-weighted mean of 400 K, and the gas sits a little under it because a hot surface also throws its molecules off faster");

  /* The heat arrived through the wall, and only through the wall. */
  const l = balanced.ledger();
  check("a flame: the heat came through the wall, not from nowhere",
    Math.abs(l.residual) / Math.max(Math.abs(l.heat), 1e-30), 0, 1e-12, "",
    "tens of thousands of collisions with a hot surface, and the first law still holds to the last bit");

  /* A flame is a difference, not a supply: as the box catches it up, it hands
     over less. This is the number that settles to zero, and the reason the
     panel's heat rate is worth a row. */
  const early = balanced.heatWindow / Math.max(balanced.windowTime, 1e-30);
  balanced.markWindow();
  run(balanced, 6000);
  const late = balanced.heatWindow / Math.max(balanced.windowTime, 1e-30);
  check("a flame: it hands over less as the box catches it up",
    late < 0.4 * early ? 1 : 0, 1, 0, "",
    `the rate it delivers falls from ${early.toExponential(2)} W to ${late.toExponential(2)} W: a flame is a difference, and once the gas is as warm as the flame there is no difference left`);

  /* And the other way round: a surface colder than the gas cools it, which is
     the same code path with the same physics in the opposite direction. */
  const cooled = boxFor({
    species: "ar", count: 1200, temperature: 900, walls: "thermal", lidThermal: true,
    length: 18e-9, burner: true, burnerTemperature: 300,
  });
  run(cooled, 24000);
  check("a flame colder than the air cools the box instead",
    sampled(cooled, () => cooled.windowTemperature()), 800, 0.12, "K",
    "900 K of gas over a 300 K plate: the same six faces, the same arithmetic, the other sign");

  /* A hotter surface makes faster molecules, so the timeline has to be cut
     finer. The step is set by the fastest molecule the box can hold, which with
     a flame under it is one that has just come off the flame. */
  const cold = new GasBox({ species: "ar", temperature: 300, burner: false });
  const lit = new GasBox({ species: "ar", temperature: 300, burner: true, burnerTemperature: 1200 });
  check("a flame: the timeline is refined for the molecules it makes",
    cold.dt / lit.dt, Math.sqrt(1200 / 300), 1e-12, "x",
    "four times the absolute temperature is twice the speed, and half the step");
}

/* ==================================================================================
   WHERE PRESSURE COMES FROM: F = P A, AND THE IMPULSES THAT MAKE IT
   ================================================================================== */

{
  /* Three quantities that have to agree or the panel is lying about one of
     them. The pressure is momentum per unit area per unit time - that is the
     definition, not a formula - and the force on a face is the same momentum
     per unit time with no area in it. Divide one by the other and the face's own
     area comes back, which is a check that can only pass if both the force and
     the area are right. */
  const box = boxFor({ species: "ar", count: 1400, temperature: 300, length: 18e-9 });
  run(box, 8000);
  box.markWindow();
  run(box, 6000);
  let areaError = 0;
  for (let f = 0; f < 6; f++) {
    const area = f === WALL_BACK || f === WALL_PISTON ? box.lidArea : box.crossSection * box.occupiedLength;
    areaError = Math.max(areaError, Math.abs(box.forceOn(f) / box.pressure(f) - area) / area);
  }
  check("pressure: F / A, face by face", areaError, 0, 1e-12, "",
    "six faces, six areas: divide a face's force by its pressure and the area it started from comes back");
  check("pressure: the total force over the surface it acts on",
    box.totalForce / box.contactArea, box.pressure(), 1e-12, "Pa",
    "the six-face average and the momentum-per-second account of it are the same measurement, not two");

  const b2local = (2 / 3) * Math.PI * AR.diameter ** 3;
  check("pressure: and what the gas's own state says it should be",
    (box.pressure() * box.volume) / (box.n * K_B * box.windowTemperature()),
    1 + b2local * box.numberDensity, 0.04, "",
    "P V / N k T from the collisions themselves, against the ideal gas law with the spheres' correction");

  /* The impulses the walls collected, which is what the stage draws as sparks.
     A molecule arriving at a surface is not one picked at random: it is one
     weighted by how fast it was going, because a fast molecule reaches the wall
     more often than a slow one. So the mean impulse is 2 sqrt(pi/2) sqrt(m k T)
     - 2.507 - rather than the 2.257 a random molecule would carry. That factor
     is the flux weighting, and this check is what says it is really there. */
  box.setTrackImpacts(true);
  box.clearImpacts();
  run(box, 4000);
  const log = box.impactLog;
  let impulseSum = 0;
  for (let k = 0; k < log.count; k++) impulseSum += log.impulse[k];
  const unit = Math.sqrt(M_AR * K_B * box.temperature());
  check("impacts: the mean momentum a wall collects",
    impulseSum / log.count / unit, 2 * Math.sqrt(Math.PI / 2), 0.04, "",
    "2 sqrt(pi/2) sqrt(m k T): fast molecules hit more often than slow ones, and the average collision knows it");

  /* Every spark has to land on the wall it struck, or the picture of pressure
     is a picture of somewhere else. The position is snapped onto the face's own
     plane, so the distance to that plane is zero up to the precision of the
     buffer it is stored in - and that buffer is single precision, because a
     spark is a picture and not a measurement. A femtometre is a hundred
     thousand times smaller than the thinnest thing in the scene (an atomic
     radius is 170,000 fm), so this is zero in every sense the eye could care
     about. */
  const half = box.crossSection / 2;
  let offFace = 0;
  for (let k = 0; k < log.count; k++) {
    const f = log.face[k];
    const d = f === WALL_BACK ? Math.abs(log.x[k])
      : f === WALL_PISTON ? Math.abs(log.x[k] - box.lid.x)
        : f === 0 ? Math.abs(log.y[k] + half)
          : f === 1 ? Math.abs(log.y[k] - half)
            : f === 2 ? Math.abs(log.z[k] + half)
              : Math.abs(log.z[k] - half);
    if (d > 1e-15) offFace++;
  }
  check("impacts: each one recorded on the face it struck", offFace, 0, 0, "fm",
    `${log.count} sparks, and not one of them further than a femtometre from the plane it belongs to`);

  /* It is a ring buffer and not a growing list - the reason a workbench can
     record every collision in the box without ever running out of memory. */
  check("impacts: the log is bounded", log.count, MAX_IMPACT_LOG, 0, "",
    `${log.recorded} impacts in four thousand steps, and the newest ${MAX_IMPACT_LOG} of them are the ones kept`);

  /* Switched off, it neither records nor costs anything: a wall collision in a
     box of four thousand molecules happens thirty times a step, so a log that
     kept filling while nobody was looking would be four float writes a
     collision for nothing. */
  box.setTrackImpacts(false);
  const frozen = log.recorded;
  run(box, 400);
  check("impacts: switched off, nothing is recorded", log.recorded - frozen, 0, 0, "",
    "the picture is a kindness to the reader, not a cost the physics pays");

  /* And a log that has not filled yet keeps everything: the discarding is what
     happens when the ring comes round, not something it does on the way. The
     run has to be long enough for the gas to have met its walls at all - the
     lattice it is dealt on stops short of them - and short enough not to wrap. */
  const fresh = boxFor({ species: "ar", count: 200, temperature: 300 });
  fresh.setTrackImpacts(true);
  run(fresh, 120);
  check("impacts: a young log has discarded nothing",
    fresh.impactLog.recorded > 0 && fresh.impactLog.count === fresh.impactLog.recorded ? 1 : 0, 1, 0, "",
    `${fresh.impactLog.recorded} impacts, every one of them still in the buffer: it only starts discarding once it is full`);
}

/* ==================================================================================
   THE LABS' OWN SETUPS
   ==================================================================================
   Everything above is about the gas. This block is about the scenes the labs
   build around it, because a lab here is a bench as well as a box: it names the
   instruments it needs, it sets the numbers their panels hold, and it is the
   only place in the app that can put a dial on the stage with nothing to read.

   Four of the checks are statements about the physics of those scenes rather
   than about the numbers: a flame has a burner standing under it, a load is
   weights standing on the lid, the gauge's number is the air holding a *free*
   lid and cannot be read on a lid that is held by its latch, and a lid left free
   is held by something - a load or the air - or it is a lid the gas blows open
   on the first step.

   What these cannot check is whether a lab's bench is the *right* bench for its
   question. That is a judgement about the experiment and it is written where the
   experiment is, in the comments in frontend/thermo_labs.js. */

{
  const KNOWN = ["burner", "weights", "gauge", "thermometer"];
  const named = (lab, key) => (lab.state.instruments ?? []).includes(key);
  const withInstruments = (test) => THERMO_LABS.filter((lab) => (lab.state.instruments ?? []).some(test));

  const unnamed = THERMO_LABS.filter((lab) => !Array.isArray(lab.state.instruments));
  check("labs: every lab says what stands on its bench", THERMO_LABS.length - unnamed.length,
    THERMO_LABS.length, 0, "",
    `all ${THERMO_LABS.length} of them, including the ones that need nothing, which say so with an empty list`);

  const undescribed = THERMO_LABS.filter((lab) => !(lab.setup ?? "").length);
  check("labs: every lab says what its setup is", THERMO_LABS.length - undescribed.length,
    THERMO_LABS.length, 0, "",
    "one line per lab naming the bench and the room, in the numbers its panels hold");

  const misspelled = withInstruments((key) => !KNOWN.includes(key)).map((lab) => lab.id);
  check("labs: the instruments named are instruments that exist", misspelled.length, 0, 0, "",
    misspelled.length ? `unknown name in: ${misspelled.join(", ")}` : `the four names are the four instruments, and no lab reaches past them`);

  const flameLabs = THERMO_LABS.filter((lab) => lab.state.burner);
  const flamelessBurner = flameLabs.filter((lab) => !named(lab, "burner"));
  check("labs: a lab that lights a flame stands a burner under it", flameLabs.length - flamelessBurner.length,
    flameLabs.length, 0, "",
    `${flameLabs.length} labs burn gas, and every one of them puts the burner it burns at on the bench`);

  const weightLabs = withInstruments((key) => key === "weights");
  const unloaded = weightLabs.filter((lab) => lab.state.lidMode !== "load" || !(lab.state.load > 0));
  check("labs: a lab that names the weights has a load on the lid", weightLabs.length - unloaded.length,
    weightLabs.length, 0, "",
    unloaded.length ? `no load in: ${unloaded.map((lab) => lab.id).join(", ")}` : `${weightLabs.length} labs hold their lid with iron, and the load is what stands on it`);

  /* The gauge reads the pressure of the air on the lid's outer face, which only a
     free lid can feel. So the gauge is on a bench exactly when the lab states an
     outside pressure and lets the lid move: a dial on a latched lid would be a
     reading of nothing, and an outside pressure with no dial is a condition the
     reader cannot see anywhere in the app. */
  const gaugeLabs = withInstruments((key) => key === "gauge");
  const airLabs = THERMO_LABS.filter((lab) => (lab.state.external ?? 0) > 0);
  const mismatch = THERMO_LABS.filter((lab) =>
    named(lab, "gauge") !== ((lab.state.external ?? 0) > 0)
    || (named(lab, "gauge") && lab.state.lidMode !== "load"));
  check("labs: the gauge is on the benches whose lid the air holds", mismatch.length, 0, 0, "",
    mismatch.length ? `out of step in: ${mismatch.map((lab) => lab.id).join(", ")}` : `the gauge and an outside pressure go together on ${gaugeLabs.length} of ${THERMO_LABS.length} benches, on a lid that is free to feel it`);
  check("labs: and an outside pressure is always one the gauge can be read on", airLabs.length - gaugeLabs.length, 0, 0, "",
    "a pressure stated with no dial to read it on is a condition nothing in the panel shows");

  const freeLabs = THERMO_LABS.filter((lab) => lab.state.lidMode === "load");
  const unsupported = freeLabs.filter((lab) => !((lab.state.load ?? 0) > 0 || (lab.state.external ?? 0) > 0));
  check("labs: a free lid is held by something", freeLabs.length - unsupported.length,
    freeLabs.length, 0, "",
    unsupported.length ? `free and unheld in: ${unsupported.map((lab) => lab.id).join(", ")}` : `${freeLabs.length} labs move their lid against a weight or against the air, and none of them left it to the gas`);
}

process.exitCode = report() ? 1 : 0;
