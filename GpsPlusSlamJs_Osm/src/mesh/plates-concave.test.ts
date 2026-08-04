import { describe, expect, it } from "vitest";

import { clipToBbox, type Bbox } from "../spatial/clip.js";
import type { OsmGeometry } from "../model/osm-geometry.js";
import { triangulate } from "./triangulate.js";
import type { EnuPoint } from "./enu.js";

/**
 * WHY THIS FILE EXISTS (DEC-R7b-5). A testing session at the Tower of London
 * reported the Thames rendering BLACK once landuse was switched on, on a build
 * that already contained round 7's plate-winding fix — so it is not that defect
 * coming back.
 *
 * Nothing in the colour path can produce black: `PLATE_COLOUR` is a single light
 * grey and the plate material has no `vertexColors`. The remaining mechanism the
 * code itself warns about is DEGENERATE GEOMETRY. `spatial/clip.ts` says plainly
 * that Sutherland–Hodgman "can produce degenerate 'seams' for concave subjects",
 * and that since `2262e6a` `mesh/plates.ts` clips and hands the result STRAIGHT
 * TO `triangulate` — "the rendering path the artefact does matter for".
 *
 * A river is the textbook concave subject. A zero-area triangle has no defined
 * face normal, `flatShading` derives its shading FROM that normal, and the
 * scene's only non-directional light is an ambient at 0.25 — so a degenerate
 * face renders near-black beside its correctly-lit neighbours.
 *
 * WHAT THIS FILE IS FOR, precisely: it pins the property that would make that
 * possible, so the question "can this path emit a zero-area triangle" has an
 * answer that is checked rather than argued. It is deliberately written against
 * the two library functions rather than the demo, because that is where the
 * artefact would originate.
 */

/** A river-shaped polygon: a long meander, strongly concave, crossing the bbox. */
function meander(): OsmGeometry {
  const north: { lat: number; lng: number }[] = [];
  const south: { lat: number; lng: number }[] = [];
  // A sine-wave channel of roughly constant width, sampled finely enough that
  // consecutive points are close together — which is the condition under which a
  // clipper is most likely to emit a coincident pair.
  for (let i = 0; i <= 60; i++) {
    const lng = -0.12 + (i / 60) * 0.24;
    const centre = 51.505 + Math.sin(i / 4) * 0.004;
    north.push({ lat: centre + 0.0016, lng });
  }
  for (let i = 60; i >= 0; i--) {
    const lng = -0.12 + (i / 60) * 0.24;
    const centre = 51.505 + Math.sin(i / 4) * 0.004;
    south.push({ lat: centre - 0.0016, lng });
  }
  const ring = [...north, ...south];
  ring.push(ring[0] as { lat: number; lng: number });
  return { kind: "polygon", rings: [ring] };
}

/** Twice the signed area of a triangle, in the plane. */
function doubleArea(a: EnuPoint, b: EnuPoint, c: EnuPoint): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
}

describe("a concave river polygon through the plate path", () => {
  // Deliberately narrower than the polygon in both axes, so every one of the
  // four Sutherland–Hodgman passes actually cuts something. A bbox that
  // contained the subject would exercise nothing.
  const bbox: Bbox = {
    south: 51.5,
    north: 51.51,
    west: -0.08,
    east: 0.08,
  };

  it("survives the clip with a usable ring", () => {
    const clipped = clipToBbox(meander(), bbox);
    expect(clipped).toBeDefined();
    expect(clipped?.kind).toBe("polygon");
    if (clipped?.kind !== "polygon") throw new Error("not a polygon");
    expect(clipped.rings[0]?.length ?? 0).toBeGreaterThan(3);
  });

  it("emits NO zero-area triangle, which is what would render black", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A degenerate face has an undefined
    // normal; under `flatShading` that is what shades it, and against a 0.25
    // ambient it reads as black rather than as a glitch.
    const clipped = clipToBbox(meander(), bbox);
    if (clipped?.kind !== "polygon") throw new Error("not a polygon");
    const rings = clipped.rings.map((ring) =>
      // The same lat/lng -> planar mapping the plate builder uses in spirit:
      // any affine projection preserves "is this triangle degenerate".
      ring.map((p) => ({ x: p.lng * 1e5, y: p.lat * 1e5 })),
    );

    const result = triangulate(rings);
    expect(result.indices.length).toBeGreaterThan(0);

    const degenerate: number[] = [];
    for (let t = 0; t * 3 < result.indices.length; t++) {
      const a = result.vertices[result.indices[t * 3] as number] as EnuPoint;
      const b = result.vertices[
        result.indices[t * 3 + 1] as number
      ] as EnuPoint;
      const c = result.vertices[
        result.indices[t * 3 + 2] as number
      ] as EnuPoint;
      // 1e-6 in a frame scaled to ~metres: far below any real triangle here and
      // far above floating-point noise on a legitimate sliver.
      if (doubleArea(a, b, c) < 1e-6) degenerate.push(t);
    }
    expect(degenerate).toEqual([]);
  });

  it("still forces ears on this ring, and that is reported rather than hidden", () => {
    // THE INPUT REALLY IS BAD, and the fix does not pretend otherwise.
    // `forcedEars` is the triangulator admitting it could not find a valid ear
    // and took one anyway; the degenerate-triangle filter changes what is
    // EMITTED, not whether the ring was well-formed. Suppressing this counter
    // alongside the filter would have hidden the one signal that says the clip
    // produced a seam in the first place.
    const clipped = clipToBbox(meander(), bbox);
    if (clipped?.kind !== "polygon") throw new Error("not a polygon");
    const rings = clipped.rings.map((ring) =>
      ring.map((p) => ({ x: p.lng * 1e5, y: p.lat * 1e5 })),
    );
    expect(triangulate(rings).forcedEars).toBeGreaterThan(0);
  });
});
