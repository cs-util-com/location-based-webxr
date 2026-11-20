/**
 * When the OpenStreetMap overlay may ask for tiles, and how often: the
 * map's tuning (`GLOBE_OSM`), the height and speed band with its
 * hysteresis, the 0.3 s switch ramp, the sliding-minute request ceiling and
 * the reach test of a tile's region. The overlay itself
 * (`globe-osm-overlay.ts`) applies them.
 *
 * The OSM tile servers run under a usage policy (no heavy use, a visible
 * credit): every limit here exists to keep the editor a light user.
 *
 * @see globe-osm-gate.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

export const GLOBE_OSM = Object.freeze({
  /** Where the map has faded out (m from the camera); also the request reach. */
  fadeM: 300,
  /** Where the fade starts, as a share of `fadeM`. */
  fadeStartShare: 0.7,
  /** The coarsest zoom asked for (the plan's z15). */
  minZoom: 15,
  /** The ceiling on tile requests in any minute. */
  requestsPerMinute: 150,
  /** Off above this height over the ground (m)... */
  maxAboveGroundM: 200,
  /** ...or faster than this (m/s). */
  maxSpeedMps: 50,
  /**
   * On again only below this height (m) and this speed (m/s): a band
   * under the limits, so a camera near one does not switch the map (and
   * its requests) every frame (G1 review L2). 20 m and 5 m/s: about a
   * tenth of each limit.
   */
  onBelowAboveGroundM: 180,
  onBelowSpeedMps: 45,
  /** How long the map takes to fade in or out when it switches (ms). */
  rampMs: 300,
  /** How often tiles gated at load are looked at again (ms). */
  reevaluateMs: 500,
  /**
   * A look (`reevaluateMs`) is taken again at once when the camera moved
   * this far from where it was taken (m), and the map's reach (the gate's,
   * the hold's, `coverage`'s) is the fade's end widened by it: a tile in
   * reach now was in reach where the look was taken. 25 m: the speed limit
   * (`maxSpeedMps`) over one look.
   */
  lookSlackM: 25,
  /** At most this many tiles started per look. */
  reevaluateLimit: 8,
  /**
   * How long the failed map tiles wait before the map asks for them again
   * (ms; all of them at once, one retry per wait). The library never
   * retries by itself, so a dropped request left its tile bare while
   * loaded. The waits grow while the retries keep failing (an outage, no
   * connection, a server refusing with 429) and stay at the last, so
   * doomed retries never fill the request ceiling; a retried tile that
   * gets its map starts them over. 5 s first: short enough that a creator
   * who stops to look sees a dropped tile come back. Once any map request
   * is answered (the server is back), the next retry waits the first step
   * at most: a refusal that ended is not waited out at the 60 s step.
   */
  retryBackoffMs: Object.freeze([5_000, 10_000, 20_000, 60_000]),
  /**
   * After this many retries of a tile that failed again, the relief stops
   * waiting for its map (`mapReady`): its parent no longer stands in for
   * it, and it is drawn bare until a later retry brings the map. The
   * retries themselves go on (`retryBackoffMs`). Counted in timed
   * retries (one asked for, `retryNow`, does not count), not in time: a full request ceiling holds the retries back (they would be
   * turned away, not asked), so a busy ceiling never gives a tile up. 3:
   * a server failing every request gives a tile up after three waits plus
   * the requests' own time. The waits run on from the retry streak the
   * tile met: about 35 s (5 + 10 + 20 s) on a fresh streak, up to 180 s
   * (60 s three times) once earlier retries had failed, and 5 s each
   * whenever a request was answered since the last retry. Swept
   * 2026-11-03 over 2, 3 and 4 against a throttling fake server
   * (globe-osm-map-ready.test.ts).
   */
  giveUpRetries: 3,
  /**
   * A map tile request still running after this long fails (a
   * TimeoutError), so a server that never answers frees its download slot
   * and the tile counts as failed (retried, and given up after
   * `giveUpRetries`). Counted from the request ceiling letting it go, the
   * library's download queue included. 60 s: swept over 30, 60 and 120 s
   * with `giveUpRetries`.
   */
  requestTimeoutMs: 60_000,
  /**
   * The map's darkening gain: its luma compressed toward this (a white
   * tile ends at it, dark lines stay nearly as they are; `patchOsmFade`).
   * 1 draws the map as the tile server made it; a caller tunes its look.
   */
  gain: 1,
  /**
   * How the gain darkens (`OsmGainMode`): "flat" multiplies the colour by
   * it, which keeps the map's contrasts (a road and a name against the
   * land read as on the tile server's map); "compress" compresses the
   * luma toward it, which lowers them (a white road ends at the gain,
   * a dark name keeps nearly its own luma).
   */
  gainMode: "flat",
  /** The overlay texture per relief tile (px, the plugin's default). */
  resolution: 256,
  /**
   * Released map regions kept in memory, so a relief tile unloaded and
   * loaded again takes its map back without a request. A kept region
   * holds its region texture and the library's lock on its source tile
   * bitmap(s): about 512 KiB, so about 32 MiB at 64. Measured 2026-10-25
   * (a phone-width editor, 390 px, over a fake tile server): without a
   * keep 63 % of its map requests were re-fetches.
   */
  keepRegions: 64,
});

/** When the map is asked for: the height and speed band, and the coarsest zoom. */
export interface OsmGateLimits {
  readonly minZoom: number;
  readonly maxAboveGroundM: number;
  readonly onBelowAboveGroundM: number;
  readonly maxSpeedMps: number;
  readonly onBelowSpeedMps: number;
}

/** The band `osmOverlayActive` reads. */
export type OsmActiveLimits = Omit<OsmGateLimits, "minZoom">;

const isLimit = (v: unknown): v is number => typeof v === "number" && v > 0;

const LIMIT_KEYS = [
  "minZoom",
  "maxAboveGroundM",
  "onBelowAboveGroundM",
  "maxSpeedMps",
  "onBelowSpeedMps",
] as const;

/** RangeError unless both limits are > 0 and on again is at most off. */
function checkBand(on: unknown, off: unknown, what: string): void {
  if (!isLimit(on) || !isLimit(off) || on > off) {
    throw new RangeError(
      `the map's ${what} limits must be > 0 and on again at most off, got ${String(on)} and ${String(off)}`,
    );
  }
}

/**
 * The gate's limits: `GLOBE_OSM`'s (the flight's), with the caller's in
 * their place. Every height and speed > 0 (+Infinity opens it), each
 * "on again" limit at most its "off" limit, `minZoom` an integer in
 * [0, `maxZoom`]. RangeError otherwise.
 */
export function osmGateLimits(
  limits: Partial<OsmGateLimits>,
  maxZoom: number,
): OsmGateLimits {
  const out: Record<(typeof LIMIT_KEYS)[number], number> = {
    minZoom: GLOBE_OSM.minZoom,
    maxAboveGroundM: GLOBE_OSM.maxAboveGroundM,
    onBelowAboveGroundM: GLOBE_OSM.onBelowAboveGroundM,
    maxSpeedMps: GLOBE_OSM.maxSpeedMps,
    onBelowSpeedMps: GLOBE_OSM.onBelowSpeedMps,
  };
  for (const key of LIMIT_KEYS) {
    const v = limits[key];
    if (v !== undefined) out[key] = v;
  }
  checkBand(out.onBelowAboveGroundM, out.maxAboveGroundM, "height");
  checkBand(out.onBelowSpeedMps, out.maxSpeedMps, "speed");
  if (
    !(Number.isInteger(out.minZoom) && out.minZoom >= 0) ||
    !(out.minZoom <= maxZoom)
  ) {
    throw new RangeError(
      `the map's coarsest zoom must be an integer in [0, ${maxZoom}], got ${String(out.minZoom)}`,
    );
  }
  return Object.freeze(out);
}

/**
 * Whether the camera may ask for tiles, given whether it could (`wasActive`,
 * false by default): low and slow, both known. Off above
 * `maxAboveGroundM` or `maxSpeedMps`; on only below `onBelowAboveGroundM`
 * and `onBelowSpeedMps`; between the two, as it was. The limits are
 * `GLOBE_OSM`'s unless the caller's (checked by `osmGateLimits`).
 */
export function osmOverlayActive(
  { aboveGroundM, speedMps }: { aboveGroundM: number; speedMps: number },
  wasActive = false,
  limits: OsmActiveLimits = GLOBE_OSM,
): boolean {
  if (typeof aboveGroundM !== "number" || typeof speedMps !== "number") {
    return false;
  }
  const height = wasActive
    ? limits.maxAboveGroundM
    : limits.onBelowAboveGroundM;
  const speed = wasActive ? limits.maxSpeedMps : limits.onBelowSpeedMps;
  // NaN compares false: an unknown height or speed is off.
  return aboveGroundM <= height && speedMps <= speed;
}

/**
 * The map's shader switch (`uOsmOn`) one frame on: `dtMs` of `rampMs`
 * closer to `target` (0 or 1), landing on it, never past it. A step that
 * is not finite and > 0 (no time, a clock gone back) leaves it.
 */
export function rampOsmOn(
  current: number,
  target: number,
  dtMs: number,
  rampMs: number = GLOBE_OSM.rampMs,
): number {
  if (!(dtMs > 0 && Number.isFinite(dtMs))) return current;
  const step = rampMs > 0 ? dtMs / rampMs : 1;
  return target > current
    ? Math.min(target, current + step)
    : Math.max(target, current - step);
}

/** A sliding-minute ceiling on requests. */
export interface RequestCeiling {
  /** How long until one more request fits (ms; 0 now). */
  waitMs(): number;
  /** Counts a request made now. */
  take(): void;
  /** Requests in the last minute. */
  inLastMinute(): number;
  /** Requests ever counted. */
  total(): number;
  readonly perMinute: number;
}

const MINUTE_MS = 60_000;

/**
 * A ceiling of `perMinute` requests in any sliding minute. RangeError
 * unless a positive integer.
 */
export function createRequestCeiling(
  perMinute: number,
  now: () => number = () => performance.now(),
): RequestCeiling {
  if (!(Number.isInteger(perMinute) && perMinute >= 1)) {
    throw new RangeError(
      `a request ceiling is a positive integer, got ${perMinute}`,
    );
  }
  const times: number[] = [];
  let total = 0;
  const prune = () => {
    const from = now() - MINUTE_MS;
    while (times.length > 0 && times[0]! <= from) times.shift();
  };
  return {
    perMinute,
    waitMs() {
      prune();
      return times.length < perMinute ? 0 : times[0]! + MINUTE_MS - now();
    },
    take() {
      times.push(now());
      total++;
    },
    inLastMinute() {
      prune();
      return times.length;
    },
    total: () => total,
  };
}

const isRegion = (r: readonly number[]): boolean =>
  Array.isArray(r) &&
  r.length === 4 &&
  r.every(Number.isFinite) &&
  r[0]! <= r[2]! &&
  r[1]! <= r[3]!;

/**
 * Whether a region (radians, [west, south, east, north]) on the ground is
 * within `withinM` of the camera (`camera` in the ellipsoid's frame): its
 * bounding sphere (the centre on the ground, `groundAtM` there or the
 * ellipsoid where it reads null, the radius out to its farthest corner)
 * comes that close. RangeError for a malformed region or a distance that
 * is not finite and >= 0.
 */
export function regionNearCamera(
  region: readonly number[],
  camera: THREE.Vector3,
  {
    ellipsoid,
    groundAtM,
    withinM,
  }: {
    ellipsoid: Ellipsoid;
    groundAtM: (lat: number, lon: number) => number | null;
    withinM: number;
  },
): boolean {
  if (!isRegion(region)) {
    throw new RangeError(
      `a region is four finite numbers west <= east, south <= north, got ${String(region)}`,
    );
  }
  if (!(Number.isFinite(withinM) && withinM >= 0)) {
    throw new RangeError(`the reach must be finite and >= 0, got ${withinM}`);
  }
  const [w, s, e, n] = region as [number, number, number, number];
  const lat = (s + n) / 2;
  const lon = (w + e) / 2;
  const h = groundAtM(lat, lon) ?? 0;
  const at = (la: number, lo: number) =>
    ellipsoid.getCartographicToPosition(la, lo, h, new THREE.Vector3());
  const centre = at(lat, lon);
  let radius = 0;
  for (const [la, lo] of [
    [s, w],
    [s, e],
    [n, w],
    [n, e],
  ] as const) {
    radius = Math.max(radius, centre.distanceTo(at(la, lo)));
  }
  return camera.distanceTo(centre) - radius <= withinM;
}
