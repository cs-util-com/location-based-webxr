/**
 * The sky: a vertical gradient with a sun in it, as pixels.
 *
 * WHY THERE IS A SKY AT ALL (DEC-R2-2). The 3D background was `0x11131a` and the
 * ground `0x1d2230` — two near-blacks twelve levels of blue apart, which is why
 * the reported symptom was "the ground does not lift off the background". A
 * gradient also gives the ground plane's edge something to fade into, so the
 * horizon stops reading as "the world ends here".
 *
 * WHY IT IS NOW TWO-DIMENSIONAL (W14, R4-8, DEC-R4-9). It was **1 pixel wide**,
 * and that is not a detail: as an equirectangular map, one column has no azimuth
 * at all, so it could not hold a sun anywhere. The note — _"man sieht keine
 * Sonne"_ — was describing a texture that was physically incapable of showing
 * one. Widening it is what makes a sun disc expressible.
 *
 * WHY A BAKED SUN PLUS A ROTATION, rather than regenerating. The sun moves with
 * the camera now (W12/DEC-R4-6), so regenerating these pixels would be a texture
 * upload on every drag — exactly the main-thread cost this round is removing.
 * Instead the disc is baked at ONE azimuth and `scene.backgroundRotation` turns
 * the whole sky, which is a uniform. See {@link skyRotationForSun}.
 *
 * WHY A GRADIENT AND NOT FOG, still. Fog was offered and rejected in round 2
 * because it would have hidden finding R2-9 — distant buildings standing on
 * fabricated, striped terrain — instead of surfacing it. **R2-9 is fixed**, so
 * that objection has expired and W21 introduces distance haze deliberately; this
 * paragraph is kept so the reversal is visible rather than looking like drift.
 *
 * WHY THIS FILE IS PIXELS AND NOT A `THREE.Texture`. The arithmetic is the part
 * that can be wrong in a way you would only notice by looking — upside down, off
 * by one, not monotonic, the sun in the wrong row — and it is also the only part
 * provable without a GPU. So it lives here and `building-view.ts` wraps it.
 *
 * THIS TEXTURE IS A BACKGROUND ONLY. It must NEVER be assigned to
 * `scene.environment`, and widening it does NOT change that. Only one of the two
 * reasons was about width: three routes any environment map through its CubeUV
 * path, which expects a PMREM-processed texture, and with a raw equirect
 * `DataTexture` it emits integer `CUBEUV_*` defines into float assignments, so
 * every `MeshStandardMaterial` fragment shader fails to compile. three logs that
 * and silently does not draw the material — which took the entire scene down for
 * ten work items while the status line still reported "21 volumes" and the suite
 * stayed green. The sky-tinted fill comes from a `HemisphereLight` instead. See
 * `building-view.ts.md`'s lighting invariant.
 *
 * @see sky-gradient.ts.md
 */

/** Rows in the generated gradient. 64 is smooth at any sane display size. */
export const SKY_GRADIENT_ROWS = 64;

/**
 * Columns. 256 gives the sun disc room to be round rather than a wide smear,
 * and the whole texture is still 64 KB.
 */
export const SKY_GRADIENT_COLUMNS = 256;

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
 * The warm colour the sky takes on around the sun.
 *
 * The other half of the note's complaint — the old sky was uniformly cool, which
 * is what made it read as "a blue sphere". Warm rather than white so the sun has
 * somewhere to sit rather than appearing as a hole.
 */
export const SUN_GLOW_RGB: readonly [number, number, number] = [255, 214, 170];

/** The disc itself: near-white, so it reads as a source rather than a patch. */
export const SUN_DISC_RGB: readonly [number, number, number] = [255, 248, 230];

/** Angular radius of the drawn disc, radians. Larger than the real ~0.0047 rad,
 * because a physically-sized sun is a couple of pixels and reads as a defect. */
const SUN_DISC_RADIUS_RAD = 0.035;

/** How far the warm glow reaches around the sun, radians. */
const SUN_GLOW_RADIUS_RAD = 0.55;

/**
 * The azimuth the sun is BAKED at, as a texture `u`.
 *
 * 0.5, which under three's `equirectUv` (`u = atan2(dir.z, dir.x) / 2π + 0.5`)
 * is the `+x` direction. The value matters only in that
 * {@link skyRotationForSun} is derived from it — the two must agree, so they are
 * stated once here and used once there.
 */
const SUN_BAKED_U = 0.5;

/**
 * The `scene.backgroundRotation.y` that puts the baked sun at `azimuthRad`.
 *
 * DERIVED, not tuned, and the derivation is the reason this is a named function
 * with a test rather than a constant someone flipped the sign of until it looked
 * right:
 *
 * - three's background pass sets its uniform to `Rᵀ` (`WebGLBackground` calls
 *   `.transpose()` on the matrix built from `scene.backgroundRotation`) and the
 *   shader samples `equirectUv(Rᵀ · d)`.
 * - For a rotation about `y` by `θ`, `Rᵀ · s` has `x = h·sin(A − θ)` and
 *   `z = h·cos(A − θ)`, where `A` is the sun's azimuth (`atan2(s.x, s.z)`, the
 *   convention `sun.ts` uses) and `h` its horizontal length.
 * - So `u = (π/2 − (A − θ)) / 2π + 0.5`, and `u = SUN_BAKED_U = 0.5` requires
 *   `θ = A − π/2`.
 *
 * **The one thing this cannot prove is that the derivation matches what a GPU
 * does.** If the sun appears mirrored on screen, the sign of the `π/2` term is
 * the single knob — see §11.3 of the round-4 plan, which is where a person looks.
 */
export function skyRotationForSun(azimuthRad: number): number {
  // `SUN_BAKED_U` enters as the offset from the texture's centre column; it is
  // 0.5 today, so the term vanishes — written out so that moving the bake point
  // cannot silently break the alignment.
  return azimuthRad - Math.PI / 2 + (SUN_BAKED_U - 0.5) * 2 * Math.PI;
}

/** Shortest angular distance between two angles, radians. */
function angleBetween(a: number, b: number): number {
  const difference = Math.abs(a - b) % (2 * Math.PI);
  return difference > Math.PI ? 2 * Math.PI - difference : difference;
}

function mix(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
  channel: number,
): number {
  const a = from[channel] ?? 0;
  const b = to[channel] ?? 0;
  return a + (b - a) * t;
}

export interface SkyOptions {
  readonly rows?: number;
  readonly columns?: number;
  /**
   * The sun's height above the horizon, radians.
   *
   * Passed in rather than imported from `sun.ts` so this stays a pure function
   * of its arguments — and so a test can put the sun somewhere obvious.
   */
  readonly sunElevationRad: number;
}

/**
 * The sky as RGBA pixels, ROW-MAJOR and TOP ROW FIRST.
 *
 * Top-first because that is the intuitive reading; `building-view.ts` sets
 * `flipY = true` on the `DataTexture` to match three's expectation, and that
 * quirk deliberately lives in the three-facing file rather than here. Getting it
 * backwards produces a sky that is bright overhead and dark at the horizon,
 * which looks like a stylistic choice rather than a bug — hence a test.
 *
 * Alpha is always 255: a translucent sky would composite against the canvas
 * clear colour and reintroduce the near-black this replaces.
 */
export function skyGradientPixels(options: SkyOptions): Uint8Array {
  const rows = options.rows ?? SKY_GRADIENT_ROWS;
  const columns = options.columns ?? SKY_GRADIENT_COLUMNS;
  if (!Number.isInteger(rows) || rows < 2) {
    throw new RangeError(
      `A gradient needs at least 2 rows to interpolate between; got ${rows}`,
    );
  }
  if (!Number.isInteger(columns) || columns < 2) {
    throw new RangeError(
      `A sky needs at least 2 columns to hold an azimuth; got ${columns}`,
    );
  }

  const data = new Uint8Array(rows * columns * 4);

  // Where the sun sits in the image, from three's own mapping. With the texture
  // flipped in Y, row 0 is v = 1 (the zenith), so the row falls out of
  // `v = asin(y)/π + 0.5` with `y = sin(elevation)`.
  const sunV = options.sunElevationRad / Math.PI + 0.5;
  const sunRow = (1 - sunV) * (rows - 1);
  const sunColumn = SUN_BAKED_U * (columns - 1);
  // Radians per pixel, so the disc and glow are round rather than stretched.
  const radPerColumn = (2 * Math.PI) / columns;
  const radPerRow = Math.PI / rows;

  for (let row = 0; row < rows; row++) {
    // 0 at the top, 1 at the horizon — the vertical ramp, unchanged.
    const t = row / (rows - 1);
    for (let column = 0; column < columns; column++) {
      // Angular distance to the sun, treating the image as a sphere: the
      // horizontal component shrinks with height, which is what keeps the disc
      // circular near the zenith instead of smearing across the top.
      const dx =
        angleBetween(column * radPerColumn, sunColumn * radPerColumn) *
        Math.cos(options.sunElevationRad);
      const dy = (row - sunRow) * radPerRow;
      const toSun = Math.hypot(dx, dy);

      const index = (row * columns + column) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let value = mix(ZENITH_RGB, HORIZON_RGB, t, channel);
        if (toSun < SUN_GLOW_RADIUS_RAD) {
          // Quadratic falloff: linear reads as a visible edge to the glow.
          const glow = (1 - toSun / SUN_GLOW_RADIUS_RAD) ** 2;
          value += ((SUN_GLOW_RGB[channel] ?? 0) - value) * glow;
        }
        if (toSun < SUN_DISC_RADIUS_RAD) {
          value = SUN_DISC_RGB[channel] ?? value;
        }
        data[index + channel] = Math.round(Math.min(255, Math.max(0, value)));
      }
      data[index + 3] = 255;
    }
  }
  return data;
}
