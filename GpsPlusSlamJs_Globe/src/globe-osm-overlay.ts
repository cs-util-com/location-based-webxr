/**
 * OpenStreetMap raster tiles on the relief, near the camera only (tour
 * editor plan 2026-10-17-1816 §13, G1 step 6; G0 spikes Q5): a second
 * overlay through the library's `ImageOverlayPlugin`, faded out with the
 * distance (300 m), asked for only at z15 and finer for tiles within that
 * distance of the camera (re-evaluated as it moves), at most about 150
 * requests a minute, off above 200 m or faster than 50 m/s and on again
 * only below 180 m and 45 m/s, faded in and out over 0.3 s.
 *
 * The OSM tile servers run under a usage policy (no heavy use, a visible
 * credit): every rule here exists to keep the editor a light user. The URL
 * and attribution are the caller's (the framework's `osm-tiles.ts`: one
 * home, DEC-H3); this module never names the host.
 *
 * @see globe-osm-overlay.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";
import { ImageOverlayPlugin, XYZTilesOverlay } from "3d-tiles-renderer/plugins";

import type { GlobeCredit } from "./globe-sources.js";
import { isTileTemplate } from "./globe-relief-source.js";

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

/**
 * The credit for the OSM tiles from the framework's attribution (HTML with
 * one link): its text, its link. RangeError without an https link.
 */
export function osmCredit(attributionHtml: string): GlobeCredit {
  if (typeof attributionHtml !== "string") {
    throw new RangeError("the OSM attribution must be a string");
  }
  const href = /href="(https:\/\/[^"]+)"/.exec(attributionHtml)?.[1];
  if (!href) {
    throw new RangeError(
      `the OSM attribution must link its copyright page over https, got ${attributionHtml}`,
    );
  }
  const full = attributionHtml
    .replace(/<[^>]*>/g, "")
    .replaceAll("&copy;", "©")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
  return { short: "OpenStreetMap", full, href };
}

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

/** How the map's gain darkens it (`GLOBE_OSM.gainMode`). */
export type OsmGainMode = "flat" | "compress";

/** The fade's uniforms (shared by every relief material). */
export interface OsmFadeUniforms {
  uOsmFadeM: { value: number };
  uOsmFadeStart: { value: number };
  uOsmOn: { value: number };
  /** The map's darkening gain, in (0, 1] (`GLOBE_OSM.gain`). */
  uOsmGain: { value: number };
  /** 1: the gain multiplies flat; 0: it compresses the luma. */
  uOsmFlat: { value: number };
}

/** The fade's uniforms and the gain's luma compression (GLSL). */
const OSM_FADE_DECLARATIONS = [
  "uniform float uOsmFadeM;",
  "uniform float uOsmFadeStart;",
  "uniform float uOsmOn;",
  "uniform float uOsmGain;",
  "uniform float uOsmFlat;",
  "vec3 osmGain( vec3 c, float g ) {",
  "  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );",
  "  return c * ( g / ( g + ( 1.0 - g ) * l ) );",
  "}",
];

/** The library's overlay blend (0.5.3, `wrapOverlaysMaterial.js`). */
const LAYER_BLEND = "tint.rgba *= layerInfo[ i ].opacity * wOpacity;";

/**
 * Patches the library's overlay layer blend in `shader` to fade every
 * layer out between `uOsmFadeStart x uOsmFadeM` and `uOsmFadeM` from the
 * camera, and to drop it with `uOsmOn` 0. Before the blend it darkens the
 * layer's colour by `uOsmGain`: with `uOsmFlat` 1 a flat multiply (every
 * contrast in the map kept), else compressing its luma L (Rec. 709
 * weights) to L g / (g + (1 - g) L): white ends at g, a dark line keeps
 * nearly its luma, the hue stays, and the map's contrasts are lowered.
 * Adds the uniforms. False, the shader untouched, where the blend line is
 * missing (a library change).
 */
export function patchOsmFade(
  shader: { uniforms: Record<string, unknown>; fragmentShader: string },
  uniforms: OsmFadeUniforms,
): boolean {
  if (!shader.fragmentShader.includes(LAYER_BLEND)) return false;
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      ["#include <common>", ...OSM_FADE_DECLARATIONS].join("\n"),
    )
    .replaceAll(
      LAYER_BLEND,
      "tint.rgb = uOsmFlat > 0.5 ? tint.rgb * uOsmGain : osmGain( tint.rgb, uOsmGain );\n" +
        "tint.rgba *= layerInfo[ i ].opacity * wOpacity * uOsmOn * ( 1.0 - smoothstep( uOsmFadeStart * uOsmFadeM, uOsmFadeM, length( vViewPosition ) ) );",
    );
  return true;
}

/** The library's overlay, as far as this module uses it (0.5.3, untyped parts). */
interface OverlayInternals {
  calculateLevel(range: number[]): number;
  getTexture(range: number[], level?: number): unknown;
  lockTexture(range: number[], level?: number): Promise<unknown>;
  releaseTexture(range: number[], level?: number): void;
  hasContent(range: number[], level?: number): boolean;
  fetch(url: string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

const base = XYZTilesOverlay.prototype as unknown as OverlayInternals;

/**
 * Waits `ms`, or rejects (AbortError) as soon as `signal` aborts, at once
 * if it has already: the abort event will not fire again for a listener
 * added after it. The listener goes when the wait ends either way.
 */
const sleepFor = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const aborted = () => new DOMException("aborted", "AbortError");
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(id);
      reject(aborted());
    };
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** `work`, or an AbortError as soon as `signal` aborts (a body stream
 *  of ours, not the network's, does not end on the abort by itself). */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

/** `uOsmFlat` for a gain mode: 1 flat, 0 compress; RangeError otherwise. */
function flatOf(gainMode: OsmGainMode): number {
  if (gainMode === "flat") return 1;
  if (gainMode === "compress") return 0;
  throw new RangeError(
    `the map's gain mode must be "flat" or "compress", got ${String(gainMode)}`,
  );
}

/** Refuses a fade that could not be drawn; throws RangeError. */
function checkFadeOptions(fadeM: number, fadeStartShare: number): void {
  if (!(Number.isFinite(fadeM) && fadeM > 0)) {
    throw new RangeError(
      `the fade distance must be finite and > 0, got ${fadeM}`,
    );
  }
  if (!(fadeStartShare >= 0 && fadeStartShare < 1)) {
    throw new RangeError(
      `the fade start's share must be in [0, 1), got ${fadeStartShare}`,
    );
  }
}

/** RangeError unless `giveUpRetries` is an integer >= 0 and `gain` in (0, 1]. */
function checkMapOptions(giveUpRetries: number, gain: number): void {
  if (!(Number.isInteger(giveUpRetries) && giveUpRetries >= 0)) {
    throw new RangeError(
      `the map's give-up retries must be an integer >= 0, got ${String(giveUpRetries)}`,
    );
  }
  if (!(gain > 0 && gain <= 1)) {
    throw new RangeError(`the map's gain must be in (0, 1], got ${gain}`);
  }
}

/** RangeError unless `keep` is an integer >= 0. */
function checkKeep(keep: number): void {
  if (!(Number.isInteger(keep) && keep >= 0)) {
    throw new RangeError(
      `the map's keep must be an integer >= 0, got ${String(keep)}`,
    );
  }
}

/** Whether what the library holds for a region is a loaded texture (not
 *  its fetch still running, nor a failed one's rejected promise). */
const isLoaded = (held: unknown): boolean =>
  held !== null && held !== undefined && !(held instanceof Promise);

/** The statuses a Response must be made without a body for. */
const NULL_BODY_STATUS: ReadonlySet<number> = new Set([204, 205, 304]);

/** `res` again with the body read from it; a body-less status cannot
 *  carry even an empty body. */
const rebodied = (res: Response, body: ArrayBuffer): Response =>
  new Response(NULL_BODY_STATUS.has(res.status) ? null : body, res);

/**
 * The library's XYZ overlay behind a gate: the plugin's lock of a region
 * (which fetches) reaches the library only where `gate(range, level)`
 * allows it, a region counts as content only while locked, a release
 * unlocks only what was locked, and every fetch waits for `ceiling`.
 * A region whose last lock goes keeps its loaded texture in memory, up
 * to `keep` regions (the one released longest ago goes first), and a
 * lock of a kept region at the level it was kept at takes it back without
 * the gate or a request (at another level it is given back first).
 * RangeError for a url without `{z}/{x}/{y}` or a keep that is not an
 * integer >= 0; TypeError without a gate.
 */
export class GatedOsmOverlay extends XYZTilesOverlay {
  private readonly gate: (range: number[], level: number) => boolean;
  private readonly ceiling: RequestCeiling;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly onAnswered: () => void;
  private readonly locked = new Map<string, number>();
  private gatedLocks = 0;
  private locks = 0;
  private releases = 0;
  private keptHits = 0;
  /** Failed lock requests by error name (aborts not counted). */
  private readonly lockErrors = new Map<string, number>();
  private lastLockError: { name: string; message: string } | null = null;
  /** Released regions still locked in the library, oldest first. */
  private readonly kept = new Map<string, { range: number[]; level: number }>();
  private keep: number;
  private finestLevel: number | null = null;
  /** How long each locked region's request took (ms), once it settled. */
  private readonly lockTimes = new Map<string, number>();

  constructor({
    url,
    maxZoom,
    gate,
    ceiling,
    sleep = sleepFor,
    keep = GLOBE_OSM.keepRegions,
    timeoutMs = GLOBE_OSM.requestTimeoutMs,
    onAnswered = () => {},
  }: {
    url: string;
    maxZoom: number;
    gate: (range: number[], level: number) => boolean;
    ceiling: RequestCeiling;
    /** Called for each request answered with a success status. */
    onAnswered?: () => void;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Released textures kept in memory (regions). */
    keep?: number;
    /** A request's time limit (ms). */
    timeoutMs?: number;
  }) {
    if (!isTileTemplate(url)) {
      throw new RangeError(
        `the OSM overlay needs a {z}/{x}/{y} template, got ${String(url)}`,
      );
    }
    if (typeof gate !== "function") {
      throw new TypeError("the OSM overlay needs its gate");
    }
    checkKeep(keep);
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
      throw new RangeError(
        `the map's request time limit must be finite and > 0, got ${String(timeoutMs)}`,
      );
    }
    super({ url, levels: maxZoom + 1 });
    this.timeoutMs = timeoutMs;
    this.onAnswered = onAnswered;
    this.keep = keep;
    this.gate = gate;
    this.ceiling = ceiling;
    this.sleep = sleep;
  }

  /** A region's key: the plugin locks and releases one tile's region by the same range. */
  private key(range: number[]): string {
    return range.join("_");
  }

  /** The library's level for a region: only once ready (its image source). */
  private levelOf(range: number[], level?: number): number {
    return level ?? base.calculateLevel.call(this, range);
  }

  /** Whether a region's texture is locked in the library. */
  isLocked(range: number[]): boolean {
    return (this.locked.get(this.key(range)) ?? 0) > 0;
  }

  /** Whether the gate would let a region through now (never before ready). */
  wanted(range: number[], level?: number): boolean {
    return this.isReady && this.gate(range, this.levelOf(range, level));
  }

  hasContent(range: number[], level?: number): boolean {
    if (!this.isLocked(range)) return false;
    const l = this.levelOf(range, level);
    return base.hasContent.call(this, range, l);
  }

  /**
   * Locks a region through the gate. Before the overlay is ready (the
   * library's plugin processes the relief's loaded tiles before it
   * initialises its overlays, and the level needs the image source the
   * overlay's init sets up), turned away like a gated lock: the
   * re-evaluation picks the tile up later.
   */
  lockTexture(range: number[], level?: number): Promise<unknown> {
    if (!this.isReady) {
      this.gatedLocks++;
      return Promise.resolve(null);
    }
    const l = this.levelOf(range, level);
    this.finestLevel = Math.max(this.finestLevel ?? l, l);
    const k = this.key(range);
    const kept = this.kept.get(k);
    if (kept) {
      this.kept.delete(k);
      if (kept.level === l) {
        // Its library lock was never given up: no gate, no request.
        this.locked.set(k, 1);
        this.locks++;
        this.keptHits++;
        return Promise.resolve(base.getTexture.call(this, range, l));
      }
      // Held under another level: given back, and locked anew below.
      this.releases++;
      base.releaseTexture.call(this, kept.range, kept.level);
    }
    if (!this.gate(range, l)) {
      this.gatedLocks++;
      return Promise.resolve(null);
    }
    this.locked.set(k, (this.locked.get(k) ?? 0) + 1);
    this.locks++;
    const started = performance.now();
    const asked = base.lockTexture.call(this, range, l);
    const settled = () => {
      if (this.isLocked(range)) {
        this.lockTimes.set(k, Math.round(performance.now() - started));
      }
    };
    // A second handler, for the timing only: the caller still gets the
    // request's own promise and its rejection.
    void Promise.resolve(asked).then(settled, settled);
    return asked;
  }

  /** How long a locked region's last request took (ms), or null while it
   *  runs, for a region not locked, and for one served from the keep. */
  lockMs(range: number[]): number | null {
    return this.lockTimes.get(this.key(range)) ?? null;
  }

  releaseTexture(range: number[], level?: number): void {
    const k = this.key(range);
    const n = this.locked.get(k) ?? 0;
    if (n === 0) return;
    const l = this.levelOf(range, level);
    if (n > 1) {
      this.locked.set(k, n - 1);
      base.releaseTexture.call(this, range, l);
      return;
    }
    this.locked.delete(k);
    this.lockTimes.delete(k);
    if (this.keep > 0 && isLoaded(base.getTexture.call(this, range, l))) {
      this.kept.set(k, { range: [...range], level: l });
      this.trimKept();
      return;
    }
    this.releases++;
    base.releaseTexture.call(this, range, l);
  }

  /**
   * How many released textures to keep (regions); the ones released
   * longest ago go at once past it, all of them at 0. RangeError unless
   * an integer >= 0.
   */
  setKeep(keep: number): void {
    checkKeep(keep);
    this.keep = keep;
    this.trimKept();
  }

  /** Gives the regions released longest ago back to the library, down to the keep. */
  private trimKept(): void {
    for (const [k, { range, level }] of this.kept) {
      if (this.kept.size <= this.keep) return;
      this.kept.delete(k);
      this.releases++;
      base.releaseTexture.call(this, range, level);
    }
  }

  /**
   * The plugin's lock (the library's rethrows a failed request's error
   * from a promise nobody holds: an unhandled error in the console per
   * dropped request). The failure is not lost: the plugin reads the same
   * request for the tile and records it as the tile's failed state, which
   * the map asks for again (`retryBackoffMs`). Recorded here instead
   * (`noteLockError`).
   */
  lockTextureSafe(range: number[]): Promise<unknown> {
    const result = this.lockTexture(range);
    result.catch((err: unknown) => {
      this.noteLockError(err);
    });
    return result;
  }

  /**
   * Records a lock's failed request: counted by the error's name, the last
   * one kept, and the first of each name warned in the console (the
   * console stays readable through an outage: one line per kind, not per
   * tile). An abort is the library dropping a region it no longer needs,
   * not a failure, and is not recorded.
   */
  noteLockError(err: unknown): void {
    const { name, message } = errorParts(err);
    if (name === "AbortError") return;
    const seen = this.lockErrors.get(name) ?? 0;
    this.lockErrors.set(name, seen + 1);
    this.lastLockError = { name, message };
    if (seen === 0) {
      // eslint-disable-next-line no-console -- once per kind, the only trace of a bare map
      console.warn(
        `street map: a tile request failed (${name}: ${message}); failed tiles are asked for again later`,
      );
    }
  }

  async fetch(
    url: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    for (let wait = this.ceiling.waitMs(); wait > 0;) {
      await this.sleep(wait, options.signal);
      wait = this.ceiling.waitMs();
    }
    this.ceiling.take();
    // The time limit runs from here, the library's download queue included:
    // a request the queue drops for it is a failure too (a TimeoutError),
    // never an abort, which the plugin would leave neither failed nor
    // drawn. It covers the body too: read here, inside the limit (a server
    // that sends the headers and stalls would otherwise hold the slot
    // while the library reads it), and handed on whole.
    const limit = new AbortController();
    const id = setTimeout(() => limit.abort(), this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, limit.signal])
      : limit.signal;
    try {
      const res = await base.fetch.call(this, url, { ...options, signal });
      if (!(res instanceof Response)) return res;
      const body = await untilAborted(res.arrayBuffer(), signal);
      if (res.ok) this.onAnswered();
      return rebodied(res, body);
    } catch (err) {
      if (limit.signal.aborted && !options.signal?.aborted) {
        throw new DOMException(
          `the map tile took longer than ${this.timeoutMs / 1000} s`,
          "TimeoutError",
        );
      }
      throw err;
    } finally {
      clearTimeout(id);
    }
  }

  /**
   * Locks the gate let through and turned away, regions locked now,
   * textures given back to the library (it drops them, so a re-visit
   * fetches again), the keep, the regions kept now and the locks served
   * from it, and the finest level a lock asked for (null before the
   * first): under the coarsest zoom in force, the relief tree is too
   * coarse for the map. Then the failed lock requests by error name and
   * the last one (`noteLockError`).
   */
  stats(): {
    locks: number;
    gatedLocks: number;
    lockedRegions: number;
    releases: number;
    keep: number;
    keptRegions: number;
    keptHits: number;
    finestLevel: number | null;
    lockErrors: Record<string, number>;
    lastLockError: { name: string; message: string } | null;
  } {
    return {
      locks: this.locks,
      gatedLocks: this.gatedLocks,
      lockedRegions: this.locked.size,
      releases: this.releases,
      keep: this.keep,
      keptRegions: this.kept.size,
      keptHits: this.keptHits,
      finestLevel: this.finestLevel,
      lockErrors: Object.fromEntries(this.lockErrors),
      lastLockError: this.lastLockError,
    };
  }
}

/** The plugin's private state the re-evaluation uses (0.5.3). */
export interface OverlayPluginInternals {
  overlayInfo: Map<
    object,
    {
      tileInfo: Map<
        object,
        {
          range: number[] | null;
          target: unknown;
          failed: boolean;
          meshInfo: Map<unknown, unknown>;
        }
      >;
    }
  >;
  _fetchTileOverlayTexture(
    tile: object,
    overlay: object,
    info: object,
  ): Promise<unknown>;
  _updateLayers(tile: object): void;
}

type TileOverlayInfo =
  OverlayPluginInternals["overlayInfo"] extends Map<
    object,
    { tileInfo: Map<object, infer I> }
  >
    ? I
    : never;

/** A processed tile with no texture, not failed, not locked, wanted now. */
const retryable = (info: TileOverlayInfo, overlay: GatedOsmOverlay): boolean =>
  info.range !== null &&
  info.target === null &&
  !info.failed &&
  info.meshInfo.size > 0 &&
  !overlay.isLocked(info.range) &&
  overlay.wanted(info.range);

/**
 * The tiles whose map was gated when they loaded and that the gate lets
 * through now (processed, no texture, not failed, not locked): locked,
 * fetched and drawn as the plugin's own retry does, at most `limit` per
 * call. Returns how many were started and how many more the gate would
 * have let through (left for a later call).
 */
export function reevaluateGatedTiles(
  plugin: OverlayPluginInternals,
  overlay: GatedOsmOverlay,
  { limit }: { limit: number },
): { started: number; left: number } {
  const tileInfo = plugin.overlayInfo.get(overlay)?.tileInfo;
  if (!tileInfo) return { started: 0, left: 0 };
  let started = 0;
  let left = 0;
  for (const [tile, info] of tileInfo) {
    if (!retryable(info, overlay)) continue;
    if (started >= limit) {
      left++;
      continue;
    }
    const range = info.range!;
    started++;
    void overlay.lockTexture(range).catch((err: unknown) => {
      overlay.noteLockError(err);
    });
    plugin
      ._fetchTileOverlayTexture(tile, overlay, info)
      .then(() => plugin._updateLayers(tile))
      .catch(() => {});
  }
  return { started, left };
}

/** The processed tiles whose map request failed. */
function failedTiles(
  plugin: OverlayPluginInternals,
  overlay: GatedOsmOverlay,
): TileOverlayInfo[] {
  const tileInfo = plugin.overlayInfo.get(overlay)?.tileInfo;
  if (!tileInfo) return [];
  return [...tileInfo.values()].filter(
    (info) => info.failed && info.range !== null,
  );
}

/** An error's name and message, whatever was thrown. */
function errorParts(err: unknown): { name: string; message: string } {
  if (typeof err === "object" && err !== null) {
    const { name, message } = err as { name?: unknown; message?: unknown };
    return {
      name: typeof name === "string" && name !== "" ? name : "Error",
      message: typeof message === "string" ? message : "",
    };
  }
  return { name: typeof err, message: String(err) };
}

/** What `createGlobeOsmOverlay` attaches to: the relief's tiles. */
export interface OsmOverlayTerrain {
  readonly tiles: {
    readonly group: THREE.Object3D;
    readonly ellipsoid: Ellipsoid;
    registerPlugin(plugin: object): void;
    forEachLoadedModel(cb: (scene: THREE.Object3D) => void): void;
    addEventListener(
      type: "load-model",
      cb: (e: { scene: THREE.Object3D }) => void,
    ): void;
    /** The tiles drawn in the last update (the library's set); only
     *  `coverage` reads it. */
    readonly visibleTiles?: ReadonlySet<object>;
    /**
     * Asked of each child tile by the patched traversal
     * (`patches/3d-tiles-renderer@0.5.3.patch`): false keeps its parent
     * drawn in its place. `attach` sets it to `mapReady` (with any hook
     * already there).
     */
    isTileReady?: ((tile: object) => boolean) | undefined;
  };
  readonly plugin: {
    sampleCartographicElevation(lat: number, lon: number): number | null;
  };
}

/** The drawn relief tiles near the camera, by their map (`coverage`). */
export interface OsmCoverage {
  /** Drawn tiles that come within the map's reach of the camera (the
   *  fade's end and the look's slack: where the gate asks for the map). */
  readonly near: number;
  /** Of those, the ones with their map. */
  readonly withMap: number;
  /** Too coarse for it: the level picked is under the coarsest zoom. */
  readonly coarse: number;
  /** Waiting for it: gated, throttled, loading or failed. */
  readonly waiting: number;
  /** Of those, the ones whose request failed: asked for again only every
   *  `GLOBE_OSM.retryFailedMs`, so a check that waits for the map stops
   *  waiting on these. */
  readonly failed: number;
  /** Of the failed ones, those the map gave up waiting for
   *  (`GLOBE_OSM.giveUpRetries`): drawn bare, still asked for again. */
  readonly givenUp: number;
  /** Drawn tiles the plugin has not placed yet (no range). */
  readonly unprocessed: number;
  /** Waiting tiles not given up whose parent has its map: drawn bare in
   *  place of a mapped tile, which the hold (`mapReady`) exists to stop. */
  readonly bareUnderMap: number;
}

/**
 * The street map's loading state, small and typed for an interface to
 * show (`mapLoad`): read from `coverage` and the request ceiling.
 */
export interface OsmMapLoad {
  /** Tiles near the camera without their map yet. */
  readonly waiting: number;
  /** Of those, the ones whose last request failed. */
  readonly failed: number;
  /** Of those, the ones the map gave up waiting for. */
  readonly givenUp: number;
  /** How long until the request ceiling lets the next request go (s,
   *  tenths; 0 when it is not full). */
  readonly ceilingWaitS: number;
}

/** One drawn tile near the camera, as a loading table shows it
 *  (`mapTiles`). */
export interface OsmMapTile {
  /** The map tile at the relief tile's centre: zoom/x/y. */
  readonly key: string;
  readonly status: "loaded" | "loading" | "waiting" | "failed";
  /** Why it waits or what failed, "" when there is nothing to say. */
  readonly note: string;
  /** How long its request took (ms), null while it runs or unknown. */
  readonly ms: number | null;
}

/** The tiles the last retry asked for again (`lastRetry`): which retry
 *  it was, how many, and how many have their map now or failed again (the
 *  rest still load). */
export interface OsmRetryOutcome {
  /** The retry's number, 1 for the first (timed or asked for): an
   *  outcome answers an ask (`OsmRetryAsk.retry`) from that number up. */
  readonly retry: number;
  readonly tiles: number;
  readonly loaded: number;
  readonly failed: number;
}

/** What `retryNow` did: how many failed tiles it asks for again, or why
 *  it asks for none, and the number of the retry that will answer it. */
export interface OsmRetryAsk {
  /** The failed tiles asked for again (0 when refused). */
  readonly tiles: number;
  /** Why none were asked for: no tile failed, or the map is off (it asks
   *  for nothing until it is on); null when asked. */
  readonly refused: "none-failed" | "map-off" | null;
  /** The `OsmRetryOutcome.retry` from which an outcome answers this ask:
   *  an outcome with a lower number is from before it. */
  readonly retry: number;
}

const NO_COVERAGE: OsmCoverage = Object.freeze({
  near: 0,
  withMap: 0,
  coarse: 0,
  waiting: 0,
  failed: 0,
  givenUp: 0,
  unprocessed: 0,
  bareUnderMap: 0,
});

/** The pose `update` takes each frame. */
export interface OsmCameraPose {
  /** The camera, world space. */
  readonly position: THREE.Vector3;
  /** Its height over the drawn ground (m), NaN unknown. */
  readonly aboveGroundM: number;
  /** Its speed (m/s). */
  readonly speedMps: number;
  /** Now (ms, the caller's clock). */
  readonly nowMs: number;
}

const FADED = Symbol("globe-osm-fade");

/**
 * The OSM overlay for a relief, attached once (`attach`): registers the
 * library's `ImageOverlayPlugin` (tile splitting off: the relief's mesh is
 * not refined for the map) with the gated overlay, and patches the fade
 * into every relief material, those loaded already and those to come.
 * Off until `setEnabled(true)`. `update(pose)` each frame: the gate's
 * camera, the active rule, the fade's switch, and every `reevaluateMs`
 * the tiles gated at load. `limits` replace the flight's (`GLOBE_OSM`)
 * for the band and the coarsest zoom; `keep` is the overlay's keep,
 * `timeoutMs` its request time limit, `giveUpRetries` the retries after
 * which the relief stops waiting for a tile's map (`mapReady`), `gain`
 * the map's darkening (`GLOBE_OSM.gain`, `patchOsmFade`), `gainMode` how
 * (`GLOBE_OSM.gainMode`).
 * RangeError from `osmCredit`, `osmGateLimits` or the overlay for a bad
 * attribution, limit, url, keep or time limit, for `giveUpRetries`
 * that is not an integer >= 0, for a `gain` outside (0, 1] and for a
 * `gainMode` that is neither "flat" nor "compress".
 */
export function createGlobeOsmOverlay({
  url,
  attribution,
  maxZoom,
  renderer,
  fadeM = GLOBE_OSM.fadeM,
  fadeStartShare = GLOBE_OSM.fadeStartShare,
  limits: callerLimits = {},
  keep = GLOBE_OSM.keepRegions,
  timeoutMs = GLOBE_OSM.requestTimeoutMs,
  giveUpRetries = GLOBE_OSM.giveUpRetries,
  gain = GLOBE_OSM.gain,
  gainMode = GLOBE_OSM.gainMode,
}: {
  url: string;
  attribution: string;
  maxZoom: number;
  renderer: THREE.WebGLRenderer;
  fadeM?: number;
  /** Where the fade starts, as a share of `fadeM`, in [0, 1). */
  fadeStartShare?: number;
  limits?: Partial<OsmGateLimits>;
  /** Released map regions kept in memory (`GatedOsmOverlay`'s keep). */
  keep?: number;
  /** A map request's time limit (ms; `GatedOsmOverlay`'s). */
  timeoutMs?: number;
  /** Retries before the relief stops waiting for a tile's map. */
  giveUpRetries?: number;
  /** The map's darkening gain, in (0, 1]. */
  gain?: number;
  /** How the gain darkens ("flat" or "compress"). */
  gainMode?: OsmGainMode;
}) {
  checkFadeOptions(fadeM, fadeStartShare);
  checkMapOptions(giveUpRetries, gain);
  const flat = flatOf(gainMode);
  const limits = osmGateLimits(callerLimits, maxZoom);
  const credit = osmCredit(attribution);
  const uniforms: OsmFadeUniforms = {
    uOsmFadeM: { value: fadeM },
    uOsmFadeStart: { value: fadeStartShare },
    uOsmOn: { value: 0 },
    uOsmGain: { value: gain },
    uOsmFlat: { value: flat },
  };
  const ceiling = createRequestCeiling(GLOBE_OSM.requestsPerMinute);
  let terrain: OsmOverlayTerrain | null = null;
  let enabled = false;
  let active = false;
  const camera = new THREE.Vector3();
  let unpatched = 0;
  // The diagnostics: what each way of losing the map did.
  let switchedOff = 0;
  let unknownHeightFrames = 0;
  let ceilingFullMs = 0;
  let reevaluateBacklog = 0;
  let cappedLooks = 0;
  let failedRetries = 0;
  /** How long failed tiles have waited since the last retry (ms; the time
   *  the request ceiling was full not counted), or null without any. */
  let failedWaitedMs: number | null = null;
  /** The last retry look (ms), or null. */
  let lastRetryLook: number | null = null;
  /** How many retries asked for each tile again (its overlay info). */
  const retriesOf = new WeakMap<TileOverlayInfo, number>();
  /** Retries since a retried tile last got its map. */
  let retryStreak = 0;
  /** Whether a map request was answered since the last retry. */
  let answeredSinceRetry = false;
  /** The tiles the last retry asked for again (cleared once one heals). */
  let retried: TileOverlayInfo[] = [];
  /** The same, kept until the next retry: what `lastRetry` reports. */
  let lastRetried: TileOverlayInfo[] | null = null;
  /** A retry asked for now (`retryNow`), run at the next look. */
  let retryAsked = false;
  /** The map's reach (m): the fade's end and the look's slack. */
  const reach = () => uniforms.uOsmFadeM.value + GLOBE_OSM.lookSlackM;
  /** Whether a range (normalised) comes within `withinM` of the camera;
   *  false for one the projection cannot place. */
  const rangeNear = (range: number[], withinM: number): boolean => {
    if (!terrain) return false;
    const { ellipsoid } = terrain.tiles;
    const ground = terrain.plugin;
    try {
      const region = (
        overlay.projection as {
          fromNormalizedToCartographicRange(r: number[]): number[];
        }
      ).fromNormalizedToCartographicRange(range);
      return regionNearCamera(region, camera, {
        ellipsoid,
        groundAtM: (la, lo) => ground.sampleCartographicElevation(la, lo),
        withinM,
      });
    } catch {
      return false;
    }
  };
  const gate = (range: number[], level: number): boolean => {
    if (!terrain || !active || level < limits.minZoom) return false;
    if (ceiling.waitMs() > 0) return false;
    // A range the projection cannot place is never asked for.
    return rangeNear(range, reach());
  };
  const overlay = new GatedOsmOverlay({
    url,
    maxZoom,
    gate,
    ceiling,
    keep,
    timeoutMs,
    onAnswered: () => {
      answeredSinceRetry = true;
    },
  });
  const plugin = new ImageOverlayPlugin({
    renderer,
    overlays: [overlay],
    enableTileSplitting: false,
    resolution: GLOBE_OSM.resolution,
  });
  // The plugin's dispose releases its regions but never disposes the
  // overlay: emptied first, the keep holds nothing past the view.
  // (0.5.3's typings omit `dispose`, which the tiles call.)
  const disposable = plugin as unknown as { dispose(): void };
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the plugin below
  const disposePlugin = (
    ImageOverlayPlugin.prototype as unknown as { dispose(this: unknown): void }
  ).dispose;
  disposable.dispose = () => {
    overlay.setKeep(0);
    disposePlugin.call(plugin);
  };
  const fade = (scene: THREE.Object3D) => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as
        (THREE.Material & { [FADED]?: true }) | undefined;
      if (!(o as THREE.Mesh).isMesh || !m || m[FADED]) return;
      m[FADED] = true;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the material below
      const previous = m.onBeforeCompile;
      m.onBeforeCompile = function (shader, r) {
        previous.call(this, shader, r);
        if (!patchOsmFade(shader, uniforms)) unpatched++;
      };
      // Its own program: the fade's uniforms are not in an unpatched one.
      m.defines = { ...m.defines, GLOBE_OSM_FADE: 1 };
      m.needsUpdate = true;
    });
  };
  let lastLook = Number.NEGATIVE_INFINITY;
  let lastNow: number | null = null;
  /** The diagnostics of one frame, after the rule ran. */
  const count = (pose: OsmCameraPose, wasActive: boolean) => {
    if (enabled && !Number.isFinite(pose.aboveGroundM)) unknownHeightFrames++;
    if (wasActive && !active) switchedOff++;
    if (active && wasActive && lastNow !== null && ceiling.waitMs() > 0) {
      ceilingFullMs += Math.max(0, pose.nowMs - lastNow);
    }
  };
  /** The wait before the next retry (`retryBackoffMs` by the streak; the
   *  first step at most once a request was answered since the last). */
  const retryWaitMs = (): number => {
    const waits = GLOBE_OSM.retryBackoffMs;
    const backoff = waits[Math.min(retryStreak, waits.length - 1)]!;
    return answeredSinceRetry ? Math.min(backoff, waits[0]!) : backoff;
  };
  /** Whether the failed tiles have waited out the backoff (the first sight
   *  starts the wait; it stands still while the ceiling is full). */
  const waitedOut = (sinceLook: number): boolean => {
    if (failedWaitedMs === null) {
      failedWaitedMs = 0;
      return false;
    }
    if (ceiling.waitMs() > 0) return false;
    failedWaitedMs += Math.max(0, sinceLook);
    return failedWaitedMs >= retryWaitMs();
  };
  /**
   * The library never asks again for a tile whose request failed: once a
   * failed tile has waited `retryWaitMs`, its reset releases every failed
   * tile and locks it anew (through the gate and the ceiling). Each retry
   * lengthens the next wait; a retried tile that got its map (no longer
   * failed, with its texture) starts the waits over, and any answered
   * request since the last retry cuts the next wait to the first step.
   * The reset clears the failed mark at once, so only the texture tells a
   * success. The wait stands still while the request ceiling is full: a
   * retry then would be turned away by the gate, not asked, and would count
   * towards giving the tile up (`giveUpRetries`) without a request having
   * failed.
   *
   * `now`: a retry asked for (`retryNow`) skips the first sight and the
   * backoff, but still waits while the ceiling is full.
   */
  const retryFailed = (nowMs: number, now: boolean) => {
    const internals = plugin as unknown as OverlayPluginInternals;
    const sinceLook = lastRetryLook === null ? 0 : nowMs - lastRetryLook;
    lastRetryLook = nowMs;
    if (retried.some((info) => !info.failed && info.target !== null)) {
      retryStreak = 0;
      retried = [];
    }
    const failed = failedTiles(internals, overlay);
    if (failed.length === 0) {
      failedWaitedMs = null;
      retryAsked = false;
      return;
    }
    if (!(now ? ceiling.waitMs() === 0 : waitedOut(sinceLook))) return;
    failedWaitedMs = null;
    retryAsked = false;
    failedRetries++;
    retryStreak++;
    answeredSinceRetry = false;
    retried = failed;
    lastRetried = failed;
    // Only the timed retries count towards giving a tile up: one asked for
    // is the person's click, not the server failing on its own clock.
    if (!now) {
      for (const info of failed) {
        retriesOf.set(info, (retriesOf.get(info) ?? 0) + 1);
      }
    }
    plugin.resetFailedOverlays();
  };
  /** The tiles the map gave up waiting for. */
  const gaveUp = new WeakSet<TileOverlayInfo>();
  /**
   * Whether the map gave up waiting for a tile: failed again after
   * `giveUpRetries` retries, and no map since. It stays given up through
   * the later retries (each clears the failed mark while it runs), so the
   * tile is not swapped back for its parent at every retry.
   */
  const givenUp = (info: TileOverlayInfo): boolean => {
    if (info.target !== null) return false;
    if (gaveUp.has(info)) return true;
    if (!info.failed || (retriesOf.get(info) ?? 0) < giveUpRetries) {
      return false;
    }
    gaveUp.add(info);
    return true;
  };
  /** How many times the relief asked `isTileReady` (the patched traversal
   *  only: 0 on a renderer without it). */
  let readinessAsks = 0;
  /** The look `mapReady`'s cache is keyed by: every `reevaluateMs`, or
   *  at once when the camera moved `lookSlackM` from where it was taken. */
  let readyLook = 0;
  let lastLookAt = Number.NEGATIVE_INFINITY;
  const lookFrom = new THREE.Vector3();
  /** Per tile: whether its map is wanted near the camera, at that look. */
  const nearCache = new WeakMap<object, { look: number; wanted: boolean }>();
  const wantedNear = (tile: object, range: number[]): boolean => {
    const cached = nearCache.get(tile);
    if (cached?.look === readyLook) return cached.wanted;
    const level = base.calculateLevel.call(overlay, range);
    // A tile the map has no content for (past its latitudes) never gets
    // one: never held for it.
    const wanted =
      level >= limits.minZoom &&
      base.hasContent.call(overlay, range, level) &&
      rangeNear(range, reach());
    nearCache.set(tile, { look: readyLook, wanted });
    return wanted;
  };
  /**
   * Whether a relief tile may be drawn as far as its map goes: false only
   * while the map is on, the tile is in the map's reach (where the gate
   * asks for its map), at the coarsest zoom or finer, inside the map's
   * content, and has no map yet that the map has not given up on. The
   * patched traversal asks it of child tiles only, so a drawn parent stays
   * in their place until they have it. The distance, zoom and content are
   * looked at once per look per tile (`lookSlackM`).
   */
  const mapReady = (tile: object): boolean => {
    if (!active || !overlay.isReady) return true;
    const info = (plugin as unknown as OverlayPluginInternals).overlayInfo
      .get(overlay)
      ?.tileInfo.get(tile);
    if (!info || info.range === null || info.target !== null) return true;
    if (givenUp(info)) return true;
    return !wantedNear(tile, info.range);
  };
  /** A drawn tile's place in `coverage`. */
  const kindOf = (
    info: TileOverlayInfo,
    withinM: number,
  ): "unprocessed" | "far" | "withMap" | "coarse" | "waiting" => {
    if (info.range === null) return "unprocessed";
    if (!rangeNear(info.range, withinM)) return "far";
    if (info.target !== null) return "withMap";
    return base.calculateLevel.call(overlay, info.range) < limits.minZoom
      ? "coarse"
      : "waiting";
  };
  /** A drawn tile's row of `mapTiles` (its range placed). */
  const tileRow = (info: TileOverlayInfo): OsmMapTile => {
    const range = info.range!;
    const z = base.calculateLevel.call(overlay, range);
    const n = 2 ** z;
    const x = Math.floor(((range[0]! + range[2]!) / 2) * n);
    // The normalised range counts up from the south, tile rows from the north.
    const y = Math.floor((1 - (range[1]! + range[3]!) / 2) * n);
    const key = `${String(z)}/${String(x)}/${String(y)}`;
    const ms = overlay.lockMs(range);
    if (info.target !== null) return { key, status: "loaded", note: "", ms };
    if (info.failed) {
      const note = givenUp(info)
        ? "Request failed; drawn without its map"
        : "Request failed; asked for again later";
      return { key, status: "failed", note, ms };
    }
    if (overlay.isLocked(range)) {
      return { key, status: "loading", note: "", ms: null };
    }
    const note =
      ceiling.waitMs() > 0
        ? "Waits for the map server's pause"
        : "Waits its turn";
    return { key, status: "waiting", note, ms: null };
  };
  /** Whether a waiting tile is drawn bare where its parent had the map
   *  (a tile given up is drawn bare by design). */
  const bareUnderMapped = (
    tile: object,
    info: TileOverlayInfo,
    tileInfo: Map<object, TileOverlayInfo>,
  ): boolean => {
    const parent = (tile as { parent?: object | null }).parent;
    const parentInfo = parent ? tileInfo.get(parent) : undefined;
    return (
      parentInfo !== undefined && parentInfo.target !== null && !givenUp(info)
    );
  };
  /**
   * The relief tiles drawn in the last update near the camera, by their
   * map (all zero before `attach` or while the overlay is not ready).
   * Walks every drawn tile: for checks and measurements, not each frame.
   */
  const coverage = (): OsmCoverage => {
    const drawn = terrain?.tiles.visibleTiles;
    const tileInfo = (
      plugin as unknown as OverlayPluginInternals
    ).overlayInfo.get(overlay)?.tileInfo;
    if (!drawn || !tileInfo || !overlay.isReady) return NO_COVERAGE;
    const within = reach();
    const n = { unprocessed: 0, far: 0, withMap: 0, coarse: 0, waiting: 0 };
    const waitingInfos: TileOverlayInfo[] = [];
    let bareUnderMap = 0;
    for (const tile of drawn) {
      const info = tileInfo.get(tile);
      if (!info) continue;
      const kind = kindOf(info, within);
      n[kind]++;
      if (kind !== "waiting") continue;
      waitingInfos.push(info);
      if (bareUnderMapped(tile, info, tileInfo)) bareUnderMap++;
    }
    const failed = waitingInfos.filter((info) => info.failed).length;
    const givenUpCount = waitingInfos.filter(givenUp).length;
    return {
      near: n.withMap + n.coarse + n.waiting,
      withMap: n.withMap,
      coarse: n.coarse,
      waiting: n.waiting,
      failed,
      givenUp: givenUpCount,
      unprocessed: n.unprocessed,
      bareUnderMap,
    };
  };
  /** A new look for the hold (`mapReady`) every `reevaluateMs`, or at
   *  once past `lookSlackM` from the last look's camera. */
  const retakeLook = (nowMs: number) => {
    if (
      nowMs - lastLookAt < GLOBE_OSM.reevaluateMs &&
      camera.distanceTo(lookFrom) <= GLOBE_OSM.lookSlackM
    ) {
      return;
    }
    readyLook++;
    lastLookAt = nowMs;
    lookFrom.copy(camera);
  };
  return {
    credit,
    /** The limits in force (the caller's over `GLOBE_OSM`). */
    limits,
    overlay,
    plugin,
    uniforms,
    /** Registers the plugin on `t`'s tiles and patches the fade (once). */
    attach(t: OsmOverlayTerrain) {
      if (terrain) throw new Error("the OSM overlay is attached already");
      terrain = t;
      t.tiles.registerPlugin(plugin);
      const before = t.tiles.isTileReady;
      const asked = (tile: object): boolean => {
        readinessAsks++;
        return mapReady(tile);
      };
      t.tiles.isTileReady = before
        ? (tile) => asked(tile) && before(tile)
        : asked;
      t.tiles.forEachLoadedModel((scene) => fade(scene));
      t.tiles.addEventListener("load-model", ({ scene }) => fade(scene));
    },
    setEnabled(on: boolean) {
      enabled = on;
    },
    setFadeM(m: number) {
      if (!(Number.isFinite(m) && m > 0)) {
        throw new RangeError(
          `the fade distance must be finite and > 0, got ${m}`,
        );
      }
      uniforms.uOsmFadeM.value = m;
    },
    update(pose: OsmCameraPose) {
      const wasActive = active;
      active =
        enabled &&
        terrain !== null &&
        osmOverlayActive(
          { aboveGroundM: pose.aboveGroundM, speedMps: pose.speedMps },
          active,
          limits,
        );
      // Requests follow `active` at once; the drawn map fades over rampMs.
      uniforms.uOsmOn.value = rampOsmOn(
        uniforms.uOsmOn.value,
        active ? 1 : 0,
        lastNow === null ? 0 : pose.nowMs - lastNow,
      );
      count(pose, wasActive);
      lastNow = pose.nowMs;
      if (!terrain) return;
      // Every frame, on or off: `coverage` measures from it too.
      terrain.tiles.group.worldToLocal(camera.copy(pose.position));
      retakeLook(pose.nowMs);
      if (!active) return;
      if (pose.nowMs - lastLook < GLOBE_OSM.reevaluateMs) return;
      lastLook = pose.nowMs;
      const look = reevaluateGatedTiles(
        plugin as unknown as OverlayPluginInternals,
        overlay,
        { limit: GLOBE_OSM.reevaluateLimit },
      );
      reevaluateBacklog = look.left;
      if (look.left > 0) cappedLooks++;
      // After the re-evaluation, never before it: the reset marks its tiles
      // no longer failed and releases their regions now, but the library
      // drops a released region a microtask later and locks it anew only on
      // the next frame. A re-evaluation in between would lock the region
      // still cached with its rejected request (failing again at once) and
      // the reset's own lock would then hold it twice. The next look is
      // `reevaluateMs` away, after that frame.
      retryFailed(pose.nowMs, retryAsked);
    },
    /**
     * Asks for the failed tiles again now, through the timed retry's own
     * path (`retryFailed`): run at the next look, brought forward to the
     * next `update`; it waits while the request ceiling is full, and is
     * not counted towards giving a tile up. Refused (nothing asked) with
     * the map off or no tile failed.
     */
    retryNow(): OsmRetryAsk {
      const retry = failedRetries + 1;
      if (!active) return { tiles: 0, refused: "map-off", retry };
      const n = failedTiles(
        plugin as unknown as OverlayPluginInternals,
        overlay,
      ).length;
      if (n === 0) return { tiles: 0, refused: "none-failed", retry };
      retryAsked = true;
      lastLook = Number.NEGATIVE_INFINITY;
      return { tiles: n, refused: null, retry };
    },
    /** What became of the tiles the last retry asked for, or null before
     *  the first retry. */
    lastRetry(): OsmRetryOutcome | null {
      if (lastRetried === null) return null;
      return {
        retry: failedRetries,
        tiles: lastRetried.length,
        loaded: lastRetried.filter((i) => i.target !== null).length,
        failed: lastRetried.filter((i) => i.failed).length,
      };
    },
    /**
     * The drawn tiles near the camera that use the map (`coverage`'s
     * with-map and waiting ones), failed first, then loading, waiting and
     * loaded, at most `limit` of them. Walks the tiles: for an interface
     * showing them, not for each frame.
     */
    mapTiles(limit: number): OsmMapTile[] {
      const drawn = terrain?.tiles.visibleTiles;
      const tileInfo = (
        plugin as unknown as OverlayPluginInternals
      ).overlayInfo.get(overlay)?.tileInfo;
      if (!drawn || !tileInfo || !overlay.isReady) return [];
      const within = reach();
      const rows: OsmMapTile[] = [];
      for (const tile of drawn) {
        const info = tileInfo.get(tile);
        if (!info) continue;
        const kind = kindOf(info, within);
        if (kind === "withMap" || kind === "waiting") rows.push(tileRow(info));
      }
      const order = { failed: 0, loading: 1, waiting: 2, loaded: 3 };
      rows.sort((a, b) => order[a.status] - order[b.status]);
      return rows.slice(0, Math.max(0, Math.floor(limit)));
    },
    coverage,
    mapReady,
    /**
     * The map's loading state (`OsmMapLoad`): the near tiles waiting for
     * their map, the failed and given-up ones among them, and the request
     * ceiling's wait. Walks the tiles as `coverage` does: for an interface
     * reading a few times a second, not for each frame.
     */
    mapLoad(): OsmMapLoad {
      const c = coverage();
      return {
        waiting: c.waiting,
        failed: c.failed,
        givenUp: c.givenUp,
        ceilingWaitS: Math.ceil(ceiling.waitMs() / 100) / 10,
      };
    },
    stats() {
      return {
        enabled,
        active,
        /** The drawn map's strength (the ramped shader switch). */
        on: uniforms.uOsmOn.value,
        requests: ceiling.total(),
        requestsLastMinute: ceiling.inLastMinute(),
        unpatchedShaders: unpatched,
        switchedOff,
        unknownHeightFrames,
        ceilingFullMs,
        reevaluateBacklog,
        cappedLooks,
        /** How many times the failed tiles were asked for again. */
        failedRetries,
        /** The wait before the next retry of failed tiles (ms). */
        retryWaitMs: retryWaitMs(),
        /** How many times the relief's traversal asked a tile's readiness
         *  of the map: 0 on a renderer without the patched traversal. */
        readinessAsks,
        ...overlay.stats(),
      };
    },
  };
}

export type GlobeOsmOverlay = ReturnType<typeof createGlobeOsmOverlay>;
