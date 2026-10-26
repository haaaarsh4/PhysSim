/**
 * frontend/fluids_labs.js - the six experiments on the Fluids bench.
 *
 * A lab is a scene, not a slideshow: it pours liquid into the tank, puts a body
 * in it if the experiment needs one, and then gets out of the way so the
 * physics runs. Every one of them is a question about the same solver, and each
 * one is chosen because it makes a different term of the Navier-Stokes
 * equations the one you can see:
 *
 *   - dam break        inertia and gravity, with the pressure of the column
 *                      holding it up until it is not held up any more;
 *   - drop impact      surface tension against inertia, and the crown a drop
 *                      throws up when it arrives;
 *   - falling sheet    a sheet of liquid let go from a nozzle, thinning as it
 *                      falls, and the crater it leaves;
 *   - capillary ripple one Fourier mode of the free surface, ringing at the
 *                      frequency gravity and surface tension set together;
 *   - sloshing         the tank's first mode, driven at its own frequency;
 *   - buoyancy         a body whose density you choose, and Archimedes' answer.
 *
 * Each `build` is handed the live solver and resets it. Nothing here draws:
 * rendering/fluid3d_renderer.js reads the solver, and frontend/fluids_ui.js
 * reads the lab for its name and note.
 */

/** The falling-sheet lab's tap, in metres and seconds. */
export const NOZZLE_HALF_WIDTH = 0.08;
const NOZZLE_OPEN = 1.4;

export const FLUID_LABS = [
  {
    id: "dam",
    name: "Dam break",
    blurb: "A column of water, released. The front runs out at a speed gravity sets.",
    note: "The column stands more than three times as tall as the pool it becomes, and pressure alone holds it up. Let it go and the front runs along the floor, climbs the far wall, and settles back to the depth the volume asks for. The depth is the check: the particles keep their volume, so the final level is the one the tank's floor area dictates.",
    tone: "inertia",
    build(s) {
      s.reset();
      s.fluid = "water";
      s.params.gravity = 9.81;
      s.params.surfaceTension = 0.072;
      s.params.viscosity = 0.001;
      s.params.bodyAccelX = 0;
      s.addBlock(0.09, 0.02, 0.02, s.width * 0.3 + 0.07, s.height * 0.62, s.depth - 0.02);
      return { title: "Dam break", sub: "a column released" };
    },
  },
  {
    id: "impact",
    name: "Drop impact",
    blurb: "A drop falls into a pool: the crown, the crater, and the jet that answers it.",
    note: "Surface tension is what makes the crown: without it the drop is a piston and the splash is a ring. The drop is given 1.4 m/s at the surface rather than dropped from the top of the tank — a real 0.6 m fall crosses this tank in a fifth of a second, and a splash nobody sees is not an experiment.",
    tone: "capillary",
    build(s) {
      s.reset();
      s.fluid = "water";
      s.params.gravity = 9.81;
      s.params.surfaceTension = 0.072;
      s.params.viscosity = 0.001;
      s.params.bodyAccelX = 0;
      s.fillBelow(s.height * 0.32);
      s.settle();
      s.addSphere(s.width * 0.52, s.height * 0.8, s.depth * 0.5, 0.075, [0, -1.4, 0]);
      return { title: "Drop impact", sub: "a drop into a pool" };
    },
  },
  {
    id: "sheet",
    name: "Falling sheet",
    blurb: "A tap feeding a sheet that thins as it falls, and the plunge it makes.",
    note: "The nozzle feeds a sheet 10 cm wide at 0.6 m/s for a second and a half, then stops. Gravity stretches it, so it thins all the way down, and the tip necks where the balance of inertia and surface tension puts the neck — nowhere that is written into the code. What it shows is the sheet on the way to breaking, and the crater it leaves.",
    tone: "capillary",
    build(s) {
      s.reset();
      s.fluid = "water";
      s.params.gravity = 9.81;
      s.params.surfaceTension = 0.072;
      s.params.viscosity = 0.001;
      s.params.bodyAccelX = 0;
      s.fillBelow(s.height * 0.2);
      s.settle();
      return { title: "Falling sheet", sub: "surface tension, breaking a sheet" };
    },
  },
  {
    id: "ripple",
    name: "Capillary ripple",
    blurb: "One mode of the free surface, ringing at the frequency the two forces set together.",
    note: "Four wavelengths across the tank, with gravity turned down to a fifth so the mode is slow enough to time by eye. At a 30 cm wavelength the capillary term is a few per cent of the restoring force, so the period the rail quotes — omega² = g k + sigma k³ / rho — is close to the gravity-wave one; set surface tension to zero and the difference is small. The bench is where you time it.",
    tone: "capillary",
    build(s) {
      s.reset();
      s.fluid = "water";
      /* A fifth of a g, not a fortieth: at 0.4 m/s2 the pressure solve has so
         little hydrostatic load to work against that the pool never stops
         simmering, and the mode is buried in solver noise. At 2.2 the wave is
         still slow enough to time by eye and the surface is a surface. */
      s.params.gravity = 2.2;
      s.params.surfaceTension = 0.072;
      s.params.viscosity = 0.001;
      s.params.bodyAccelX = 0;
      const waves = 4;
      const k = (2 * Math.PI * waves) / s.width;
      const amp = s.spacing * 1.15;
      const level = s.height * 0.42;
      s.fillBelow(level, (x) => amp * Math.cos(k * x));
      /* A few gentle steps, not a full settle: the mode is the experiment, and
         settling would flatten it. At the lab's lowered gravity the pour is
         quiet enough that eight steps is all the transient there is. */
      s.settle(8);
      return { title: "Capillary ripple", sub: "one mode, one frequency" };
    },
  },
  {
    id: "slosh",
    name: "Sloshing",
    blurb: "Drive the tank at its own first mode and the water answers across the whole width.",
    note: "The tank is shaken sideways, not tilted: the acceleration is a body force on the liquid, the same as gravity. The first mode of a pool this deep in a tank this wide is at about 0.62 Hz, which is where the drive opens; the frequency slider on the left is the drive, and the wave you see is the tank's answer to it.",
    tone: "resonance",
    shake: { amplitude: 2.4, frequency: 0.62 },
    build(s) {
      s.reset();
      s.fluid = "water";
      s.params.gravity = 9.81;
      s.params.surfaceTension = 0.072;
      s.params.viscosity = 0.001;
      s.params.bodyAccelX = 0;
      s.fillBelow(s.height * 0.4);
      s.settle();
      return { title: "Sloshing", sub: "the tank's first mode" };
    },
  },
  {
    id: "buoyancy",
    name: "Buoyancy",
    blurb: "A body of your density, let go under water. Archimedes, in one number.",
    note: "Buoyancy is rho g V_submerged and drag is half rho C_d A v²: the body settles with the fraction of itself under water that its density asks for, to within the meniscus it carries. The liquid feels the body as a wall, so the waves you see are the body's answer coming back.",
    tone: "body",
    build(s) {
      s.reset();
      s.fluid = "water";
      s.params.gravity = 9.81;
      s.params.surfaceTension = 0.072;
      s.params.viscosity = 0.001;
      s.params.bodyAccelX = 0;
      s.fillBelow(s.height * 0.5);
      s.settle();
      s.ball = {
        visible: true,
        x: s.width * 0.5,
        y: s.height * 0.82,
        z: s.depth * 0.5,
        r: 0.06,
        density: 480,
        vy: 0,
        ax: 0,
      };
      return { title: "Buoyancy", sub: "Archimedes, measured" };
    },
  },
];

export const labById = (id) => FLUID_LABS.find((l) => l.id === id) ?? FLUID_LABS[0];

/**
 * The nozzle, for the falling-sheet lab.
 *
 * Separate from `build` because it has to happen every sub-step rather than
 * once at setup: a nozzle with nothing behind it is a hole, and the sheet would
 * neck itself off at the tap before it ever left it.
 */
export function feedNozzle(solver, labId, open, dt = 1 / 60) {
  if (labId !== "sheet" || !open) return;
  const x = solver.width * 0.5;
  const z = solver.depth * 0.5;
  solver.inject(
    x - NOZZLE_HALF_WIDTH, x + NOZZLE_HALF_WIDTH,
    solver.height * 0.95,
    z - NOZZLE_HALF_WIDTH, z + NOZZLE_HALF_WIDTH,
    -0.6,
    230,
    dt,
  );
}

export const nozzleOpenFor = NOZZLE_OPEN;
