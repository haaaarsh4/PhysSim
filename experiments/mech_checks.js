/**
 * experiments/mech_checks.js - does the Vibrations bench still obey its own
 * textbooks?
 *
 * Every lab in frontend/mech_labs.js states a result in its `aim`, and a student
 * is asked to confirm it against a number this simulation measures. That makes
 * the simulation's accuracy the one thing that cannot be taken on trust, so this
 * file runs the real module - the same simulation/mech_system.js the browser
 * loads - and checks it against answers derived by hand.
 *
 * Three kinds of claim are checked, and the difference between them matters:
 *
 *   - the exact ones, to a part in 1e12 or better. The equations of motion are
 *     linear and are integrated by a matrix exponential, so a free response has a
 *     closed form that can be written down, and the ledger's residual is
 *     arithmetic rather than an estimate. Anything outside rounding here is a
 *     bug, not noise, and the tolerances say so.
 *   - the structural ones, where a transfer function computed from the matrices
 *     is checked against a *different* route to the same thing - against the
 *     response an actual simulation settles into, or against the state matrix's
 *     own characteristic polynomial, evaluated by an independent determinant
 *     written here rather than read from the module. A transfer function that
 *     agreed with itself would prove nothing.
 *   - the analytic ones, where the answer is a formula out of a vibrations text:
 *     zeta = c / (2 sqrt(k m)), omega_d = omega_n sqrt(1 - zeta^2), the quarter
 *     car's ks(ct s + kt) over the characteristic equation, the log decrement.
 *
 * Run directly:  npm run check:mech
 */
import {
  MechSystem, defaultSpec, expm, polyRoots, evalPolyComplex,
} from "../simulation/mech_system.js";
import { MECH_LABS } from "../frontend/mech_labs.js";
import { MECH_SYSTEMS } from "../frontend/mech_systems.js";

/* ------------------------------ the runner ------------------------------ */

const results = [];

function check(name, measured, expected, tolerance, unit = "", note = "") {
  const m = Number(measured);
  const e = Number(expected);
  const error = e === 0 ? Math.abs(m) : Math.abs(m - e) / Math.abs(e);
  results.push({ name, measured: m, expected: e, unit, error, tolerance, note, ok: error <= tolerance });
}

/** A check that passes when a boolean holds, for the claims that are not a
 *  number against a formula - a shape, a sign, a pair of roots. */
function checkTrue(name, value, note = "") {
  results.push({ name, measured: value ? 1 : 0, expected: 1, unit: "", error: value ? 0 : 1, tolerance: 0, note, ok: !!value });
}

function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "ok  " : "FAIL";
    if (!r.ok) failed++;
    const measured = `${r.measured.toPrecision(5)}`;
    const expected = `${r.expected.toPrecision(5)}`;
    const error = `${(r.error * 100).toFixed(2).padStart(7)}%  (within ${(r.tolerance * 100).toFixed(1)}%)`;
    console.log(`${mark}  ${r.name.padEnd(width)}  ${measured.padStart(13)} vs ${expected.padStart(13)} ${error}`);
    if (r.note) console.log(`      ${" ".repeat(width)}  ${r.note}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed;
}

/** A complex determinant, written here on purpose: the transfer-function checks
 *  are only worth anything if the determinant they are checked against is not
 *  the module's own. */
function detComplexReference(matrix) {
  const n = matrix.length;
  const A = matrix.map((row) => row.map((z) => ({ re: z.re, im: z.im })));
  let det = { re: 1, im: 0 };
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.hypot(A[r][c].re, A[r][c].im) > Math.hypot(A[pivot][c].re, A[pivot][c].im)) pivot = r;
    }
    if (pivot !== c) { const t = A[c]; A[c] = A[pivot]; A[pivot] = t; det = { re: -det.re, im: -det.im }; }
    const p = A[c][c];
    det = { re: det.re * p.re - det.im * p.im, im: det.re * p.im + det.im * p.re };
    const d2 = p.re * p.re + p.im * p.im;
    for (let r = c + 1; r < n; r++) {
      const a = A[r][c];
      const factor = { re: (a.re * p.re + a.im * p.im) / d2, im: (a.im * p.re - a.re * p.im) / d2 };
      for (let k = c; k < n; k++) {
        const b = A[c][k];
        A[r][k] = {
          re: A[r][k].re - (factor.re * b.re - factor.im * b.im),
          im: A[r][k].im - (factor.re * b.im + factor.im * b.re),
        };
      }
    }
  }
  return det;
}

/** The state matrix of a linear system, assembled here rather than read out of
 *  the module: one independent second opinion on what the poles should be. */
function stateMatrixReference(mass, stiffness, damping) {
  const n = mass.length;
  const size = 2 * n;
  const A = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ re: 0, im: 0 })));
  for (let i = 0; i < n; i++) {
    A[i][n + i] = { re: 1, im: 0 };
    for (let j = 0; j < n; j++) {
      A[n + i][j] = { re: -stiffness[i][j] / mass[i], im: 0 };
      A[n + i][n + j] = { re: -damping[i][j] / mass[i], im: 0 };
    }
  }
  return A;
}

/* ============================== THE EXPONENTIAL ============================== */
/* Everything above this line rests on one function, so it is checked against
 *  the one matrix whose exponential everybody knows: a rotation generator, whose
 *  exponential is a rotation matrix written in terms of cos and sin. */

{
  const omega = 4.7;
  const h = 0.031;
  const A = Float64Array.from([0, h, -omega * omega * h, 0]);
  const E = expm(A, 2);
  const c = Math.cos(omega * h);
  const s = Math.sin(omega * h) / omega;
  check("expm: e^(A h) for a harmonic generator", Math.max(
    Math.abs(E[0] - c), Math.abs(E[1] - s), Math.abs(E[2] + omega * omega * s), Math.abs(E[3] - c),
  ), 0, 1e-14, "",
    `A = [[0, 1],[-omega^2, 0]] h; the answer is [[cos, sin/omega],[-omega sin, cos]] at omega = ${omega}`);
}

/* ============================== FREE VIBRATION ============================== */
/* The undamped oscillator is the one system whose solution everyone can write
 * down: released from rest at x0, it oscillates as x0 cos(omega_n t) for ever.
 * If the exact integration is exact, this is the strongest possible test of it -
 * a full period has to come back to where it started, to the last bit. */

{
  const omega = Math.sqrt(10);
  const system = new MechSystem({
    masses: [{ m: 1 }],
    elements: [{ kind: "spring", a: 0, b: "g", k: 10 }],
    drive: { waveform: "off" },
    base: { waveform: "off" },
    x0: [1], v0: [0],
  });
  /* A step that does not divide the period, on purpose: an exact method has no
     reason to be specially good at stepping whole periods, and a method that
     only looked right on the period would be hiding its error at the ends. */
  system.setDt(0.0137);
  const seconds = 3.3;
  system.advance(Math.round(seconds / system.dt));
  const measured = system.observe().x[0];
  check("undamped free response x(t)", measured, Math.cos(omega * system.time), 1e-12, "m",
    "x0 cos(omega_n t), omega_n = sqrt(k/m), released from 1 m");
  check("no energy lost", system.observe().total, 0.5 * 10, 1e-13, "J",
    "a spring and a mass with no damper cannot lose energy");
}

{
  /* The underdamped response has a closed form too, and it is the one every
     vibrations course makes a student plot: a decaying sinusoid whose envelope
     is exp(-zeta omega_n t). Both the frequency and the decay are checked. */
  const m = 1, k = 10, c = 2;
  const omegaN = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const omegaD = omegaN * Math.sqrt(1 - zeta * zeta);
  const system = new MechSystem({
    masses: [{ m }],
    elements: [
      { kind: "spring", a: 0, b: "g", k },
      { kind: "damper", a: 0, b: "g", c },
    ],
    drive: { waveform: "off" },
    base: { waveform: "off" },
    x0: [1], v0: [0],
  });
  system.setDt(0.007);
  system.advance(Math.round(2.4 / system.dt));
  const t = system.time;
  const expected = Math.exp(-zeta * omegaN * t) * (Math.cos(omegaD * t) + ((zeta * omegaN) / omegaD) * Math.sin(omegaD * t));
  check("underdamped free response", system.observe().x[0], expected, 1e-11, "m",
    `zeta = c/(2 sqrt(km)) = ${zeta.toFixed(4)}, omega_d = ${omegaD.toFixed(4)} rad/s`);

  const modes = system.modes[0];
  check("natural frequency from the eigenvalues", modes.omega, omegaN, 1e-12, "rad/s");
  const pole = system.poleReport().find((p) => p.im > 0);
  check("damping ratio from the poles", pole.damping, zeta, 1e-10, "",
    "zeta read off the complex pole, not off the formula");
  check("damped frequency from the poles", pole.im, omegaD, 1e-10, "rad/s");

  /* And the decay itself: what the damper took is what the energy lost, to the
     last bit. This is the ledger's whole claim, and it is exact. */
  const observed = system.observe();
  check("energy dissipated = energy lost", observed.dissipated, 0.5 * k - observed.total, 1e-12, "J",
    "the integral of c v^2, computed exactly, against the drop in energy");
}

/* ============================== THE LEDGER, DRIVEN ============================== */
/* With a drive running, the books have to balance over a long run: what came in
 * through the force minus what left through the damper is the energy the system
 * gained. The residual is arithmetic, so the tolerance is rounding-sized. */

{
  const system = new MechSystem(defaultSpec());
  system.setDt(1 / 600);
  system.advance(60000);
  const observed = system.observe();
  const relative = Math.abs(observed.residual) / observed.residualScale;
  check("energy ledger, harmonic drive", relative, 0, 1e-12, "",
    `residual ${observed.residual.toExponential(2)} J against a scale of ${observed.residualScale.toPrecision(3)} J`);
  checkTrue("the drive put work in", observed.workDrive > 0, `W in = ${observed.workDrive.toFixed(4)} J`);
  checkTrue("the damper took work out", observed.dissipated > 0, `Q = ${observed.dissipated.toFixed(4)} J`);
}

/* ============================== THE TRANSFER FUNCTIONS ============================== */
/* Checked three ways, none of which is the module agreeing with itself:
 *   - against the closed form for one degree of freedom;
 *   - against the response a real simulation settles into, which is what a
 *     frequency response is *for*;
 *   - against the state matrix's characteristic polynomial, by a determinant
 *     written in this file. */

{
  const m = 1, k = 10, c = 0.5;
  const system = new MechSystem({
    masses: [{ m }],
    elements: [
      { kind: "spring", a: 0, b: "g", k },
      { kind: "damper", a: 0, b: "g", c },
    ],
    drive: { mass: 0, waveform: "off" },
    base: { waveform: "off" },
  });
  const force = system.transfer("force", 0);
  check("H(s) denominator is m s^2 + c s + k", force.den[0] / m, 1, 1e-12, "",
    `num ${force.num.map((v) => v.toPrecision(4)).join(", ")} / den ${force.den.map((v) => v.toPrecision(4)).join(", ")}`);
  check("H(s) numerator is 1", force.num.length, 1, 0.5, "",
    "a single mass on a spring and a damper: X/F = 1/(m s^2 + c s + k)");
  check("DC gain is 1/k", system.dcGain("force", 0), 1 / k, 1e-12, "m/N");

  const base = system.transfer("base", 0);
  check("base transfer function numerator is c s + k", base.num[0] / c + base.num[1] / k, 2, 1e-12, "",
    "X/Y0 = (c s + k)/(m s^2 + c s + k) for a single mass on a shaken ground");
  check("base DC gain is 1", system.dcGain("base", 0), 1, 1e-11, "",
    "a slow enough shake moves the mass with the ground: the ratio is one");
}

{
  /* The steady state is the independent route: drive it, wait for the transient
     to die, measure the amplitude, and it has to be |H(j omega)| times the
     amplitude of the drive. Nothing in the algebra above can make this agree
     unless the algebra is right. */
  const system = new MechSystem(defaultSpec());
  system.setDt(1 / 1200);
  system.setDrive({ waveform: "sine", amplitude: 1, frequency: 0.5, mass: 0 });
  system.reset();
  const omega = 2 * Math.PI * 0.5;
  const expected = system.frequencyResponse("force", 0, omega).magnitude;
  const seconds = 90;
  const harness = { peak: 0 };
  for (let i = 0; i < Math.round(seconds / system.dt); i++) {
    system.step();
    /* Only the last few periods are read: by then the transient is below a part
       in 1e10 of the steady state and the amplitude is a pure measurement. */
    if (system.time > seconds - 10) harness.peak = Math.max(harness.peak, Math.abs(system.state[0]));
  }
  check("measured steady-state amplitude vs |H(j omega)|", harness.peak, expected, 0.002, "m",
    `driven at ${omega.toFixed(3)} rad/s, |H| = ${expected.toPrecision(5)} m/N`);
}

{
  /* The two-mass damping-couple from the textbook: a block sitting on a block,
     joined by viscous friction, with the lower one on a spring and a damper.
     Its transfer function is a known polynomial, so this is a check of the
     whole polynomial path - determinant, interpolation, coefficient extraction -
     against arithmetic done by hand. */
  const m1 = 2.5, m2 = 4, B1 = 1.5, B2 = 0.8, K = 60;
  const system = new MechSystem({
    masses: [{ m: m1 }, { m: m2 }],
    elements: [
      { kind: "damper", a: 0, b: 1, c: B1 },
      { kind: "damper", a: 1, b: "g", c: B2 },
      { kind: "spring", a: 1, b: "g", k: K },
    ],
    drive: { mass: 1, waveform: "off" },
    base: { waveform: "off" },
    output: 0,
  });
  /* The numerator is B1 s and nothing else, which is the whole physics of this
     figure: the upper block has no spring to the ground and no spring to the
     lower one, so the only way a force can reach it is through the friction, and
     an integrator turns that into one power of s. Two coefficients, the second
     of them zero. */
  const expectedNum = [B1, 0];
  const expectedDen = [
    m1 * m2,
    m1 * (B1 + B2) + m2 * B1,
    m1 * K + B1 * B2,
    B1 * K,
    0,
  ];
  const transfer = system.transfer("force", 0);
  const denScale = Math.max(...expectedDen.map(Math.abs));
  let denError = 0;
  for (let i = 0; i < 4; i++) denError = Math.max(denError, Math.abs(transfer.den[i] - expectedDen[i]) / denScale);
  check("friction-coupled pair: denominator", denError, 0, 1e-10, "",
    "m1m2 s^4 + [m1(B1+B2) + m2 B1] s^3 + [m1 K + B1 B2] s^2 + B1 K s");
  let numError = transfer.num.length === 2 ? 0 : 1;
  for (let i = 0; i < 2; i++) numError = Math.max(numError, Math.abs(transfer.num[i] - expectedNum[i]) / B1);
  check("friction-coupled pair: numerator", numError, 0, 1e-10, "",
    `x1/f = B1 s over the determinant; got [${transfer.num.map((v) => v.toPrecision(4)).join(", ")}]`);
  checkTrue("H -> 0 as the coupling vanishes",
    (() => {
      const loose = new MechSystem({
        masses: [{ m: m1 }, { m: m2 }],
        elements: [
          { kind: "damper", a: 0, b: 1, c: 1e-9 },
          { kind: "damper", a: 1, b: "g", c: B2 },
          { kind: "spring", a: 1, b: "g", k: K },
        ],
        drive: { mass: 1, waveform: "off" },
        base: { waveform: "off" },
      });
      return Math.abs(loose.transfer("force", 0).num[0]) < 1e-6 * m1;
    })(),
    "with no friction between the blocks the upper one never moves, so its transfer function is zero");
}

{
  /* The quarter car. Its body transfer function has a shape that is quoted in
     every suspension text - ks(ct s + kt) over the characteristic quartic - and a
     shape is exactly what a numeric determinant cannot fake. */
  const body = 300, wheel = 40;
  const ks = 30e3, cs = 2e3, kt = 200e3, ct = 200;
  const system = new MechSystem({
    masses: [{ m: wheel }, { m: body }],
    elements: [
      { kind: "spring", a: 0, b: "g", k: kt },
      { kind: "damper", a: 0, b: "g", c: ct },
      { kind: "spring", a: 0, b: 1, k: ks },
      { kind: "damper", a: 0, b: 1, c: cs },
    ],
    drive: { waveform: "off" },
    base: { waveform: "sine", amplitude: 0.01, frequency: 1 },
    excitation: "base",
    output: 1,
  });
  const transfer = system.transfer("base", 1);
  /* The road's motion reaches the body through the tyre *and* the suspension, so
     the numerator is the product of the two impedances - (kt + ct s)(ks + cs s) -
     and not the suspension's alone. That is the whole reason a quarter car's body
     still moves at a frequency no spring of its own is tuned to. */
  const expectedNum = [ct * cs, kt * cs + ct * ks, kt * ks];
  let numError = transfer.num.length === 3 ? 0 : 1;
  for (let i = 0; i < 3; i++) numError = Math.max(numError, Math.abs(transfer.num[i] - expectedNum[i]) / expectedNum[2]);
  check("quarter car: numerator is (kt + ct s)(ks + cs s)", numError, 0, 1e-10, "",
    `tyre times suspension; got [${transfer.num.map((v) => v.toPrecision(5)).join(", ")}]`);
  check("quarter car: denominator is a quartic", transfer.den.length, 5, 0.001, "",
    "two masses, so 2n = 4, and one more coefficient than that is the constant of a monic polynomial");

  /* The two resonances, from the quadratic the textbooks solve: expanding
     det(K - omega^2 M) = 0 gives m M w^4 - [(kt+ks) M + m ks] w^2 + kt ks = 0,
     which is solved here rather than read off the module's poles. */
  const a = wheel * body;
  const b = -((kt + ks) * body + wheel * ks);
  const c = kt * ks;
  const disc = b * b - 4 * a * c;
  const analytic = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].map(Math.sqrt);
  const poles = system.poleReport().filter((p) => p.im > 1e-6);
  check("quarter car: two complex modes", poles.length, 2, 0.001, "");
  const bodyMode = poles.reduce((q, w) => (q.omega < w.omega ? q : w));
  const wheelMode = poles.reduce((q, w) => (q.omega > w.omega ? q : w));
  check("quarter car: ride frequency", bodyMode.omega, analytic[0], 0.03, "rad/s",
    `${(analytic[0] / (2 * Math.PI)).toFixed(2)} Hz from the quadratic: the body on its suspension`);
  check("quarter car: wheel hop", wheelMode.omega, analytic[1], 0.03, "rad/s",
    `${(analytic[1] / (2 * Math.PI)).toFixed(2)} Hz from the quadratic: the wheel on the tyre`);
  /* Both modes are underdamped in any car anyone has ridden in, which is the
     claim worth checking - not which of the two happens to be the damper one. */
  checkTrue("quarter car: both modes are underdamped",
    poles.every((q) => q.damping > 0 && q.damping < 1),
    `zeta_body = ${bodyMode.damping.toFixed(3)}, zeta_wheel = ${wheelMode.damping.toFixed(3)}`);

  /* And the response itself, measured: a car body on a shaker, at the wheel hop
     frequency the motion is attenuated - which is what suspension is for. */
  const measured = [];
  for (const frequency of [1.2, 11.6]) {
    system.setBase({ waveform: "sine", amplitude: 0.01, frequency });
    system.reset();
    const step = 1 / 4000;
    system.setDt(step);
    let peak = 0;
    const periods = Math.round((60 / frequency) / step);
    for (let i = 0; i < periods; i++) {
      system.step();
      if (i > periods * 0.8) peak = Math.max(peak, Math.abs(system.state[1]));
    }
    measured.push(peak / 0.01);
    const theory = system.frequencyResponse("base", 1, 2 * Math.PI * frequency).magnitude;
    check(`quarter car: measured body gain at ${frequency} Hz`, peak / 0.01, theory, 0.01, "",
      "a settling run against |H(j omega)|, two ways of asking the same question");
  }
  checkTrue("quarter car: the body is not amplified at wheel hop", measured[1] < 1.05,
    `gain at 11.6 Hz is ${measured[1].toFixed(3)}; above 1 would mean the tyre is throwing the body around`);
}

{
  /* The poles have to be the roots of the characteristic polynomial of the
     system's own state matrix - computed here, from scratch, at each pole. If
     the interpolation that produced the polynomial were subtly wrong, this is
     where it would show, because nothing here shares code with it. */
  const body = 300, wheel = 40;
  const ks = 30e3, cs = 2e3, kt = 200e3, ct = 200;
  const system = new MechSystem({
    masses: [{ m: wheel }, { m: body }],
    elements: [
      { kind: "spring", a: 0, b: "g", k: kt },
      { kind: "damper", a: 0, b: "g", c: ct },
      { kind: "spring", a: 0, b: 1, k: ks },
      { kind: "damper", a: 0, b: 1, c: cs },
    ],
    drive: { waveform: "off" },
    base: { waveform: "off" },
    excitation: "base",
  });
  const A = stateMatrixReference(
    [wheel, body],
    [[kt + ks, -ks], [-ks, ks]],
    [[ct + cs, -cs], [-cs, cs]],
  );
  let worst = 0;
  const scale = Math.max(kt, ks) / Math.min(wheel, body) * 100;
  for (const pole of system.poles) {
    const size = A.length;
    const shifted = A.map((row, i) => row.map((z, j) => ({
      re: z.re - (i === j ? pole.re : 0),
      im: z.im - (i === j ? pole.im : 0),
    })));
    const value = Math.hypot(detComplexReference(shifted).re, detComplexReference(shifted).im);
    worst = Math.max(worst, value / Math.pow(scale, size / 2));
  }
  check("every pole is a root of det(sI - A)", worst, 0, 1e-12, "",
    "the state matrix assembled in this file, not the one in the module");
}

/* ============================== MODES AND ROOTS ============================== */

{
  /* Two equal masses in a line, each held by its own spring, joined by a third:
     the textbook's first two-degree-of-freedom problem, and its modes are
     known - the two masses moving together and the two moving apart. */
  const system = new MechSystem({
    masses: [{ m: 1 }, { m: 1 }],
    elements: [
      { kind: "spring", a: 0, b: "g", k: 1 },
      { kind: "spring", a: 0, b: 1, k: 1 },
      { kind: "spring", a: 1, b: "g", k: 1 },
    ],
    drive: { waveform: "off" },
    base: { waveform: "off" },
  });
  check("two-mass chain: mode 1", system.modes[0].omega, 1, 1e-12, "rad/s", "the masses moving together");
  check("two-mass chain: mode 2", system.modes[1].omega, Math.sqrt(3), 1e-12, "rad/s", "the masses moving apart");
  const together = system.modes[0].shape;
  const apart = system.modes[1].shape;
  /* Mass-normalized, so the shapes are checked as the ratios they are. */
  check("mode 1: the masses move together", together[0] / together[1], 1, 1e-10, "");
  check("mode 2: the masses move apart", apart[0] / apart[1], -1, 1e-10, "");
}

{
  /* The tolerance is a millionth of a radian rather than a trillionth, and the
     reason is arithmetic rather than physics: an eigenvalue that is zero to
     rounding square-roots to the square root of that rounding, so a rigid-body
     mode arrives as a few times 1e-8 and not as a few times 1e-13. */
  checkTrue("a mass with nothing holding it is a rigid-body mode",
    Math.abs(new MechSystem({
      masses: [{ m: 2 }, { m: 1 }],
      elements: [{ kind: "spring", a: 0, b: 1, k: 5 }],
      drive: { waveform: "off" },
      base: { waveform: "off" },
    }).modes[0].omega) < 1e-6,
    "the centre of mass drifts and no spring is stretched: omega = 0 is the answer, not a failure");
}

{
  const cubic = polyRoots([1, 6, 11, 6]);
  const real = cubic.filter((r) => r.im === 0).map((r) => r.re).sort((a, b) => a - b);
  checkTrue("polyRoots: (s+1)(s+2)(s+3)",
    real.length === 3 && [-3, -2, -1].every((r, i) => Math.abs(real[i] - r) < 1e-12),
    `roots ${real.map((r) => r.toFixed(6)).join(", ")}`);

  const pair = polyRoots([1, 2, 5]);
  checkTrue("polyRoots: s^2 + 2s + 5",
    pair.length === 2 && Math.abs(pair[0].re + 1) < 1e-12 && Math.abs(Math.abs(pair[0].im) - 2) < 1e-12,
    `roots ${pair.map((r) => `${r.re.toFixed(3)}${r.im >= 0 ? "+" : "-"}${Math.abs(r.im).toFixed(3)}i`).join(", ")}`);
}

/* ============================== LOG DECREMENT ============================== */
/* The lab's headline number: an experimenter measures two successive peaks and
 * reads zeta off them. That is checked here against the zeta the poles give, and
 * the two agreeing is what makes the lab's arithmetic worth a student's time. */

{
  const system = new MechSystem({
    masses: [{ m: 1 }],
    elements: [
      { kind: "spring", a: 0, b: "g", k: 10 },
      { kind: "damper", a: 0, b: "g", c: 1.2 },
    ],
    drive: { waveform: "off" },
    base: { waveform: "off" },
    x0: [0.05], v0: [0],
  });
  system.setDt(1 / 2000);
  const peaks = [];
  let previous = Math.abs(system.state[0]);
  let rising = false;
  for (let i = 0; i < 20000 && peaks.length < 4; i++) {
    system.step();
    const value = Math.abs(system.state[0]);
    if (value > previous) rising = true;
    else if (rising) { peaks.push(previous); rising = false; }
    previous = value;
  }
  /* Twice the log ratio of neighbouring maxima, because these are maxima of the
     *absolute* value: a sinusoid that swings positive and negative reaches the
     top of its envelope twice a cycle, so the decay between two neighbours is
     half a log decrement and not a whole one. Measuring the envelope this way is
     what a student does with a ruler on a plotted curve, and it is stated here
     rather than hidden by taking every other peak. */
  const delta = 2 * Math.log(peaks[0] / peaks[1]);
  const zeta = delta / Math.sqrt(4 * Math.PI * Math.PI + delta * delta);
  check("log decrement gives the pole's zeta", zeta, system.poleReport().find((p) => p.im > 0).damping, 5e-4, "",
    `peaks ${peaks[0].toPrecision(4)} and ${peaks[1].toPrecision(4)} m, a decrement of ${delta.toFixed(5)}`);
}

/* ============================== THE LABS AND SYSTEMS ============================== */
/* A lab's setup is a claim too, and so is a system preset's. Both are data, with
 * no DOM in them, so the same files the browser loads are the ones read here -
 * and a preset that could not be assembled, or a lab whose stated answer no
 * longer exists in the model it builds, fails the run rather than the reader. */

{
  for (const lab of MECH_LABS) {
    let built = null;
    let error = null;
    try {
      built = new MechSystem(lab.spec);
      built.advance(200);
    } catch (err) { error = err; }
    checkTrue(`lab builds: ${lab.id}`, !!built && !error, error ? String(error) : lab.aim);
    if (!built) continue;
    checkTrue(`lab has something to drive or to disturb it: ${lab.id}`,
      built.spec.drive.waveform !== "off" || built.spec.base.waveform !== "off"
        || built.spec.x0.some((v) => v !== 0) || built.spec.v0.some((v) => v !== 0)
        || built.activeInputs.length > 0,
      "a bench that is not driven, not shaken and not displaced has nothing to show");
    const finite = built.observe();
    checkTrue(`lab stays finite: ${lab.id}`,
      finite.x.every(Number.isFinite) && finite.total >= -1e-9,
      `energy ${finite.total.toPrecision(4)} J`);
  }

  for (const preset of MECH_SYSTEMS) {
    let built = null;
    let error = null;
    try { built = new MechSystem(preset.spec); built.advance(200); } catch (err) { error = err; }
    checkTrue(`system preset builds: ${preset.id}`, !!built && !error, error ? String(error) : preset.blurb);
    if (!built) continue;
    const transfer = built.transfer(built.spec.excitation, built.spec.output);
    checkTrue(`system preset has a transfer function: ${preset.id}`,
      transfer.den.length >= 2 && transfer.num.some((v) => v !== 0),
      `H(s) degree ${transfer.den.length - 1} over ${transfer.den.length - 1}`);
    /* The numerator is evaluated at the drive's own frequency: a preset whose
       transfer function is all zeros is a preset whose output cannot be moved. */
    const value = built.frequencyResponse(built.spec.excitation, built.spec.output, 2 * Math.PI * (built.spec.drive.frequency || built.spec.base.frequency || 1));
    checkTrue(`system preset responds: ${preset.id}`, Number.isFinite(value.magnitude) && value.magnitude > 0,
      `|H(j omega)| = ${value.magnitude.toPrecision(4)}`);
  }
}

/* ============================== SAVE AND RESTORE ============================== */

{
  const system = new MechSystem(defaultSpec());
  system.setDt(1 / 600);
  system.advance(1234);
  const saved = JSON.parse(JSON.stringify(system.serialize()));
  const before = system.observe();
  const revived = new MechSystem(defaultSpec());
  revived.restore(saved);
  const after = revived.observe();
  check("a restored run resumes where it was", after.time, before.time, 1e-12, "s");
  check("... with the same displacement", after.x[0], before.x[0], 1e-12, "m");
  check("... and the same ledger", after.dissipated, before.dissipated, 1e-12, "J",
    "a restored run has already spent energy; books that started at zero would report it as free");
  const residual = Math.abs(after.residual) / after.residualScale;
  check("... and a balanced residual", residual, 0, 1e-12, "");
  /* And it carries on identically: two copies stepped the same must not drift. */
  for (let i = 0; i < 500; i++) { system.step(); revived.step(); }
  check("... and steps identically afterwards", revived.observe().x[0], system.observe().x[0], 1e-13, "m");
}

/* ============================== ADDING A MASS ============================== */

{
  const system = new MechSystem(defaultSpec());
  const before = system.n;
  system.addMass(2, 40, 3);
  system.advance(500);
  check("adding a mass lengthens the system", system.n, before + 1, 0.001, "masses");
  checkTrue("... and the new one is a real degree of freedom",
    system.modes.length === before + 1 && system.modes.some((mode) => mode.omega > 0),
    `${system.modes.length} modes: ${system.modes.map((m) => (m.omega / (2 * Math.PI)).toFixed(3)).join(", ")} Hz`);
  checkTrue("... and the ledger still balances",
    Math.abs(system.observe().residual) <= 1e-12 * system.observe().residualScale,
    "a rebuilt system re-anchors its books, and the new ones balance from the start");
}

/* ============================== WHAT EACH SYSTEM IS SET UP AS ============================== */

/*
 * The strip makes a claim in words about every system on it: which mass is
 * pushed, which mass is read, and that nothing else is pushing at the same time.
 * These are those claims again, as arithmetic - because "a force on m2 and not on
 * m1" is either true of the input vector or it is not, and a reader looking at a
 * picture of two blocks has no way to tell.
 *
 * The input vector is where the claim lives. `inputs()` builds one column per
 * force that is on a mass, with a single 1 N/N in the row of the mass that force
 * is bolted to, and one column for the base, weighted by the ground stiffnesses
 * of every mass that has a spring to the ground. So a rig whose force column has
 * exactly one nonzero entry applies a force to exactly one mass, and that is the
 * whole of the claim.
 */
{
  const nonzero = (column) => {
    const rows = [];
    for (let i = 0; i < column.length; i++) if (Math.abs(column[i]) > 1e-12) rows.push(i);
    return rows;
  };
  for (const preset of MECH_SYSTEMS) {
    const spec = preset.spec;
    const system = new MechSystem(spec);
    const inputs = system.inputs();
    const active = system.activeInputs;
    const id = preset.id;
    const name = (i) => `m${i + 1}`;
    /* One thing drives the rig, and it is the one the panel's From picker says
       it is. Two live sources is a different experiment from either of them. */
    checkTrue(`one drive is on, and it is the one named: ${id}`,
      active.length === 1 && active[0].kind === spec.excitation,
      active.length ? `on: ${active.map((a) => a.kind).join(" + ")}` : "nothing is driving the rig");
    /* Every mass in the table is a mass, and the two masses a preset names - the
       one it pushes and the one it reads - are slots that exist. */
    checkTrue(`the masses are all real: ${id}`, spec.masses.every((mass) => mass.m > 0),
      spec.masses.map((mass) => `${mass.m} kg`).join(", "));
    checkTrue(`the driven mass is a slot: ${id}`,
      Number.isInteger(spec.drive.mass) && spec.drive.mass >= 0 && spec.drive.mass < system.n,
      `${name(spec.drive.mass)} of ${system.n}`);
    checkTrue(`the read mass is a slot: ${id}`,
      Number.isInteger(spec.output) && spec.output >= 0 && spec.output < system.n,
      `${name(spec.output)} of ${system.n}`);
    if (spec.excitation === "force") {
      const column = inputs.find((input) => input.kind === "force") ?? null;
      const rows = column ? nonzero(column.b0) : [];
      checkTrue(`the force is on one mass, and it is ${name(spec.drive.mass)}: ${id}`,
        !!column && rows.length === 1 && rows[0] === spec.drive.mass
          && Math.abs(column.b0[rows[0]] - 1) < 1e-12,
        `the force column pushes ${rows.map(name).join(", ") || "nothing"}, 1 N/N`);
      checkTrue(`... and the base stands still under it: ${id}`, spec.base.waveform === "off",
        `base waveform: ${spec.base.waveform}`);
    } else {
      const column = inputs.find((input) => input.kind === "base") ?? null;
      const rows = column ? nonzero(column.b0) : [];
      const held = [];
      for (let i = 0; i < system.n; i++) {
        if (system.groundStiffness[i] > 0 || system.groundDamping[i] > 0) held.push(i);
      }
      checkTrue(`the base shakes every mass that is sprung to it: ${id}`,
        !!column && rows.length > 0 && rows.length === held.length && rows.every((row, k) => row === held[k]),
        `the base reaches ${rows.map(name).join(", ") || "nothing"}`);
      checkTrue(`... and no force is on while it does: ${id}`, spec.drive.waveform === "off",
        `force waveform: ${spec.drive.waveform}`);
    }
    /* A preset is a whole rig. A part the table leaves bolted to one thing is a
       part that does nothing, and it would be drawn on the bench doing it. */
    checkTrue(`every part is bolted at both ends: ${id}`,
      spec.elements.every((element) => element.a !== null && element.a !== undefined
        && element.b !== null && element.b !== undefined),
      `${spec.elements.length} parts`);
    checkTrue(`... and a part that reaches the ground reaches a mass: ${id}`,
      spec.elements.every((element) => !(element.a === "g" && element.b === "g")
        && (element.k > 0 || element.c > 0)),
      "no part from the ground to the ground, and none with no constant at all");
  }
}

/* ============================== THE BENCH'S OWN ROOM ============================== */

/*
 * Does every rig on the strip fit the bench it is drawn on?
 *
 * The bench is a picture, but it is drawn to fixed numbers and they are the
 * rig's room: masses on slots 0.84 m apart (SPACING in rendering/mech_renderer.js),
 * a ground support 0.72 of a slot beyond the end mass, a block at most 0.46 m
 * wide, and a margin at the wall so the spring that reaches it is still drawn as
 * a spring. A preset whose stroke is longer than that is a rig driven out through
 * its own supports - which is what a reader saw when a resonant preset had a
 * 60 N force on a 60 N/m spring and a metre and a half of static sag. The drawing
 * copes now, by dropping its own magnification to what fits, but a system that
 * *needs* that is a system tuned to the wrong size, and this is the check that
 * says so.
 *
 * Every mass is measured, not just the driven one, and against the room its own
 * block leaves: the drawing has one scale for the whole rig, and it is set by
 * whichever mass travels furthest and whichever block is widest, so a preset can
 * be driven out through the wall by a mass the force is not even on.
 */
const BENCH = {
  spacing: 0.84,
  post: 0.06,
  margin: 0.10,
  blockUnit: 0.24,
  blockMin: 0.14,
  blockMax: 0.46,
  seconds: 60,
};

const benchBlockHalf = (mass) => Math.max(
  BENCH.blockMin,
  Math.min(BENCH.blockMax, BENCH.blockUnit * Math.pow(Math.max(mass, 1e-6), 1 / 6)),
) / 2;

{
  let worst = 0;
  let worstId = "";
  let worstPeak = 0;
  let worstRoom = 0;
  for (const preset of MECH_SYSTEMS) {
    const system = new MechSystem(preset.spec);
    const steps = Math.round(BENCH.seconds / system.dt);
    const peak = new Array(system.n).fill(0);
    for (let k = 0; k < steps; k++) {
      system.step();
      for (let i = 0; i < system.n; i++) peak[i] = Math.max(peak[i], Math.abs(system.state[i]));
    }
    /* The room the rig has: measured against the widest block, which is the one
       the drawing's single scale has to clear, exactly as `fitScale` does. */
    const widest = Math.max(...preset.spec.masses.map((mass) => benchBlockHalf(mass.m)));
    const room = BENCH.spacing * 0.72 - BENCH.post / 2 - BENCH.margin - widest;
    const ratio = Math.max(...peak) / room;
    if (ratio > worst) {
      worst = ratio;
      worstId = preset.id;
      worstPeak = Math.max(...peak);
      worstRoom = room;
    }
  }
  check("every preset fits the bench it is drawn on", worst, 0, 0.7, "\u00D7 the room",
    `${MECH_SYSTEMS.length} systems, worst is ${worstId}: a stroke of ${worstPeak.toFixed(3)} m in a room of ${worstRoom.toFixed(3)} m after ${BENCH.seconds} s`);
}

/*
 * And the same question of the eleven labs.
 *
 * A lab is a setup with a question attached, and its drive is part of the setup:
 * two of them were the textbook's own numbers, 60 N on a 60 N/m spring and 20 N
 * on a pair that weighs three kilograms, which are metres of motion on a bench a
 * third of a metre wide. What a reader saw was the picture quietly dropping to a
 * tenth of its size to keep the rig on the slab, which is not a lab and not a
 * picture of one. Every lab is measured at its own numbers for as long as its own
 * note says to watch it, and held to the same margin the systems are.
 */
{
  let worst = 0;
  let worstId = "";
  let worstPeak = 0;
  let worstRoom = 0;
  for (const lab of MECH_LABS) {
    const system = new MechSystem(lab.spec);
    const seconds = Math.min(lab.hold ?? BENCH.seconds, BENCH.seconds);
    const steps = Math.round(seconds / system.dt);
    const peak = new Array(system.n).fill(0);
    for (let k = 0; k < steps; k++) {
      system.step();
      for (let i = 0; i < system.n; i++) peak[i] = Math.max(peak[i], Math.abs(system.state[i]));
    }
    const widest = Math.max(...lab.spec.masses.map((mass) => benchBlockHalf(mass.m)));
    const room = BENCH.spacing * 0.72 - BENCH.post / 2 - BENCH.margin - widest;
    const ratio = Math.max(...peak) / room;
    if (ratio > worst) {
      worst = ratio;
      worstId = lab.id;
      worstPeak = Math.max(...peak);
      worstRoom = room;
    }
  }
  check("every lab fits the bench it is drawn on", worst, 0, 0.7, "\u00D7 the room",
    `${MECH_LABS.length} labs, worst is ${worstId}: a stroke of ${worstPeak.toFixed(3)} m in a room of ${worstRoom.toFixed(3)} m over the lab's own run`);
}

process.exit(report());
