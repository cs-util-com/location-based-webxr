/**
 * The AR sun check's controller (plan 2026-09-24-0100, M2 and M2b, §3.4):
 * keeps the sun marker on the real (apparent) sun, and turns "aim the
 * reticle at the sun, press Mark" into a measured heading error.
 *
 * SAMPLED WHERE IT IS DRAWN. Each sample is taken in the marker's
 * `onBeforeRender`, with the camera three renders it with: the ray the user
 * SEES and the alignment-free ray come from the same frame by construction,
 * whatever order the app's frame callbacks run in (the recorder's sampler
 * ran before its alignment lerper; plan review finding 3). ONLY TRACKED
 * FRAMES count: when the viewer pose is null (tracking lost) three renders
 * the last view again, which would read as a perfectly steady phone
 * (M2 review finding 1).
 *
 * THE MARK. The window is the `holdMs` ending `preGuardMs` BEFORE the press
 * (a click fires at touch-up, after the finger has pushed the phone; plan
 * review finding 5, M2 review finding 5); when that second is missing or
 * the phone moved in it, the `holdMs` starting `joltMs` AFTER the press. The
 * result is the median heading and elevation error; the spread is measured
 * on the ALIGNMENT-FREE ray, so an alignment update mid-window is flagged,
 * not refused as hand shake (review finding 4). A Mark always resolves, as a
 * sighting or a refusal: never hangs, never throws.
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
import {
  bearingDeltaDeg,
  normalizeBearingDeg,
} from '../utils/bearing-degrees.js';
// The shared rules (DEC-H3): the interpolating median and the nearest-rank
// percentile, whose private copies here behaved the same on every window
// this check builds (non-empty, p = 0.8).
import { interpolatingMedian as median } from '../utils/median.js';
import { nearestRankPercentile as percentile } from '../utils/percentile.js';
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
import { registerXrFrameUpdate } from './xr-frame-loop.js';

/** The controller's rules, in one place (overridable through `deps.rules`). */
export const SUN_CHECK = {
  /** The Mark window. */
  holdMs: 1000,
  /** The pre-press window ends this long before the press (the tap's push). */
  preGuardMs: 150,
  /** Past the tap's jolt, when the window has to start after the press. */
  joltMs: 300,
  /** A Mark with fewer frames is refused. */
  minFrames: 10,
  /**
   * Hand shake above this refuses the Mark: the 80th-percentile angular
   * distance of the alignment-free ray from its median direction (four
   * frames in five within it). Not the median distance: a two-cluster shake
   * puts the median direction inside the larger cluster and reads 0. Stricter
   * than the plan's first "median absolute deviation" at the same bound.
   */
  maxSpreadDeg: 0.3,
  spreadPercentile: 0.8,
  /** A drawn-yaw range above this inside the window is flagged. */
  maxYawRangeDeg: 0.05,
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

/** The rules' shape (numbers), for `deps.rules`. */
type SunCheckRules = { readonly [K in keyof typeof SUN_CHECK]: number };

/** Why the marker is hidden (the HUD says so). */
type SunHiddenReason =
  'no-position' | 'no-alignment' | 'not-tracking' | 'sun-down';

/** Why a Mark was refused. */
type SunMarkRefusal =
  SunHiddenReason | 'busy' | 'moved' | 'no-frames' | 'disposed';

/** What a Mark warns about. */
type SunMarkWarning = 'high-sun' | 'target-changed' | 'alignment-moving';

/** One accepted Mark: the raw record the recorder logs (plan §6.3), flat. */
interface SunSighting {
  readonly schema: 1;
  /** How the ray was aimed: the screen-centre reticle. */
  readonly mode: 'reticle';
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
  /** The middle frame's viewport in pixels, and the screen's angle. */
  readonly viewportW: number;
  readonly viewportH: number;
  readonly screenAngleDeg: number;
  /**
   * The drawn yaw: median in [0, 360); min and max UNWRAPPED around the
   * window's first yaw (so a window crossing north reads 359.9 … 360.1).
   */
  readonly displayedYawDeg: number;
  readonly yawMinDeg: number;
  readonly yawMaxDeg: number;
  /** The app's target yaw (as the app reports it) and whether it changed. */
  readonly targetYawDeg: number | null;
  readonly targetChanged: boolean;
  /** The place, and the sun at the middle frame. */
  readonly lat: number;
  readonly lng: number;
  readonly sunAzDeg: number;
  readonly sunElApparentDeg: number;
  readonly refractionDeg: number;
  readonly pressureHPa: number;
  readonly temperatureC: number;
  /** `nowEpochMs − monotonicEpochMs` at the Mark. */
  readonly clockOffsetMs: number;
  /** Derived, for convenience: the median errors (plan §3.4 sign). */
  readonly headingErrDeg: number;
  readonly elevationErrDeg: number;
  readonly separationDeg: number;
}

type SunMarkResult =
  | {
      readonly ok: true;
      readonly sighting: SunSighting;
      readonly warnings: readonly SunMarkWarning[];
    }
  | {
      readonly ok: false;
      readonly reason: SunMarkRefusal;
      /** For 'moved': the spread and the frames it was measured on. */
      readonly spreadDeg?: number;
      readonly frames?: number;
    };

/** The marker's state, for a HUD line. */
interface SunCheckStatus {
  readonly visible: boolean;
  readonly hiddenBecause?: SunHiddenReason;
  readonly sunAzDeg?: number;
  readonly sunElDeg?: number;
}

export interface SunCheckDeps {
  /** The GPS-world NUE scene root; the marker and reticle are added here. */
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
  /** Overrides of `SUN_CHECK` (the field sweep, plan §8.4). */
  readonly rules?: Partial<SunCheckRules>;
}

export interface SunCheck {
  readonly marker: SunMarker;
  status(): SunCheckStatus;
  /** Measure; always resolves, never throws. */
  mark(): Promise<SunMarkResult>;
  dispose(): void;
}

interface SunAt {
  readonly azDeg: number;
  readonly elDeg: number;
  readonly refractionDeg: number;
  readonly dir: Vec3;
}

interface Sample {
  readonly t: number;
  readonly rGps: Vec3;
  readonly rOdo: Vec3;
  readonly sun: SunAt;
  readonly yaw: number;
  readonly target: number | null;
  readonly viewQ: THREE.Quaternion;
  readonly projection: readonly number[];
  readonly viewportW: number;
  readonly viewportH: number;
}

interface SunNow extends SunAt {
  readonly place: { readonly lat: number; readonly lng: number };
}

const DEG = Math.PI / 180;
const IDENTITY = new THREE.Matrix4();
const STANDARD_AIR = { pressureHPa: 1010, temperatureC: 10 };

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
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
 * The rules that are elevations and may be negative. Named, not matched by
 * suffix: a negative spread or range bound would refuse every Mark silently.
 */
const SIGNED_RULES: ReadonlySet<string> = new Set([
  'hideBelowDeg',
  'minMarkElevationDeg',
]);

/** The rules with overrides, each finite, and non-negative unless signed. */
function rulesOf(overrides: Partial<SunCheckRules> | undefined): SunCheckRules {
  const rules = { ...SUN_CHECK, ...overrides };
  for (const [key, value] of Object.entries(rules)) {
    if (!Number.isFinite(value) || (value < 0 && !SIGNED_RULES.has(key))) {
      throw new RangeError(
        `sun check rule ${key} must be finite${SIGNED_RULES.has(key) ? '' : ' and non-negative'}, got ${value}`
      );
    }
  }
  return rules;
}

/** Runs `f`, or returns `fallback` if it throws (app callbacks, maths). */
function guarded<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

/**
 * Starts the sun check: adds the marker and the reticle to `deps.scene`,
 * keeps them on the sun, samples every drawn, tracked frame. Disposed with
 * the AR session.
 */
export function startSunCheck(deps: SunCheckDeps): SunCheck {
  const rules = rulesOf(deps.rules);
  const marker = createSunMarker();
  deps.scene.add(marker.object, marker.reticle);
  const monotonic =
    deps.monotonicEpochMs ?? (() => performance.timeOrigin + performance.now());
  const air = { ...STANDARD_AIR, ...deps.refraction };

  let samples: Sample[] = [];
  let sun: SunNow | null = null;
  let hiddenBecause: SunHiddenReason | undefined = 'no-position';
  let lastSunMs = Number.NEGATIVE_INFINITY;
  let tracked = false;
  let pending: {
    readonly start: number;
    readonly end: number;
    readonly resolve: (r: SunMarkResult) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let disposed = false;

  const aligned = () => !deps.arWorldGroup.matrix.equals(IDENTITY);

  const sunAt = (t: number, place: SunNow['place']): SunAt => {
    const apparent = solarPosition(t, place.lat, place.lng, {
      refraction: air,
    });
    const geometric = solarPosition(t, place.lat, place.lng);
    return {
      azDeg: apparent.azimuthRad / DEG,
      elDeg: apparent.elevationRad / DEG,
      refractionDeg: (apparent.elevationRad - geometric.elevationRad) / DEG,
      dir: sunDirectionNue(apparent.azimuthRad, apparent.elevationRad),
    };
  };

  const computeSun = (): SunNow | null => {
    const place = guarded(() => deps.getZeroReference(), null);
    if (place === null) return null;
    return guarded(() => ({ ...sunAt(deps.nowEpochMs(), place), place }), null);
  };

  /** Recompute the sun and the marker's visibility; returns why it is hidden. */
  const refresh = (): SunHiddenReason | undefined => {
    sun = computeSun();
    lastSunMs = deps.nowEpochMs();
    if (sun === null) hiddenBecause = 'no-position';
    else if (!aligned()) hiddenBecause = 'no-alignment';
    else if (!tracked) hiddenBecause = 'not-tracking';
    else if (sun.elDeg < rules.hideBelowDeg) hiddenBecause = 'sun-down';
    else hiddenBecause = undefined;
    if (sun !== null) marker.setSun(sun.azDeg, sun.elDeg);
    marker.setVisible(hiddenBecause === undefined);
    return hiddenBecause;
  };

  // A jump of the wall clock in EITHER direction refreshes (a clock set
  // back would otherwise freeze the marker; M2 review finding 9).
  const unregisterFrame = registerFrameUpdate(() => {
    if (Math.abs(deps.nowEpochMs() - lastSunMs) >= rules.sunUpdateMs) refresh();
  });

  // Tracking, per XR frame: a null or emulated viewer pose means three will
  // draw the LAST view again (M2 review finding 1). A change either way
  // refreshes the marker at once.
  const unregisterXr = registerXrFrameUpdate(({ frame, referenceSpace }) => {
    const pose = guarded(() => frame.getViewerPose(referenceSpace), null);
    const now = pose !== null && pose !== undefined && !pose.emulatedPosition;
    if (now !== tracked) {
      tracked = now;
      refresh();
    }
  });

  const inverse = new THREE.Matrix4();
  const odoCamera = new THREE.Matrix4();
  const viewport = new THREE.Vector4();
  marker.object.onBeforeRender = (renderer, _scene, camera) => {
    if (disposed || sun === null || !tracked) return;
    // One view per frame: a stereo session renders twice, and the second
    // eye's centre ray would read as shake (M2 review finding 11).
    const xr = (renderer as THREE.WebGLRenderer | null)?.xr;
    if (xr?.isPresenting === true) {
      const views = xr.getCamera().cameras;
      if (views.length > 1 && camera !== views[0]) return;
    }
    guarded(() => {
      sample(camera, renderer);
      return true;
    }, false);
  };

  const sample = (
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer | null
  ) => {
    const place = sun!.place;
    const world = deps.arWorldGroup.matrixWorld;
    const yaw = alignmentYawDeg(world.elements);
    const projection = [...camera.projectionMatrix.elements];
    const ray = principalRayCamera(projection);
    const rGps = normalize(rotateByMat4(camera.matrixWorld.elements, ray));
    inverse.copy(world).invert();
    const rOdo = normalize(rotateByMat4(inverse.elements, rGps));
    odoCamera.multiplyMatrices(inverse, camera.matrixWorld);
    const viewQ = new THREE.Quaternion().setFromRotationMatrix(odoCamera);
    const own = (camera as THREE.Camera & { viewport?: THREE.Vector4 })
      .viewport;
    if (own !== undefined) viewport.copy(own);
    else if (renderer !== null) renderer.getViewport(viewport);
    else viewport.set(0, 0, 0, 0);
    const t = deps.nowEpochMs();
    samples.push({
      t,
      rGps,
      rOdo,
      sun: sunAt(t, place),
      yaw,
      target: guarded(() => deps.getTargetYawDeg?.() ?? null, null),
      viewQ,
      projection,
      viewportW: viewport.z,
      viewportH: viewport.w,
    });
    samples = samples.filter((s) => Math.abs(t - s.t) <= rules.keepMs);
    if (pending !== null && t >= pending.end)
      finish(pending.start, pending.end);
  };

  const aggregate = (start: number, end: number): SunMarkResult => {
    const window = samples.filter((s) => s.t >= start && s.t <= end);
    if (window.length < rules.minFrames || sun === null) {
      return { ok: false, reason: hiddenBecause ?? 'no-frames' };
    }
    const odoMedian = medianDirection(window.map((s) => s.rOdo));
    const spreadDeg = percentile(
      window.map((s) => separationDeg(s.rOdo, odoMedian)),
      rules.spreadPercentile
    );
    if (spreadDeg > rules.maxSpreadDeg) {
      return { ok: false, reason: 'moved', spreadDeg, frames: window.length };
    }
    const errors = window.map((s) => sightingErrorDeg(s.rGps, s.sun.dir));
    const middle = window[window.length >> 1]!;
    // Unwrapped around the first yaw, so a window crossing north does not
    // read as a 360° range or a median of 180° (M2 review finding 8).
    const first = window[0]!.yaw;
    const yaws = window.map((s) => first + bearingDeltaDeg(s.yaw, first));
    const yawMin = Math.min(...yaws);
    const yawMax = Math.max(...yaws);
    const targets = window.map((s) => s.target);
    const targetChanged =
      targets.some(
        (x) => x === null || Math.abs(x - (targets[0] ?? 0)) > 1e-9
      ) && targets.some((x) => x !== null);
    const rayXr = nueToWebXR([...odoMedian]);
    const place = sun.place;
    const screenAngle = guarded(
      () =>
        typeof screen === 'undefined' ? 0 : (screen.orientation?.angle ?? 0),
      0
    );
    const sighting: SunSighting = {
      schema: 1,
      mode: 'reticle',
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
      viewportW: middle.viewportW,
      viewportH: middle.viewportH,
      screenAngleDeg: screenAngle,
      displayedYawDeg: normalizeBearingDeg(median(yaws)),
      yawMinDeg: yawMin,
      yawMaxDeg: yawMax,
      targetYawDeg: middle.target,
      targetChanged,
      lat: place.lat,
      lng: place.lng,
      sunAzDeg: middle.sun.azDeg,
      sunElApparentDeg: middle.sun.elDeg,
      refractionDeg: middle.sun.refractionDeg,
      pressureHPa: air.pressureHPa,
      temperatureC: air.temperatureC,
      clockOffsetMs: deps.nowEpochMs() - monotonic(),
      headingErrDeg: median(errors.map((e) => e.headingDeg)),
      elevationErrDeg: median(errors.map((e) => e.elevationDeg)),
      separationDeg: median(errors.map((e) => e.separationDeg)),
    };
    const warnings: SunMarkWarning[] = [];
    if (middle.sun.elDeg > rules.highSunDeg) warnings.push('high-sun');
    if (targetChanged) warnings.push('target-changed');
    if (yawMax - yawMin > rules.maxYawRangeDeg)
      warnings.push('alignment-moving');
    return { ok: true, sighting, warnings };
  };

  const settle = (result: SunMarkResult) => {
    if (pending === null) return;
    const { resolve, timer } = pending;
    clearTimeout(timer);
    pending = null;
    resolve(result);
  };

  const finish = (start: number, end: number) =>
    settle(
      guarded(() => aggregate(start, end), { ok: false, reason: 'no-frames' })
    );

  const markNow = (): Promise<SunMarkResult> => {
    const hidden = refresh();
    if (hidden !== undefined)
      return Promise.resolve({ ok: false, reason: hidden });
    if (sun !== null && sun.elDeg < rules.minMarkElevationDeg) {
      return Promise.resolve({ ok: false, reason: 'sun-down' });
    }
    const pressed = deps.nowEpochMs();
    const end = pressed - rules.preGuardMs;
    const start = end - rules.holdMs;
    const before = samples.filter((s) => s.t >= start && s.t <= end);
    const covered =
      before.length >= rules.minFrames &&
      before[0]!.t <= start + 0.1 * rules.holdMs;
    if (covered) {
      const result = aggregate(start, end);
      // Moved before the press ("swing onto the sun, press at once"): try
      // the second after the tap instead of refusing (M2 review finding 5).
      if (result.ok || result.reason !== 'moved')
        return Promise.resolve(result);
    }
    const after = pressed + rules.joltMs;
    return new Promise<SunMarkResult>((resolve) => {
      const timer = setTimeout(
        () => finish(after, after + rules.holdMs),
        rules.joltMs + rules.holdMs + rules.giveUpMs
      );
      pending = { start: after, end: after + rules.holdMs, resolve, timer };
    });
  };

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
      return guarded(
        markNow,
        Promise.resolve({ ok: false, reason: 'no-frames' })
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      settle({ ok: false, reason: 'disposed' });
      unregisterFrame();
      unregisterXr();
      deregisterSession();
      marker.dispose();
    },
  };
  const deregisterSession = registerSessionDisposer(() => check.dispose());
  refresh();
  return check;
}
