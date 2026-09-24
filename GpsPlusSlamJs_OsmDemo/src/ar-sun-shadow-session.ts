/**
 * The AR sun shadow prototype's session (plan
 * 2026-09-23-2343-ar-sun-shadow-prototype-plan §10, M3c): what `ar-mode.ts`
 * runs once per XR frame under `?sunShadow=1`. It owns the real sun, whether
 * the shadow is on, the framework's shadow-casting light, the receiving
 * plane, the test pole and the frame times; the frame loop only hands it the
 * numbers it already has.
 *
 * @see ar-sun-shadow-session.ts.md
 */

import * as THREE from "three";

import { sunDirectionNue } from "gps-plus-slam-app-framework/ar/sun-check-geometry";
import { SCENE_NODE } from "gps-plus-slam-app-framework/ar/scene-node-names";
import { solarPosition } from "gps-plus-slam-app-framework/geo/solar-position";
import {
  createSunShadow,
  enableSunShadows,
  type SunShadow,
} from "gps-plus-slam-app-framework/visualization/sun-shadow";
import {
  SUN_SHADOW,
  shadowOpacity,
  sunShadowActive,
} from "gps-plus-slam-app-framework/visualization/sun-shadow-rig";

import {
  createFrameTimes,
  createShadowPlane,
  createShadowPole,
} from "./ar-sun-shadow.js";

/** A point in anchor ENU, metres (x east, y north). */
type EnuPoint = { readonly x: number; readonly y: number };

/** The view seams the session needs (BuildingView implements them). */
export interface ArShadowView {
  setArShadowCasting(on: boolean): void;
  addArShadowProps(...objects: THREE.Object3D[]): void;
  removeArShadowProps(...objects: THREE.Object3D[]): void;
  readonly arShadowCasterSignature: string;
}

export interface ArSunShadowDeps {
  /** The AR scene root (GPS-world NUE), where the named sun light lives. */
  readonly scene: THREE.Object3D;
  readonly renderer: THREE.WebGLRenderer;
  readonly view: ArShadowView;
  /** The place the sun is computed for (the zero reference). */
  readonly origin: { readonly lat: number; readonly lon: number };
  /** Anchor ENU → scene NUE offset (`sceneAnchorOffsetNue`). */
  readonly geometricOffset: { readonly north: number; readonly east: number };
  /**
   * The AR-datum-gated DEM height at an anchor-ENU point, or undefined (the
   * auto-elevation group's `terrainHeightM`). Sampled under the user for
   * the plane and under the pole for the pole, which differ on a slope.
   */
  readonly demAt: (enu: EnuPoint) => number | undefined;
  /** Wall clock (production `Date.now`: the XR clock stalls in suspend). */
  readonly nowMs?: () => number;
}

/** What the frame loop knows each frame. */
export interface ArSunShadowFrame {
  readonly dtS: number;
  /** The camera in anchor ENU once the alignment solved, else null. */
  readonly userEnu: { readonly x: number; readonly y: number } | null;
  /** The camera's horizontal forward in anchor ENU (for the pole), or null. */
  readonly forwardEnu: { readonly x: number; readonly y: number } | null;
  /** The content root's composed vertical offset (auto + trim + descent). */
  readonly composedM: number;
  /** Whether the floor estimate is engaged. */
  readonly floorEngaged: boolean;
}

/** Module-internal: consumers read it through `ArSunShadowStatus.state`. */
type ArSunShadowState =
  "on" | "waiting-for-position" | "waiting-for-floor" | "sun-low" | "failed";

export interface ArSunShadowStatus {
  readonly state: ArSunShadowState;
  readonly sunElevationDeg: number | undefined;
  /** Shadow maps rendered this session. */
  readonly renders: number;
  readonly frameTimes: ReturnType<
    ReturnType<typeof createFrameTimes>["summary"]
  >;
  /**
   * The time of the frame that drew the latest shadow map, in ms. The map
   * renders in the renderer's render AFTER the frame callbacks, so its cost
   * is the NEXT callback's `dt`. Absent until a map has been drawn.
   */
  readonly lastMapFrameMs?: number | undefined;
  /** Why the session failed (state `failed`), for the HUD. */
  readonly error?: string | undefined;
}

export interface ArSunShadowSession {
  frame(input: ArSunShadowFrame): ArSunShadowStatus;
  dispose(): void;
}

const SUN_REFRESH_MS = 1000;
/** Where the test pole stands: 3 m ahead of the user (north without a forward), in anchor ENU. */
function poleEnu(user: EnuPoint, forward: EnuPoint | null): EnuPoint {
  const len = forward ? Math.hypot(forward.x, forward.y) : 0;
  const [fx, fy] =
    forward && len > 0 ? [forward.x / len, forward.y / len] : [0, 1];
  return { x: user.x + fx * POLE_AHEAD_M, y: user.y + fy * POLE_AHEAD_M };
}
/** Where the test pole stands, ahead of the user when the floor engages. */
const POLE_AHEAD_M = 3;

interface SunNow {
  readonly dir: readonly [number, number, number];
  readonly elDeg: number;
}

/**
 * Why there is no shadow this frame, checked in the HUD's order (position,
 * floor, sun), or what the shadow needs when there is one.
 */
function readyToShade(
  input: ArSunShadowFrame,
  demAt: (enu: EnuPoint) => number | undefined,
  sun: SunNow | undefined,
):
  | Exclude<ArSunShadowState, "on" | "failed">
  | { readonly user: EnuPoint; readonly demM: number; readonly sun: SunNow } {
  const demM = input.userEnu === null ? undefined : demAt(input.userEnu);
  // A non-finite DEM is no position either: the rig would throw on it.
  if (input.userEnu === null || demM === undefined || !Number.isFinite(demM)) {
    return "waiting-for-position";
  }
  if (!input.floorEngaged) return "waiting-for-floor";
  if (sun === undefined || !sunShadowActive(sun.elDeg)) return "sun-low";
  return { user: input.userEnu, demM, sun };
}

/**
 * Starts the session: shadow maps on (BEFORE the first XR frame; the caller
 * guarantees that by calling this during the session's synchronous setup),
 * the props created and added hidden, casting on.
 *
 * @throws Error when the scene has no named sun light.
 */
export function startArSunShadow(deps: ArSunShadowDeps): ArSunShadowSession {
  const light = deps.scene.getObjectByName(SCENE_NODE.SUN_LIGHT);
  if (!(light instanceof THREE.DirectionalLight)) {
    throw new Error("the AR scene has no named sun light");
  }
  const now = deps.nowMs ?? (() => Date.now());
  enableSunShadows(deps.renderer);
  const plane = createShadowPlane(
    SUN_SHADOW.halfWidthM,
    shadowOpacity(SUN_SHADOW.transmittance),
  );
  const pole = createShadowPole();
  plane.visible = false;
  pole.visible = false;
  let polePlaced = false;
  deps.view.addArShadowProps(plane, pole);
  deps.view.setArShadowCasting(true);
  const frameTimes = createFrameTimes();

  let shadow: SunShadow | undefined;
  let renders = 0;
  let sun: SunNow | undefined;
  let sunAt = -Infinity;
  let disposed = false;
  // Set when this frame's update scheduled a map; read by the next frame.
  let mapPending = false;
  let lastMapFrameMs: number | undefined;
  // Set once a frame threw; the session stays off from then on.
  let error: string | undefined;

  const refreshSun = (): void => {
    const t = now();
    if (sun !== undefined && t - sunAt < SUN_REFRESH_MS && t >= sunAt) return;
    sunAt = t;
    const p = solarPosition(t, deps.origin.lat, deps.origin.lon, {
      refraction: true,
    });
    sun = {
      dir: sunDirectionNue(p.azimuthRad, p.elevationRad),
      elDeg: (p.elevationRad * 180) / Math.PI,
    };
  };

  const off = (): void => {
    if (shadow) {
      renders += shadow.renders;
      shadow.dispose();
      shadow = undefined;
    }
    plane.visible = false;
    pole.visible = false;
  };

  // Every frame's time, and the map frame's own: the frame after the one
  // that scheduled a map (see `lastMapFrameMs`).
  const timeFrame = (dtS: number): void => {
    frameTimes.push(dtS * 1000);
    if (mapPending && Number.isFinite(dtS) && dtS > 0) {
      lastMapFrameMs = dtS * 1000;
    }
    mapPending = false;
  };

  const status = (state: ArSunShadowState): ArSunShadowStatus => ({
    state,
    sunElevationDeg: sun?.elDeg,
    renders: renders + (shadow?.renders ?? 0),
    frameTimes: frameTimes.summary(),
    lastMapFrameMs,
  });

  const shade = (input: ArSunShadowFrame): ArSunShadowStatus => {
    refreshSun();
    const ready = readyToShade(input, deps.demAt, sun);
    if (typeof ready === "string") {
      off();
      return status(ready);
    }
    const { user, demM } = ready;
    // The props live in the content root's DEMO frame (x east, y up,
    // -z north), each on the DEM under itself: the root adds the composed
    // offset.
    plane.position.set(user.x, demM, -user.y);
    plane.visible = true;
    if (!polePlaced) {
      const at = poleEnu(user, input.forwardEnu);
      const ground = deps.demAt(at);
      pole.position.set(
        at.x,
        ground !== undefined && Number.isFinite(ground) ? ground : demM,
        -at.y,
      );
      polePlaced = true;
    }
    pole.visible = true;
    // A NEW SunShadow starts the light casting, and three then recompiles
    // every lit material (programs are keyed on a casting light, not on
    // `shadowMap.enabled`), so the frame after its first map times the
    // recompile, not the map: it is not reported (M3 review M2).
    const switchedOn = shadow === undefined;
    shadow ??= createSunShadow({ light });
    const rendersBefore = shadow.renders;
    // The rig works in the scene root's NUE frame.
    shadow.update({
      sunDir: ready.sun.dir,
      centre: [
        user.y + deps.geometricOffset.north,
        demM + input.composedM,
        user.x + deps.geometricOffset.east,
      ],
      halfWidthM: SUN_SHADOW.halfWidthM,
      casterGeneration: deps.view.arShadowCasterSignature,
      casterOffsetM: input.composedM,
    });
    mapPending = !switchedOn && shadow.renders > rendersBefore;
    return status("on");
  };

  return {
    frame(input) {
      if (disposed) return status("waiting-for-position");
      if (error !== undefined) return { ...status("failed"), error };
      timeFrame(input.dtS);
      // A PROTOTYPE NEVER COSTS THE SESSION (M3 review M1): a throw here
      // would abort the rest of the AR frame callback every frame (the HUD
      // with it) and leave the light casting. It fails once instead, gives
      // the light back, and says why for the rest of the session.
      try {
        return shade(input);
      } catch (thrown) {
        off();
        error = thrown instanceof Error ? thrown.message : String(thrown);
        return { ...status("failed"), error };
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      off();
      deps.view.setArShadowCasting(false);
      deps.view.removeArShadowProps(plane, pole);
      plane.geometry.dispose();
      (plane.material as THREE.Material).dispose();
      pole.geometry.dispose();
      (pole.material as THREE.Material).dispose();
    },
  };
}

/** `tryStartArSunShadow`'s inputs: what the AR session may or may not have. */
export interface ArSunShadowStartInputs extends Omit<
  ArSunShadowDeps,
  "renderer" | "origin" | "demAt"
> {
  readonly renderer: THREE.WebGLRenderer | null;
  readonly origin: ArSunShadowDeps["origin"] | null;
  /** Undefined while the auto-elevation group is off (`?autoElevation=off`). */
  readonly demAt: ArSunShadowDeps["demAt"] | undefined;
}

/**
 * Starts the session if it can, and otherwise says why, for the HUD. A
 * PROTOTYPE NEVER COSTS THE SESSION: nothing here throws, and a refusal
 * touches nothing (no shadow maps, no props, no casting).
 *
 * The auto-elevation group is required: without the floor estimate the
 * shadow could never come on, and "waiting for position" for good would
 * send a field tester after GPS or alignment instead (M3 review L1).
 */
export function tryStartArSunShadow(
  inputs: ArSunShadowStartInputs,
):
  | { readonly session: ArSunShadowSession; readonly unavailable?: undefined }
  | { readonly session?: undefined; readonly unavailable: string } {
  const { renderer, origin, demAt } = inputs;
  if (renderer === null) return { unavailable: "no renderer" };
  if (origin === null) return { unavailable: "no position fix" };
  if (demAt === undefined) return { unavailable: "auto elevation is off" };
  try {
    return {
      session: startArSunShadow({ ...inputs, renderer, origin, demAt }),
    };
  } catch (thrown) {
    return {
      unavailable: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }
}

/** The optional parts of the HUD line, each empty when unmeasured. */
function hudSuffixes(status: ArSunShadowStatus): {
  sun: string;
  frames: string;
  mapFrame: string;
} {
  const t = status.frameTimes;
  return {
    sun:
      status.sunElevationDeg === undefined
        ? ""
        : ` · sun ${status.sunElevationDeg.toFixed(0)}°`,
    frames:
      t === null
        ? ""
        : ` · frame p50 ${t.p50.toFixed(0)} p95 ${t.p95.toFixed(0)} max ${t.max.toFixed(0)} ms`,
    mapFrame:
      status.lastMapFrameMs === undefined
        ? ""
        : ` · map frame ${status.lastMapFrameMs.toFixed(0)} ms`,
  };
}

/**
 * The HUD line for a status: why there is no shadow, or the maps rendered
 * and the frame times (p50 / p95 / max, the numbers the prototype exists to
 * measure; plan §7 item 7).
 */
export function describeArSunShadow(status: ArSunShadowStatus): string {
  const { sun, frames, mapFrame } = hudSuffixes(status);
  switch (status.state) {
    case "on":
      return `shadow on · ${status.renders} map${status.renders === 1 ? "" : "s"}${sun}${frames}${mapFrame}`;
    case "waiting-for-position":
      return `shadow: waiting for position${frames}`;
    case "waiting-for-floor":
      return `shadow: waiting for floor${frames}`;
    case "sun-low":
      return `shadow: sun below ${SUN_SHADOW.minSunElevationDeg}°${sun}${frames}`;
    case "failed":
      return `shadow: unavailable (${status.error ?? "failed"})`;
  }
}
