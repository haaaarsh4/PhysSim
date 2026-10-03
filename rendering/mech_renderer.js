/**
 * rendering/mech_renderer.js - the Vibrations workbench's stage.
 *
 * A track, a few blocks on it, and the springs and dashpots that hold them
 * together and to the walls - drawn the way a system-dynamics figure draws them,
 * because that is the figure the reader is comparing it against. Nothing here
 * decides anything physical: it reads the state vector and draws where the
 * blocks are, which is what lets the panel be the only place the physics is
 * described.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS WORTH SAYING OUT LOUD
 * ---------------------------------------------------------------------------
 * The layout is a *chain*. Every system this bench can hold is a line of masses
 * with elements between them, drawn left to right in the order the model lists
 * them, and an element that reaches the ground is drawn reaching to one of the
 * two fixed posts at the ends. That is a real restriction rather than a
 * shortcut: it is what makes a system recognisable at a glance, and every figure
 * in the course this bench is built for is a chain.
 *
 * The motions are *scaled*, and the scale is on the panel. A quarter car shaken
 * by ten millimetres of road is a millimetre of body in a rig half a metre
 * across, and drawn honestly it is a picture of nothing moving. So the drawing
 * magnifies displacements by a factor the reader sets, and the panel says what
 * it is. The alternative - drawing the true thing and letting the reader
 * conclude that suspension does nothing - would be the dishonest one.
 *
 * A mass's *size* is its mass. A block ten times heavier is drawn about half
 * again as wide, so the picture carries the one number that matters most to
 * every one of these systems. It is not to scale in any strict sense, and it is
 * not meant to be: it is a visual key to which mass is which, and the panel has
 * the kilograms.
 *
 * Colour follows the app's palette and nothing else, and there are four of them:
 * the bench is the same pale slab and the same faint grid the Dynamics bench
 * stands on, the masses are the ink, every spring and dashpot is one chrome grey
 * told apart by its shape, and the accent marks the two things that are inputs -
 * the drive and whatever is selected. A stage with a colour per part is a diagram
 * that has to be read with a key; this one is read the way the drawing in the
 * notes is.
 */
import * as THREE from "three";
import { OrbitCameraController, PanZoomController2D } from "./camera.js";
import { subscript } from "../simulation/mech_system.js";

/* The palette, by name, so no colour is written twice: these are
   frontend/style.css's own values, and they are the Dynamics bench's own
   colours - dark blocks on a pale bench, chrome elements, one violet accent for
   the things that are inputs. */
const INK = 0x34343f;        // the app's ink: the supports the rig is bolted to
const MASS = 0x3f3e4a;       // the blocks, a hair off the ink so an edge reads
const MASS_EDGE = 0x2a2933;
const CHROME = 0x8a8794;     // springs and dashpots: one material, two shapes
const FLOOR = 0xdedde7;      // --stage-2: the bench the whole rig stands on
const FLOOR_GRID = 0xcdccd7; // the squares drawn on it
const ACCENT = 0x9e00ff;     // the *selection*: the outline of whatever is picked
const AMBER = 0xd98324;      // the forces: an input, and never the selection colour
const MUTED = 0x6d6c78;      // the ground's own motion, and anything not connected

/** How wide a block of one kilogram is, in world units, and how far a block's
 *  width may travel from there. A cube root of the mass would put a 1000 kg
 *  structure at ten times a kilogram's width, which is a building next to a
 *  brick; the sixth root is the compromise that keeps a heavy mass visibly
 *  heavier without turning the rig into a skyline. */
const BLOCK_UNIT = 0.24;
const BLOCK_MIN = 0.14;
const BLOCK_MAX = 0.46;

/** Every block is the same height. The *width* is what carries the mass, so a
 *  rig is a row of blocks standing on one line however heavy they are - which is
 *  how every figure in the course draws it, and what lets two blocks of very
 *  different masses sit on the same ground and be joined by a level spring.
 *
 *  The height is set by the second lane, and not the other way round: a pair of
 *  nodes joined by both a spring and a dashpot is drawn as two elements, one on
 *  the axis and one above it, and an element is bolted to a block's *face*. A
 *  block shorter than the upper lane's own height would be a block that a
 *  dashpot reaches past - the barrel ending above the corner it is attached to,
 *  which reads as a part that is not attached at all. So the block is tall
 *  enough that the upper lane is inside its face, and every element on this
 *  stage ends against something. */
const BLOCK_H = 0.30;

/** Every block is the same depth, too. A block's depth is not a number any
 *  reader of the figure is being told - the width is the mass - so it is a
 *  constant, and its one job is to be the plane the elements are drawn on. */
const BLOCK_D = 0.20;

/** The two elements' own radii, in world units, and the reason they are named:
 *  the upper lane is worked out from the dashpot's, so a dashpot's barrel is
 *  inside the block's face wherever the lane is drawn. */
const SPRING_R = 0.026;
const DAMPER_R = 0.036;

/** The distance between the centres of two neighbouring masses, in world
 *  units. Wide enough that a rig of four masses is still a rig and not a stack
 *  of blocks, and narrow enough that the connecting elements have somewhere to
 *  be. */
const SPACING = 0.84;

/** The top of the bench: the surface the blocks stand on, and the height the
 *  whole stage is built up from. */
const BENCH_Y = 0;

/** The bench itself: one slab, deep enough to be a place rather than a line and
 *  thick enough to still be there edge-on in the flat 2D view. It is the same
 *  slab the Dynamics bench stands on, in the same colour and at the same
 *  thickness, because the two benches are two rooms in one building. */
const BENCH_T = 0.06;
const BENCH_D = 0.52;

/** The squares on it, in world units. The other bench draws half-metre squares
 *  because its room is metres across; a rig is a hand's width, so these are
 *  quarter-metre ones - the same ruler at the same number of pixels. */
const BENCH_GRID = 0.26;

/* ----------------------------------------------------------------------------
 * THE RULE ON THE EDGE OF THE BENCH
 * ---------------------------------------------------------------------------
 * The stage's whole subject is how far something moved, and the only number for
 * it used to be on the rail - four hundred pixels away from the thing it is
 * about. So the bench carries its own scale, engraved on its front edge and read
 * like a rule: what stands under a block is that block's displacement, in the
 * same millimetres the rail prints, read off the same zero.
 *
 * It is ruled in the *model's* millimetres rather than in the bench's, and drawn
 * at whatever magnification the motion is being drawn at (see `fitScale`), so
 * the number under a block is the number the rail prints for it however loud the
 * picture has had to be drawn. That is also why the graduations are chosen per
 * frame: at a tenth of life size a hundred-millimetre rule is a hair's width of
 * bench and its numbers would be a row of smudges, so the step climbs the ladder
 * every rule is marked off in and the rule stays legible instead of getting
 * denser.
 */
/** How much bench is left plain at each end of the rule. */
const RULE_INSET = 0.05;
/** The plate the rule is graduated on: a shade off the bench itself, because the
 *  rule is let into the slab's own edge rather than hung on it - dark enough to
 *  read as a plate, light enough that the bench is still one slab. */
const RULE_PLATE = 0xd7d6e1;
/** The least bench a reader needs between two marks and between two numbers. */
const RULE_NEAR = 0.0125;
const RULE_APART = 0.075;
/** How long a tick is drawn, from the foot of the plate: a plain graduation, one
 *  every fifth, and one that carries a number. In world units of the plate, not
 *  of the model - a rule's graduations are the same length whatever they say. */
const RULE_TICK = [0.017, 0.025, 0.035];
/** The mark a mass's own station wears: the taller tick the datum and every
 *  other mass's rest position is found by. */
const RULE_STATION = 0.047;
/** The cap height of a number on the rule. */
const RULE_NUMBER = 0.022;
/** Room for as many graduations and as many numbers as the widest bench can
 *  carry at the finest step it is ever drawn at, and no more. */
const RULE_MAX_TICKS = 640;
const RULE_LABELS = 56;

/** The post at an end of the rig: the fixed world, as a short upright that the
 *  grounded springs and dashpots are bolted to. Narrower and taller than any
 *  block, which is what keeps a support from reading as another mass. */
const POST_W = 0.06;
const POST_H = 0.40;
const POST_D = 0.20;   // the blocks' own depth: one front plane for the whole rig

/** The angle the bench opens at: nearly head-on and only a little above, which
 *  is where the Dynamics bench opens too. This rig is a line of masses, and a
 *  line seen from the side is the figure it is drawn as. Named, because
 *  "put the view back" has to know what it is putting it back to. */
const OPEN_AZIMUTH = 0.10;
const OPEN_ELEVATION = 0.30;

/** How far the view may tilt. The ceiling is where the rig is still read from
 *  the side rather than from on top of it - a rig seen from directly overhead is
 *  a line of blocks with no springs in it - and the floor is above the bench, so
 *  the camera can never get under the slab the whole stage stands on. Both are
 *  in the orbit's own units: radians of elevation. */
const MIN_ELEVATION = 0.08;
const MAX_ELEVATION = 1.05;

/** The air kept around the rig when the camera frames it, so a rig is a rig on a
 *  bench rather than a rig pressed against the edges of the stage. */
const FRAME_PAD = 0.38;

/** How far everything that stands on the bench is seated into it. A block whose
 *  bottom face is exactly coplanar with the bench's top face is two surfaces
 *  fighting for one depth, and the fight is visible as a flickering seam along
 *  the contact; a few millimetres of seat is smaller than a pixel and ends it. */
const SEAT = 0.004;

/** How far either side of a block's own middle a *pair* of elements is drawn.
 *
 *  An element is bolted to the middle of the face of the block it joins - that
 *  is what "this spring is on this mass" looks like in a figure, and it is what
 *  a pair of them is arranged around: the spring above the middle, the dashpot
 *  below it, the two the same distance out, so the pair reads as *centred on the
 *  face* rather than as a stack that has drifted towards the bench. A lone
 *  element is drawn on the middle itself.
 *
 *  The number is not a taste. The drive arrow is the thickest thing that lands
 *  on a face, and it belongs in the middle of it - so the gap between a pair is
 *  left wide enough for the arrow to sit in, which is the one place on a busy
 *  face with nothing drawn in it. A pair drawn tight across the middle is a pair
 *  with nowhere for the arrow to go but through a coil. */
const LANE_OFFSET = 0.074;
/* Four lanes, in the order they are handed out: the first pair straddles the
   middle as tightly as the arrow's own gap allows, and a third and fourth
   element - a rig carried in whole from the systems strip, which is where a face
   with two springs on it comes from now - sit further out, as far as the block's
   own height lets them while their ends are still on the face they are bolted
   to. */
const LANE = [LANE_OFFSET, -LANE_OFFSET, LANE_OFFSET * 1.6, -LANE_OFFSET * 1.6];

/** How long the drive arrow is, at one size, always.
 *
 *  It is not read against anything: the arrow says *where the force is applied*
 *  and *which way it pushes*, and the panel says how much - which is the same
 *  division of labour the blocks and the rail already have, and the one an arrow
 *  that changed length or turned round twice a cycle kept breaking.
 *
 *  About the width of the block it is bolted through: an arrow the size of the
 *  thing it is about reads as part of the picture, and a longer one takes the
 *  stage over. */
const ARROW_LENGTH = 0.20;

/** How close the drawing may carry a mass to the ground support it is bolted
 *  against, as the room the block's own face leaves inside the wall's. Two things
 *  are asked of this one number: enough that the spring reaching the wall is still
 *  drawn as a spring at the end of the stroke rather than as a squashed lump, and
 *  enough for the picture to survive a frame or two of a transient that has not
 *  been sampled yet. */
const RAIL_MARGIN = 0.10;

/** The shortest a bolted part is ever drawn, in metres.
 *
 *  A coil or a barrel is a *length*: crushed to a stub against the post it is
 *  bolted to it reads as a part that has come apart, and a block carried back
 *  until its own spring and dashpot are two lumps buried in the wall is a rig
 *  drawn wrong. So this is the room a dragged block has to leave its own
 *  apparatus against the post it is bolted to, and the block stops there - the
 *  drawing refuses the placement rather than drawing it badly.
 *
 *  It is deliberately more than `RAIL_MARGIN`: that number is about the end of a
 *  *stroke* the model asked for, and this one is about a hand, which can be
 *  asked to stop. */
const ELEMENT_MIN = 0.20;

/** How long the shake table's arrow is at its smallest, and how much longer it
 *  gets at the table's full amplitude: the arrow is drawn in a band beside the
 *  wall with its head on the wall, and it reaches back down that band by as much
 *  as the ground is displaced right now. It is the one arrow on the stage that is
 *  read for *how much*, and the only thing that changes about it is its length:
 *  a table is a table whichever way it is going, so its arrow never turns round. */
const BASE_ARROW_LENGTH = 0.12;
const BASE_ARROW_REACH = 0.24;

/** Where a part with nothing to hold on to is drawn: how long its loose end is,
 *  and how far it hangs down from the end it still holds. A spring bolted to a
 *  mass at one end and to nothing at the other does not lie flat in mid-air - it
 *  droops, which is what a part that has come off looks like, and what tells the
 *  eye at a glance that this one is not carrying anything. */
const LOOSE_STUB = 0.34;

/** The lane a spare part lies in: on the bench, in *front* of the rig rather
 *  than in it - the one strip of the stage no part of the rig is ever drawn in,
 *  which is what makes it the place a part taken off the rig belongs. */
const LOOSE_Z = BENCH_D / 2 - 0.10;

/**
 * How much air an outline keeps around the part it outlines.
 *
 * A hair, and a hair *of the part*: an outline that stands off its part is a
 * frame, and the point of this one is to be the shape of the thing. The air is
 * only there at all because a line drawn exactly on a face is a line half the
 * camera's rays go past, so it has to stand off by a little - but a fixed
 * millimetre is no air at all around a block and a coat of paint around a coil.
 * Six per cent of the part, floored at eight millimetres: the outline of a
 * spring is a spring, the outline of an arrow is an arrow, and the part is
 * plainly *inside* its own box from every angle the stage is looked at from.
 */
function borderPad(size) {
  return Math.max(Math.abs(size) * 0.06, 0.008);
}

/**
 * Is this node part of something that is actually drawn?
 *
 * Three builds an object's ray casting from its own geometry and its place in
 * the world, and it does so whatever `visible` says - a switched-off mesh is
 * still a solid wall to a ray. Every question this stage asks about "what is
 * under the pointer" has to mean *what is on the screen*, so a hit counts only
 * when the node and every group it hangs from are shown.
 */
function isShown(node) {
  for (let n = node; n; n = n.parent) if (n.visible === false) return false;
  return true;
}

/* The probe's own extent, in its own frame: the foot it is clipped on by, the
   body, and the lamp on top. One answer, so the box the instrument's outline is
   drawn from and the box its grips hang off are the same box. */
const PROBE_FOOT = -0.026;
const PROBE_TOP = 0.061;
const PROBE_HALF_X = 0.035;
const PROBE_HALF_Z = 0.026;
const PROBE_MID = (PROBE_TOP + PROBE_FOOT) / 2;
const PROBE_HALF_Y = (PROBE_TOP - PROBE_FOOT) / 2;
const LOOSE_TILT = 0.42;

/** The plane the elements, the arrows and the probe are drawn on: the blocks'
 *  own middle, so a part is bolted to the *centre of the face* it joins.
 *
 *  A block is a drawn box, and its face is a rectangle: an element that ends on
 *  the front edge of that rectangle is bolted to the corner of the face, which
 *  from any angle but dead ahead reads as an element that has slid off the block
 *  it belongs to. On the middle plane the end of a part lands in the middle of
 *  the face from every angle, which is where a figure bolts it and what the eye
 *  is looking for. */
const RIG_Z = 0;

/** A mass that has not been lifted off its own line rides along the bench, which
 *  is the whole of what a rig on this stage does. Everything that reads a rail
 *  asks for this one when there is no lean to read, so there is exactly one
 *  answer to "which way does it travel" and it is this object. */
const RAIL_FLAT = { x: 1, y: 0 };

/** How far off its own axis an element's name is written: just clear of the
 *  thing it names, on the side away from the middle of the face - so the spring
 *  of a pair is lettered above it and the dashpot below it, and neither name
 *  lands on the other element or on the arrow between them.
 *
 *  The distance is measured from the *part's own axis*, which is where the name
 *  is hung from: `element.lane` is already how far the part sits off the middle
 *  of the face, and the label is drawn in the part's own frame - so an offset
 *  that added the lane in again, which this used to, wrote a paired spring's
 *  name twice as far out as the coil it belonged to and a dashpot's name on the
 *  bench under it. It is the part's drawn radius, the label's own cap height
 *  (0.038, the size the sprite is made at), and a hair of air: the name of a
 *  part is written against the part. */
function laneLabelOffset(element) {
  const clear = (element.isSpring ? SPRING_R + 0.008 : DAMPER_R) + 0.038 / 2 + 0.008;
  return element.lane < 0 ? -clear : clear;
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A label that faces the camera: a canvas drawn once and hung on a sprite.
 *
 * Sprites are the only way to write on a three.js stage and have it read from
 * every angle, and caching by text means a rig with twelve labels draws twelve
 * textures once rather than twelve every frame.
 */
const labelCache = new Map();

function labelTexture(text, color) {
  const key = `${text}|${color}`;
  const cached = labelCache.get(key);
  if (cached) return cached;
  const dpr = 3;
  const font = `600 ${26 * dpr}px Inter, system-ui, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + 12 * dpr;
  const height = 40 * dpr;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData = { aspect: width / height };
  labelCache.set(key, texture);
  return texture;
}

/**
 * The next round number at or above `value`, from the ladder a rule is marked
 * off in: one, two, five, ten.
 *
 * Written out because a rule has to be marked off in numbers a reader recognises
 * - the graduations of a bench rule are 20, 50 and 100 millimetres - and a step
 * found by dividing one carefully chosen number by another comes out as 37.
 */
function neatStep(value) {
  const wanted = Number(value);
  if (!(wanted > 0)) return 1;
  const decade = Math.pow(10, Math.floor(Math.log10(wanted)));
  for (const multiple of [1, 2, 5]) {
    if (multiple * decade >= wanted - 1e-9) return multiple * decade;
  }
  return 10 * decade;
}

/**
 * One number standing on the bench's rule.
 *
 * A sprite per number, reused frame after frame: what changes is its map, its
 * place and its width across the plate. A rule redrawn sixty times a second
 * cannot be building a sprite and a texture per number per frame, and the
 * textures themselves are cached by their own text (`labelTexture`), so a rule
 * that has counted to two hundred once never draws those glyphs again.
 */
function setRuleNumber(sprite, millimetres, x, y, z) {
  const value = Math.round(millimetres);
  const text = value < 0 ? `\u2212${-value}` : `${value}`;
  const texture = labelTexture(text, "#34343F");
  if (sprite.material.map !== texture) {
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
  }
  /* The datum is the one number on the rule drawn at full weight: it is the zero
     every other number is read against, and a bench's own zero is worth the ink. */
  sprite.material.opacity = value === 0 ? 1 : 0.82;
  sprite.scale.set(RULE_NUMBER * texture.userData.aspect, RULE_NUMBER, 1);
  sprite.position.set(x, y, z);
  sprite.visible = true;
}

/**
 * The outline a picked part wears: the twelve edges of a wireframe box ruled
 * round the space the part occupies.
 *
 * A box of *half-extents one* - a box that measures one from its middle out to
 * each face - because every part sizes its own outline by setting the border's
 * scale to the half-extents of the space it takes up. Built as a unit box, which
 * is what this used to be, every outline on the stage came out at half the size
 * it asked for and hung *inside* the coil or the arrow it was drawn round.
 *
 * The twelve are split in two, and that is the other half of the same lesson: a
 * box drawn all in one weight shows its far face as a second, smaller box lying
 * inside the part, which is the one thing a selection outline must not look
 * like. The four edges of the near face, and the four that run back from its
 * corners, are the outline; the four of the far face are drawn faint, so they
 * read as the depth of the box rather than as a box within a box.
 */
function outlineGeometry() {
  const near = [];
  const far = [];
  const corner = (x, y, z) => [x, y, z];
  const line = (list, a, b) => { list.push(...a, ...b); };
  const ends = [-1, 1];
  /* The near face, at z = +1: the rectangle the camera reads as the part's own
     box. Which side is near is not decided here - the stage is never looked at
     from behind - but every part is drawn with its near side towards +z. */
  for (const y of ends) line(near, corner(-1, y, 1), corner(1, y, 1));
  for (const x of ends) line(near, corner(x, -1, 1), corner(x, 1, 1));
  /* The four that run back from its corners. */
  for (const x of ends) for (const y of ends) line(near, corner(x, y, 1), corner(x, y, -1));
  /* And the far one. */
  for (const y of ends) line(far, corner(-1, y, -1), corner(1, y, -1));
  for (const x of ends) line(far, corner(x, -1, -1), corner(x, 1, -1));
  const build = (points) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  };
  return { near: build(near), far: build(far) };
}

const OUTLINE = outlineGeometry();

/** One part's outline: the near frame and the faint far one, in a group, so that
 *  positioning, sizing and showing it are one call each and every caller can go
 *  on treating it as the single box of lines it looks like. */
function borderGroup(strong, soft) {
  const group = new THREE.Group();
  for (const [geometry, material] of [[OUTLINE.near, strong], [OUTLINE.far, soft]]) {
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 4;
    group.add(lines);
  }
  group.visible = false;
  return group;
}

/** One label, at a world position, sized so that its cap height is `size`. */
function labelSprite(text, color = "#34343F", size = 0.05) {
  const texture = labelTexture(text, color);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size * texture.userData.aspect, size, 1);
  sprite.renderOrder = 6;
  sprite.userData.size = size;
  return sprite;
}

/** A coil of unit length along +x, as a real tube: a spring drawn as a line
 *  disappears at a glance from a slant, and this stage is looked at from a
 *  slant on purpose. */
function springGeometry(turns = 7, radius = SPRING_R, tube = 0.008) {
  const points = [];
  const count = turns * 18;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const angle = t * turns * Math.PI * 2;
    points.push(v3(t, radius * Math.cos(angle), radius * Math.sin(angle)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), count, tube, 6, false);
}

/**
 * A dashpot of unit length along +x: a barrel with a piston rod through it.
 *
 * Drawn in its own local frame from x = 0 to x = 1 so that stretching it is one
 * scale on the group - and a dashpot that lengthens as its two ends separate is
 * the clearest statement of what viscous damping *is* that a picture can make.
 *
 * Both ends are built to meet what they are bolted to. The rod runs the whole
 * length, so at every length there is a solid piece of the dashpot from one node
 * to the other, and each end carries a flange where it sits against a block or a
 * wall. A barrel floating on a hairline rod between two faces - which is what
 * this drew before - reads as a part that has come loose, and the one thing a
 * reader has to be able to see about a dashpot is that it joins its two nodes.
 */
function damperGroup(material) {
  const group = new THREE.Group();
  /** One cylinder of the dashpot, axis along +x, its centre at `centre` in the
   *  unit frame (so a length of 0.62 at 0.69 runs from 0.38 to 1.0). */
  const piece = (radius, length, centre, segments = 14) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.x = centre;
    group.add(mesh);
    return mesh;
  };
  /* The rod: the full span, one node to the other. */
  piece(DAMPER_R * 0.28, 1, 0.5, 10);
  /* The barrel: closed at the far end, where it is bolted to its node, and open
     at the near end, where the rod goes in. */
  piece(DAMPER_R, 0.62, 0.69, 16);
  /* The gland the rod enters through, and a flange at each end so both ends
     visibly sit against the block or the wall rather than stopping in mid-air a
     rod's width short of it. */
  piece(DAMPER_R * 0.64, 0.05, 0.36);
  piece(DAMPER_R * 0.84, 0.03, 0.015);
  piece(DAMPER_R * 0.84, 0.03, 0.985);
  return group;
}

/** A short cylinder whose axis is +x, spanning 0..1 in its own frame. */
function barGeometry(radius = 0.012) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, 10);
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(0.5, 0, 0);
  return geometry;
}

export class MechRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../simulation/mech_system.js").MechSystem} system
   */
  constructor(canvas, system) {
    this.canvas = canvas;
    this.system = system;
    this.mode = "3d";
    /* How much louder the motions are drawn than they are. One is the honest
       picture and is where a rig with big displacements is read; a quarter car's
       millimetres are read at ten or twenty. Set from the panel, and stated
       there, so nobody has to guess what they are looking at. */
    this.motionScale = 1;
    /* What the drawing is magnified by once the bench's own room is taken into
       account: the reader's scale, or less when the rig's stroke is longer than
       the bench. Kept here rather than derived per call so that everything drawn
       in one frame - masses, springs, arrows - is drawn at the same scale. */
    this.drawnScale = 1;
    this.selected = null;
    this.labels = true;
    /* Whether the accelerometer is standing on the mass it reads. Off by default:
       a bench is the rig and the thing driving it, and an instrument is something
       a reader puts out - which is the bargain the Thermo bench strikes with its
       burner and its thermometer too. */
    this.probeOn = false;
    /* Where each block has been *put* by a hand, which is not the same thing as
       where the rig says it stands. The model is a line of masses on one axis;
       the bench is a slab a block can be picked up and set down on, anywhere, in
       both directions - and a block is a thing on the bench before it is a
       number in a matrix. What is *inside* no element's matrix is the parts
       bolted to it, which stay where they are when it is carried off; this is
       only where the block itself is drawn, and a placement survives a rebuild
       (a slider moving, a spring added) because it is keyed by the mass's own
       index rather than by a mesh. */
    this.stage = new Map();
    /* The same idea for every other thing a hand can put down. A part bolted to
       the rig is drawn by the rig - its bearings decide where it is - but a part
       with an end in the air, a shaker that is bolted to nothing, and the probe
       are *on the bench*, and a bench is a floor: what is on it goes where it is
       put. `parts` is where each spring and dashpot was laid, `spares` where each
       unhooked force stands, and `probePlace` how far the accelerometer has been
       moved from over the mass it reads. All three are offsets like a block's,
       all three are keyed by the model's own index rather than by a mesh, and
       all three survive a rebuild. */
    this.parts = new Map();
    this.spares = new Map();
    this.probePlace = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0xe7e6ee, 1); // --stage
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xdedde7, 0.035);

    /* The same three lights the Dynamics bench uses, at the same strengths: an
       ambient that carries the scene, a key that shapes it, and a grey rim that
       does not tint it. A violet rim was the one thing on this stage that put a
       colour on a room that is meant to be the other bench's own. */
    this.scene.add(new THREE.AmbientLight(0xe8e7ef, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0018;
    key.shadow.radius = 2.4;
    const rim = new THREE.DirectionalLight(0xc9c8d4, 0.4);
    rim.position.set(-3, 2, -3);
    this.scene.add(key, rim);

    /* A narrow field of view on purpose: a wide lens on a rig a hand's width
       across bows the walls and swells whatever is nearest, and the whole point
       of this stage is that it looks like the drawing in the notes. */
    this.camera3d = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.camera2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 200);

    /* Nearly head-on and only slightly above, which is where the Dynamics bench
       opens too: this rig is a line of masses, and a line seen from the side is
       the figure it is drawn as. */
    this.orbit = new OrbitCameraController(this.camera3d, canvas, {
      target: { x: 0, y: 0, z: 0 },
      azimuth: OPEN_AZIMUTH,
      elevation: OPEN_ELEVATION,
      minElevation: MIN_ELEVATION,
      maxElevation: MAX_ELEVATION,
      distance: 3.0,
      minDistance: 0.8,
      maxDistance: 30,
    });
    this.pan2d = new PanZoomController2D(this.camera2d, canvas, { zoomHeight: 1.6, minZoom: 0.25, maxZoom: 20 });

    this.root = new THREE.Group();
    this.scene.add(this.root);

    /* Materials are shared by everything of the same kind: one block of a rig
       and another are the same material, and a rig rebuilt on a parameter change
       should not leak a material per rebuild. */
    /* Five materials, and every object on the stage is one of them. That is the
       whole of the colour scheme: ink for the things the system is made of,
       chrome for the elements that join them, the pale bench they stand on, and
       the accent - which only ever marks something that is being driven or
       picked, exactly as it does on the other two benches. */
    this.materials = {
      mass: new THREE.MeshStandardMaterial({ color: MASS, roughness: 0.45, metalness: 0.1 }),
      post: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: CHROME, roughness: 0.35, metalness: 0.3 }),
      chosen: new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.35, metalness: 0.2 }),
      floor: new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95 }),
      /* The force's own material, in its own colour: this bench's violet means
         "this is the one you have hold of" and nothing else, so an input drawn in
         it would be an input that always looks picked. Amber is an input and
         only an input. */
      force: new THREE.MeshStandardMaterial({ color: AMBER, roughness: 0.4 }),
      accent: new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.4 }),
      muted: new THREE.MeshStandardMaterial({ color: MUTED, roughness: 0.5 }),
      probe: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.4 }),
      /* Never drawn, and the only thing on the stage that is not: this is what a
         spring or a dashpot is *picked* by. A coil is mostly air - the ray
         between two turns of a spring hits nothing - so the element the reader
         can see and the element the pointer can find have to be two different
         pieces of geometry. */
      pick: new THREE.MeshBasicMaterial({ visible: false }),
      /* The three line materials on the stage: the grid on the bench, the edges
         that give a block and a post a crisp silhouette, and the one a selected
         block's edges are swapped to. Shared, so a rebuild does not leave a
         material per block behind it. */
      grid: new THREE.LineBasicMaterial({ color: FLOOR_GRID, transparent: true, opacity: 0.9 }),
      /* The rule: a plate a shade off the bench it is let into, with its
         graduations in the ink everything the rig is made of is drawn in, and
         the stations of the masses in the grey that is not a part of the rig at
         all - a station is where a mass *belongs*, not where it is. */
      rulePlate: new THREE.MeshStandardMaterial({ color: RULE_PLATE, roughness: 0.92 }),
      ruleLine: new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.78 }),
      ruleStation: new THREE.LineBasicMaterial({ color: MUTED, transparent: true, opacity: 0.8 }),
      blockEdge: new THREE.LineBasicMaterial({ color: MASS_EDGE, transparent: true, opacity: 0.55 }),
      postEdge: new THREE.LineBasicMaterial({ color: MASS_EDGE, transparent: true, opacity: 0.35 }),
      chosenEdge: new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95 }),
      /* The far face of a picked part's outline, drawn light: it is the depth of
         the box and not a second box, and at full weight it reads as one. */
      chosenEdgeSoft: new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.3 }),
    };
    this.geometries = {
      spring: springGeometry(),
      pick: barGeometry(0.040),
      bar: barGeometry(0.011),
      /* The arrow's head: sized against the gap a pair of elements leaves in the
         middle of a face, because that gap is where an arrow on a driven face
         has to fit. */
      arrowHead: new THREE.ConeGeometry(0.026, 0.075, 18),
      block: new THREE.BoxGeometry(1, 1, 1),
      /* The rule's plate: a unit square, sized to the bench it is let into
         rather than rebuilt with it. */
      rulePlate: new THREE.PlaneGeometry(1, 1),
    };
    this.geometries.arrowHead.rotateZ(-Math.PI / 2);

    this.raycaster = new THREE.Raycaster();
    /* A raycast against a line is a raycast against a line *of a given radius*,
       and three's default radius is one whole world unit. This stage is full of
       lines - the edges that give every block its outline, the edges on the
       posts - and one unit is wider than the entire rig, so at the default every
       point on the bench came within a unit of some block's outline and answered
       "a mass": the resize cursor showed everywhere, a press anywhere took hold
       of the block, and a drag that began on empty bench moved a mass and then
       started the run. A hundredth of a unit is a line you have to actually
       point at. */
    this.raycaster.params.Line.threshold = 0.01;
    this.raycaster.params.Points.threshold = 0.01;
    this._pointer = new THREE.Vector2();
    this._plan = null;
    this._span = 1.6;

    this.rule = this.buildRule();

    this.sync();
    this.frame();
  }

  /**
   * The millimetre rule the bench is read off, built once and moved every frame.
   *
   * One plate let into the slab's front edge, one buffer of graduations, one of
   * the marks each mass's own station wears, and a fixed pool of numbers that
   * are shown and hidden as the rule's step changes. Everything is allocated
   * here and nothing in `updateRule`: a rule redrawn sixty times a second has no
   * business asking the allocator for anything.
   */
  buildRule() {
    const group = new THREE.Group();
    group.name = "rule";
    group.visible = false;
    const plate = new THREE.Mesh(this.geometries.rulePlate, this.materials.rulePlate);
    group.add(plate);
    const graduations = new THREE.LineSegments(
      new THREE.BufferGeometry(), this.materials.ruleLine,
    );
    graduations.frustumCulled = false;
    graduations.geometry.setAttribute(
      "position", new THREE.BufferAttribute(new Float32Array(RULE_MAX_TICKS * 6), 3),
    );
    group.add(graduations);
    const stations = new THREE.LineSegments(
      new THREE.BufferGeometry(), this.materials.ruleStation,
    );
    stations.frustumCulled = false;
    stations.geometry.setAttribute(
      "position", new THREE.BufferAttribute(new Float32Array(RULE_MAX_TICKS * 6), 3),
    );
    group.add(stations);
    const numbers = [];
    for (let i = 0; i < RULE_LABELS; i++) {
      const sprite = labelSprite("0", "#34343F", RULE_NUMBER);
      sprite.visible = false;
      numbers.push(sprite);
      group.add(sprite);
    }
    const unit = labelSprite("mm", "#6D6C78", RULE_NUMBER * 0.92);
    unit.visible = false;
    group.add(unit);
    this.root.add(group);
    return { group, plate, graduations, stations, numbers, unit };
  }

  /**
   * The scale the drawing is *actually* magnified by, right now.
   *
   * The reader sets how loud the motions are drawn - a quarter car's millimetres
   * at ten or twenty times, a rig laid out in centimetres at one. But a rig can
   * also be driven far enough that its stroke is longer than the bench it stands
   * on, and then no magnification the reader can choose keeps it inside its own
   * ground supports: the block slides out through the wall, and the spring that
   * reaches the wall is drawn squashed to nothing and then inside out. So the
   * picture quietly drops to the largest scale that fits instead, and says which
   * scale that is on the rail. The model is untouched: every reading, every
   * curve and every peak is at life size, and the one number that differs is the
   * stated magnification of the drawing.
   */
  fitScale() {
    const plan = this._plan;
    if (!plan) return this.motionScale;
    const reach = this.stroke();
    if (!(reach > 1e-9)) return this.motionScale;
    /* The room the worst-placed mass has: the wall's inner face, less the block's
       own half and the margin the spring needs.

       Measured from where each mass *stands* rather than from the slot it was
       laid out in, because a hand that has carried a block most of the way to
       its own wall has left it no room to be driven: read from the slots, the
       picture would keep its scale and the block would slide out through the
       wall it was set down beside. A block put against a wall makes the whole
       picture smaller instead, which is the same bargain a rig whose stroke is
       longer than the bench already strikes. */
    const innerLeft = plan.left + POST_W / 2;
    const innerRight = plan.right - POST_W / 2;
    let room = Infinity;
    for (let i = 0; i < this.system.n; i++) {
      const half = this.blockHalf(this.system.M[i]);
      const home = this.restX(i);
      room = Math.min(room, home - half - innerLeft, innerRight - home - half);
    }
    if (!Number.isFinite(room)) room = plan.gap;
    return Math.min(this.motionScale, Math.max(room - RAIL_MARGIN, 0.02) / reach);
  }

  /**
   * How big a stroke the rig is in the middle of, in metres of model - the one
   * number `fitScale` is about.
   *
   * Asked as an *amplitude* rather than as "how far the mass has got":
   * sqrt(x^2 + (v/w)^2) is the size of the swing a mass is in the middle of, and
   * it is constant over one stroke of a rig ringing at that mode, where |x| alone
   * runs from nothing up to the full amplitude twice a cycle.
   *
   * That difference is the whole of what a run looks like. A picture scaled by
   * the instantaneous displacement shrinks as the swing grows, and the drawn
   * position - displacement times scale - stops dead against its own wall for as
   * long as the swing is big: the model is moving, the panels are counting, and
   * the block stands still, then jumps away and stops again. Scaled by the
   * amplitude, the scale changes with the *size* of the swing and not with the
   * phase of it, so the block crosses the bench and comes back however loud the
   * motion is.
   *
   * Every mode is asked, and the *slowest* is used: a single mode answers its own
   * amplitude exactly, and a mass carrying faster modes as well is answered with
   * a slightly larger stroke than it has, which draws the picture a little
   * smaller than it had to be rather than a little too big to fit.
   *
   * @returns {number} the amplitude of the loudest mass, in metres
   */
  stroke() {
    const state = this.system.state ?? [];
    const n = this.system.n;
    let omega = 0;
    for (const mode of this.system.modes ?? []) {
      const value = Number(mode?.omega);
      if (value > 1e-6 && (omega === 0 || value < omega)) omega = value;
    }
    let stroke = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.abs(Number(state[i]) || 0);
      const v = Math.abs(Number(state[n + i]) || 0);
      stroke = Math.max(stroke, omega > 1e-9 ? Math.hypot(x, v / omega) : x);
    }
    return stroke;
  }

  /* ----------------------------------------------------------------------------
     THE LAYOUT
     ---------------------------------------------------------------------------- */

  /**
   * Where everything stands, from the model: one slot per mass, left to right,
   * and a wall at either end just outside them.
   *
   * Recomputed on every model change and never during a run. Nothing here moves
   * with the simulation - what moves is drawn, not laid out - so this is the one
   * place a position is decided, and the frame loop only ever reads it.
   */
  layout() {
    const n = this.system.n;
    const width = (n - 1) * SPACING;
    const x = [];
    for (let i = 0; i < n; i++) x.push(i * SPACING - width / 2);
    /* How far the drawing is carrying any mass from its own slot, right now: the
       rig's own stroke, and the length the bench has to be able to hold. */
    /* A wall stands a good gap out from the end mass: the spring that reaches
       it has to be long enough to read as a spring, and a coil shorter than the
       block it is bolted to reads as a mistake.

       That gap is also the rig's *room*: the bench is laid out once and does not
       move, so a rig whose stroke is longer than this has to be drawn smaller
       rather than the bench drawn longer - see `fitScale`. A bench that grew with
       the response was tried, and it read as the whole stage falling apart: the
       platform stretching, the rig sliding off its own slab and the ground
       support walking away from the springs that reach it. */
    const gap = SPACING * 0.72;
    return {
      x,
      spacing: SPACING,
      gap,
      left: x[0] - gap,
      right: x[n - 1] + gap,
      centre: 0,
      benchY: BENCH_Y,
      /* The line the blocks stand on: their bottoms are on the bench and their
         centres are half a block above it. One number, so a spring at mid-height
         and a block's own middle cannot drift apart. */
      blockY: BENCH_Y + BLOCK_H / 2,
      blockTop: BENCH_Y + BLOCK_H,
    };
  }

  /**
   * How high each of an element's own two ends is drawn, as the lift of the mass
   * that end is bolted to.
   *
   * A rig with a block standing above the bench is a rig whose springs reach up
   * to it: the part is bolted to a *face*, and a face that has been carried up
   * takes its bearings up with it - and the same face rises again as the rig is
   * run if the block was put on a rail, which is why this asks for the mass's
   * own lift rather than for the height a hand left it at. The ground never
   * lifts in this direction - a shake table slides, it does not rise - so an
   * element that reaches a wall leans to it rather than travelling with it.
   *
   * @returns {[number, number]} the lift of the element's first and second ends
   */
  elementLifts(element) {
    const lift = (node) => (node === "g" || node === null || node === undefined ? 0 : this.massLift(node));
    if (element.groundAt !== null && element.groundAt !== undefined) return [lift(element.groundAt), 0];
    if (element.loose) return [lift(element.looseA ? element.nodeB : element.nodeA), 0];
    return [lift(element.nodeA), lift(element.nodeB)];
  }

  /** Half the width of a mass's block: heavier is wider, by the sixth root. */
  blockHalf(mass) {
    const scaled = BLOCK_UNIT * Math.pow(Math.max(mass, 1e-6) / 1, 1 / 6);
    return Math.max(BLOCK_MIN, Math.min(BLOCK_MAX, scaled)) / 2;
  }

  /** The x of a post's inner face - the point a spring or a dashpot reaching the
   *  ground is drawn to. The post stands just outboard of it, so an element meets
   *  its bearing and does not disappear inside it. */
  postInner(side) {
    const plan = this._plan;
    return plan[side] + (side === "left" ? POST_W / 2 : -POST_W / 2) + (this.wallShift ?? 0);
  }

  /**
   * The two ends of an element right now, in world x.
   *
   * The same two points `update()` hangs the part off, asked for by name: the
   * hand that is dragging a spring has to know which end it grabbed, and how far
   * that end has to travel to land on the next block - and it has to be the
   * *drawn* end, including the part of it that is a displacement, or a spring
   * dropped while the rig is ringing lands somewhere other than where the eye
   * says it is.
   *
   * @returns {[number, number]|null} the x of each end, or null if there is no
   *   such element
   */
  elementEnds(index) {
    const element = this.elements?.find((e) => e.index === index);
    if (!element) return null;
    return this.elementSpan(element, (i) => this.massX(i));
  }

  /**
   * The drawn x of each of an element's ends, by the end it is.
   *
   * `elementSpan` answers in the order it *draws* a part in, and for a ground
   * element that order is [mass, wall] whichever way round the part was written -
   * so a hand that has hold of one of a part's ends has to be told which of the
   * two numbers belongs to `a` and which to `b` rather than have it assumed.
   *
   * @returns {{a:number, b:number}|null}
   */
  elementEndKeys(index) {
    const element = this.elements?.find((entry) => entry.index === index);
    if (!element) return null;
    const ends = this.elementEnds(index);
    if (!ends) return null;
    if (element.groundAt !== null && element.groundAt !== undefined) {
      /* A ground element is drawn from its mass end to the wall: the mass is
         whichever of `a` and `b` is not the ground. */
      return element.nodeA === "g" ? { a: ends[1], b: ends[0] } : { a: ends[0], b: ends[1] };
    }
    if (element.loose && !element.looseBoth) {
      /* A loose part is drawn from the bearing it still holds out to its free
         end, so the held end is the first of the two numbers when the *second*
         end is the one in the air, and the second of them when the first is. */
      return element.looseA ? { a: ends[1], b: ends[0] } : { a: ends[0], b: ends[1] };
    }
    return { a: ends[0], b: ends[1] };
  }  /**
   * The lean of one element's bearing, as the vector from the face it is bolted
   *  to on `index` out to its far end - with the rig at rest and the ground where
   *  it is bolted.
   *
   * This is the geometry the hand made when it lifted the block: the same two
   * points `elementSpan` and `elementLifts` give the drawing, asked for where
   * the frame has put everything: the face of the block *as it stands now*,
   * including whatever the run has drawn it doing, so the line this answers with
   * is the line the coil and the dashpot are being drawn along this instant - and
   * the arrow drawn along it goes on matching them while the rig runs.
   *
   * @returns {{x:number,y:number}|null} null for a part with an end in the air
   */
  bearingLean(element, index) {
    const plan = this._plan;
    const a = element.a;
    const b = element.b;
    if (!plan || a === null || a === undefined || b === null || b === undefined) return null;
    /* Which end is *this* mass's, and which is the far end. An element with both
       ends on the same mass is not a bearing at all and has no lean. */
    const far = a === index ? b : b === index ? a : null;
    if (far === null || far === index) return null;
    const half = (i) => this.blockHalf(this.system.M[i]);
    const lift = (node) => (node === "g" ? 0 : (this.stage.get(node)?.y ?? 0));
    const mass = this.massX(index);
    let nearFace;
    let farFace;
    if (far === "g") {
      /* A part reaching the ground is bolted to the inner face of the post at
         its own end of the rig, wherever the drawing has that post standing: the
         shake table takes the post with it, and the *part* is drawn to the post's
         face as it moves, so the line drawn here has to be the same one. */
      const side = index < this.system.n / 2 ? "left" : "right";
      /* The face that looks at the wall: the block's own outer face on that side. */
      nearFace = mass + (side === "left" ? -half(index) : half(index));
      farFace = this.postInner(side);
    } else {
      const other = this.massX(far);
      const towards = Math.sign(other - mass) || 1;
      nearFace = mass + towards * half(index);
      farFace = other - towards * half(far);
    }
    return { x: nearFace - farFace, y: lift(index) - lift(far) };
  }

  /**
   * The line a mass's own bearings describe, as a unit vector - or null when
   *  they do not agree about one.
   *
   * The model is one axis: a mass slides along x and the numbers on the panels
   * are that slide. The bench is a slab a block can be picked up and set down on,
   * and a block set down *above* the line it came from is held there by springs
   * and dashpots drawn leaning up to it. What a hand does to this rig, then, is
   * *lean* it - and the line a lifted block lies on is the line its own bearings
   * describe: the vector from each face it is bolted at to the far end of that
   * part, all of them summed. A mass held by one post lies on the line from that
   * post up to where the hand put it, and the force arrow, which is drawn along
   * that same line, reads as part of the same rig.
   *
   * It is the *drawing's* line and not a direction anything travels: the mass
   * moves along the bench whatever a hand has done, because every number on every
   * panel is along the bench - see `ride`. What this line is asked for is the
   * angle the apparatus and the arrow are drawn at, and it is answered from where
   * the drawing has put everything: the block's face as it stands now, including
   * whatever the run has drawn it doing, so the arrow goes on matching the coil
   * and the dashpot it is drawn beside while the rig is running.
   *
   * A block still in its own slot has no lean in it at all, which is every rig
   * this bench opens with, so a rig nobody has touched answers null - and so does
   * a block whose bearings do not agree on a line, which is every rig with
   * apparatus on *both* sides of the block that was carried up.
   *
   * The sense is taken to be the way positive x points. A rail is a line and it
   * can be ridden backwards, but a mass the model drives to the right must not be
   * drawn travelling left, and a bench whose picture disagrees with its own
   * numbers is worse than a bench without a picture.
   *
   * @returns {{x:number,y:number}|null} a unit vector, or null for no line
   */
  bearingLine(index) {
    const place = this.stage.get(index);
    if (!this._plan || !place || (place.x === 0 && place.y === 0)) return null;
    if (!this.elements) return null;
    let vx = 0;
    let vy = 0;
    let asked = 0;
    for (const element of this.system.elements) {
      const lean = this.bearingLean(element, index);
      if (!lean) continue;
      vx += lean.x;
      vy += lean.y;
      asked += Math.hypot(lean.x, lean.y);
    }
    const length = Math.hypot(vx, vy);
    /* A lean is only a lean when every bearing agrees about which way it goes.

       A mass with a part on each side - a chain's middle block carried up - has
       two parts leaning *opposite* ways, and there is no line through that mass
       at all: the average of an up-and-right lean and an up-and-left one is a
       direction neither part is drawn along, and an arrow drawn on the average
       would be pointing along the middle of nothing. So the rig only leans where
       the bearings agree, and the sum is compared against what they asked for:
       all alike is one line, opposed is none. */
    if (!(length > 1e-6) || length < 0.85 * asked) return null;
    /* Taken the way positive x points: a line is a line either way round, but a
       mass leaning the other way is drawn leaning the other way, and the two are
       not the same picture. */
    if (vx < 0) { vx = -vx; vy = -vy; }
    return { x: vx / length, y: vy / length };
  }

  /**
   * How far the rig has carried a mass, right now, in world metres of drawing.
   *
   * It is the model's own displacement, drawn at the magnification the picture is
   * at, and it is always a distance *along the bench*: every number on every
   * panel is along the bench, and a block drawn travelling up its own ramp would
   * cross less of the bench than the panels say it moved.
   *
   * So a lean never changes where a mass goes, only how it is drawn getting
   * there: the apparatus that reaches a lifted block is drawn leaning up to it
   * (see `bearingLine`), and the arrow with it. This is also why a run cannot
   * *stall* - the drawn position is the model's own displacement and nothing
   * else, so a mass the model has moving is a mass the picture has moving, and no
   * height a hand left a block at can hold it against a stroke.
   */
  ride(index) {
    return (this.system.state?.[index] ?? 0) * this.drawnScale;
  }

  /**
   * Where a mass is standing, in world x: the slot the rig lays it out in, how
   *  far the simulation has moved it, and where a hand has put it.
   */
  massX(index) {
    const place = this.stage.get(index);
    return this._plan.x[index] + this.ride(index) + (place?.x ?? 0);
  }

  /**
   * How far above its own line a mass is drawn: where a hand has put it, and
   *  nothing else. A mass on the bench is at zero and stays there, which is what
   *  a rig nobody has touched looks like - and a mass a hand has lifted stays at
   *  the height it was left at, which is what the parts leaning up to it are
   *  drawn to. A run does not lift a block: it slides it.
   */
  massLift(index) {
    return this.stage.get(index)?.y ?? 0;
  }

  /** How far a hand has put a mass from the slot the rig lays it out in. */
  stageOffset(index) {
    return this.stage.get(index) ?? { x: 0, y: 0 };
  }

  /**
   * Put a mass down somewhere on the bench.
   *
   * This is a *placement* and not a displacement: the rig's own numbers are not
   * touched, the block is drawn where the hand set it, and anything a hand
   * drags onto it afterwards lands on it where it is. A block set back down in
   * its own slot forgets the whole business, so nothing accumulates. */
  placeMass(index, x, y) {
    /* Nothing is bolted to the floor: a block is lifted off the bench, carried
       sideways, and set down again. Downwards it stops at the slab, and sideways
       at its wall or its neighbour, because the slab and the post and the block
       beside it are solid things and a block drawn half inside one of them is a
       block drawn wrong. Those are the three directions the bench can refuse. */
    const next = this.clampPlacement(index, { x, y });
    if (next.x === 0 && next.y === 0) this.stage.delete(index);
    else this.stage.set(index, next);
    return this;
  }

  /**
   * Where a hand's own offset comes to rest, once the bench has refused the rest
   * of it.
   *
   * A placement and the scale the drawing is at are one question: the scale is
   * set by the room a block leaves between itself and its own apparatus (see
   * `fitScale`), and the room is where the block has been put. So the stop is
   * asked for again with the scale the stop itself brings, and the *tightest*
   * answer of the lot is the one kept - a stop that held for one of the two and
   * not the other would be a block left drawn a hair inside its own apparatus.
   *
   * The bounds come back in the coordinates a placement is kept in, an offset
   * from the block's own slot, so they are the offset's own limits rather than a
   * position's.
   *
   * @param {number} index the mass being put down
   * @param {{x:number,y:number}} place where the hand would have it
   * @returns {{x:number,y:number}} where the bench will hold it
   */
  clampPlacement(index, place) {
    const next = { x: Number(place?.x) || 0, y: Math.max(0, Number(place?.y) || 0) };
    if (next.x === 0 && next.y === 0) return next;
    let low = -Infinity;
    let high = Infinity;
    for (let pass = 0; pass < 3; pass += 1) {
      const bounds = this.massBounds(index, next);
      low = Math.max(low, bounds.low);
      high = Math.min(high, bounds.high);
      next.x = Math.min(Math.max(next.x, bounds.low), bounds.high);
      this.stage.set(index, next);
      this.drawnScale = this.fitScale();
    }
    next.x = Math.min(Math.max(next.x, low), high);
    return next;
  }

  /** Every mass's placement, one entry per mass, for a session that has to put
   *  the bench back the way the reader left it - a cut part remembers where it
   *  was cut, and a session that forgot where its block went would come back to
   *  a spring holding air. */
  stageOffsets() {
    if (!this._plan) return [];
    return this._plan.x.map((_, i) => {
      const place = this.stage.get(i);
      return place ? { x: place.x, y: place.y } : null;
    });
  }

  setStage(list) {
    this.stage.clear();
    if (!Array.isArray(list)) return this;
    list.forEach((place, index) => {
      if (!place) return;
      const x = Number(place.x) || 0;
      const y = Math.max(0, Number(place.y) || 0);
      if (x !== 0 || y !== 0) this.stage.set(index, { x, y });
    });
    /* A placement the bench refuses is not put back: a session written by another
       bench - or by a drag that ran on while the page was in the background -
       can hold a block past its own post, and the drawing has to be as unable to
       hold that as a hand is (see `massBounds`). */
    for (const [index, place] of this.stage) this.stage.set(index, this.clampPlacement(index, place));
    return this;
  }

  /** Put every block back in its own slot: what choosing a system does, because
   *  a layout belongs to the rig that was laid out. */
  clearStage() {
    this.stage.clear();
    return this;
  }

  /** Every placement there is, gone: what choosing a system does, because a
   *  layout - and a spare part lying on the bench - belongs to the rig that was
   *  laid out. */
  clearPlaces() {
    this.parts.clear();
    this.spares.clear();
    this.probePlace = null;
    return this;
  }

  /**
   * Where a part that is not bolted to anything has been put.
   *
   * A spring lying on the bench, a shaker standing on it and the probe are all
   * things *on the bench* rather than in the rig, and the hand puts them
   * wherever it likes - in both directions, exactly as a block is put down. The
   * answer for a part no hand has touched is the place it was left by sync():
   * the spare parts at the near left of the slab, which is where a part taken
   * off the rig belongs.
   *
   * @param {"element"|"drive"|"probe"} kind
   * @param {number} [index]
   * @returns {{x:number,y:number}}
   */
  partPlace(kind, index = 0) {
    const plan = this._plan ?? { left: 0 };
    if (kind === "element") return this.parts.get(index) ?? { x: plan.left + 0.40, y: 0 };
    if (kind === "drive") return this.spares.get(index) ?? { x: plan.left + 0.20, y: 0 };
    return this.probePlace ?? { x: 0, y: 0 };
  }

  /** Put one down: the two offsets a hand's own travel adds to where it was. */
  placePart(kind, index, x, y) {
    const next = { x: Number(x) || 0, y: Math.max(0, Number(y) || 0) };
    if (kind === "element") this.parts.set(index, next);
    else if (kind === "drive") this.spares.set(index, next);
    else this.probePlace = next;
    return this;
  }

  /** Every placement there is, for a session that has to put the bench back the
   *  way the reader left it - the same argument as the blocks'. */
  placesFor() {
    const pairs = (map) => [...map.entries()].map(([index, place]) => ({ index, x: place.x, y: place.y }));
    return {
      elements: pairs(this.parts),
      spares: pairs(this.spares),
      probe: this.probePlace ? { ...this.probePlace } : null,
    };
  }

  setPlaces(payload) {
    this.parts.clear();
    this.spares.clear();
    this.probePlace = null;
    if (!payload) return this;
    const load = (list, map) => {
      for (const entry of list ?? []) {
        const x = Number(entry?.x) || 0;
        const y = Math.max(0, Number(entry?.y) || 0);
        if (x !== 0 || y !== 0) map.set(Math.round(entry.index), { x, y });
      }
    };
    load(payload.elements, this.parts);
    load(payload.spares, this.spares);
    if (payload.probe) {
      this.probePlace = { x: Number(payload.probe.x) || 0, y: Math.max(0, Number(payload.probe.y) || 0) };
    }
    return this;
  }

  /** The radius a part is drawn at, which is the size of everything about it:
   *  the coil's own reach for a spring, the barrel's for a dashpot. */
  elementRadius(element) {
    return element.isSpring ? SPRING_R + 0.008 : DAMPER_R;
  }

  /**
   * The two ends of one element, in world x.
   *
   * `at` is how to ask where a mass is standing - the rest position when the rig
   * is being laid out, the moved one when a frame is being drawn - and one
   * function answers both, because an element's ends are the same two questions
   * however they are asked: what it is bolted to, where that is, and - for an
   * end bolted to nothing - where the part has come to hang.
   *
   * @returns {[number, number]} the x of each end, in the element's own order
   */
  elementSpan(element, at) {
    const plan = this._plan;
    const half = (i) => this.blockHalf(this.system.M[i]);
    if (element.looseA && element.looseB) {
      /* Bolted to nothing at either end: a spare part lying on the bench, where
         the hand put it. It lies *flat* - a part with no bearings has nothing to
         hang from - and it starts out at the near left of the slab, which is
         where a part taken off the rig belongs and the one place on this stage
         that no part of the rig is ever drawn. */
      const place = this.partPlace("element", element.index);
      return [place.x, place.x + LOOSE_STUB];
    }
    if (element.loose) {
      const hang = element.hang;
      const node = element.looseA ? element.nodeB : element.nodeA;
      /* The end it still holds, which is where the part is drawn *from*: the
         droop swings the loose end down, and the end that is bolted to a mass
         has to stay bolted to it. */
      const anchor = node === "g"
        ? this.postInner(hang < 0 ? "left" : "right") + this.wallShift
        : at(node) + hang * half(node);
      /* How far the free end reaches, and which way it reaches. A part that came
         off in the hand is given the length it already *had*, signed: the offset
         from the bearing that still holds it to where its free end was when the
         block was taken out from under it - so the part is drawn exactly where
         it was, and only the *connection* is gone. A part no hand has cut droops
         by the standard stub, which is a part lying loose on the bench and not a
         part that was set down. */
      const stub = Number.isFinite(element.stub) && element.stub !== 0
        ? element.stub
        : hang * LOOSE_STUB;
      return [anchor, anchor + stub];
    }
    /* Every end is the *face that faces the other end*, and which face that is
       is read from where the two things stand now rather than from the slots
       the rig was laid out in.

       Laid out from the plan alone, a part is drawn between the two faces the
       *table* would put facing each other, and a hand that has carried a block
       two thirds of a metre sideways - up against the wall, or in among its
       neighbour - is a hand that has turned those two faces round. What comes
       out is a spring drawn through the post it is anchored to, or through the
       block it is bolted to, collapsing to a stub the length of nothing. Read
       from where the bearings actually are, the same part lies in the gap
       between them whatever the hand has done, and leans the way the gap does. */
    if (element.groundAt !== null) {
      const i = element.groundAt;
      /* The middle of the post this element is anchored to, which is the one
         point on it that does not depend on which side the block is now on. */
      const centre = element.outerX + element.dir * (POST_W / 2) + this.wallShift;
      const mass = at(i);
      /* Which way the wall is from the block, as it stands. A block carried out
         past its own wall asks for the spring from the wall's far face - and
         gets it, because that is the face the block is now looking at. */
      const away = centre - mass;
      const towards = Math.abs(away) > 1e-9 ? Math.sign(away) : element.dir;
      return [mass + towards * half(i), centre - towards * (POST_W / 2)];
    }
    const a = at(element.nodeA);
    const b = at(element.nodeB);
    const laid = Math.sign(plan.x[element.nodeB] - plan.x[element.nodeA]) || 1;
    const dir = Math.abs(b - a) > 1e-9 ? Math.sign(b - a) : laid;
    return [a + dir * half(element.nodeA), b - dir * half(element.nodeB)];
  }

  /**
   * How far sideways a block may be carried before it is inside something solid.
   *
   * The bench is a slab with two posts bolted to it and a line of blocks
   * standing on it, and none of those is carried through another: a block pushed
   * at its own wall stops at the wall, and one pushed at its neighbour stops
   * where the spring between them is still drawn as a spring. That is what makes
   * every alignment a hand can reach an alignment the drawing can render - each
   * end of a part has its bearing on the side it is on, so the part has a length
   * and a lean and is never inside out.
   *
   * The stop is the other thing's *face*, less this block's own half, less the
   * margin a part needs to read as a part - the same margin the rig's own room
   * against its walls is measured with.
   *
   * Its own wall is the one stop that is not only a face and a half: it is the
   * apparatus. Every coil and barrel that reaches a post is a length, and a block
   * carried back until they are two lumps crushed into the wall is a block drawn
   * in among its own bearings, so the block stops while each of them still has
   * `ELEMENT_MIN` of its own length left across the bench - at any height the
   * hand has it at, because a part leaning up to a lifted block is a part drawn
   * *over* the post it reaches and not a part with room it can spend.
   *
   * The run's own travel is asked for here and not left to `fitScale`: the model
   * does not stop when a hand does, so the room a stroke is going to need is
   * taken out of the hand's own stop. A block set down beside its wall is a block
   * with no room left to be driven, and it stops that much further out.
   *
   * @param {number} index the mass being carried
   * @param {{x:number,y:number}|null} place where the hand is putting it
   * @returns {{low:number, high:number}} the limits of the block's own placement,
   *   in the offset-from-its-slot coordinates `placeMass` keeps it in
   */
  massBounds(index, place = null) {
    const plan = this._plan;
    if (!plan) return { low: -Infinity, high: Infinity };
    const half = this.blockHalf(this.system.M[index]);
    /* Where the block would stand if the hand let go of it this instant, which is
       where the drawing puts it: its own slot, plus whatever the run has done to
       it since. Every bound below is a bound on the *drawing*, so the run's
       travel is taken out of the room first. The bounds are answered in the
       coordinates a placement is kept in - an offset from the block's own slot. */
    const home = plan.x[index] + this.ride(index);
    const held = Number(place?.x) || 0;
    let low = this.postInner("left") + RAIL_MARGIN + half - home;
    let high = this.postInner("right") - RAIL_MARGIN - half - home;
    for (let j = 0; j < this.system.n; j += 1) {
      if (j === index) continue;
      const reach = half + this.blockHalf(this.system.M[j]) + RAIL_MARGIN;
      const other = this.massX(j);
      /* Which side of this block its neighbour is on is read from the slots, not
         from the hands: the rig is a line, and a hand rearranging it in the
         drawing is not a hand rearranging the model. */
      if (plan.x[j] <= plan.x[index]) low = Math.max(low, other + reach - home);
      else high = Math.min(high, other - reach - home);
    }
    /* And the parts bolted to this block, one at a time, asked of the drawing.

       A part is drawn from the block's own face to the face of whatever holds
       its far end, and a part drawn shorter than `ELEMENT_MIN` across the bench
       is a coil or a barrel crushed into its own bearing - which is the whole of
       what the third picture showed: a block carried back until the spring, the
       dashpot and the post they reach were one lump. So the block stops while
       every part bolted to it still has `ELEMENT_MIN` of bench between the two
       faces.

       Asked of the drawing rather than of each kind of element in turn - the far
       end's face where the drawing has it *now*, and the block's own face where
       the hand is putting it - so that a part reaching a wall, a part reaching
       the next block and a part reaching a lifted block are one question. It is
       also what makes the answer hold at any height: the rise of a lifted block
       is the lean its parts are drawn with, and this asks for the room across the
       bench in every case, so a block carried up and back stops exactly where a
       block carried back does.

       Two passes, because the direction a part reaches *from* is the direction it
       reaches from where the block is going to stand, and where it is going to
       stand is what is being worked out. The first pass is answered from the
       stop the wall and the neighbours have already put on it - the hand's own
       pointer is miles off, since a hand that has dragged a block across the
       bench keeps pulling after the block has stopped - and the second corrects
       the one case where the tightened stop moved the block to the far side of
       one of its own bearings. */
    for (let pass = 0; pass < 2; pass += 1) {
      const candidate = Math.min(Math.max(held, low), high);
      for (const element of this.elements ?? []) {
        if (element.looseA || element.looseB) continue;
        const far = element.nodeA === index ? element.nodeB
          : element.nodeB === index ? element.nodeA : undefined;
        if (far === undefined || far === index) continue;
        const other = far === "g" ? this.postInner(element.side) : this.massX(far);
        const away = other - (home + candidate);
        const towards = Math.abs(away) > 1e-9 ? Math.sign(away)
          : (element.side === "left" ? 1 : -1);
        /* The *face* at that end and not its middle: a part bolted to another
           block stops at that block's own face, two halves inside the room a
           wall's part has. */
        const farX = far === "g" ? other : other - towards * this.blockHalf(this.system.M[far]);
        /* The face of this block that looks at that end, and the offset that
           leaves `ELEMENT_MIN` of part between the two of them. */
        if (towards > 0) high = Math.min(high, farX - half - home - ELEMENT_MIN);
        else low = Math.max(low, farX + half - home + ELEMENT_MIN);
      }
      if (low > high) {
        const middle = (low + high) / 2;
        return { low: middle, high: middle };
      }
    }
    return { low, high };
  }

  /**
   * How high the drive arrow is drawn on one mass, in world y.
   *
   * The arrow belongs in the middle of the block, which is where a force on a
   * mass is drawn - and the middle of the block is where the elements are
   * bolted. An arrow drawn along a coil is read as part of the coil rather than
   * as the force on the block. So the arrow goes in the free band nearest the
   * block's middle: the middle itself when nothing is bolted there, the gap
   * between a spring and its dashpot when that gap is wide enough, and the clear
   * air under the line when the line itself is taken. Nothing is ever drawn
   * below the line - the ground is there - so that last one is always free.
   *
   * The band is chosen against everything bolted to this block on *either* face,
   * so the arrow goes past a coil rather than through it wherever the parts
   * happen to have been left - a band chosen for one face alone is a height the
   * arrow would have to hop to when a spring is retuned onto that face, and a hop
   * is the one thing the picture must not do.
   */
  arrowHeight(index, taken = []) {
    const plan = this._plan;
    const mid = plan.blockY;
    /* What the arrow itself needs, vertically: the head's own height and a
       margin, since the head is the thickest part of it. */
    const needed = this.geometries.arrowHead.parameters.radius * 2 + 0.015;
    const bottom = plan.benchY + needed / 2;
    const top = mid + BLOCK_H / 2 - needed / 2;
    /* What is bolted to this block, as the bands of height it occupies. */
    const bands = [];
    for (const element of this.elements) {
      /* Which of this block's faces an element is on: the one it is bolted to,
         or - for a part that is holding nothing - the one it droops across. An
         element bolted to neither of this block's faces is not in the way. */
      const side = element.loose
        ? (element.looseBoth ? null : element.hang < 0 ? "left" : "right")
        : element.groundAt !== null
          ? (element.groundAt === index ? element.side : null)
          : (element.nodeA === index ? "right" : element.nodeB === index ? "left" : null);
      if (side === null) continue;
      const radius = (element.isSpring ? SPRING_R : DAMPER_R) + 0.008;
      bands.push([mid + element.lane - radius, mid + element.lane + radius]);
    }
    /* And where the other arrows on this face have already been put: a rig with
       two forces on one block has two arrows, and two arrows drawn in the same
       band are one arrow drawn twice. */
    for (const y of taken) bands.push([y - needed / 2 - 0.006, y + needed / 2 + 0.006]);
    bands.sort((a, b) => a[0] - b[0]);
    let best = null;
    let widest = null;
    let cursor = bottom;
    for (const [start, end] of [...bands, [top, top]]) {
      const gapEnd = Math.min(start, top);
      if (gapEnd > cursor) {
        const y = (cursor + gapEnd) / 2;
        const distance = Math.abs(y - mid);
        if (gapEnd - cursor >= needed && (!best || distance < best.distance)) best = { y, distance };
        if (!widest || gapEnd - cursor > widest.width) widest = { y, width: gapEnd - cursor };
      }
      cursor = Math.max(cursor, end);
      if (cursor >= top) break;
    }
    /* The free band nearest the middle, or - if a face is so crowded that no
       band is wide enough - the widest one there is, which is still air rather
       than a coil: an arrow drawn through a spring is read as part of the
       spring, and that is the one thing this height exists to avoid. */
    return (best ?? widest)?.y ?? mid;
  }

  /**
   * Rebuild the whole rig from the model.
   *
   * Called when the model changes - a system chosen, a mass added, a spring
   * retuned from nothing to something - and never per frame. Everything is
   * rebuilt rather than diffed because a rig is a dozen objects and rebuilding
   * it is cheaper than working out what changed, and because a stage that is
   * always built from the model cannot drift from it.
   */
  sync() {
    this.disposeRig();
    const system = this.system;
    const n = system.n;
    const plan = this.layout();
    this._plan = plan;
    const labels = system.labels();
    const elementIndices = system.elementIndices();

    /* ---- the bench: the pale slab the rig stands on, and the squares on it ----
       The same slab and the same faint grid the Dynamics bench stands on. The
       grid is what gives the eye a scale on a stage whose whole subject is how
       far something moved, and both benches read their distances off the same
       kind of ruler. */
    const benchW = (plan.right - plan.left) + 0.46;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(benchW, BENCH_T, BENCH_D), this.materials.floor);
    bench.position.set(plan.centre, plan.benchY - BENCH_T / 2, 0);
    bench.receiveShadow = true;
    this.root.add(bench);
    this.bench = bench;
    {
      const halfX = benchW / 2;
      const halfZ = BENCH_D / 2;
      const lines = [];
      const y = plan.benchY + 0.0015;   // a hair above the slab, or it z-fights
      const nx = Math.floor(halfX / BENCH_GRID);
      const nz = Math.floor(halfZ / BENCH_GRID);
      for (let i = -nx; i <= nx; i++) {
        const x = i * BENCH_GRID;
        lines.push(x, y, -halfZ, x, y, halfZ);
      }
      for (let i = -nz; i <= nz; i++) {
        const z = i * BENCH_GRID;
        lines.push(-halfX, y, z, halfX, y, z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      this.grid = new THREE.LineSegments(geometry, this.materials.grid);
      this.root.add(this.grid);
    }

    /* ---- the posts: the fixed world, at the ends the rig reaches ----
       One short upright per end that something is actually bolted to, and no
       post at an end nothing reaches: a support holding nothing is scenery, and
       this stage is a rig. A post is narrower and taller than any block, which
       is the whole of what keeps it from reading as another mass. */
    const groundSides = new Set();
    for (const element of system.elements) {
      if (element.a !== "g" && element.b !== "g") continue;
      const node = element.a === "g" ? element.b : element.a;
      /* A part bolted to the wall and to nothing else still implies a wall: the
         wall is what it is bolted to, and a wall that is not drawn would be a
         part hanging off the edge of the picture. Which wall is then the
         question the part's own droop answers. */
      const hanging = (element.hang === 1 || element.hang === -1 ? element.hang : -1) < 0 ? "left" : "right";
      groundSides.add(node === null || node === undefined ? hanging : (node < n / 2 ? "left" : "right"));
    }
    this.posts = [];
    for (const side of ["left", "right"]) {
      if (!groundSides.has(side)) continue;
      const group = new THREE.Group();
      const box = new THREE.BoxGeometry(POST_W, POST_H, POST_D);
      const post = new THREE.Mesh(box, this.materials.post);
      post.position.y = POST_H / 2;              // standing on the bench
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.materials.postEdge);
      edges.position.y = POST_H / 2;
      group.add(edges);
      group.position.set(plan[side], plan.benchY - SEAT, 0);
      group.userData = { key: "base", label: "the ground" };
      this.root.add(group);
      this.posts.push({ side, group, home: plan[side] });
    }

    /* ---- the masses ---- */
    this.blocks = [];
    for (let i = 0; i < n; i++) {
      const half = this.blockHalf(system.M[i]);
      const group = new THREE.Group();
      const box = new THREE.Mesh(this.geometries.block, this.materials.mass);
      box.scale.set(half * 2, BLOCK_H, BLOCK_D);
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.geometries.block), this.materials.blockEdge);
      edges.scale.copy(box.scale);
      group.add(edges);
      /* The mass's name is written *in* the block, in the light ink the rails use
         for text on a dark panel, and the light body of it is why: the figures
         letter their blocks the same way, and a row of blocks labelled m1, m2, m3
         is read at a glance where a row of blocks with labels floating over them
         is not. The kilograms are on the rail, where they can be read exactly. */
      const name = labelSprite(labels.masses[i], "#E8E7EF", 0.050);
      group.add(name);
      group.position.set(plan.x[i], plan.blockY - SEAT, 0);
      group.userData = { key: "mass", index: i, label: labels.masses[i] };
      this.root.add(group);
      this.blocks.push({ group, box, edges, half, name });
    }

    /* ---- the elements ---- */
    /* Every element is drawn between the same two nodes the model joins, and an
       element to the ground is drawn reaching to the nearer post. Two elements on
       the same pair get two lanes - one on the line and one above it, exactly as
       the quarter-car figure draws a suspension - so a pair that is both sprung
       and damped is legible as both. */
    /* Which lane each element is drawn in: on the axis when it is the only thing
       joining its two nodes, and above or below it when it has a partner. The
       pair is worked out once here rather than inside the loop, because "does
       this pair already have something on it" is a question about the whole
       model and not about the element being drawn. */
    const keyOf = (e) => {
      const a = String(e.a);
      const b = String(e.b);
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    };
    const byPair = new Map();
    system.elements.forEach((e, i) => {
      const key = keyOf(e);
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(i);
    });
    const laneOf = new Map();
    for (const list of byPair.values()) {
      if (list.length === 1) { laneOf.set(list[0], 0); continue; }
      /* Springs first, so a sprung and damped pair is drawn with the spring above
         the line - which is how the quarter-car figure draws a suspension, and
         what an eye checking the drawing against the page expects to see. */
      const ordered = [...list].sort((a, b) => (system.elements[a].kind === "spring" ? 0 : 1)
        - (system.elements[b].kind === "spring" ? 0 : 1));
      ordered.forEach((index, k) => laneOf.set(index, LANE[k % LANE.length]));
    }
    this.laneOf = laneOf;

    this.elements = [];
    for (let index = 0; index < system.elements.length; index++) {
      const element = system.elements[index];
      const meta = elementIndices[index];
      const isSpring = element.kind === "spring";
      const nodeA = element.a;
      const nodeB = element.b;
      const looseA = nodeA === null || nodeA === undefined;
      const looseB = nodeB === null || nodeB === undefined;
      const isLoose = looseA || looseB;

      /* Which node is the ground, and which wall it reaches: the nearer one, so
         a rig's elements are drawn reaching outward rather than criss-crossing. */
      const groundAt = isLoose ? null : nodeB === "g" ? nodeA : nodeA === "g" ? nodeB : null;
      const side = groundAt === null ? null
        : groundAt < n / 2 ? "left" : "right";
      const lane = laneOf.get(index) ?? 0;
      /* Which way a part with an end in the air droops. A part written a -> b
         hangs off its *first* end towards the right and off its second towards
         the left, which is the way the chain itself is written and the way the
         wall it came off stands. A hand that drags it somewhere else says so by
         writing the number. */
      const hang = element.hang === 1 || element.hang === -1 ? element.hang : (looseA ? 1 : -1);

      const sprite = labelSprite(
        `${isSpring ? "k" : "c"}${meta.index + 1}`,
        isLoose ? "#A9A7B4" : "#8A8794",
        0.038,
      );
      /* A part that is holding nothing is drawn in the grey of the ground's own
         motion rather than in the chrome of the rig: it is on the bench, and it
         is not in the system, and the two have to be told apart at a glance. */
      const material = isLoose ? this.materials.muted : this.materials.chrome;
      const mesh = isSpring
        ? new THREE.Mesh(this.geometries.spring, material)
        : damperGroup(material);

      /* Where each end of the element is attached, which is the *face* of the
         block it is bolted to and not its middle: a spring drawn from a block's
         centre disappears inside it, and "the mass it is attached to" is the one
         thing about a spring's bearings that has to be readable. A grounded
         element reaches to the inner face of the wall it is anchored to, for the
         same reason - an element poking into its own bearing reads as a mistake.

         The nominal length is what the element spans with the rig at rest, which
         is the length its geometry is built for, so at rest nothing is stretched
         and every stretch afterwards is a deflection. A part with an end in the
         air has one length whatever the rig does: it is bolted to one thing and
         is not being stretched by anything. */
      const outerX = groundAt === null ? null : this.postInner(side);
      this.wallShift = 0;
      const [ax, bx] = this.elementSpan(
        {
          index, nodeA, nodeB, groundAt, loose: isLoose, looseA, looseB, looseBoth: looseA && looseB,
          hang, stub: element.stub, outerX, dir: groundAt === null ? null : (side === "left" ? -1 : 1),
        },
        (i) => plan.x[i],
      );
      const nominal = Math.max(0.12, Math.abs(bx - ax));

      if (isSpring) {
        /* The shared unit coil is scaled to the span, which squashes the turns
           rather than rebuilding them - and a coil that visibly compresses is
           the point of drawing a spring at all. */
        mesh.scale.x = nominal;
      }
      /* The piece the pointer finds this element by: an invisible cylinder
         along the element's whole span, so the spring or dashpot is picked by
         pointing anywhere at it rather than by threading the ray through the
         gap between two turns of a coil. */
      const pickMesh = new THREE.Mesh(this.geometries.pick, this.materials.pick);
      pickMesh.scale.x = nominal;

      /* The outline the part wears while it is the picked one: a box's own edges,
         drawn round the space the part occupies. Hidden until it is picked. */
      const border = borderGroup(this.materials.chosenEdge, this.materials.chosenEdgeSoft);

      const holder = new THREE.Group();
      holder.add(mesh);
      holder.add(pickMesh);
      holder.add(sprite);
      holder.add(border);
      holder.userData = { key: "element", index };
      this.root.add(holder);

      this.elements.push({
        index, kind: element.kind, isSpring, nodeA, nodeB, groundAt, side, lane,
        looseA, looseB, loose: isLoose, looseBoth: looseA && looseB, hang,
        /* How far a loose end still reaches, when a block was carried out from
           under the part: the length and direction it already had, so the part is
           drawn exactly where it was and only the connection is gone. */
        stub: element.stub,
        holder, mesh, pickMesh, sprite, border, nominal, outerX,
        dir: groundAt === null ? null : (side === "left" ? -1 : 1),
        baseMaterial: material,
      });
    }
    /* Which wall the base shakes: the one the most ground elements reach, which
       is the one an arrow drawn on it is actually about. */
    let leftGround = 0, rightGround = 0;
    for (const element of this.elements) {
      if (element.groundAt === null) continue;
      if (element.side === "left") leftGround++; else rightGround++;
    }
    this.baseSide = leftGround >= rightGround ? "left" : "right";

    /* ---- the drives: one force arrow per force on the bench ----
       Labelled with the letter a figure uses for an applied force, in the same
       amber the arrow itself is drawn in: a force is an input, and an input is
       never drawn in this bench's violet, which means "this is the one you have
       hold of" and nothing else. A rig with a shaker on each of two masses gets
       two arrows, told apart by their own letters - which is the whole reason
       the second one is lettered at all. */
    this.drives = [];
    system.spec.drives.forEach((drive, index) => {
      const group = new THREE.Group();
      const shaft = new THREE.Mesh(this.geometries.bar, this.materials.force);
      const head = new THREE.Mesh(this.geometries.arrowHead, this.materials.force);
      const border = borderGroup(this.materials.chosenEdge, this.materials.chosenEdgeSoft);
      group.add(shaft, head, border);
      /* Lettered in the force's own amber, the same colour the arrow is drawn
         in: a force is an input, and this bench's violet is the colour of the
         *live* thing - the outline of whatever is picked - so an input drawn in
         it would be an input that always looks picked. */
      const text = index === 0 ? "f" : `f${subscript(index + 1)}`;
      const label = labelSprite(text, "#D98324", 0.055);
      group.add(label);
      group.userData = {
        key: "drive",
        index,
        label: index === 0 ? "the drive" : `Force ${index + 1}`,
      };
      this.root.add(group);
      this.drives.push({ index, text, group, shaft, head, label, border, baseMaterial: this.materials.force });
    });

    /* ---- the base: what the ground is doing ---- */
    this.baseArrow = new THREE.Group();
    const baseShaft = new THREE.Mesh(this.geometries.bar, this.materials.muted);
    const baseHead = new THREE.Mesh(this.geometries.arrowHead, this.materials.muted);
    const baseBorder = borderGroup(this.materials.chosenEdge, this.materials.chosenEdgeSoft);
    this.baseArrow.add(baseShaft, baseHead, baseBorder);
    const baseLabel = labelSprite("y\u2080", "#6D6C78", 0.045);
    this.baseArrow.add(baseLabel);
    this.baseArrow.userData = { key: "base", label: "the ground" };
    this.root.add(this.baseArrow);
    this.baseParts = { shaft: baseShaft, head: baseHead, label: baseLabel, border: baseBorder };

    /* ---- the probe: the instrument that says which mass is the output ----
       A little accelerometer clipped to the block it reads: a foot, a body and a
       lamp, sized to the block rather than to the stage, because an instrument
       bigger than the thing it measures reads as part of the machine. */
    this.probe = new THREE.Group();
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.026, 12), this.materials.probe);
    foot.position.y = -0.013;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.042, 0.052), this.materials.probe);
    body.position.y = 0.021;
    body.castShadow = true;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), this.materials.accent);
    lamp.position.y = 0.047;
    /* The instrument's outline, sized to the instrument: its own foot, body and
       lamp, and nothing else - a picked instrument wears the extent of the
       instrument, never a frame around the space it stands in. */
    const probeBorder = borderGroup(this.materials.chosenEdge, this.materials.chosenEdgeSoft);
    probeBorder.position.set(0, PROBE_MID, 0);
    probeBorder.scale.set(
      PROBE_HALF_X + borderPad(PROBE_HALF_X),
      PROBE_HALF_Y + borderPad(PROBE_HALF_Y),
      PROBE_HALF_Z + borderPad(PROBE_HALF_Z),
    );
    this.probe.add(foot, body, lamp, probeBorder);
    this.probeBorder = probeBorder;
    this.probe.userData = { key: "probe", label: "the probe" };
    this.root.add(this.probe);

    /* The extent the camera is framed on, measured from the rig rather than
       guessed: the bench sets the width, the walls and the instrument standing
       on the blocks set the height, and the frame keeps an air gap around all of
       it. */
    const bottom = plan.benchY - BENCH_T - 0.10;      // the slab's own thickness
    const top = Math.max(
      plan.benchY + POST_H,
      plan.blockY + LANE_OFFSET + 0.22,
      plan.blockTop + 0.20,                           // the probe standing on a block
    );
    this.centreY = (bottom + top) / 2;
    this.width = (plan.right - plan.left) + 0.44 + 2 * POST_W;
    this.height = (top - bottom) + FRAME_PAD;
    this.haveRig = true;
    /* The rig has been rebuilt, so whatever was picked is a new object and has to
       be told it is picked again: a mass slider that rebuilt the stage would
       otherwise drop the selection every time the reader touched it. */
    this.setSelected(this.selected);
    /* And every placement is put past the bench's own stops again, against the
       rig that has just been built and not the one it replaced.

       A placement is restored from a session before this runs - a session can
       come back from a bench that held a block past its own post, and a rig whose
       parts have been retuned has different faces for a block to stop short of -
       so the stops are asked for once more here, in the one place every rebuild
       goes through. A block that the floor or the wall would refuse is moved back
       to where it can be drawn rather than thrown away: what the reader put down
       is still on the bench, and the bench has the last word on where. */
    for (const [index, place] of this.stage) this.stage.set(index, this.clampPlacement(index, place));
    return this;
  }

  disposeRig() {
    if (!this.haveRig) return;
    for (const child of [...this.root.children]) {
      /* The rule on the bench's front edge is not part of the rig. It is built
         once, when the bench is, and a rig rebuilt around it has no business
         taking it to pieces: its plate and its buffers are the same objects for
         every rig this bench can hold, and a rule whose sprites had just been
         disposed would come back as a blank band on the bench. */
      if (child === this.rule?.group) continue;
      this.root.remove(child);
      child.traverse?.((node) => {
        if (node.isSprite) {
          node.material.map = null;
          node.material.dispose();
        }
        if (node.geometry && node.geometry !== this.geometries.spring
          && node.geometry !== this.geometries.block && node.geometry !== this.geometries.bar
          && node.geometry !== this.geometries.pick
          && node.geometry !== OUTLINE.near && node.geometry !== OUTLINE.far
          && node.geometry !== this.geometries.arrowHead) {
          node.geometry.dispose();
        }
      });
    }
    this.haveRig = false;
  }

  /* ----------------------------------------------------------------------------
     DRAWING ONE FRAME
     ---------------------------------------------------------------------------- */

  setMotionScale(scale) {
    this.motionScale = Math.max(0.1, Math.min(200, Number(scale) || 1));
    return this;
  }

  setLabels(on) {
    this.labels = !!on;
    return this;
  }

  /** Put the accelerometer on the bench, or take it off it. */
  setProbeVisible(on) {
    this.probeOn = !!on;
    return this;
  }

  /* There is deliberately no "bring this part into view" here. There was one,
     and picking a part swung the camera onto it - which is a stage that moves
     under the hand that is trying to look at something. Picking something is a
     statement about the *thing*, not about the view: the rails light the row, the
     stage lights the outline, and the camera is the reader's and nobody else's.
     What re-frames the rig is framing the rig - a system chosen, a page opened,
     a resize - and a double-click puts the view back by hand. */

  /**
   * Say which part is the picked one, so the stage shows it in the accent.
   *
   * A picked block swaps its own outline for the accent one, a picked element
   * and a picked force are drawn in the accent itself, and the probe grows. It is
   * the same statement the rails make in ink - "this is the one the panel is
   * about" - made on the stage, so the panel and the picture cannot disagree.
   */
  setSelected(selected) {
    this.selected = selected ?? null;
    if (!this.blocks || !this.elements) return this;
    /* A selected block is a block whose own outline has changed colour. Not a
       ring hung around it: a ring drawn about a box is a circle about a box, and
       on a stage that is otherwise four colours and a grid it reads as something
       that has been added to the picture rather than as the picking of
       something already in it. The outline is the block's own edge, lit in the
       accent - the same "this is the one you have hold of" the rails say in ink. */
    for (let i = 0; i < this.blocks.length; i++) {
      const on = !!this.selected && this.selected.key === "mass" && this.selected.index === i;
      this.blocks[i].edges.material = on ? this.materials.chosenEdge : this.materials.blockEdge;
    }
    /* Everything else that is picked is *outlined* in the accent, never filled
       with it. A spring or a dashpot drawn in the selection colour is a spring
       whose own material has been replaced, which is the one thing this stage's
       colours mean nothing by: chrome is a part, the accent is a state. So a
       picked part keeps every one of its own materials and gains a border - a
       box's edges round the space it occupies, in the accent. */
    for (const element of this.elements) {
      const on = !!this.selected && this.selected.key === "element" && this.selected.index === element.index;
      const material = element.baseMaterial;
      element.mesh.traverse?.((node) => { if (node.isMesh) node.material = material; });
      this.borderOn(element.border, on);
    }
    /* A force that is picked is outlined in the accent like everything else, and
       the force's own amber is never swapped for it: a force is an input, and an
       input drawn in the selection colour would look picked all the time. A force
       that is not bolted to anything is drawn in the ground's grey - and the
       outline is what says it is picked, so picking a loose part does not
       pretend it is part of the rig. */
    for (const arrow of this.drives ?? []) {
      const loose = (this.system.spec.drives[arrow.index]?.mass ?? null) === null;
      const material = loose ? this.materials.muted : this.materials.force;
      arrow.shaft.material = material;
      arrow.head.material = material;
      const on = !!this.selected && this.selected.key === "drive" && this.selected.index === arrow.index;
      this.borderOn(arrow.border, on);
    }
    /* The ground is an instrument on this bench - it is what shakes the rig - and
       the probe is another, so both wear an outline of their own size while they
       are the picked one, exactly as a spring, a dashpot and a force do. */
    this.borderOn(this.baseParts?.border, !!this.selected && this.selected.key === "base");
    this.borderOn(this.probeBorder, !!this.selected && this.selected.key === "probe");
    return this;
  }

  /**
   * Turn one part's own outline on or off: the border that says "this is the one
   * the panel is about".
   *
   * Only the visibility is set here. The border's own size is worked out in
   * update(), from the part as it is drawn that frame - a spring stretches, and a
   * border that was sized once would be the wrong size a moment later. */
  borderOn(border, on) {
    if (border) border.visible = !!on;
  }


  /**
   * The bench's own notes about the rig: the things it is holding that are not
   * holding anything.
   *
   * A part with an end in the air is drawn drooping, in the ground's grey, and
   * that is the picture. This is the sentence that says what the picture means -
   * "k3 is not connected to anything", "the drive on m1 is not connected" - and
   * it is the one thing a reader cannot work out from a drawing: whether a part
   * that looks loose is loose, or whether the stage has simply been turned.
   *
   * @returns {{key:string, index:number, what:string, where:string}[]}
   */
  looseNotes() {
    const notes = [];
    const labels = this.system.labels();
    const indices = this.system.elementIndices();
    this.system.elements.forEach((element, index) => {
      const looseA = element.a === null || element.a === undefined;
      const looseB = element.b === null || element.b === undefined;
      if (!looseA && !looseB) return;
      const meta = indices[index] ?? { kind: element.kind, index: 0 };
      const name = `${element.kind === "spring" ? "k" : "c"}${subscript(meta.index + 1)}`;
      const held = looseA ? element.b : element.a;
      const where = held === null || held === undefined
        ? "either end"
        : held === "g" ? "the ground" : labels.masses[held] ?? "a mass";
      notes.push({
        key: "element",
        index,
        what: `${name} is not connected to anything`,
        where: looseA && looseB ? "at either end" : `at the ${looseA ? "left" : "right"} end`,
        held: `still holding ${where}`,
      });
    });
    this.system.spec.drives.forEach((drive, index) => {
      if (drive.mass !== null && drive.mass !== undefined) return;
      notes.push({
        key: "drive",
        index,
        what: index === 0 ? "The drive is not connected to anything" : `Force ${index + 1} is not connected to anything`,
        where: "no mass",
        held: "pushing nothing",
      });
    });
    return notes;
  }

  /**
   * Where everything is, right now.
   *
   * Read from the system's state and nothing else: the blocks are at their
   * displacements scaled by the drawing's own magnification, the walls are where
   * the base has put them, and every element is stretched between the two nodes
   * it joins. A frame in which nothing moved produces the same picture, which is
   * what makes the picture a measurement.
   */
  update() {
    if (!this.haveRig) return this;
    const system = this.system;
    const plan = this._plan;
    /* Whether the reader's magnification fits the bench is a question about this
       frame's own state, so it is answered here, once, before anything is put
       anywhere. */
    this.drawnScale = this.fitScale();
    const scale = this.drawnScale;
    const state = system.state;
    const n = system.n;

    /* The ground's own position, if it is being shaken: the same magnification as
       the masses, because it is the same picture. The bench moves with it,
       because the bench is the ground - a shake table takes the floor with it,
       which is why the blocks appear to slide along a floor that is moving under
       them rather than to sit still on a floor that is not. */
    let groundShift = 0;
    const baseIndex = system.activeInputs?.find((input) => input.kind === "base")?.index;
    if (baseIndex !== undefined && baseIndex !== null) groundShift = state[baseIndex] * scale;
    const wallShift = groundShift;

    this.wallShift = wallShift;
    for (const post of this.posts) post.group.position.x = post.home + wallShift;
    if (this.bench) this.bench.position.x = plan.centre + wallShift;
    if (this.grid) this.grid.position.x = wallShift;

    for (let i = 0; i < n; i++) {
      const block = this.blocks[i];
      const place = this.stage.get(i);
      /* Where the rig puts the block, plus where a hand put it: a placement is
         drawn in both directions, because a bench is a floor and not an axis. */
      block.group.position.x = plan.x[i] + this.ride(i) + (place?.x ?? 0);
      block.group.position.y = plan.blockY - SEAT + this.massLift(i);
      block.name.visible = this.labels;
    }

    /* Where a mass is standing right now, which is what every element's own
       bearings are read from - the *placed* position, so a part dragged onto a
       block lands on the block where it actually is. */
    const at = (i) => this.massX(i);
    for (const element of this.elements) {
      /* The same two attachment points sync() laid the drawing out from, moved by
         where the rig is now: a block's *face* is where its spring is bolted, so
         the element lengthens by as much as the two faces separate. A part with
         an end in the air keeps the reach it was given and swings its loose end
         down - which is what a spring that has come off one of its bearings
         does, and what tells the eye it is not carrying anything. */
      const [x0, x1] = this.elementSpan(element, at);
      const span = Math.max(0.02, Math.abs(x1 - x0));
      const radius = this.elementRadius(element);
      const [lift0, lift1] = this.elementLifts(element);
      const laneY = plan.blockY + element.lane;
      const y0 = laneY + lift0;
      const y1 = laneY + lift1;
      /* Where the part's held end is, how long the part is drawn, and at what
         angle: the three numbers its own border and its own grips are built
         from as well as its mesh, so nothing about a part can disagree with the
         part. The angle is measured from the held end, which is the end the
         holder is pinned to. */
      let anchorX = x0;
      let anchorY = y0;
      let length = span;
      let angle = 0;
      if (element.looseBoth) {
        /* Bolted to nothing at either end: a spare part lying on the bench in
           the near lane - in *front* of the rig rather than in it, which is
           where a part that has been taken off belongs - at the height the hand
           left it at. */
        const place = this.partPlace("element", element.index);
        anchorX = place.x;
        anchorY = plan.benchY + radius + SEAT + place.y;
        length = LOOSE_STUB;
        angle = 0;
        element.holder.position.set(anchorX, anchorY, LOOSE_Z);
        element.holder.rotation.set(0, 0, 0);
      } else if (element.loose) {
        /* A part holding nothing is drawn from the end it does hold: the loose
           end swings *down* from it - a rotation of the whole part about the
           bearing, which is what a spring that has come off one end does - or,
           for one a hand has just carried, reaches exactly as far as the hand
           put it and lies level, which is what the hand means by "there". */
        const dir = x1 >= x0 ? 1 : -1;
        const stubbed = Number.isFinite(element.stub) && element.stub !== 0;
        element.holder.position.set(anchorX, anchorY, RIG_Z);
        element.holder.rotation.set(0, dir > 0 ? 0 : Math.PI, stubbed ? 0 : -LOOSE_TILT);
        angle = stubbed ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -LOOSE_TILT : Math.PI + LOOSE_TILT);
        length = span;
      } else {
        /* Bolted at both ends: drawn between the two faces it meets, and as long
           as the gap between them. That is what makes a block that has been
           carried up and sideways take its springs *with* it - the part leans to
           follow the face, which is a rig laid out rather than a rig come
           apart.

           It is drawn from its *left-hand* end whatever order the model holds
           its ends in, because a part drawn from the right end is a part turned
           half a turn about its own axis, and a gland one way round and the
           other are two different-looking dashpots. */
        const leftmost = x0 <= x1;
        anchorX = leftmost ? x0 : x1;
        anchorY = leftmost ? y0 : y1;
        length = Math.hypot(x1 - x0, y1 - y0);
        angle = leftmost ? Math.atan2(y1 - y0, x1 - x0) : Math.atan2(y0 - y1, x0 - x1);
        /* Both ends are buried a little way inside the block or the post they are
           bolted to.

           The two faces a part joins are both across the picture - a block's face
           and a post's face are vertical - while the part leans between them, and
           the flat end of a leaning coil or barrel meets a vertical face on an
           edge: it touches at one corner and leaves a sliver of daylight at the
           other, which reads as a part bolted to nothing. A part drawn a
           diameter's worth long at each end is inside the thing it is bolted to
           instead of resting against it, so its cap is never seen at all - and
           both faces are solid, so nothing of it can be seen to come out the far
           side of either.

           Four tenths over one radius again is the lean of half a right angle: a
           part buried by `r/cos - r tan` of itself meets the face square out to
           fifty degrees or so, which is every lean a rig on this bench is put
           into. It is held short of the post's own thickness, so a leaning part
           is never seen coming out of the far side of the wall it is bolted to. */
        const bury = Math.min(this.elementRadius(element) * 1.4, POST_W * 0.75, length * 0.25);
        anchorX -= Math.cos(angle) * bury;
        anchorY -= Math.sin(angle) * bury;
        length += bury * 2;
        element.holder.position.set(anchorX, anchorY, RIG_Z);
        element.holder.rotation.set(0, 0, angle);
      }
      element.mesh.scale.x = length;
      element.pickMesh.scale.x = length;
      element.sprite.position.set(length / 2, laneLabelOffset(element), 0);
      element.sprite.visible = this.labels;
      /* The outline, sized to the part as it is drawn this frame and to the part
         *alone*: a coil stretches, and a border sized once would be the wrong
         size a moment later - but a border drawn to the width of the lane rather
         than to the width of the coil is a frame hung round the part rather than
         an outline of it. */
      if (element.border?.visible) {
        element.border.scale.set(
          length / 2 + borderPad(length / 2),
          radius + borderPad(radius),
          radius + borderPad(radius),
        );
        element.border.position.set(length / 2, 0, 0);
      }
    }

    /* The force arrows: each one stands in the gap on the left-hand face of the
       block its drive is bolted to, pointing at that block, for as long as the
       drive is on. There is no arrow at all when nothing is pushing, and a blow's
       arrow goes once the blow has landed. */
    /* Which bands of which face the arrows have already taken, so a second
       force on the same block is drawn beside the first rather than over it. */
    const usedHeights = new Map();
    for (const arrow of this.drives) {
      const spec = system.spec.drives[arrow.index] ?? {};
      const unattached = spec.mass === null || spec.mass === undefined;
      /* An attached force is drawn in the force's own amber and never in the
         accent: this bench's violet is the colour of the thing you have hold of,
         so an input drawn in it would be an input that looks picked forever. */
      const material = unattached ? this.materials.muted : this.materials.force;
      arrow.shaft.material = material;
      arrow.head.material = material;
      if (unattached) {
        /* A force that is bolted to nothing: a shaker standing on the bench,
           pushing air, in the ground's own grey rather than the amber - it is on
           the bench, it is not in the rig, and the two have to be told apart at
           a glance. It stands where the hand put it, in the near lane with the
           spare parts, and it is short because there is no force to draw: an
           arrow the length of a real push would be a picture of a push that is
           not happening. */
        const place = this.partPlace("drive", arrow.index);
        const headHalf = this.geometries.arrowHead.parameters.height / 2;
        const headR = this.geometries.arrowHead.parameters.radius;
        const short = 0.16;
        const centre = (short + headHalf) / 2;
        arrow.group.visible = true;
        /* Level, because a shaker bolted to nothing is bolted to no rail either: a
           lean left over from the block this force was last on would be a tilt
           with nothing under it. */
        arrow.group.rotation.set(0, 0, 0);
        arrow.group.position.set(place.x, plan.benchY + headR + SEAT + place.y, LOOSE_Z);
        /* Full thickness, and its own length: a shaker standing on the bench is
           drawn once, at its own size, whatever the force on a block is drawn
           at. */
        arrow.shaft.scale.set(short, 1, 1);
        arrow.head.position.x = short;
        arrow.head.scale.setScalar(1);
        /* The letter sits just behind the tail, level with the arrow's own
           axis, so it reads as the name of the arrow rather than as a mark
           floating above it. */
        arrow.label.position.set(-(headR + 0.024), 0, 0);
        arrow.label.visible = this.labels;
        arrow.label.material.opacity = 1;
        if (arrow.border?.visible) {
          arrow.border.scale.set(
            centre + borderPad(centre),
            headR + borderPad(headR),
            headR + borderPad(headR),
          );
          arrow.border.position.set(centre, 0, 0);
        }
        continue;
      }
      const input = system.activeInputs?.find((entry) => entry.kind === "force" && entry.drive === arrow.index);
      const waveform = spec.waveform ?? "sine";
      /* A force that is switched off has no arrow: there is nothing pushing.

         A *blow* is the one waveform with no generator in the state at all - it
         is a velocity handed over at the start of the run and not a force that
         persists - so it is not an active input and it is drawn from what the
         drive says it is. And it is drawn only for the instant it lands: once the
         run has begun there is nothing left of it but the speed it left behind,
         so the arrow is taken off the stage. */
      if (!input && waveform !== "impulse") { arrow.group.visible = false; continue; }
      if (waveform === "impulse" && system.time > 0) { arrow.group.visible = false; continue; }
      const j = spec.mass;
      const blockHalf = this.blocks[j].half;
      /* The middle of the block it is applied to, wherever the block *is*: a
         force dragged onto a block a hand has moved is applied there. */
      const centre = this.massX(j);
      const lift = this.massLift(j);
      /* The arrow says two things and only two: *where* the force is applied and
         *which way it pushes*.

         So it is drawn the way a figure draws a push, and it is drawn there for
         as long as the drive is on: standing in the gap on the block's left-hand
         face, at its full size, with its point on that face - one station, one
         direction, no turning over. A reader who wants the newtons has the panel,
         which prints the force the drive is applying at this instant, signed, and
         which says underneath it which waveform it is: a step is one push
         switched on and left on, a sine swings through nothing and back twice a
         cycle, and a blow lands once at the start. An arrow that flicked from one
         face of the block to the other twice a cycle was a picture of that
         alternation drawn *over* the one thing the arrow is for, and it read as a
         force pointing the wrong way. */
      const tip = this.geometries.arrowHead.parameters.height / 2;
      /* The line the arrow stands on: the block's own bearings.

         A block carried up and sideways is held by the springs and dashpots that
         reach it, and they are drawn leaning from the things they are bolted to
         up to its faces - so the arrow lies along the same line, at the same
         angle, and the three of them read as one rig. This is the line the model
         itself was put on: a mass on a ramp runs along the ramp, and a push on
         that mass is drawn along it too. A block in its own slot has no lean in
         it at all, so this is the flat rail and the arrow is drawn exactly as it
         always was. */
      const lean = this.bearingLine(j) ?? RAIL_FLAT;
      /* Where the point of the arrow stands: on the block's left-hand face, in
         the band this arrow has been given. */
      const face = centre - blockHalf;
      /* How much gap there is on that face, and a whole arrow squeezed into it.

         The arrow is part of the rig, so it is drawn *inside* the rig: a block
         driven hard into its own ground support would otherwise wear an arrow
         standing out through the wall behind it. What gives way is its size and
         never its point - the point stays on the face the force is applied to, at
         whatever size, which is the one thing about this arrow a reader reads.

         Measured *along the arrow's own line* and not across the bench, because
         the arrow leans with the rig: given the horizontal gap instead, a
         leaning arrow would be allowed to reach further back than the wall it is
         drawn beside. `gap / lean.x` is exactly the length of the part the arrow
         is drawn beside, so the two are the same size on the stage - and the gap
         is never nothing, since a block is stopped clear of its own wall before
         its apparatus runs out (see `massBounds`). */
      const room = lean.x > 1e-6 ? Math.max(0, face - this.postInner("left")) / lean.x : Infinity;
      const squeeze = Math.max(0.35, Math.min(1, room / (ARROW_LENGTH + tip)));
      const length = ARROW_LENGTH * squeeze;
      const reach = length + tip * squeeze;
      /* Its height is worked out from what is bolted to this block on either
         face, so the arrow goes *past* the spring rather than through it and
         stays in one band on one face for the whole run. */
      const taken = usedHeights.get(j) ?? [];
      const y = this.arrowHeight(j, taken) + lift;
      taken.push(y);
      usedHeights.set(j, taken);
      arrow.group.visible = true;
      /* Tipped up by the lean of the rail, and turned by nothing else: the coil
         and the dashpot reaching this face are drawn at this same angle, so the
         arrow is drawn at it too rather than lying flat beside a ramp. The
         letter rides in the group, so it goes where the arrow goes. */
      arrow.group.rotation.set(0, 0, Math.atan2(lean.y, lean.x));
      /* With the point on the face at the band's own height, the *tail* stands
         `reach` back down the arrow's own line, which is where the arrow's length
         goes when the arrow is not level. Flat, this is the old placement to the
         millimetre. */
      arrow.group.position.set(face - reach * lean.x, y - reach * lean.y, RIG_Z);
      arrow.shaft.scale.set(length, squeeze, squeeze);
      arrow.head.position.x = length;
      arrow.head.scale.setScalar(squeeze);
      const headR = this.geometries.arrowHead.parameters.radius * squeeze;
      /* The letter sits just behind the tail, level with the arrow's own axis, so
         the two read as one thing: the push comes from the tail and that is where
         the name goes. */
      arrow.label.position.set(-0.05, 0, 0);
      arrow.label.visible = this.labels;
      arrow.label.material.opacity = 1;
      /* The outline, at the arrow's own size: as long as the arrow is and as
         thick as its own head, which is the whole of what an arrow is. */
      const arrowCentre = reach / 2;
      if (arrow.border?.visible) {
        arrow.border.scale.set(
          arrowCentre + borderPad(arrowCentre),
          headR + borderPad(headR),
          headR + borderPad(headR),
        );
        arrow.border.position.set(arrowCentre, 0, 0);
      }
    }

    /* The base arrow, drawn on whichever wall the rig actually reaches: it is
       the ground that is being shaken, and the ground is a wall here. */
    const base = system.activeInputs?.find((input) => input.kind === "base");
    if (base && this.posts.length) {
      const wall = this.posts.find((w) => w.side === this.baseSide) ?? this.posts[0];
      /* How far the ground is displaced right now, as the length of the arrow.

         This is the one arrow on the stage that is read for *how much* rather
         than *which way*: a shake table is a table whichever way it is going, so
         its arrow never turns round - turning it round was tried, and a table
         whose arrow flipped every half cycle read as a table that had changed
         its mind, and worse, as one slaved to whatever the force arrow was
         doing. It stays at the wall pointing back at the bearings the table
         shakes, and it reaches further down its own band the further the table
         is from its rest position, which is the ground's displacement drawn to
         scale - the same thing the panel prints in millimetres. */
      const displacement = state[base.index];
      const reference = Math.max(Math.abs(system.spec.base.amplitude), 1e-9);
      const length = BASE_ARROW_LENGTH
        + BASE_ARROW_REACH * Math.min(1, Math.abs(displacement) / reference);
      /* The ground pushes the rig at the one place it touches it: the face of the
         wall the springs and dashpots are bolted to. So that is where the arrow
         is - outboard of the wall, level with the middle of what is bolted
         there, pointing back at the bearings it is shaking. It travels with the
         wall, so the one thing a shake table does is drawn: the whole world
         slides, and this is the hand that slides it. */
      const outward = wall.side === "left" ? -1 : 1;
      let laneSum = 0;
      let laneCount = 0;
      for (const element of this.elements) {
        if (element.groundAt === null || element.side !== wall.side) continue;
        laneSum += element.lane;
        laneCount++;
      }
      const y = plan.blockY + (laneCount ? laneSum / laneCount : 0);
      const tip = this.geometries.arrowHead.parameters.height / 2;
      this.baseArrow.visible = true;
      this.baseArrow.rotation.y = outward < 0 ? 0 : Math.PI;   // always at the wall
      this.baseArrow.position.set(
        wall.group.position.x + outward * (POST_W / 2 + length + tip),
        y,
        RIG_Z,
      );
      this.baseParts.shaft.scale.x = length;
      this.baseParts.head.position.x = length;
      this.baseParts.label.position.set(length / 2, 0.064, 0);
      this.baseParts.label.visible = this.labels;
      /* The shake table's own arrow wears an outline of its own size too: it is
         an instrument on this bench and it is picked like one. */
      const baseHeadHalf = this.geometries.arrowHead.parameters.height / 2;
      const baseHeadR = this.geometries.arrowHead.parameters.radius;
      const baseCentre = (length + baseHeadHalf) / 2;
      if (this.baseParts.border?.visible) {
        this.baseParts.border.scale.set(
          baseCentre + borderPad(baseCentre),
          baseHeadR + borderPad(baseHeadR),
          baseHeadR + borderPad(baseHeadR),
        );
        this.baseParts.border.position.set(baseCentre, 0, 0);
      }
    } else {
      this.baseArrow.visible = false;
    }

    /* The probe stands over the mass it measures - up on top of the block, which
       is where an accelerometer is clipped - plus wherever a hand has moved it,
       which is the same freedom every other thing on this bench has. */
    const out = system.spec.output;
    const probePlace = this.partPlace("probe");
    this.probe.position.set(
      this.massX(out) + probePlace.x,
      plan.blockTop + this.massLift(out) + probePlace.y,
      0,
    );
    this.probe.visible = this.probeOn;

    this.updateRule();
    return this;
  }

  /**
   * Graduate the bench's own rule, in the reader's millimetres.
   *
   * The zero stands under the first mass's station and the graduations run out
   * either way from it, drawn at the magnification the *motion* is being drawn
   * at: so the number standing under a block is that block's displacement from
   * its own rest position, in the millimetres the rail prints - the picture and
   * the rail are one reading rather than two. Every other mass's station is
   * marked as well, because a rig of three masses is three displacements and one
   * rule has to serve them all: what a reader reads under a block, less that
   * block's own mark, is that block's own number.
   *
   * The step is chosen rather than written down, and chosen from where the
   * picture is *drawn* rather than from what the model says: a rule marked off in
   * millimetres is a wall of ticks at a tenth of life size, and a rule whose
   * numbers have been moved apart to keep up is a rule a reader can still read
   * mid-run. It is the same ladder of steps a real rule is marked off in - one,
   * two, five, ten - so the numbers that come out are 20, 50, 100, and not 37.
   */
  updateRule() {
    const rule = this.rule;
    const plan = this._plan;
    if (!rule) return;
    if (!plan || !this.haveRig) {
      rule.group.visible = false;
      return;
    }
    rule.group.visible = true;
    const perMm = Math.max(this.drawnScale, 1e-6) / 1000;
    const benchW = (plan.right - plan.left) + 0.46;
    const shift = this.wallShift ?? 0;
    /* Nought under the first mass's station: the displacement the rail prints
       first, and for a rig of one mass the only displacement there is. */
    const datum = plan.x[0] + shift;
    const left = plan.centre - benchW / 2 + RULE_INSET;
    const right = plan.centre + benchW / 2 - RULE_INSET;
    const step = neatStep(RULE_NEAR / perMm);
    const numbered = neatStep(Math.max(RULE_APART / perMm, step * 5));
    const each = Math.max(1, Math.round(numbered / step));
    /* The plate, let into the slab's front edge and never proud of it: the rule
       is the bench's own edge, which is the whole of why it reads as part of the
       bench rather than as another instrument standing on it. */
    rule.plate.position.set(
      plan.centre + shift, plan.benchY - BENCH_T / 2, BENCH_D / 2 + 0.0015,
    );
    rule.plate.scale.set(benchW - 2 * RULE_INSET, BENCH_T, 1);
    const foot = plan.benchY - BENCH_T + 0.0035;
    const z = BENCH_D / 2 + 0.004;
    const marks = rule.graduations.geometry.attributes.position;
    const points = marks.array;
    const first = Math.ceil((left - datum) / (step * perMm) - 1e-9);
    const last = Math.floor((right - datum) / (step * perMm) + 1e-9);
    let drawn = 0;
    let labelled = 0;
    for (let i = first; i <= last && drawn < RULE_MAX_TICKS; i += 1) {
      const mm = i * step;
      const x = datum + mm * perMm;
      /* The mark under the datum is the tallest, and every fifth graduation is
         longer than the rest: a rule is read by the long ones. */
      const height = mm === 0 ? RULE_STATION
        : i % each === 0 ? RULE_TICK[2]
          : i % 5 === 0 ? RULE_TICK[1] : RULE_TICK[0];
      points[drawn * 6 + 0] = x;
      points[drawn * 6 + 1] = foot;
      points[drawn * 6 + 2] = z;
      points[drawn * 6 + 3] = x;
      points[drawn * 6 + 4] = foot + height;
      points[drawn * 6 + 5] = z;
      drawn += 1;
      if (mm !== 0 && i % each !== 0) continue;
      if (labelled >= rule.numbers.length) continue;
      const sprite = rule.numbers[labelled];
      labelled += 1;
      setRuleNumber(sprite, mm, x, foot + RULE_TICK[2] + RULE_NUMBER * 0.5, z + 0.006);
    }
    marks.needsUpdate = true;
    rule.graduations.geometry.setDrawRange(0, drawn * 2);
    for (let i = labelled; i < rule.numbers.length; i += 1) rule.numbers[i].visible = false;
    /* And the station each mass belongs at, marked on the same plate: a mass's
       own zero, whatever the rule's numbers say under it. */
    const seat = rule.stations.geometry.attributes.position;
    const seats = seat.array;
    let standing = 0;
    for (let i = 1; i < this.system.n && standing < RULE_MAX_TICKS; i += 1) {
      const x = plan.x[i] + shift;
      if (x < left - 1e-9 || x > right + 1e-9) continue;
      seats[standing * 6 + 0] = x;
      seats[standing * 6 + 1] = foot;
      seats[standing * 6 + 2] = z - 0.001;
      seats[standing * 6 + 3] = x;
      seats[standing * 6 + 4] = foot + RULE_STATION;
      seats[standing * 6 + 5] = z - 0.001;
      standing += 1;
    }
    seat.needsUpdate = true;
    rule.stations.geometry.setDrawRange(0, standing * 2);
    /* The unit, at the right-hand end of the rule where a rule's units go. */
    rule.unit.visible = true;
    rule.unit.position.set(
      right - RULE_NUMBER * 1.1, foot + RULE_TICK[0] + RULE_NUMBER * 0.5, z + 0.006,
    );
    rule.unit.scale.set(
      RULE_NUMBER * 0.92 * rule.unit.material.map.userData.aspect,
      RULE_NUMBER * 0.92,
      1,
    );
  }

  /* ----------------------------------------------------------------------------
     THE CAMERA
     ---------------------------------------------------------------------------- */

  setViewMode(mode) {
    this.mode = mode === "2d" ? "2d" : "3d";
    this.orbit.dom.style.touchAction = "none";
    this.pan2d.update();
    this.orbit.update();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(2, rect.width);
    const h = Math.max(2, rect.height);
    this.renderer.setSize(w, h, false);
    this.camera3d.aspect = w / h;
    this.camera3d.updateProjectionMatrix();
    this.pan2d.resize(w, h);
  }

  /**
   * Frame the rig: aim both cameras at what is on the stage, with the whole of it
   * inside the frame.
   *
   * Called when the model changes, never per frame - a camera re-aimed sixty
   * times a second is a camera fighting the hand that is trying to look at
   * something. The distance is worked out from the frustum rather than guessed,
   * so a three-mass rig is framed like a three-mass rig and a single mass is not
   * left tiny in the middle of the screen.
   */
  frame() {
    const width = this.width ?? 1.6;
    const height = this.height ?? 1.0;
    this.orbit.target = { x: 0, y: this.centreY ?? 0, z: 0 };
    const halfFov = (this.camera3d.fov * Math.PI) / 360;
    const aspect = Math.max(0.5, this.camera3d.aspect);
    const needed = Math.max(width / (2 * Math.tan(halfFov) * aspect), height / (2 * Math.tan(halfFov)));
    this.orbit.distance = Math.max(this.orbit.minDistance, Math.min(this.orbit.maxDistance, needed * 1.12));
    this.orbit.update();
    /* The flat view has to fit the rig's *width* as well, and an orthographic
       camera's visible width is its height times the stage's aspect: a rig four
       times as wide as it is tall would be framed by its height and then run off
       both sides of the stage, which is what a rig of two masses did before this
       line knew about the aspect at all. */
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageAspect = Math.max(0.2, canvasRect.width / Math.max(canvasRect.height, 1));
    this.pan2d.target = { x: 0, y: this.centreY ?? 0 };
    this.pan2d.zoomHeight = Math.max(0.5, height * 1.12, (width * 1.12) / stageAspect);
    this.pan2d.update();
    return this;
  }

  zoom(factor) {
    if (this.mode === "2d") this.pan2d.zoom(factor);
    else this.orbit.zoom(factor);
  }

  /**
   * Put the view back the way the bench opens: the opening angle, framed on the
   * rig. What a double-click on the stage does, and the way back from a stage
   * that has been turned round until the rig is at its edge.
   */
  resetView() {
    this.orbit.azimuth = OPEN_AZIMUTH;
    this.orbit.elevation = OPEN_ELEVATION;
    if (this.mode === "2d") this.pan2d.target = { x: 0, y: this.centreY ?? 0 };
    this.frame();
    this.update();
    return this;
  }

  render() {
    this.renderer.render(this.scene, this.mode === "2d" ? this.camera2d : this.camera3d);
  }

  /** The camera that is drawing right now, for anything that has to aim. */
  get camera() {
    return this.mode === "2d" ? this.camera2d : this.camera3d;
  }

  /* ----------------------------------------------------------------------------
     PICKING
     ---------------------------------------------------------------------------- */

  /**
   * What is under the pointer: a mass, a spring, a dashpot, the drive, the
   * ground, the probe, or nothing.
   *
   * The masses are picked by their blocks, the elements by their holders and
   * everything else by the group it belongs to, and the answer is a *name*
   * rather than an object - the callers on the other side are all asking "which
   * of the things on this stage is this", and none of them has any business
   * holding a mesh.
   */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this._pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this._pointer, this.camera);

    const targets = [];
    for (const block of this.blocks) targets.push({ key: "mass", index: block.group.userData.index, object: block.group });
    /* Every element is a target, and it is the one thing on this stage that has
       to be: a spring or a dashpot is a thin thing among thicker ones, and a
       reader who can see what a coil is attached to and cannot click on it will
       click on it again. The pick mesh inside each holder is what the ray
       actually meets. */
    for (const element of this.elements) targets.push({ key: "element", index: element.index, object: element.holder });
    for (const arrow of this.drives ?? []) {
      if (arrow.group.visible) targets.push({ key: "drive", index: arrow.index, object: arrow.group });
    }
    if (this.baseArrow?.visible) targets.push({ key: "base", object: this.baseArrow });
    for (const post of this.posts) targets.push({ key: "base", object: post.group });
    if (this.probeOn) targets.push({ key: "probe", object: this.probe });
    const hits = this.raycaster.intersectObjects(targets.map((t) => t.object), true);
    /* Only the things you can *see* can be picked. Three raycasts an object
       whether or not it is switched off, and every part on this stage carries an
       outline - a box ruled round it - that exists only while that part is the
       picked one. Left in the ray's way, those are invisible walls standing
       round the rig: a click aimed at the shake table behind one lands on the
       arrow that owns it, and the part the reader was pointing at cannot be
       picked at all. A part that is not drawn is not there. */
    const shown = hits.find((hit) => isShown(hit.object));
    if (!shown) return null;
    for (let node = shown.object; node; node = node.parent) {
      const owner = targets.find((t) => t.object === node);
      if (!owner) continue;
      if (owner.key === "mass") return { key: "mass", index: owner.index };
      if (owner.key === "element") return { key: "element", index: owner.index };
      if (owner.key === "drive") return { key: "drive", index: owner.index ?? 0 };
      return { key: owner.key };
    }
    return null;
  }

  /**
   * Where the pointer is on the plane the rig is drawn in, in both directions.
   *
   * The blocks stand on one plane and their spring seats are on it too, so a
   * pointer taken onto that plane is the point on the bench the hand is really
   * over - which is what a block dragged in two directions has to be dragged by.
   * Null when the ray misses the plane, which three only does when the camera is
   * looking straight along it (a view of the bench edge-on, which is the one view
   * this stage cannot be put into).
   *
   * @returns {{x:number, y:number}|null} stage coordinates
   */
  planePoint(clientX, clientY, out = { x: 0, y: 0 }) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const ny = -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    if (this.mode === "2d") {
      const halfH = this.pan2d.zoomHeight / 2;
      const halfW = halfH * (rect.width / Math.max(rect.height, 1));
      out.x = this.pan2d.target.x + nx * halfW;
      out.y = this.pan2d.target.y + ny * halfH;
      return out;
    }
    this._pointer.set(nx, ny);
    this.raycaster.setFromCamera(this._pointer, this.camera3d);
    const plane = this._planeScratch ?? (this._planeScratch = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    const hit = this._hitScratch ?? (this._hitScratch = new THREE.Vector3());
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    out.x = hit.x;
    out.y = hit.y;
    return out;
  }

  /** The world x under the pointer on the plane the rig is drawn in, in *model*
   *  coordinates - the scale undone, so a caller can hand the answer straight
   *  back to the simulation. */
  planeX(clientX, clientY) {
    const point = this.planePoint(clientX, clientY, this._planePoint ?? (this._planePoint = { x: 0, y: 0 }));
    return point ? point.x : null;
  }

  /** Which mass is nearest a world x, within a slot and a half: how a drag that
   *  starts on a block knows which block it has hold of. */
  nearestMass(worldX) {
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0; i < this._plan.x.length; i++) {
      const distance = Math.abs(this.massX(i) - worldX);
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return bestDistance <= SPACING ? best : null;
  }

  /** The x a mass stands at when the rig is at rest - its slot, plus wherever a
   *  hand has put it - so a drag can land a part on the block it can see. */
  restX(index) {
    return this._plan.x[index] + (this.stage.get(index)?.x ?? 0);
  }

  dispose() {
    this.disposeRig();
    this.orbit.dispose();
    this.pan2d.dispose();
    for (const geometry of Object.values(this.geometries)) geometry.dispose?.();
    for (const material of Object.values(this.materials)) material.dispose();
    this.renderer.dispose();
  }
}
