/**
 * frontend/mech_labs.js - the experiments on the Vibrations lab bench.
 *
 * Data only, exactly like frontend/thermo_labs.js and frontend/labs.js: each
 * entry is a system to build and a question to answer, and frontend/mech_main.js
 * owns the building. The shape of an entry is the shape of the workbench's own
 * state, so every lab is a setup a student could have made by hand with the
 * panels - and every one of them is a *starting point*: nothing is locked once
 * it is on the stage, and the parameters it sets are the same parameters the
 * rails edit.
 *
 * `aim` states the result in one line and `asks` gives two things to try,
 * because a list of instructions is a worksheet and two questions are an
 * experiment. Nothing here is longer than that on purpose.
 *
 * `hold` is how many seconds of the system's own time the scene is worth
 * watching for before its numbers mean anything - a lightly damped resonator
 * takes ten or twenty seconds to settle, and the panel quotes that instead of
 * leaving a student to wonder whether it is broken. `holdUnit` is the word that
 * belongs after it, because the Thermo bench measures its runs in picoseconds
 * and this one measures them in seconds.
 *
 * `setup` is the bench said out loud, in the numbers the panels are set to, for
 * the reader who wants to know what was switched on before they start.
 *
 * ---------------------------------------------------------------------------
 * THE THREE FIGURES
 * ---------------------------------------------------------------------------
 * Three of these labs are the problems a system-dynamics course sets on paper,
 * and they are here for the reason a lab bench exists: the answer a student
 * derives by hand is on the right rail as a transfer function, and the same
 * answer can then be *measured* by running it. They are the two coupled pairs -
 * blocks joined by friction, masses joined by a damper - and the quarter car.
 *
 * The systems are the same nodes and elements as everything else on this bench:
 * "g" is the ground, a spring or damper reaches it or joins two masses, and the
 * force or the base motion is the input. A figure is not a special case in the
 * model; it is a particular set of numbers in it.
 *
 * ---------------------------------------------------------------------------
 * WHAT A LAB DOES NOT SET
 * ---------------------------------------------------------------------------
 * No lab names a view mode - a system is drawn in whichever of the two views the
 * reader is already in - and no lab sets a step size. The step is a reporting
 * choice here rather than an accuracy one (the integration is exact), so a lab
 * that dictated it would be dictating how finely to read a plot.
 */

/** One mass on one spring and one damper, which half of the labs here begin
 *  from. Written as a function because a lab that changes only the damping is
 *  still a lab about a system, and the reader can see exactly which number
 *  moved. */
function single({ m = 1, k = 10, c = 0.5, x0 = 0, v0 = 0, drive = null, base = null, output = 0 } = {}) {
  return {
    masses: [{ m }],
    elements: [
      { kind: "spring", a: 0, b: "g", k },
      { kind: "damper", a: 0, b: "g", c },
    ],
    drive: drive ?? { mass: 0, waveform: "off", amplitude: 1, frequency: 0.5 },
    base: base ?? { waveform: "off", amplitude: 0.01, frequency: 1 },
    excitation: base && base.waveform !== "off" ? "base" : "force",
    output,
    x0: [x0],
    v0: [v0],
  };
}

/** The chain the two coupled-pair labs are built on: `links` join two masses,
 *  `grounds` hold one to the ground, and neither is generated because the point
 *  of a figure is which element goes where. */
function bench(masses, links, grounds, drive, output, extra = {}) {
  const elements = [];
  for (const [a, b, k, c] of links) {
    if (k) elements.push({ kind: "spring", a, b, k });
    if (c) elements.push({ kind: "damper", a, b, c });
  }
  for (const [a, k, c] of grounds) {
    if (k) elements.push({ kind: "spring", a, b: "g", k });
    if (c) elements.push({ kind: "damper", a, b: "g", c });
  }
  return {
    masses: masses.map((m) => ({ m })),
    elements,
    drive,
    base: { waveform: "off", amplitude: 0.01, frequency: 1 },
    excitation: "force",
    output,
    x0: masses.map(() => 0),
    v0: masses.map(() => 0),
    ...extra,
  };
}

export const MECH_LABS = [
  {
    id: "one-dof",
    name: "One degree of freedom",
    aim: "f\u2099 = (1/2\u03C0)\u221A(k/m): a plucked system rings at exactly that frequency.",
    asks: [
      "Read the period off the response and compare it with 2\u03C0\u221A(m/k) = 1.99 s.",
      "Change the mass to 4 kg: the frequency should halve. Does it?",
    ],
    spec: single({ m: 1, k: 10, c: 0.05, x0: 0.06 }),
    setup: "A 1 kg mass on a 10 N/m spring with a whisper of damping, displaced 60 mm and let go.",
    hold: 20,
    holdUnit: "s",
  },
  {
    id: "log-decrement",
    name: "Logarithmic decrement",
    aim: "\u03B4 = ln(x\u2081/x\u2082), and \u03B6 = \u03B4/\u221A(4\u03C0\u00B2 + \u03B4\u00B2): two peaks give the damping ratio.",
    asks: [
      "Measure the first two peaks and work out \u03B6, then check it against the value the poles give.",
      "Set the damper to 1.2 N s/m: does \u03B6 double?",
    ],
    spec: single({ m: 1, k: 10, c: 0.6, x0: 0.06 }),
    setup: "A 1 kg mass on a 10 N/m spring, 0.6 N s/m of damping, released from 60 mm.",
    hold: 20,
    holdUnit: "s",
  },
  {
    id: "overshoot",
    name: "Step response and overshoot",
    aim: "M_p = exp(-\u03C0\u03B6/\u221A(1-\u03B6\u00B2)): the overshoot of a step is a function of \u03B6 alone.",
    asks: [
      "Read the first peak and divide it by the value it settles at.",
      "Set the damping to 1.0, then to 2.0: where does the overshoot go?",
    ],
    spec: single({
      m: 1, k: 10, c: 1,
      /* 1.5 N, not 2: a step of 2 N settles at 0.2 m and overshoots to 0.32 m,
         and a 1 kg block has 0.355 m of bench between its wall and its own
         spring - so the lesson was being drawn a hand's width from the far end
         of the slab. The overshoot is a ratio, so the smaller step teaches the
         same thing with the whole swing on the bench. */
      drive: { mass: 0, waveform: "step", amplitude: 1.5, frequency: 0.5 },
    }),
    setup: "A 1 kg mass on a 10 N/m spring with 1.0 N s/m of damping, and a 1.5 N force switched on at the start.",
    hold: 8,
    holdUnit: "s",
  },
  {
    id: "resonance",
    name: "Resonance",
    aim: "At \u03C9 = \u03C9\u2099 a lightly damped system settles at Q = 1/(2\u03B6) times its static deflection.",
    asks: [
      "Let it settle, then divide the amplitude by the static deflection F/k = 0.02 m.",
      "Move the drive frequency off resonance and watch the amplitude fall away.",
    ],
    spec: single({
      m: 1, k: 10, c: 0.6,
      drive: { mass: 0, waveform: "sine", amplitude: 0.2, frequency: Math.sqrt(10) / (2 * Math.PI) },
    }),
    setup: "A 0.2 N harmonic force at 0.503 Hz - the system's own frequency - on a 1 kg mass on a 10 N/m spring.",
    hold: 60,
    holdUnit: "s",
  },
  {
    id: "friction-pair",
    name: "Two blocks, friction-coupled",
    aim: "x\u2081/f = B\u2081s / \u0394(s): the upper block hears the lower one only through the friction, so the numerator vanishes when the coupling does.",
    asks: [
      "Read H(s) and the poles off the panel, then check the amplitude against a settling run.",
      "Set the friction B\u2081 to zero: the upper block stops moving and its transfer function becomes zero.",
    ],
    spec: bench(
      [2.5, 4],
      [[0, 1, 0, 1.5]],
      [[1, 60, 0.8]],
      /* The drive is the one number here set to the bench rather than to the
         figure: 60 N on a 60 N/m spring is a metre of static sag, and the rig
         has a third of a metre of bench. The transfer function this lab is
         about is a ratio, so how hard it is pushed changes nothing it teaches. */
      { mass: 1, waveform: "sine", amplitude: 5, frequency: 0.4 },
      0,
    ),
    setup: "A 2.5 kg block resting on a 4 kg block through 1.5 N s/m of friction; the lower block on a 60 N/m spring and a 0.8 N s/m damper, driven by a 5 N force at 0.4 Hz.",
    hold: 30,
    holdUnit: "s",
  },
  {
    id: "coupled-dampers",
    name: "Two masses, one damper",
    aim: "With a damper and no spring between them, a force on one reaches the other only at frequency: the DC gain is zero.",
    asks: [
      "Read H(s), then push the drive frequency down towards zero and watch the amplitude go with it.",
      "Set the damping to zero: the second mass stops hearing the first at all.",
    ],
    spec: bench(
      [1, 2],
      [[0, 1, 0, 2]],
      [[0, 20, 0], [1, 15, 0]],
      /* 1 N rather than 20, for the same reason as the friction pair above: the
         floor is a bench and not a page, and the lesson here is a transfer
         function - which is a ratio, and blind to the size of the push. */
      { mass: 1, waveform: "sine", amplitude: 1, frequency: 0.5 },
      0,
    ),
    setup: "A 1 kg mass on a 20 N/m spring and a 2 kg mass on a 15 N/m spring, joined by a 2 N s/m damper, driven on the 2 kg mass by a 1 N force at 0.5 Hz.",
    hold: 30,
    holdUnit: "s",
  },
  {
    id: "quarter-car",
    name: "The quarter car",
    aim: "Body on suspension over wheel on tyre: about 1.5 Hz of ride and 12 Hz of wheel hop.",
    asks: [
      "Read the two poles' frequencies and compare them with \u221A(k/m) for each mass on its own.",
      "Shake it at 12.1 Hz and compare the body's motion with the road's. Which element did that?",
    ],
    spec: bench(
      [40, 300],
      [[0, 1, 30e3, 2e3]],
      [[0, 200e3, 200]],
      { mass: 0, waveform: "off", amplitude: 1, frequency: 1 },
      1,
      {
        base: { waveform: "sine", amplitude: 0.01, frequency: 1.2 },
        excitation: "base",
        elements: [
          { kind: "spring", a: 0, b: "g", k: 200e3 },
          { kind: "damper", a: 0, b: "g", c: 200 },
          { kind: "spring", a: 0, b: 1, k: 30e3 },
          { kind: "damper", a: 0, b: 1, c: 2e3 },
        ],
      },
    ),
    setup: "300 kg of body on a 30 kN/m suspension over a 40 kg wheel on a 200 kN/m tyre, with the road moving 10 mm at 1.2 Hz.",
    hold: 30,
    holdUnit: "s",
  },
  {
    id: "isolation",
    name: "Vibration isolation",
    aim: "Above \u221A2 \u03C9\u2099 a mounting passes less than it is given, and the ratio falls as 1/\u03C9\u00B2.",
    asks: [
      "The base is shaking at the mounting's own 0.8 Hz, which is the worst case there is. Move it up: where does the mass move exactly as much as the base, and is that \u221A2 f\u2099?",
      "Go well above it: how much quieter than the road is the mass at eight times f\u2099?",
    ],
    spec: single({
      m: 1, k: 25, c: 0.3,
      /* 0.8 Hz is the mounting's own frequency, so the mass starts at the worst
         case it will ever see - and 15 mm of shake rather than 20 keeps that
         worst case on the bench, where the whole of it can be watched. */
      base: { waveform: "sine", amplitude: 0.015, frequency: 0.8 },
    }),
    setup: "One mass on a 25 N/m spring and a 0.3 N s/m damper over a base shaken 15 mm at 0.8 Hz. Nothing else holds it.",
    hold: 30,
    holdUnit: "s",
  },
  {
    id: "absorber",
    name: "The tuned mass damper",
    aim: "A small mass tuned to the big one's own frequency takes the motion instead of the structure.",
    asks: [
      "Drive the big mass at its own frequency and see which of the two is moving.",
      "Detune the absorber's spring and the big mass rings again.",
    ],
    spec: bench(
      [1000, 100],
      [[0, 1, 4000, 20]],
      [[0, 40000, 500]],
      { mass: 0, waveform: "sine", amplitude: 200, frequency: Math.sqrt(40000 / 1000) / (2 * Math.PI) },
      0,
    ),
    setup: "A 1000 kg structure on a 40 kN/m spring with 500 N s/m of damping, and a 100 kg mass sprung off it at 4 kN/m - tuned to the structure's own 1.006 Hz.",
    hold: 90,
    holdUnit: "s",
  },
  {
    id: "two-modes",
    name: "Two frequencies, two shapes",
    aim: "A two-degree-of-freedom system has two natural frequencies, and one shape for each of them.",
    asks: [
      "Displace both masses the same way and let go: the motion is one pure mode.",
      "Press Restart, then drag one mass the other way: now it rings in the other mode.",
    ],
    spec: bench(
      [1, 1],
      [[0, 1, 10, 0.05]],
      [[0, 10, 0.05], [1, 10, 0.05]],
      { mass: 1, waveform: "off", amplitude: 1, frequency: 0.5 },
      1,
      { x0: [0.05, 0.05] },
    ),
    setup: "Two 1 kg masses, each on a 10 N/m spring and joined by a third, both displaced 50 mm the same way.",
    hold: 20,
    holdUnit: "s",
  },
  {
    id: "impulse",
    name: "A blow",
    aim: "An impulse changes a velocity, not a position, and what follows is the system's own response.",
    asks: [
      "Read the first peak: for a light damper it is about v\u2080/\u03C9\u2099.",
      "Change the impulse from 0.5 to 1.0 N s: the whole response should double.",
    ],
    spec: single({
      m: 1, k: 10, c: 0.2,
      drive: { mass: 0, waveform: "impulse", amplitude: 0.5, frequency: 0.5 },
    }),
    setup: "A 0.5 N s blow to a 1 kg mass on a 10 N/m spring with 0.2 N s/m of damping - 0.5 m/s, and then nothing.",
    hold: 15,
    holdUnit: "s",
  },
];
