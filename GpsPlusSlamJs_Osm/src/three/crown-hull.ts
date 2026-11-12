/**
 * The trees' crown geometry: a closed, low-polygon crown of revolution, the
 * one shape behind every tree form (crown-only and trunk-and-crown, near and
 * far). Shared by `city-objects.ts` and `trunk-trees.ts`.
 *
 * @see crown-hull.ts.md
 */

import * as THREE from "three";

/**
 * A closed crown of revolution about +y, from a pole at y 0 to a pole at
 * y 1, through `rings` of `[y, radius]`, `sides` around: 2 x sides x rings
 * triangles. Odd rings turn half a step, so each band is a strip of
 * alternating triangles. Each vertex carries a grey `color` from 0.86 at the
 * foot to 1.04 at the top, a shade the instance colour is multiplied by, so a
 * crown reads darker underneath at no cost.
 */
export function crownHull(
  sides: number,
  rings: readonly (readonly [number, number])[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const push = (point: readonly [number, number, number]): void => {
    positions.push(point[0], point[1], point[2]);
    const shade = 0.86 + 0.18 * point[1];
    colours.push(shade, shade, shade);
  };
  const tri = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
  ): void => {
    push(a);
    push(b);
    push(c);
  };
  const ringPoints = rings.map(([y, r], k) =>
    Array.from({ length: sides }, (_, i): [number, number, number] => {
      const a = ((i + (k % 2) * 0.5) / sides) * Math.PI * 2;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    }),
  );
  const first = ringPoints[0];
  const last = ringPoints[ringPoints.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError("a crown needs at least one ring");
  }
  const at = (ring: readonly [number, number, number][], i: number) =>
    ring[i % sides] as [number, number, number];
  for (let i = 0; i < sides; i++) {
    tri([0, 0, 0], at(first, i), at(first, i + 1));
    tri([0, 1, 0], at(last, i + 1), at(last, i));
  }
  for (let k = 0; k + 1 < ringPoints.length; k++) {
    const lo = ringPoints[k] as [number, number, number][];
    const hi = ringPoints[k + 1] as [number, number, number][];
    for (let i = 0; i < sides; i++) {
      if (k % 2 === 0) {
        tri(at(lo, i), at(hi, i), at(lo, i + 1));
        tri(at(lo, i + 1), at(hi, i), at(hi, i + 1));
      } else {
        tri(at(lo, i), at(hi, i + 1), at(lo, i + 1));
        tri(at(lo, i), at(hi, i), at(hi, i + 1));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}
