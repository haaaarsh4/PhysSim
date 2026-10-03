/**
 * simulation/gas.js - a gas, in a box, in real units.
 *
 * This is the whole of the Thermo workbench's physics: hard spheres bouncing
 * inside a cuboid with one moving face. Nothing here is a curve fitted to a
 * textbook. Every number the panels show is either counted from what the
 * molecules actually did - pressure is the momentum they handed to the walls,
 * temperature is their mean kinetic energy, work is the energy the lid put in -
 * or computed from the closed form it ought to agree with. The two are shown
 * side by side, which is the whole point of a workbench: a theory is only worth
 * believing once you have watched it come true.
 *
 * ---------------------------------------------------------------------------
 * THE UNITS ARE REAL
 * ---------------------------------------------------------------------------
 * The molecules are noble gases with their measured kinetic diameters and molar
 * masses (SPECIES below), the Boltzmann constant is the real one, and a
 * molecule's mass is M/N_A. The box is a few tens of nanometres across, and
 * that is what makes the arithmetic land where it does:
 *
 *   argon at 300 K    v_rms = sqrt(3RT/M) = 433 m/s      (real, checkable)
 *   1800 molecules    n = 3.1e26 /m^3, P = n k T = 1.28 MPa
 *   mean free path    6.3 nm - about a third of the box, so molecules visibly
 *                     collide, and they cross the box several times between
 *                     collisions
 *
 * The one number to be honest about is the speed. A real gas moves 10^10 times
 * faster than anything a person can watch: argon crosses this box in 4e-11 s.
 * There is no simulation of real molecules at real speeds that looks calm. So
 * this one runs at real speeds and shows you a *slice* of time - the panel
 * quotes the exchange rate (tens of picoseconds of gas per second of watching),
 * which makes this a slow-motion replay of a real experiment rather than a
 * dressed-up imitation of one. The step is the accuracy: at the default 0.2 fs
 * a molecule moves 0.09 nm, about a quarter of its own diameter, so a collision
 * is resolved well inside the distance over which it happens.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS EXACT, AND WHAT IS NOT
 * ---------------------------------------------------------------------------
 * Exact, to the last bit, and checked in experiments/thermo_checks.js:
 *
 *   - every molecule-molecule collision conserves momentum and kinetic energy
 *     (the two-body impulse is solved on the pair, unequal masses included);
 *   - the first law holds live: the gas's internal energy only changes at a
 *     wall or at the lid, and each change is counted as it happens, so
 *     U - U0 - Q - W + E_escaped is zero to floating-point noise on every step
 *     and you can watch it stay there;
 *   - nothing tells the gas what pressure to have. Reflection is the only thing
 *     a wall does.
 *
 * Approximate, and said out loud in the panel:
 *
 *   - collisions are resolved on a fixed step rather than at a solved crossing
 *     instant, so a collision happens where the molecules ended the step rather
 *     than exactly where they met. That is a fraction of a diameter of error per
 *     collision and makes a slightly different trajectory, the way any
 *     fixed-step engine does. It does not create or destroy energy.
 *   - molecules are spheres of one size each, and a real molecule is not.
 *   - this gas is rarefied: the Knudsen number (mean free path over box size) is
 *     about 0.3, not the 0.001 of a gas in a room. That is what makes it
 *     watchable, and it is why the measured compressibility sits a couple of
 *     percent above 1 rather than on top of it.
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF WALL, BOTH OF THEM PHYSICS
 * ---------------------------------------------------------------------------
 * An *insulated* wall is a smooth hard surface: the velocity reverses across
 * the normal and nothing else changes. That is also the idealisation a textbook
 * uses for an adiabatic process, and it is why a slow squeeze of an insulated
 * box makes P V^(5/3) come out - a reversible squeeze is exactly what a smooth
 * wall does.
 *
 * An *isothermal* wall is a surface held at a temperature, and a molecule that
 * hits it leaves with a fresh velocity drawn from the Maxwell distribution at
 * that temperature. The detail that matters, and the one most simulations get
 * wrong: a molecule leaving a surface is not a random molecule, it is one that
 * arrived, so its normal speed is drawn from the *flux-weighted* Maxwellian -
 * density proportional to v exp(-mv^2/2kT) - which favours the fast ones. Get
 * that wrong, by drawing a plain half-Maxwellian instead, and the box settles at
 * the wrong temperature and the pressure reads 0.82 of n k T: precisely the sort
 * of quiet, plausible lie this file exists to avoid. Done right, the gas settles
 * on the wall's temperature *by itself* and the momentum the walls collect adds
 * up to n k T - the ideal gas law out of nothing but collisions.
 *
 * ---------------------------------------------------------------------------
 * THE PINHOLE
 * ---------------------------------------------------------------------------
 * A hole of a settable radius in the back wall, with vacuum outside. What
 * leaves is counted, not simulated, because what becomes of it afterwards is
 * not the experiment; the rate is. Effusion is the one transport property that
 * is *exactly* ballistic - molecules leave through a hole without touching
 * anyone on the way - so this is the one place where a dilute simulated gas is
 * not a compromise but the real thing, and Graham's law (lighter molecules
 * leave faster, by the root of the mass ratio) falls out of it unaided.
 *
 * There is no gravity, deliberately. In a box this size a gas's own scale height
 * (kT/mg, six kilometres in air) is nine orders of magnitude larger than the
 * box, so a settling atmosphere could only be faked here. Nothing in this file
 * knows which way is down.
 */

/** The Boltzmann constant, J/K. The real one, so temperatures read in kelvin. */
export const K_B = 1.380649e-23;

/** Avogadro's number, 1/mol. */
export const N_A = 6.02214076e23;

/** The universal gas constant, J/(mol K) - just N_A k_B, but worth naming. */
export const R_GAS = K_B * N_A;

/**
 * The gases a box can be filled with.
 *
 * `molarMass` is the real molar mass in kg/mol and `diameter` the kinetic
 * (collision) diameter in metres - the number that appears squared in the mean
 * free path, so it decides how far a molecule gets before it meets another.
 * Helium's 0.26 nm against xenon's 0.43 nm is why a helium atom travels nearly
 * four times further between collisions in the same gas.
 */
export const SPECIES = [
  { key: "he", name: "Helium", symbol: "He", molarMass: 4.002602e-3, diameter: 0.260e-9 },
  { key: "ne", name: "Neon", symbol: "Ne", molarMass: 20.1797e-3, diameter: 0.275e-9 },
  { key: "ar", name: "Argon", symbol: "Ar", molarMass: 39.948e-3, diameter: 0.340e-9 },
  { key: "kr", name: "Krypton", symbol: "Kr", molarMass: 83.798e-3, diameter: 0.360e-9 },
  { key: "xe", name: "Xenon", symbol: "Xe", molarMass: 131.293e-3, diameter: 0.432e-9 },
];

export function speciesOf(key) {
  return SPECIES.find((s) => s.key === key) ?? SPECIES[2];
}

/** What one molecule of a species weighs, kg. */
export function moleculeMass(species) {
  return species.molarMass / N_A;
}

/* The six faces, in the order every counter in this file indexes them: four
   sides, the back wall (x = 0, the one the pinhole is in) and the lid. */
export const WALL_Y_NEG = 0;
export const WALL_Y_POS = 1;
export const WALL_Z_NEG = 2;
export const WALL_Z_POS = 3;
export const WALL_BACK = 4;
export const WALL_PISTON = 5;
export const WALL_NAMES = ["-y", "+y", "-z", "+z", "back", "lid"];
export const WALL_LABELS = [
  "Bottom", "Top", "Near side", "Far side", "Back wall", "Lid",
];

/** The smallest and largest box the workbench will build, m. Below the first a
 *  molecule is a tenth of the way across and it stops being a gas at all. */
export const MIN_LENGTH = 6e-9;
export const MAX_LENGTH = 60e-9;
export const MIN_MOLECULES = 40;
export const MAX_MOLECULES = 4000;

/** The fastest the lid may be pushed, as a fraction of the r.m.s. speed.
 *  A person's hand would be supersonic in this gas - an 18 nm box crossed in a
 *  second is Mach 100 - so the lid is limited to a genuinely gentle,
 *  reversible push and the panel says so. */
export const MAX_LID_MACH = 0.05;

/** The face a burner sits under: the floor, which is the one surface of the box
 *  a flame can actually be put under. */
export const BURNER_FACE = WALL_Y_NEG;

/** How many recent wall impacts are kept for the picture of where pressure
 *  comes from. A few hundred is several frames' worth at any honest molecule
 *  count, and it costs a few kilobytes of ring buffer rather than a growing
 *  list. */
export const MAX_IMPACT_LOG = 512;

/** How long a measurement window lasts, in seconds of gas time. Long enough to
 *  collect a few hundred wall impacts (a pressure to two or three percent),
 *  short enough that the panel answers a dragged lid within half a second. */
export const WINDOW_DURATION = 2e-11;

/** Deterministic PRNG (mulberry32). Seeded, so a scene that is re-dealt comes
 *  back identical and the checks in experiments/ can assert exact numbers. */
export function makeRandom(seed = 1) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The three axes of a wall's face: the inward normal and two tangents. Used to
 * send a molecule away from a surface without giving it a preferred direction
 * within the plane.
 */
export function tangentialAxes(nx, ny, nz) {
  if (nx !== 0) return [[0, 1, 0], [0, 0, 1]];
  if (ny !== 0) return [[1, 0, 0], [0, 0, 1]];
  return [[1, 0, 0], [0, 1, 0]];
}

/**
 * The Maxwell-Boltzmann speed distribution: f(v), as a probability density in
 * 1/(m/s).
 *
 * This is the three-dimensional one, and the (3/2) in the exponent and the v^2
 * out front are both load-bearing - the v^2 counts the velocity directions with
 * that speed, the rest sets the scale. It peaks at sqrt(2kT/m) and its
 * root-mean-square is sqrt(3kT/m): the same two numbers the panel quotes as the
 * most probable and the r.m.s.
 *
 * @param {number} mass kg per molecule
 * @param {number} T K
 * @returns {(v:number)=>number} density, per (m/s)
 */
export function maxwellBoltzmann(mass, T) {
  if (!(mass > 0) || !(T > 0)) return () => 0;
  const a = mass / (2 * K_B * T);
  const norm = 4 * Math.PI * Math.pow(a / Math.PI, 1.5);
  return (v) => norm * v * v * Math.exp(-a * v * v);
}

/** The most probable speed, sqrt(2kT/m), m/s. */
export function mostProbableSpeed(mass, T) {
  return Math.sqrt((2 * K_B * T) / mass);
}

/** The root-mean-square speed, sqrt(3kT/m), m/s. */
export function rmsSpeedOf(mass, T) {
  return Math.sqrt((3 * K_B * T) / mass);
}

/** The mean speed, sqrt(8kT/(pi m)), m/s. */
export function meanSpeedOf(mass, T) {
  return Math.sqrt((8 * K_B * T) / (Math.PI * mass));
}

/**
 * The mean free path, m: how far a molecule gets, on average, before it meets
 * another one. The textbook form, lambda = 1 / (sqrt(2) pi d^2 n).
 */
export function meanFreePathOf(diameter, numberDensity) {
  if (!(numberDensity > 0)) return Infinity;
  return 1 / (Math.SQRT2 * Math.PI * diameter * diameter * numberDensity);
}

/** How many collisions one molecule makes a second: v-bar / lambda. */
export function collisionFrequencyOf(diameter, numberDensity, T, mass) {
  const lambda = meanFreePathOf(diameter, numberDensity);
  if (!(lambda > 0) || !Number.isFinite(lambda)) return 0;
  return meanSpeedOf(mass, T) / lambda;
}

/**
 * The number of molecules striking unit area per second: n v-bar / 4.
 * Multiply by the pinhole's area to get the effusion rate, Graham's law and all.
 */
export function impactFlux(numberDensity, T, mass) {
  return (numberDensity * meanSpeedOf(mass, T)) / 4;
}

/**
 * The second virial coefficient of hard spheres, B2 = (2/3) pi d^3, m^3.
 *
 * The ideal gas law is the zero-density limit of a real one, and this is the
 * first correction to it: P/(n k T) = 1 + B2 n + ... A gas of spheres is not
 * quite ideal, and at the density a watchable box needs, it shows.
 */
export function secondVirial(diameter) {
  return (2 / 3) * Math.PI * Math.pow(diameter, 3);
}

/** The Maxwell-Boltzmann prediction for the mean free path, given a box. */
export function predictedFreePath(species, numberDensity) {
  return meanFreePathOf(species.diameter, numberDensity);
}

/** The area of a pinhole that a molecule of this radius can actually get
 *  through: the hole, less the molecule. m^2. */
export function apertureArea(holeRadius, moleculeRadius) {
  const usable = holeRadius - moleculeRadius;
  return usable > 0 ? Math.PI * usable * usable : 0;
}

/**
 * The step a fixed-step solver needs to resolve a collision in this gas, s.
 *
 * A collision cannot be resolved more finely than the distance a molecule
 * covers between steps, so the step is set from the *smallest* thing in the
 * scene: the molecule's own diameter. At the default precision a molecule moves
 * a fifth of its diameter in a step, which leaves the contact geometry resolved
 * to a fraction of that - and, just as importantly, makes it almost impossible
 * for two molecules to swap places without ever being within reach of each
 * other in the same step, which is the one failure that looks like physics
 * rather than arithmetic: a gas whose collisions silently stop happening.
 *
 * It matters most for the light gases. A helium atom at 300 K does 1259 m/s
 * against argon's 433, so the same step that resolves argon's collisions skips
 * half of helium's - and half the collisions is half the viscosity, half the
 * thermalisation, and a box that quietly stops being a gas. Hence a step per
 * gas rather than one step for the workbench.
 *
 * @param {{diameter:number, molarMass:number}} species
 * @param {number} T K
 * @param {number} [precision] 1 is the default; 2 is twice as fine
 */
export function resolutionStep(species, T, precision = 1) {
  return (0.2 / precision) * species.diameter / rmsSpeedOf(moleculeMass(species), T);
}

export class GasBox {
  /**
   * @param {object} [opts]
   * @param {number} [opts.count] how many molecules
   * @param {string} [opts.species] key from SPECIES - the gas
   * @param {string|null} [opts.second] key of a second gas, mixed in
   * @param {number} [opts.mixFraction] the fraction of molecules that are the second gas
   * @param {number} [opts.temperature] K - the temperature of the walls
   * @param {number} [opts.length] m - back wall to lid
   * @param {number} [opts.crossSection] m - the width and the height of the box
   * @param {number} [opts.dt] s - the physics step
   * @param {number} [opts.hole] m - radius of the pinhole in the back wall
   * @param {'thermal'|'elastic'} [opts.walls] what the five fixed faces do
   * @param {boolean} [opts.lidThermal] whether the lid is a thermal wall too
   * @param {'fixed'|'hand'|'load'} [opts.lidMode] what moves the lid
   * @param {number} [opts.load] Pa - pressure holding the lid in
   * @param {number} [opts.seal] N s/m - the lid's friction
   * @param {boolean} [opts.burner] whether a flame is under the floor
   * @param {number} [opts.burnerTemperature] K - how hot that flame is
   * @param {number} [opts.maxMolecules]
   * @param {number} [opts.seed]
   */
  constructor(opts = {}) {
    this.maxMolecules = opts.maxMolecules ?? MAX_MOLECULES;
    this.speciesKey = opts.species ?? "ar";
    this.secondKey = opts.second ?? null;
    this.mixFraction = opts.mixFraction ?? 0.5;
    this.bath = opts.temperature ?? 300;
    /*
     * The burner: a flame under the floor.
     *
     * A beaker on a flame is not a box whose walls are all the same
     * temperature, and the difference is the whole point of heating one from
     * below - so the burner is modelled as what it is, one *surface* held at a
     * temperature of its own. The floor becomes a thermostat at the flame's
     * temperature; the other five faces keep doing whatever they were already
     * doing, which means a flame under an insulated box still heats the gas
     * (that is what an insulated beaker on a hot plate does) and a flame under
     * a box in a bath heats it until the sides carry as much away as the floor
     * brings in. Both of those are steady states, and both are worth watching.
     *
     * The gas therefore settles somewhere between the flame and the air, and
     * the panel says both numbers rather than one - a gradient reported as a
     * single temperature would be a lie about the only thing a flame does.
     */
    this.burner = {
      on: !!opts.burner,
      temperature: Math.max(1, opts.burnerTemperature ?? 600),
    };
    this.crossSection = opts.crossSection ?? 18e-9;
    this.dt = opts.dt ?? 2e-13;
    this.hole = opts.hole ?? 0;
    this.walls = opts.walls ?? "thermal";
    this.lidThermal = opts.lidThermal ?? true;
    this.length = opts.length ?? 18e-9;
    /* The step is derived from the gas and its temperature unless someone asks
       for a specific one, so switching to helium refines the timeline rather
       than quietly halving the number of collisions it has. The temperature it
       is derived from is the hottest surface the gas can meet, because a
       molecule that has just come off a 900 K flame is a fast molecule and the
       step has to resolve *that* one, not the average of the box. */
    this.precision = opts.precision ?? 1;
    this.stepLocked = opts.dt !== undefined;
    this.dt = opts.dt ?? resolutionStep(speciesOf(this.speciesKey), this.hottestSurface, this.precision);
    this.lid = {
      mode: opts.lidMode ?? "fixed",
      x: this.length,
      velocity: 0,
      load: opts.load ?? 0,
      /* The pressure of the air on the *outside* of the lid, Pa.

         It is the same kind of thing a load is - a pressure holding the lid in
         - and it is kept apart from `load` because the two are set by two
         different instruments: a load is weights standing on the lid, and this
         is the air the box is sitting in. They add up in the lid's balance and
         nothing else in the simulation can see either of them: they are both
         outside the box, and the molecules never meet them. */
      external: opts.external ?? 0,
      /* How stiff the seal is: a lid with a load on it moves in proportion to
         the force it is out of balance by, against this. Smaller means a freer
         piston. 0.12 is the value that makes a heated gas under a load expand
         with the pressure within a tenth of that load - which is what turns "at
         constant pressure" from a claim into a measurement - while still
         damping the shiver a massless boundary picks up from being hit by
         molecules one at a time. Set it to zero and the lid tracks the load
         almost exactly but rings, which is a worse lie than a little friction. */
      seal: opts.seal ?? 0.12,
    };
    /* A thin membrane part-way along the box. Present, it is a smooth wall in
       the middle of the gas; taken out, the gas expands into the space beyond
       it and does no work at all, which is the one expansion that leaves a
       gas's temperature alone. */
    this.membrane = { present: !!opts.membrane, x: opts.membraneX ?? this.length / 2 };
    this.random = makeRandom(opts.seed ?? 20260928);
    this.windowDuration = WINDOW_DURATION;
    /* The lid is pushed by impacts, and impacts arrive one at a time. A real
       piston's inertia turns that rattle into a steady force; this smoothed
       one is that, and the panel's pressure stays the honest window average.
      
       The time constant is a real choice rather than a detail, and the number
       here was arrived at by measurement rather than taste. A lid that answers
       the last ten picoseconds of impacts is answered by a couple of hundred
       molecules, so its estimate of the pressure is a few percent uncertain and
       it wanders around its balance by about that much. A longer constant
       averages that noise away - and was tried, at fifty and a hundred
       picoseconds - but a lid that answers slowly *lags*, and its lag is a
       wander of its own that is twice as large. Ten picoseconds is the best of
       the two, and it is also what a piston light enough to matter would do. */
    this.lidForceTau = 1e-11;
    this.lidForceSmooth = 0;
    this._lidImpulseStep = 0;
    /* Where the walls were hit, and how hard, for the picture of where pressure
       comes from. Off by default: it is a few writes per collision, and a
       collision this gas makes millions of a second, so the workbench turns it
       on only while someone has asked to see it. */
    this.trackImpacts = false;
    this.impactLog = {
      x: new Float32Array(MAX_IMPACT_LOG),
      y: new Float32Array(MAX_IMPACT_LOG),
      z: new Float32Array(MAX_IMPACT_LOG),
      face: new Uint8Array(MAX_IMPACT_LOG),
      impulse: new Float32Array(MAX_IMPACT_LOG),
      step: new Float64Array(MAX_IMPACT_LOG),
      next: 0,       // where the next impact is written
      count: 0,      // how many slots have ever been written
      recorded: 0,   // how many impacts have been logged in total
    };

    const cap = this.maxMolecules;
    this.n = 0;
    this.x = new Float64Array(cap);
    this.y = new Float64Array(cap);
    this.z = new Float64Array(cap);
    this.vx = new Float64Array(cap);
    this.vy = new Float64Array(cap);
    this.vz = new Float64Array(cap);
    this.mass = new Float64Array(cap);
    this.radius = new Float64Array(cap);
    this.kind = new Uint8Array(cap);   // 0 = the primary gas, 1 = the second one
    this.order = new Int32Array(cap);
    this._orderDirty = true;
    this._histogram = new Float64Array(0);
    this._maxRadius = 0;
    /* Overlaps found by the sweep, applied once the sweep is over. Room for two
       per molecule, which a dilute gas never comes close to using. */
    const fixRoom = Math.max(64, cap);
    this._fixI = new Int32Array(fixRoom);
    this._fixJ = new Int32Array(fixRoom);
    this._fixN = new Float64Array(fixRoom * 3);
    this._fixShare = new Float64Array(fixRoom * 2);

    this.resetCounters();
    this.fill(opts.count ?? 1800);
  }

  /**
   * The hottest surface the gas can meet, K.
   *
   * With a flame under the floor this is the flame, not the air: the step has to
   * resolve the fastest molecule in the box, and the fastest molecules in the
   * box are the ones a 900 K surface has just handed back.
   */
  get hottestSurface() {
    return Math.max(this.bath, this.burner.on ? this.burner.temperature : 0);
  }

  /**
   * Set the step from the gas actually in the box: the fastest molecule and the
   * smallest one between them decide how finely time has to be cut.
   */
  updateStep() {
    if (this.stepLocked) return;
    const gases = [speciesOf(this.speciesKey)];
    if (this.secondKey) gases.push(speciesOf(this.secondKey));
    const T = this.hottestSurface;
    this.dt = Math.min(...gases.map((g) => resolutionStep(g, T, this.precision)));
  }

  /**
   * How finely the timeline is cut: 1 is the default, 2 halves the step, 0.5
   * doubles it. Coarser is faster to watch and slightly less true.
   */
  setPrecision(precision) {
    this.precision = Math.max(0.25, Math.min(8, precision));
    this.stepLocked = false;
    this.updateStep();
  }

  /* ------------------------------- geometry -------------------------------- */

  /**
   * How far along the box the gas has actually got, m.
   *
   * Without a partition this is the lid: the gas fills the box and the gas's
   * volume and the box's volume are the same thing. With one, the gas is only on
   * the near side of it and the rest of the box is vacuum - and then the two are
   * not the same thing at all, which is the whole point of the free-expansion
   * experiment. Every property that belongs to the *gas* - its volume, its
   * density, its pressure, how far apart its molecules are - is measured over
   * this, and only the box's own surfaces keep the lid's position.
   */
  get occupiedLength() {
    return this.membrane.present ? Math.min(this.membrane.x, this.lid.x) : this.lid.x;
  }

  /**
   * The gas's volume, m^3.
   *
   * Not the box's, when there is a partition: a gas that has expanded into half
   * of a box has the volume of the half, and an ideal-gas-law readout that
   * divided N k T by the waiting vacuum around it would report a density the gas
   * does not have.
   */
  get volume() {
    return this.crossSection * this.crossSection * this.occupiedLength;
  }

  /**
   * The surface the gas is in contact with, m^2: the back wall and the four
   * sides over the length the gas has reached, plus the lid only when it has
   * reached it.
   *
   * This is what the pressure is averaged over. Averaging over the whole box
   * instead would include the lid a gas behind a partition has never touched,
   * and would report a pressure that belongs to the container rather than to the
   * gas - twice as low as the one the gas is really exerting, which is exactly
   * the factor the free-expansion experiment is about.
   */
  get contactArea() {
    const side = this.crossSection * this.occupiedLength;
    const reachesLid = this.occupiedLength >= this.lid.x - 1e-12;
    return this.lidArea + 4 * side + (reachesLid ? this.lidArea : 0);
  }

  /** The area of the moving face, m^2 - what its pressure acts on. */
  get lidArea() {
    return this.crossSection * this.crossSection;
  }

  /** The total area of the six faces, m^2. */
  get wallArea() {
    return 4 * this.crossSection * this.lid.x + 2 * this.lidArea;
  }

  /** Molecules per cubic metre. */
  get numberDensity() {
    return this.volume > 0 ? this.n / this.volume : 0;
  }

  /** The gas's mass, kg. */
  get gasMass() {
    let m = 0;
    for (let i = 0; i < this.n; i++) m += this.mass[i];
    return m;
  }

  /** How many mol of gas are in the box - for R T and friends. */
  get moles() {
    return this.n / N_A;
  }

  /* -------------------------------- filling -------------------------------- */

  /**
   * Put molecules in the box: spread on a lattice, moving at the walls'
   * temperature.
   *
   * A lattice rather than random positions, because molecules dropped at random
   * into a box a few diameters wide will overlap, and the solver would spend the
   * first microseconds blowing them apart - a transient that is not the gas and
   * would show up in the pressure. The lattice, plus a jitter smaller than the
   * spacing, is what makes the scene start as the gas it claims to be.
   */
  fill(count = this.n) {
    const species = speciesOf(this.speciesKey);
    const second = this.secondKey ? speciesOf(this.secondKey) : null;
    const n = Math.max(0, Math.min(this.maxMolecules, Math.round(count)));
    /* A gas is dealt into the space it is allowed to occupy, and with a
       partition present that space is only the near side of it. Filling the
       whole box regardless would put half the molecules in what is supposed to
       be vacuum, and then "take the partition out" would be an expansion with
       nothing to expand into - the one experiment the membrane exists for. */
    const L = this.membrane.present ? Math.min(this.lid.x, this.membrane.x) : this.lid.x;
    const W = this.crossSection;
    const h = W / 2;
    const biggest = Math.max(species.diameter, second ? second.diameter : 0);

    /* One molecule per cell, which needs at least n cells - and the cell side is
       then tightened until the lattice really has that many. Getting this wrong
       is quiet and it is not: a lattice with fewer cells than molecules deals
       several molecules to the same spot, the solver spends the first
       microseconds prising them apart, and the scene opens on a gas that has
       just been through an explosion. */
    let cell = Math.max(2 * biggest, Math.cbrt((L * W * W) / Math.max(n, 1)));
    let nx = 1;
    let ny = 1;
    let nz = 1;
    for (let guard = 0; guard < 64; guard++) {
      nx = Math.max(1, Math.floor(L / cell));
      ny = Math.max(1, Math.floor(W / cell));
      nz = Math.max(1, Math.floor(W / cell));
      if (nx * ny * nz >= n) break;
      cell *= 0.93;
    }
    const dx = L / nx;
    const dy = W / ny;
    const dz = W / nz;
    /* The jitter has to stay inside the cell and outside the next molecule's
       surface, or the lattice overlaps itself. */
    const jitterX = Math.max(0, dx - biggest) * 0.35;
    const jitterY = Math.max(0, dy - biggest) * 0.35;
    const jitterZ = Math.max(0, dz - biggest) * 0.35;

    for (let i = 0; i < n; i++) {
      const c = i;
      this.x[i] = (c % nx + 0.5) * dx + (this.random() - 0.5) * jitterX;
      this.y[i] = -h + (Math.floor(c / nx) % ny + 0.5) * dy + (this.random() - 0.5) * jitterY;
      this.z[i] = -h + (Math.floor(c / (nx * ny)) % nz + 0.5) * dz + (this.random() - 0.5) * jitterZ;
      this.kind[i] = second && this.random() < this.mixFraction ? 1 : 0;
      const s = this.kind[i] === 1 ? second : species;
      this.mass[i] = moleculeMass(s ?? species);
      this.radius[i] = (s ?? species).diameter / 2;
    }
    this.n = n;
    this._maxRadius = Math.max(species.diameter, second ? second.diameter : 0) / 2;
    this.order = new Int32Array(this.maxMolecules);
    this._orderDirty = true;

    /* Two species asked for in a box the lattice happened to deal none of:
       the lab said "some helium", so there is helium. */
    if (second && this.mixFraction > 0 && n > 1 && this.kindCount(1) === 0) {
      for (let i = 0; i < Math.max(2, Math.round(n * this.mixFraction)); i++) {
        this.kind[i] = 1;
        this.mass[i] = moleculeMass(second);
        this.radius[i] = second.diameter / 2;
      }
    }

    this.dealVelocities();
    this._clampToLid();
    this.resetCounters();
  }

  /**
   * Give every molecule a speed drawn from the Maxwell distribution at `T`.
   *
   * One Gaussian per component, scaled by sqrt(kT/m), is the whole of it: the
   * distribution the panel draws as the theory curve IS this, which is why the
   * measured histogram lands on it.
   */
  dealVelocities(T = this.bath) {
    const h = this.crossSection / 2;
    const margin = (i) => this.radius[i] + 1e-12;
    for (let i = 0; i < this.n; i++) {
      const sigma = Math.sqrt((K_B * T) / this.mass[i]);
      this.vx[i] = sigma * this._gauss();
      this.vy[i] = sigma * this._gauss();
      this.vz[i] = sigma * this._gauss();
      /* A molecule dealt exactly on a wall is a molecule about to leave
         through it, so send it inward. */
      const m = margin(i);
      if (this.x[i] < m) this.vx[i] = Math.abs(this.vx[i]);
      if (this.x[i] > this.lid.x - m) this.vx[i] = -Math.abs(this.vx[i]);
      if (this.y[i] < -h + m) this.vy[i] = Math.abs(this.vy[i]);
      if (this.y[i] > h - m) this.vy[i] = -Math.abs(this.vy[i]);
      if (this.z[i] < -h + m) this.vz[i] = Math.abs(this.vz[i]);
      if (this.z[i] > h - m) this.vz[i] = -Math.abs(this.vz[i]);
    }
  }

  /** A standard normal, by Box-Muller. Deterministic given the seeded PRNG. */
  _gauss() {
    let u = 0;
    while (u === 0) u = this.random();
    const v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ----------------------------- the ledger ------------------------------- */

  /** Zero every total and window counter: the ledger starts here. */
  resetCounters() {
    this.time = 0;
    this.steps = 0;
    this.impulse = new Float64Array(6);
    this.impulseWindow = new Float64Array(6);
    this.windowTime = 0;
    /* The window's own energy samples, which is what makes the window's
       temperature a temperature over the same span as the window's pressure. */
    this.energySum = 0;
    this.energySamples = 0;
    this.heat = 0;
    this.work = 0;
    this.escapedEnergy = 0;
    this.escaped = 0;
    this.escapedByKind = [0, 0];
    this.leaks = 0;
    this.heatWindow = 0;
    this.workWindow = 0;
    this.pairCollisions = 0;
    this.wallCollisions = 0;
    this.lidCollisions = 0;
    this.pairCollisionsWindow = 0;
    this.wallCollisionsWindow = 0;
    this.lidCollisionsWindow = 0;
    this.checks = 0;
    this.checksWindow = 0;
    this.lidForceSmooth = 0;
    this._lidImpulseStep = 0;
    this.clearImpacts();
    this.reanchor();
  }

  /**
   * Declare the present moment the new zero of the energy ledger.
   *
   * The first law is U - U0 = Q + W - E_out, so making the books balance from
   * here on means choosing U0 = U - Q - W + E_out. Any edit that is not a wall
   * or a lid - typing a new temperature, adding molecules, re-dealing speeds -
   * changes U without a Q or a W, and would leave a permanent residue in the
   * ledger if the baseline were not moved with it.
   */
  reanchor() {
    this.internalEnergy0 = this.internalEnergy() - this.heat - this.work + this.escapedEnergy;
  }

  /** Start a new measurement window: what every *rate* in the panel is over. */
  markWindow() {
    this.impulseWindow.fill(0);
    this.windowTime = 0;
    this.energySum = 0;
    this.energySamples = 0;
    this.heatWindow = 0;
    this.workWindow = 0;
    this.pairCollisionsWindow = 0;
    this.wallCollisionsWindow = 0;
    this.lidCollisionsWindow = 0;
    this.checksWindow = 0;
  }

  /**
   * The energy books, in joules. `residual` is the first law itself: it is zero
   * if and only if energy has been accounted for honestly, and it is on screen
   * while you watch.
   */
  ledger() {
    const u = this.internalEnergy();
    return {
      internalEnergy: u,
      internalEnergy0: this.internalEnergy0,
      heat: this.heat,
      work: this.work,
      escaped: this.escapedEnergy,
      residual: u - this.internalEnergy0 - this.heat - this.work + this.escapedEnergy,
    };
  }

  /* ------------------------------ observables ----------------------------- */

  /** The gas's whole internal energy, J. A monatomic ideal gas has nowhere else
   *  to keep energy than in its molecules' motion, so this is it. */
  internalEnergy() {
    let e = 0;
    for (let i = 0; i < this.n; i++) {
      e += 0.5 * this.mass[i] * (this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i] + this.vz[i] * this.vz[i]);
    }
    return e;
  }

  /**
   * The temperature the gas is actually at, from its mean kinetic energy.
   *
   * (1/2) m <v^2> = (3/2) k T is not an approximation here: it is the
   * definition. The panel shows it next to the temperature the walls are held
   * at, and when the two disagree the gas has not finished settling - which is
   * something to watch, not something to hide.
   *
   * This is the temperature at this instant, which is the one the physics is
   * about. The *panel's* temperature is the window average below, because a
   * pressure and a temperature measured over different spans cannot honestly be
   * divided into each other. With a few thousand molecules an instantaneous
   * temperature moves by two percent on its own, and dividing a twenty-picosecond
   * pressure by that would put two percent of pure sampling noise into the
   * compressibility - which is the same size as the hard-sphere correction the
   * panel is trying to show.
   *
   * @param {number|null} kind restrict to one kind of molecule, or null for all
   */
  temperature(kind = null) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      if (kind !== null && this.kind[i] !== kind) continue;
      count++;
      sum += this.mass[i] * (this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2);
    }
    return count ? sum / (3 * K_B * count) : 0;
  }

  /**
   * The temperature averaged over the measurement window, K.
   *
   * The panel's temperature, and the one the compressibility is computed from:
   * the same span of gas as the pressure beside it. It is the mean of a few
   * hundred instantaneous temperatures, so it is steady where the instantaneous
   * one is not, and it is still nothing but the molecules' kinetic energy.
   */
  windowTemperature() {
    if (!this.energySamples || this.n === 0) return this.temperature();
    return (2 * this.energySum) / (3 * K_B * this.energySamples * this.n);
  }

  /** How many collisions the window measured - the sample the pressure is
   *  averaged over, and therefore how much of its spread is the count. */
  get impactCount() {
    return this.wallCollisionsWindow + this.lidCollisionsWindow;
  }

  /** Mean speed over the molecules, m/s. */
  meanSpeed(kind = null) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      if (kind !== null && this.kind[i] !== kind) continue;
      count++;
      sum += Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
    }
    return count ? sum / count : 0;
  }

  /** Root-mean-square speed over the molecules, m/s. */
  rmsSpeed(kind = null) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      if (kind !== null && this.kind[i] !== kind) continue;
      count++;
      sum += this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2;
    }
    return count ? Math.sqrt(sum / count) : 0;
  }

  /** The mean mass of the molecules present, kg. */
  meanMass(kind = null) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      if (kind !== null && this.kind[i] !== kind) continue;
      count++;
      sum += this.mass[i];
    }
    return count ? sum / count : 0;
  }

  /** How many molecules are of each kind. */
  kindCount(kind) {
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.kind[i] === kind) c++;
    return c;
  }

  /**
   * The mean free path, m: how far a molecule gets before it meets another.
   *
   * The textbook form for one gas is lambda = 1/(sqrt(2) pi d^2 n). A mixture
   * needs the cross-section averaged over every pair of molecules that could
   * meet, so that is what the second branch does, using the populations rather
   * than walking the pairs.
   */
  meanFreePath() {
    if (this.n < 2) return Infinity;
    const density = this.numberDensity;
    if (density <= 0) return Infinity;
    const single = this.kindCount(1) === 0;
    if (single) return meanFreePathOf(2 * this.radius[0], density);
    /* Average collision cross-section over unordered pairs, weighted by how
       often each pair happens: sum over kinds of x_i x_j (r_i + r_j)^2. */
    const radii = new Map();
    const weight = new Map();
    const total = this.n;
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i];
      radii.set(k, this.radius[i]);
      weight.set(k, (weight.get(k) ?? 0) + 1 / total);
    }
    let sigmaSquared = 0;
    for (const [ka, ra] of radii) {
      for (const [kb, rb] of radii) {
        const pa = weight.get(ka);
        const pb = weight.get(kb);
        sigmaSquared += (ka === kb ? pa * pb : pa * pb) * (ra + rb) ** 2;
      }
    }
    if (sigmaSquared <= 0) return Infinity;
    /* The (n-1)/n factor is the difference between "among the others" and
       "among all of them": with 1800 molecules it is a sixth of a percent. */
    return 1 / (Math.SQRT2 * Math.PI * sigmaSquared * density * ((this.n - 1) / this.n));
  }

  /** The average distance between neighbouring molecules, m - the gas's own
   *  yardstick, and the number the mean free path should be compared with. */
  moleculeSpacing() {
    const v = this.volume;
    return this.n > 0 && v > 0 ? Math.cbrt(v / this.n) : 0;
  }

  /**
   * The pressure, Pa.
   *
   * Over the measurement window this is the momentum the walls collected
   * divided by (area x time), which is the definition of pressure rather than a
   * formula for it. Pass a face to get that face alone: a long box's sides are
   * bigger than its ends and averaging over one number would report a pressure
   * belonging to no face of it.
   */
  pressure(face = null) {
    const t = this.windowTime;
    if (t <= 0) return 0;
    if (face !== null) {
      const area = face === WALL_PISTON || face === WALL_BACK
        ? this.lidArea
        : this.crossSection * this.occupiedLength;
      return this.impulseWindow[face] / (area * t);
    }
    /* The gas's own surface, not the box's: see contactArea. With no partition
       the two are the same and this is the plain six-face average. */
    const side = this.crossSection * this.occupiedLength;
    const reachesLid = this.occupiedLength >= this.lid.x - 1e-12;
    let total = 0;
    let area = this.lidArea + 4 * side + (reachesLid ? this.lidArea : 0);
    for (let f = 0; f < 6; f++) {
      if (f === WALL_PISTON && !reachesLid) continue;  // the gas is not there yet
      total += this.impulseWindow[f];
    }
    if (area <= 0) area = this.contactArea;
    return total / (area * t);
  }

  /** The force the gas has been putting on the lid over the window, N. */
  get lidForce() {
    return this.windowTime > 0 ? this.impulseWindow[WALL_PISTON] / this.windowTime : 0;
  }

  /**
   * The force the gas has been putting on one face over the window, N.
   *
   * Momentum per second and nothing else: this is the number the molecules
   * actually handed the wall, so dividing it by that wall's area is pressure
   * rather than a formula for pressure. The panel shows both halves of that
   * division, which is the whole of the collision theory of gases.
   */
  forceOn(face) {
    return this.windowTime > 0 ? this.impulseWindow[face] / this.windowTime : 0;
  }

  /**
   * The force every surface the gas touches has been taking, N.
   *
   * The five fixed faces always, and the lid only once the gas has reached it -
   * the same rule `pressure()` and `contactArea` use, so `totalForce /
   * contactArea` and `pressure()` are the same measurement arrived at twice.
   */
  get totalForce() {
    if (!(this.windowTime > 0)) return 0;
    const reachesLid = this.occupiedLength >= this.lid.x - 1e-12;
    let total = 0;
    for (let f = 0; f < 6; f++) {
      if (f === WALL_PISTON && !reachesLid) continue;
      total += this.impulseWindow[f];
    }
    return total / this.windowTime;
  }

  /**
   * The rate energy is crossing the walls, W - positive into the gas.
   *
   * This is what a flame actually delivers, and it is the number that says
   * whether a burner is winning: the floor brings heat in at one rate and the
   * cooler faces carry it away at another, and the panel can watch the two meet.
   */
  get heatRate() {
    return this.windowTime > 0 ? this.heatWindow / this.windowTime : 0;
  }

  /**
   * The compressibility factor, Z = P V / (N k T) - the ideal gas law, measured.
   * One for an ideal gas; hard spheres are a couple of percent above it here,
   * and B2 n below says by how much they should be.
   */
  compressibility() {
    /* The window's temperature, not the instant's: see windowTemperature. */
    const T = this.windowTemperature();
    if (this.n === 0 || T <= 0) return 0;
    return (this.pressure() * this.volume) / (this.n * K_B * T);
  }

  /** What the second virial coefficient predicts for Z at this density. */
  predictedCompressibility() {
    const d = 2 * this.radius[0];
    return 1 + secondVirial(d) * this.numberDensity;
  }

  /**
   * Impacts on the fixed walls per second per unit area, 1/(m^2 s) - the picture
   * behind the pressure: the rate times the momentum each one carries is n k T.
   *
   * The area is the five fixed faces and no more. The lid has its own collisions
   * and its own force readout, so counting its neighbours' impacts against its
   * area as well would report a rate a sixth below the one the gas is making -
   * which is exactly the size of the disagreement a reader would be trying to
   * explain.
   */
  impactRate() {
    if (!(this.windowTime > 0)) return 0;
    const reachesLid = this.occupiedLength >= this.lid.x - 1e-12;
    const count = this.wallCollisionsWindow + (reachesLid ? this.lidCollisionsWindow : 0);
    return count / (this.contactArea * this.windowTime);
  }

  /** Molecule-molecule collisions per second in the whole box, counted. */
  pairCollisionRate() {
    return this.windowTime > 0 ? this.pairCollisionsWindow / this.windowTime : 0;
  }

  /** Collisions per molecule per second, counted - compare with v-bar / lambda. */
  collisionFrequency() {
    return this.n > 0 ? this.pairCollisionRate() / this.n : 0;
  }

  /** How many pair distances the solver tested per second - the cost of
   *  honesty, and worth showing on a workbench. */
  checkRate() {
    return this.windowTime > 0 ? this.checksWindow / this.windowTime : 0;
  }

  /** Molecules through the pinhole per second - the effusion rate, counted. */
  escapeRate() {
    return this.time > 0 ? this.escaped / this.time : 0;
  }

  /**
   * A histogram of molecular speeds, and the Maxwell-Boltzmann curve it should
   * lie on.
   *
   * The counts are returned as a *fraction per bin*, so the curve can be drawn
   * on the same axis whatever the molecule count is: this is a probability
   * distribution, not a bar chart of the box's contents. To compare, multiply
   * `theoretical` by `width`.
   *
   * @param {number} bins
   * @param {number} vMax m/s the last bin ends at
   * @param {number|null} kind restrict to one kind of molecule, or null for all
   */
  speedHistogram(bins, vMax, kind = null) {
    if (this._histogram.length !== bins) this._histogram = new Float64Array(bins);
    const counts = this._histogram;
    counts.fill(0);
    const width = vMax / bins;
    let total = 0;
    for (let i = 0; i < this.n; i++) {
      if (kind !== null && this.kind[i] !== kind) continue;
      const v = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
      counts[Math.min(bins - 1, Math.floor(v / width))]++;
      total++;
    }
    if (total) for (let b = 0; b < bins; b++) counts[b] /= total;
    const mass = this.meanMass(kind);
    const T = this.temperature(kind);
    return { counts, bins, width, vMax, total, mass, temperature: T, theoretical: maxwellBoltzmann(mass, T) };
  }

  /* --------------------------------- physics ------------------------------- */

  /**
   * One physics step.
   *
   * Free flight, then collisions, then a new record for the books. The lid is
   * moved before the molecules are resolved against it, so a molecule always
   * meets the wall it actually arrived at.
   */
  step(dt = this.dt) {
    this.time += dt;
    this.steps++;
    this.windowTime += dt;
    this._lidImpulseStep = 0;
    this._move(dt);
    this._resolvePairs();
    this._moveLid(dt);
    this._resolveWalls();
    this._smoothLidForce(dt);
    /* One sample of the gas's energy per step, for the window temperature. It is
       the only O(n) pass this loop adds, and it is what lets the panel divide
       this window's pressure by this window's temperature. */
    this.energySum += this.internalEnergy();
    this.energySamples++;
    if (this.windowTime >= this.windowDuration) this.markWindow();
  }

  /**
   * The lid's force, smoothed over about the time a heavy lid would take to
   * answer a single impact. The window average in the panel is untouched by
   * this: it is the raw measurement.
   */
  _smoothLidForce(dt) {
    const instantaneous = this._lidImpulseStep / dt;
    const a = Math.min(1, dt / this.lidForceTau);
    this.lidForceSmooth += (instantaneous - this.lidForceSmooth) * a;
  }

  /** Take several steps at once, for the frame loop. */
  advance(steps) {
    for (let i = 0; i < steps; i++) this.step();
  }

  _move(dt) {
    const { x, y, z, vx, vy, vz, n } = this;
    for (let i = 0; i < n; i++) {
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      z[i] += vz[i] * dt;
    }
  }

  /**
   * Molecule-molecule collisions, by sweep and prune.
   *
   * A gas is dilute: each molecule has about one other within a diameter of it,
   * so of the 1.6 million pairings in this box only a handful deserve a
   * distance test. Keeping the molecule list sorted by x (an insertion sort,
   * which costs almost nothing because it is already nearly sorted from the
   * last step) turns "which pairs are close?" into "walk forward while the gap
   * in x is small", and what is left is a few thousand cheap tests a step
   * instead of a million and a half.
   */
  _resolvePairs() {
    const { x, y, z, radius, mass, vx, vy, vz, order, n } = this;
    if (this._orderDirty || order.length < n) {
      this.order = new Int32Array(Math.max(this.maxMolecules, n));
      for (let i = 0; i < n; i++) this.order[i] = i;
      this._orderDirty = false;
    }
    const line = this.order;
    /* Keep the list sorted by x. The sweep below reads positions and never
       writes them, so one snapshot per molecule is enough and the order it
       relies on is never disturbed while it runs. */
    for (let a = 1; a < n; a++) {
      const i = line[a];
      const xi = x[i];
      let b = a - 1;
      while (b >= 0 && x[line[b]] > xi) { line[b + 1] = line[b]; b--; }
      line[b + 1] = i;
    }

    let checks = 0;
    let fixes = 0;
    for (let a = 0; a < n; a++) {
      const i = line[a];
      const ri = radius[i];
      const xi = x[i];
      const yi = y[i];
      const zi = z[i];
      for (let b = a + 1; b < n; b++) {
        const j = line[b];
        const dx = x[j] - xi;
        const reach = ri + radius[j];
        if (dx > reach) break;   // sorted by x: nobody past this one can reach
        checks++;
        const dy = y[j] - yi;
        if (dy > reach || dy < -reach) continue;
        const dz = z[j] - zi;
        if (dz > reach || dz < -reach) continue;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= reach * reach) continue;

        const d = Math.sqrt(d2);
        /* Two molecules exactly concentric have no line between them to push
           along; the x axis is as good a choice as any, and a pair only gets
           here by having been apart a moment ago. */
        const nx = d > 1e-15 ? dx / d : 1;
        const ny = d > 1e-15 ? dy / d : 0;
        const nz = d > 1e-15 ? dz / d : 0;
        const invI = 1 / mass[i];
        const invJ = 1 / mass[j];
        const invSum = invI + invJ;

        /* The overlap is recorded, not applied: moving molecules mid-sweep
           would move the ground the sweep is standing on, and a contact normal
           computed from a stale position is not a unit vector - which is a
           collision that conserves momentum and quietly invents energy. */
        const overlap = reach - d;
        if (overlap > 0 && fixes < this._fixI.length) {
          this._fixI[fixes] = i;
          this._fixJ[fixes] = j;
          this._fixN[fixes * 3] = nx;
          this._fixN[fixes * 3 + 1] = ny;
          this._fixN[fixes * 3 + 2] = nz;
          this._fixShare[fixes * 2] = (overlap * invI) / invSum;
          this._fixShare[fixes * 2 + 1] = (overlap * invJ) / invSum;
          fixes++;
        }

        const approach = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny + (vz[j] - vz[i]) * nz;
        if (approach >= 0) continue;   // already separating: nothing owed
        const impulse = (2 * approach) / invSum;
        vx[i] += nx * impulse * invI; vy[i] += ny * impulse * invI; vz[i] += nz * impulse * invI;
        vx[j] -= nx * impulse * invJ; vy[j] -= ny * impulse * invJ; vz[j] -= nz * impulse * invJ;
        this.pairCollisions++;
        this.pairCollisionsWindow++;
      }
    }
    this.checks = checks;
    this.checksWindow += checks;
    if (fixes) this._applySeparations(fixes);
  }

  /**
   * Put overlapping pairs back to touching: a translation each, shared in
   * proportion to how easily the two move, so the light one is the one that
   * gives - which is why a helium atom bounces off argon and not the other way
   * round. A translation does no work, so no velocity and no energy changes.
   */
  _applySeparations(count) {
    const { x, y, z } = this;
    for (let k = 0; k < count; k++) {
      const i = this._fixI[k];
      const j = this._fixJ[k];
      const nx = this._fixN[k * 3];
      const ny = this._fixN[k * 3 + 1];
      const nz = this._fixN[k * 3 + 2];
      const shareI = this._fixShare[k * 2];
      const shareJ = this._fixShare[k * 2 + 1];
      x[i] -= nx * shareI; y[i] -= ny * shareI; z[i] -= nz * shareI;
      x[j] += nx * shareJ; y[j] += ny * shareJ; z[j] += nz * shareJ;
    }
  }

  /**
   * Wall collisions: the five fixed faces, plus the lid, plus a way out.
   *
   * A molecule is only turned round if it is moving into the wall, so one the
   * separation step left touching a face is not bounced again every step. This
   * is where the gas meets the world, and so it is where the heat, the pressure
   * and the work all come from.
   */
  _resolveWalls() {
    const { x, y, z, vx, vy, vz, radius } = this;
    const h = this.crossSection / 2;
    const lidX = this.lid.x;
    const hole = this.hole;

    /* `this.n`, not a copy of it: a molecule through the pinhole shrinks the gas
       and fills its own slot with the last molecule in the box, so a loop bound
       captured before the loop would run on past the end and reflect - and
       escape - molecules that are no longer in the gas at all. */
    for (let i = 0; i < this.n; i++) {
      const r = radius[i];

      if (y[i] - r < -h && vy[i] < 0) {
        y[i] = -h + r;
        this._hitWall(i, WALL_Y_NEG, 0, 1, 0);
      } else if (y[i] + r > h && vy[i] > 0) {
        y[i] = h - r;
        this._hitWall(i, WALL_Y_POS, 0, -1, 0);
      }
      if (z[i] - r < -h && vz[i] < 0) {
        z[i] = -h + r;
        this._hitWall(i, WALL_Z_NEG, 0, 0, 1);
      } else if (z[i] + r > h && vz[i] > 0) {
        z[i] = h - r;
        this._hitWall(i, WALL_Z_POS, 0, 0, -1);
      }

      /* The back wall, and the pinhole in it. A molecule that reaches the wall
         inside the hole is gone: what becomes of it outside is not the
         experiment, the rate at which it leaves is. */
      if (x[i] - r < 0 && vx[i] < 0) {
        /* A molecule gets through if it fits: the aperture it can use is the
           hole less its own radius, so a wide atom is turned away by a hole a
           narrow one sails out of. That is also why the effusion rate is not
           quite n v-bar A / 4 for a small hole - the area it can reach is
           smaller than the area that was drilled. */
        const aperture = hole - r;
        if (aperture > 0 && y[i] * y[i] + z[i] * z[i] < aperture * aperture) {
          this._escape(i);
          continue;
        }
        x[i] = r;
        this._hitWall(i, WALL_BACK, 1, 0, 0);
      }

      /* The membrane, which is a smooth wall in the middle of the box.

         Two separate jobs, and they are deliberately not the same condition.
         Turning a molecule round applies only to one moving *into* the wall;
         putting it back on its own side applies to any molecule whose centre is
         closer to the partition than its own radius, whether or not it is
         moving that way. The second case is not hypothetical: the pair solver
         pushes two molecules apart along their own line, which can shove one of
         them into a wall it is not looking at, and a solid partition is not
         somewhere a molecule can be even for one step. It costs nothing to fix
         - moving a molecule's position is not moving its energy, so the ledger
         is untouched - and it is what makes "has the gas reached the partition"
         a question about a radius rather than about how the solver happened to
         order its passes. */
      if (this.membrane.present && x[i] + r > this.membrane.x) {
        x[i] = this.membrane.x - r;
        if (vx[i] > 0) vx[i] = -vx[i];
      }

      /* The lid. It only stops a molecule it is actually catching: in the lid's
         own frame the molecule has to be moving towards it. That single rule is
         what makes a receding lid do negative work and an advancing one
         positive work, with no special cases, and it is also what stops a
         molecule resting on a still lid from being bounced for ever. */
      if (x[i] + r > lidX) {
        x[i] = lidX - r;
        if (vx[i] > this.lid.velocity) this._hitLid(i);
      }
      void vz; void vy;
    }
  }

  /**
   * One molecule meets one fixed wall.
   *
   * @param {number} face which of the six
   * @param {number} nx,ny,nz that wall's inward normal
   */
  _hitWall(i, face, nx, ny, nz) {
    const { vx, vy, vz, mass } = this;
    const m = mass[i];
    const before = 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    const vNormalBefore = vx[i] * nx + vy[i] * ny + vz[i] * nz;

    /* The one face with a flame under it is a surface at the flame's
       temperature rather than at the air's - see the burner note in the
       constructor. Zero for every other face, and for the floor of a box with
       no burner, so the ordinary path is untouched by any of this. */
    const flame = this.burner.on && face === BURNER_FACE ? this.burner.temperature : 0;

    if (flame > 0 || this.walls === "thermal") {
      /* A surface held at a temperature hands back a velocity drawn from the
         flux-weighted Maxwellian in the normal direction, and a plain one
         tangentially - see the note at the top of the file for why the
         weighting is not optional. */
      const sigma = Math.sqrt((K_B * (flame || this.bath)) / m);
      const speed = sigma * Math.sqrt(-2 * Math.log(1 - this.random()));
      const [t1, t2] = tangentialAxes(nx, ny, nz);
      const a = sigma * this._gauss();
      const b = sigma * this._gauss();
      vx[i] = nx * speed + t1[0] * a + t2[0] * b;
      vy[i] = ny * speed + t1[1] * a + t2[1] * b;
      vz[i] = nz * speed + t1[2] * a + t2[2] * b;
    } else {
      /* A smooth hard wall: the normal component reverses and nothing else
         happens. This is the wall an adiabatic squeeze needs. */
      if (nx !== 0) vx[i] = -vx[i];
      if (ny !== 0) vy[i] = -vy[i];
      if (nz !== 0) vz[i] = -vz[i];
    }

    const after = 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    const vNormalAfter = vx[i] * nx + vy[i] * ny + vz[i] * nz;
    /* The wall collected the momentum the molecule handed over along its
       normal - read off the velocities rather than assumed, because a thermal
       wall's departing molecule does not carry what a specular bounce
       would have. */
    const impulse = m * (vNormalAfter - vNormalBefore);

    this.heat += after - before;
    this.heatWindow += after - before;
    this.impulse[face] += impulse;
    this.impulseWindow[face] += impulse;
    this.wallCollisions++;
    this.wallCollisionsWindow++;
    if (this.trackImpacts) this._noteImpact(i, face, impulse);
  }

  /**
   * Write one wall impact into the ring buffer the stage draws sparks from.
   *
   * The position is snapped onto the face it struck rather than taken from the
   * molecule's centre: a molecule is stopped half a diameter short of the wall,
   * and a spark drawn there would look like one floating in the gas. `impulse`
   * is kept signed - a hard hit is a brighter spark, which is what makes the
   * picture the same statement the force readout is making.
   */
  _noteImpact(i, face, impulse) {
    const log = this.impactLog;
    const k = log.next;
    const h = this.crossSection / 2;
    log.x[k] = face === WALL_BACK ? 0 : face === WALL_PISTON ? this.lid.x : this.x[i];
    log.y[k] = face === WALL_Y_NEG ? -h : face === WALL_Y_POS ? h : this.y[i];
    log.z[k] = face === WALL_Z_NEG ? -h : face === WALL_Z_POS ? h : this.z[i];
    log.face[k] = face;
    log.impulse[k] = impulse;
    log.step[k] = this.steps;
    log.next = (k + 1) % MAX_IMPACT_LOG;
    if (log.count < MAX_IMPACT_LOG) log.count++;
    log.recorded++;
  }

  /**
   * The lid, which can be moving.
   *
   * A molecule that meets it is reflected in the lid's frame - a smooth surface,
   * so the bounce is specular and the process is reversible, which is exactly
   * what a quasi-static adiabatic squeeze requires. The energy it takes or
   * gives is counted as work, and it is the only thing in this file that ever
   * writes to `work`.
   */
  _hitLid(i) {
    const { vx, vy, vz, mass } = this;
    const m = mass[i];
    const u = this.lid.velocity;
    const incoming = vx[i];
    const before = 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);

    if (this.lidThermal) {
      /* An isothermal lid holds the gas at its own temperature, so this is the
         same resampling as any other thermal wall - and for an isothermal
         compression that is exactly what is wanted. The lid sits at the +x end
         of the box, so the direction it sends a molecule away in is -x; getting
         that backwards pins molecules to the lid and pumps them, which is a
         mistake that looks like a subtly wrong temperature rather than a
         broken direction. */
      const sigma = Math.sqrt((K_B * this.bath) / m);
      const speed = sigma * Math.sqrt(-2 * Math.log(1 - this.random()));
      vx[i] = -speed;
      vy[i] = sigma * this._gauss();
      vz[i] = sigma * this._gauss();
    } else {
      vx[i] = 2 * u - incoming;
    }

    const after = 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    /* The lid's inward normal is -x, so the momentum it collected along it is
       -m(vx' - vx) - the same sign convention `_hitWall` uses, where `impulse`
       is positive when it is pushing the wall inwards. */
    const impulse = m * (incoming - vx[i]);
    const delta = after - before;

    /* Where the energy is booked matters, because the ledger has to add up.
       A lid held at a temperature is a reservoir: what crosses that boundary is
       heat. A lid that only reflects is a moving wall doing work, and this is
       the one term in the whole file that writes to `work`. */
    if (this.lidThermal) {
      this.heat += delta;
      this.heatWindow += delta;
    } else {
      this.work += delta;
      this.workWindow += delta;
    }
    this.impulse[WALL_PISTON] += impulse;
    this.impulseWindow[WALL_PISTON] += impulse;
    this._lidImpulseStep += impulse;
    this.lidCollisions++;
    this.lidCollisionsWindow++;
    if (this.trackImpacts) this._noteImpact(i, WALL_PISTON, impulse);
  }

  /** A molecule through the pinhole: counted once, then gone. */
  _escape(i) {
    const m = this.mass[i];
    this.escapedEnergy += 0.5 * m * (this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2);
    this.escaped++;
    this.escapedByKind[this.kind[i]]++;
    /* Move the last molecule into the hole and shrink the gas. The x order is
       no longer a permutation of 0..n-1, so the next step rebuilds it. */
    const last = this.n - 1;
    if (i !== last) {
      this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.mass[i] = this.mass[last]; this.radius[i] = this.radius[last]; this.kind[i] = this.kind[last];
    }
    this.n = last;
    this._orderDirty = true;
  }

  /**
   * Move the lid.
   *
   * In 'load' mode it is a massless boundary with a seal: the gas's measured
   * force, against the load outside, drives it through the seal's friction, so
   * it slides to wherever the two balance. That is the quasi-static limit of a
   * real piston, and it is chosen deliberately rather than for convenience - a
   * real lid on this box oscillates at about a hundred megahertz, which no
   * timeline a person can watch will ever show. A 'hand' lid follows the stage
   * instead, and is limited to a genuinely gentle push; a hand's speed in this
   * gas would be Mach 100 and would make a shock wave, not a compression.
   */
  _moveLid(dt) {
    if (this.lid.mode !== "load") return;
    const area = this.lidArea;
    /* Two things hold a free lid in and they are one pressure on it: the
       weights on its face and the air the box stands in. */
    const hold = this.lid.load + this.lid.external;
    const net = this.lidForceSmooth - hold * area;
    const cap = MAX_LID_MACH * Math.max(this.rmsSpeed(), 1);
    /* A lid that snapped to its balance point and rattled around it is not what
       a real one does. The speed is the imbalance measured against the force
       scale already in play, so a big imbalance moves at the cap and a small
       one inches; `seal` says how sharply it answers. */
    const scale = Math.max(hold * area, this.pressure() * area, 1e-16);
    const share = net / (Math.abs(net) + Math.max(this.lid.seal, 1e-6) * scale);
    const v = Math.max(-cap, Math.min(cap, cap * share));
    this.lid.velocity = v;
    const next = this.lid.x + v * dt;
    if (next <= MIN_LENGTH || next >= MAX_LENGTH) {
      this.lid.velocity = 0;
      this.lid.x = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, next));
    } else {
      this.lid.x = next;
    }
  }

  /**
   * Move the lid to `x`, as a hand would, at no more than a gentle pace.
   *
   * The velocity matters: it is what the lid's surface tells a molecule
   * arriving at it, and so it is what makes a fast push add more energy than a
   * slow one. Because it is capped, the process stays reversible.
   *
   * @param {number} x m
   * @param {number} [dt] s - the step the move happens over
   */
  setLid(x, dt = this.dt) {
    const next = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, x));
    const cap = MAX_LID_MACH * Math.max(this.rmsSpeed(), 1);
    const wanted = (next - this.lid.x) / Math.max(dt, 1e-30);
    const v = Math.max(-cap, Math.min(cap, wanted));
    this.lid.x = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, this.lid.x + v * dt));
    this.lid.velocity = v;
    this._clampToLid();
  }

  /** Send the lid to a target over one step, no faster than the cap allows:
   *  the frame-loop version of setLid, so a drag is a slow push. */
  driveLid(target, dt) {
    this.setLid(target, dt);
  }

  /**
   * Put the lid where it is told, now, as a change of configuration rather than
   * a process.
   *
   * This is the panel's lid slider in 'fixed' mode, where the lid is a fixed
   * boundary: moving it is re-declaring the box rather than squeezing it, so
   * there is no gentle cap and no process to watch. Molecules the lid sweeps are
   * placed inside it, and the energy books are re-anchored afterwards, so a
   * change of shape leaves no residue in the ledger - the same rule every other
   * edit follows.
   *
   * A squeeze worth measuring is made by hand or by a load, both of which move
   * the lid the honest way, one capped step at a time.
   */
  placeLid(x) {
    this.lid.x = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, x));
    this.lid.velocity = 0;
    this._clampToLid();
    this.reanchor();
  }

  /** A hand that lets go: the lid keeps the velocity it had, or stops. */
  releaseLid() {
    this.lid.velocity = 0;
  }

  /**
   * Put anything outside the box back inside it, and give a molecule the lid
   * has swept into the velocity the lid has.
   *
   * A wall that moves over a molecule does work on it; if that work were not
   * counted the first law would fail the instant a hand touched the lid.
   */
  _clampToLid() {
    const { x, y, z, vx, vy, vz, radius, n } = this;
    const h = this.crossSection / 2;
    const lidX = this.lid.x;
    for (let i = 0; i < n; i++) {
      const r = radius[i];
      if (x[i] + r > lidX) {
        x[i] = lidX - r;
        /* Only a molecule the lid is catching is affected - the same rule the
           collision path uses, so the two can never disagree. */
        if (vx[i] > this.lid.velocity) {
          const before = 0.5 * this.mass[i] * vx[i] * vx[i];
          vx[i] = 2 * this.lid.velocity - vx[i];
          const after = 0.5 * this.mass[i] * vx[i] * vx[i];
          this.work += after - before;
          this.workWindow += after - before;
        }
      }
      if (x[i] - r < 0) { x[i] = r; if (vx[i] < 0) vx[i] = -vx[i]; }
      if (y[i] - r < -h) { y[i] = -h + r; if (vy[i] < 0) vy[i] = -vy[i]; }
      if (y[i] + r > h) { y[i] = h - r; if (vy[i] > 0) vy[i] = -vy[i]; }
      if (z[i] - r < -h) { z[i] = -h + r; if (vz[i] < 0) vz[i] = -vz[i]; }
      if (z[i] + r > h) { z[i] = h - r; if (vz[i] > 0) vz[i] = -vz[i]; }
    }
  }

  /* -------------------------------- editing -------------------------------- */

  /** Re-deal the whole box at the walls' temperature, keeping the layout. */
  reset() {
    this.fill(this.n);
  }

  /** Change how many molecules there are, keeping the box and the temperature. */
  setCount(count) {
    this.fill(Math.max(MIN_MOLECULES, Math.min(this.maxMolecules, Math.round(count))));
  }

  /**
   * Change the gas. The speeds are re-dealt, because a new gas at the same
   * temperature has different speeds - that is the whole of Graham's law.
   */
  setSpecies(key) {
    if (!SPECIES.some((s) => s.key === key)) return;
    this.speciesKey = key;
    this.updateStep();
    this.fill(this.n);
  }

  /** Mix a second gas in, or turn the mixture off with a null key. */
  setMixture(key, fraction = this.mixFraction) {
    this.secondKey = key ? speciesOf(key).key : null;
    this.mixFraction = Math.max(0, Math.min(1, fraction));
    this.updateStep();
    this.fill(this.n);
  }

  /** Set the walls' temperature and settle the gas on it. */
  setBath(T) {
    this.bath = Math.max(1, T);
    this.updateStep();
    this.dealVelocities();
    this.markWindow();
    this.reanchor();
  }

  /**
   * Light the flame under the floor, or put it out, and set how hot it is.
   *
   * Unlike `setBath`, this does *not* re-deal the gas: a flame is a process that
   * heats a gas over time, and one that instantly made the gas the flame's
   * temperature would delete the experiment (and take the heat bookkeeping with
   * it - the energy the gas gained would appear from nowhere). The step is
   * refined to resolve the fastest molecules the flame can make, which is the
   * one thing here that has to happen immediately.
   */
  setBurner(on, temperature = this.burner.temperature) {
    this.burner.on = !!on;
    this.burner.temperature = Math.max(1, temperature);
    this.updateStep();
  }

  /** Whether to keep a ring buffer of where the walls were hit. */
  setTrackImpacts(on) {
    this.trackImpacts = !!on;
  }

  /** Throw away the logged impacts - the clean slate a new experiment needs. */
  clearImpacts() {
    const log = this.impactLog;
    log.next = 0;
    log.count = 0;
    log.recorded = 0;
  }

  /** Insulated or temperature-held walls. */
  setWalls(mode) {
    this.walls = mode === "elastic" ? "elastic" : "thermal";
    this.markWindow();
  }

  /** Whether the lid holds the gas at the walls' temperature too. */
  setLidThermal(on) {
    this.lidThermal = !!on;
    this.markWindow();
  }

  /** The radius of the pinhole in the back wall, m. Zero closes it. */
  /**
   * Drill a hole in the back wall, or close it again.
   *
   * The measurement window is emptied by default, because a window spanning the
   * moment the hole opened would average the rate before it with the rate after
   * and report neither. `rewindow: false` is for the one caller with nothing to
   * mix: the panel opening a lab's own hole at the end of that lab's warm-up.
   */
  setHole(radius, { rewindow = true } = {}) {
    this.hole = Math.max(0, Math.min(this.crossSection / 3, radius));
    if (rewindow) this.markWindow();
  }

  /** The width and height of the box, m. */
  setCrossSection(side) {
    this.crossSection = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, side));
    this.fill(this.n);
  }

  /** Where the lid is, m. Used by the sliders; goes through the gentle cap. */
  setLength(x, dt = this.dt) {
    this.setLid(x, dt);
  }

  /** What holds the lid in while it is free, Pa. */
  setLoad(pressure) {
    this.lid.load = Math.max(0, pressure);
  }

  /**
   * The pressure of the air around the box, on the lid's outer face, Pa.
   *
   * A boundary condition rather than a measurement, which is why it is held
   * here rather than counted off the molecules: it is the pressure of the room
   * the experiment is standing in, and setting it is stating what that room is,
   * the same way setting the bath states how warm it is. It is a pressure
   * holding the lid in, so it acts exactly where the weights do and adds to
   * them, and the opening the gas can see is unchanged.
   */
  setExternal(pressure) {
    this.lid.external = Math.max(0, pressure);
  }

  /** How badly the lid leaks past its seal, N s/m. */
  setSeal(seal) {
    this.lid.seal = Math.max(1e-18, seal);
  }

  /**
   * Put the partition back in, or move it.
   *
   * The membrane is a smooth wall, so it neither heats the gas nor cools it, and
   * taking it out costs the gas nothing: what is on the far side is vacuum, and
   * a gas pushing into vacuum is not pushing against anything. That is why this
   * is the one expansion that leaves the temperature alone, and it is the
   * reason for the membrane being in the model at all.
   */
  setMembrane(present, x = this.membrane.x) {
    this.membrane.present = !!present;
    this.membrane.x = Math.max(MIN_LENGTH * 0.5, Math.min(this.lid.x - 1e-10, x));
    this.reanchor();
  }

  /** Take the partition out. */
  removeMembrane() {
    this.membrane.present = false;
    this.reanchor();
  }

  /** 'fixed' pins the lid, 'hand' lets it be dragged, 'load' lets it balance. */
  setLidMode(mode) {
    this.lid.mode = mode === "load" || mode === "hand" ? mode : "fixed";
    if (this.lid.mode !== "hand") this.lid.velocity = 0;
  }

  /** The size of a physics step, s. */
  setStep(dt) {
    this.dt = Math.max(1e-15, Math.min(1e-11, dt));
  }

  /* ------------------------------ bookkeeping ------------------------------ */

  /** Everything the panels read, in one object, so the frame makes one call. */
  observe() {
    const ledger = this.ledger();
    const species = speciesOf(this.speciesKey);
    const second = this.secondKey ? speciesOf(this.secondKey) : null;
    return {
      species,
      second,
      molecules: this.n,
      time: this.time,
      steps: this.steps,
      temperature: this.temperature(),
      windowTemperature: this.windowTemperature(),
      impactCount: this.impactCount,
      bath: this.bath,
      burner: { on: this.burner.on, temperature: this.burner.temperature },
      hottestSurface: this.hottestSurface,
      heatRate: this.heatRate,
      pressure: this.pressure(),
      lidPressure: this.pressure(WALL_PISTON),
      lidForce: this.lidForce,
      totalForce: this.totalForce,
      impactLog: this.trackImpacts ? this.impactLog : null,
      volume: this.volume,
      length: this.lid.x,
      occupiedLength: this.occupiedLength,
      contactArea: this.contactArea,
      crossSection: this.crossSection,
      numberDensity: this.numberDensity,
      compressibility: this.compressibility(),
      predictedCompressibility: this.predictedCompressibility(),
      internalEnergy: ledger.internalEnergy,
      ledger,
      rmsSpeed: this.rmsSpeed(),
      meanSpeed: this.meanSpeed(),
      freePath: this.meanFreePath(),
      spacing: this.moleculeSpacing(),
      collisions: this.pairCollisions,
      collisionRate: this.pairCollisionRate(),
      collisionFrequency: this.collisionFrequency(),
      checkRate: this.checkRate(),
      wallCollisions: this.wallCollisions,
      lidCollisions: this.lidCollisions,
      impactRate: this.impactRate(),
      escapeRate: this.escapeRate(),
      escaped: this.escaped,
      escapedByKind: this.escapedByKind,
      lid: { x: this.lid.x, velocity: this.lid.velocity, mode: this.lid.mode, load: this.lid.load, seal: this.lid.seal, thermal: this.lidThermal },
      lidForceSmooth: this.lidForceSmooth,
      /* The pressure of the air around the box, not of the gas: a boundary
         condition, quoted so a panel or a gauge can say what it was set to. */
      externalPressure: this.lid.external,
      membrane: { present: this.membrane.present, x: this.membrane.x },
      walls: this.walls,
      hole: this.hole,
      window: this.windowTime,
      kinds: [this.kindCount(0), this.kindCount(1)],
      kindTemperatures: [this.temperature(0), this.temperature(1)],
      kindSpeeds: [this.meanSpeed(0), this.meanSpeed(1)],
      gasMass: this.gasMass,
      moles: this.moles,
    };
  }

  /* ------------------------------- snapshots ------------------------------- */

  /** The whole gas, for a page snapshot or a saved session. */
  serialize() {
    const take = (a) => Array.from(a.subarray(0, this.n));
    return {
      species: this.speciesKey,
      second: this.secondKey,
      mixFraction: this.mixFraction,
      bath: this.bath,
      burner: { ...this.burner },
      dt: this.dt,
      hole: this.hole,
      walls: this.walls,
      lidThermal: this.lidThermal,
      membrane: { present: this.membrane.present, x: this.membrane.x },
      crossSection: this.crossSection,
      length: this.lid.x,
      lid: { ...this.lid },
      time: this.time,
      n: this.n,
      escaped: this.escaped,
      escapedByKind: [...this.escapedByKind],
      escapedEnergy: this.escapedEnergy,
      heat: this.heat,
      work: this.work,
      internalEnergy0: this.internalEnergy0,
      x: take(this.x), y: take(this.y), z: take(this.z),
      vx: take(this.vx), vy: take(this.vy), vz: take(this.vz),
      mass: take(this.mass), radius: take(this.radius), kind: take(this.kind),
    };
  }

  restore(saved) {
    if (!saved) return false;
    this.speciesKey = saved.species ?? this.speciesKey;
    this.secondKey = saved.second ?? null;
    this.mixFraction = saved.mixFraction ?? this.mixFraction;
    this.bath = saved.bath ?? this.bath;
    if (saved.burner) this.burner = { on: !!saved.burner.on, temperature: Math.max(1, saved.burner.temperature ?? this.burner.temperature) };
    this.dt = saved.dt ?? this.dt;
    this.hole = saved.hole ?? 0;
    this.walls = saved.walls ?? "thermal";
    this.lidThermal = saved.lidThermal ?? true;
    if (saved.membrane) this.membrane = { present: !!saved.membrane.present, x: saved.membrane.x ?? this.membrane.x };
    this.crossSection = saved.crossSection ?? this.crossSection;
    this.length = saved.length ?? this.length;
    Object.assign(this.lid, saved.lid ?? {});

    const n = Math.max(0, Math.min(saved.n ?? 0, this.maxMolecules));
    this.n = n;
    const load = (target, source) => { if (source && source.length) target.set(source.slice(0, n)); };
    load(this.x, saved.x); load(this.y, saved.y); load(this.z, saved.z);
    load(this.vx, saved.vx); load(this.vy, saved.vy); load(this.vz, saved.vz);
    load(this.mass, saved.mass); load(this.radius, saved.radius);
    if (saved.kind && saved.kind.length) this.kind.set(saved.kind.slice(0, n));
    this._orderDirty = true;
    this.lid.x = saved.lid?.x ?? this.length;

    this.resetCounters();
    this.time = saved.time ?? 0;
    this.escaped = saved.escaped ?? 0;
    this.escapedByKind = saved.escapedByKind ? [...saved.escapedByKind] : [0, 0];
    this.escapedEnergy = saved.escapedEnergy ?? 0;
    this.heat = saved.heat ?? 0;
    this.work = saved.work ?? 0;
    this.internalEnergy0 = saved.internalEnergy0 ?? this.internalEnergy();
    return true;
  }
}
