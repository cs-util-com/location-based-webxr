// Pure helpers of the protect prototype: the author's brush marks as a
// weight per vertex, the extra simplifier attribute that makes changes in
// a marked region expensive, and the triangle counts inside and outside
// it. No DOM and no three.js, so the Worker and the page share it.
//
// How protection works with the unchanged progressive simplifier of
// ../model-lod-1/lod-simplify.js: its error is a generalized quadric over
// position plus weighted vertex attributes. A marked vertex gets extra
// attribute dimensions equal to `strength * weight * (its normalized
// position, its texture coordinate)`; an unmarked one gets zeros. Inside a
// marked region those dimensions follow the surface, so moving a vertex
// there costs about (1 + strength^2) times its plain error; a collapse
// across the region's edge costs the jump from the region's values to
// zero. The simplifier therefore spends its error budget elsewhere first.
// A flat marked area with no picture detail can still lose triangles,
// because removing them changes nothing that shows.

/** The brush strengths offered, as the multiplier of the extra
 *  dimensions. Parameters: see the README. */
export const STRENGTHS = [
  { id: "gentle", label: "Gentle", value: 3 },
  { id: "strong", label: "Strong", value: 10 },
  { id: "hold", label: "Hold", value: 40 },
];
export const DEFAULT_STRENGTH = "strong";

/** The brush radius as a share of the model's box diagonal. */
export const DEFAULT_BRUSH = 0.04;
export const BRUSH_MIN = 0.01;
export const BRUSH_MAX = 0.15;

/** The inner part of a dab that marks fully; the rest fades out. */
const FULL_INSIDE = 0.6;
/** A vertex whose normal turns further from the viewer than this (the
 *  cosine) is not marked, so a dab does not reach through to the back. */
const FACING_MIN = -0.2;

/**
 * Apply one dab to the weights in place. A dab is
 * `{ center: [x, y, z], radius, view: [x, y, z] | null, erase: boolean }`
 * in the part's own coordinates; `view` points from the eye to the centre.
 * @returns {boolean} whether any weight changed
 */
export function applyDab(weights, positions, normals, dab) {
  if (!dab || !(dab.radius > 0)) {
    return false;
  }
  const [cx, cy, cz] = dab.center;
  const r2 = dab.radius * dab.radius;
  const v = dab.view;
  let changed = false;
  for (let i = 0; i < weights.length; i++) {
    const dx = positions[3 * i] - cx;
    const dy = positions[3 * i + 1] - cy;
    const dz = positions[3 * i + 2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) {
      continue;
    }
    if (v && normals) {
      const facing = -(
        normals[3 * i] * v[0] +
        normals[3 * i + 1] * v[1] +
        normals[3 * i + 2] * v[2]
      );
      if (facing < FACING_MIN) {
        continue;
      }
    }
    const t = Math.sqrt(d2) / dab.radius;
    const w =
      t <= FULL_INSIDE ? 1 : 1 - (t - FULL_INSIDE) / (1 - FULL_INSIDE);
    const next = dab.erase ? Math.min(weights[i], 1 - w) : Math.max(weights[i], w);
    if (next !== weights[i]) {
      weights[i] = next;
      changed = true;
    }
  }
  return changed;
}

/** Weights from a list of dabs, applied in order. */
export function weightsFromDabs(count, positions, normals, dabs) {
  const weights = new Float32Array(count);
  for (const dab of dabs) {
    applyDab(weights, positions, normals, dab);
  }
  return weights;
}

/** Whether any vertex is marked. */
export function anyMarked(weights) {
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > 0) {
      return true;
    }
  }
  return false;
}

/**
 * The extra simplifier attribute for marked vertices:
 * `strength * weight * (normalized position, texture coordinate)`.
 * Positions are normalized to the unit box diagonal as the simplifier
 * normalizes its own.
 * @returns {{ data: Float32Array, size: number, weight: 1 }}
 */
export function protectionAttribute(positions, uvs, weights, strength) {
  const n = weights.length;
  const size = uvs ? 5 : 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const x = positions[3 * i + c];
      lo[c] = Math.min(lo[c], x);
      hi[c] = Math.max(hi[c], x);
    }
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const data = new Float32Array(n * size);
  for (let i = 0; i < n; i++) {
    const s = strength * weights[i];
    if (s === 0) {
      continue;
    }
    for (let c = 0; c < 3; c++) {
      data[i * size + c] = (s * (positions[3 * i + c] - lo[c])) / diag;
    }
    if (uvs) {
      data[i * size + 3] = s * uvs[2 * i];
      data[i * size + 4] = s * uvs[2 * i + 1];
    }
  }
  return { data, size, weight: 1 };
}

/** A triangle counts as marked when its corners' mean weight is at least
 *  one half. @returns {{ marked: number, rest: number }} */
export function regionCounts(indices, weights) {
  let marked = 0;
  let rest = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const w =
      weights[indices[t]] + weights[indices[t + 1]] + weights[indices[t + 2]];
    if (w >= 1.5) {
      marked++;
    } else {
      rest++;
    }
  }
  return { marked, rest };
}
