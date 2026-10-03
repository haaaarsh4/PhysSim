/**
 * frontend/thermo_instruments.js - the instruments the Thermo stage is built
 * out of.
 *
 * Data only, exactly like frontend/thermo_labs.js: each entry is a thing that
 * can be put on the stage, and frontend/thermo_main.js owns the putting. This
 * is the list the picker in the corner of the stage is drawn from, and it is
 * also the list the right rail's INSTRUMENT panel is headed from, so this is
 * where an instrument's name and its one-line reasons live.
 *
 * One of these is *physics*: the weights are what holds the lid, so they are not
 * remembered anywhere - they are read back off the box, which is what stops the
 * picker and the rail ever disagreeing about what is on the stage. The burner is
 * half of each: the flame is a state of the box and the burner is apparatus, so
 * putting the flame out leaves the burner standing on the bench, and taking the
 * burner off the stage takes its flame with it.
 *
 * The bench is not in this list. It is the stage rather than an instrument -
 * there is no box standing on nothing, so there is nothing to decide about it -
 * and it is answered as always present by the apparatus layer.
 *
 * `note` is what an option says of itself on hover, and what it is called to a
 * screen reader. It says what the instrument is *for* rather than how to use
 * it, because that is the question a stage full of apparatus raises. The burner
 * heats the box and the weights press its lid; the two dials read the room the
 * box stands in, its temperature on one of them and the pressure it puts on the
 * lid on the other, and that is the only reason the pair of them is here at all:
 * the gas's own numbers are on the rail, off the molecules that made them.
 */
export const THERMO_INSTRUMENTS = [
  {
    key: "burner",
    label: "Burner",
    icon: "Flame",
    note: "A burner standing under the floor: while its flame is lit the floor is held at the flame's temperature, and it stays on the bench when the flame is out.",
  },
  {
    key: "weights",
    label: "Weights",
    icon: "Weight",
    note: "A load pressing the lid, so the lid rests on it instead of being held.",
  },
  {
    key: "gauge",
    label: "Pressure gauge",
    icon: "Gauge",
    note: "A dial plumbed to the outside of the lid: it reads the pressure of the air around the box, and its panel is where that pressure is set.",
  },
  {
    key: "thermometer",
    label: "Room thermometer",
    icon: "Thermometer",
    note: "A column standing on the bench, clear of the box: it reads the room the box stands in, not the gas inside it. Its panel is where that room's temperature is set.",
  },
];
