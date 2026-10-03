/**
 * frontend/mech_instruments.js - the instruments the Vibrations stage is built
 * out of.
 *
 * Data only, exactly like frontend/thermo_instruments.js: each entry is a thing
 * that can be put on the stage, and frontend/mech_main.js owns the putting. This
 * is the list the strip in the corner of the stage is drawn from, and it is also
 * the list the right rail's INSTRUMENT panel is headed from, so this is where an
 * instrument's name and its one-line reasons live.
 *
 * Every entry here is a *switch*, and the bench carries one of each: one spring,
 * one dashpot, one force, one shake table, one probe. Pressing an entry that is
 * not on the bench puts it on; pressing the entry that is takes it away again.
 *
 * A part - a spring, a dashpot, a force - appears bolted to the block's own face,
 * and it stays where the rig puts it: the panel that opens with it is where its
 * number and its two ends are set. The only things a hand moves about the stage
 * are a block, a force and the probe.
 *
 * `note` is what an option says of itself on hover, and what it is called to a
 * screen reader. It says what the instrument is *for* rather than how to use it,
 * because that is the question a stage full of apparatus raises.
 */
export const MECH_INSTRUMENTS = [
  {
    key: "spring",
    label: "Spring",
    icon: "Spline",
    note: "A spring between two things, in newtons per metre. Pressing this puts one on the bench, and pressing it again takes it off. Its stiffness is set in the panel it opens.",
  },
  {
    key: "damper",
    label: "Damper",
    icon: "Disc3",
    note: "A dashpot between two things, in newton seconds per metre. Pressing this puts one on the bench, and pressing it again takes it off. Its damping is set in the panel it opens.",
  },
  {
    key: "drive",
    label: "Force",
    icon: "Zap",
    note: "A force applied to one mass: a step, a sine or a single blow, in newtons. Pressing this puts it on the bench and pressing it again switches it off. Drag it onto another mass to move it; its panel is where the force and its frequency are set.",
  },
  {
    key: "base",
    label: "Shake table",
    icon: "Vibrate",
    note: "The ground itself, moved: every spring and damper that reaches the ground is shaken with it. Its panel is where the road's motion is set.",
  },
  {
    key: "probe",
    label: "Probe",
    icon: "Gauge",
    note: "An accelerometer mounted on one mass: it is the system's output, and it is what the response, the transfer function and the peaks are all about. Drag it onto another mass to move it.",
  },
];
