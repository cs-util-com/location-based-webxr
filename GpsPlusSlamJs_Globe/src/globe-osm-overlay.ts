/**
 * OpenStreetMap raster tiles on the relief, near the camera only (tour
 * editor plan 2026-10-17-1816 §13, G1 step 6; G0 spikes Q5): a second
 * overlay through the library's `ImageOverlayPlugin`, faded out with the
 * distance (300 m), asked for only at z15 and finer for tiles within that
 * distance of the camera (re-evaluated as it moves), at most about 150
 * requests a minute, and off above 200 m or faster than 50 m/s.
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
  /** How often tiles gated at load are looked at again (ms). */
  reevaluateMs: 500,
  /** At most this many tiles started per look. */
  reevaluateLimit: 8,
  /** The overlay texture per relief tile (px, the plugin's default). */
  resolution: 256,
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

/** Whether the camera may ask for tiles: low and slow, both known. */
export function osmOverlayActive(
  { aboveGroundM, speedMps }: { aboveGroundM: number; speedMps: number },
  limits: { maxAboveGroundM: number; maxSpeedMps: number } = GLOBE_OSM,
): boolean {
  return (
    typeof aboveGroundM === "number" &&
    typeof speedMps === "number" &&
    aboveGroundM <= limits.maxAboveGroundM &&
    speedMps <= limits.maxSpeedMps
  );
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
  lockTexture(range: number[], level?: number): Promise<unknown>;
  releaseTexture(range: number[], level?: number): void;
  hasContent(range: number[], level?: number): boolean;
  fetch(url: string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

const base = XYZTilesOverlay.prototype as unknown as OverlayInternals;

const sleepFor = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/**
 * The library's XYZ overlay behind a gate: the plugin's lock of a region
 * (which fetches) reaches the library only where `gate(range, level)`
 * allows it, a region counts as content only while locked, a release
 * unlocks only what was locked, and every fetch waits for `ceiling`.
 * RangeError for a url without `{z}/{x}/{y}`; TypeError without a gate.
 */
export class GatedOsmOverlay extends XYZTilesOverlay {
  private readonly gate: (range: number[], level: number) => boolean;
  private readonly ceiling: RequestCeiling;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly locked = new Map<string, number>();
  private gatedLocks = 0;
  private locks = 0;
  private finestLevel: number | null = null;

  constructor({
    url,
    maxZoom,
    gate,
    ceiling,
    sleep = sleepFor,
  }: {
    url: string;
    maxZoom: number;
    gate: (range: number[], level: number) => boolean;
    ceiling: RequestCeiling;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  }) {
    if (!isTileTemplate(url)) {
      throw new RangeError(
        `the OSM overlay needs a {z}/{x}/{y} template, got ${String(url)}`,
      );
    }
    if (typeof gate !== "function") {
      throw new TypeError("the OSM overlay needs its gate");
    }
    super({ url, levels: maxZoom + 1 });
    this.gate = gate;
    this.ceiling = ceiling;
    this.sleep = sleep;
  }

  /** A region's key: the plugin locks and releases one tile's region by the same range. */
  private key(range: number[]): string {
    return range.join("_");
  }

  private levelOf(range: number[], level?: number): number {
    return level ?? base.calculateLevel.call(this, range);
  }

  /** Whether a region's texture is locked in the library. */
  isLocked(range: number[]): boolean {
    return (this.locked.get(this.key(range)) ?? 0) > 0;
  }

  /** Whether the gate would let a region through now. */
  wanted(range: number[], level?: number): boolean {
    return this.gate(range, this.levelOf(range, level));
  }

  hasContent(range: number[], level?: number): boolean {
    const l = this.levelOf(range, level);
    return this.isLocked(range) && base.hasContent.call(this, range, l);
  }

  lockTexture(range: number[], level?: number): Promise<unknown> {
    const l = this.levelOf(range, level);
    this.finestLevel = Math.max(this.finestLevel ?? l, l);
    if (!this.gate(range, l)) {
      this.gatedLocks++;
      return Promise.resolve(null);
    }
    const k = this.key(range);
    this.locked.set(k, (this.locked.get(k) ?? 0) + 1);
    this.locks++;
    return base.lockTexture.call(this, range, l);
  }

  releaseTexture(range: number[], level?: number): void {
    const l = this.levelOf(range, level);
    const k = this.key(range);
    const n = this.locked.get(k) ?? 0;
    if (n === 0) return;
    if (n === 1) this.locked.delete(k);
    else this.locked.set(k, n - 1);
    base.releaseTexture.call(this, range, l);
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
   * Locks the gate let through and turned away, regions locked now, and the
   * finest level a lock asked for (null before the first): under
   * `GLOBE_OSM.minZoom`, the relief tree is too coarse for the map.
   */
  stats(): {
    locks: number;
    gatedLocks: number;
    lockedRegions: number;
    finestLevel: number | null;
  } {
    return {
      locks: this.locks,
      gatedLocks: this.gatedLocks,
      lockedRegions: this.locked.size,
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
 * call. Returns how many were started.
 */
export function reevaluateGatedTiles(
  plugin: OverlayPluginInternals,
  overlay: GatedOsmOverlay,
  { limit }: { limit: number },
): number {
  const tileInfo = plugin.overlayInfo.get(overlay)?.tileInfo;
  if (!tileInfo) return 0;
  let started = 0;
  for (const [tile, info] of tileInfo) {
    if (started >= limit) break;
    if (!retryable(info, overlay)) continue;
    const range = info.range!;
    started++;
    void overlay.lockTexture(range).catch(() => {});
    plugin
      ._fetchTileOverlayTexture(tile, overlay, info)
      .then(() => plugin._updateLayers(tile))
      .catch(() => {});
  }
  return started;
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
  };
  readonly plugin: {
    sampleCartographicElevation(lat: number, lon: number): number | null;
  };
}

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
 * the tiles gated at load. RangeError from `osmCredit` or the overlay for
 * a bad attribution or url.
 */
export function createGlobeOsmOverlay({
  url,
  attribution,
  maxZoom,
  renderer,
  fadeM = GLOBE_OSM.fadeM,
}: {
  url: string;
  attribution: string;
  maxZoom: number;
  renderer: THREE.WebGLRenderer;
  fadeM?: number;
}) {
  if (!(Number.isFinite(fadeM) && fadeM > 0)) {
    throw new RangeError(
      `the fade distance must be finite and > 0, got ${fadeM}`,
    );
  }
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
  const gate = (range: number[], level: number): boolean => {
    if (!terrain || !active || level < GLOBE_OSM.minZoom) return false;
    if (ceiling.waitMs() > 0) return false;
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
        withinM: uniforms.uOsmFadeM.value,
      });
    } catch {
      // A range the projection cannot place is never asked for.
      return false;
    }
  };
  const overlay = new GatedOsmOverlay({ url, maxZoom, gate, ceiling });
  const plugin = new ImageOverlayPlugin({
    renderer,
    overlays: [overlay],
    enableTileSplitting: false,
    resolution: GLOBE_OSM.resolution,
  });
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
  return {
    credit,
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
      active =
        enabled &&
        terrain !== null &&
        osmOverlayActive({
          aboveGroundM: pose.aboveGroundM,
          speedMps: pose.speedMps,
        });
      uniforms.uOsmOn.value = active ? 1 : 0;
      if (!terrain || !active) return;
      terrain.tiles.group.worldToLocal(camera.copy(pose.position));
      if (pose.nowMs - lastLook < GLOBE_OSM.reevaluateMs) return;
      lastLook = pose.nowMs;
      reevaluateGatedTiles(
        plugin as unknown as OverlayPluginInternals,
        overlay,
        { limit: GLOBE_OSM.reevaluateLimit },
      );
    },
    stats() {
      return {
        enabled,
        active,
        requests: ceiling.total(),
        requestsLastMinute: ceiling.inLastMinute(),
        unpatchedShaders: unpatched,
        ...overlay.stats(),
      };
    },
  };
}

export type GlobeOsmOverlay = ReturnType<typeof createGlobeOsmOverlay>;
