/**
 * The sky: a vertical gradient, as pixels.
 *
 * WHY THERE IS A SKY AT ALL (DEC-R2-2). The 3D background was `0x11131a` and the
 * ground `0x1d2230` — two near-blacks twelve levels of blue apart, which is why
 * the reported symptom was "the ground does not lift off the background". A
 * gradient also gives the ground plane's edge something to fade into, so the
 * horizon stops reading as "the world ends here".
 *
 * WHY A GRADIENT AND NOT FOG. Fog was offered and rejected for a specific reason:
 * it would have hidden finding R2-9 — distant buildings standing on fabricated,
 * striped terrain — instead of surfacing it. This pane's job is to make geometry
 * problems visible, so anything that dims distance is working against it.
 *
 * WHY THIS FILE IS PIXELS AND NOT A `THREE.Texture`. The colour ramp is the part
 * that can be wrong in a way you would only notice by looking (upside down, off by
 * one, not monotonic), and it is also the only part provable without a GPU. So the
 * arithmetic lives here and `building-view.ts` wraps it in a `DataTexture`.
 *
 * THIS TEXTURE IS A BACKGROUND ONLY. It must NEVER be assigned to
 * `scene.environment`, and this paragraph used to say the opposite — that using the
 * sky as the environment map was what made DEC-R2-1's reflective ground work,
 * because "a one-directional-light scene gives a specular lobe so narrow it
 * registers on almost nothing". Both halves were wrong, and the claim took the
 * entire scene down for ten work items: three.js routes any environment map through
 * its CubeUV path, which expects a PMREM-processed texture, and a raw equirect
 * `DataTexture` makes it emit integer `CUBEUV_*` defines into float assignments, so
 * every `MeshStandardMaterial` fragment shader fails to compile. three.js logs that
 * and silently does not draw the material. PMREM-processing does not rescue this
 * gradient either — it is one pixel wide, degenerate for the equirect-to-cube-UV
 * projection. The sky-tinted fill comes from a `HemisphereLight` instead, and
 * DEC-R2-1's moving facet edges come from the directional light's specular
 * highlight and low roughness. See `building-view.ts.md`'s lighting invariant.
 *
 * @see sky-gradient.ts.md
 */

/** Rows in the generated gradient. 64 is smooth at any sane display size. */
export const SKY_GRADIENT_ROWS = 64;

/**
 * Colour at the top of the sky (the zenith), as RGB 0–255.
 *
 * A desaturated night blue rather than a vivid one: this sits behind a grey city
 * and a heat-coloured hex grid, and a saturated sky would compete with the ramp
 * the whole demo exists to read.
 */
export const ZENITH_RGB: readonly [number, number, number] = [16, 22, 42];

/**
 * Colour at the horizon, as RGB 0–255.
 *
 * Deliberately much lighter than the zenith AND lighter than the ground
 * (`0x3a4356`), so the ground plane's far edge reads as a silhouette against sky
 * rather than as a seam between two similar darks.
 */
export const HORIZON_RGB: readonly [number, number, number] = [92, 108, 140];

/**
 * The gradient as RGBA rows, TOP ROW FIRST.
 *
 * Top-first because that is the row order `THREE.DataTexture` expects for an
 * equirectangular map read from `v = 1` down, and getting it backwards produces a
 * sky that is bright overhead and dark at the horizon — which looks like a
 * deliberate stylistic choice rather than a bug, so it is worth a test.
 *
 * Alpha is always 255: a translucent sky would composite against the canvas
 * clear colour and reintroduce the near-black this replaces.
 */
export function skyGradientPixels(rows = SKY_GRADIENT_ROWS): Uint8Array {
  if (!Number.isInteger(rows) || rows < 2) {
    throw new RangeError(
      `A gradient needs at least 2 rows to interpolate between; got ${rows}`,
    );
  }
  const data = new Uint8Array(rows * 4);
  for (let row = 0; row < rows; row++) {
    // 0 at the top, 1 at the horizon.
    const t = row / (rows - 1);
    for (let channel = 0; channel < 3; channel++) {
      const from = ZENITH_RGB[channel] ?? 0;
      const to = HORIZON_RGB[channel] ?? 0;
      data[row * 4 + channel] = Math.round(from + (to - from) * t);
    }
    data[row * 4 + 3] = 255;
  }
  return data;
}
