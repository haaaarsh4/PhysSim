/**
 * frontend/thermo_labs.js - the experiments on the Thermo lab bench.
 *
 * Data only, exactly like frontend/labs.js: each entry is a box to fill, a
 * bench to set up and a question to answer, and frontend/thermo_main.js owns the
 * filling. The shape of an entry is the shape of the workbench's own state, so
 * every lab is a setup a student could have made by hand with the panels.
 *
 * `aim` states the law in one line and `asks` gives two things to try, because
 * a list of instructions is a worksheet and two questions are an experiment.
 * Nothing here is longer than that on purpose.
 *
 * `state` is the box: the same fields the constructor of simulation/gas.js
 * takes, so a lab is literally a set of constructor options. `hold` is the one
 * extra - it is the number of picoseconds of gas time the scene is worth
 * watching for before its numbers mean anything, which the panel uses to say
 * how long to run rather than leaving a student to guess.
 *
 * `state.impacts` is the one key that is not physics: it switches the wall-impact
 * visualisation on, because the lab about where pressure comes from cannot be
 * answered with the evidence switched off.
 *
 * Nothing here names a view mode, for the same reason the dynamics labs do not:
 * the box is a real 3D box with a lid on the end of it, and a lab is built in
 * whichever view the user is already in.
 *
 * ---------------------------------------------------------------------------
 * THE BENCH
 * ---------------------------------------------------------------------------
 * `state.instruments` is what stands on the bench, and it is the instruments
 * this experiment needs and no others.
 *
 * It has to be written down rather than left to the instruments to arrive on
 * their own, because the two dials are *furniture*: a gauge and a thermometer
 * with nothing to say are two dials a reader has to look past to find the box.
 * So a lab that needs no instrument says `[]` and gets a bare box on a bare
 * bench, which is the setup it asked for - most of these experiments are a hand
 * on the lid, a switch on the rail, or simply the gas itself, and none of those
 * is a thing that stands on a table.
 *
 * The four names are the four instruments, and two of them are also statements
 * about the box rather than objects the stage keeps: a lit flame is a burner
 * (`burner: true`), and a load is the weights (`lidMode: "load"` and a `load`).
 * A lab that names one of those two is saying the bench is meant to carry it,
 * and the two must agree with the state - which is what the checks in
 * experiments/thermo_checks.js hold every entry in this file to.
 *
 * ---------------------------------------------------------------------------
 * THE ROOM
 * ---------------------------------------------------------------------------
 * Three of the four boundaries on this bench belong to an instrument: the
 * flame's temperature to the burner, the room's temperature to the thermometer,
 * and the pressure of the air around the box to the gauge. The fourth, the
 * pinhole, is a hole in the box and belongs to the box.
 *
 * `state.external` is that air pressure, in pascals, on the lid's outer face -
 * the number the gauge reads and the number its panel sets. It is 0 in almost
 * every lab here, and deliberately: a lid that is held by its latch, or driven
 * by a hand, cannot be moved by the air, and a lid resting on weights is held at
 * the pressure of that load alone. It is not 0 in the one lab whose whole
 * experiment is the air holding the lid up, and that lab is the only one whose
 * bench carries a gauge.
 *
 * ---------------------------------------------------------------------------
 * `setup`, IN ONE LINE
 * ---------------------------------------------------------------------------
 * `setup` is the bench and the room said out loud, in the numbers the panels are
 * set to, for the reader who wants to know what was switched on before they
 * start. It is written beside the state it describes so the two can be read
 * against each other, and it is the only prose here that repeats a number.
 */

export const THERMO_LABS = [
  {
    id: "ideal-gas",
    name: "The ideal gas law",
    aim: "P V = N k T: and what a gas of spheres does about it.",
    asks: [
      "Read the compressibility: how close to 1 is P V / N k T, and does the second virial coefficient B\u2082n account for the difference?",
      "Halve the volume with the lid and watch which of P and T moves.",
    ],
    state: {
      species: "ar", count: 1400, temperature: 300, crossSection: 18e-9, length: 18e-9,
      walls: "thermal", lidThermal: true, lidMode: "hand",
      instruments: [],
    },
    setup: "A sealed box of argon at 300 K with the walls holding that temperature, and a hand on the lid.",
    hold: 60,
  },
  {
    id: "wall-collisions",
    name: "Where pressure comes from",
    aim: "P = F / A, with F the momentum the molecules hand the walls every second.",
    asks: [
      "The sparks are the impacts, and every one of them is a molecule handing over momentum. Which face takes the hardest hits, and why that one?",
      "Halve the box's width. The impacts come twice as often and the pressure doubles - so which of F and A did the doubling?",
    ],
    state: {
      species: "ar", count: 1400, temperature: 300, crossSection: 18e-9, length: 18e-9,
      walls: "thermal", lidThermal: true, lidMode: "fixed",
      impacts: true,
      instruments: [],
    },
    setup: "Nothing on the bench: argon at 300 K, and the wall impacts switched on so the evidence is on the walls.",
    hold: 40,
  },
  {
    id: "maxwell",
    name: "Maxwell-Boltzmann",
    aim: "The speeds of a gas are distributed, and the curve is a prediction.",
    asks: [
      "Do the bars land on the curve, or does the curve follow the bars?",
      "Turn the room temperature up on the thermometer: the peak moves right and flattens. Which of v\u0304, v_rms and v_mp moves most?",
    ],
    state: {
      species: "he", count: 2200, temperature: 400, crossSection: 18e-9, length: 18e-9,
      walls: "thermal", lidThermal: true, lidMode: "fixed",
      instruments: ["thermometer"],
    },
    setup: "A room thermometer on a bench in a 400 K room: the walls hold the gas at that temperature.",
    hold: 40,
  },
  {
    id: "adiabat",
    name: "Adiabatic compression",
    aim: "P V^\u03B3 = constant, with \u03B3 = 5/3 for a monatomic gas.",
    asks: [
      "Squeeze the lid to half the volume and read \u03B3 off the PV trace. Is it the 5/3 the theory says?",
      "The walls are insulated, so nothing heated the gas: where did the temperature rise come from?",
    ],
    state: {
      species: "he", count: 2400, temperature: 300, crossSection: 18e-9, length: 18e-9,
      walls: "elastic", lidThermal: false, lidMode: "hand",
      instruments: [],
    },
    setup: "Nothing on the bench: helium in an insulated box, with a hand on the lid for the squeeze.",
    hold: 50,
  },
  {
    id: "isotherm",
    name: "Boyle's law",
    aim: "At constant temperature, squeezing a gas raises its pressure so that P V does not move.",
    asks: [
      "Drag the lid down to half the volume. What does the pressure do, and what does P \u00D7 V do?",
      "Heat left the gas during the squeeze. Where to? (Watch the ledger.)",
    ],
    state: {
      species: "ar", count: 1800, temperature: 300, crossSection: 18e-9, length: 24e-9,
      walls: "thermal", lidThermal: true, lidMode: "hand",
      instruments: ["thermometer"],
    },
    /*
     * The thermometer is the point of *this* law rather than a spare dial: the
     * temperature the product is constant at is the room's, the walls carry it
     * into the gas, and this is the one instrument that reads it and sets it.
     * Turn it up mid-squeeze and P V stops holding, which is the law's own
     * condition being demonstrated by removing it.
     */
    setup: "A room thermometer on a bench in a 300 K room, and a hand on the lid: same temperature, half the volume.",
    hold: 50,
  },
  {
    id: "charles",
    name: "Charles's law",
    aim: "At constant pressure, heating a gas makes it expand, and V / T is what does not move.",
    asks: [
      "Light the flame underneath with the lid resting on the load, and watch the volume and the temperature climb together. Does V / T hold?",
      "Which number stayed put: P, V, T, or P V?",
    ],
    state: {
      species: "ar", count: 1600, temperature: 300, crossSection: 18e-9, length: 14e-9,
      walls: "thermal", lidThermal: true, lidMode: "load", load: 1.45e6,
      burner: true, burnerTemperature: 1200,
      instruments: ["burner", "weights"],
    },
    /*
     * A load is the whole apparatus of a constant-pressure experiment, so the
     * weights stand on the lid and the flame burns under the floor. The air
     * around the box is left at nothing on purpose: with a load on the lid the
     * pressure the gas holds itself at is that load and no more, so the pressure
     * the rail reads is the number on the weights' own panel.
     */
    setup: "A burner at 1200 K under the box and a load of 1.45 MPa of weights on the lid: the gas holds itself at that pressure.",
    hold: 60,
  },
  {
    id: "work",
    name: "Work done by a gas",
    aim: "W = \u222B P dV: heat a gas and the area under its path on the P-V chart is the work it did.",
    asks: [
      "Light the flame and let the lid rise. Read W off the chart, then compare it with the work in the ledger - they are the same event, counted two ways.",
      "The walls are insulated, so the flame is the only thing putting energy in. How much of it left as work, and how much as a rise of temperature?",
    ],
    state: {
      species: "ar", count: 1500, temperature: 300, crossSection: 18e-9, length: 14e-9,
      walls: "elastic", lidThermal: false, lidMode: "load", load: 1.35e6,
      burner: true, burnerTemperature: 900,
      instruments: ["burner", "weights"],
    },
    setup: "A burner at 900 K under an insulated box, with the lid resting on 1.35 MPa of weights so the gas can push it up.",
    hold: 60,
  },
  {
    id: "air-pressure",
    name: "Held by the air",
    aim: "At a fixed outside pressure, the heat a gas takes in is shared between its own energy and P \u00D7 \u0394V of work.",
    asks: [
      "Light the flame and watch the path: the area under it is the pressure on the gauge times the volume the lid gained - and there is no weight on the lid at all.",
      "Set the gauge to 1.60 MPa and heat the same box again. The lid rises less and less of the heat becomes work. Where did the rest go?",
    ],
    state: {
      species: "ar", count: 1500, temperature: 300, crossSection: 18e-9, length: 18e-9,
      walls: "elastic", lidThermal: false, lidMode: "load", load: 0, external: 1.10e6,
      burner: true, burnerTemperature: 1000,
      instruments: ["burner", "gauge"],
    },
    /*
     * The one lab whose lid is held by the room rather than by iron: the air is
     * set to 1.10 MPa on the gauge, the load is nothing, and the lid finds the
     * height where the gas pushes back with exactly that. It is also the one
     * bench that carries a gauge, because a gauge reads the pressure of the air
     * around the box - a number this lab is about, and a number the other labs
     * would only have a dial reading nothing for.
     */
    setup: "A burner at 1000 K under an insulated box whose lid is held by the air alone: 1.10 MPa on the gauge, no weights.",
    hold: 60,
  },
  {
    id: "first-law",
    name: "The first law",
    aim: "\u0394U = Q + W, to the last bit, while you watch.",
    asks: [
      "Squeeze the insulated box: what is Q, and what is W?",
      "Now switch Walls hold the temperature on and squeeze the same amount: which term took the energy this time?",
    ],
    state: {
      species: "ar", count: 1500, temperature: 320, crossSection: 18e-9, length: 18e-9,
      walls: "elastic", lidThermal: false, lidMode: "hand",
      instruments: [],
    },
    setup: "Nothing on the bench: argon at 320 K in an insulated box, with a hand on the lid and the ledger on the rail.",
    hold: 40,
  },
  {
    id: "free-expansion",
    name: "Free expansion",
    aim: "Into vacuum, a gas expands and does not cool.",
    asks: [
      "Take the partition out. What happened to the temperature, and to U?",
      "The pressure halved. Why, if nothing was pushing back?",
    ],
    state: {
      species: "ar", count: 1500, temperature: 300, crossSection: 18e-9, length: 18e-9,
      walls: "elastic", lidThermal: false, lidMode: "fixed",
      membrane: true, membraneX: 9e-9,
      instruments: [],
    },
    setup: "Nothing on the bench but the partition standing in the box: half the gas on one side, vacuum on the other.",
    hold: 60,
  },
  {
    id: "effusion",
    name: "Effusion and Graham's law",
    aim: "Light molecules leave through a hole faster, as sqrt(M).",
    asks: [
      "Watch what has left the box: helium goes first, and the two counts settle near a ratio of sqrt(M_Ar/M_He) = 3.16. Do they?",
      "Open the hole wider. Does the ratio change, or only the rate?",
    ],
    state: {
      species: "he", second: "ar", mixFraction: 0.5, count: 2600, temperature: 300,
      crossSection: 18e-9, length: 18e-9, hole: 3e-9,
      walls: "thermal", lidThermal: true, lidMode: "fixed",
      instruments: [],
    },
    setup: "Nothing on the bench: a 3.0 nm pinhole in the back wall, with helium and argon mixed half and half inside.",
    hold: 40,
  },
  {
    id: "mean-free-path",
    name: "Mean free path",
    aim: "\u03BB = 1/(\u221A2 \u03C0 d\u00B2 n): how far a molecule gets between collisions.",
    asks: [
      "Double the number of molecules: what does that do to \u03BB, and to P?",
      "Swap argon for helium. The atoms are smaller and faster: which of the two changes \u03BB more?",
    ],
    state: {
      species: "ar", count: 1000, temperature: 300, crossSection: 18e-9, length: 18e-9,
      walls: "thermal", lidThermal: true, lidMode: "fixed",
      instruments: [],
    },
    setup: "Nothing on the bench: the gas itself is the apparatus, and both handles on this one are on the left rail.",
    hold: 40,
  },
  {
    id: "mixture",
    name: "Two gases, one temperature",
    aim: "Equipartition: in a mixture, both gases settle at the same T.",
    asks: [
      "Read the two gases' own rows under the speeds. Their temperatures agree, but do their speeds?",
      "Which gas hits the walls more often per molecule, and why does that not make it hotter?",
    ],
    state: {
      species: "he", second: "ar", mixFraction: 0.5, count: 2400, temperature: 400,
      crossSection: 18e-9, length: 18e-9,
      walls: "thermal", lidThermal: true, lidMode: "fixed",
      instruments: ["thermometer"],
    },
    setup: "A room thermometer on a bench in a 400 K room, with helium and argon mixed half and half in the box.",
    hold: 50,
  },
  {
    id: "temperature",
    name: "Temperature is speed",
    aim: "v_rms = \u221A(3RT/M): the temperature of a gas is its molecules' motion.",
    asks: [
      "Turn the room temperature up on the thermometer: does v_rms double when T doubles?",
      "Absolute zero is where the motion stops. What does the panel read at 1 K?",
    ],
    state: {
      species: "ar", count: 1600, temperature: 300, crossSection: 18e-9, length: 18e-9,
      walls: "thermal", lidThermal: true, lidMode: "fixed",
      instruments: ["thermometer"],
    },
    setup: "A room thermometer on a bench in a 300 K room: one dial between the gas and the speed it is made of.",
    hold: 30,
  },
];
