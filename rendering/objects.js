/**
 * rendering/objects.js - the shapes a scene is built out of.
 *
 * A wall, a wedge (the ramp), a platform, a block, a sphere. Each one is two
 * things at once: an SDF, which is what the physics sees (geometry/sdf.js,
 * consumed by simulation/collision_system.js), and a mesh, which is what the eye
 * sees. This file owns the second half, and `sync` is its only entry point - hand
 * it the list and it adds, moves and removes meshes to match, so nothing here has
 * to know who edited what or why.
 *
 * A ramp is drawn from the same profile the solver is handed rather than from a
 * box guessed to look like one: it is a right triangle - /| - with a base on the
 * floor, a back you can push against, and a slope at atan(hh/hw). One definition,
 * two consumers, and no way for the slope you can see and the slope a ball
 * rolls down to be different slopes.
 *
 * Every shape is authored in the x/y plane and extruded straight through the
 * world's depth. That is what makes the 2D view honest rather than decorative:
 * it is the same object seen end on, not a second scene that happens to look
 * similar. It also means a shape's depth must be at least as deep as the floor
 * is wide, or a ball could be behind one and pass through it on screen.
 */
import * as THREE from "three";
import { wedgeProfile } from "../geometry/sdf.js";

export class ObjectLayer {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.depth = opts.depth ?? 2;
    this.items = new Map(); // id -> { mesh, outline, signature }

    // One material for every shape: they are the same stuff, and the point of
    // the layer is that a wall and a ramp look like they were cut from it.
    this.material = new THREE.MeshStandardMaterial({
      color: opts.ink ?? 0x34343f, roughness: 0.5, metalness: 0.12,
    });
    this.outlineMaterial = new THREE.LineBasicMaterial({ color: opts.accent ?? 0x9e00ff });
  }

  /** The wedge's own section, extruded through the world's depth: a shape the
   *  renderer and the solver read out of the one profile function. */
  _wedgeGeometry(spec) {
    const hz = spec.hd ?? this.depth / 2;
    const [first, ...rest] = wedgeProfile(spec.hw, spec.hh);
    const section = new THREE.Shape();
    section.moveTo(first[0], first[1]);
    for (const [x, y] of rest) section.lineTo(x, y);
    section.closePath();
    const geometry = new THREE.ExtrudeGeometry(section, {
      depth: hz * 2, bevelEnabled: false, curveSegments: 1,
    });
    geometry.translate(0, 0, -hz); // ExtrudeGeometry starts its sweep at z = 0
    return geometry;
  }

  _geometry(spec) {
    if (spec.kind === "ball") return new THREE.SphereGeometry(spec.r, 28, 20);
    if (spec.kind === "wedge") return this._wedgeGeometry(spec);
    return new THREE.BoxGeometry(spec.hw * 2, spec.hh * 2, (spec.hd ?? this.depth / 2) * 2);
  }

  /**
   * The outline a selected shape wears. A box shows its real edges; a sphere
   * gets a wireframe cage built from the same icosahedron the particles are
   * drawn with, so a selected sphere-object and a selected ball belong to the
   * same visual family.
   */
  _outlineGeometry(spec) {
    if (spec.kind === "ball") {
      return new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(spec.r * 1.01, 1));
    }
    if (spec.kind === "wedge") return new THREE.EdgesGeometry(this._wedgeGeometry(spec));
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(spec.hw * 2, spec.hh * 2, (spec.hd ?? this.depth / 2) * 2));
  }

  /** What geometry dimensions it depends on. A size edit rebuilds the mesh;
   *  pose edits only move it. */
  _signature(spec) {
    if (spec.kind === "ball") return `ball|${spec.r}`;
    if (spec.kind === "wedge") return `wedge|${spec.hw}|${spec.hh}|${spec.hd ?? this.depth / 2}`;
    return `box|${spec.hw}|${spec.hh}|${spec.hd ?? this.depth / 2}`;
  }

  _create(spec) {
    const mesh = new THREE.Mesh(this._geometry(spec), this.material);
    // A wall throws a shadow across the floor the same way a ball does, which
    // is most of what makes a slope read as actually standing in the scene.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const outline = new THREE.LineSegments(this._outlineGeometry(spec), this.outlineMaterial);
    // nudged out by a hair: an edge drawn exactly on a face z-fights with it
    outline.scale.setScalar(1.006);
    outline.visible = false;
    mesh.add(outline);
    this.scene.add(mesh);
    return { mesh, outline, signature: this._signature(spec) };
  }

  _dispose(item) {
    this.scene.remove(item.mesh);
    item.mesh.geometry.dispose();
    item.outline.geometry.dispose();
  }

  /** Bring the drawn scene in line with `specs`. */
  sync(specs) {
    const live = new Set();
    for (const spec of specs) {
      live.add(spec.id);
      let item = this.items.get(spec.id);
      if (item && item.signature !== this._signature(spec)) {
        this._dispose(item);
        this.items.delete(spec.id);
        item = null;
      }
      if (!item) {
        item = this._create(spec);
        this.items.set(spec.id, item);
      }
      item.mesh.position.set(spec.x, spec.y, spec.z ?? 0);
      item.mesh.rotation.set(
        spec.rotation?.x ?? 0,
        spec.rotation?.y ?? 0,
        spec.rotation?.z ?? spec.angle ?? 0,
        "XYZ"
      );
    }
    for (const [id, item] of this.items) {
      if (live.has(id)) continue;
      this._dispose(item);
      this.items.delete(id);
    }
  }

  /** @param {string|null} id the one selected shape, or none */
  setSelected(id) {
    for (const [key, item] of this.items) item.outline.visible = key === id;
  }

  /** @returns {{id:string, point:THREE.Vector3, distance:number}|null} the
   *  nearest shape the ray meets, or null. */
  pick(raycaster) {
    const meshes = [];
    for (const item of this.items.values()) meshes.push(item.mesh);
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const id = [...this.items.entries()].find(([, item]) => item.mesh === hit.object)?.[0] ?? null;
    return id ? { id, point: hit.point.clone(), distance: hit.distance } : null;
  }

  dispose() {
    for (const [, item] of this.items) this._dispose(item);
    this.items.clear();
    this.material.dispose();
    this.outlineMaterial.dispose();
  }
}
