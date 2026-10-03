/**
 * frontend/mech_systems.js - the systems the Vibrations stage is built out of.
 *
 * Data only, exactly like the Dynamics bench's SHAPE_PRESETS: each entry is a
 * topology to build, and frontend/mech_main.js owns the building of it. This is
 * the list the strip in the corner of the stage is drawn from, and it is the
 * same kind of list - a system is chosen the way a shape is, by recognising its
 * outline rather than by reading its name.
 *
 * A preset is a *whole* system rather than a part of one, and that is the one
 * place this table differs from the shapes next door. Throwing a sphere into a
 * scene adds to it; a mechanical system is the entire experiment, so choosing one
 * replaces the model rather than adding to it. What survives is what the panels
 * are set to - nothing in this file sets a view mode, a step size or a page.
 *
 * Every entry is written in the same units the panels show: kilograms, newtons
 * per metre, newtons per metre per second, newtons, hertz, metres. The numbers
 * are the textbook's own - a 1 kg mass on a 10 N/m spring, a 300 kg car body on
 * a 30 kN/m suspension over a 40 kg wheel on a 200 kN/m tyre - so that a reader
 * who works one of these out on paper arrives at the panel's answer.
 *
 * The *force* is the one number here that is set to the bench rather than to the
 * textbook. A rig on this bench is a hand's width of apparatus on a slab just
 * over a metre and a half long, with its ground supports a third of a metre from
 * the masses they hold, and a force chosen for a paper exercise - 60 N on a
 * 60 N/m spring, which is a metre of static deflection before resonance even
 * starts - drives the block straight out through its own supports. So each large
 * system's drive is set to the largest push that still leaves the rig's stroke
 * inside its own bench at life size, which is what `experiments/mech_checks.js`
 * measures every one of them against. The stiffnesses, the masses and the damping
 * are untouched: the systems are the textbook's, at a size a bench can hold.
 *
 * `blurb` is the one line an option says of itself on hover and to a screen
 * reader. It says what the system is *for* rather than how to use it, because
 * that is the question a strip of systems raises.
 *
 * Node labels: `a` and `b` are mass indices, left to right along the track, or
 * "g" for the ground. A spring from a mass to "g" is drawn to one of the two
 * hatched walls at the ends; a spring between two masses is drawn as a coil in
 * the line between them, or as an arc over the top when the two are not
 * neighbours - which is how the textbook draws the one that reaches across.
 */

/** The two springs and two dampers of a chain link, written out rather than
 *  generated: a table a reader can check against a figure is worth more than a
 *  loop, and there are only a handful of entries. */
const chain = (masses, links, grounds) => {
  const elements = [];
  for (const [a, b, k, c] of links) {
    if (k) elements.push({ kind: "spring", a, b, k });
    if (c) elements.push({ kind: "damper", a, b, c });
  }
  for (const [a, k, c] of grounds) {
    if (k) elements.push({ kind: "spring", a, b: "g", k });
    if (c) elements.push({ kind: "damper", a, b: "g", c });
  }
  return { masses: masses.map((m) => ({ m })), elements };
};

const TWO = 2 * Math.PI;

/** The absorber is tuned the way a real one is: its own frequency, sqrt(k2/m2),
 *  set equal to the main mass's, sqrt(k1/m1) = sqrt(40000/1000) = 6.3246 rad/s.
 *  Written as the sum it is rather than as the 1.0066 it comes to, so the table
 *  still says what it means if someone retunes the springs above it. */
const ABSORBER_HZ = Math.sqrt(40000 / 1000) / TWO;

export const MECH_SYSTEMS = [
  {
    id: "single",
    name: "One mass",
    icon: "Square",
    blurb: "One mass, one spring, one damper: the system every other one in this list is measured against. The force is on m\u2081, at m\u2081's own frequency, and m\u2081 is what is read - so the motion grows to several times its static sag.",
    spec: {
      ...chain([1], [], [[0, 10, 0.5]]),
      drive: { mass: 0, waveform: "sine", amplitude: 0.3, frequency: 0.503 },
      base: { waveform: "off", amplitude: 0.01, frequency: 0.5 },
      excitation: "force",
      output: 0,
    },
  },
  {
    id: "chain",
    name: "Two in a line",
    icon: "AlignHorizontalDistributeCenter",
    blurb: "Two masses in a line, joined by a spring and a damper, each held to the ground by its own: the first system with two frequencies to find. The force is on the far mass, m\u2082, and the response is read from m\u2081 - so the push has to reach it the length of the spring between them.",
    spec: {
      ...chain([1, 1], [[0, 1, 10, 0.1]], [[0, 10, 0.2], [1, 10, 0.2]]),
      drive: { mass: 1, waveform: "sine", amplitude: 0.25, frequency: 0.5 },
      base: { waveform: "off", amplitude: 0.01, frequency: 0.5 },
      excitation: "force",
      output: 0,
    },
  },
  {
    id: "friction",
    name: "Friction pair",
    icon: "Layers",
    blurb: "A block resting on a block, joined by viscous friction. The lower block, m\u2082, is held to the ground by a spring and a damper and is the one the force shakes; m\u2081 rides on top of it, and what it does is the question.",
    spec: {
      ...chain([2.5, 4], [[0, 1, 0, 1.5]], [[1, 60, 0.8]]),
      drive: { mass: 1, waveform: "sine", amplitude: 5, frequency: 0.4 },
      base: { waveform: "off", amplitude: 0.01, frequency: 0.5 },
      excitation: "force",
      output: 0,
    },
  },
  {
    id: "coupled-dampers",
    name: "Two, one damper",
    icon: "ArrowLeftRight",
    blurb: "Two masses held to the ground by their own springs and joined to each other by a damper alone: the force is on m\u2082 and m\u2081 is read, so whatever reaches m\u2081 got there through the fluid and not through a spring.",
    spec: {
      ...chain([1, 2], [[0, 1, 0, 2]], [[0, 20, 0], [1, 15, 0]]),
      drive: { mass: 1, waveform: "sine", amplitude: 1, frequency: 0.5 },
      base: { waveform: "off", amplitude: 0.01, frequency: 0.5 },
      excitation: "force",
      output: 0,
    },
  },
  {
    id: "quarter-car",
    name: "Quarter car",
    icon: "Car",
    blurb: "A quarter of a car: the wheel, m\u2081, on its tyre, with the road shaking it from below, and the body, m\u2082, on its suspension above it. The body is what is read - and it moves millimetres, so this is the system the Magnify the motions slider is for.",
    spec: {
      ...chain([40, 300], [[0, 1, 30e3, 2e3]], [[0, 200e3, 200]]),
      drive: { mass: 0, waveform: "off", amplitude: 1, frequency: 1 },
      base: { waveform: "sine", amplitude: 0.01, frequency: 1.2 },
      excitation: "base",
      output: 1,
    },
  },
  {
    id: "absorber",
    name: "Absorber",
    icon: "Target",
    blurb: "A small mass, m\u2082, sprung off a big one, m\u2081, and tuned to the big one's own frequency: the damper that works by being wrong on purpose. The force is on m\u2081 and m\u2081 is what is read - and it is the small mass that moves.",
    spec: {
      ...chain([1000, 100], [[0, 1, 4000, 20]], [[0, 40000, 500]]),
      drive: { mass: 0, waveform: "sine", amplitude: 200, frequency: ABSORBER_HZ },
      base: { waveform: "off", amplitude: 0.01, frequency: 1 },
      excitation: "force",
      output: 0,
    },
  },
  {
    id: "three-mass",
    name: "Three in a line",
    icon: "Blocks",
    blurb: "Three equal masses in a line, each pair joined by a spring and the two ends held to the ground, with the middle one free: three frequencies, and one shape for each. The force is on the end mass, m\u2083, and the response is read from m\u2081 at the other end.",
    spec: {
      ...chain([1, 1, 1], [[0, 1, 20, 0.1], [1, 2, 20, 0.1]], [[0, 20, 0.1], [2, 20, 0.1]]),
      drive: { mass: 2, waveform: "sine", amplitude: 0.5, frequency: 1 },
      base: { waveform: "off", amplitude: 0.01, frequency: 0.5 },
      excitation: "force",
      output: 0,
    },
  },
];
