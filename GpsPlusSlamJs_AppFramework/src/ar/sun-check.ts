/**
 * The AR sun check's controller (plan 2026-09-24-0100, M2, §3.4): keeps the
 * sun marker on the real (apparent) sun, and turns "aim the centre at the
 * sun, press Mark" into a measured heading error.
 *
 * SAMPLED WHERE IT IS DRAWN. Each sample is taken in the marker's
 * `onBeforeRender`, with the camera three renders it with: the ray the user
 * SEES and the alignment-free ray come from the same frame by construction,
 * whatever order the app's frame callbacks run in (the recorder's sampler
 * ran before its alignment lerper; plan review finding 3). Nothing reads a
 * pose from an earlier frame.
 *
 * THE MARK. The window is the `holdMs` BEFORE the press (the tap jolts the
 * phone; review finding 5); when that second is missing (the check was just
 * switched on), it is the `holdMs` starting `joltMs` AFTER the press. The
 * result is the median heading and elevation error; the spread is measured
 * on the ALIGNMENT-FREE ray, so an alignment update mid-window is flagged
 * ("target-changed"), not refused as hand shake (review finding 4). A Mark
 * always resolves, as a sighting or a refusal: never hangs.
 *
 * THE CLOCK is injected (`nowEpochMs`; production passes `Date.now`, never
 * the XR clock, which stalls while the phone sleeps; review finding 1), and
 * each sighting logs its offset from the monotonic clock.
 *
 * @see sun-check.ts.md
 */
import { nueToWebXR } from 'gps-plus-slam-js';
import * as THREE from 'three';

import {
  solarPosition,
  type RefractionConditions,
} from '../geo/solar-position.js';
import { registerFrameUpdate } from './frame-loop.js';
import { registerSessionDisposer } from './session-disposers.js';
import {
  alignmentYawDeg,
  principalRayCamera,
  rotateByMat4,
  sightingErrorDeg,
  sunDirectionNue,
  type Vec3,
} from './sun-check-geometry.js';
import { createSunMarker, type SunMarker } from './sun-marker.js';

/** The controller's rules, in one place. */
export const SUN_CHECK = {
  /** The Mark window. */
  holdMs: 1000,
  /** Past the tap's jolt, when the window has to start after the press. */
  joltMs: 300,
  /** A Mark with fewer frames is refused. */
  minFrames: 10,
  /**
   * Hand shake above this refuses the Mark: the 80th-percentile angular
   * distance of the alignment-free ray from its median direction (four
   * frames in five within it). Not the median distance: a two-cluster shake
   * puts the median direction inside the larger cluster and reads 0.
   */
  maxSpreadDeg: 0.3,
  spreadPercentile: 0.8,
  /** How long a Mark waits for frames past its window before giving up. */
  giveUpMs: 1500,
  /** The marker hides below this apparent elevation. */
  hideBelowDeg: -1,
  /** A Mark is refused below this apparent elevation. */
  minMarkElevationDeg: 0,
  /** Above this, heading resolution degrades (plan §5.1): a warning. */
  highSunDeg: 35,
  /** How often the sun is recomputed. */
  sunUpdateMs: 250,
  /** Samples older than this are dropped. */
  keepMs: 3000,
} as const;

/** Why the marker is hidden (the HUD says so). */
export type SunHiddenReason = 'no-position' | 'no-alignment' | 'sun-down';

/** Why a Mark was refused. */
export type SunMarkRefusal =
  SunHiddenReason | 'busy' | 'moved' | 'no-frames' | 'disposed';

/** What a Mark warns about. */
export type SunMarkWarning = 'high-sun' | 'target-changed';

/** One accepted Mark: the raw record the recorder logs (plan §6.3), flat. */
export interface SunSighting {
  readonly schema: 1;
  /** Epoch ms of the middle frame, and the window's start. */
  readonly atMs: number;
  readonly windowStartMs: number;
  readonly frames: number;
  /** The alignment-free ray's spread (see `SUN_CHECK.maxSpreadDeg`), degrees. */
  readonly spreadDeg: number;
  /** The median ray in the WebXR reference space (alignment-free), unit. */
  readonly rayXrX: number;
  readonly rayXrY: number;
  readonly rayXrZ: number;
  /** The middle frame's camera orientation in the AR-odometry NUE frame. */
  readonly viewQx: number;
  readonly viewQy: number;
  readonly viewQz: number;
  readonly viewQw: number;
  /** The four projection entries `intrinsicsFromProjection` reads. */
  readonly projP0: number;
  readonly projP5: number;
  readonly projP8: number;
  readonly projP9: number;
  /** The alignment: the drawn yaw (median, min, max) and the app's target. */
  readonly displayedYawDeg: number;
  readonly yawMinDeg: number;
  readonly yawMaxDeg: number;
  readonly targetYawDeg: number | null;
  readonly targetChanged: boolean;
  /** The place and the sun it was computed for. */
  readonly lat: number;
  readonly lng: number;
  readonly sunAzDeg: number;
  readonly sunElApparentDeg: number;
  readonly refractionDeg: number;
  /** `nowEpochMs − monotonicEpochMs` at the Mark. */
  readonly clockOffsetMs: number;
  /** Derived, for convenience: the median errors (plan §3.4 sign). */
  readonly headingErrDeg: number;
  readonly elevationErrDeg: number;
  readonly separationDeg: number;
}

export type SunMarkResult =
  | {
      readonly ok: true;
      readonly sighting: SunSighting;
      readonly warnings: readonly SunMarkWarning[];
    }
  | { readonly ok: false; readonly reason: SunMarkRefusal };

/** The marker's state, for a HUD line. */
export interface SunCheckStatus {
  readonly visible: boolean;
  readonly hiddenBecause?: SunHiddenReason;
  readonly sunAzDeg?: number;
  readonly sunElDeg?: number;
}

export interface SunCheckDeps {
  /** The GPS-world NUE scene root; the marker is added here. */
  readonly scene: THREE.Object3D;
  /** The group that carries the alignment (an ancestor of the camera). */
  readonly arWorldGroup: THREE.Object3D;
  /** The place the sun is computed for (plan §3.1: the zero reference). */
  readonly getZeroReference: () => {
    readonly lat: number;
    readonly lng: number;
  } | null;
  /** The app's current target alignment yaw, if it knows one. */
  readonly getTargetYawDeg?: () => number | null;
  /** Wall-clock epoch ms (production: `Date.now`). */
  readonly nowEpochMs: () => number;
  /** The monotonic clock as epoch ms (default `timeOrigin + now()`). */
  readonly monotonicEpochMs?: () => number;
  readonly refraction?: RefractionConditions;
}

export interface SunCheck {
  readonly marker: SunMarker;
  status(): SunCheckStatus;
  /** Measure; always resolves. */
  mark(): Promise<SunMarkResult>;
  dispose(): void;
}

interface Sample {
  readonly t: number;
  readonly rGps: Vec3;
  readonly rOdo: Vec3;
  readonly sun: Vec3;
  readonly yaw: number;
  readonly target: number | null;
  readonly viewQ: THREE.Quaternion;
  readonly projection: readonly number[];
}

interface SunNow {
  readonly azDeg: number;
  readonly elDeg: number;
  readonly refractionDeg: number;
  readonly dir: Vec3;
  readonly place: { readonly lat: number; readonly lng: number };
}

const DEG = Math.PI / 180;
const IDENTITY = new THREE.Matrix4();

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** The value below which a fraction `p` of `values` lies (nearest rank). */
const percentile = (values: readonly number[], p: number): number => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

const medianDirection = (rays: readonly Vec3[]): Vec3 =>
  normalize([
    median(rays.map((r) => r[0])),
    median(rays.map((r) => r[1])),
    median(rays.map((r) => r[2])),
  ]);

const separationDeg = (a: Vec3, b: Vec3) =>
  Math.acos(
    Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  ) / DEG;

/**
 * Starts the sun check: adds the marker to `deps.scene`, keeps it on the
 * sun, samples every drawn frame. Disposed with the AR session.
 */
export function startSunCheck(deps: SunCheckDeps): SunCheck {
  const marker = createSunMarker();
  deps.scene.add(marker.object);
  const monotonic =
    deps.monotonicEpochMs ?? (() => performance.timeOrigin + performance.now());

  let samples: Sample[] = [];
  let sun: SunNow | null = null;
  let hiddenBecause: SunHiddenReason | undefined = 'no-position';
  let lastSunMs = Number.NEGATIVE_INFINITY;
  let pending: {
    readonly start: number;
    readonly end: number;
    readonly resolve: (r: SunMarkResult) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let disposed = false;

  const aligned = () => !deps.arWorldGroup.matrix.equals(IDENTITY);

  const computeSun = (): SunNow | null => {
    const place = deps.getZeroReference();
    if (place === null) return null;
    const now = deps.nowEpochMs();
    const apparent = solarPosition(now, place.lat, place.lng, {
      refraction: deps.refraction ?? true,
    });
    const geometric = solarPosition(now, place.lat, place.lng);
    return {
      azDeg: apparent.azimuthRad / DEG,
      elDeg: apparent.elevationRad / DEG,
      refractionDeg: (apparent.elevationRad - geometric.elevationRad) / DEG,
      dir: sunDirectionNue(apparent.azimuthRad, apparent.elevationRad),
      place,
    };
  };

  /** Recompute the sun and the marker's visibility; returns the reason it is hidden. */
  const refresh = (): SunHiddenReason | undefined => {
    sun = computeSun();
    lastSunMs = deps.nowEpochMs();
    if (sun === null) hiddenBecause = 'no-position';
    else if (!aligned()) hiddenBecause = 'no-alignment';
    else if (sun.elDeg < SUN_CHECK.hideBelowDeg) hiddenBecause = 'sun-down';
    else hiddenBecause = undefined;
    if (sun !== null) marker.setSun(sun.azDeg, sun.elDeg);
    marker.setVisible(hiddenBecause === undefined);
    return hiddenBecause;
  };

  const unregisterFrame = registerFrameUpdate(() => {
    if (deps.nowEpochMs() - lastSunMs >= SUN_CHECK.sunUpdateMs) refresh();
  });

  const inverse = new THREE.Matrix4();
  const odoCamera = new THREE.Matrix4();
  marker.object.onBeforeRender = (_renderer, _scene, camera) => {
    if (disposed || sun === null) return;
    const world = deps.arWorldGroup.matrixWorld;
    let yaw: number;
    try {
      yaw = alignmentYawDeg(world.elements);
    } catch {
      return; // a degenerate alignment: no sample
    }
    const projection = [...camera.projectionMatrix.elements];
    let ray: Vec3;
    try {
      ray = principalRayCamera(projection);
    } catch {
      return; // not a perspective view
    }
    const rGps = normalize(rotateByMat4(camera.matrixWorld.elements, ray));
    inverse.copy(world).invert();
    const rOdo = normalize(rotateByMat4(inverse.elements, rGps));
    odoCamera.multiplyMatrices(inverse, camera.matrixWorld);
    const viewQ = new THREE.Quaternion().setFromRotationMatrix(odoCamera);
    const t = deps.nowEpochMs();
    const at = solarPosition(t, sun.place.lat, sun.place.lng, {
      refraction: deps.refraction ?? true,
    });
    samples.push({
      t,
      rGps,
      rOdo,
      sun: sunDirectionNue(at.azimuthRad, at.elevationRad),
      yaw,
      target: deps.getTargetYawDeg?.() ?? null,
      viewQ,
      projection,
    });
    samples = samples.filter((s) => t - s.t <= SUN_CHECK.keepMs);
    if (pending !== null && t >= pending.end)
      finish(pending.start, pending.end);
  };

  const aggregate = (start: number, end: number): SunMarkResult => {
    const window = samples.filter((s) => s.t >= start && s.t <= end);
    if (window.length < SUN_CHECK.minFrames || sun === null) {
      return { ok: false, reason: 'no-frames' };
    }
    const odoMedian = medianDirection(window.map((s) => s.rOdo));
    const spreadDeg = percentile(
      window.map((s) => separationDeg(s.rOdo, odoMedian)),
      SUN_CHECK.spreadPercentile
    );
    if (spreadDeg > SUN_CHECK.maxSpreadDeg)
      return { ok: false, reason: 'moved' };
    const errors = window.map((s) => sightingErrorDeg(s.rGps, s.sun));
    const middle = window[window.length >> 1]!;
    const yaws = window.map((s) => s.yaw);
    const targets = window.map((s) => s.target);
    const targetChanged =
      targets.some(
        (x) => x === null || Math.abs(x - (targets[0] ?? 0)) > 1e-9
      ) && targets.some((x) => x !== null);
    const rayXr = nueToWebXR([...odoMedian]);
    const place = sun.place;
    const sighting: SunSighting = {
      schema: 1,
      atMs: middle.t,
      windowStartMs: window[0]!.t,
      frames: window.length,
      spreadDeg,
      rayXrX: rayXr[0],
      rayXrY: rayXr[1],
      rayXrZ: rayXr[2],
      viewQx: middle.viewQ.x,
      viewQy: middle.viewQ.y,
      viewQz: middle.viewQ.z,
      viewQw: middle.viewQ.w,
      projP0: middle.projection[0]!,
      projP5: middle.projection[5]!,
      projP8: middle.projection[8]!,
      projP9: middle.projection[9]!,
      displayedYawDeg: median(yaws),
      yawMinDeg: Math.min(...yaws),
      yawMaxDeg: Math.max(...yaws),
      targetYawDeg: middle.target,
      targetChanged,
      lat: place.lat,
      lng: place.lng,
      sunAzDeg: sun.azDeg,
      sunElApparentDeg: sun.elDeg,
      refractionDeg: sun.refractionDeg,
      clockOffsetMs: deps.nowEpochMs() - monotonic(),
      headingErrDeg: median(errors.map((e) => e.headingDeg)),
      elevationErrDeg: median(errors.map((e) => e.elevationDeg)),
      separationDeg: median(errors.map((e) => e.separationDeg)),
    };
    const warnings: SunMarkWarning[] = [];
    if (sun.elDeg > SUN_CHECK.highSunDeg) warnings.push('high-sun');
    if (targetChanged) warnings.push('target-changed');
    return { ok: true, sighting, warnings };
  };

  const settle = (result: SunMarkResult) => {
    if (pending === null) return;
    const { resolve, timer } = pending;
    clearTimeout(timer);
    pending = null;
    resolve(result);
  };

  const finish = (start: number, end: number) => settle(aggregate(start, end));

  const check: SunCheck = {
    marker,
    status: () => ({
      visible: marker.object.visible,
      ...(hiddenBecause !== undefined ? { hiddenBecause } : {}),
      ...(sun !== null ? { sunAzDeg: sun.azDeg, sunElDeg: sun.elDeg } : {}),
    }),
    mark() {
      if (disposed) return Promise.resolve({ ok: false, reason: 'disposed' });
      if (pending !== null)
        return Promise.resolve({ ok: false, reason: 'busy' });
      const hidden = refresh();
      if (hidden !== undefined)
        return Promise.resolve({ ok: false, reason: hidden });
      if (sun !== null && sun.elDeg < SUN_CHECK.minMarkElevationDeg) {
        return Promise.resolve({ ok: false, reason: 'sun-down' });
      }
      const pressed = deps.nowEpochMs();
      const before = samples.filter((s) => s.t >= pressed - SUN_CHECK.holdMs);
      const covered =
        before.length >= SUN_CHECK.minFrames &&
        before[0]!.t <= pressed - 0.9 * SUN_CHECK.holdMs;
      if (covered) {
        return Promise.resolve(aggregate(pressed - SUN_CHECK.holdMs, pressed));
      }
      const start = pressed + SUN_CHECK.joltMs;
      const end = start + SUN_CHECK.holdMs;
      return new Promise<SunMarkResult>((resolve) => {
        const timer = setTimeout(
          () => finish(start, end),
          SUN_CHECK.joltMs + SUN_CHECK.holdMs + SUN_CHECK.giveUpMs
        );
        pending = { start, end, resolve, timer };
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      settle({ ok: false, reason: 'disposed' });
      unregisterFrame();
      deregisterSession();
      marker.dispose();
    },
  };
  const deregisterSession = registerSessionDisposer(() => check.dispose());
  refresh();
  return check;
}
