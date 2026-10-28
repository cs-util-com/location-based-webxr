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
  /** At most this many tiles started per look. */
  reevaluateLimit: 8,
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

/** The fade's uniforms (shared by every relief material). */
export interface OsmFadeUniforms {
  uOsmFadeM: { value: number };
  uOsmFadeStart: { value: number };
  uOsmOn: { value: number };
}

/** The library's overlay blend (0.5.3, `wrapOverlaysMaterial.js`). */
const LAYER_BLEND = "tint.rgba *= layerInfo[ i ].opacity * wOpacity;";

/**
 * Patches the library's overlay layer blend in `shader` to fade every
 * layer out between `uOsmFadeStart x uOsmFadeM` and `uOsmFadeM` from the
 * camera, and to drop it with `uOsmOn` 0; adds the uniforms. False, the
 * shader untouched, where the blend line is missing (a library change).
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
      "#include <common>\nuniform float uOsmFadeM;\nuniform float uOsmFadeStart;\nuniform float uOsmOn;",
    )
    .replaceAll(
      LAYER_BLEND,
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
  private readonly locked = new Map<string, number>();
  private gatedLocks = 0;
  private locks = 0;
  private releases = 0;
  private keptHits = 0;
  /** Released regions still locked in the library, oldest first. */
  private readonly kept = new Map<string, { range: number[]; level: number }>();
  private keep: number;
  private finestLevel: number | null = null;

  constructor({
    url,
    maxZoom,
    gate,
    ceiling,
    sleep = sleepFor,
    keep = GLOBE_OSM.keepRegions,
  }: {
    url: string;
    maxZoom: number;
    gate: (range: number[], level: number) => boolean;
    ceiling: RequestCeiling;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Released textures kept in memory (regions). */
    keep?: number;
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
    super({ url, levels: maxZoom + 1 });
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
    return base.lockTexture.call(this, range, l);
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

  async fetch(
    url: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    for (let wait = this.ceiling.waitMs(); wait > 0;) {
      await this.sleep(wait, options.signal);
      wait = this.ceiling.waitMs();
    }
    this.ceiling.take();
    return base.fetch.call(this, url, options);
  }

  /**
   * Locks the gate let through and turned away, regions locked now,
   * textures given back to the library (it drops them, so a re-visit
   * fetches again), the keep, the regions kept now and the locks served
   * from it, and the finest level a lock asked for (null before the
   * first): under the coarsest zoom in force, the relief tree is too
   * coarse for the map.
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
    void overlay.lockTexture(range).catch(() => {});
    plugin
      ._fetchTileOverlayTexture(tile, overlay, info)
      .then(() => plugin._updateLayers(tile))
      .catch(() => {});
  }
  return { started, left };
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
  };
  readonly plugin: {
    sampleCartographicElevation(lat: number, lon: number): number | null;
  };
}

/** The drawn relief tiles near the camera, by their map (`coverage`). */
export interface OsmCoverage {
  /** Drawn tiles that come within the fade's start of the camera, where
   *  the map is drawn at full strength. */
  readonly near: number;
  /** Of those, the ones with their map. */
  readonly withMap: number;
  /** Too coarse for it: the level picked is under the coarsest zoom. */
  readonly coarse: number;
  /** Waiting for it: gated, throttled, loading or failed. */
  readonly waiting: number;
  /** Of those, the ones whose request failed: never asked for again, so
   *  a check that waits for the map stops waiting on these. */
  readonly failed: number;
  /** Drawn tiles the plugin has not placed yet (no range). */
  readonly unprocessed: number;
}

const NO_COVERAGE: OsmCoverage = Object.freeze({
  near: 0,
  withMap: 0,
  coarse: 0,
  waiting: 0,
  failed: 0,
  unprocessed: 0,
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
 * for the band and the coarsest zoom; `keep` is the overlay's keep.
 * RangeError from `osmCredit`, `osmGateLimits` or the overlay for a bad
 * attribution, limit, url or keep.
 */
export function createGlobeOsmOverlay({
  url,
  attribution,
  maxZoom,
  renderer,
  fadeM = GLOBE_OSM.fadeM,
  limits: callerLimits = {},
  keep = GLOBE_OSM.keepRegions,
}: {
  url: string;
  attribution: string;
  maxZoom: number;
  renderer: THREE.WebGLRenderer;
  fadeM?: number;
  limits?: Partial<OsmGateLimits>;
  /** Released map regions kept in memory (`GatedOsmOverlay`'s keep). */
  keep?: number;
}) {
  if (!(Number.isFinite(fadeM) && fadeM > 0)) {
    throw new RangeError(
      `the fade distance must be finite and > 0, got ${fadeM}`,
    );
  }
  const limits = osmGateLimits(callerLimits, maxZoom);
  const credit = osmCredit(attribution);
  const uniforms: OsmFadeUniforms = {
    uOsmFadeM: { value: fadeM },
    uOsmFadeStart: { value: GLOBE_OSM.fadeStartShare },
    uOsmOn: { value: 0 },
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
    return rangeNear(range, uniforms.uOsmFadeM.value);
  };
  const overlay = new GatedOsmOverlay({ url, maxZoom, gate, ceiling, keep });
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
  /** A drawn tile's place in `coverage`. */
  const kindOf = (
    info: TileOverlayInfo,
    reach: number,
  ): "unprocessed" | "far" | "withMap" | "coarse" | "waiting" => {
    if (info.range === null) return "unprocessed";
    if (!rangeNear(info.range, reach)) return "far";
    if (info.target !== null) return "withMap";
    return base.calculateLevel.call(overlay, info.range) < limits.minZoom
      ? "coarse"
      : "waiting";
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
    },
    /**
     * The relief tiles drawn in the last update near the camera, by their
     * map (all zero before `attach` or while the overlay is not ready).
     * Walks every drawn tile: for checks and measurements, not each frame.
     */
    coverage(): OsmCoverage {
      const drawn = terrain?.tiles.visibleTiles;
      const tileInfo = (
        plugin as unknown as OverlayPluginInternals
      ).overlayInfo.get(overlay)?.tileInfo;
      if (!drawn || !tileInfo || !overlay.isReady) return NO_COVERAGE;
      const reach = uniforms.uOsmFadeStart.value * uniforms.uOsmFadeM.value;
      const n = { unprocessed: 0, far: 0, withMap: 0, coarse: 0, waiting: 0 };
      let failed = 0;
      for (const tile of drawn) {
        const info = tileInfo.get(tile);
        if (!info) continue;
        const kind = kindOf(info, reach);
        n[kind]++;
        if (kind === "waiting" && info.failed) failed++;
      }
      return {
        near: n.withMap + n.coarse + n.waiting,
        withMap: n.withMap,
        coarse: n.coarse,
        waiting: n.waiting,
        failed,
        unprocessed: n.unprocessed,
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
        ...overlay.stats(),
      };
    },
  };
}

export type GlobeOsmOverlay = ReturnType<typeof createGlobeOsmOverlay>;
