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
   * How long one try of the read may take, ms: twice the slowest read
   * measured (real Terrarium requests up to 3.4 s, AWS z13 up to 7.9 s,
   * R4c). A late ground costs nothing visible (it arrives as a replan
   * while a link's flight is still thousands of km up), a missing one
   * lands the flight on the clearance (a raise found near the end is
   * refused, `PIN_FLIGHT.raisePerHeight`): at 5 s, with no retry, both
   * synthetic landings of r816's browser run fell back on a loaded machine.
   */
  timeoutMs: 16_000,
  /**
   * Tries of the read: a failed or slow try is tried again after
   * `backoffMs`, doubling, so the worst case (16 + 2 + 16 + 4 + 16 = 54 s)
   * still ends within a link's minute of flight.
   */
  attempts: 3,
  backoffMs: 2_000,
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
   * raise turns it by 0.01 degree or less, but only while the camera
   * stands well over the new ground: `pinGround` takes a raise only then
   * (`PIN_FLIGHT.raisePerHeight`; nearer, the view flipped by 135-180
   * degrees, the R4b milestone review).
   */
  lowerPerHeight: 0.0125,
  /**
   * A read outside this range (m) is a decoding fault, not ground: the
   * terrain plugin's own plausible heights (the R4b milestone review,
   * finding 8). The Dead Sea shore is -430 m, Everest 8,849 m.
   */
  minPlausibleM: -500,
  maxPlausibleM: 9_000,
  /**
   * Web Mercator's limit, degrees: beyond it the tile read is the one at
   * the clamped latitude, ground about 550 km away (finding 10).
   */
  maxLatDeg: 85.0511287798,
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
): Promise<unknown> {
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
    // Anything but an array of heights is no data (finding 7: a non-array
    // answer rejected the read).
    const read = asked.then(
      (heights: unknown): unknown =>
        Array.isArray(heights) ? (heights[0] as unknown) : undefined,
      () => undefined,
    );
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * The ground under `place` from `source` (null: none, the ellipsoid):
 * each try at most `timeoutMs`, a failed, slow or implausible try tried
 * again after `backoffMs` (doubling), up to `attempts` tries. Never
 * rejects: every failure is the fallback. Aborted with `signal`, which
 * also ends the retries.
 */
export async function readLandingGroundM(
  source: GroundSource | null,
  place: Place,
  options: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly attempts?: number;
    readonly backoffMs?: number;
  } = {},
): Promise<LandingGround> {
  const usable =
    source !== null &&
    Math.abs(place.lat) <= LANDING_GROUND.maxLatDeg &&
    Number.isFinite(place.lng);
  if (!usable) return FALLBACK;
  const { attempts, backoffMs, timeoutMs } = { ...LANDING_GROUND, ...options };
  for (let i = 0; i < Math.max(1, attempts); i++) {
    if (i > 0) await pause(backoffMs * 2 ** (i - 1), options.signal);
    if (options.signal?.aborted) return FALLBACK;
    const ground = groundFrom(
      await heightWithin(source, place, timeoutMs, options.signal),
    );
    if (ground.source === "tile") return ground;
  }
  return FALLBACK;
}

/**
 * A read height as the landing's ground: never below 0 (the sea is drawn
 * at 0); the fallback for anything but a number in the plausible range.
 */
function groundFrom(height: unknown): LandingGround {
  const plausible =
    typeof height === "number" &&
    height >= LANDING_GROUND.minPlausibleM &&
    height <= LANDING_GROUND.maxPlausibleM;
  return plausible
    ? { groundM: Math.max(0, height), source: "tile" }
    : FALLBACK;
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
