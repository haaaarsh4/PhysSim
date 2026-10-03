/**
 * rendering/thermo_apparatus.js - the instruments that stand on the Thermo
 * stage.
 *
 * The dynamics stage is built out of shapes a user drops on it, one at a time,
 * from a launcher in the corner. This is the same idea for a gas: a bench, a
 * burner's flame, a pressure gauge, a room thermometer and a set of weights,
 * put on the stage rather than buried in a rail.
 *
 * One of the five is not a picture. The weights are *physical*: they exist
 * because the lid is being held by a load, so a lab's own setup and the panel's
 * own slider put the same instrument on the same stage. The burner is the same
 * kind of thing with one difference: gas burning under the box is a *state* of
 * the box (`box.burner.on`), while the burner itself is apparatus - placed,
 * removed, and left standing on the bench when its flame goes out. The other
 * three are readouts and furniture, and they are the only state this file keeps
 * of its own.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THAT MEASURE, AND WHERE THEY ARE PUT
 * ---------------------------------------------------------------------------
 * The pressure gauge is plumbed into the box. It is not a dial standing next to
 * a box: it is a manifold gauge on a standpipe, with a branch pipe that taps the
 * lid's own face and a valve where the branch meets the riser, so what it reads
 * is visibly a pressure on the lid, and when the lid moves the pipe that carries
 * the reading moves with it. The face it taps is the *outer* one: what this dial
 * carries is the pressure the air around the box puts on the lid, which is the
 * number the gauge's own panel sets and the number the lid's balance uses. A
 * boundary condition is the same kind of number the thermometer beside it reads,
 * so the two dials on the bench are the two things about the room.
 *
 * The thermometer stands on the bench. The gas's temperature is the rail's
 * reading and the gauge's neighbour; what is missing is the temperature of the
 * room the box is sitting in, so this instrument reads the surroundings - and
 * it reads them from the far end of the same table the box is on, standing on
 * its own foot, the way the room thermometer in a lab stands out in the air it
 * is measuring. It is the one instrument here that is not about the box at all,
 * and where it is put is the whole of what says so.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS BUILT THE WAY IT IS
 * ---------------------------------------------------------------------------
 * Every instrument here is a *mesh*, not a picture of one.
 *
 * These stood on the stage once as sprites: a canvas billboarded at the camera.
 * A billboard has no depth, never turns, never catches the light and never sits
 * in front of anything, so on a stage that orbits it reads as a sticker hanging
 * in the air - which is exactly what it was. The 3D view is the view these
 * instruments are for, and in a 3D view an instrument has to be an object.
 *
 * The only thing still drawn into a texture is what has to be *read*: a scale, a
 * unit, a number. Text is a picture, and a picture belongs on the face of an
 * instrument - which is where every real instrument puts it. The faces do not
 * billboard: they are welded to the front of a body that turns when the stage
 * turns. There is no swivel and no billboard left in this file. Both
 * instruments are built in the same plane as the box's own front face and never
 * move out of it, so orbiting the stage walks round them exactly the way it
 * walks round the box: a dial has a rim and a back, a board has a back and a
 * foot, and the view that shows you the box's side shows you theirs.
 *
 * Everything else is drawn out of the app's own language, which is the *other
 * bench's* language: a pale slab with a faint grid on it, stainless for the
 * things that hold things up, the page's own ink for the solid parts a mass is
 * made of, and the accent - which is only ever the *live* mark: the needle, the
 * column, the gas itself. The two benches are two rooms in one building, and a
 * table, a pipe or a weight drawn in a third grey is what makes one of the
 * rooms look like another project.
 *
 * Everything is laid out from the box's own half-height, so the bench is the
 * same picture whatever size the box is: change the box from 8 nm to 40 nm and
 * the instruments are still standing where the eye expects them, in proportion,
 * the way a photograph of a bench would be from further back.
 */
import * as THREE from "three";
import { WORLD_PER_METRE, burnerScale } from "./gas_renderer.js";

/* The stage palette, by name, so this file cannot drift from the stylesheet -
   and, wherever the block bench has already named a thing, by *that* name. */
const C_FLOOR = 0xdedde7; // --stage-2: the bench's own slab, and mech's FLOOR
const C_FLOOR_GRID = 0xcdccd7; // the squares on it
const C_PAPER = 0xe9e8f1; // an instrument's body: a card on a grey table
const C_RECESS = 0xcdccd7; // a recess, a second surface
const C_CHROME = 0x8a8794; // mech's CHROME: the pipe, the bezel, the stand
const C_LINE = 0xa3a1ae; // a hairline that can be seen at this size
const C_INK = 0x34343f; // --home-ink: a hub, the one solid part of a thing
const C_ACCENT = 0x9e00ff; // --home-violet: the live mark, and only that
/* Glass is the surface colour with the light let through it: a tint, not a
   second colour, so a tube on a pale stage is still part of the same scene. */
const C_GLASS = 0xdad8e6;

/* ---------------------------------------------------------------------------
 * THE BENCH, in units of the box's half-height
 * ---------------------------------------------------------------------------
 * One slab, in the block bench's own colour and roughly the block bench's own
 * proportions relative to its width: a table is the floor of a room, and the
 * floor of both rooms is the same floor. Thick on purpose - a bench with an
 * edge is a place, and a bench with no edge is a line the box is standing on -
 * and deeper than the box on every side, so the box is standing on a table
 * rather than on the edge of one.
 */
const BENCH_T = 0.16;
const BENCH_D = 2.2;
/** The order the bench's grid is walked in: half the box, which is the one step
 *  on this stage that a reader can already see the size of. */
const BENCH_STEP = 1.0;

/* ---------------------------------------------------------------------------
 * THE GAUGE'S PLUMBING, in units of the box's half-height
 * ---------------------------------------------------------------------------
 * One set of numbers, used by the meshes, by the layout every frame and by the
 * framing, so the camera cannot frame a gauge that is not where the pipe is.
 */
/**
 * The instruments this layer holds itself: everything a stage can be given that
 * is not answered by the box. The weights are answered by the load on the lid
 * and the bench by always being there, so neither is a name this layer can put
 * out - and neither is anything else. A name from a session this version does
 * not know, or a stray value that reached `visual` by some other route, is
 * dropped rather than kept: an entry that cannot be built is an instrument on a
 * stage that cannot be drawn, and it would be written back out again.
 */
/**
 * The rule a picked instrument is boxed in with: the twelve edges of a wireframe
 * box, split into the four of the near face plus the four running back from its
 * corners, and the four of the far face on their own.
 *
 * The split is the whole of what makes it read as an outline rather than as a
 * second instrument: drawn in one weight, a box shows its far face as a smaller
 * box lying inside the thing it is meant to be round. Built as a box of
 * half-extents one, so the frame is sized by setting its scale to the half of
 * the space the instrument takes up - the same arithmetic the block bench's own
 * selection outline uses, because this is the same mark.
 */
function selectionFrameGeometry() {
  const near = [];
  const far = [];
  const line = (list, a, b) => { list.push(...a, ...b); };
  const ends = [-1, 1];
  const at = (x, y, z) => [x, y, z];
  /* The near face, at z = +1: the rectangle that is read as the box of rule. */
  for (const y of ends) line(near, at(-1, y, 1), at(1, y, 1));
  for (const x of ends) line(near, at(x, -1, 1), at(x, 1, 1));
  /* The four that run back from its corners, and then the far face. */
  for (const x of ends) for (const y of ends) line(near, at(x, y, 1), at(x, y, -1));
  for (const y of ends) line(far, at(-1, y, -1), at(1, y, -1));
  for (const x of ends) line(far, at(x, -1, -1), at(x, 1, -1));
  const build = (points) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  };
  return { near: build(near), far: build(far) };
}

const SELECTION_FRAME = selectionFrameGeometry();

const FURNITURE = ["burner", "gauge", "thermometer"];

const GAUGE_R = 0.30; // the dial's radius
const GAUGE_Y = 0.80; // the dial's centre, above the box's own centre
const GAUGE_LEAD = 1.20; // how far clear of the lid the standpipe stands
const GAUGE_MIN_X = 3.10; // ... and never nearer the box's back wall than this
const GAUGE_TAP_Y = 0.28; // where the branch taps the lid: clear of the weights
const GAUGE_Z = 0.62; // the plane the whole assembly is plumbed in
const GAUGE_SOCKET = 1.03; // where under the dial's centre the pipe arrives
const PIPE_R = 0.050; // the bore of the pipes, near enough a sixth of the dial

/* The room thermometer's own size, in box half-heights, and its shape in its
   own units: a board one wide and two and a third tall, standing on its foot at
   the left-hand end of the bench. */
const THERMO_W = 0.80;
const THERMO_ASPECT = 2.30;
/* The foot it stands on, in board units. This is the one piece of the
   instrument that is about the bench rather than about the room, and it is the
   whole difference between a board standing on a table and a board floating
   over one: wider and deeper than the board on every side, because a board's
   own edge is a line and a line is not something a table can hold. */
const THERMO_BASE_W = 1.16;
const THERMO_BASE_H = 0.085;
const THERMO_BASE_D = 0.32;
/* The back board: a board's width wider and a hand's breadth taller than the
   print, so a rim of it shows all the way round and the instrument reads as
   something built rather than as a card with ink on it. */
const THERMO_BACK_W = 1.09;
const THERMO_BACK_PAD = 0.14;
const THERMO_PANEL_D = 0.10;
/* Where it stands, in box half-heights: the plane it is built in, which is in
   front of the box's own front face and not beside it, and how far clear of the
   box's left face its stand is. Standing it forward is what keeps it out of the
   box: an instrument at the left of a box, in the box's own plane, is an
   instrument drawn over the glass, and one in front of the glass is an
   instrument at the front-left corner of the table, which is where you would
   put it. */
const THERMO_Z = 0.90;
const THERMO_CLEAR = 0.52;
/* Where its parts sit inside the board, in board units: the tube's centre line,
   its bore, the bulb, and the two ends of the printed scale. */
const THERMO_TUBE_X = -0.24;
const THERMO_TUBE_R = 0.075;
const THERMO_BULB_R = 0.115;
const THERMO_BULB_Y = -1.00;
const THERMO_TUBE_TOP = 0.68;
const THERMO_TICK_0 = -0.78; // 0 K
const THERMO_TICK_1 = 0.66; // 1200 K
/* How far the tube stands off the printed face, which is the same in the build
   and in the reading and so is only written once. */
const THERMO_TUBE_Z = 0.13;
/* Where the reading sits on the board, in board units, from the caption down to
   the rule under it. */
const THERMO_CAPTION_Y = 1.045;
const THERMO_READING_Y = 0.90;
const THERMO_RULE_Y = 0.795;
/* Where the printed scale sits across the board, in board units: the end of
   the ticks (which is a rule down the panel), the long ticks' other end, the
   short ticks' other end, and where the numbers are set flush to. */
const THERMO_AXIS_X = 0.10;
const THERMO_MAJOR_X = -0.06;
const THERMO_MINOR_X = 0.00;
const THERMO_NUM_X = 0.34;

const FACE_BG = "#f7f6fb";
const FACE_LINE = "#c9c8d4";
const FACE_INK = "#34343f";
const FACE_INK_2 = "#585763";
const FACE_INK_3 = "#8a8794";
const FACE_ACCENT = "#9e00ff";
const FACE_RECESS = "#e6e5ee";

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/** A number as short as it can honestly be: 2, 1.5, 0.25. */
function fmtNumber(v) {
  return Math.round(v) === v ? String(Math.round(v)) : String(Number(v.toFixed(2)));
}

/**
 * The top of the pressure dial: the next power of two at or above what the gauge
 * is reading, so the needle has somewhere to go when the number is turned up and
 * the scale is a number a reader can divide in their head.
 */
function dialMax(pressure) {
  const p = Math.max(pressure, 1e-9);
  for (const m of [1, 2, 4, 8, 16, 32, 64, 128]) if (p <= m * 0.999) return m;
  return 256;
}

/**
 * A printed instrument face, and the one call that redraws it.
 *
 * The faces are textures because what they carry is text: a needle is a mesh,
 * but "1.052 MPa" has to be legible from across a stage, and a canvas is the
 * only thing here that can draw a word.
 *
 * The face is rebuilt if its 2D context is ever taken away. That is not
 * hypothetical: a GPU reset loses every 2D canvas on the page at once, and a
 * lost 2D context does not throw and does not warn - it swallows the drawing
 * and reads back transparent, so the dial would simply be a blank card for the
 * rest of the session with nothing anywhere to say why. One pixel read per
 * redraw is the whole cost of never letting that happen, and the pixel it reads
 * is one this file always paints.
 *
 * @param {number} width @param {number} height
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number, value: number) => void} draw
 * @param {(texture: THREE.CanvasTexture) => void} [onTexture] so a face mesh can
 *        be re-pointed at a rebuilt texture without knowing when it happened
 */
function makeFace(width, height, draw, onTexture) {
  let canvas;
  let ctx;
  let texture;

  /** Every face here paints its own centre: the dial, or the printed panel. */
  function painted() {
    const probe = ctx.getImageData(width >> 1, height >> 1, 1, 1).data;
    return probe[3] > 8;
  }

  function build() {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    /* Read back every redraw, so the browser is told to back this canvas with
       memory rather than with a GPU surface. Without it Chrome warns on every
       probe, and the probe is the thing that keeps the face alive. */
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    canvas.addEventListener("contextlost", () => { build(); onTexture?.(texture); }, { once: true });
    onTexture?.(texture);
  }

  function paint(value) {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height, value);
    if (!painted()) {
      /* The draw went nowhere: this context is gone. A new one will take it. */
      build();
      draw(ctx, width, height, value);
    }
    texture.needsUpdate = true;
  }

  build();
  return {
    get texture() { return texture; },
    set: paint,
  };
}

/**
 * The gauge's printed dial: a ring of ticks, five numbers round it, the unit,
 * and the reading in a recess under the hub.
 *
 * The needle is not in here. It is a mesh, because a needle is the one part of
 * a gauge that moves, and the one part that should catch the same light as
 * everything else on the stage.
 */
function drawGaugeFace(ctx, W, H, pressure) {
  const max = dialMax(pressure);
  const cx = W / 2;
  const cy = H / 2;
  /* The whole canvas, because the mesh in front of this is a circle: the print
     and the disc are the same size and neither has an edge to hide. */
  const R = W * 0.5;
  const a0 = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = FACE_BG;
  ctx.fill();

  /* A printed hairline just inside the bezel, so the card the scale sits on has
     an edge of its own even where the metal ring is over it. */
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.95, 0, Math.PI * 2);
  ctx.lineWidth = W * 0.006;
  ctx.strokeStyle = FACE_LINE;
  ctx.stroke();

  /* The scale: a ring the ticks hang off, sixteen divisions round the sweep,
     and a number at every fourth one. Sixteen is the count that puts a tick at
     each quarter without a tick where the two ends meet, so the ring closes on
     itself and the five numbers read 0, a quarter, a half, three quarters,
     full. */
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.80, a0, a0 + sweep);
  ctx.lineWidth = W * 0.008;
  ctx.strokeStyle = "rgba(154,151,166,0.35)";
  ctx.stroke();

  const N = 16;
  for (let i = 0; i <= N; i++) {
    const major = i % 4 === 0;
    const medium = i % 2 === 0;
    const a = a0 + sweep * (i / N);
    const r0 = R * 0.80;
    const r1 = R * (major ? 0.94 : medium ? 0.90 : 0.865);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.strokeStyle = major ? FACE_INK_2 : "rgba(138,135,148,0.5)";
    ctx.lineWidth = major ? W * 0.013 : medium ? W * 0.008 : W * 0.005;
    ctx.stroke();
    if (!major) continue;
    const lr = R * 0.66;
    ctx.fillStyle = FACE_INK_3;
    ctx.font = `600 ${W * 0.066}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fmtNumber((max * i) / N), cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
  }

  /* The reading, in a recess under the hub and between the two bottom numbers:
     a needle says how much at a glance, and a number is what it is exactly. */
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = FACE_INK_3;
  ctx.font = `600 ${W * 0.044}px Inter, system-ui, sans-serif`;
  ctx.fillText("P R E S S U R E", cx, H * 0.635);

  ctx.fillStyle = FACE_RECESS;
  roundRect(ctx, W * 0.32, H * 0.685, W * 0.36, H * 0.12, H * 0.032);
  ctx.fill();
  ctx.fillStyle = FACE_INK;
  ctx.font = `700 ${W * 0.078}px Inter, system-ui, sans-serif`;
  ctx.fillText(`${pressure >= 10 ? pressure.toFixed(1) : pressure.toFixed(2)} MPa`, cx, H * 0.746);
}

/**
 * The room thermometer's printed panel: what it reads across the top, a rule
 * under it, and the kelvin scale down the panel beside where the tube hangs.
 *
 * The tube, the column and the bulb are meshes in front of this panel, so the
 * ticks are printed clear of the strip the tube occupies, the numbers are
 * right-aligned against the panel's edge so the widest of them ("1200") cannot
 * overrun it, and the recess the tube stands in is printed as well - glass this
 * thin is a tint and a rim, and on a pale panel a flat view of it would be
 * almost nothing.
 */
function drawThermoPanel(ctx, W, H, temperature) {
  const max = 1200;
  /* Board units are the board's own width, so the two ends of the scale convert
     to canvas rows by the same division the meshes use, and the tube the column
     climbs is printed behind exactly where the mesh stands. */
  const xOf = (x) => (x + 0.5) * W;
  const yOf = (y) => ((THERMO_ASPECT / 2 - y) / THERMO_ASPECT) * H;
  const tubeX = xOf(THERMO_TUBE_X);
  const tubeW = THERMO_TUBE_R * W;

  ctx.fillStyle = FACE_BG;
  ctx.fillRect(0, 0, W, H);

  /* A frame line printed round the board: the rim of the plate behind it is the
     mount, and this is the instrument's own edge inside it. */
  roundRect(ctx, W * 0.03, H * 0.018, W * 0.94, H * 0.964, W * 0.03);
  ctx.lineWidth = W * 0.008;
  ctx.strokeStyle = FACE_LINE;
  ctx.stroke();

  /* The recess the tube stands in, from under the reading down to the foot. */
  ctx.fillStyle = FACE_RECESS;
  roundRect(ctx, tubeX - tubeW * 1.35, yOf(0.74), tubeW * 2.7, yOf(-0.96) - yOf(0.74), tubeW * 0.6);
  ctx.fill();

  /* What it reads, then what it is. The caption is the whole answer to "why is
     this here": the rail's temperature is the gas, and this is the room. */
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = FACE_INK_3;
  ctx.font = `600 ${W * 0.048}px Inter, system-ui, sans-serif`;
  ctx.fillText("S U R R O U N D I N G S", W / 2, yOf(THERMO_CAPTION_Y));
  ctx.fillStyle = FACE_INK;
  ctx.font = `700 ${W * 0.16}px Inter, system-ui, sans-serif`;
  ctx.fillText(`${temperature.toFixed(0)} K`, W / 2, yOf(THERMO_READING_Y));

  ctx.strokeStyle = FACE_LINE;
  ctx.lineWidth = W * 0.010;
  ctx.beginPath();
  ctx.moveTo(W * 0.09, yOf(THERMO_RULE_Y));
  ctx.lineTo(W * 0.91, yOf(THERMO_RULE_Y));
  ctx.stroke();

  /* The scale: a rule down the board with a tick hanging off it, and a number
     flush against the tick. The rule is what stops a row of dashes and a
     column of numbers reading as two unrelated things. */
  const axisX = xOf(THERMO_AXIS_X);
  ctx.beginPath();
  ctx.moveTo(axisX, yOf(THERMO_TICK_1));
  ctx.lineTo(axisX, yOf(THERMO_TICK_0));
  ctx.lineWidth = W * 0.010;
  ctx.strokeStyle = FACE_LINE;
  ctx.stroke();

  ctx.textAlign = "right";
  for (let v = 0; v <= max; v += 100) {
    const major = v % 300 === 0;
    const y = yOf(THERMO_TICK_0 + (v / max) * (THERMO_TICK_1 - THERMO_TICK_0));
    ctx.beginPath();
    ctx.moveTo(xOf(major ? THERMO_MAJOR_X : THERMO_MINOR_X), y);
    ctx.lineTo(axisX, y);
    ctx.strokeStyle = major ? "rgba(88,87,99,0.7)" : "rgba(138,135,148,0.45)";
    ctx.lineWidth = major ? W * 0.013 : W * 0.006;
    ctx.stroke();
    if (!major) continue;
    ctx.fillStyle = FACE_INK_3;
    ctx.font = `600 ${W * 0.082}px Inter, system-ui, sans-serif`;
    ctx.fillText(String(v), xOf(THERMO_NUM_X), y);
  }
}

export class ThermoApparatus {
  /**
   * @param {import("../simulation/gas.js").GasBox} box
   */
  constructor(box) {
    this.box = box;
    this.group = new THREE.Group();
    this.group.name = "apparatus";
    /** The instruments that are furniture rather than physics. */
    this.visual = new Set();
    this.built = new Map();
    /** Every hairline of every built instrument, by instrument key. */
    this.hairlines = new Map();
    /** The instrument whose outline is showing, or null. */
    this.selected = null;
    /** Which instrument `_outline` is being called for, while one is building. */
    this._building = null;
    this.resources = [];
    this._dialTick = -1;
    this._pressure = 0;
    this._temperature = 0;

    /* Five surfaces and one line, which is the whole of this file's vocabulary:
       the bench's own slab, a card for an instrument to be printed on, a recess
       in it, stainless for anything that holds anything up, the page's ink for
       the solid parts a mass is made of, glass for the one instrument that is a
       tube, and the accent. Mild steel and stainless are both *grey*: nothing on
       this stage is allowed a colour of its own, because the one colour the page
       spends is the accent, and the accent is the live mark. */
    this.floorSlab = new THREE.MeshStandardMaterial({ color: C_FLOOR, roughness: 0.95 });
    this.paper = new THREE.MeshStandardMaterial({ color: C_PAPER, roughness: 0.86, metalness: 0.02 });
    this.recess = new THREE.MeshStandardMaterial({ color: C_RECESS, roughness: 0.9, metalness: 0.02 });
    this.metal = new THREE.MeshStandardMaterial({ color: C_CHROME, roughness: 0.34, metalness: 0.34 });
    this.dark = new THREE.MeshStandardMaterial({ color: C_INK, roughness: 0.55, metalness: 0.12 });
    /* The accent is the live mark and only ever that: the needle, the column,
       the spirit in the bulb. A touch of emission keeps it reading as *live*
       against a pale stage without making it a light source. */
    this.live = new THREE.MeshStandardMaterial({
      color: C_ACCENT, roughness: 0.5, metalness: 0.0,
      emissive: new THREE.Color(C_ACCENT), emissiveIntensity: 0.16,
    });
    this.glass = new THREE.MeshStandardMaterial({
      color: C_GLASS, roughness: 0.42, metalness: 0.0, side: THREE.DoubleSide,
      transparent: true, opacity: 0.18, depthWrite: false,
    });
    this.line = new THREE.LineBasicMaterial({ color: C_LINE, transparent: true, opacity: 0.6 });
    /* And the bench is given the block bench's grid exactly: the same step of
       the same pencil on the same floor. */
    this.gridLine = new THREE.LineBasicMaterial({ color: C_FLOOR_GRID, transparent: true, opacity: 0.9 });
    /* The outline the picked instrument wears: the same accent, and for the same
       reason, as the block bench draws its own selection in - the violet is the
       colour of the thing you have hold of, and nothing else on the stage is ever
       drawn in it. An instrument is barely more than its hairlines (a pale object
       on a pale stage is a smudge without them), so picking one recolours *those*
       rather than hanging a second frame round it: the outline is then the
       instrument's own outline, to the pixel, however it is built or wherever it
       has been moved to. */
    this.chosenEdge = new THREE.LineBasicMaterial({
      color: C_ACCENT, transparent: true, opacity: 0.95,
    });
    /* The far face of that outline, drawn light: the depth of the box and not a
       second box. */
    this.chosenEdgeSoft = new THREE.LineBasicMaterial({
      color: C_ACCENT, transparent: true, opacity: 0.30,
    });
    /* And the frame the box of rule is made of - one for the whole stage, moved
       onto whichever instrument is picked, because only ever one is picked. */
    this.frame = new THREE.Group();
    this.frame.name = "selection-frame";
    for (const [geometry, material] of [
      [SELECTION_FRAME.near, this.chosenEdge],
      [SELECTION_FRAME.far, this.chosenEdgeSoft],
    ]) {
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 4;
      this.frame.add(lines);
    }
    this.frame.visible = false;
    this.group.add(this.frame);

    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.unitRod = new THREE.CylinderGeometry(1, 1, 1, 16);
    this.unitDisc = new THREE.CylinderGeometry(1, 1, 1, 26);
    this.unitBall = new THREE.SphereGeometry(1, 20, 14);
    /* A collar or a bezel: a ring with a thin section, because the section is
       the whole of what a torus is read by, and a fat one is a doughnut sitting
       on the instrument instead of a rim around it. */
    this.unitRing = new THREE.TorusGeometry(1, 0.06, 10, 44);
    /* A valve's handwheel, which is a ring you grip rather than a rim: the same
       torus with a rope for a section. */
    this.unitWheel = new THREE.TorusGeometry(1, 0.16, 8, 26);
    /* A pipe nut, as a hexagon: the one shape in the scene that says "this is
       plumbing" without being a label. */
    this.unitHex = new THREE.CylinderGeometry(1, 1, 1, 6);
    /* A tube has no ends to cap: a capped cylinder lit from one side is a solid
       grey rod with a bright rim, which is the opposite of what glass does, and
       two closed caps would hide the column inside it. */
    this.unitTube = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    /* One set of edges per shape, reused by every outline in the scene: the
       hairline is what stops a pale object on a pale stage reading as a smudge,
       and it is the same trick the box itself pulls with its violet edges. */
    this.boxEdges = new THREE.EdgesGeometry(this.unitBox);
    this.rodEdges = new THREE.EdgesGeometry(this.unitRod, 20);
    this.discEdges = new THREE.EdgesGeometry(this.unitDisc, 20);
    this.resources.push(
      this.floorSlab, this.paper, this.recess, this.metal, this.dark, this.live, this.glass,
      this.line, this.gridLine, this.chosenEdge, this.chosenEdgeSoft,
      SELECTION_FRAME.near, SELECTION_FRAME.far,
      this.unitBox, this.unitRod, this.unitDisc, this.unitBall, this.unitRing, this.unitHex,
      this.unitTube, this.unitWheel, this.boxEdges, this.rodEdges, this.discEdges,
    );
  }

  /**
   * A hairline copy of a mesh, riding its parent's transform.
   *
   * Every one of them is remembered against the instrument being built, because
   * these *are* the instrument's outline: picking one paints them in the accent
   * (see `setSelected`), so what a reader sees lit up is exactly the edges the
   * instrument is drawn with and nothing that has been added for the sake of
   * being lit up.
   */
  _outline(mesh, geometry) {
    const edges = new THREE.LineSegments(geometry, this.line);
    edges.frustumCulled = false;
    mesh.add(edges);
    const key = this._building;
    if (key) {
      if (!this.hairlines.has(key)) this.hairlines.set(key, []);
      this.hairlines.get(key).push(edges);
    }
    return edges;
  }

  /**
   * A material that carries one printed face, disposed with the rest.
   *
   * Unlit on purpose. A printed face is ink on paper, and paper does not go
   * grey because the key light happens to be behind it: shaded, the dial reads
   * as a dull disc with a bright rim, and the scale it exists to carry is the
   * first thing to lose its contrast. It is still a mesh - the needle passes in
   * front of it and the bezel stands around it - which is the whole difference
   * between a dial and a picture of one.
   */
  _printedFace(texture) {
    const material = new THREE.MeshBasicMaterial({ map: texture });
    /* A face is ink on paper: it is the one thing here that casts no shadow. A
       dial that did would wear the shadow of its own scale. */
    material.userData.printed = true;
    this.resources.push(material);
    return material;
  }

  /* --------------------------------- what is here -------------------------------- */

  /**
   * Whether an instrument is on the stage.
   *
   * The weights are answered by the box itself, so a load set by a lab, by the
   * rail and by the weights' own slider are one and the same instrument. The
   * bench is answered here rather than kept in `visual`, because it is not an
   * instrument that can be put out: it is the table the box stands on, and the
   * stage without it is a box floating in nothing. Everything else is this
   * file's own memory.
   *
   * The burner is one of those, and it used to be the opposite: it was read off
   * `box.burner.on`, so putting the flame out took the burner with it and left
   * a stage with no burner on it at all. A flame is something the burner is
   * *doing*, and a burner that has gone out is still a burner - it is the same
   * stand, on the same bench, and the switch that lit it is still its own. So
   * the instrument is placed and removed like any other piece of apparatus, and
   * the flame is the flame.
   */
  has(key) {
    if (key === "weights") return this.box.lid.mode === "load" && this.box.lid.load > 0;
    if (key === "bench") return true;
    return this.visual.has(key);
  }

  keys() {
    const out = [];
    for (const key of ["burner", "weights", "bench", "gauge", "thermometer"]) {
      if (this.has(key)) out.push(key);
    }
    return out;
  }

  /**
   * The meshes an instrument is made of, each with the name of the instrument it
   * belongs to: the objects a click out on the stage has to be able to tell
   * apart.
   *
   * The bench is not in here, and the flame is not either. The bench has no
   * settings and cannot be taken off the stage, so a click on the table has
   * nothing to open; the flame belongs to the gas renderer, and comes from
   * there.
   */
  pickables() {
    const out = [];
    for (const [key, part] of this.built) {
      if (key === "bench" || key === "burner") continue;
      for (const node of [part.group, part.plumbing]) {
        if (node) out.push({ key, object: node });
      }
    }
    return out;
  }

  /** Just the ones that are not physics - what a session has to remember. */
  visualKeys() {
    return [...this.visual];
  }

  setVisual(keys) {
    this.visual = new Set((keys ?? []).filter((key) => FURNITURE.includes(key)));
    /* A flame is not something a stage can be given on its own: it is gas
       burning at the mouth of a burner, and every state that says "there is a
       flame under this box" means "there is a burner under it, lit". Sessions
       and labs written before the burner was an instrument of its own ask for
       exactly the flame and nothing else, so the burner is added here rather
       than left to whoever wrote the state to remember. */
    if (this.box.burner.on) this.visual.add("burner");
    this.refresh();
  }

  toggleVisual(key, on) {
    if (!FURNITURE.includes(key)) return false;
    const next = on === undefined ? !this.visual.has(key) : !!on;
    if (next) this.visual.add(key);
    else this.visual.delete(key);
    this.refresh();
    return next;
  }

  /**
   * Make what is on the stage be what `has` says is on the stage.
   *
   * Called after anything that can turn a physical instrument on - the panel's
   * flame switch, a lab's own setup, the weights on the lid - because those are
   * changes to the box rather than to this file's memory of it.
   */
  refresh() {
    for (const key of [...this.built.keys()]) {
      if (!this.has(key)) this._dispose(key);
    }
    for (const key of this.keys()) {
      if (!this.built.has(key)) this._build(key);
    }
  }

  /* ------------------------------ where things are ------------------------------ */

  /** The box's own half-height, width and lid position, in world units. */
  _metrics() {
    const b = this.box;
    const u = (b.crossSection * WORLD_PER_METRE) / 2;
    return { u, L: b.lid.x * WORLD_PER_METRE };
  }

  /** Where the gauge's standpipe stands: clear of the lid, never inside it. */
  _gaugeX(u, L) {
    return Math.max(L + GAUGE_LEAD * u, GAUGE_MIN_X * u);
  }

  /** Where a bench's own top surface is. */
  _benchTop(u) {
    /* A bench with a burner standing on it stands a burner's height lower,
       because the burner has to be *on* something: with no burner the box rests
       a hair above the bench surface, which is what a box on a bench looks
       like. The stand takes that room whether or not it is lit - an unlit
       burner is the same object in the same place - so this asks whether the
       instrument is on the stage rather than whether it is burning. */
    return -u - (this.has("burner") ? 0.70 * burnerScale(u) : 0.05 * u);
  }

  /** Where the things standing around the box are standing. */
  _groundY(u) {
    return this.has("bench") ? this._benchTop(u) : -u - 0.05 * u;
  }

  /**
   * Everything the camera has to keep in shot for the box's own bench, in world
   * units: the box, whatever has been put around it, and the gauge's plumbing.
   *
   * Calculated from the box rather than from the meshes, so it is right the
   * instant the box changes size - before anything has been repositioned - and
   * the framing that follows a resize can never be a frame behind.
   *
   * The thermometer is in here, and it has to be: it stands on the bench, so
   * the bench has to be long enough to hold it. It is measured from its own
   * constants and from the box, never from where it ended up, which is what
   * keeps a thing that is placed by the frame from also defining it. The frame
   * is one pass of arithmetic and nothing in it can move because of where
   * something in it landed.
   */
  _frameExtent() {
    const { u, L } = this._metrics();
    let left = 0;
    let right = L;
    let top = u;
    let bottom = -u;

    if (this.box.burner.on) bottom = Math.min(bottom, -u - 0.70 * burnerScale(u));
    if (this.has("weights")) right = Math.max(right, L + 0.95 * u);
    if (this.has("gauge")) {
      right = Math.max(right, this._gaugeX(u, L) + GAUGE_R * u);
      top = Math.max(top, (GAUGE_Y + GAUGE_R) * u);
    }
    if (this.has("thermometer")) {
      left = Math.min(left, this._thermoLeft(u));
      /* Its foot, which is under the box's own floor when there is no bench to
         stand on and has to be in shot wherever it stands. */
      bottom = Math.min(bottom, this._groundY(u));
    }
    if (this.has("bench")) {
      /* Centred on the *box*, not on what happens to be standing around it: a
         bench that shuffles sideways every time an instrument is added is a
         bench that never looks like it has a place. The overhang is whatever
         the widest instrument needs, mirrored, so the box is always in the
         middle of its own table. */
      const boxCx = L / 2;
      const half = Math.max(boxCx - left, right - boxCx) + 0.35 * u;
      left = Math.min(left, boxCx - half);
      right = Math.max(right, boxCx + half);
      /* The slab's own underside, and a hair of air under it: the bench has an
         edge now rather than legs, so the room the picture needs under it is
         the slab's thickness and no more. */
      bottom = Math.min(bottom, this._benchTop(u) - (BENCH_T + 0.04) * u);
    }
    return { left, right, top, bottom };
  }

  /** How far left of the box's own left face the thermometer's foot reaches. */
  _thermoLeft(u) {
    return -(THERMO_CLEAR + THERMO_W * THERMO_BASE_W) * u;
  }

  /**
   * Where the room thermometer stands: the left-hand end of the bench, a
   * foot's width clear of the clearest thing on that side, which is the box.
   *
   * Its x is measured from the box's own left face rather than from the bench,
   * so the instrument stays where it was put when the table grows a gauge at
   * the other end, and its y comes from whatever it is standing on: the bench
   * if there is one, and the same ground the box rests on if there is not.
   */
  _thermoPlace() {
    const { u } = this._metrics();
    return {
      x: -(THERMO_CLEAR + (THERMO_W * THERMO_BASE_W) / 2) * u,
      y: this._groundY(u),
      z: THERMO_Z * u,
    };
  }

  /**
   * Everything in shot.
   *
   * The frame is the bench's own, and everything on the stage is inside it by
   * construction: the table is stretched to hold the gauge at one end and the
   * thermometer at the other, and both are measured from the box rather than
   * from where they land.
   */
  extent() {
    return this._frameExtent();
  }

  /* ---------------------------------- building ---------------------------------- */

  _build(key) {
    this._building = key;
    this.hairlines.set(key, []);
    if (key === "bench") this.built.set(key, this._buildBench());
    else if (key === "weights") this.built.set(key, this._buildWeights());
    else if (key === "gauge") this.built.set(key, this._buildGauge());
    else if (key === "thermometer") this.built.set(key, this._buildThermometer());
    /* The burner's flame is the gas renderer's, because the flame is a picture
       of the floor's own temperature and has to move with it. There is nothing
       to build here, but the entry has to exist so the launcher and the frame
       both know the instrument is on the stage. */
    else if (key === "burner") this.built.set(key, { note: "drawn by the gas renderer" });
    this._building = null;
    /* Everything that stands on the bench stands in the key light and drops a
       shadow onto it, which is the depth the other bench gets from its own
       shadows and this one was missing: an instrument with nothing under it is
       an instrument pasted onto the picture. The slab receives and never casts,
       and the faces are the only things exempt - a hairline is a line and a
       printed face is ink on paper. */
    const part = this.built.get(key);
    for (const node of [part?.group, part?.plumbing]) {
      if (!node) continue;
      node.traverse((child) => {
        if (!child.isMesh) return;
        const material = child.material;
        if (material?.userData?.printed) return;
        /* Glass and the gas itself let the light through: a transparent tube
           that cast a solid shadow would read as a rod of steel. */
        if (material?.transparent && (material.opacity ?? 1) < 0.5) return;
        child.castShadow = key !== "bench";
      });
    }
    /* An instrument built *after* it was picked - a lab turning the gauge on
       while its panel is the one open - wears its outline from its first frame
       rather than on the next click. */
    this._paintSelection();
  }

  /**
   * Show one instrument's outline, or none.
   *
   * The picked one is drawn in the accent and every other one back in the grey
   * it is normally drawn in, so picking a second instrument takes the outline
   * off the first rather than leaving two of them lit. A part that is not on the
   * stage has nothing to paint; a part that arrives later is painted by `_build`.
   */
  setSelected(key) {
    this.selected = key ?? null;
    this._paintSelection();
    return this;
  }

  /** The one place a hairline's colour is decided - and the frame with it. */
  _paintSelection() {
    for (const [key, lines] of this.hairlines) {
      for (const line of lines) line.material = key === this.selected ? this.chosenEdge : this.line;
    }
    this._paintFrame();
  }

  /**
   * Put the box of accent rule round whichever instrument is picked.
   *
   * The hairlines an instrument is drawn with are repainted in the accent when
   * it is picked, and that is the *whole* of what this did at first. On a bench
   * full of pale instruments a repainted hairline is a millimetre of violet on a
   * grey dial: the reader who picked the pressure gauge could not tell it from
   * the one he had not - the pipe, the stand and the dial's own body all went on
   * being grey, and the mark was thinner than the shadow of the thing it was
   * meant to mark.
   *
   * So a picked instrument is *boxed* as well as outlined, exactly as a picked
   * spring is on the block bench: a frame of accent rule round the space the
   * instrument actually occupies, as tall as the standpipe and as wide as the
   * dial and the pipe that reaches the box, so the whole of the instrument the
   * panel is about is inside one mark. The frame is sized from the instrument's
   * own meshes rather than from a box written down beside it, so it cannot come
   * off a gauge that has grown, or a set of weights that has been rebuilt.
   */
  _paintFrame() {
    const built = this.selected ? this.built.get(this.selected) : null;
    /* Everything the instrument was built of and not just its first group: the
       gauge is a dial on one hand and a standpipe on the other, and a frame
       round the dial alone would leave the pipe - which is the half of that
       instrument a reader is looking at when he picks it - outside the mark. */
    const nodes = Object.values(built ?? {}).filter((value) => value?.isObject3D);
    if (!nodes.length) {
      this.frame.visible = false;
      return;
    }
    const box = this._boundsOf(nodes);
    if (!box) {
      this.frame.visible = false;
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    /* A frame drawn a hand's width outside the instrument rather than on it: a
       rule laid over the thing it is ruling is a scratch, and the one thing this
       mark must not be is invisible against the instrument's own edge. */
    const pad = Math.max(0.014, Math.max(size.x, size.y, size.z) * 0.05);
    this.frame.position.set(centre.x, centre.y, centre.z);
    this.frame.scale.set(size.x / 2 + pad, size.y / 2 + pad, size.z / 2 + pad);
    this.frame.visible = true;
  }

  /**
   * The space an instrument takes up, in this apparatus's own frame of
   * reference: the union of its own meshes' boxes, each as the drawing has it.
   *
   * Its hairlines are left out - they are the instrument's own edges, already
   * lit, and a box measured to them is a box measured to itself.
   */
  _boundsOf(objects) {
    this.group.updateWorldMatrix(true, true);
    const toLocal = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const scratch = new THREE.Box3();
    const box = new THREE.Box3();
    for (const object of objects) {
      object.traverse((node) => {
        if (!node.isMesh || node.isSprite || !node.geometry) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        if (!node.geometry.boundingBox) return;
        scratch.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld).applyMatrix4(toLocal);
        box.union(scratch);
      });
    }
    return box.isEmpty() ? null : box;
  }

  _buildBench() {
    const group = new THREE.Group();
    /* One slab, in the block bench's own colour and its own thickness: the
       stage this box stands on is the stage the rigs stand on. It used to be a
       thin top on four slim legs, which is a desk - and a desk under a chamber
       is furniture from another room, standing in a room with no floor under
       it. */
    const top = new THREE.Mesh(this.unitBox, this.floorSlab);
    top.receiveShadow = true;
    group.add(top);
    /* And the squares on it, as one LineSegments whose geometry is rewritten
       when the bench changes size (see `_syncBenchGrid`): the marks on a table
       are a scale, and a scale that stretched with the table would be a hem. */
    const grid = new THREE.LineSegments(new THREE.BufferGeometry(), this.gridLine);
    grid.frustumCulled = false;
    group.add(grid);
    this.group.add(group);
    return { group, top, grid, gridKey: "" };
  }

  /**
   * The squares on the bench, at the bench's own size.
   *
   * Rewritten rather than scaled, because a scaled line is a line of scaled
   * thickness. One square is half the box, so the step is in the same units as
   * everything else on the stage and a reader who has watched the box grow has
   * watched the squares stay the same - which is the whole of what a grid is
   * for. The buffer is only rebuilt when the table actually changes size, and
   * the table only changes size when the box or the instruments do.
   */
  _syncBenchGrid(bench, width, u, cx, y) {
    const halfX = width / 2;
    const halfZ = (BENCH_D * u) / 2;
    const key = Math.round((width / u) * 50) * 1e6 + Math.round(u * 1000);
    if (bench.gridKey !== key) {
      bench.gridKey = key;
      const step = BENCH_STEP * u;
      const lines = [];
      const nx = Math.floor(halfX / step);
      const nz = Math.floor(halfZ / step);
      for (let i = -nx; i <= nx; i++) {
        lines.push(i * step, 0, -halfZ, i * step, 0, halfZ);
      }
      for (let i = -nz; i <= nz; i++) {
        lines.push(-halfX, 0, i * step, halfX, 0, i * step);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      bench.grid.geometry.dispose();
      bench.grid.geometry = geometry;
    }
    bench.grid.position.set(cx, y, 0);
  }

  _buildWeights() {
    const group = new THREE.Group();
    const rod = new THREE.Mesh(this.unitRod, this.metal);
    rod.rotation.z = Math.PI / 2;
    this._outline(rod, this.rodEdges);
    group.add(rod);
    /* Three round masses with a hairline round each, so the stack reads as a
       stack of weights pressing the lid rather than as one lump on the end of
       the box. */
    const discs = [];
    for (let i = 0; i < 3; i++) {
      const disc = new THREE.Mesh(this.unitDisc, this.metal);
      disc.rotation.z = Math.PI / 2;
      this._outline(disc, this.discEdges);
      discs.push(disc);
      group.add(disc);
    }
    this.group.add(group);
    return { group, rod, discs };
  }

  /**
   * The pressure gauge, plumbed in.
   *
   * Two groups, because they are measured differently. The dial is built at
   * unit radius and scaled into place, so one `scale` call sizes the whole
   * instrument and a bigger box gets a bigger dial rather than a dial with a
   * bigger face and the same needle. The plumbing is built in world units,
   * because a pipe is a length: the branch from the lid to the standpipe
   * changes with the lid, and a pipe that changed its bore with it would not be
   * a pipe.
   */
  _buildGauge() {
    const body = new THREE.Group();
    const plumbing = new THREE.Group();

    /* The case: a shallow drum, with a lip standing off its front rim so the
       dial is set *into* something rather than being the front of a puck. */
    const drum = new THREE.Mesh(this.unitDisc, this.metal);
    drum.rotation.x = Math.PI / 2;
    drum.scale.set(0.97, 0.34, 0.97);
    this._outline(drum, this.discEdges);
    body.add(drum);

    const lip = new THREE.Mesh(this.unitDisc, this.recess);
    lip.rotation.x = Math.PI / 2;
    lip.scale.set(1.05, 0.08, 1.05);
    lip.position.z = 0.15;
    this._outline(lip, this.discEdges);
    body.add(lip);

    /* The card the scale is printed on, set back inside the lip, and the bezel:
       a real ring standing over the card's edge, which is what stops a printed
       circle reading as a sticker on a disc. */
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.90, 56), this.paper);
    face.position.z = 0.20;
    this.resources.push(face.geometry);
    body.add(face);
    const dial = makeFace(256, 256, drawGaugeFace, (texture) => {
      this.resources.push(texture);
      face.material = this._printedFace(texture);
    });

    const bezel = new THREE.Mesh(this.unitRing, this.metal);
    bezel.scale.setScalar(0.95);
    bezel.position.z = 0.215;
    body.add(bezel);

    /* The needle: a tapered prism pivoting on the card, and the tail on the far
       side of the hub that makes it read as a needle rather than as a spoke. */
    const needle = new THREE.Group();
    needle.position.z = 0.26;
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.030, 0.80, 4), this.live);
    blade.rotation.z = -Math.PI / 2;
    blade.position.x = 0.40;
    const tail = new THREE.Mesh(this.unitBox, this.live);
    tail.scale.set(0.22, 0.055, 0.045);
    tail.position.x = -0.11;
    needle.add(blade, tail);
    this.resources.push(blade.geometry);
    body.add(needle);

    const hub = new THREE.Mesh(this.unitDisc, this.dark);
    hub.rotation.x = Math.PI / 2;
    hub.scale.set(0.085, 0.16, 0.085);
    hub.position.z = 0.33;
    body.add(hub);

    /* Where the pipe arrives: a hex nut the size a nut is, screwed onto the
       underside of the case. */
    const socket = new THREE.Mesh(this.unitHex, this.metal);
    socket.scale.set(0.155, 0.13, 0.155);
    socket.position.y = -GAUGE_SOCKET;
    body.add(socket);

    /* The plumbing, all in the one plane so it reads as one run of pipe: a
       standpipe up from a flange bolted to the bench, a tee where the branch
       meets it, a valve on the branch, and a flange bolted to the lid. */
    const foot = new THREE.Mesh(this.unitDisc, this.metal);
    this._outline(foot, this.discEdges);
    const collar = new THREE.Mesh(this.unitRod, this.metal);
    const riser = new THREE.Mesh(this.unitRod, this.metal);
    const tee = new THREE.Mesh(this.unitRod, this.metal);
    const branch = new THREE.Mesh(this.unitRod, this.metal);
    branch.rotation.z = Math.PI / 2;
    const stub = new THREE.Mesh(this.unitRod, this.metal);
    stub.rotation.z = Math.PI / 2;
    const tap = new THREE.Mesh(this.unitBox, this.recess);
    this._outline(tap, this.boxEdges);
    const valve = new THREE.Mesh(this.unitRod, this.metal);
    valve.rotation.z = Math.PI / 2;
    const nutA = new THREE.Mesh(this.unitHex, this.metal);
    nutA.rotation.z = Math.PI / 2;
    const nutB = new THREE.Mesh(this.unitHex, this.metal);
    nutB.rotation.z = Math.PI / 2;
    const stem = new THREE.Mesh(this.unitRod, this.metal);
    const wheel = new THREE.Mesh(this.unitWheel, this.metal);
    wheel.rotation.x = Math.PI / 2;
    const wheelHub = new THREE.Mesh(this.unitRod, this.dark);
    plumbing.add(
      foot, collar, riser, tee, branch, stub, tap, valve, nutA, nutB, stem, wheel, wheelHub,
    );

    this.group.add(body, plumbing);
    return {
      group: body, body, plumbing, foot, collar, riser, tee, branch, stub, tap, valve,
      nutA, nutB, stem, wheel, wheelHub, face, dial, needle,
    };
  }

  /**
   * The room thermometer: a printed board with a glass tube down it and a
   * spirit bulb at its foot, standing on its own base at the end of the bench.
   *
   * Built in its own units, where the board is one wide and two and a third
   * tall, so the printed scale and the mesh the column climbs are laid out from
   * the same numbers and cannot drift apart. The base is the whole of what puts
   * the instrument on the table: it is the only part with a footprint, and the
   * board and its back are held up out of it.
   *
   * The board's own y is measured up from the bench, from the foot of the
   * stand, and the print is the only thing here that works in the board's own
   * centre of coordinates - which is why the panel mesh carries it up there
   * rather than the layout of the board being written round it.
   */
  _buildThermometer() {
    const group = new THREE.Group();
    const H = THERMO_ASPECT;
    /* The printed panel's own centre line, measured up from the foot: the two
       ends of the print are H/2 either side of it and nothing else is. */
    const cy = THERMO_BASE_H + H / 2;

    /* The foot. A plinth that lies flat on the bench, wider and deeper than
       the board on every side, because this is the part that answers "what is
       holding this up", and a board standing on a table that cannot answer
       that question is a board that looks like it is falling over. */
    const base = new THREE.Mesh(this.unitBox, this.metal);
    base.scale.set(THERMO_BASE_W, THERMO_BASE_H, THERMO_BASE_D);
    base.position.y = THERMO_BASE_H / 2;
    this._outline(base, this.boxEdges);
    group.add(base);

    /* Two blocks over the board's foot, one either side of it: the board is
       held by the base and not balanced on it, and a joint you can see is the
       difference between a stand and a coincidence. */
    for (const side of [-1, 1]) {
      const clamp = new THREE.Mesh(this.unitBox, this.metal);
      clamp.scale.set(0.075, 0.20, THERMO_BASE_D * 0.72);
      clamp.position.set(side * 0.5375, THERMO_BASE_H + 0.06, -0.02);
      this._outline(clamp, this.boxEdges);
      group.add(clamp);
    }

    /* The back board, standing in the plinth and reaching a rim past the print
       on every side. */
    const back = new THREE.Mesh(this.unitBox, this.recess);
    back.scale.set(THERMO_BACK_W, H + THERMO_BACK_PAD, 0.05);
    back.position.set(0, cy, -(THERMO_PANEL_D / 2 + 0.025));
    this._outline(back, this.boxEdges);
    group.add(back);

    const panel = new THREE.Mesh(this.unitBox, this.paper);
    panel.scale.set(1, H, THERMO_PANEL_D);
    panel.position.y = cy;
    this._outline(panel, this.boxEdges);
    group.add(panel);

    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, H), this.paper);
    face.position.set(0, cy, THERMO_PANEL_D / 2 + 0.004);
    this.resources.push(face.geometry);
    group.add(face);
    const dial = makeFace(200, 460, drawThermoPanel, (texture) => {
      this.resources.push(texture);
      face.material = this._printedFace(texture);
    });

    /* The bore: a glass tube standing off the board, with a collar at its top
       and one where it meets the bulb, so a transparent cylinder reads as glass
       rather than as nothing. */
    const tube = new THREE.Mesh(this.unitTube, this.glass);
    tube.scale.set(THERMO_TUBE_R, THERMO_TUBE_TOP - THERMO_BULB_Y, THERMO_TUBE_R);
    tube.position.set(THERMO_TUBE_X, cy + (THERMO_TUBE_TOP + THERMO_BULB_Y) / 2, THERMO_TUBE_Z);
    group.add(tube);
    const cap = new THREE.Mesh(this.unitRod, this.metal);
    cap.scale.set(THERMO_TUBE_R * 1.32, 0.048, THERMO_TUBE_R * 1.32);
    cap.position.set(THERMO_TUBE_X, cy + THERMO_TUBE_TOP + 0.008, THERMO_TUBE_Z);
    group.add(cap);
    const collar = new THREE.Mesh(this.unitRod, this.metal);
    collar.scale.set(THERMO_TUBE_R * 1.28, 0.042, THERMO_TUBE_R * 1.28);
    collar.position.set(THERMO_TUBE_X, cy + THERMO_BULB_Y + THERMO_BULB_R * 0.78, THERMO_TUBE_Z);
    group.add(collar);

    /* The spirit: the bulb, and the column that grows out of it. One mesh each,
       and not two halves of one: the column's bottom edge stays in the bulb and
       its top edge is the reading. */
    const bulb = new THREE.Mesh(this.unitBall, this.live);
    bulb.scale.setScalar(THERMO_BULB_R);
    bulb.position.set(THERMO_TUBE_X, cy + THERMO_BULB_Y, THERMO_TUBE_Z);
    group.add(bulb);
    const column = new THREE.Mesh(this.unitRod, this.live);
    group.add(column);

    this.group.add(group);
    return { group, base, back, panel, dial, column, bulb };
  }

  _dispose(key) {
    const part = this.built.get(key);
    this.built.delete(key);
    this.hairlines.delete(key);
    if (!part) return;
    /* The meshes share the file's geometries and materials, so there is nothing
       to free here but the nodes themselves; the printed faces' own textures
       and materials are held in `resources` and live as long as the page
       does. A node that is not in the group is simply not there to remove. */
    for (const node of [part.group, part.plumbing]) {
      if (node) this.group.remove(node);
    }
  }

  /* ---------------------------------- laying out --------------------------------- */

  /**
   * Put everything where the box says it goes, and redraw the printed faces
   * when there is something new on them.
   *
   * Nothing here is turned towards anything. Both instruments are built facing
   * the way the box itself faces and stay that way, so a dial read from behind
   * is a dial seen from behind, which is what an object does and what a
   * billboard cannot.
   *
   * Called every frame: moving a bench is arithmetic, and a face that only
   * redrew when a number changed would still have to be compared every frame to
   * know. The 0.2 s gate is the whole optimisation, and it is the right one -
   * the gas's pressure window is a hundred times longer than that.
   *
   * @param {number} t seconds since the page loaded, for nothing but the gate
   */
  update(t) {
    const { u, L } = this._metrics();
    const ground = this._groundY(u);

    if (t - this._dialTick > 0.2) {
      this._dialTick = t;
      /* The gauge reads the pressure on the lid's *outer* face: the air the box
         is standing in. That is the face its branch pipe is tapped into, it is
         the quantity whose number the panel sets, and it is a boundary
         condition - so the needle points at what was asked for and stays
         pointing at it while the experiment runs, rather than wandering with a
         pressure the gas is measuring for itself. The gas's own pressure is the
         rail's reading, counted off the molecules that hit the walls. */
      this._pressure = this.box.lid.external / 1e6;
      this._temperature = this.box.bath;
      this.built.get("gauge")?.dial.set(this._pressure);
      this.built.get("thermometer")?.dial.set(this._temperature);
    }

    const bench = this.built.get("bench");
    if (bench) {
      const e = this._frameExtent();
      const width = e.right - e.left;
      const cx = (e.left + e.right) / 2;
      const topY = this._benchTop(u);
      const thick = BENCH_T * u;
      bench.top.position.set(cx, topY - thick / 2, 0);
      bench.top.scale.set(width, thick, BENCH_D * u);
      this._syncBenchGrid(bench, width, u, cx, topY + 0.0015 * u);
    }

    const weights = this.built.get("weights");
    if (weights) {
      weights.rod.position.set(L + 0.42 * u, 0, 0);
      weights.rod.scale.set(0.038 * u, 0.85 * u, 0.038 * u);
      weights.discs.forEach((disc, i) => {
        disc.position.set(L + (0.45 + i * 0.15) * u, 0, 0);
        disc.scale.set(0.20 * u, 0.06 * u, 0.20 * u);
      });
    }

    const gauge = this.built.get("gauge");
    if (gauge) {
      const x = this._gaugeX(u, L);
      const y = GAUGE_Y * u;
      const r = GAUGE_R * u;
      const z = GAUGE_Z * u;
      const tapY = GAUGE_TAP_Y * u;

      gauge.body.position.set(x, y, z);
      gauge.body.scale.setScalar(r);
      /* The needle sweeps the same arc the scale is printed on: 135 degrees
         round to 405, clockwise on the face, which is anticlockwise in a space
         whose y points up. */
      const max = dialMax(this._pressure);
      const sweep = Math.PI * 1.5 * Math.min(1, Math.max(0, this._pressure / max));
      gauge.needle.rotation.z = -(Math.PI * 0.75 + sweep);

      /* The standpipe: a flange bolted to the bench, a spigot, and a pipe up to
         the hex nut under the case. Measured from the bench rather than from
         the dial, because the bench is the thing that does not move. */
      const bore = PIPE_R * u;
      const socketY = y - (GAUGE_SOCKET + 0.06) * r;
      const loY = ground + 0.055 * u;
      gauge.foot.position.set(x, ground + 0.022 * u, z);
      gauge.foot.scale.set(0.088 * u, 0.045 * u, 0.088 * u);
      gauge.collar.position.set(x, ground + 0.115 * u, z);
      gauge.collar.scale.set(bore * 1.6, 0.12 * u, bore * 1.6);
      gauge.riser.position.set(x, (loY + socketY) / 2, z);
      gauge.riser.scale.set(bore, Math.max(0.02, socketY - loY), bore);

      /* The tee where the branch arrives, so the standpipe reads as a run of
         pipe a gauge is screwed onto rather than as a stick holding one up. */
      gauge.tee.position.set(x, tapY, z);
      gauge.tee.scale.set(bore * 1.6, bore * 3.2, bore * 1.6);

      /* The branch: from a flange on the lid's own face to the standpipe, with
         a valve where it arrives. It is a length rather than a shape, so it is
         measured against the lid every frame, and a squeeze moves the pipe with
         the piston that is doing the squeezing. */
      const span = Math.max(0.02, x - L);
      gauge.branch.position.set(L + span / 2, tapY, z);
      gauge.branch.scale.set(bore, span, bore);
      gauge.tap.position.set(L + 0.024 * u, tapY, z);
      gauge.tap.scale.set(0.048 * u, 0.13 * u, 0.13 * u);
      gauge.stub.position.set(L + 0.056 * u, tapY, z);
      gauge.stub.scale.set(bore * 1.5, 0.09 * u, bore * 1.5);
      /* The valve: a barrel with a hex nut at either end, a stem and a wheel:
         the part of the run that says the reading can be shut off. */
      const valveX = x - 0.55 * u;
      gauge.valve.position.set(valveX, tapY, z);
      gauge.valve.scale.set(bore * 1.7, 0.15 * u, bore * 1.7);
      gauge.nutA.position.set(valveX - 0.095 * u, tapY, z);
      gauge.nutA.scale.set(bore * 1.6, 0.055 * u, bore * 1.6);
      gauge.nutB.position.set(valveX + 0.095 * u, tapY, z);
      gauge.nutB.scale.set(bore * 1.6, 0.055 * u, bore * 1.6);
      gauge.stem.position.set(valveX, tapY + 0.165 * u, z);
      gauge.stem.scale.set(bore * 0.62, 0.18 * u, bore * 0.62);
      gauge.wheel.position.set(valveX, tapY + 0.265 * u, z);
      gauge.wheel.scale.setScalar(0.085 * u);
      gauge.wheelHub.position.set(valveX, tapY + 0.245 * u, z);
      gauge.wheelHub.scale.set(bore * 0.85, 0.045 * u, bore * 0.85);
    }

    const thermo = this.built.get("thermometer");
    if (thermo) {
      const p = this._thermoPlace();
      thermo.group.position.set(p.x, p.y, p.z);
      thermo.group.scale.setScalar(THERMO_W * u);
      /* The column climbs from the bulb to the reading, and its top edge is
         where the printed scale says that reading is. Its y is the board's own,
         measured from the foot of the stand: the panel's centre line plus the
         same two heights the bulb and the tube were built from. */
      const t01 = Math.min(1, Math.max(0, this._temperature / 1200));
      const top = THERMO_TICK_0 + t01 * (THERMO_TICK_1 - THERMO_TICK_0);
      const height = Math.max(0.001, top - THERMO_BULB_Y);
      thermo.column.scale.set(THERMO_TUBE_R * 0.6, height, THERMO_TUBE_R * 0.6);
      thermo.column.position.set(
        THERMO_TUBE_X,
        THERMO_BASE_H + THERMO_ASPECT / 2 + (top + THERMO_BULB_Y) / 2,
        THERMO_TUBE_Z,
      );
    }

    /* And the frame round the picked instrument, redrawn round where that
       instrument is *now*: the gauge's branch pipe follows the lid, the bench
       follows the box and the box is whatever size the reader has set it to, so
       a mark placed once when the instrument was picked would be a mark left
       hanging where the instrument used to be. */
    if (this.frame.visible) this._paintFrame();
  }

  dispose() {
    for (const key of [...this.built.keys()]) this._dispose(key);
    for (const resource of this.resources) resource.dispose?.();
    this.resources = [];
  }
}
