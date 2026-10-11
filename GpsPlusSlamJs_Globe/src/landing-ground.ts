/**
 * The landing's ground, read EARLY (round-4 plan 2026-10-11-0122 DEC-R4-1,
 * §6 items 3 and 4): the owner lands about 150 m above the GROUND, so the
 * flight needs the ground's height at its target before it plans its
 * line. One Terrarium tile at z12 under the target, the relief's and the
 * city's own source and zoom (the city plan's R13: one height source), read
 * at link or fix time; with no source (`relief=0`), a failed or slow read,
 * the ellipsoid (0). Later the relief's own finest height may revise it,
 * only by more than `marginM` (`groundRevisionM`), through the flight's
 * replan path.
 *
 * Pure but for the source it is handed (the lab passes the Osm library's
 * `TerrariumProvider`; a test passes a fake): no decoding here.
 *
 * @see landing-ground.ts.md
 */

export const LANDING_GROUND = Object.freeze({
  /** The Terrarium zoom read: `GLOBE_TERRAIN.maxZoom`'s (R13; tested equal). */
  zoom: 12,
  /**
   * How long the read may take before the ellipsoid stands in, ms. One
   * z12 tile is about 50-150 KB; a cold AWS fetch takes well under a
   * second, and the flight's first seconds are 65,000 km up, where a late
   * ground costs nothing visible (the replan's turn is measured there).
   */
  timeoutMs: 5_000,
  /**
   * The relief's finest height must differ by more than this before the
   * landing's ground is revised, m: the relief samples the same tile
   * through its own grid (258 x 258 against 256 x 256, a different
   * bilinear lattice), about a pixel apart (25 m at 47 N) on slopes.
   */
  marginM: 25,
  /**
   * A LOWERED ground comes only while the drop is at most this share of
   * the camera's height above the ground: lowered, the camera stands above
   * its meteor line and the replan turns the view by about 30-50 x (drop /
   * height) degrees (`flight-ground.test.ts`: 1.0 for 165 m at 5 km, 3.5
   * at 2 km, 0.6 for 30 m at 2 km), so this keeps a lowering's turn to
   * 0.4-0.6 degree; later the flight lands the drop higher instead. A
   * raise turns it by under 0.01 degree at any height (measured).
   */
  lowerPerHeight: 0.0125,
});

/** A place, degrees. */
interface Place {
  readonly lat: number;
  readonly lng: number;
}

/** What the read needs of an elevation source (the Osm library's provider). */
export interface GroundSource {
  elevationAt(
    positions: readonly Place[],
    signal?: AbortSignal,
  ): Promise<readonly (number | undefined)[]>;
}

/** The landing's ground: its height and where it came from. */
export interface LandingGround {
  /** Metres above the ellipsoid, never below 0 (the sea is drawn at 0). */
  readonly groundM: number;
  /** "tile": read; "fallback": the ellipsoid (no source, a failure, too slow). */
  readonly source: "tile" | "fallback";
}

const FALLBACK: LandingGround = Object.freeze({
  groundM: 0,
  source: "fallback",
});

/**
 * The source's height at `place`, or undefined: at `timeoutMs`, at the
 * caller's abort, or on a rejection (the read is aborted at the first two;
 * a source that ignores its signal cannot hold the answer).
 */
async function heightWithin(
  source: GroundSource,
  place: Place,
  timeoutMs: number,
  outer: AbortSignal | undefined,
): Promise<number | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const late = new Promise<undefined>((resolve) => {
    onAbort = () => {
      controller.abort();
      resolve(undefined);
    };
    timer = setTimeout(onAbort, timeoutMs);
  });
  outer?.addEventListener("abort", onAbort, { once: true });
  try {
    // A rejection is no data (and never unhandled once the race is over).
    // Asked at once (the caller's abort reaches the request), a throw
    // caught as a rejection.
    let asked: Promise<readonly (number | undefined)[]>;
    try {
      asked = source.elevationAt([place], controller.signal);
    } catch {
      return undefined;
    }
    const read = asked.then(
      (heights) => heights[0],
      () => undefined,
    );
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

/**
 * The ground under `place` from `source` (null: none, the ellipsoid), in
 * at most `timeoutMs`; never rejects: every failure is the fallback. The
 * read is aborted at the timeout or with `signal`.
 */
export async function readLandingGroundM(
  source: GroundSource | null,
  place: Place,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<LandingGround> {
  const usable =
    source !== null &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng) &&
    options.signal?.aborted !== true;
  if (!usable) return FALLBACK;
  const height = await heightWithin(
    source,
    place,
    options.timeoutMs ?? LANDING_GROUND.timeoutMs,
    options.signal,
  );
  return height === undefined || !Number.isFinite(height)
    ? FALLBACK
    : { groundM: Math.max(0, height), source: "tile" };
}

/**
 * The landing's ground revised by the relief's own finest height there
 * (`reliefM`, null where its finest tile is not loaded): that height,
 * never below 0, when it differs from `currentM` by more than `marginM`
 * (default `LANDING_GROUND.marginM`) and, for a LOWER ground, the drop is
 * at most `lowerPerHeight` of `heightM` (the camera's height above the
 * current ground; default: any); else null (no revision).
 */
export function groundRevisionM(
  currentM: number,
  reliefM: number | null,
  options: { readonly marginM?: number; readonly heightM?: number } = {},
): number | null {
  if (reliefM === null || !Number.isFinite(reliefM)) return null;
  const next = Math.max(0, reliefM);
  const marginM = options.marginM ?? LANDING_GROUND.marginM;
  if (!(Math.abs(next - currentM) > marginM)) return null;
  const drop = currentM - next;
  const heightM = options.heightM ?? Number.POSITIVE_INFINITY;
  return drop > LANDING_GROUND.lowerPerHeight * heightM ? null : next;
}
