/**
 * The sun-shadow rig (AR sun shadow prototype plan 2026-09-23-2343, M1):
 * where the shadow-casting sun light goes, when its shadow map must be
 * re-rendered, and how dark the shadow is drawn. Pure: no three.js.
 *
 * FRAME-AGNOSTIC (plan review finding 12): every vector is in the CALLER's
 * scene frame with y up. The look-dev page passes x east / -z north, AR
 * passes NUE; each call site converts its sun direction.
 *
 * @see sun-shadow-rig.ts.md
 */

/** A 3-vector in the caller's frame, y up. */
export type Vec3 = readonly [number, number, number];

/** The rig's defaults (plan §3.1, review findings 5, 10, 13, 14; M1 review). */
export const SUN_SHADOW = {
  /** Half the shadow camera's square, metres (R). */
  halfWidthM: 25,
  /**
   * The light stands R + this from the centre (D = R + 30 m); with the near
   * plane at 0 the margin is real coverage for tall casters on the sun side.
   */
  marginM: 30,
  /** The map re-renders when the sun moved more than this. */
  sunUpdateDeg: 0.05,
  /**
   * ...or the user moved more than this fraction of R (horizontal Euclidean
   * distance) from the rendered centre. Chosen by the coverage sweep in the
   * property tests (M1 review, finding 2).
   */
  // 0.5 cut a 10° shadow of a 1.5 m pole 6 m away at R 25; 0.25 holds at
  // every sun from the floor up (re-centring every 6.25 m of walking).
  innerFraction: 0.25,
  /** ...or the casters moved by more than this, metres (the easing root). */
  casterMoveM: 0.01,
  /** Below this sun elevation the shadow is off. */
  minSunElevationDeg: 10,
  /** The shadow's linear transmittance until the field photo measures it. */
  transmittance: 0.3,
  /** Shadow map edge, texels. */
  mapSize: 1024,
} as const;

/** The light's pose and its orthographic shadow camera's bounds. */
export interface SunShadowPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly bounds: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly near: number;
    readonly far: number;
  };
}

/**
 * What a shadow map was rendered for. The caller keeps the state of the LAST
 * RENDER (not the last frame): sub-threshold steps must add up.
 */
export interface ShadowUpdateState {
  /** Unit direction toward the sun, caller's frame. */
  readonly sunDir: Vec3;
  /** The shadow square's centre (the user, on the ground). */
  readonly centre: Vec3;
  /** The square's half width R the map was rendered with. */
  readonly halfWidthM: number;
  /**
   * Changes whenever the caster SET changed: a rebuild generation and the
   * caster count, say. Compared exactly.
   */
  readonly casterGeneration: string;
  /**
   * Where the casters are, as one number (e.g. the content root's vertical
   * offset, metres). Compared with `casterMoveM`, so an easing root
   * re-renders only every centimetre, not every frame.
   */
  readonly casterOffsetM: number;
}

/** The update rule's thresholds (defaults from `SUN_SHADOW`). */
export interface ShadowUpdateThresholds {
  readonly sunDeg?: number;
  readonly innerFraction?: number;
  readonly casterMoveM?: number;
}

const DEG = Math.PI / 180;
const UNIT_TOLERANCE = 1e-6;

function assertFinite(v: readonly number[], what: string): void {
  if (!v.every(Number.isFinite)) {
    throw new RangeError(`${what} must be finite, got ${v.join(', ')}`);
  }
}

function assertSunDirection(v: Vec3): void {
  assertFinite(v, 'the sun direction');
  const length = Math.hypot(v[0], v[1], v[2]);
  if (Math.abs(length - 1) > UNIT_TOLERANCE) {
    throw new RangeError(
      `the sun direction must be a unit vector, got length ${length}`
    );
  }
  if (v[1] <= 0) {
    throw new RangeError('the sun must be above the horizon to cast a shadow');
  }
}

/**
 * The light's pose for a shadow square of half width R around `centre`: the
 * light at `centre + sunDir · D` (D = R + margin) aimed at the centre, a
 * ±R orthographic camera from depth 0 (the light) to D + R. Every point
 * within R of the centre is inside it, and so is the column toward the sun
 * up to the light (tall casters on the sun side). Property-tested, and
 * checked against three.js's own shadow matrix.
 *
 * @throws RangeError for a non-finite or non-unit direction, a sun at or
 *   below the horizon, a non-finite centre, or R ≤ 0 or D ≤ R.
 */
export function sunShadowPose(input: {
  readonly sunDir: Vec3;
  readonly centre: Vec3;
  readonly halfWidthM?: number;
  readonly distanceM?: number;
}): SunShadowPose {
  const R = input.halfWidthM ?? SUN_SHADOW.halfWidthM;
  const D = input.distanceM ?? R + SUN_SHADOW.marginM;
  assertSunDirection(input.sunDir);
  assertFinite(input.centre, 'the shadow centre');
  if (!(Number.isFinite(R) && R > 0 && Number.isFinite(D) && D > R)) {
    throw new RangeError(
      `the shadow half width must be positive and the distance larger, got ${R}, ${D}`
    );
  }
  const [cx, cy, cz] = input.centre;
  const [sx, sy, sz] = input.sunDir;
  return {
    position: [cx + sx * D, cy + sy * D, cz + sz * D],
    target: [cx, cy, cz],
    bounds: { left: -R, right: R, top: R, bottom: -R, near: 0, far: D + R },
  };
}

function assertUpdateState(s: ShadowUpdateState, what: string): void {
  assertFinite(s.sunDir, `${what} sun direction`);
  assertFinite(s.centre, `${what} centre`);
  if (!(Number.isFinite(s.halfWidthM) && s.halfWidthM > 0)) {
    throw new RangeError(
      `${what} half width must be positive, got ${s.halfWidthM}`
    );
  }
  if (!Number.isFinite(s.casterOffsetM)) {
    throw new RangeError(
      `${what} caster offset must be finite, got ${s.casterOffsetM}`
    );
  }
}

function threshold(
  value: number | undefined,
  fallback: number,
  what: string
): number {
  const v = value ?? fallback;
  if (!(Number.isFinite(v) && v >= 0)) {
    throw new RangeError(`${what} must be finite and non-negative, got ${v}`);
  }
  return v;
}

/**
 * Whether the shadow map must be re-rendered, given the state it was LAST
 * RENDERED for (undefined: never) and the state now. True when:
 * - nothing was rendered yet;
 * - the caster set or the square's size changed;
 * - the sun moved more than `sunDeg`;
 * - the casters moved more than `casterMoveM`;
 * - the user moved more than `innerFraction · R` horizontally from the
 *   rendered centre. The receiver height is not a trigger: a receiver only
 *   samples the map.
 *
 * @throws RangeError for a non-finite state or a negative threshold: a NaN
 *   there would otherwise stop the updates silently.
 */
export function shadowNeedsUpdate(
  lastRendered: ShadowUpdateState | undefined,
  now: ShadowUpdateState,
  thresholds: ShadowUpdateThresholds = {}
): boolean {
  assertUpdateState(now, 'the current');
  const sunDeg = threshold(
    thresholds.sunDeg,
    SUN_SHADOW.sunUpdateDeg,
    'sunDeg'
  );
  const inner = threshold(
    thresholds.innerFraction,
    SUN_SHADOW.innerFraction,
    'innerFraction'
  );
  const casterMove = threshold(
    thresholds.casterMoveM,
    SUN_SHADOW.casterMoveM,
    'casterMoveM'
  );
  if (lastRendered === undefined) return true;
  assertUpdateState(lastRendered, 'the rendered');
  if (lastRendered.casterGeneration !== now.casterGeneration) return true;
  if (lastRendered.halfWidthM !== now.halfWidthM) return true;
  const a = lastRendered.sunDir;
  const b = now.sunDir;
  const cos = Math.max(
    -1,
    Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
  );
  if (Math.acos(cos) > sunDeg * DEG) return true;
  if (Math.abs(now.casterOffsetM - lastRendered.casterOffsetM) > casterMove) {
    return true;
  }
  const drift = Math.hypot(
    now.centre[0] - lastRendered.centre[0],
    now.centre[2] - lastRendered.centre[2]
  );
  return drift > inner * lastRendered.halfWidthM;
}

/**
 * The display-space opacity that shows a shadow of linear transmittance `t`
 * over the camera image (exploration §6.3): `1 - t^(1/2.2)`.
 *
 * @throws RangeError for `t` outside [0, 1].
 */
export function shadowOpacity(transmittance: number): number {
  if (!(transmittance >= 0 && transmittance <= 1)) {
    throw new RangeError(
      `transmittance must be in [0, 1], got ${transmittance}`
    );
  }
  return 1 - Math.pow(transmittance, 1 / 2.2);
}

/**
 * Whether a sun at `elevationDeg` casts the shadow (the elevation floor).
 * Check it BEFORE `sunShadowPose`, which throws for a sun below the horizon.
 *
 * @throws RangeError for a non-finite floor.
 */
export function sunShadowActive(
  elevationDeg: number,
  floorDeg: number = SUN_SHADOW.minSunElevationDeg
): boolean {
  if (!Number.isFinite(floorDeg)) {
    throw new RangeError(`the elevation floor must be finite, got ${floorDeg}`);
  }
  return Number.isFinite(elevationDeg) && elevationDeg >= floorDeg;
}
