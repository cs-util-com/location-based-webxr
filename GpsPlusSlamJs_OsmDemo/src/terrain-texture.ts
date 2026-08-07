/**
 * The heightfield as texture data, and the sampling a vertex shader will mirror.
 *
 * WHY THIS EXISTS (W23, DEC-R2-24 as revised 2026-07-30). The ground plane can be
 * displaced on the CPU — walking every vertex and calling `computeVertexNormals`
 * — or on the GPU, by sampling a height texture in the vertex shader. **Both
 * paths now exist and are switchable at runtime**, because the measurement that
 * deferred the GPU path was taken on a desktop at a fixed camera, and that says
 * very little about a phone in AR where per-frame CPU is the scarce resource.
 * The owner's call: build both, then compare them on a real device.
 *
 * WHY THE ARITHMETIC IS HERE AND NOT ONLY IN GLSL. jsdom cannot compile a shader,
 * so anything expressed only in GLSL is untestable in CI — the same reason this
 * repo keeps worker decision logic in pure modules that the device layer wraps.
 * `sampleTerrainTexture` is what the shader does, in JS, and it is asserted
 * against `heightAt` directly. **If the two disagree, the GPU becomes a second
 * source of truth for ground height**, which is exactly the defect DEC-R2-21
 * rejected `geo-three` for.
 *
 * TWO TRAPS THAT FAIL SILENTLY, both found by reading before writing:
 *
 * - **`HeightfieldData.heights` are ABSOLUTE orthometric metres** (~53 m at
 *   Cologne). `heightfieldFrom` subtracts `datum` on READ; it is not baked into
 *   the array. Upload it verbatim and the whole city lifts off a camera framed at
 *   `y = 10`. The texture is therefore built datum-relative, which also matches
 *   what every other consumer already sees.
 * - **There is no `spacing` field.** The post pitch is implicit in
 *   `extentM * 2 / (side - 1)`, so a shader needs it passed as its own uniform
 *   rather than read off the data.
 *
 * @see terrain-texture.ts.md
 */

import type { HeightfieldData } from "./heightfield.js";

/** A height field ready to become a `DataTexture`. */
export interface TerrainTexture {
  /**
   * Row-major posts, `side * side`, **datum-relative metres**.
   *
   * Datum-relative for two independent reasons. It matches `heightAt`, so the
   * GPU and the mesh builders cannot disagree; and it keeps the values small
   * enough that half-float storage is precise, which absolute altitude would
   * not be — a 16-bit float has ~11 bits of mantissa, ample for ±100 m of relief
   * at ~6 cm and useless at 8000 m.
   */
  readonly data: Float32Array;
  /** Posts per axis. */
  readonly side: number;
  /** Half-width of the sampled square, metres. */
  readonly extentM: number;
  /** Metres between posts — derived, because the field does not carry it. */
  readonly spacingM: number;
}

/**
 * Texture data from a heightfield, or `undefined` when there is nothing to draw.
 *
 * `undefined` rather than a zero field: a flat surface shaped exactly like a DEM
 * outage reads as terrain, and the caller has to be able to tell the two apart to
 * fall back honestly.
 */
export function terrainTextureFrom(
  field: HeightfieldData,
): TerrainTexture | undefined {
  if (!field.hasData || field.side < 2) return undefined;
  const data = new Float32Array(field.side * field.side);
  for (let i = 0; i < data.length; i += 1) {
    const height = field.heights[i];
    // A non-finite post becomes the datum rather than NaN. One NaN vertex
    // removes the whole draw call in three.js with no error reported.
    data[i] =
      height === undefined || !Number.isFinite(height)
        ? 0
        : height - field.datum;
  }
  return {
    data,
    side: field.side,
    extentM: field.extentM,
    spacingM: (field.extentM * 2) / (field.side - 1),
  };
}

/**
 * The texture coordinate for an ENU metre offset, in `0..1`.
 *
 * **Texel CENTRES, which is the part that is easy to get wrong.** A texture
 * coordinate of `0` addresses the outer edge of the first texel, not its middle,
 * so the grid index `g` maps to `(g + 0.5) / side`. Off by half a texel and the
 * whole surface shifts by half a post — about 6 m here, which reads as the DEM
 * being slightly misregistered rather than as an arithmetic error.
 */
export function textureUv(v: number, extentM: number, side: number): number {
  const last = side - 1;
  const grid = Math.min(
    last,
    Math.max(0, ((v + extentM) / (extentM * 2)) * last),
  );
  return (grid + 0.5) / side;
}

/**
 * What the vertex shader computes, in JS.
 *
 * Bilinear over the same posts, with the same edge clamping, so it can be
 * asserted equal to `heightAt`. The shader mirrors this function; this function
 * is what CI can actually run.
 */
export function sampleTerrainTexture(
  texture: TerrainTexture,
  x: number,
  y: number,
): number {
  const { data, side, extentM } = texture;
  const last = side - 1;
  const toGrid = (v: number): number =>
    Math.min(last, Math.max(0, ((v + extentM) / (extentM * 2)) * last));
  const gx = toGrid(x);
  const gy = toGrid(y);

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(last, x0 + 1);
  const y1 = Math.min(last, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;

  const at = (col: number, row: number): number => data[row * side + col] ?? 0;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return top + (bottom - top) * fy;
}

/**
 * The surface normal at an ENU point, from a 4-tap finite difference.
 *
 * **The shader must do this, and leaving it out is the one way to get W23
 * visibly wrong.** `geo-three`'s displacement shader rewrites `gl_Position` only,
 * so its terrain is lit as if flat — cosmetic for a satellite-textured map, and
 * here it would mean a displaced surface with no shading variation at all.
 *
 * The taps are one post apart, so the difference is over the real DEM pitch
 * rather than over an arbitrary epsilon.
 */
export function terrainNormal(
  texture: TerrainTexture,
  x: number,
  y: number,
): [number, number, number] {
  const step = texture.spacingM;
  const left = sampleTerrainTexture(texture, x - step, y);
  const right = sampleTerrainTexture(texture, x + step, y);
  const down = sampleTerrainTexture(texture, x, y - step);
  const up = sampleTerrainTexture(texture, x, y + step);
  // Gradient of the height field; the normal is (-dh/dx, 1, -dh/dy) normalised,
  // with the ENU-to-render reflection left to the caller.
  const dx = (right - left) / (2 * step);
  const dy = (up - down) / (2 * step);
  const length = Math.hypot(dx, 1, dy);
  return [-dx / length, 1 / length, -dy / length];
}
