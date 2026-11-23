/**
 * The "nearby targets" kernel: which trackable targets (QR codes, 2D images,
 * 3D objects, keyframes of another session) are near enough to search for,
 * from the app's position series, its precision, the AR pose series and the
 * clock. Pure and stateless: the hysteresis is a scan back over a declared
 * look-back, never a stored flag, so the consumer calls it per cadence tick
 * and keeps nothing.
 *
 * Two gates, either one opens a target:
 * - the GPS gate (states `'gps'` and `'dr'`): R_enter = reachM + c x s,
 *   R_leave = f x R_enter + L, s = sqrt(acc_fix^2 + acc_target^2) (plus the
 *   dead-reckoning drift for the live sample); open iff, scanning newest
 *   first within H, a sample inside its own R_enter comes before any sample
 *   outside its own R_leave;
 * - the AR gate: a target with a sighting in the current AR frame opens while
 *   the live AR pose is within reachM + arMarginM + alpha x the AR path
 *   walked since the sighting.
 *
 * Every AR position is odom-NUE ([north, up, east], `webxrToNUE` of a WebXR
 * position); horizontal distances use axes [0] and [2]. GPS positions are the
 * session's GPS-world NUE north/east. All times are epoch ms.
 *
 * @see nearby-targets.ts.md
 */

import { POSITION_PRECISION_CEILING_M } from '../../state/position-precision.js';

/** The kinds of trackable target. */
export type TargetKind = 'qr' | 'image' | 'object' | 'keyframe';

/** One trackable target. */
export interface Target {
  readonly key: string;
  readonly kind: TargetKind;
  /** GPS-world NUE (m); a non-finite value: the GPS gate never opens it. */
  readonly north: number;
  readonly east: number;
  /** The target's own position accuracy (m); null (or not a finite positive
   *  number): {@link NearbyParams.defaultTargetAccM}. */
  readonly accM: number | null;
  /** r_target (m): how far from its position the target can be detected. */
  readonly reachM: number;
  /** Set for a target minted while its heading was uncertain: its
   *  alignment's GPS extent (m). Its accuracy is then max(accM,
   *  defaultTargetAccM) + {@link NearbyParams.headingWideningK} x this; a
   *  value that is not finite and >= 0 widens nothing. */
  readonly alignmentGpsExtentM?: number;
  /** The tracker's newest sighting in the current AR frame (odom-NUE). */
  readonly sighting?: ArPose;
}

/** One sample of the app's position series (device fixes only). */
export interface Fix {
  readonly t: number;
  readonly north: number;
  readonly east: number;
  /** acc_fix as of this sample; a sample without a finite positive one is
   *  ignored (it never opens nor closes). */
  readonly accM: number;
}

/** One AR pose (odom-NUE of the current AR frame). */
export interface ArPose {
  readonly t: number;
  readonly pos: readonly [number, number, number];
  /** The sample is paired with a DEVICE fix (not a code's vote, which sits
   *  at the code's corner). Only such a sample anchors `'dr'`. */
  readonly device?: boolean;
}

/** The position this tick: between fixes it keeps moving with AR odometry. */
export interface LivePose {
  readonly t: number;
  /** The aligned camera in GPS-world NUE. */
  readonly north: number;
  readonly east: number;
  /** `webxrToNUE` of the WebXR camera position of the same tick. */
  readonly ar: readonly [number, number, number];
  /** acc_fix now (a code hold: 1 m); null: take the newest fix's. */
  readonly accM: number | null;
}

/** The gate's parameters (values and their sweeps: the sidecar). */
export interface NearbyParams {
  /** Radius multiple: R_enter = reachM + c x s. */
  readonly c: number;
  /** Leave factor: R_leave = f x R_enter + L (at least 1). */
  readonly f: number;
  /** Leave margin (m). */
  readonly L: number;
  /** Look-back of the hysteresis scan (ms). */
  readonly H: number;
  /** Freshness of the newest device fix (ms). */
  readonly F: number;
  /** Drift per metre of AR distance. */
  readonly alpha: number;
  /** The AR gate's margin (m). */
  readonly arMarginM: number;
  /** The accuracy of a target that states none (m). */
  readonly defaultTargetAccM: number;
  /** acc_fix above it: `'unknown'` (m). */
  readonly ceilingM: number;
  /** A heading-uncertain target's widening: this many times its
   *  `alignmentGpsExtentM` is added to its accuracy (0: none). */
  readonly headingWideningK: number;
}

/** The defaults (the plan's section 4.6). */
export const DEFAULT_NEARBY_PARAMS: NearbyParams = Object.freeze({
  c: 1.5,
  f: 1.3,
  L: 5,
  H: 60_000,
  F: 5_000,
  alpha: 0.03,
  arMarginM: 1,
  defaultTargetAccM: 5,
  ceilingM: POSITION_PRECISION_CEILING_M,
  headingWideningK: 1,
});

export interface NearbyInput {
  readonly targets: readonly Target[];
  /** Device fixes, oldest first. */
  readonly fixes: readonly Fix[];
  /** The newest DEVICE fix's time, never the series' newest t. */
  readonly newestFixAtMs: number | null;
  /** The odometry series, oldest first, votes included; several samples
   *  may share one t. */
  readonly arPoses: readonly ArPose[];
  readonly live: LivePose | null;
  readonly nowMs: number;
  readonly params: NearbyParams;
}

export interface OpenTarget {
  readonly key: string;
  readonly distM: number;
  readonly by: 'gps' | 'ar';
}

export interface NearbyResult {
  /** Nearest first; ties by key. */
  readonly open: readonly OpenTarget[];
  readonly state: 'gps' | 'dr' | 'unknown';
}

/**
 * The open targets now and the state the decision came from.
 *
 * @throws RangeError on a parameter out of range or a non-finite `nowMs`
 *   (caller bugs, not data).
 */
export function nearbyTargets(input: NearbyInput): NearbyResult {
  const { params, nowMs } = input;
  checkNearbyParams(params);
  if (!Number.isFinite(nowMs)) {
    throw new RangeError(`nowMs must be finite; got ${String(nowMs)}`);
  }
  const live = usableLive(input.live);
  const accFix = accuracyNow(live, input.fixes);
  const anchor = drAnchor(input.arPoses, input.newestFixAtMs);
  const state = stateOf(input, live, accFix, anchor);
  const fromMs = nowMs - params.H;
  // The live sample's drift: the horizontal AR distance since the anchor.
  const driftM =
    live !== null && anchor !== null ? horizontal(anchor.pos, live.ar) : 0;
  const path = live === null ? null : arPath(input.arPoses, live);

  const scene: Scene = {
    fixes: input.fixes,
    live,
    gpsAcc: state === 'unknown' ? null : accFix,
    driftM,
    fromMs,
    path,
    p: params,
  };
  const open: OpenTarget[] = [];
  for (const target of input.targets) {
    const o = usableTarget(target) ? openOf(target, scene) : null;
    if (o !== null) open.push(o);
  }
  open.sort(byDistanceThenKey);
  return { open, state };
}

/** Nearest first; ties by key, so the order never depends on the input's. */
function byDistanceThenKey(a: OpenTarget, b: OpenTarget): number {
  if (a.distM !== b.distM) return a.distM - b.distM;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

/**
 * The slot `floor(nowMs / periodMs) mod n` (0..n-1): a round robin that
 * rotates by the clock alone, with no cursor. A non-finite time is slot 0.
 *
 * @throws RangeError when `periodMs` is not finite and positive or `n` is not
 *   a positive integer.
 */
export function timeSlot(nowMs: number, periodMs: number, n: number): number {
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw new RangeError(
      `periodMs must be finite and > 0; got ${String(periodMs)}`
    );
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`n must be a positive integer; got ${String(n)}`);
  }
  if (!Number.isFinite(nowMs)) return 0;
  const slot = Math.floor(nowMs / periodMs) % n;
  return slot < 0 ? slot + n : slot;
}

/** The index of the first sample with `t >= fromMs` in a series sorted by
 *  `t` (binary search; the length when none). */
export function firstIndexAtOrAfter(
  series: readonly { readonly t: number }[],
  fromMs: number
): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.t < fromMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Validates the parameters.
 *
 * @throws RangeError on the first one out of range.
 */
export function checkNearbyParams(p: NearbyParams): void {
  const checks: readonly [keyof NearbyParams, boolean][] = [
    ['c', p.c > 0],
    ['f', p.f >= 1],
    ['L', p.L >= 0],
    ['H', p.H > 0],
    ['F', p.F >= 0],
    ['alpha', p.alpha >= 0],
    ['arMarginM', p.arMarginM >= 0],
    ['defaultTargetAccM', p.defaultTargetAccM > 0],
    ['ceilingM', p.ceilingM > 0],
    ['headingWideningK', p.headingWideningK >= 0],
  ];
  for (const [name, ok] of checks) {
    if (!ok || !Number.isFinite(p[name])) {
      throw new RangeError(
        `NearbyParams.${name} is out of range: ${String(p[name])}`
      );
    }
  }
}

type Live = LivePose & { readonly arOk: boolean };

/** The live pose when its time and horizontal position are finite. */
function usableLive(live: LivePose | null): Live | null {
  if (live === null || typeof live !== 'object') return null;
  if (![live.t, live.north, live.east].every(Number.isFinite)) return null;
  const arOk =
    Array.isArray(live.ar) &&
    Number.isFinite(live.ar[0]) &&
    Number.isFinite(live.ar[2]);
  return { ...live, arOk };
}

/** acc_fix now: the live pose's, else the newest usable fix's. */
function accuracyNow(live: Live | null, fixes: readonly Fix[]): number | null {
  const own = live === null ? null : positive(live.accM);
  if (own !== null) return own;
  for (let i = fixes.length - 1; i >= 0; i -= 1) {
    const a = positive(fixes[i]?.accM);
    if (a !== null) return a;
  }
  return null;
}

/** The newest device sample at or before the newest device fix: a fix may
 *  have no odometry sample (distance gating, dropped values), and several
 *  samples may share one t, so t is no key. */
function drAnchor(
  arPoses: readonly ArPose[],
  newestFixAtMs: number | null
): ArPose | null {
  if (newestFixAtMs === null || !Number.isFinite(newestFixAtMs)) return null;
  for (let i = arPoses.length - 1; i >= 0; i -= 1) {
    const p = arPoses[i]!;
    if (p.device !== true || !(p.t <= newestFixAtMs)) continue;
    if (Number.isFinite(p.pos[0]) && Number.isFinite(p.pos[2])) return p;
  }
  return null;
}

function stateOf(
  input: NearbyInput,
  live: Live | null,
  accFix: number | null,
  anchor: ArPose | null
): NearbyResult['state'] {
  if (accFix === null || accFix > input.params.ceilingM) return 'unknown';
  const at = input.newestFixAtMs;
  if (
    at !== null &&
    Number.isFinite(at) &&
    input.nowMs - at <= input.params.F
  ) {
    return 'gps';
  }
  if (live !== null && live.arOk && anchor !== null) return 'dr';
  return 'unknown';
}

/** What every target is judged against in one call. */
interface Scene {
  readonly fixes: readonly Fix[];
  readonly live: Live | null;
  /** acc_fix, or null when the GPS gate is off (state 'unknown'). */
  readonly gpsAcc: number | null;
  readonly driftM: number;
  readonly fromMs: number;
  readonly path: ArPath | null;
  readonly p: NearbyParams;
}

/** acc_target: the target's own accuracy (the default without one); a
 *  heading-uncertain target's is max(own, default) plus K x its extent. */
function targetAccM(target: Target, p: NearbyParams): number {
  const own = positive(target.accM) ?? p.defaultTargetAccM;
  const extent = target.alignmentGpsExtentM;
  if (extent === undefined || !Number.isFinite(extent) || extent < 0) {
    return own;
  }
  return Math.max(own, p.defaultTargetAccM) + p.headingWideningK * extent;
}

/** One target: the GPS gate first, else the AR gate, else closed. A target
 *  without a finite position can still open by its sighting. */
function openOf(target: Target, sc: Scene): OpenTarget | null {
  const accT = targetAccM(target, sc.p);
  const hasGeo = Number.isFinite(target.north) && Number.isFinite(target.east);
  const gps =
    sc.gpsAcc !== null && hasGeo ? gpsGate(target, accT, sc.gpsAcc, sc) : null;
  if (gps !== null) return { key: target.key, distM: gps, by: 'gps' };
  const ar =
    sc.live !== null && sc.path !== null
      ? arGate(target, sc.live, sc.path, sc.p)
      : null;
  return ar === null ? null : { key: target.key, distM: ar, by: 'ar' };
}

/** The GPS gate: the distance from the newest sample when open, else null. */
function gpsGate(
  target: Target,
  accT: number,
  accFix: number,
  { fixes, live, driftM, fromMs, p }: Scene
): number | null {
  let newestDist: number | null = null;
  /** One sample: true opens, false closes, null is the band (go on). */
  const judge = (n: number, e: number, s: number): boolean | null => {
    const d = Math.hypot(n - target.north, e - target.east);
    newestDist ??= d;
    const enter = target.reachM + p.c * s;
    if (d <= enter) return true;
    if (d > p.f * enter + p.L) return false;
    return null;
  };
  if (live !== null && live.t >= fromMs) {
    const s = Math.hypot(accFix, accT) + p.alpha * driftM;
    const v = judge(live.north, live.east, s);
    if (v !== null) return v ? newestDist : null;
  }
  for (let i = fixes.length - 1; i >= 0; i -= 1) {
    const f = fixes[i]!;
    const acc = usableFixAccuracy(f, fromMs);
    if (acc === null) continue;
    const v = judge(f.north, f.east, Math.hypot(acc, accT));
    if (v !== null) return v ? newestDist : null;
  }
  return null;
}

/** A fix's accuracy when it is inside the window with a finite position,
 *  else null (skipped). */
function usableFixAccuracy(f: Fix, fromMs: number): number | null {
  if (!(f.t >= fromMs)) return null;
  if (!Number.isFinite(f.north) || !Number.isFinite(f.east)) return null;
  return positive(f.accM);
}

/** The AR path walked: cumulative horizontal steps along the series. */
interface ArPath {
  readonly poses: readonly ArPose[];
  /** cum[i]: the path from poses[0] to poses[i]. */
  readonly cum: readonly number[];
  readonly live: Live;
}

function arPath(arPoses: readonly ArPose[], live: Live): ArPath | null {
  if (!live.arOk) return null;
  const poses = arPoses.filter(
    (p) =>
      Number.isFinite(p.t) &&
      Number.isFinite(p.pos[0]) &&
      Number.isFinite(p.pos[2])
  );
  const cum: number[] = [];
  let sum = 0;
  for (let i = 0; i < poses.length; i += 1) {
    if (i > 0) sum += horizontal(poses[i - 1]!.pos, poses[i]!.pos);
    cum.push(sum);
  }
  return { poses, cum, live };
}

/** The AR gate: the AR distance when open, else null. */
function arGate(
  target: Target,
  live: Live,
  path: ArPath,
  p: NearbyParams
): number | null {
  const s = target.sighting;
  if (s === undefined || s === null || !Number.isFinite(s.t)) return null;
  if (!Number.isFinite(s.pos[0]) || !Number.isFinite(s.pos[2])) return null;
  // The first sample strictly after the sighting.
  let i = firstIndexAtOrAfter(path.poses, s.t);
  while (i < path.poses.length && path.poses[i]!.t <= s.t) i += 1;
  let walked: number;
  if (i >= path.poses.length) {
    walked = horizontal(s.pos, live.ar);
  } else {
    const last = path.poses.length - 1;
    walked =
      horizontal(s.pos, path.poses[i]!.pos) +
      (path.cum[last]! - path.cum[i]!) +
      horizontal(path.poses[last]!.pos, live.ar);
  }
  const d = horizontal(live.ar, s.pos);
  return d <= target.reachM + p.arMarginM + p.alpha * walked ? d : null;
}

function usableTarget(t: Target): boolean {
  return (
    t !== null &&
    typeof t === 'object' &&
    typeof t.key === 'string' &&
    Number.isFinite(t.reachM) &&
    t.reachM >= 0
  );
}

function horizontal(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** A finite positive number, or null. */
function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
