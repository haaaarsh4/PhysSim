/**
 * geometry/reconstruction.js - surface reconstruction via marching squares.
 *
 * Ports the same from-scratch marching-squares algorithm used elsewhere
 * in this project: given a flattened 2D scalar field (nx*ny, row-major,
 * y-major - index = y*nx + x) and an iso-value, extract the crossing
 * contour as a list of line segments. No dependency on any contouring
 * library.
 */

// Edge numbering: 0=bottom, 1=right, 2=top, 3=left.
// Corner numbering: 0=bottom-left, 1=bottom-right, 2=top-right, 3=top-left.
const EDGE_TABLE = {
  0b0000: [], 0b1111: [],
  0b0001: [[3, 0]], 0b0010: [[0, 1]], 0b0011: [[3, 1]],
  0b0100: [[1, 2]], 0b0101: [[3, 0], [1, 2]], 0b0110: [[0, 2]], 0b0111: [[3, 2]],
  0b1000: [[2, 3]], 0b1001: [[2, 0]], 0b1010: [[0, 1], [2, 3]], 0b1011: [[2, 1]],
  0b1100: [[1, 3]], 0b1101: [[1, 0]], 0b1110: [[0, 3]],
};

function edgePoint(edge, x0, y0, x1, y1, c, iso) {
  switch (edge) {
    case 0: { const t = (iso - c[0]) / (c[1] - c[0] + 1e-12); return [x0 + t * (x1 - x0), y0]; }
    case 1: { const t = (iso - c[1]) / (c[2] - c[1] + 1e-12); return [x1, y0 + t * (y1 - y0)]; }
    case 2: { const t = (iso - c[3]) / (c[2] - c[3] + 1e-12); return [x0 + t * (x1 - x0), y1]; }
    case 3: { const t = (iso - c[0]) / (c[3] - c[0] + 1e-12); return [x0, y0 + t * (y1 - y0)]; }
    default: throw new Error(`bad edge ${edge}`);
  }
}

/**
 * @param {Float64Array} field flattened, index = y*nx + x
 * @param {number} nx, ny grid dimensions
 * @param {number} isoValue
 * @param {number} dx cell spacing
 * @param {[number,number]} origin world coords of field[0]
 * @returns {Array<[[number,number],[number,number]]>} line segments
 */
export function marchingSquares(field, nx, ny, isoValue, dx = 1, origin = [0, 0]) {
  const [ox, oy] = origin;
  const segments = [];

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = field[j * nx + i];
      const v1 = field[j * nx + i + 1];
      const v2 = field[(j + 1) * nx + i + 1];
      const v3 = field[(j + 1) * nx + i];
      const c = [v0, v1, v2, v3];

      let caseIdx = 0;
      if (v0 > isoValue) caseIdx |= 0b0001;
      if (v1 > isoValue) caseIdx |= 0b0010;
      if (v2 > isoValue) caseIdx |= 0b0100;
      if (v3 > isoValue) caseIdx |= 0b1000;

      const edges = EDGE_TABLE[caseIdx];
      if (!edges.length) continue;

      const x0 = ox + i * dx, y0 = oy + j * dx;
      const x1 = ox + (i + 1) * dx, y1 = oy + (j + 1) * dx;

      for (const [ea, eb] of edges) {
        segments.push([
          edgePoint(ea, x0, y0, x1, y1, c, isoValue),
          edgePoint(eb, x0, y0, x1, y1, c, isoValue),
        ]);
      }
    }
  }
  return segments;
}

export function contourLength(segments) {
  let total = 0;
  for (const [p0, p1] of segments) {
    total += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  }
  return total;
}
