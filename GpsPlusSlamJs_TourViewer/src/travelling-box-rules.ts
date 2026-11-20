/**
 * The travelling box's rules, pure: where a narrated text's words belong
 * this frame (on their plate under the reading sign, docked at the
 * screen's foot, or hidden), how long a new place must hold before the
 * words move, the flight between plate and dock, and the letter size on
 * screen that decides it. No three.js, no DOM: the controller measures,
 * these decide, so every rule is unit- and property-testable and a logged
 * walk can be replayed offline for any knob set.
 *
 * @see travelling-box-rules.ts.md
 */

/** Where a travelling surface is: on its plate in the world, docked at
 *  the screen, folded into a small mark (a surface that wants the dock
 *  while another holds it, when it can fold), or hidden. */
export type TravelPlace = "plate" | "dock" | "fold" | "hidden";

/** Why a surface hides, as its adapter reports it (the words: no voice,
 *  outside the station, the reading sheet open; in that order). */
export type TravelHideWhy = "no voice" | "outside the station" | "sheet open";

/** Why `wantPlace` chose its place, for the log and the debug readout. */
export type TravelWhy =
  | "not travelling"
  | TravelHideWhy
  | "out of view"
  | "turned away"
  | "too small"
  | "slot taken"
  | "readable";

/** One size the plate must reach on screen to be used there: the letter
 *  (em, CSS px), a picture's height or the smallest control to touch. */
export interface TravelGate {
  readonly kind: "letter" | "picture" | "touch";
  /** Its size on screen this frame (CSS px). */
  readonly px: number;
  /** The size it must reach (a plate already shown keeps down to
   *  `thr x keep`). */
  readonly thr: number;
}

/** Which letter size the threshold reads: the smaller of the drawn
 *  height and width (catches squashed text), or the height alone. */
export type TravelMetric = "min" | "h";

/** The travelling box's tuning (`travelling-box-knobs.ts` reads it from
 *  the address behind `?debug=1`). */
export interface TravellingBoxKnobs {
  /** The smallest letter (em, CSS px) shown on the plate. */
  readonly thr: number;
  readonly metric: TravelMetric;
  /** The share of `thr` a plate already shown keeps down to. */
  readonly keep: number;
  /** Seconds a want of the dock, or of the plate, must hold. */
  readonly holdDock: number;
  readonly holdPlate: number;
  /** Seconds after a finger lifts before the place may change. */
  readonly lock: number;
  /** The most the plate may face away from the camera (degrees). */
  readonly angle: number;
  /** The flight's duration (s). */
  readonly fly: number;
  /** Whether the sign grows with distance while it carries words. */
  readonly grow: boolean;
}

export const TRAVELLING_BOX_DEFAULTS: TravellingBoxKnobs = {
  thr: 12,
  metric: "min",
  keep: 0.95,
  holdDock: 0.3,
  holdPlate: 0.3,
  lock: 0.3,
  angle: 60,
  fly: 0.6,
  grow: true,
};

/** The words plate in the world: one em of the box is `emM` metres; its
 *  top sits `gapM` under the sign's lower edge and `frontM` in front of
 *  the sign's plane (all scaled by the sign's growth). */
export const TRAVEL_PLATE = { emM: 0.136, gapM: 0.07, frontM: 0.04 } as const;

/** How far from the view's centre (NDC, per axis) the plate's centre may
 *  be: within `enter` to move onto the plate, within `keep` to stay. */
export const TRAVEL_EDGE = { enter: 0.88, keep: 0.95 } as const;

/** A corner's clip coordinates with w at or under this are behind, or too
 *  close to, the eye to measure. */
export const TRAVEL_MIN_W = 0.05;

/**
 * The plate's size (m) for a box of `boxCssW` x `boxCssH` CSS px at
 * `fontPx`: one em is `emM` metres (the sign's words: `TRAVEL_PLATE.emM`),
 * so the plate keeps the box's aspect exactly.
 *
 * @throws RangeError when a size is not a positive finite number.
 */
export function plateSizeM(
  boxCssW: number,
  boxCssH: number,
  fontPx: number,
  emM: number = TRAVEL_PLATE.emM,
): { widthM: number; heightM: number } {
  for (const v of [boxCssW, boxCssH, fontPx, emM]) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`plate sizes must be positive, got ${String(v)}`);
    }
  }
  const m = emM / fontPx;
  return { widthM: boxCssW * m, heightM: boxCssH * m };
}

/** The plate as the camera sees it this frame. */
export interface PlateMetrics {
  /** Every corner in front of the eye. */
  readonly valid: boolean;
  /** Valid, with the centre inside the view. */
  readonly onScreen: boolean;
  /** The centre in NDC (-1 to 1, y up). */
  readonly ndcX: number;
  readonly ndcY: number;
  /** One em on screen (CSS px), measured down the plate's middle. */
  readonly letterPxH: number;
  /** One em on screen (CSS px), measured across its middle. */
  readonly letterPxW: number;
  /** The smaller of the two: what the threshold reads by default. */
  readonly letterPx: number;
  /** One line on screen (CSS px). */
  readonly linePx: number;
}

const INVALID: PlateMetrics = {
  valid: false,
  onScreen: false,
  ndcX: 0,
  ndcY: 0,
  letterPxH: 0,
  letterPxW: 0,
  letterPx: 0,
  linePx: 0,
};

function screenOf(
  x: number,
  y: number,
  w: number,
  viewW: number,
  viewH: number,
): [number, number] {
  return [((x / w + 1) / 2) * viewW, ((1 - y / w) / 2) * viewH];
}

/** Screen px between the clip-space midpoints of corners a+b and c+d
 *  (a clip-space midpoint is the projection of the world midpoint). */
function midSpan(
  k: ArrayLike<number>,
  [a, b, c, d]: readonly [number, number, number, number],
  viewW: number,
  viewH: number,
): number {
  const mid = (i: number, j: number, n: number) =>
    (k[i * 4 + n]! + k[j * 4 + n]!) / 2;
  const [x1, y1] = screenOf(
    mid(a, b, 0),
    mid(a, b, 1),
    mid(a, b, 3),
    viewW,
    viewH,
  );
  const [x2, y2] = screenOf(
    mid(c, d, 0),
    mid(c, d, 1),
    mid(c, d, 3),
    viewW,
    viewH,
  );
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * The plate's letter size on screen. `cornersClip` holds the plate's four
 * corners' clip coordinates (x, y, z, w each) in the order top-left,
 * top-right, bottom-left, bottom-right (a three.js plane's vertex order);
 * `centreClip` its centre's. The plate shows a box `boxCssW` x `boxCssH`
 * CSS px whose type is `fontPx` with `lineHeightPx` lines, so one em is
 * the plate's drawn height x fontPx / boxCssH (and its width likewise);
 * `wantPlace` picks which of them the threshold reads.
 * A corner at or under `minW` (the eye's margin, or the camera's near
 * plane where that is further), any non-finite number, or a view, box,
 * font or line size that is not a positive finite number gives invalid
 * metrics with every size 0.
 */
export function plateMetrics(
  cornersClip: ArrayLike<number>,
  centreClip: ArrayLike<number>,
  viewW: number,
  viewH: number,
  boxCssW: number,
  boxCssH: number,
  fontPx: number,
  lineHeightPx: number,
  minW: number = TRAVEL_MIN_W,
): PlateMetrics {
  if (cornersClip.length < 16 || centreClip.length < 4) return INVALID;
  for (const size of [viewW, viewH, boxCssW, boxCssH, fontPx, lineHeightPx]) {
    if (!(Number.isFinite(size) && size > 0)) return INVALID;
  }
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(cornersClip[i])) return INVALID;
  }
  for (let i = 0; i < 4; i++) {
    if (!Number.isFinite(centreClip[i])) return INVALID;
    if (cornersClip[i * 4 + 3]! <= minW) return INVALID;
  }
  const cw = centreClip[3]!;
  if (cw <= minW) return INVALID;
  const ndcX = centreClip[0]! / cw;
  const ndcY = centreClip[1]! / cw;
  const letterPxH =
    (midSpan(cornersClip, [0, 1, 2, 3], viewW, viewH) * fontPx) / boxCssH;
  const letterPxW =
    (midSpan(cornersClip, [0, 2, 1, 3], viewW, viewH) * fontPx) / boxCssW;
  const letterPx = Math.min(letterPxH, letterPxW);
  return {
    valid: true,
    onScreen: Math.abs(ndcX) < 1 && Math.abs(ndcY) < 1,
    ndcX,
    ndcY,
    letterPxH,
    letterPxW,
    letterPx,
    linePx: (letterPx * lineHeightPx) / fontPx,
  };
}

/** The angle (degrees, 0 to 180) between the plate's normal and the way
 *  from the plate to the camera, both on the ground plane (x, z); 0 when
 *  either is the zero vector. */
export function facingAngleDeg(
  normalXZ: readonly [number, number],
  toCameraXZ: readonly [number, number],
): number {
  const [ax, az] = normalXZ;
  const [bx, bz] = toCameraXZ;
  const cross = ax * bz - az * bx;
  const dot = ax * bx + az * bz;
  if (cross === 0 && dot === 0) return 0;
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
}

/** What `wantPlace` reads this frame. */
export interface WantInput {
  /** The surface travels at all (its words are in the travel mode). */
  readonly travelling: boolean;
  /** Why the surface hides, from its adapter, or null. */
  readonly hideWhy: TravelHideWhy | null;
  /** The sizes the plate must reach on screen (`letterGate` for words). */
  readonly gates: readonly TravelGate[];
  readonly metrics: PlateMetrics;
  /** `facingAngleDeg` of the plate. */
  readonly angleDeg: number;
  /** The surface is on its plate now (the hysteresis side). */
  readonly onPlate: boolean;
  /** The surface owns its screen slot (a surface alone always does). */
  readonly slotFree: boolean;
  /** It can fold into a mark when it would dock without the slot. */
  readonly canFold: boolean;
}

/** The letter gate of a words plate: the em as drawn (the knob's metric:
 *  the smaller of height and width, or the height alone) against `thr`. */
export function letterGate(
  metrics: PlateMetrics,
  knobs: Pick<TravellingBoxKnobs, "metric" | "thr">,
): TravelGate {
  return {
    kind: "letter",
    px: knobs.metric === "h" ? metrics.letterPxH : metrics.letterPx,
    thr: knobs.thr,
  };
}

/** Where the surface wants to be this frame, and why, in the prototype's
 *  order: the hiding reasons first, then what docks, then the plate. A
 *  surface that would dock without owning its slot folds when it can,
 *  else stays on its plate ("slot taken"). */
export function wantPlace(
  input: WantInput,
  knobs: TravellingBoxKnobs,
): { place: TravelPlace; why: TravelWhy } {
  if (!input.travelling) return { place: "hidden", why: "not travelling" };
  if (input.hideWhy !== null) return { place: "hidden", why: input.hideWhy };
  const dock = dockWhy(input, knobs);
  if (dock === null) return { place: "plate", why: "readable" };
  if (input.slotFree) return { place: "dock", why: dock };
  return { place: input.canFold ? "fold" : "plate", why: "slot taken" };
}

/** Why the plate cannot be used where it is, or null when it can. */
function dockWhy(
  input: WantInput,
  knobs: TravellingBoxKnobs,
): TravelWhy | null {
  const m = input.metrics;
  const edge = input.onPlate ? TRAVEL_EDGE.keep : TRAVEL_EDGE.enter;
  if (!m.valid || Math.abs(m.ndcX) >= edge || Math.abs(m.ndcY) >= edge) {
    return "out of view";
  }
  if (!(input.angleDeg <= knobs.angle)) return "turned away";
  const keep = input.onPlate ? knobs.keep : 1;
  // Written so a NaN size docks: NaN >= thr is false.
  if (input.gates.some((g) => !(g.px >= g.thr * keep))) return "too small";
  return null;
}

/** The settled place and the want waiting to replace it. */
export interface SettleState {
  readonly place: TravelPlace;
  /** The want differing from `place`, or null. */
  readonly pending: TravelPlace | null;
  /** Seconds `pending` has held, counted from the frame after it first
   *  appeared. */
  readonly pendingS: number;
}

/**
 * One frame of the settling: a want that differs from the place must hold
 * `holdPlate` seconds (to the plate) or `holdDock` (to the dock or the
 * fold) before the words move. Hiding, and
 * appearing from hidden, act at once, under a finger too (the words must
 * go with the voice or under the sheet). Between plate and dock nothing
 * moves while a finger is down nor until `lock` seconds after it lifts
 * (`sinceReleaseS`; Infinity when there was no press); the hold keeps
 * counting meanwhile.
 */
export function settlePlace(
  state: SettleState,
  want: TravelPlace,
  dtS: number,
  input: { readonly fingerDown: boolean; readonly sinceReleaseS: number },
  knobs: TravellingBoxKnobs,
): SettleState {
  if (want === state.place) {
    return { place: state.place, pending: null, pendingS: 0 };
  }
  if (want === "hidden" || state.place === "hidden") {
    return { place: want, pending: null, pendingS: 0 };
  }
  const pendingS = state.pending === want ? state.pendingS + validDt(dtS) : 0;
  // A fold is a claim of the dock that did not win: it holds as one.
  const held =
    pendingS >= (want === "plate" ? knobs.holdPlate : knobs.holdDock);
  const still = input.fingerDown || !(input.sinceReleaseS >= knobs.lock);
  if (held && !still) return { place: want, pending: null, pendingS: 0 };
  return { place: state.place, pending: want, pendingS };
}

/** `value` moved toward `target` by dt / duration, never past it; at the
 *  target at once under reduced motion or a duration of 0. The flight's
 *  progress `u` (the controller passes dt 0 under a finger, so the words
 *  freeze where they are) and the words' presence (their fade) both step
 *  this way. */
export function stepToward(
  value: number,
  target: number,
  dtS: number,
  durationS: number,
  reduceMotion: boolean,
): number {
  if (reduceMotion || !(durationS > 0)) return target;
  const step = validDt(dtS) / durationS;
  return value < target
    ? Math.min(target, value + step)
    : Math.max(target, value - step);
}

/** A frame's dt, 0 when it is negative or not finite. */
function validDt(dtS: number): number {
  return Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
}

/** The flight's easing: slow out, fast between, slow in. */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/**
 * The flying box's corners in clip space at eased progress `e`: each
 * corner's x and y move from the plate's clip corner (`srcClip`, as for
 * `plateMetrics`) to its dock corner (`dockNdc`, x, y per corner, same
 * order) times a reference w (the mean of the plate's), w moves to that
 * reference and z to 0. Interpolating in clip space keeps the plate's
 * perspective early in the flight and lands flat on the dock; each
 * corner's NDC stays between its start and its end. Writes the 16 numbers
 * into `out` (the caller's, kept from frame to frame) and returns it.
 */
export function flightClip<T extends { [i: number]: number }>(
  srcClip: ArrayLike<number>,
  dockNdc: ArrayLike<number>,
  e: number,
  out: T,
): T {
  const wRef = (srcClip[3]! + srcClip[7]! + srcClip[11]! + srcClip[15]!) / 4;
  const a = 1 - e;
  for (let i = 0; i < 4; i++) {
    const k = i * 4;
    out[k] = srcClip[k]! * a + dockNdc[i * 2]! * wRef * e;
    out[k + 1] = srcClip[k + 1]! * a + dockNdc[i * 2 + 1]! * wRef * e;
    out[k + 2] = srcClip[k + 2]! * a;
    out[k + 3] = srcClip[k + 3]! * a + wRef * e;
  }
  return out;
}

/** The sign's growth while it carries words: 1 up to `from` metres, then
 *  d / from, at most `max` (1.6 from 7.2 m). 1 for a non-finite distance. */
export function signGrowth(d: number, from = 4.5, max = 1.6): number {
  if (!Number.isFinite(d)) return 1;
  return Math.min(max, Math.max(1, d / from));
}

/** Plane order (TL TR BL BR) to polygon order (TL TR BR BL). */
const POLYGON = [0, 1, 3, 2] as const;

/** A quad's corners on screen (px) written into `out` (four pairs), in
 *  polygon order: top-left, top-right, bottom-right, bottom-left, from
 *  clip corners in plane order, allocating nothing (the controller runs it
 *  every frame). False (and `out` untouched) when a corner's w is at or
 *  under `minW` (the eye's margin by default) or not finite, which has no
 *  place on the screen. */
export function quadOfClipInto(
  clip: ArrayLike<number>,
  viewW: number,
  viewH: number,
  out: readonly [number, number][],
  minW: number = TRAVEL_MIN_W,
): boolean {
  for (let i = 0; i < 4; i++) {
    const w = clip[i * 4 + 3];
    if (w === undefined || !(Number.isFinite(w) && w > minW)) return false;
  }
  for (let k = 0; k < 4; k++) {
    const i = POLYGON[k]!;
    const w = clip[i * 4 + 3]!;
    const p = out[k]!;
    p[0] = ((clip[i * 4]! / w + 1) / 2) * viewW;
    p[1] = ((1 - clip[i * 4 + 1]! / w) / 2) * viewH;
  }
  return true;
}

/** Whether (x, y) lies inside a convex quad given in polygon order (its
 *  edge included); false for a quad collapsed to a line or a point. */
export function inQuad(
  x: number,
  y: number,
  quad: readonly (readonly [number, number])[],
): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i++) {
    const [ax, ay] = quad[i]!;
    const [bx, by] = quad[(i + 1) % quad.length]!;
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}
