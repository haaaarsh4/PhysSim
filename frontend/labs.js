/**
 * frontend/labs.js - the experiments on the lab bench.
 *
 * Data only, like SHAPE_PRESETS: each entry is a scene to build, and
 * frontend/main.js owns the building of it. The shape of an entry is the shape
 * of the workbench's own state, so a lab is exactly the setup a student could
 * have made by hand with the panels - settings, shapes, where the balls start,
 * how fast they are going, and which one is worth watching.
 *
 * Two rules hold everything here together:
 *
 *   - Every lab is a *starting point*, not a canned animation. Once it is on
 *     the stage nothing is locked: the parameters, the shapes and the balls are
 *     the same objects the panels edit, and the lab's own questions can only be
 *     answered by changing them.
 *   - `aim` states the law in one line and `asks` gives two things to try,
 *     because a list of instructions is a worksheet, and two questions are an
 *     experiment. Nothing here is longer than that on purpose.
 *
 * No lab names a view mode. Every one of them is a real 3D scene - the shapes
 * are extruded through the world's depth and the balls live on all three axes -
 * so a lab is built in whichever of the two views the user is already in,
 * rather than dragging them out of the one they chose.
 *
 * Angles are in degrees (the panels quote degrees), positions in world metres,
 * forces in newtons. `friction` is the fraction of along-surface speed a contact
 * removes: 0 is a frictionless surface, which is the idealisation the textbook
 * formulas assume.
 */

/** vx, vy from a launch speed and an angle, so a lab can state the physics it
 *  means ("3 m/s at 45 degrees") instead of two decimals of components. */
function launch(speed, degrees) {
  const radians = (degrees * Math.PI) / 180;
  return [speed * Math.cos(radians), speed * Math.sin(radians), 0];
}

export const LABS = [
  {
    id: "free-fall",
    name: "Free fall",
    aim: "h = ½gt²: how long does a 1.20 m drop take?",
    asks: [
      "Predict the landing time first, then read it off the ball's flight time.",
      "Drop a bigger ball from the same height: does it fall any faster?",
    ],
    // A dead landing, on purpose: the ball's job here is to arrive once, at a
    // stopwatch reading that can be checked against sqrt(2h/g), and a ball that
    // bounces turns one landing into four.
    params: { gravity: 9.8, restitution: 0, drag: 0, friction: 0, collisions: true },
    spawn: { count: 1, radius: 0.06, pattern: "grid", height: 1.2, speed: 0, angle: 0 },
    place: [[0, null]], // null height = 1.20 m above the floor, see placeBall()
    objects: [],
    track: [0],
  },
  {
    id: "air-drag",
    name: "Fall with air",
    aim: "Air drag keeps a fall from ever speeding up for free.",
    asks: [
      "Compare the landing speed with the free-fall lab's.",
      "Drag scales the speed every step: find where it stops growing.",
    ],
    params: { gravity: 9.8, restitution: 0, drag: 0.012, friction: 0, collisions: true },
    spawn: { count: 1, radius: 0.06, pattern: "grid", height: 1.2, speed: 0, angle: 0 },
    place: [[0, null]],
    objects: [],
    track: [0],
  },
  {
    id: "projectile",
    name: "Projectile motion",
    aim: "Range = v² sin 2θ / g for a launch from level ground.",
    asks: [
      "Measure the range from the ball's reading and compare with the formula.",
      "Try 30° and 60°: which flies further, and why?",
    ],
    params: { gravity: 9.8, restitution: 0.3, drag: 0, friction: 0, collisions: true },
    spawn: { count: 1, radius: 0.045, pattern: "grid", height: 0, speed: 3, angle: 45 },
    place: [[-0.8, 0]],
    objects: [],
    track: [0],
    predict: true,
  },
  {
    id: "ramp-ideal",
    name: "Inclined plane",
    aim: "Frictionless: a = g sin θ, and v = √(2gh) at the bottom.",
    asks: [
      "Read the speed as the ball reaches the foot of the slope, and check it against √(2gh).",
      "The ball slides rather than rolls, so all the height is speed - watch it drop as the flat absorbs the fall.",
    ],
    params: { gravity: 9.8, restitution: 0.05, drag: 0, friction: 0, collisions: true },
    spawn: { count: 1, radius: 0.05, pattern: "grid", height: 0, speed: 0, angle: 0 },
    /* Set down 0.29 m up, a few millimetres *inside* the slope near its top: the
       ejector lifts it back out and puts it exactly on the surface, so the ball
       starts from rest on the ramp rather than being dropped onto it, and the
       drop the lab's own formula is about is the drop it actually gets. A little
       further down the slope than the very top, so the ball does not catch on
       the wedge's top corner on its way past. */
    place: [[0.24, 0.29]],
    // The slope's own surface, stated rather than inherited: this lab is about
    // the idealisation, so its ramp is the frictionless one whatever a shape
    // preset is made of - and the ball touches nothing else on the way down.
    objects: [{ key: "ramp", x: 0, bounce: 0.05, friction: 0 }],
    track: [0],
  },
  {
    id: "ramp-friction",
    name: "Inclined plane, with friction",
    aim: "A slope of 18° with \u03BC = 0.2 slides at g(sin \u03B8 - \u03BC cos \u03B8).",
    asks: [
      "Compare the bottom speed with the frictionless lab's.",
      "Raise the friction until the ball stops: \u03BC = tan \u03B8 is the line.",
    ],
    params: { gravity: 9.8, restitution: 0.05, drag: 0, friction: 0.2, collisions: true },
    spawn: { count: 1, radius: 0.05, pattern: "grid", height: 0, speed: 0, angle: 0 },
    place: [[0.24, 0.29]],
    objects: [{ key: "ramp", x: 0, bounce: 0.05, friction: 0.2 }],
    track: [0],
  },
  {
    id: "bounce",
    name: "Bouncing ball",
    aim: "e = √(h′/h) turns a rebound height into a coefficient of restitution.",
    asks: [
      "Measure the peak height after the first bounce and work out e.",
      "Set restitution to 0.9 and predict the new rebound before you run it.",
    ],
    params: { gravity: 9.8, restitution: 0.7, drag: 0, friction: 0.3, collisions: true },
    spawn: { count: 1, radius: 0.06, pattern: "grid", height: 1.2, speed: 0, angle: 0 },
    place: [[-0.2, null]],
    objects: [],
    track: [0],
  },
  /* Both collision labs are one ball moving and one standing still, which is the
     experiment rather than a preference: two balls thrown at each other add up
     to zero momentum before and after alike, so the number that is supposed to
     be conserved never visibly does anything. With one at rest the total has a
     value worth watching, and it survives the collision while the speeds - and,
     in the sticky case, the energy - do not. */
  {
    id: "collision-elastic",
    name: "Collision: elastic",
    aim: "Momentum is conserved whatever happens; energy is not.",
    asks: [
      "Watch total momentum through the collision: it should not blink.",
      "One moving, one still, equal masses: what do the two speeds become?",
    ],
    params: { gravity: 9.8, restitution: 1, drag: 0, friction: 0, collisions: true },
    spawn: { count: 2, radius: 0.05, pattern: "grid", height: 0, speed: 0, angle: 0 },
    // Set up at the left of the stage so the collision happens near the middle
    // and whoever is moving afterwards has a metre of bench left to be read on.
    place: [[-1.35, 0], [-0.25, 0]],
    velocity: [[1.5, 0, 0], [0, 0, 0]],
    objects: [],
    track: [0, 1],
  },
  {
    id: "collision-inelastic",
    name: "Collision: inelastic",
    aim: "Momentum survives a sticky collision. Kinetic energy does not.",
    asks: [
      "Read the momentum before and after, then the kinetic energy.",
      "They leave together at half the speed: where did the energy go?",
    ],
    params: { gravity: 9.8, restitution: 0, drag: 0, friction: 0, collisions: true },
    spawn: { count: 2, radius: 0.05, pattern: "grid", height: 0, speed: 0, angle: 0 },
    place: [[-1.35, 0], [-0.25, 0]],
    velocity: [[1.5, 0, 0], [0, 0, 0]],
    objects: [],
    track: [0, 1],
  },
  {
    id: "newton-second",
    name: "Constant force",
    aim: "Newton's second law: one steady force on one mass, a = F / m.",
    asks: [
      "Divide the force by the mass, then measure the acceleration.",
      "Double the force and run again: does the acceleration double?",
    ],
    params: { gravity: 9.8, restitution: 0.2, drag: 0, friction: 0, collisions: true },
    spawn: { count: 1, radius: 0.05, pattern: "grid", height: 0, speed: 0, angle: 0 },
    place: [[-1.2, 0]],
    force: [[0.35, 0, 0]],
    objects: [],
    track: [0],
  },
];

/** The launch a lab asks for, as components the spawner can use. */
export function labLaunch(lab) {
  const s = lab.spawn ?? {};
  return launch(s.speed ?? 0, s.angle ?? 0);
}
