/**
 * The woods governor: on a phone too slow for the invented woods it draws
 * fewer of them (the owner's rule: above 50 ms a frame the library lowers
 * the density on the phone by itself; the desktop stays full).
 *
 * WHAT IT SETS. A share of the invented trees, on a ladder of 1, 0.5 and
 * 0.25 and never 0: the owner asked for less density, not for no woods. The
 * share is drawn as a rank prefix of each instanced mesh
 * (`applyWoodsShare`), so thinning is spatially even, needs no rebuild and
 * keeps the woods' outline.
 *
 * WHAT IT MEASURES. A consumer may draw on demand (OsmDemo draws a frame only
 * when something moved), so the time since the last frame is often idle time.
 * Only a CHAINED frame is measured: one requested from within the previous
 * frame's callback (camera damping, an animation, a walk). The first frame
 * of a burst measures nothing. A consumer with a continuous loop passes
 * `chained: true` for every frame.
 *
 * THE RULE, after the near clouds' governor (`globe-cloud-governor.ts` in
 * the globe package, which this package cannot import; the two are kept as
 * copies, each naming the other):
 * - the smoothed interval above `slowMs` for `slowS` of counted frames steps
 *   one rung down; under `fastMs` for `fastS` steps one rung up;
 * - one frame longer than `gapMs` says nothing of the device (a hitch, a tab
 *   coming back); two in a row do. A counted frame enters the average whole
 *   but credits the verdicts at most `gapMs` of time, so a pair of hitches
 *   cannot make a verdict while a device at a second a frame still reads as
 *   slow as it is. Each rung is judged by its own frames: at a step the
 *   average starts afresh, so a device with few frames a verdict does not
 *   judge the new rung by the old one's;
 * - the worthwhile test: when thinning bought less than `worthwhile` of the
 *   frame time, measured against the full woods, the woods were not the
 *   cost, so they come back in full and the step-down rests for `restS`;
 * - a thinned share that stayed under `slowMs` for `fastS` has bought its
 *   time. A later slow verdict there is a new one: the half steps on to a
 *   quarter and remembers the slowness that sent it, and the quarter is
 *   worthwhile against that or the full woods; a quarter that had bought
 *   its time has no rung left and stays;
 * - a share left for being too slow is not returned to within `restS` of
 *   leaving it, so the governor does not pop between 1 and 0.5.
 * Rests run on the clock passed in (wall time), so idle time counts toward
 * them; the verdicts run on counted frames only.
 *
 * @see woods-governor.ts.md
 */

export const WOODS_GOVERNOR = Object.freeze({
  /** Slower than this for `slowS` steps down (ms; the owner's 50 ms). */
  slowMs: 50,
  /**
   * Faster than this for `fastS` gives back a step (ms). Above a 30 Hz
   * cap's 33.3 ms, so a capped phone gets its woods back; far below 50.
   */
  fastMs: 36,
  /** How long a verdict must hold, in counted frames (s). */
  slowS: 2,
  fastS: 12,
  /** The share of the frame time thinning must save. */
  worthwhile: 0.15,
  /** How long a too-slow share and a worthless step are remembered (s). */
  restS: 300,
  /** How much of a frame reaches the average. */
  smoothing: 0.1,
  /**
   * One frame this long says nothing of the device (ms); of two in a row,
   * each counts as this long.
   */
  gapMs: 250,
  /** The ladder, from full to the fewest; never 0. */
  shares: Object.freeze([1, 0.5, 0.25] as const),
});

/**
 * `off`: auto is off; `full`: every tree drawn; `thinned`: a rung down;
 * `resting`: full after a step that bought nothing, not stepping down.
 */
export type WoodsGovernorMode = "off" | "full" | "thinned" | "resting";

export interface WoodsGovernorState {
  /** The share of the invented trees to draw, one of `WOODS_GOVERNOR.shares`. */
  readonly share: number;
  readonly mode: WoodsGovernorMode;
  /** The smoothed counted-frame interval (ms), undefined before the first. */
  readonly averageMs: number | undefined;
}

export interface WoodsGovernor {
  /**
   * One frame drawn at `atMs` (a monotonic clock, ms); `chained` when it was
   * requested from within the previous frame's callback. A non-finite time
   * or one not after the last is ignored.
   */
  frame(atMs: number, chained: boolean): void;
  state(): WoodsGovernorState;
}

/**
 * The governor; with `auto` false it never moves the share (desktop) and
 * still measures, so a readout can show the frame time there too.
 */
export function createWoodsGovernor({
  auto = true,
}: { readonly auto?: boolean } = {}): WoodsGovernor {
  const G = WOODS_GOVERNOR;
  const lowest = G.shares.length - 1;
  const restMs = G.restS * 1000;
  let steps = 0;
  let last: number | undefined;
  let average: number | undefined;
  let slowFor = 0;
  let fastFor = 0;
  /** The average when the thinning began, for the worthwhile test. */
  let slowAt = 0;
  /** The average when a thinned share that had bought its time got slow. */
  let againAt: number | undefined;
  /** The average stayed under `slowMs` for `fastS` at this rung. */
  let bought = false;
  let boughtFor = 0;
  /** A step was taken: the next counted frame starts the average afresh. */
  let fresh = false;
  let gapBefore = false;
  /** No step-down before this time (the worthwhile test's rest). */
  let restUntil = Number.NEGATIVE_INFINITY;
  /** When each rung was left for being too slow. */
  const leftAt: number[] = G.shares.map(() => Number.NEGATIVE_INFINITY);

  /** A new rung: its purchase and its average start over. */
  const enter = (rung: number): void => {
    steps = rung;
    bought = false;
    boughtFor = 0;
    fresh = true;
  };

  const stepDown = (at: number, now: number): void => {
    if (at < restUntil) return;
    const line = 1 - G.worthwhile;
    if (steps === 0) {
      slowAt = now;
      againAt = undefined;
    } else if (bought && steps < lowest) {
      againAt = now;
    } else if (bought) {
      // The fewest woods had bought their time: no rung left, it stays.
      bought = false;
      boughtFor = 0;
      return;
    } else if (
      now > slowAt * line &&
      (againAt === undefined || now > againAt * line)
    ) {
      enter(0);
      restUntil = at + restMs;
      return;
    }
    if (steps < lowest) {
      leftAt[steps] = at;
      enter(steps + 1);
    }
  };

  const stepUp = (at: number): void => {
    if (steps === 0) return;
    if (at - (leftAt[steps - 1] ?? Number.NEGATIVE_INFINITY) < restMs) return;
    againAt = undefined;
    enter(steps - 1);
  };

  /** The interval this frame measures, or undefined when it measures none. */
  const measured = (atMs: number, chained: boolean): number | undefined => {
    if (!Number.isFinite(atMs)) return undefined;
    if (last !== undefined && !(atMs > last)) return undefined;
    const before = last;
    last = atMs;
    if (!chained || before === undefined) return undefined;
    const ms = atMs - before;
    const gap = ms > G.gapMs;
    const alone = gap && !gapBefore;
    gapBefore = gap;
    return alone ? undefined : ms;
  };

  /** One counted interval into the average; a new rung starts it afresh. */
  const smooth = (ms: number): number => {
    const now =
      average === undefined || fresh
        ? ms
        : average + (ms - average) * G.smoothing;
    average = now;
    fresh = false;
    return now;
  };

  /** One counted interval into the average and the verdicts. */
  const count = (atMs: number, ms: number): void => {
    const now = smooth(ms);
    const seconds = Math.min(ms, G.gapMs) / 1000;
    boughtFor = steps > 0 && now < G.slowMs ? boughtFor + seconds : 0;
    if (boughtFor >= G.fastS) bought = true;
    slowFor = now > G.slowMs ? slowFor + seconds : 0;
    fastFor = now < G.fastMs ? fastFor + seconds : 0;
    if (!auto) return;
    if (slowFor >= G.slowS) {
      slowFor = 0;
      fastFor = 0;
      stepDown(atMs, now);
    } else if (fastFor >= G.fastS) {
      fastFor = 0;
      stepUp(atMs);
    }
  };

  return {
    frame(atMs, chained) {
      const ms = measured(atMs, chained);
      if (ms !== undefined) count(atMs, ms);
    },
    state() {
      const share = G.shares[steps] ?? 1;
      const mode: WoodsGovernorMode = !auto
        ? "off"
        : steps > 0
          ? "thinned"
          : last !== undefined && last < restUntil
            ? "resting"
            : "full";
      return { share, mode, averageMs: average };
    },
  };
}
