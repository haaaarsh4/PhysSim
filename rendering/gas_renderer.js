/**
 * rendering/gas_renderer.js - the Thermo workbench's stage.
 *
 * One box, one lid, and however many molecules the box is holding. Nothing here
 * decides anything physical: it reads the box's arrays and draws where things
 * are, which is what lets the panel be the only place physics is described.
 *
 * The one design decision worth stating is the scale. The molecules are drawn
 * at their *real* size relative to the box - 0.34 nm atoms in an 18 nm cube -
 * rather than puffed up until they look like marbles. That matters, because the
 * whole point of the picture is that the gas is nearly empty: the molecules are
 * small, they are far apart compared with their own width, and the mean free
 * path is a third of the box rather than a hundredth of it. A scene that
 * inflated them would be a lie about the one thing the eye can actually check.
 *
 * The colour ramp is the other half of that: a molecule is tinted by its own
 * speed, so the Maxwell distribution in the panel's chart is the same
 * distribution you are looking at on the stage - a few slow ones, a great many
 * middling, a few fast.
 *
 * The stage is the *other* bench's room: the same clear colour, the same three
 * lights and the same pale slab with a faint grid on it, so a reader who has
 * looked at the block bench once already knows where they are. What colour is
 * left over is spent on meaning rather than on decoration: amber for anything
 * that is an *input* - the flame, the hot floor, walls being held at a
 * temperature - and the app's one accent, violet, for the gas itself and for
 * whatever is picked.
 */
import * as THREE from "three";
import {
  K_B, MAX_IMPACT_LOG,
  WALL_BACK, WALL_PISTON, WALL_Y_NEG, WALL_Y_POS, WALL_Z_NEG, WALL_Z_POS,
} from "../simulation/gas.js";
import { OrbitCameraController, PanZoomController2D } from "./camera.js";

/** World units per metre. Chosen so a 20 nm box is two units across, which
 *  puts an argon atom at about six pixels on a normal screen. */
export const WORLD_PER_METRE = 1e8;

/**
 * How big the burner under a box of this half-height is, as a factor.
 *
 * The flame is drawn in world units and the camera is framed by the box, so a
 * burner of one fixed size is a hulking great thing under an 8 nm box and a
 * match under a 40 nm one. Scaling it with the box is what keeps the picture
 * the same picture at every size. It is exactly 1 for the 18 nm box the
 * workbench opens on, so nothing that was measured against that scene moves.
 *
 * @param {number} half half the box's side, world units
 */
export function burnerScale(half) {
  return Math.min(2, Math.max(0.45, half / 0.9));
}

/** How many steps a wall impact stays lit for. A few frames' worth: long enough
 *  to read as a shower of sparks rather than a strobe, short enough that the
 *  sparks are where the gas is hitting it *now*. */
const IMPACT_LIFE = 26;

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A soft round spark, drawn once into a canvas and used as the point sprite.
 *
 * A `THREE.Points` without a map draws squares, and a box full of small hard
 * squares is a box full of confetti. A soft dot with a warm falloff reads as
 * what it is at any size, and costs one 64-pixel texture for the whole scene.
 */
function sparkTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,236,200,0.8)");
  g.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A soft flame, drawn once into a canvas and stacked up as sprites.
 *
 * One radial gradient with a warm core, its top tapered away so it comes to a
 * point: a flame is a glow that narrows, and a glow that does not is a lamp.
 * Blended normally rather than additively, because the stage behind it is pale
 * and an additive flame over pale grey bleaches to a white triangle.
 */
function flameTexture() {
  const W = 64;
  const H = 128;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const cy = H * 0.68;
  const g = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, H * 0.42);
  /* Saturated all the way through, and that is not decoration: the stage behind
     this flame is near-white, so a pale flame disappears into it. A flame over
     white paper is visible because it is orange in the middle, and this one has
     to be too. */
  g.addColorStop(0, "rgba(255,238,178,1)");
  g.addColorStop(0.22, "rgba(255,188,76,0.96)");
  g.addColorStop(0.5, "rgba(255,124,26,0.62)");
  g.addColorStop(0.78, "rgba(246,86,14,0.24)");
  g.addColorStop(1, "rgba(246,86,14,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(W / 2, cy, W * 0.5, H * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();
  /* Keep only what is inside a silhouette that tapers towards the top. */
  ctx.globalCompositeOperation = "destination-in";
  const mask = ctx.createLinearGradient(0, H * 0.04, 0, H);
  mask.addColorStop(0, "rgba(0,0,0,0)");
  mask.addColorStop(0.42, "rgba(0,0,0,0.85)");
  mask.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* Slow molecules are a cool slate, fast ones the violet the speed chart on the
 * panel is drawn in, and the ramp is in speed rather than in position so the
 * stage shows the distribution. The fast end is the chart's own accent on
 * purpose: the cloud and the bars are the same measurement, and a chart drawn
 * in one violet beside a cloud drawn in another is two pictures of one gas. */
const SLOW = new THREE.Color("#77809f");
const MID = new THREE.Color("#9a86e0");
const FAST = new THREE.Color("#b18cf5");

export class GasRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../simulation/gas.js").GasBox} box
   */
  constructor(canvas, box) {
    this.canvas = canvas;
    this.box = box;
    this.mode = "3d";
    this.showMolecules = true;
    this.speedScale = 1;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0xe7e6ee, 1); // --stage
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xdedde7, 0.035);

    /* The same three lights the block bench opens with, at the same strengths:
       an ambient that carries the scene, a key that shapes it and drops the
       shadows the instruments stand in, and a grey rim that does not tint it.
       A violet rim was the one thing on this stage that put a colour on a room
       meant to be the other bench's own, and a stage with an orb of its own on
       it is the stage that reads as a second project. */
    this.scene.add(new THREE.AmbientLight(0xe8e7ef, 0.85));
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.keyLight.position.set(3, 5, 2);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0015;
    this.keyLight.shadow.radius = 2.4;
    /* Its target is the middle of the stage, which is a thing that moves: the
       box's own size and the instruments around it set where the middle is, so
       `frame` puts the light where the stage is and sizes the shadow's own
       camera to hold it (see `_fitKeyLight`). */
    this.scene.add(this.keyLight, this.keyLight.target);
    const rim = new THREE.DirectionalLight(0xc9c8d4, 0.4);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);

    this.camera3d = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
    this.camera2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);

    this.orbit = new OrbitCameraController(this.camera3d, canvas, {
      target: { x: 0, y: 0, z: 0 },
      azimuth: 0.86,
      elevation: 0.34,
      distance: 5.2,
      minDistance: 1.4,
      /* Far enough back to hold a 40 nm box with a bench, a flame and an
         instrument on either side of it: the framing below asks for whatever
         the content needs, and a cap that is too near would answer with a box
         off the edge of the stage. */
      maxDistance: 90,
    });
    this.pan2d = new PanZoomController2D(this.camera2d, canvas, { zoomHeight: 3.0 });
    this.pan2d.maxZoom = 44;

    /* Everything the stage is holding, in world units: the box, plus whatever
       the instrument layer has put around it. Null means "just the box". */
    this.stageExtent = null;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    /* ------------------------------- the box ------------------------------- */
    /* Six translucent faces, so the gas inside is visible through every wall
       that is not the one you are looking through.

       The glass is *grey*, and that is the whole of what was wrong with it
       before. It used to be tinted violet, which made a chamber that is nine
       tenths of the picture a second accent - and an accent that is everywhere
       is not an accent. Slate is the bench's own family (it is the grey the
       rigs are picked out in on the block bench), so the box reads as glass
       standing on a table, with the one violet thing on the stage being the gas
       itself. */
    this.faceGeometry = new THREE.PlaneGeometry(1, 1);
    this.wallMaterial = new THREE.MeshBasicMaterial({
      color: 0x5c5b68, transparent: true, opacity: 0.045,
      side: THREE.DoubleSide, depthWrite: false,
    });
    /* Walls that hold the temperature are lit by the thing that is heating
       them, so the warmth is the amber the flame and the force arrow are drawn
       in - the colour of an input on this platform, and not a colour of its
       own. */
    this.wallWarmMaterial = new THREE.MeshBasicMaterial({
      color: 0xd98324, transparent: true, opacity: 0.055,
      side: THREE.DoubleSide, depthWrite: false,
    });
    /* The floor of a box that has a flame under it: the one wall in the scene
       that is a different temperature from the rest, so the one wall that is
       allowed to look different from the rest. */
    this.floorHotMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9a4d, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false,
    });
    /* The piston: a steel plate rather than a coloured pane, because it is the
       one face of the box that is a *part* - it moves, it carries the load, and
       a metal lid is what a reader who has seen a syringe already expects. */
    this.lidMaterial = new THREE.MeshBasicMaterial({
      color: 0x8a8794, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.walls = [];
    for (let i = 0; i < 5; i++) {
      const face = new THREE.Mesh(this.faceGeometry, this.wallMaterial);
      this.walls.push(face);
      this.root.add(face);
    }
    this.lidMesh = new THREE.Mesh(this.faceGeometry, this.lidMaterial);
    this.root.add(this.lidMesh);

    /* The box's edges, drawn as one line loop each so they can be rebuilt with
       the box's size rather than scaled (a scaled line has scaled thickness). */
    this.boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    /* Ink, like the blocks a rig is made of: the box is the subject of this
       stage the way a mass is the subject of the other one, and the one thing
       on either bench that is drawn in the page's own ink. */
    this.boxEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x34343f, transparent: true, opacity: 0.58 });
    this.edges = new THREE.LineSegments(this.boxEdges, this.boxEdgeMaterial);
    this.root.add(this.edges);

    /* The outline the picked thing wears: the same accent the instrument bench
       draws its own selection in. On this stage the box *is* an instrument -
       it is the one thing the page is about - so a click on the gas lights its
       own edges up, and a click on the burner does the same to the burner's. */
    this.chosenEdge = new THREE.LineBasicMaterial({
      color: 0x9e00ff, transparent: true, opacity: 0.95,
    });
    this.selected = null;

    /* The partition, when one is in the box. */
    this.membraneMesh = new THREE.Mesh(this.faceGeometry, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.root.add(this.membraneMesh);

    /* The pinhole, drawn as a ring in the back wall so a hole you opened is
       visible from the front. */
    this.holeMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd7a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.root.add(this.holeMesh);

    /* ------------------------------- the burner ------------------------------- */
    /* A flame under the floor: a pale steel burner standing on the bench with a
       soft flame over it. Nothing here is a measurement - the temperature the
       floor is actually held at is the panel's number, and this is the picture
       of where it comes from. Its brightness and its height follow how far the
       flame is above the air, so a 900 K flame over a 300 K bath is a real
       flame and a 320 K one is a candle.

       The flame is a stack of soft sprites rather than cones, and it is blended
       normally rather than additively, for the same reason the apparatus is
       pale: an additive flame on a pale stage bleaches out to a white triangle,
       and a flame that is a white triangle is the one thing on this stage that
       looks like a bug. */
    this.burnerGroup = new THREE.Group();
    this.root.add(this.burnerGroup);
    this.burnerBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.62, 0.09, 24),
      new THREE.MeshStandardMaterial({ color: 0x9a97a5, roughness: 0.36, metalness: 0.34 }),
    );
    this.burnerTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.19, 0.5, 16),
      new THREE.MeshStandardMaterial({ color: 0x3f3e4a, roughness: 0.5, metalness: 0.15 }),
    );
    /* A hairline on the burner's own rims, like every other object on this
       stage: a pale cylinder against a pale bench has no edge of its own. */
    this.burnerEdges = new THREE.EdgesGeometry(this.burnerBase.geometry, 20);
    this.burnerEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x6d6c78, transparent: true, opacity: 0.45,
    });
    const baseEdge = new THREE.LineSegments(this.burnerEdges, this.burnerEdgeMaterial);
    baseEdge.frustumCulled = false;
    this.burnerBase.add(baseEdge);
    /* And the same over the standpipe, because the stand is the whole of what a
       burner is: picked, both of them are the outline a reader sees lit. */
    this.burnerTubeEdges = new THREE.EdgesGeometry(this.burnerTube.geometry, 20);
    const tubeEdge = new THREE.LineSegments(this.burnerTubeEdges, this.burnerEdgeMaterial);
    tubeEdge.frustumCulled = false;
    this.burnerTube.add(tubeEdge);
    this.burnerHairlines = [baseEdge, tubeEdge];
    this.burnerGroup.add(this.burnerBase, this.burnerTube);

    /* Whether a burner is standing under the box, which is not the same
       question as whether it is lit: the stand is apparatus that can be on the
       stage with its flame out. It starts answering the box's own flame, which
       is what a box that opens with one already burning means. */
    this.burnerPresent = !!box.burner.on;

    this.flameLayers = [];
    /* Outer glow, body, core: one flame out of three sizes of the same sprite,
       which is what makes it read as a flame rather than as a dot. The sizes
       are multiples of the burner's own, so the whole flame is scaled from the
       one number `updateBurner` works out. */
    for (const [w, h, opacity] of [[0.36, 0.74, 0.5], [0.24, 0.56, 0.8], [0.14, 0.38, 0.95]]) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, depthWrite: false, opacity,
      }));
      sprite.userData.base = { w, h, opacity };
      sprite.userData.phase = this.flameLayers.length * 1.9;
      this.burnerGroup.add(sprite);
      this.flameLayers.push(sprite);
    }
    /* The flame is a canvas, so a GPU reset can take its 2D context away and
       leave every layer of it drawing a transparent nothing. It is handed a new
       canvas when that happens, because a flame that goes out when the driver
       blinks is a flame that lies about the physics. */
    const rebuildFlame = () => {
      const texture = flameTexture();
      texture.image.addEventListener("contextlost", rebuildFlame, { once: true });
      for (const sprite of this.flameLayers) {
        sprite.material.map = texture;
        sprite.material.needsUpdate = true;
      }
    };
    rebuildFlame();
    this.burnerLight = new THREE.PointLight(0xff9a4d, 0, 9, 2);
    this.root.add(this.burnerLight);
    /* The stand is a solid: it stands in the key light like everything else on
       the bench and drops a shadow under the box, which is what stops the flame
       hanging in the air. The flame itself is sprites and casts nothing. */
    this.burnerBase.castShadow = true;
    this.burnerTube.castShadow = true;

    /* --------------------------- where the walls are hit --------------------------- */
    /* A spark at every place a molecule has just struck a wall, plus a tick
       along the direction it left in - which is the other half of the story the
       force readout tells: the gas handed the wall the momentum it no longer
       has, and went the other way with what is left. Both fade with age and
       brighten with the size of the impulse, so the picture carries the same
       numbers the panel does. */
    this.impactGeometry = new THREE.BufferGeometry();
    this._impactPos = new Float32Array(MAX_IMPACT_LOG * 3);
    this._impactCol = new Float32Array(MAX_IMPACT_LOG * 3);
    this.impactGeometry.setAttribute("position", new THREE.BufferAttribute(this._impactPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.impactGeometry.setAttribute("color", new THREE.BufferAttribute(this._impactCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.impactPoints = new THREE.Points(this.impactGeometry, new THREE.PointsMaterial({
      size: 0.1, sizeAttenuation: true, vertexColors: true, transparent: true,
      map: sparkTexture(), blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.impactPoints.frustumCulled = false;
    this.impactPoints.visible = false;
    this.root.add(this.impactPoints);

    this.impactTickGeometry = new THREE.BufferGeometry();
    this._tickPos = new Float32Array(MAX_IMPACT_LOG * 6);
    this._tickCol = new Float32Array(MAX_IMPACT_LOG * 6);
    this.impactTickGeometry.setAttribute("position", new THREE.BufferAttribute(this._tickPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.impactTickGeometry.setAttribute("color", new THREE.BufferAttribute(this._tickCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.impactTicks = new THREE.LineSegments(this.impactTickGeometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.impactTicks.frustumCulled = false;
    this.impactTicks.visible = false;
    this.root.add(this.impactTicks);
    this.showImpacts = false;

    /* ---------------------------- the molecules ---------------------------- */
    this.maxMolecules = box.maxMolecules;
    const sphere = new THREE.IcosahedronGeometry(1, 1);
    this.moleculeMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.35, metalness: 0.0, vertexColors: false,
    });
    this.molecules = new THREE.InstancedMesh(sphere, this.moleculeMaterial, this.maxMolecules);
    this.molecules.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.molecules.count = 0;
    this.molecules.frustumCulled = false;
    this.molecules.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxMolecules * 3), 3);
    this.molecules.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.molecules);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._color = new THREE.Color();
    this._ray = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._plane = new THREE.Plane(v3(0, 0, 1), 0);
    this._hit = new THREE.Vector3();

    this.framed = 0;
    this.framedOnShape = false;
    this.syncBox();
    this.resize();
  }

  /** Half-extents and lid position in world units, from the simulation's metres. */
  geometry() {
    const b = this.box;
    const s = WORLD_PER_METRE;
    const half = (b.crossSection * s) / 2;
    return { half, lidX: b.lid.x * s, back: 0, membrane: b.membrane.x * s, scale: s };
  }

  /**
   * Say what else is on the stage, and reframe on it.
   *
   * The stage is not only the box any more: a bench, a flame, a gauge and a
   * thermometer can all be standing around it, and a camera framed on the box
   * alone would put the instrument that makes sense of the box off the edge of
   * the screen. The instrument layer works out the rectangle; this turns it
   * into a camera.
   *
   * The extent is allowed to be a *function*, and is called through rather than
   * read once: the box's own size and the lid's position move the instruments
   * with them, so the rectangle that has to be in shot is a live question, and
   * every reframe - including the ones this class decides on itself - has to
   * ask it rather than a remembered answer.
   *
   * @param {{left:number,right:number,top:number,bottom:number}|Function|null} extent
   */
  setStageExtent(extent) {
    this.stageExtent = extent ?? null;
    this.frame();
  }

  /**
   * Show the outline of the box, of the burner, or of neither.
   *
   * The two things this class draws that can be picked: the box, whose edges are
   * already the instrument's own outline, and the burner, which is a stand and a
   * flame and whose hairlines light up together. Both are drawn in the same
   * accent the instrument layer uses for its own selection, so a stage with a
   * gauge and a box picked in turn is one language rather than two.
   *
   * @param {string|null} key "box", "burner", or null for nothing picked
   */
  setSelected(key) {
    this.selected = key ?? null;
    this.edges.material = this.selected === "box" ? this.chosenEdge : this.boxEdgeMaterial;
    const material = this.selected === "burner" ? this.chosenEdge : this.burnerEdgeMaterial;
    for (const line of this.burnerHairlines) line.material = material;
    return this;
  }

  /**
   * The surfaces a click can land on to mean "the box".
   *
   * Its own walls and its lid: the gas is drawn as six translucent faces around
   * a cloud of molecules, and the faces are what the pointer can hit - a click on
   * the gas anywhere counts as a click on the box, which is what a reader aiming
   * at the box means. The molecules are deliberately not in here: raycasting two
   * thousand little spheres to answer a question about the box they are in would
   * cost a frame and tell the reader nothing.
   */
  boxTargets() {
    return [...this.walls, this.lidMesh];
  }

  /**
   * Whether a burner is standing under the box. Not the same question as
   * whether its flame is lit - the flame is the box's (`box.burner.on`) and the
   * stand is the instrument layer's - so the page that owns both tells this one
   * where the burner is, and this one draws the stand and the flame on the two
   * separate answers.
   *
   * @param {boolean} on
   */
  setBurnerPresent(on) {
    this.burnerPresent = !!on;
  }

  /** The extent as it is now, or null when the stage is just the box. */
  _extent() {
    const raw = typeof this.stageExtent === "function" ? this.stageExtent() : this.stageExtent;
    return raw && Number.isFinite(raw.left) ? raw : null;
  }

  /**
   * Reframe the camera on everything on the stage. Called when the box changes
   * size or gains an instrument, never on every frame: a camera that re-frames
   * itself while you are dragging the lid would be moving the thing you are
   * aiming at.
   *
   * Two things decide how far back it sits. The first is what has to be in
   * shot, which is the box plus whatever is standing around it. The second is
   * that the fit has to be a *fit*: the stage is wider than it is tall, so
   * whether the width or the height runs out first is a question about the
   * actual aspect ratio, and answering it with one fixed multiple of the box
   * is how a scene ends up either overflowing or lost in the middle. The margin
   * on top of that leaves the bench a bench's worth of air round it - a scene
   * that fills the stage is a microscope slide, and the whole point of standing
   * a bench under the box is that you can see it is on one - but no more than
   * that, since this stage is wider than it is tall and everything in the fit
   * is paid for by the things standing at the ends of the bench.
   */
  frame() {
    const g = this.geometry();
    const e = this._extent();
    /* A burner standing under the floor hangs below it, so a stage framed on the
       box alone puts the thing that is heating it off the bottom - most visibly
       in the flat view, where there is no room to pan and no perspective to
       give the eye a second chance. Whether it is burning makes no difference
       to that fit: the stand takes the same room with its flame out. */
    const drop = this.burnerPresent ? 0.68 * burnerScale(g.half) : 0;
    const left = e ? Math.min(e.left, 0) : 0;
    const right = e ? Math.max(e.right, g.lidX) : g.lidX;
    const top = e ? Math.max(e.top, g.half) : g.half;
    const bottom = e ? Math.min(e.bottom, -g.half) : -g.half - drop;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const spanW = Math.max(right - left, 1e-3);
    const spanH = Math.max(top - bottom, 1e-3);

    /* Tighter than the block bench's own, because this stage is wider than it
       is tall and a fit that is generous across is a fit that leaves the whole
       bench sitting in the middle of the room. */
    const margin = 1.22;
    const halfFov = Math.tan(((this.camera3d.fov * Math.PI) / 180) / 2);
    const aspect = Math.max(0.4, this.camera3d.aspect || 1);
    const distV = (spanH * margin) / 2 / halfFov;
    const distH = (spanW * margin) / 2 / (halfFov * aspect);
    /* The box has depth and the camera looks down at it, so its near corner is
       nearer than its middle: a little more room than the flat fit asks for. */
    const distance = Math.max(distV, distH) * 1.12;

    this.orbit.target = { x: cx, y: cy, z: 0 };
    this.orbit.distance = Math.max(this.orbit.minDistance, Math.min(this.orbit.maxDistance, distance));
    this.orbit.update();
    this.pan2d.target = { x: cx, y: cy };
    this.pan2d.zoomHeight = Math.max(spanH, spanW / aspect) * margin;
    this.pan2d.update();
    /* The box is as deep as it is wide, and the bench under it is deeper than
       both, so the light has to hold that depth as well as the flat rectangle
       the camera is fitted to. */
    this._fitKeyLight(cx, cy, spanW, spanH, Math.max(2 * g.half, g.lidX));
    this.framed = this.box.crossSection * 1e9 * 1000 + this.box.lid.x * 1e9;
  }

  /**
   * Put the key light - and its shadow's own camera - over the stage.
   *
   * The light stands the same way off the stage however big the stage is, and
   * the shadow camera's box is measured against what is actually in shot rather
   * than fixed: a stage this is not sized for is a stage whose instruments cast
   * shadows that are cut off at the edge of the map (or, worse, no shadow at
   * all), and the box grows from 8 nm to 40 nm and takes its whole bench with
   * it. `reach` is the half-box the map covers and `k` the distance the light is
   * held off at - one number for both, so the light is always at the same corner
   * of the same room however much of the room there is.
   */
  _fitKeyLight(cx, cy, spanW, spanH, depth) {
    const key = this.keyLight;
    const reach = Math.max(spanW, spanH, depth) * 0.62 + 0.12;
    const k = Math.max(0.25, reach / 3);
    key.target.position.set(cx, cy, 0);
    key.target.updateMatrixWorld();
    key.position.set(cx + 3 * k, cy + 5 * k, 2 * k);
    const away = Math.hypot(3 * k, 5 * k, 2 * k);
    const shadow = key.shadow.camera;
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.near = Math.max(0.1, away - reach * 1.9);
    shadow.far = away + reach * 1.9;
    shadow.updateProjectionMatrix();
  }

  /**
   * In or out by a factor on whichever camera is showing. The one call a zoom
   * button outside this class needs: both controllers already take the same
   * `zoom(factor)`, so which of the two is driving the stage is a question this
   * class answers rather than one its caller has to know.
   */
  zoom(factor) {
    (this.mode === "2d" ? this.pan2d : this.orbit).zoom(factor);
  }

  /* ------------------------------- the picture ------------------------------ */

  /** Rebuild every piece of the stage that follows the box's size. */
  syncBox() {
    const g = this.geometry();
    const { half, lidX } = g;
    const faces = [
      // bottom, top, near (+z), far (-z), back
      [[0, -half, 0], [Math.PI / 2, 0, 0], [lidX, g.half * 2, 0]],
      [[0, half, 0], [-Math.PI / 2, 0, 0], [lidX, g.half * 2, 0]],
      [[lidX / 2, 0, half], [0, 0, 0], [lidX, g.half * 2, 0]],
      [[lidX / 2, 0, -half], [0, Math.PI, 0], [lidX, g.half * 2, 0]],
      [[0, 0, 0], [0, Math.PI / 2, 0], [g.half * 2, g.half * 2, 0]],
    ];
    const warm = this.box.walls === "thermal";
    for (let i = 0; i < 5; i++) {
      const [pos, rot, size] = faces[i];
      const mesh = this.walls[i];
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.scale.set(Math.max(size[0], 1e-4), Math.max(size[1], 1e-4), 1);
      mesh.material = warm ? this.wallWarmMaterial : this.wallMaterial;
    }
    /* The floor is the one face a burner can be under, so it is the one face
       whose material is not decided by the box alone. */
    this._syncFloorMaterial();
    this.lidMesh.position.set(lidX, 0, 0);
    this.lidMesh.rotation.set(0, -Math.PI / 2, 0);
    this.lidMesh.scale.set(g.half * 2, g.half * 2, 1);
    this.lidMesh.visible = true;

    this.edges.position.set(lidX / 2, 0, 0);
    this.edges.scale.set(lidX, g.half * 2, g.half * 2);

    const m = this.box.membrane;
    this.membraneMesh.visible = m.present;
    if (m.present) {
      this.membraneMesh.position.set(m.x * g.scale, 0, 0);
      this.membraneMesh.rotation.set(0, -Math.PI / 2, 0);
      this.membraneMesh.scale.set(g.half * 2, g.half * 2, 1);
    }

    const r = this.box.hole * g.scale;
    this.holeMesh.visible = r > 0;
    if (r > 0) {
      this.holeMesh.position.set(0.0015, 0, 0);
      this.holeMesh.rotation.set(0, Math.PI / 2, 0);
      this.holeMesh.scale.set(r, r, 1);
    }

    /* One frame every time the box grows by more than a percent or the lid
       opens or closes by more than a fifth. */
    const signature = this.box.crossSection * 1e9 * 1000 + this.box.lid.x * 1e9;
    if (Math.abs(signature - this.framed) > 12) this.frame();
  }

  /** Where the lid is now, in world units. Cheap: the frame loop calls it. */
  syncLid() {
    const g = this.geometry();
    this.lidMesh.position.x = g.lidX;
    this.edges.scale.x = g.lidX;
    for (const [i, size] of [[0, 1], [1, 1], [2, 0], [3, 0]]) {
      void i; void size;
    }
    this.walls[0].position.x = this.walls[1].position.x = this.walls[2].position.x = this.walls[3].position.x = g.lidX / 2;
    this.walls[0].scale.x = this.walls[1].scale.x = g.lidX;
    this.walls[2].scale.x = this.walls[3].scale.x = g.lidX;
    this.edges.position.x = g.lidX / 2;
    this.membraneMesh.visible = this.box.membrane.present;
    if (this.box.membrane.present) this.membraneMesh.position.x = this.box.membrane.x * g.scale;
  }

  /** The floor's own material: the one face a burner can be under. */
  _syncFloorMaterial() {
    const b = this.box;
    const hot = b.burner.on && b.burner.temperature > b.bath + 5;
    this.walls[0].material = hot ? this.floorHotMaterial
      : (b.walls === "thermal" ? this.wallWarmMaterial : this.wallMaterial);
  }

  /**
   * The flame under the box: is it lit, how big is it, and where is it.
   *
   * Rebuilt every frame rather than on a change, because a flame that does not
   * move is a picture of a flame rather than one - and the motion is the only
   * thing here that is not a measurement. Its height follows how far the flame
   * is above the air, which is the same quantity the panel's temperature
   * difference is, so a bright tall flame really is the hot one.
   *
   * @param {number} t seconds, for the flicker
   */
  updateBurner(t) {
    const b = this.box;
    const g = this.geometry();
    /* How big this particular burner is: proportional to the box, because a
       flame of one fixed size is a bonfire under an 8 nm box. */
    const sc = burnerScale(g.half);
    const heat = Math.max(0, Math.min(1, (b.burner.temperature - b.bath) / 1200));
    const present = this.burnerPresent;
    const lit = present && b.burner.on && heat > 0.015;
    this._syncFloorMaterial();
    /* The stand is here because it is on the stage, the flame is here because
       it is burning: a burner that has been switched off keeps its disc, its
       neck and its place on the bench, and only the light goes out of it. */
    this.burnerGroup.visible = present;
    this.burnerLight.visible = lit;
    for (const sprite of this.flameLayers) sprite.visible = lit;
    if (!present) return;

    const cx = g.lidX / 2;
    const floorY = -g.half;
    /* The burner stands on the bench, and the bench stands a flame's height
       lower - the same 0.70 the instrument layer lays the bench out with, so
       the burner is never left floating above the board it stands on. */
    const benchY = floorY - 0.70 * sc;
    /* A low disc with a short neck on it, which is what a lab burner under a
       vessel looks like from the side and what a stepped cone does not. */
    const bodyH = 0.26 * sc;

    this.burnerBase.position.set(cx, benchY + 0.05 * sc, 0);
    this.burnerBase.scale.set(0.68 * sc, 1.1 * sc, 0.68 * sc);
    this.burnerTube.position.set(cx, benchY + 0.10 * sc + (bodyH - 0.10 * sc) / 2, 0);
    this.burnerTube.scale.set(0.55 * sc, Math.max(0.01, bodyH - 0.10 * sc) / 0.5, 0.55 * sc);

    const mouth = benchY + bodyH;
    /* A hotter flame is a bigger one and a brighter one, and the two are the
       same quantity the panel's temperature difference is. */
    const lift = 0.75 + 0.35 * heat;
    for (const sprite of this.flameLayers) {
      const { w, h, opacity } = sprite.userData.base;
      const wob = Math.sin(t * 9.1 + sprite.userData.phase) * 0.5
        + Math.sin(t * 4.3 + sprite.userData.phase * 2.1) * 0.5;
      const hh = h * sc * lift * (0.90 + 0.10 * wob);
      sprite.scale.set(w * sc * lift * (0.94 + 0.06 * wob), hh, 1);
      /* The sprite's own hot core sits low in its frame, so the flame is stood
         on the burner's mouth rather than centred on it. */
      sprite.position.set(cx, mouth + hh * 0.45, 0);
      sprite.material.opacity = opacity * (0.7 + 0.3 * heat) * (0.88 + 0.12 * wob);
    }
    this.burnerLight.position.set(cx, mouth + 0.2 * sc, 0);
    this.burnerLight.intensity = 1.8 * heat;
  }

  /** Whether to draw the sparks where molecules are hitting the walls. */
  setShowImpacts(on) {
    this.showImpacts = !!on;
    this.impactPoints.visible = this.showImpacts;
    this.impactTicks.visible = this.showImpacts;
  }

  /**
   * Draw the last few dozen wall impacts: a spark where the wall was struck,
   * and a short tick along the direction the molecule went away in.
   *
   * The tick is the honest half of the picture. A wall that has just been hit has
   * gained the momentum the molecule no longer has, and the molecule's new
   * direction is where that momentum *didn't* go - so a shower of ticks all
   * pointing into the gas is a shower of momenta all pointing out of it, which is
   * pressure with the arithmetic left in. Brightness carries the size of the
   * impulse, measured against what a collision at this temperature is worth, so
   * a fast molecule really does strike a brighter spark than a slow one.
   */
  updateImpacts() {
    if (!this.showImpacts) return;
    const b = this.box;
    const log = b.impactLog;
    this.impactPoints.visible = true;
    this.impactTicks.visible = true;
    if (!log || !b.trackImpacts) {
      this.impactGeometry.setDrawRange(0, 0);
      this.impactTickGeometry.setDrawRange(0, 0);
      return;
    }
    const s = WORLD_PER_METRE;
    const typical = Math.max(1e-34, 2 * Math.sqrt(b.meanMass() * K_B * Math.max(b.windowTemperature(), 1)));
    let n = 0;
    for (let k = 0; k < log.count && n < MAX_IMPACT_LOG; k++) {
      const age = b.steps - log.step[k];
      if (age < 0 || age > IMPACT_LIFE) continue;
      const fade = 1 - age / IMPACT_LIFE;
      const power = fade * fade * (0.3 + 0.7 * Math.min(1, Math.abs(log.impulse[k]) / typical));
      const face = log.face[k];
      const nx = face === WALL_BACK ? 1 : face === WALL_PISTON ? -1 : 0;
      const ny = face === WALL_Y_NEG ? 1 : face === WALL_Y_POS ? -1 : 0;
      const nz = face === WALL_Z_NEG ? 1 : face === WALL_Z_POS ? -1 : 0;
      const px = log.x[k] * s;
      const py = log.y[k] * s;
      const pz = log.z[k] * s;
      /* A short tick and not a streak: it is a direction, and a long one would
         criss-cross the whole box and stop reading as a direction at all. */
      const run = 0.03 + 0.13 * power;

      const i3 = n * 3;
      this._impactPos[i3] = px; this._impactPos[i3 + 1] = py; this._impactPos[i3 + 2] = pz;
      this._impactCol[i3] = power; this._impactCol[i3 + 1] = power * 0.84; this._impactCol[i3 + 2] = power * 0.5;

      const j6 = n * 6;
      this._tickPos[j6] = px; this._tickPos[j6 + 1] = py; this._tickPos[j6 + 2] = pz;
      this._tickPos[j6 + 3] = px + nx * run; this._tickPos[j6 + 4] = py + ny * run; this._tickPos[j6 + 5] = pz + nz * run;
      const dim = power * 0.7;
      this._tickCol[j6] = dim; this._tickCol[j6 + 1] = dim * 0.86; this._tickCol[j6 + 2] = dim * 0.56;
      this._tickCol[j6 + 3] = 0; this._tickCol[j6 + 4] = 0; this._tickCol[j6 + 5] = 0;
      n++;
    }
    this.impactGeometry.setDrawRange(0, n);
    this.impactTickGeometry.setDrawRange(0, n * 2);
    this.impactGeometry.attributes.position.needsUpdate = true;
    this.impactGeometry.attributes.color.needsUpdate = true;
    this.impactTickGeometry.attributes.position.needsUpdate = true;
    this.impactTickGeometry.attributes.color.needsUpdate = true;
  }

  /**
   * One molecule per instance, tinted by its own speed.
   *
   * The tint is normalised against the gas's own r.m.s. speed, so the ramp keeps
   * its meaning when you change the temperature: violet means "about twice the
   * typical speed" at 200 K and at 900 K alike, which is what makes the chart and
   * the stage tell the same story. `speedScale` lets the panel exaggerate the
   * ramp for a slower or faster picture without changing the physics.
   */
  updateMolecules() {
    const b = this.box;
    const s = WORLD_PER_METRE * this.speedScale;
    const count = Math.min(b.n, this.maxMolecules);
    const overall = Math.max(b.rmsSpeed(), 1);
    for (let i = 0; i < count; i++) {
      const r = Math.max(b.radius[i] * s, 0.0012);
      this._position.set(b.x[i] * s, b.y[i] * s, b.z[i] * s);
      this._scale.set(r, r, r);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.molecules.setMatrixAt(i, this._matrix);
      const speed = Math.hypot(b.vx[i], b.vy[i], b.vz[i]) / overall;
      const t = Math.min(1, Math.max(0, (speed - 0.45) / 1.05));
      this._color.copy(t < 0.5 ? SLOW.clone().lerp(MID, t * 2) : MID.clone().lerp(FAST, (t - 0.5) * 2));
      this.molecules.instanceColor.setXYZ(i, this._color.r, this._color.g, this._color.b);
    }
    this.molecules.count = count;
    this.molecules.instanceMatrix.needsUpdate = true;
    this.molecules.instanceColor.needsUpdate = true;
  }

  /** Whether to draw the molecules at all. They are the gas; this is a
   *  courtesy for a slow machine, not a physical statement. */
  setShowMolecules(on) {
    this.showMolecules = !!on;
    this.molecules.visible = this.showMolecules;
  }

  setSpeedScale(scale) {
    this.speedScale = Math.max(0.2, Math.min(2.5, scale));
  }

  setViewMode(mode) {
    this.mode = mode === "2d" ? "2d" : "3d";
    const twoD = this.mode === "2d";
    this.orbit.dom.style.touchAction = "none";
    this.camera = twoD ? this.camera2d : this.camera3d;
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
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    /* The first canvas that has a shape to it gets the fit redone, once.
       This stage is un-hidden inside a page that is already laid out, so the
       first fit can be worked out against a canvas that is a strip rather than
       the one the reader ends up looking at. The perspective camera's own
       aspect is corrected on every resize, which is why the fault is easy to
       miss: what stays wrong is the *distance* and the flat view's zoom, both
       of which were worked out for the strip - and a zoom that is never
       revisited is a scene that opens lost in the middle of the room. */
    if (!this.framedOnShape && w >= 64 && h >= 64) {
      this.framedOnShape = true;
      this.frame();
    }
  }

  render() {
    this.renderer.render(this.scene, this.mode === "2d" ? this.camera2d : this.camera3d);
  }

  /* --------------------------------- picking ------------------------------- */

  /**
   * Where the lid is on screen, in client pixels, with the scale needed to turn
   * a pixel distance into a world one.
   *
   * The lid is grabbable in 'hand' mode, and a grab has to be decided by the
   * same camera that drew the lid - so this projects the lid's three corners and
   * hands back the band between them. The band, not a point: the lid is a face,
   * and a face seen from a slanted camera is a band whose width is the honest
   * answer to "how near is near".
   *
   * @returns {{x:number, y:number, top:number, bottom:number, pixelsPerWorld:number}}
   */
  lidScreenInfo() {
    const g = this.geometry();
    const rect = this.canvas.getBoundingClientRect();
    const camera = this.mode === "2d" ? this.camera2d : this.camera3d;
    const toScreen = (x, y, z) => {
      this._position.set(x, y, z).project(camera);
      return {
        x: rect.left + (this._position.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-this._position.y * 0.5 + 0.5) * rect.height,
      };
    };
    const centre = toScreen(g.lidX, 0, 0);
    const top = toScreen(g.lidX, g.half, 0);
    const bottom = toScreen(g.lidX, -g.half, 0);
    /* One world unit along x, measured on screen: the honest local scale, which
       under a perspective camera is not the same as it is at the origin. */
    const beside = toScreen(g.lidX + 1, 0, 0);
    const pixelsPerWorld = Math.max(1e-6, Math.abs(beside.x - centre.x));
    return { x: centre.x, y: centre.y, top: top.y, bottom: bottom.y, pixelsPerWorld };
  }

  /**
   * The world x-coordinate under the pointer, on the plane the lid lives in.
   *
   * This is what makes the lid draggable in both views without a second
   * implementation: the pointer is turned into a point in the scene once, using
   * the same camera that drew it, and the lid follows that point's x. In 2D that
   * is an exact screen-to-world mapping and the lid tracks the cursor exactly; in
   * 3D it is a ray meeting the plane z = 0, so the lid tracks the cursor exactly
   * where the lid actually is and drifts a little when the camera is looking
   * from far off to one side. That drift is honest - the pointer really does
   * travel across the plane at a different rate from a slant - but it is also
   * the reason the 2D view is the one to use for a careful compression.
   *
   * @returns {number|null} metres, or null if the pointer is not on the plane
   */
  lidPointerX(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const ny = -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    if (this.mode === "2d") {
      const halfH = this.pan2d.zoomHeight / 2;
      const halfW = halfH * (rect.width / Math.max(rect.height, 1));
      const x = this.pan2d.target.x + nx * halfW;
      return x / WORLD_PER_METRE;
    }
    this._pointer.set(nx, ny);
    this._ray.setFromCamera(this._pointer, this.camera3d);
    const hit = this._ray.ray.intersectPlane(this._plane, this._hit);
    return hit ? hit.x / WORLD_PER_METRE : null;
  }

  dispose() {
    this.orbit.dispose();
    this.pan2d.dispose();
    for (const mesh of [this.impactPoints, this.impactTicks, this.burnerBase, this.burnerTube, ...this.flameLayers]) {
      mesh.geometry?.dispose();
    }
    this.burnerEdges.dispose();
    this.burnerTubeEdges.dispose();
    this.boxEdges.dispose();
    for (const material of [
      this.wallMaterial, this.wallWarmMaterial, this.lidMaterial, this.floorHotMaterial,
      this.burnerEdgeMaterial, this.boxEdgeMaterial, this.chosenEdge,
      this.impactPoints.material, this.impactTicks.material,
      ...this.flameLayers.map((sprite) => sprite.material),
    ]) material.dispose();
    this.renderer.dispose();
  }
}
