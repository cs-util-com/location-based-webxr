/**
 * Where the terrain grid is sampled, and in whose coordinates.
 *
 * THE DISTINCTION THIS MODULE EXISTS TO MAKE. Until `scene-anchor.ts` fixed the
 * frame, one lat/lng answered three different questions at once — which posts to
 * fetch, where to centre the sampled square, and what the resulting numbers
 * mean. They were the same variable, so nothing could disagree. They are not the
 * same question:
 *
 * - **The frame origin is a coordinate system.** It must stand still, or every
 *   height in the field is expressed against a different zero than the geometry
 *   standing on it.
 * - **The fetch centre and the sample centre are a data window.** They follow
 *   the user, because the ground the user is looking at is the ground worth
 *   having.
 *
 * Welding the two together is what made the whole scene move on every publish.
 * Separating them is the entire fix.
 *
 * WHAT THIS FIXED, CONCRETELY. Round 5A moved the buildings into the fixed frame
 * and left the heightfield in a frame anchored on the user, while `meshOptions`
 * kept reading building ground heights as `field.heightAt(frame.toEnu(position))`
 * — fixed-frame ENU against a user-frame field. The two disagreed by exactly the
 * user's offset from the anchor, so the relief slid under the city by the step
 * distance on every step. Nothing detected it: the round-5A walk test asserts on
 * the frame origin that is SENT, not on the frames the subsystems then use.
 *
 * @see terrain-window.ts.md
 */

import { enuFrameAt, type EnuFrame, type LatLng } from "gps-plus-slam-osm";

/**
 * How far past the sampled square the post lattice is grown.
 *
 * **NOT a `sqrt(2)` margin, and the difference is measured rather than a
 * preference.** `ensureAround` builds a SQUARE lattice of half-width `radiusM`
 * and the grid reads a SQUARE of half-width `extentM`, so treating the radius as
 * a circumscribed circle over-builds by `sqrt(2)` per axis — twice the posts,
 * for ground nothing ever samples. Harmless at the old 1 400 m extent (110 889
 * posts, inside the cache cap) and not harmless at 2 400 m: it put the lattice
 * at ~321 000 posts against a 250 000 cap, so eviction ran on every load and
 * threw away ~71 000 posts the next load immediately re-fetched.
 *
 * The 5 % that remains is real: the lattice is indexed on Mercator pixels whose
 * pitch changes slightly across the square, and `ensureAround`'s own `+1` covers
 * the bilinear read at the very edge.
 */
export const FETCH_SLACK = 1.05;

/** One terrain load's geometry: what it means, and what it covers. */
export interface TerrainWindow {
  /**
   * The coordinate system every sampled height is expressed in.
   *
   * A pure function of the anchor. A step must not perturb it — that is the
   * whole invariant, and `terrain-window.test.ts` asserts it bit-identically
   * rather than approximately.
   */
  readonly frame: EnuFrame;
  /** What `ensureAround` grows the post lattice around. */
  readonly fetchCentre: LatLng;
  /** Half-width of that lattice, metres. Square, not a disc — see the slack. */
  readonly fetchRadiusM: number;
}

export interface TerrainWindowOptions {
  /** Where the scene's ENU frame is anchored — `scene-anchor.ts` decides it. */
  readonly frameOrigin: LatLng;
  /**
   * Where the user is.
   *
   * Carried separately from `frameOrigin` because the window follows the user
   * while the frame does not. It does not move the sampled square yet: the
   * square is still symmetric about the frame origin, which is why the fetch
   * centre is the anchor rather than the user. Threading the offset through
   * `HeightfieldData` and both terrain shaders is the second half of this work,
   * and until it lands the covered ground is the anchor's rather than the
   * user's.
   */
  readonly centre: LatLng;
  /** Half-width of the sampled square, metres. */
  readonly extentM: number;
}

/**
 * The window for one terrain load.
 *
 * @throws `RangeError` if any input is not finite. A `NaN` anchor makes every
 *   ENU coordinate in the scene `NaN`, and `NaN` geometry drops triangles
 *   SILENTLY rather than reporting anything — so the failure surfaces as "the
 *   city did not draw", a long way from its cause. `nextAnchor` throws for the
 *   same reason.
 */
export function terrainWindowFor(options: TerrainWindowOptions): TerrainWindow {
  const { frameOrigin, centre, extentM } = options;
  requireFinite("frameOrigin", frameOrigin);
  requireFinite("centre", centre);
  if (!Number.isFinite(extentM) || extentM <= 0) {
    throw new RangeError(
      `terrainWindowFor: extentM must be a positive finite number, got ${extentM}`,
    );
  }

  return {
    frame: enuFrameAt(frameOrigin),
    // THE ANCHOR, NOT THE USER, and deliberately so while the sampled square is
    // still symmetric about the frame origin. Fetching around the user and
    // sampling around the anchor would read posts that were never fetched and
    // mean-fill them — a flat plateau where real relief exists, reported
    // nowhere. The two move together or not at all.
    fetchCentre: frameOrigin,
    fetchRadiusM: extentM * FETCH_SLACK,
  };
}

function requireFinite(label: string, position: LatLng): void {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    throw new RangeError(
      `terrainWindowFor: ${label} must be a finite lat/lng, got ${position.lat},${position.lng}`,
    );
  }
}
