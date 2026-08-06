/**
 * The GPU ground's arithmetic (W23).
 *
 * WHY THIS FILE IS THE WHOLE SAFETY NET. jsdom cannot compile a shader, so the
 * GLSL itself is untestable in CI — every claim about the GPU path has to be made
 * here, about a JS function the shader mirrors line for line.
 *
 * THE ASSERTION THAT MATTERS is that `sampleTerrainTexture` agrees with
 * `heightAt`. The CPU and GPU displacement paths both ship and are switchable at
 * runtime, so **the same ground must come out of both** — otherwise switching the
 * toggle moves the buildings relative to the terrain, and the GPU becomes a
 * second source of truth for ground height. That is precisely the defect
 * DEC-R2-21 rejected `geo-three` for, and it would be self-inflicted here.
 */

import { describe, expect, it } from "vitest";

import { heightfieldFrom, type HeightfieldData } from "./heightfield.js";
import {
  sampleTerrainTexture,
  terrainNormal,
  terrainTextureFrom,
  textureUv,
} from "./terrain-texture.js";

/**
 * A field with a known shape and a REALISTIC datum.
 *
 * The datum is 53 m, Cologne's actual ground level, because a datum of 0 would
 * pass a test that uploads the heights verbatim — the exact bug this module's
 * header warns about.
 */
function field(
  side: number,
  datum = 53,
  shape = (col: number, row: number) => col + row * 2,
  centreEnu = { x: 0, y: 0 },
): HeightfieldData {
  const heights = new Float32Array(side * side);
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      heights[row * side + col] = datum + shape(col, row);
    }
  }
  return {
    heights,
    side,
    extentM: 100,
    centreEnu,
    datum,
    hasData: true,
    missing: 0,
    total: side * side,
    reliefM: 0,
    nearReliefM: 0,
  };
}

/**
 * A window that has walked away from the frame origin.
 *
 * Deliberately NOT a round multiple of the post spacing (200 m / 8 posts = 25 m
 * here), so an implementation that quietly rounded the offset to whole posts
 * would still be caught.
 */
const WALKED = { x: 137, y: -412 };

describe("terrainTextureFrom", () => {
  it("stores DATUM-RELATIVE heights, not the absolute metres it is given", () => {
    // THE TRAP THIS MODULE EXISTS TO AVOID. `heightAt` subtracts the datum on
    // READ, so the array itself is absolute — ~53 m at Cologne. Uploading it
    // verbatim lifts the whole city off a camera framed at y = 10, and the
    // symptom is "the buildings are floating" rather than anything pointing here.
    const texture = terrainTextureFrom(field(3, 53));
    expect(texture?.data[0]).toBeCloseTo(0, 6);
    expect(texture?.data[1]).toBeCloseTo(1, 6);
  });

  it("derives the post pitch, because the field does not carry one", () => {
    // There is no `spacing` field on `HeightfieldData`; the shader needs it as
    // its own uniform, and computing it in two places is how the two drift.
    const texture = terrainTextureFrom(field(5));
    expect(texture?.spacingM).toBeCloseTo((100 * 2) / 4, 6);
  });

  it("returns undefined for a field with no data, rather than a flat one", () => {
    // A flat surface shaped exactly like a DEM outage reads as terrain. The
    // caller has to be able to tell them apart to fall back honestly.
    const empty: HeightfieldData = { ...field(3), hasData: false };
    expect(terrainTextureFrom(empty)).toBeUndefined();
  });

  it("turns a non-finite post into the datum rather than into NaN", () => {
    // One NaN vertex removes the entire draw call in three.js with no error —
    // the silent-absence failure this round has met four times.
    const broken = field(3);
    broken.heights[4] = Number.NaN;
    const texture = terrainTextureFrom(broken);
    expect(texture?.data[4]).toBe(0);
    for (const value of texture?.data ?? []) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("sampleTerrainTexture — agrees with heightAt", () => {
  /**
   * THE TEXTURE IS GRID-LOCAL; `heightAt` IS IN THE SCENE'S FRAME.
   *
   * That is the one coordinate distinction in this file, and it is deliberate:
   * the ground plane is POSITIONED at the field's `centreEnu`, so a plane-local
   * vertex coordinate — which is what the vertex shader reads as `position.xy`
   * — is already grid-local. Keeping the texture in that space is what lets the
   * GLSL stay free of an origin-offset uniform: there is nothing left to offset.
   *
   * So a comparison against `heightAt` has to add the window's centre back, and
   * this helper is the single place that says so — it returns both readings
   * rather than asserting, so the assertion stays visible at each call site.
   */
  const bothAt = (
    data: HeightfieldData,
    texture: NonNullable<ReturnType<typeof terrainTextureFrom>>,
    local: { x: number; y: number },
  ) => ({
    fromTexture: sampleTerrainTexture(texture, local.x, local.y),
    fromSampler: heightfieldFrom(data).heightAt({
      x: local.x + data.centreEnu.x,
      y: local.y + data.centreEnu.y,
    }),
  });

  it("matches heightAt across the field, which is the whole contract", () => {
    // THE ASSERTION THE GPU PATH RESTS ON. Both displacement paths ship, so the
    // same ground has to come out of both; if they disagree, toggling the mode
    // moves the buildings relative to the terrain.
    const data = field(9);
    const texture = terrainTextureFrom(data);
    if (texture === undefined) throw new Error("no texture");

    for (let x = -100; x <= 100; x += 7) {
      for (let y = -100; y <= 100; y += 7) {
        const { fromTexture, fromSampler } = bothAt(data, texture, { x, y });
        expect(fromTexture).toBeCloseTo(fromSampler, 5);
      }
    }
  });

  it("still matches once the window has WALKED away from the frame origin", () => {
    // WHY THIS TEST MATTERS. This is the CPU/GPU agreement that round 5B could
    // have broken silently. `heightAt` now subtracts the window's centre before
    // indexing the grid; the texture does not, because the plane carries that
    // offset in its transform. Get the split wrong in either direction and the
    // two paths disagree by the walked distance — the GPU ground sliding under
    // buildings placed by the CPU sampler, which is exactly the class of defect
    // DEC-R2-21 rejected `geo-three` for.
    const data = field(9, 53, (col, row) => col + row * 2, WALKED);
    const texture = terrainTextureFrom(data);
    if (texture === undefined) throw new Error("no texture");

    for (let x = -100; x <= 100; x += 7) {
      for (let y = -100; y <= 100; y += 7) {
        const { fromTexture, fromSampler } = bothAt(data, texture, { x, y });
        expect(fromTexture).toBeCloseTo(fromSampler, 5);
      }
    }
  });

  it("agrees at the exact post positions too, not only between them", () => {
    // Interpolation error hides at the posts; a MAPPING error does not. Testing
    // only midpoints would pass on a field shifted by a whole post.
    const data = field(5);
    const texture = terrainTextureFrom(data);
    if (texture === undefined) throw new Error("no texture");

    for (let i = 0; i < 5; i += 1) {
      const v = -100 + (i / 4) * 200;
      const { fromTexture, fromSampler } = bothAt(data, texture, {
        x: v,
        y: v,
      });
      expect(fromTexture).toBeCloseTo(fromSampler, 5);
    }
  });

  it("clamps outside the extent instead of extrapolating", () => {
    const data = field(5);
    const texture = terrainTextureFrom(data);
    if (texture === undefined) throw new Error("no texture");
    expect(sampleTerrainTexture(texture, -500, 0)).toBeCloseTo(
      sampleTerrainTexture(texture, -100, 0),
      6,
    );
  });
});

describe("textureUv", () => {
  it("addresses texel CENTRES, not edges", () => {
    // A texture coordinate of 0 is the outer edge of the first texel, not its
    // middle. Off by half a texel shifts the whole surface by half a post —
    // ~6 m here, which reads as the DEM being misregistered rather than as an
    // arithmetic mistake.
    expect(textureUv(-100, 100, 4)).toBeCloseTo(0.5 / 4, 6);
    expect(textureUv(100, 100, 4)).toBeCloseTo(3.5 / 4, 6);
  });

  it("stays inside 0..1 for points beyond the extent", () => {
    for (const v of [-1000, -100, 0, 100, 1000]) {
      const uv = textureUv(v, 100, 8);
      expect(uv).toBeGreaterThan(0);
      expect(uv).toBeLessThan(1);
    }
  });
});

describe("terrainNormal", () => {
  it("points straight up on flat ground", () => {
    const flat = terrainTextureFrom(field(5, 53, () => 0));
    if (flat === undefined) throw new Error("no texture");
    const [nx, ny, nz] = terrainNormal(flat, 0, 0);
    expect(nx).toBeCloseTo(0, 6);
    expect(ny).toBeCloseTo(1, 6);
    expect(nz).toBeCloseTo(0, 6);
  });

  it("tilts AGAINST the slope, so a rising surface faces back down it", () => {
    // The half of W23 that is not optional. `geo-three`'s displacement shader
    // rewrites gl_Position only, so its terrain is lit as if flat — cosmetic for
    // a satellite-textured map, and here it would mean a displaced surface with
    // no shading variation at all, which is the entire point of displacing it.
    //
    // Height rises with +x, so the normal must lean towards -x.
    const slope = terrainTextureFrom(field(9, 53, (col) => col * 5));
    if (slope === undefined) throw new Error("no texture");
    const [nx, ny] = terrainNormal(slope, 0, 0);
    expect(nx).toBeLessThan(0);
    expect(ny).toBeGreaterThan(0);
  });

  it("returns a unit vector", () => {
    const slope = terrainTextureFrom(
      field(9, 53, (col, row) => col * 3 - row * 2),
    );
    if (slope === undefined) throw new Error("no texture");
    const [nx, ny, nz] = terrainNormal(slope, 10, -20);
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6);
  });
});
