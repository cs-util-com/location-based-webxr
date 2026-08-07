/**
 * Terrain relief, sampled once and read synchronously thereafter.
 *
 * WHY IT IS PRE-FETCHED RATHER THAN SAMPLED LAZILY. `buildBuildings` and
 * `buildTrees` take a plain `groundHeightM(position) => number` — synchronous,
 * because they are called per volume inside a mesh build. So the network work
 * has to be finished before the build starts. That is the whole reason this is a
 * grid loaded up front rather than a provider passed straight through.
 *
 * WHY IT IS RELATIVE. The provider returns ORTHOMETRIC height — about 53 m at
 * Cologne — while the ENU frame puts the user at `y = 0`. Feeding absolute
 * metres in would lift the whole city off a camera that looks at `y = 10`. Only
 * relief matters for a standalone 3D view, so the origin's height is subtracted
 * and the datum cancels exactly. **A later AR mode will need the opposite** —
 * absolute height against an ellipsoidal GNSS altitude, which is what the
 * geoid model in `gps-plus-slam-osm` is for. Do not reuse this there.
 *
 * WHY `undefined` IS NEVER `0`. `elevationAt` returns `undefined` for "no data",
 * and the tempting `?? 0` turns a DEM outage into a sea-level hole shaped
 * exactly like the outage — which reads as terrain rather than as a failure,
 * and buries the buildings standing in it. Missing posts are filled from the
 * data that did arrive, and the count is reported so the UI can say so.
 *
 * @see heightfield.ts.md
 */

import type { ElevationProvider, EnuFrame, LatLng } from "gps-plus-slam-osm";

/** A point in the frame's ENU metres. Structural, so nothing imports three. */
export interface EnuPoint {
  readonly x: number;
  readonly y: number;
}

/** The window centred on the frame origin — the shape before it could move. */
const AT_ORIGIN: EnuPoint = { x: 0, y: 0 };

export interface HeightfieldOptions {
  readonly frame: EnuFrame;
  /**
   * Half-width in metres: the field covers `centreEnu ± extentM` on both axes.
   */
  readonly extentM: number;
  /** Distance between posts, metres. Match the DEM's own resolution. */
  readonly spacingM: number;
  /**
   * Where the sampled square sits IN THE FRAME. Defaults to the origin.
   *
   * The window follows the user; the frame does not. Before the scene had a
   * fixed anchor these were the same point and this could not exist — which is
   * exactly why the ground stopped covering the user as soon as the anchor
   * stood still.
   */
  readonly centreEnu?: EnuPoint;
  readonly signal?: AbortSignal;
}

/**
 * A heightfield as PLAIN DATA — the form that survives a worker boundary.
 *
 * Split out from {@link Heightfield} because the sampling now happens in the
 * worker (the field is ~55 000 posts since the extent grew to the rendered
 * extent) while the ground plane and the affordance grid read it on the main
 * thread. `heightAt` is a **method**, and the structured-clone algorithm drops
 * methods *silently* — leaving an object that looks correct until the first call.
 * So the grid crosses as numbers and {@link heightfieldFrom} rebuilds the
 * sampler on the far side.
 *
 * `heights` is a `Float32Array` so it can be **transferred** rather than copied.
 */
export interface HeightfieldData {
  /** Row-major posts, `side * side` of them. Empty when `hasData` is false. */
  readonly heights: Float32Array;
  /** Posts per axis. */
  readonly side: number;
  /** Half-width of the sampled square, metres. */
  readonly extentM: number;
  /**
   * Where that square sits in the frame — the field covers `centreEnu ±
   * extentM`.
   *
   * CARRIED WITH THE DATA, not re-derived by the reader. `heightAt` takes ENU
   * in the scene's frame, so it needs the window's offset to find the right
   * post; a consumer that assumed `{0, 0}` would read plausible terrain from
   * the wrong place, which is a silent failure rather than a visible one.
   */
  readonly centreEnu: EnuPoint;
  /**
   * The height at `centreEnu`, subtracted from every read.
   *
   * Kept rather than pre-subtracted from `heights` so the datum stays visible
   * and the arithmetic is identical on both sides of the boundary.
   *
   * AT THE WINDOW'S CENTRE, NOT THE FRAME ORIGIN. The datum is what makes the
   * surface relief rather than altitude, and the user stands at the window's
   * centre — taken at a frame origin they walked away from, the ground would
   * silently sink or rise beneath them by the height difference between the two.
   */
  readonly datum: number;
  /** False when nothing usable arrived — `heightAt` is then flat zero. */
  readonly hasData: boolean;
  /** Posts the provider had no answer for. */
  readonly missing: number;
  /** Posts requested. */
  readonly total: number;
  /**
   * Peak-to-trough relief across the field, metres.
   *
   * Reported rather than derived by the caller because it is the one number
   * that tells a viewer whether the terrain is doing anything: 0.3 m of relief
   * over 600 m is a plain, and a plain rendered as a plain is indistinguishable
   * from terrain that failed to load. The status line says it out loud.
   */
  readonly reliefM: number;
  /**
   * Relief within {@link NEAR_FIELD_M} of {@link centreEnu}, metres.
   *
   * REPORTED SEPARATELY BECAUSE THE FIELD GREW (DEC-R2-22). Over a 2.8 km square
   * `reliefM` can be tens of metres while the ground under the user is flat, so on
   * its own it stopped describing the user's surroundings. And near-field alone can
   * read 0 for a field that loaded perfectly, which resurrects the exact ambiguity
   * the number exists to kill. Both are needed; the status line shows both.
   */
  readonly nearReliefM: number;
}

/** Radius treated as "around the user" for {@link HeightfieldData.nearReliefM}. */
export const NEAR_FIELD_M = 300;

/**
 * Half-width of the ground plane and of the terrain sampled under it, metres.
 *
 * 2400 m — a 4.8 km plane — which is **exactly `FAR_PLANE_M`**, and that equality
 * is the constraint rather than a coincidence (W5, DEC-R5-3/R5-12). The plane
 * ends here; a camera that can see further looks past the edge of the world, and
 * a default view that does is finding R2-9 (buildings standing on nothing)
 * coming back. `far-field.test.ts` asserts `FAR_PLANE_M <= TERRAIN_EXTENT_M` so
 * the two cannot be edited apart. **This overrides DEC-15's 600 m** (DEC-R2-8)
 * and the 1400 m that replaced it.
 *
 * WHY IT HAD TO GROW, TWICE.
 *
 * - **600 -> 1400:** `buildBuildings` applies no distance filter — it extrudes
 *   everything in the res-7 fetch tile, 2.81 km across — so a 600 m terrain
 *   square sat under ~2.8 km of city, and the buildings outside it were not left
 *   flat: `bilinear`'s per-axis CLAMP extruded the edge profile outward as
 *   stripes. That is fabricated height presented as data (finding R2-9), and
 *   sizing the field to the geometry makes it unrepresentable rather than merely
 *   unlikely.
 * - **1400 -> 2400:** the far plane doubled to 2400 (R5-4), and the ground has to
 *   reach at least as far as the camera can see. 2400 rather than 2800 is the
 *   SMALLEST value satisfying that — corner reach is still 3394 m, so the
 *   diagonal keeps margin, and the accepted cost is ~3x the ground vertices
 *   (54 756 -> 160 801) rather than ~4x. See `MAX_GROUND_SEGMENTS` for the
 *   measurement.
 *
 * WHY THE COST OBJECTION DID NOT HOLD. DEC-15 costed this in Terrarium tiles,
 * and a z13 tile is ~3.1 km of ground at Cologne — so covering the whole
 * rendered city is the 1–4 tiles already being fetched. What genuinely scales is
 * the post count, and that is handled by `terrain-field.ts`: posts are cached
 * across positions, so the larger area is paid for once rather than on every
 * step.
 *
 * MOVED HERE from `building-view.ts` on 2026-07-31, because it gained a second
 * consumer that must not import three.js: the worker clips ground plates to this
 * extent before triangulating them (see `plates.ts`'s `clipTo`, and the O(n²) it
 * bounds). Two copies of this number would be exactly the "two computations that
 * agree today with nothing asserting they always will" shape this demo keeps
 * finding, so it lives once, in the module both sides already share.
 */
export const TERRAIN_EXTENT_M = 2400;

export interface Heightfield extends HeightfieldData {
  /** Relief in metres at an ENU point, relative to the frame origin. */
  heightAt(point: { x: number; y: number }): number;
}

/** What a failed or empty load produces: flat, and honest about it. */
function flat(
  total: number,
  extentM: number,
  centreEnu: EnuPoint,
): HeightfieldData {
  return {
    heights: new Float32Array(0),
    side: 0,
    extentM,
    centreEnu,
    datum: 0,
    hasData: false,
    missing: total,
    total,
    reliefM: 0,
    nearReliefM: 0,
  };
}

/**
 * Rebuilds the synchronous sampler from plain data.
 *
 * The one place `heightAt` is created, so the main thread and the worker cannot
 * disagree about what a post means. A field with `hasData: false` samples flat
 * zero — never a sea-level surface, for the reason in the module header.
 */
export function heightfieldFrom(data: HeightfieldData): Heightfield {
  if (!data.hasData || data.side === 0) {
    return { ...data, heightAt: () => 0 };
  }
  return {
    ...data,
    // THE QUERY IS IN THE SCENE'S FRAME; the grid is indexed from the window's
    // centre. Subtracting here rather than at every call site is what keeps
    // `heightAt` a single contract — buildings, trees, POI markers, the ground
    // plane and the affordance grid all pass plain ENU and none of them has to
    // know where the window happens to be sitting.
    heightAt: (point) =>
      surfaceHeight(
        data.heights,
        data.side,
        data.extentM,
        point.x - data.centreEnu.x,
        point.y - data.centreEnu.y,
      ) - data.datum,
  };
}

/**
 * A `heightfieldFrom` that rebuilds only when the DATA changes.
 *
 * `heightfieldFrom` is cheap but not free — an object spread plus a closure —
 * and the worker's per-vertex samplers used to call it INSIDE the sampler, so
 * the affordance grid paid for one throwaway `Heightfield` per sampled vertex
 * (~931 cells' worth, per rebuild). PR #239 caught it.
 *
 * Keyed on OBJECT IDENTITY, not on contents: `HeightfieldData` is replaced
 * wholesale when the terrain is reloaded, never mutated in place, so identity is
 * the exact question "is this still the same terrain". A deep comparison would
 * be more expensive than the rebuild it saves.
 */
export function createHeightfieldCache(): (
  data: HeightfieldData | undefined,
) => Heightfield | undefined {
  let source: HeightfieldData | undefined;
  let field: Heightfield | undefined;
  return (data) => {
    if (data === undefined) return undefined;
    if (data !== source) {
      source = data;
      field = heightfieldFrom(data);
    }
    return field;
  };
}

/**
 * Loads a heightfield over a square centred on the frame's origin.
 *
 * Never rejects. A DEM outage should cost the relief, not the 3D view — the
 * buildings and the affordance grid are still worth looking at, and a thrown
 * error here would take the whole pane down with it.
 */
export async function buildHeightfieldData(
  provider: ElevationProvider,
  options: HeightfieldOptions,
): Promise<HeightfieldData> {
  const { frame, extentM, spacingM } = options;
  const centreEnu = options.centreEnu ?? AT_ORIGIN;
  // `+1` because the posts include both edges: a 600 m span at 50 m spacing is
  // 13 posts, not 12. Off by one here tilts the whole surface.
  const side = Math.max(2, Math.round((extentM * 2) / spacingM) + 1);
  const total = side * side;

  /** Grid index to ENU, stated ONCE — the near-field pass below reuses it. */
  const enuAt = (col: number, row: number): EnuPoint => ({
    x: centreEnu.x - extentM + (col / (side - 1)) * extentM * 2,
    y: centreEnu.y - extentM + (row / (side - 1)) * extentM * 2,
  });

  const positions: LatLng[] = [];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      positions.push(frame.toLatLng(enuAt(col, row)));
    }
  }

  let raw: readonly (number | undefined)[];
  try {
    // ONE call for every post. `elevationAt` is batch-in/batch-out precisely so
    // the provider can coalesce by DEM tile; per-post calls would be thousands
    // of requests for one view.
    raw = await provider.elevationAt(positions, options.signal);
  } catch {
    return flat(total, extentM, centreEnu);
  }

  const known = raw.filter(
    (v): v is number => v !== undefined && Number.isFinite(v),
  );
  if (known.length === 0) return flat(total, extentM, centreEnu);

  // Missing posts take the mean of what did arrive. Not zero — see the module
  // header — and not a neighbour scan either: at this grid size the mean keeps
  // the surface continuous without inventing a slope the data never showed.
  const mean = known.reduce((sum, v) => sum + v, 0) / known.length;
  const heights = new Float32Array(total);
  // The posts within `NEAR_FIELD_M` of the origin, collected as the grid is
  // walked rather than re-derived afterwards — the row/col to ENU mapping is
  // stated once above and deriving it a second time is how the two drift.
  const near: number[] = [];
  for (let i = 0; i < total; i++) {
    const value = raw[i];
    heights[i] = value === undefined || !Number.isFinite(value) ? mean : value;
    if (value === undefined || !Number.isFinite(value)) continue;
    const enu = enuAt(i % side, Math.floor(i / side));
    // AROUND THE WINDOW'S CENTRE (DEC-R11-10), which is where the user is —
    // the status line says "relief around you" and measuring it around a scene
    // anchor they walked away from makes that sentence false.
    if (
      Math.abs(enu.x - centreEnu.x) <= NEAR_FIELD_M &&
      Math.abs(enu.y - centreEnu.y) <= NEAR_FIELD_M
    ) {
      near.push(value);
    }
  }

  return {
    heights,
    side,
    extentM,
    centreEnu,
    // The height at the WINDOW'S CENTRE, subtracted from every read so the
    // surface is relief rather than altitude. Sampled through the same bilinear
    // path as everything else, so it is exactly what an undatumed
    // `heightAt(centreEnu)` returns. Grid-local, hence `(0, 0)`.
    datum: surfaceHeight(heights, side, extentM, 0, 0),
    hasData: true,
    missing: total - known.length,
    total,
    // NOT `Math.max(...known)`. A spread passes one argument per element, and
    // measured in this Node the limit is between 100 000 and 125 000 before
    // `RangeError: Maximum call stack size exceeded`. At the rendered extent
    // (~2.8 km at 12 m) the field is ~55 000 posts, so the spread was **not**
    // yet broken — but it is within about 2x of the limit, and the limit is
    // reached by an ordinary change: the same extent at 8 m spacing is ~123 000.
    // A fold has no limit and is not measurably slower, so this removes a
    // fragility rather than fixing a live bug. See `worker-round-trip.test.ts`.
    reliefM: peakToTrough(known),
    // DEC-R2-22's SECOND number, and it has to be a different one. This read
    // `peakToTrough(known)` — byte-identical to `reliefM` — so the status line
    // showed one value twice and could not tell "this place is hilly" from
    // "somewhere in view is". `NEAR_FIELD_M` was not referenced anywhere in this
    // file outside its own declaration. Raised in review on PR #231; the live
    // path (`terrain-field.ts`'s `sampleGrid`) always restricted correctly, so
    // this was a trap for the next consumer rather than a shipped defect.
    //
    // Falls back to the whole field when the extent is smaller than the near
    // field: reporting 0 there would read as flat ground rather than as a grid
    // too small to distinguish. Same rule `sampleGrid` follows.
    nearReliefM: near.length === 0 ? peakToTrough(known) : peakToTrough(near),
  };
}

/**
 * Peak-to-trough of a non-empty list.
 *
 * EXPORTED because `terrain-field.ts` needs exactly this and `check:dup` caught the
 * second copy. Shared rather than duplicated for a reason beyond tidiness: the whole
 * point of the fold is that it does NOT spread into `Math.max`, and two copies is
 * two chances for someone to "simplify" one of them back into a spread that throws
 * above ~100 000 elements.
 */
export function peakToTrough(values: readonly number[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

/**
 * Loads a heightfield and returns it ready to sample.
 *
 * The main-thread convenience form: exactly
 * `heightfieldFrom(await buildHeightfieldData(...))`. The worker uses the data
 * form directly, because that is what crosses the boundary.
 */
export async function buildHeightfield(
  provider: ElevationProvider,
  options: HeightfieldOptions,
): Promise<Heightfield> {
  return heightfieldFrom(await buildHeightfieldData(provider, options));
}

/**
 * Reads the ground surface at a point, clamped to the grid.
 *
 * The CLAMP is a LAST-RESORT GUARD, not a working path.
 *
 * Clamping rather than returning `NaN` outside the extent: the ground plane and
 * the affordance grid both sample this, and a `NaN` vertex silently drops a
 * triangle instead of reporting anything. The edge value is the least-bad answer
 * available — "this is the last thing we know".
 *
 * **CORRECTED per DEC-R2-9. This comment used to end "and the caller sizes the
 * plane to the extent anyway", and that clause was false — it was the whole of
 * the R2-9 bug.** It was true of the ground plane and false of the buildings,
 * which are the larger consumer and reached ~2.8 km while the field was 600 m.
 * `x` and `y` clamp INDEPENDENTLY, so every building outside the square was
 * given the height of the nearest edge at its own cross-axis offset — the edge
 * profile extruded outward as stripes, which looks like terrain data and is not.
 *
 * The guarantee that replaced the false claim is structural, not a comment: the
 * sampled field is sized from the extent actually being rendered, so a query
 * outside it cannot arise in normal operation (DEC-R2-9). Reaching this clamp in
 * production means that sizing has been broken somewhere upstream.
 */
function surfaceHeight(
  heights: Float32Array,
  side: number,
  extentM: number,
  x: number,
  y: number,
): number {
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

  const at = (col: number, row: number): number =>
    heights[row * side + col] ?? 0;
  const h00 = at(x0, y0);
  const h11 = at(x1, y1);

  // BARYCENTRIC ON THE PLANE'S OWN TRIANGLES, NOT BILINEAR (W10, finding R3-6).
  //
  // The two are different surfaces, and the difference is exactly the reported
  // bug. The ground plane carries heights only at these posts and the GPU
  // interpolates LINEARLY ACROSS EACH TRIANGLE between them; a bilinear read
  // returns the hyperbolic-paraboloid surface instead, which agrees with the
  // drawn one only at the posts. Between them they differ by the quad's twist
  // term — decimetres in city DEM data, against a 4 cm lift ladder — so plates,
  // roads, slabs and cells sampled bilinearly sank UNDER the terrain they were
  // supposed to sit on, wherever the ground twists.
  //
  // Interpolating over the same triangles makes the ladder sufficient by
  // construction rather than by a larger guess: anything sampled here lies
  // exactly on the surface that is drawn.
  //
  // THE DIAGONAL IS `THREE.PlaneGeometry`'s, and it is a property of a
  // dependency rather than of this file — `heightfield.ts` must stay three-free
  // (the worker imports it), so the rule is necessarily RESTATED here. Measured
  // from the real index buffer: the quad is split into
  // (top-left, bottom-left, top-right) and (bottom-left, bottom-right,
  // top-right), i.e. the shared edge runs from the LOW corner to the HIGH
  // corner. `heightfield.plane.test.ts` asserts that against a real
  // `PlaneGeometry`, so a three upgrade that flips the winding fails a test
  // instead of silently restoring the twist-term error.
  if (fy >= fx) {
    // Upper-left triangle: (x0,y0), (x0,y1), (x1,y1).
    return h00 + (at(x0, y1) - h00) * (fy - fx) + (h11 - h00) * fx;
  }
  // Lower-right triangle: (x0,y0), (x1,y0), (x1,y1).
  return h00 + (at(x1, y0) - h00) * (fx - fy) + (h11 - h00) * fy;
}
