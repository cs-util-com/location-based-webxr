/**
 * The sampled surface IS the drawn surface (W10, finding R3-6).
 *
 * Why these tests matter:
 * The reported bug was that ground plates are "usually invisible, sitting under
 * the terrain" — with a 4 cm lift ladder that was supposed to prevent exactly
 * that. The ladder was not the problem. The ground plane carries heights only at
 * its posts and the GPU interpolates LINEARLY ACROSS EACH TRIANGLE between them,
 * while `heightAt` used to interpolate BILINEARLY: two different surfaces that
 * agree only at the posts and differ between them by the quad's twist term —
 * decimetres in city DEM data, an order of magnitude more than the ladder.
 *
 * So the fix is not a bigger lift, it is one surface. These tests are what make
 * that a property rather than an intention, and they use a REAL
 * `THREE.PlaneGeometry` as the oracle: the diagonal each quad is split on is a
 * property of a dependency, `heightfield.ts` must stay three-free because the
 * worker imports it, and the rule is therefore restated there. A three upgrade
 * that flipped the winding would silently restore the twist-term error, and this
 * file is what would stop it.
 *
 * @see heightfield.ts.md
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { GROUND_SEGMENTS, TERRAIN_SPACING_M } from "./building-view.js";
import {
  heightfieldFrom,
  TERRAIN_EXTENT_M,
  type HeightfieldData,
} from "./heightfield.js";

/** A field with deliberate TWIST, which is the only thing that separates the two
 * interpolations: a plane or a pure ramp is bilinear and barycentric alike. */
function twistedField(
  side: number,
  extentM: number,
  centreEnu = { x: 0, y: 0 },
): HeightfieldData {
  const heights = new Float32Array(side * side);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      // A saddle plus a step: the product term is the twist, and the modulo term
      // makes neighbouring quads twist in different directions so no single
      // diagonal choice can be accidentally right everywhere.
      heights[row * side + col] =
        col * row * 0.7 + ((col + row) % 3) * 4 - (col % 2) * 2.5;
    }
  }
  return {
    heights,
    side,
    extentM,
    centreEnu,
    datum: 0,
    hasData: true,
    missing: 0,
    total: side * side,
    reliefM: 1,
    nearReliefM: 1,
  };
}

/**
 * The height of the DRAWN plane at a plan position, from a real `PlaneGeometry`.
 *
 * Displaces every vertex exactly as `BuildingView.setTerrain` does, then finds
 * the triangle containing the point and interpolates barycentrically — which is
 * what a GPU does when it rasterises it.
 */
function drawnHeightAt(
  field: ReturnType<typeof heightfieldFrom>,
  segments: number,
  x: number,
  y: number,
): number {
  const geometry = new THREE.PlaneGeometry(
    field.extentM * 2,
    field.extentM * 2,
    segments,
    segments,
  );
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (index === null) throw new Error("PlaneGeometry has no index buffer");

  /**
   * Plane-local (x, y) and the height the view would displace it by.
   *
   * THE PLANE'S CENTRE IS ADDED BACK, exactly as `BuildingView.setTerrain`
   * does: the plane is positioned AT the field's `centreEnu`, so a plane-local
   * vertex is grid-local, while `heightAt` takes ENU in the scene's frame.
   * Feeding plane-local coordinates straight in is precisely the
   * desynchronisation that made this offset worth threading through.
   */
  const vertex = (i: number): { x: number; y: number; h: number } => {
    const vx = position.getX(i);
    const vy = position.getY(i);
    return {
      x: vx,
      y: vy,
      h: field.heightAt({
        x: vx + field.centreEnu.x,
        y: vy + field.centreEnu.y,
      }),
    };
  };

  for (let t = 0; t < index.count; t += 3) {
    const a = vertex(index.getX(t));
    const b = vertex(index.getX(t + 1));
    const c = vertex(index.getX(t + 2));

    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (area === 0) continue;
    const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
    const w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
    const w2 = 1 - w0 - w1;
    const inside = w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9;
    if (!inside) continue;
    return w0 * a.h + w1 * b.h + w2 * c.h;
  }
  throw new Error(`no triangle contains (${x}, ${y})`);
}

describe("heightAt reads the same surface the ground plane draws", () => {
  const SIDE = 6;
  const EXTENT = 50;
  const SEGMENTS = SIDE - 1;
  /**
   * Both window placements, because the offset must not change the surface.
   *
   * The walked centre is deliberately not a whole number of posts (the step here
   * is 20 m), so an implementation that rounded the offset to the lattice would
   * still be caught.
   */
  const WINDOWS = [
    { name: "at the frame origin", centreEnu: { x: 0, y: 0 } },
    { name: "after the user has walked away", centreEnu: { x: 137, y: -412 } },
  ];

  it.each(WINDOWS)(
    "agrees with the drawn triangle everywhere, not only at the posts ($name)",
    ({ centreEnu }) => {
      // THE PROPERTY. Sampled off the posts, a bilinear read differs from the
      // drawn surface by the quad's twist term — which is what sank the plates.
      //
      // RUN FOR BOTH WINDOWS because round 5B split plane-local from ENU: the
      // plane is positioned at the field's centre, so a vertex's own coordinates
      // are grid-local while `heightAt` is in the scene's frame. If the two ever
      // disagree about that offset, the ground the plane DRAWS and the ground
      // the buildings STAND ON part company by the walked distance — silently,
      // because each remains internally smooth and plausible.
      const field = heightfieldFrom(twistedField(SIDE, EXTENT, centreEnu));

      for (let i = 0; i < 40; i++) {
        // Deliberately irrational-ish offsets so no sample lands on a post or on
        // a diagonal, where every interpolation agrees and the test proves
        // nothing.
        const x = -EXTENT + ((i * 7.37) % (EXTENT * 2));
        const y = -EXTENT + ((i * 11.13) % (EXTENT * 2));
        expect(
          field.heightAt({ x: x + centreEnu.x, y: y + centreEnu.y }),
        ).toBeCloseTo(drawnHeightAt(field, SEGMENTS, x, y), 6);
      }
    },
  );

  it("pins the DIAGONAL, so a three upgrade cannot flip it silently", () => {
    // The one assumption `heightfield.ts` has to restate because it may not
    // import three. Measured from the real index buffer: the first quad splits
    // into (top-left, bottom-left, top-right) and (bottom-left, bottom-right,
    // top-right), i.e. the shared edge runs from the LOW corner to the HIGH
    // corner. If three ever reorders this, the sampler above starts reading the
    // wrong triangle for half of every quad — and only this test would notice.
    const geometry = new THREE.PlaneGeometry(4, 4, 2, 2);
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    if (index === null) throw new Error("PlaneGeometry has no index buffer");

    // `+ 0` NORMALISES NEGATIVE ZERO, which `toEqual` distinguishes from `0`.
    // `PlaneGeometry` computes `iy * step - half`, so the centre row comes out as
    // `-0` and the assertion fails with a diff of `0` against `-0`. This repo has
    // a follow-up doc about exactly this trap in another file; it is not worth a
    // second one.
    const corner = (slot: number): [number, number] => {
      const i = index.getX(slot);
      return [position.getX(i) + 0, position.getY(i) + 0];
    };

    // First triangle: top-left, bottom-left, top-right.
    expect(corner(0)).toEqual([-2, 2]);
    expect(corner(1)).toEqual([-2, 0]);
    expect(corner(2)).toEqual([0, 2]);
    // Second: bottom-left, bottom-right, top-right — sharing the low-to-high
    // diagonal with the first.
    expect(corner(3)).toEqual([-2, 0]);
    expect(corner(4)).toEqual([0, 0]);
    expect(corner(5)).toEqual([0, 2]);
  });

  it.each(WINDOWS)(
    "still returns the post value exactly AT a post ($name)",
    ({ centreEnu }) => {
      // The regression guard for everything that was already right: both
      // interpolations agree at the posts, and they must keep agreeing there or
      // the whole field has shifted. With a moved window it is also the check
      // that the posts themselves moved with it rather than only the query.
      const data = twistedField(SIDE, EXTENT, centreEnu);
      const field = heightfieldFrom(data);
      const step = (EXTENT * 2) / (SIDE - 1);

      for (let row = 0; row < SIDE; row++) {
        for (let col = 0; col < SIDE; col++) {
          expect(
            field.heightAt({
              x: centreEnu.x - EXTENT + col * step,
              y: centreEnu.y - EXTENT + row * step,
            }),
          ).toBeCloseTo(data.heights[row * SIDE + col] ?? 0, 5);
        }
      }
    },
  );

  it("keeps a lifted layer ABOVE the drawn ground, which is the whole point", () => {
    // The reported symptom, stated as a property. A plate vertex is placed at
    // `heightAt(p) + lift`; with one surface it is above the plane by exactly the
    // lift, everywhere. With the bilinear/barycentric mismatch it could be BELOW
    // it wherever the twist exceeded 4 cm.
    const field = heightfieldFrom(twistedField(SIDE, EXTENT));
    const LIFT = 0.04;

    for (let i = 0; i < 40; i++) {
      const x = -EXTENT + ((i * 5.91) % (EXTENT * 2));
      const y = -EXTENT + ((i * 13.77) % (EXTENT * 2));
      const plate = field.heightAt({ x, y }) + LIFT;
      expect(plate).toBeGreaterThan(drawnHeightAt(field, SEGMENTS, x, y));
    }
  });
});

describe("the plane's lattice IS the field's lattice", () => {
  it("has exactly one plane vertex per DEM post, per axis", () => {
    // THE PRECONDITION EVERYTHING ABOVE RESTS ON. Interpolating over "the same
    // triangles the plane draws" is only meaningful while the plane's posts and
    // the field's posts are the same grid. They are today — 233 segments over
    // 2.8 km at 12 m gives 234 vertices, and the field is 234 posts — but only
    // because `MAX_GROUND_SEGMENTS` does not currently bind.
    //
    // If the extent ever grows past the cap, the plane silently becomes coarser
    // than the field, the two surfaces diverge again, and every ground layer
    // starts sinking exactly as it did before W10 — with no test failing unless
    // this one exists. It fails loudly instead.
    const fieldSide = Math.max(
      2,
      Math.round((TERRAIN_EXTENT_M * 2) / TERRAIN_SPACING_M) + 1,
    );
    expect(GROUND_SEGMENTS + 1).toBe(fieldSide);
  });
});
