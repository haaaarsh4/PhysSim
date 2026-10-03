/**
 * geometry/mesh.js - a minimal, dependency-free triangle/line mesh.
 *
 * Used for two things: representing obstacle geometry, and holding the
 * output of geometry/reconstruction.js (the iso-contour extracted from a
 * fluid's dye field). `toOBJ()` / `fromOBJ()` are plain strings so this
 * works identically in the browser (export via Blob download, see
 * storage/io.js) and under Node (write with fs).
 */

export class Mesh {
  /**
   * @param {Float64Array|number[][]} vertices  flat or [[x,y,(z)], ...]
   * @param {number[][]} faces  vertex-index triples (triangles) or pairs (lines)
   */
  constructor(vertices, faces) {
    this.vertices = vertices.map((v) => Array.from(v));
    this.faces = faces.map((f) => Array.from(f));
  }

  get is2D() {
    return this.vertices.length > 0 && this.vertices[0].length === 2;
  }

  boundingBox() {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of this.vertices) {
      for (let a = 0; a < v.length; a++) {
        min[a] = Math.min(min[a], v[a]);
        max[a] = Math.max(max[a], v[a]);
      }
    }
    return { min, max };
  }

  toOBJ() {
    const lines = ["# exported by physics-workbench/geometry/mesh.js"];
    for (const v of this.vertices) {
      const z = v.length > 2 ? v[2] : 0;
      lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${z.toFixed(6)}`);
    }
    const keyword = this.faces.length && this.faces[0].length === 2 ? "l" : "f";
    for (const f of this.faces) {
      lines.push(`${keyword} ${f.map((i) => i + 1).join(" ")}`);
    }
    return lines.join("\n") + "\n";
  }

  static fromOBJ(text) {
    const verts = [];
    const faces = [];
    for (const raw of text.split("\n")) {
      const parts = raw.trim().split(/\s+/);
      if (parts[0] === "v") {
        verts.push(parts.slice(1, 4).map(Number));
      } else if (parts[0] === "f") {
        faces.push(parts.slice(1, 4).map((p) => parseInt(p.split("/")[0], 10) - 1));
      } else if (parts[0] === "l") {
        faces.push(parts.slice(1, 3).map((p) => parseInt(p.split("/")[0], 10) - 1));
      }
    }
    return new Mesh(verts, faces);
  }

  /** Build a 2D line mesh directly from marching-squares segments. */
  static fromSegments(segments) {
    const verts = [];
    const faces = [];
    for (const [p0, p1] of segments) {
      const i = verts.length;
      verts.push(p0, p1);
      faces.push([i, i + 1]);
    }
    return new Mesh(verts, faces);
  }
}
