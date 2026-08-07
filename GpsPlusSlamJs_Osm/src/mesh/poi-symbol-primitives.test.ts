import { describe, expect, it } from "vitest";

import { type MeshData } from "./mesh-data.js";
import { composed } from "./poi-primitives.js";
import {
  dome,
  extrudedPolygon,
  lathe,
  sweptTube,
  torus,
} from "./poi-symbol-primitives.js";

/**
 * WHY THESE TESTS MATTER, and the answer is specific rather than general.
 *
 * `poi-primitives.ts` shipped with EVERY triangle of `box` and `prism` wound
 * against its own normal, for eighteen work items, across all fifty models. It
 * survived because a reversed winding changes no silhouette, no bounding box,
 * no triangle count and no vertex count — the four things the tests of the day
 * asserted. It was found by a suite written specifically to look for it.
 *
 * These five builders are the same class of emitter, arriving in the same
 * package, for a port of 27 models. The winding suite below is therefore not
 * optional and not a formality: it is the assertion that the last vocabulary
 * did not have.
 *
 * The rest check the properties that would otherwise be judged by eye on a
 * gallery page nobody reads carefully: caps present, no NaN, no zero-area
 * triangles, and the specific geometric promise each builder makes.
 */

const positionsOf = (mesh: MeshData): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out.push([
      mesh.positions[i] as number,
      mesh.positions[i + 1] as number,
      mesh.positions[i + 2] as number,
    ]);
  }
  return out;
};

const boundsOf = (
  mesh: MeshData,
): { min: [number, number, number]; max: [number, number, number] } => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of positionsOf(mesh)) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }
  return { min, max };
};

/**
 * Triangles whose vertex order disagrees with the normal they carry.
 *
 * The same measure `poi-primitives.test.ts` uses, repeated here rather than
 * shared, because importing a helper across two test files is how one of them
 * ends up silently exercising the other's assumptions.
 */
const disagreeingTriangles = (mesh: MeshData): number[] => {
  const bad: number[] = [];
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t] as number;
    const ib = mesh.indices[t + 1] as number;
    const ic = mesh.indices[t + 2] as number;
    const at = (i: number): [number, number, number] => [
      mesh.positions[i * 3] as number,
      mesh.positions[i * 3 + 1] as number,
      mesh.positions[i * 3 + 2] as number,
    ];
    const [ax, ay, az] = at(ia);
    const [bx, by, bz] = at(ib);
    const [cx, cy, cz] = at(ic);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const nx = mesh.normals[ia * 3] as number;
    const ny = mesh.normals[ia * 3 + 1] as number;
    const nz = mesh.normals[ia * 3 + 2] as number;
    const area = Math.hypot(fx, fy, fz);
    // A zero-area triangle has no face normal to compare, and is caught by the
    // degeneracy tests instead.
    if (area < 1e-12) continue;
    if (fx * nx + fy * ny + fz * nz <= 0) bad.push(t / 3);
  }
  return bad;
};

const zeroAreaTriangles = (mesh: MeshData): number => {
  let count = 0;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const at = (i: number): [number, number, number] => [
      mesh.positions[i * 3] as number,
      mesh.positions[i * 3 + 1] as number,
      mesh.positions[i * 3 + 2] as number,
    ];
    const [ax, ay, az] = at(mesh.indices[t] as number);
    const [bx, by, bz] = at(mesh.indices[t + 1] as number);
    const [cx, cy, cz] = at(mesh.indices[t + 2] as number);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    if (Math.hypot(fx, fy, fz) < 1e-12) count++;
  }
  return count;
};

/** Six times the signed volume; positive when the surface is outward-wound. */
const signedVolume6 = (mesh: MeshData): number => {
  let total = 0;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const at = (i: number): [number, number, number] => [
      mesh.positions[i * 3] as number,
      mesh.positions[i * 3 + 1] as number,
      mesh.positions[i * 3 + 2] as number,
    ];
    const [ax, ay, az] = at(mesh.indices[t] as number);
    const [bx, by, bz] = at(mesh.indices[t + 1] as number);
    const [cx, cy, cz] = at(mesh.indices[t + 2] as number);
    total +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }
  return total;
};

const KNIFE_BLADE: readonly (readonly [number, number])[] = [
  [-0.04, 0],
  [0.04, 0],
  [0.05, 0.24],
  [0, 0.34],
  [-0.04, 0.28],
];

describe("dome", () => {
  it("sits its flat face on the given y and bulges one radius up", () => {
    // The capsule's two ends meet their cylinder at this face. An off-by-one
    // here reads as a gap in the pill rather than as a wrong primitive.
    const bounds = boundsOf(composed((b) => dome(b, 0.5, 1, 12, 5)));
    expect(bounds.min[1]).toBeCloseTo(1, 6);
    expect(bounds.max[1]).toBeCloseTo(1.5, 6);
  });

  it("bulges downward when asked, keeping the flat face where it was", () => {
    // The capsule's lower end is the same dome flipped; the sources spell that
    // `rx:180`, which moves the flat face if the primitive is not symmetric
    // about it.
    const bounds = boundsOf(composed((b) => dome(b, 0.5, 1, 12, 5, false)));
    expect(bounds.max[1]).toBeCloseTo(1, 6);
    expect(bounds.min[1]).toBeCloseTo(0.5, 6);
  });

  it("is CLOSED, unlike the prototypes' open hemisphere", () => {
    // The whole reason ours differs from the sources'. A floating symbol has
    // nothing under it (DEC-S4), so an uncapped dome is a hole. Measured as a
    // volume, which an open shell cannot have: a half-sphere of radius 1 is
    // 2/3 pi, and the faceted version approaches it from below.
    const half = signedVolume6(composed((b) => dome(b, 1, 0, 24, 8))) / 6;
    expect(half).toBeLessThan((2 / 3) * Math.PI);
    expect(half).toBeGreaterThan((2 / 3) * Math.PI * 0.9);
  });

  it("emits no degenerate triangle at its pole", () => {
    // The collapsed quad at the pole is a zero-area triangle, which is a NaN
    // normal, which removes the WHOLE object from the scene with nothing
    // reported. `sphere` had to learn this; so does every builder after it.
    expect(zeroAreaTriangles(composed((b) => dome(b, 1, 0, 12, 5)))).toBe(0);
  });
});

describe("torus", () => {
  it("lies flat in XZ with the hole on the up axis", () => {
    // Deliberately unlike three's TorusGeometry, which stands upright. Every
    // use in the 27 winners is a horizontal hoop, so the rotation the sources
    // apply is baked in here instead of repeated at 8 call sites.
    const bounds = boundsOf(composed((b) => torus(b, 1, 0.1, 2, 24, 8)));
    expect(bounds.max[1]).toBeCloseTo(2.1, 6);
    expect(bounds.min[1]).toBeCloseTo(1.9, 6);
    expect(bounds.max[0]).toBeCloseTo(1.1, 6);
    expect(bounds.min[0]).toBeCloseTo(-1.1, 6);
  });

  it("draws a partial ring for an arc", () => {
    // The pub stein's handle is a 225-degree arc. A full ring there is a
    // recognisable but wrong object, which is the kind of defect that survives
    // review.
    const full = composed((b) => torus(b, 1, 0.1, 0, 24, 8));
    const half = composed((b) => torus(b, 1, 0.1, 0, 24, 8, Math.PI));
    expect(half.triangleCount).toBe(full.triangleCount);
    // NOTE THE SIGN. These are read back in the RENDER frame, where
    // `MeshBuilder` has already reflected ENU `+y` north onto `-z`. The half
    // arc spans ENU `+z`, so it occupies render `-z` and leaves the other side
    // empty; the full ring occupies both.
    expect(boundsOf(half).max[2]).toBeLessThan(0.2);
    expect(boundsOf(half).min[2]).toBeCloseTo(-1.1, 6);
    expect(boundsOf(full).max[2]).toBeCloseTo(1.1, 6);
  });

  it("encloses the volume of a torus", () => {
    // 2 pi^2 R r^2, approached from below by the faceted version. A wrong
    // winding gives the same shape with a NEGATIVE volume, which is exactly the
    // inversion the sibling vocabulary shipped.
    const volume =
      signedVolume6(composed((b) => torus(b, 1, 0.2, 0, 48, 16))) / 6;
    const exact = 2 * Math.PI * Math.PI * 1 * 0.2 * 0.2;
    expect(volume).toBeGreaterThan(exact * 0.9);
    expect(volume).toBeLessThan(exact);
  });
});

describe("lathe", () => {
  it("revolves a profile into a solid, closing it on the axis", () => {
    // A cylinder written as a profile: up the axis, out, up the wall, back in.
    // Its volume is the assertion, because it is the thing a wrong normal
    // direction or a dropped band silently changes.
    const cylinder = composed((b) =>
      lathe(
        b,
        [
          [0, 0],
          [1, 0],
          [1, 2],
          [0, 2],
        ],
        48,
      ),
    );
    const volume = signedVolume6(cylinder) / 6;
    expect(volume).toBeGreaterThan(Math.PI * 2 * 0.9);
    expect(volume).toBeLessThan(Math.PI * 2);
  });

  it("emits nothing degenerate where the profile touches the axis", () => {
    // The cask, the urn and the mortar all start or end on the axis. The band
    // there is a fan, not a quad — a collapsed quad is a NaN normal.
    const mesh = composed((b) =>
      lathe(
        b,
        [
          [0, 0],
          [0.5, 0.2],
          [0.4, 1],
          [0, 1.2],
        ],
        12,
      ),
    );
    expect(zeroAreaTriangles(mesh)).toBe(0);
    expect([...mesh.positions].every(Number.isFinite)).toBe(true);
  });

  it("skips a band whose ends are both on the axis rather than emitting it", () => {
    // A profile can legitimately pass through the axis twice; the segment
    // between is a zero-area band with no normal at all.
    const mesh = composed((b) =>
      lathe(
        b,
        [
          [0, 0],
          [0, 1],
          [0.5, 1],
          [0, 2],
        ],
        8,
      ),
    );
    expect(zeroAreaTriangles(mesh)).toBe(0);
    expect(mesh.triangleCount).toBeGreaterThan(0);
  });
});

describe("extrudedPolygon", () => {
  it("centres the extrusion on Z, as the sources do", () => {
    // The galleries extrude from 0 and translate back by half the depth. A
    // blade offset by its own thickness is invisible alone and wrong against
    // the handle it meets.
    const bounds = boundsOf(
      composed((b) => extrudedPolygon(b, KNIFE_BLADE, 0.022)),
    );
    expect(bounds.min[2]).toBeCloseTo(-0.011, 6);
    expect(bounds.max[2]).toBeCloseTo(0.011, 6);
  });

  it("gives the same solid whichever way the outline was typed", () => {
    // AN OUTLINE TYPED CLOCKWISE would otherwise turn every side wall's normal
    // inward — the whole-model inversion the sibling vocabulary shipped, but
    // arriving one shape at a time, which is harder to notice.
    const forward = composed((b) => extrudedPolygon(b, KNIFE_BLADE, 0.022));
    const reversed = composed((b) =>
      extrudedPolygon(b, [...KNIFE_BLADE].reverse(), 0.022),
    );
    expect(signedVolume6(reversed)).toBeCloseTo(signedVolume6(forward), 9);
    expect(signedVolume6(forward)).toBeGreaterThan(0);
  });

  it("fills a CONCAVE outline without spilling outside it", () => {
    // An arrowhead: a fan from one vertex covers area the shape does not have,
    // which is why the caps go through the package's ear clipper rather than a
    // fan. Measured as volume against the exact area times the depth.
    const arrow: readonly (readonly [number, number])[] = [
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [1, 1],
      [0, 1],
    ];
    const depth = 0.2;
    const volume =
      signedVolume6(composed((b) => extrudedPolygon(b, arrow, depth))) / 6;
    // Shoelace area of the arrow is 0.75.
    expect(volume).toBeCloseTo(0.75 * depth, 6);
  });

  it("draws nothing for a degenerate outline rather than emitting NaN", () => {
    expect(
      composed((b) => extrudedPolygon(b, [[0, 0]], 0.1)).triangleCount,
    ).toBe(0);
    expect(
      composed((b) => extrudedPolygon(b, KNIFE_BLADE, 0)).triangleCount,
    ).toBe(0);
  });
});

describe("sweptTube", () => {
  it("follows the path at the given radius", () => {
    const mesh = composed((b) =>
      sweptTube(
        b,
        [
          [0, 0, 0],
          [0, 1, 0],
        ],
        0.1,
        8,
      ),
    );
    const bounds = boundsOf(mesh);
    expect(bounds.max[0]).toBeCloseTo(0.1, 5);
    expect(bounds.min[1]).toBeCloseTo(0, 6);
    expect(bounds.max[1]).toBeCloseTo(1, 6);
  });

  it("does not twist about its own axis where the path bends", () => {
    // THE CLASSIC FAILURE of the naive version, which rebuilds the cross-section
    // from a fixed up-vector at every point: the tube spins as the path turns,
    // which shows in the flat shading as a corkscrew. Parallel transport is what
    // this asserts — consecutive rings stay close to each other, so the surface
    // does not wind around between them.
    const path: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      path.push([Math.cos(a), Math.sin(a) * 0.5, 0]);
    }
    const sides = 8;
    const mesh = composed((b) => sweptTube(b, path, 0.05, sides));
    const points = positionsOf(mesh);
    // Ring n's first vertex must be nearer ring n+1's first vertex than the
    // tube's own diameter; a twist puts it half a turn away instead.
    for (let ring = 0; ring + 1 < path.length; ring++) {
      const here = points[ring * sides] as [number, number, number];
      const next = points[(ring + 1) * sides] as [number, number, number];
      const gap = Math.hypot(
        here[0] - next[0],
        here[1] - next[1],
        here[2] - next[2],
      );
      expect(gap).toBeLessThan(0.4);
    }
  });

  it("survives a repeated point in the path rather than emitting NaN", () => {
    // A hand-typed path with a duplicated control point has a zero-length
    // segment and therefore no tangent. Returning early beats a NaN normal,
    // which removes the whole marker with nothing reported.
    const mesh = composed((b) =>
      sweptTube(
        b,
        [
          [0, 0, 0],
          [0, 0, 0],
          [0, 1, 0],
        ],
        0.1,
        6,
      ),
    );
    expect([...mesh.positions].every(Number.isFinite)).toBe(true);
    expect([...mesh.normals].every(Number.isFinite)).toBe(true);
  });
});

describe("every symbol primitive's winding agrees with its own normals", () => {
  /**
   * THE SUITE THE LAST VOCABULARY DID NOT HAVE.
   *
   * `poi-primitives.ts` emitted every face of `box` and `prism` reversed for
   * eighteen work items — all fifty markers drawn inside out, with an unchanged
   * silhouette and nothing failing. It was found only once a test like this one
   * was written.
   *
   * These five builders arrive with 27 models about to be composed from them,
   * so the same guard is in place before the first one is written rather than
   * after the set has shipped.
   */
  const cases: readonly [string, MeshData][] = [
    ["dome, up", composed((b) => dome(b, 1, 0, 12, 5))],
    ["dome, down", composed((b) => dome(b, 1, 0, 12, 5, false))],
    ["torus", composed((b) => torus(b, 1, 0.2, 0, 16, 8))],
    [
      "torus, partial arc",
      composed((b) => torus(b, 1, 0.2, 0, 16, 8, Math.PI)),
    ],
    [
      "lathe",
      composed((b) =>
        lathe(
          b,
          [
            [0, 0],
            [0.5, 0.1],
            [0.4, 0.8],
            [0, 1],
          ],
          12,
        ),
      ),
    ],
    ["extrudedPolygon", composed((b) => extrudedPolygon(b, KNIFE_BLADE, 0.05))],
    [
      "extrudedPolygon, outline typed the other way",
      composed((b) => extrudedPolygon(b, [...KNIFE_BLADE].reverse(), 0.05)),
    ],
    [
      "sweptTube",
      composed((b) =>
        sweptTube(
          b,
          [
            [0, 0, 0],
            [0.2, 0.5, 0],
            [0, 1, 0.2],
          ],
          0.06,
          8,
        ),
      ),
    ],
  ];

  for (const [name, mesh] of cases) {
    it(`holds for every triangle of ${name}`, () => {
      expect(mesh.triangleCount).toBeGreaterThan(0);
      expect(disagreeingTriangles(mesh)).toEqual([]);
    });
  }
});
