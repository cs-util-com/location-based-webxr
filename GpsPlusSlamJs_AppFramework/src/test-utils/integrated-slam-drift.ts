/**
 * Integrated SLAM drift and correlated GPS noise for synthetic walks
 * (test-only helper).
 *
 * The drift model the Recorder's left-behind sweep measured D28 with
 * (`ar/qr/qr-anchor-mint.start-at-code.test.ts`), shared so the Tour
 * Viewer's authoring-settle sweep measures the same drift instead of a
 * copy of it:
 * - a walk is a list of timed waypoints (North, East) with the distance
 *   walked so far;
 * - the odometry frame's yaw error grows with the distance walked, and every
 *   step is integrated with that moment's yaw error plus a translation bias
 *   in one fixed horizontal direction, a share of the step length. A pose
 *   recorded early stays where the frame was then, so an alignment fitted
 *   to the END of the walk sees it displaced by all the drift after it;
 * - GPS errors are a Gauss-Markov wander plus white noise.
 *
 * Everything is deterministic: randomness comes from the seeded
 * {@link mulberry32} the caller hands in.
 *
 * @see integrated-slam-drift.ts.md
 */

/** (North, East) metres. */
export type NE = readonly [number, number];

/** NUE metres (North, Up, East). */
export type Nue = [number, number, number];

export interface Waypoint {
  readonly tS: number;
  readonly at: NE;
  /** Distance walked by `tS` (m). */
  readonly walkedM: number;
}

/**
 * SLAM drift integrated along the walk: the heading error grows by
 * `yawDegPer100m` per 100 m walked, and each metre is reported with a
 * translation bias of `transPct` % of its length.
 */
export interface IntegratedDrift {
  readonly yawDegPer100m: number;
  readonly transPct: number;
}

/** The phone's odometry NUE position sampled every `stepS` from t = 0. */
export interface OdomTrack {
  readonly stepS: number;
  readonly points: readonly Nue[];
}

/** The seeded PRNG every synthetic walk here draws from. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw (Box-Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Rotation about Up (NUE y) by `a` radians. */
export function rotY(a: number, v: readonly [number, number, number]): Nue {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

/** Where the walker is at `tS`, linearly between waypoints; before the
 *  first waypoint the first, after the last the last. */
export function positionOnRoute(
  waypoints: readonly Waypoint[],
  tS: number
): { at: NE; walkedM: number } {
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    if (tS <= b.tS) {
      const f = b.tS > a.tS ? Math.max(0, (tS - a.tS) / (b.tS - a.tS)) : 1;
      return {
        at: [
          a.at[0] + f * (b.at[0] - a.at[0]),
          a.at[1] + f * (b.at[1] - a.at[1]),
        ],
        walkedM: a.walkedM + f * (b.walkedM - a.walkedM),
      };
    }
  }
  const last = waypoints[waypoints.length - 1];
  if (last === undefined) throw new Error('a route needs a waypoint');
  return { at: last.at, walkedM: last.walkedM };
}

/** The odometry frame's yaw (radians) after `walkedM` metres: `yaw0` plus
 *  `sign` times the drift rate times the distance. */
export function driftedYaw(
  yaw0: number,
  sign: number,
  yawDegPer100m: number,
  walkedM: number
): number {
  return yaw0 + sign * ((yawDegPer100m * Math.PI) / 180) * (walkedM / 100);
}

/** The integration step (s) the Recorder sweep was measured with. */
export const DEFAULT_TRACK_STEP_S = 0.05;

/**
 * Integrate the walker's odometry along the route (see the file header).
 *
 * @param start the odometry NUE position at t = 0
 * @param frameYawAt the odometry frame's yaw (radians) at a moment; each
 *   step is turned by `-frameYawAt` at its midpoint
 * @param biasDirRad the translation bias's direction in the world (radians
 *   from North towards East)
 */
export function integrateOdometry(input: {
  readonly waypoints: readonly Waypoint[];
  readonly endS: number;
  readonly start: readonly [number, number, number];
  readonly frameYawAt: (tS: number) => number;
  readonly biasDirRad: number;
  readonly transPct: number;
  readonly stepS?: number;
}): OdomTrack {
  const stepS = input.stepS ?? DEFAULT_TRACK_STEP_S;
  if (!(stepS > 0) || !Number.isFinite(input.endS)) {
    throw new Error('integrateOdometry needs a positive step and a finite end');
  }
  const bias: NE = [Math.cos(input.biasDirRad), Math.sin(input.biasDirRad)];
  const eps = input.transPct / 100;
  let o: Nue = [input.start[0], input.start[1], input.start[2]];
  const points: Nue[] = [o];
  let prev = positionOnRoute(input.waypoints, 0).at;
  const steps = Math.ceil(input.endS / stepS) + 1;
  for (let i = 1; i <= steps; i += 1) {
    const tS = i * stepS;
    const cur = positionOnRoute(input.waypoints, tS).at;
    const dn = cur[0] - prev[0];
    const de = cur[1] - prev[1];
    const len = Math.hypot(dn, de);
    const d = rotY(-input.frameYawAt(tS - stepS / 2), [
      dn + eps * len * bias[0],
      0,
      de + eps * len * bias[1],
    ]);
    o = [o[0] + d[0], o[1], o[2] + d[2]];
    points.push(o);
    prev = cur;
  }
  return { stepS, points };
}

/** The integrated odometry position at `tS`, linear between samples. */
export function trackAt(track: OdomTrack, tS: number): Nue {
  const pos = Math.max(0, tS / track.stepS);
  const i = Math.min(Math.floor(pos), track.points.length - 1);
  const a = track.points[i]!;
  const b = track.points[Math.min(i + 1, track.points.length - 1)]!;
  const f = pos - i;
  return [
    a[0] + f * (b[0] - a[0]),
    a[1] + f * (b[1] - a[1]),
    a[2] + f * (b[2] - a[2]),
  ];
}

/**
 * GPS horizontal errors at 1 Hz: a Gauss-Markov wander (sigma
 * `wanderFrac x accuracyM`, correlation time `tauS`) plus white noise
 * (`whiteFrac x accuracyM`). The defaults are the Recorder sweep's.
 */
export function gaussMarkovGpsErrors(
  rng: () => number,
  count: number,
  accuracyM: number,
  options: {
    readonly wanderFrac?: number;
    readonly whiteFrac?: number;
    readonly tauS?: number;
  } = {}
): NE[] {
  const s = (options.wanderFrac ?? 0.25) * accuracyM;
  const w = (options.whiteFrac ?? 0.15) * accuracyM;
  const rho = Math.exp(-1 / (options.tauS ?? 60));
  const k = Math.sqrt(1 - rho * rho);
  let gm: [number, number] = [s * gaussian(rng), s * gaussian(rng)];
  const out: NE[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0)
      gm = [
        rho * gm[0] + k * s * gaussian(rng),
        rho * gm[1] + k * s * gaussian(rng),
      ];
    out.push([gm[0] + w * gaussian(rng), gm[1] + w * gaussian(rng)]);
  }
  return out;
}
