/**
 * The hero film's timeline: maps one number, the film's position in
 * seconds, to the part (beat) shown, the moment of that part, and the
 * camera between two named views. Everything the film draws is a function
 * of that position, so pausing, resuming, jumping and playing once are
 * nothing but changes of one number.
 *
 * Each part is laid out as three phases, end to end:
 *
 * - lead: the camera moves to the part's first view (`camS`) when that
 *   view differs from where the previous part ended, else a short settle
 *   (`settleS`); the part shows its moment 0. The first part has none.
 * - act: the part plays, its own seconds stretched by `1 / speed`.
 * - hold: a reading hold on the part's last moment (`holdS`), after every
 *   part but the last, whose end is the end of the film.
 *
 * @see film-timeline.ts.md
 */
import { clamp01 } from "./film-math.js";

/** One part of the film: its own length and the views it uses. */
export interface BeatSpec<V extends string = string> {
  /** The part's own length in seconds at speed 1 (finite, > 0). */
  readonly durS: number;
  /**
   * The camera's views over the part: the first at `atS` 0, then strictly
   * rising `atS` inside the part. A later entry moves the camera within
   * the part (over `camS`).
   */
  readonly views: readonly { readonly atS: number; readonly view: V }[];
}

/** The pace of the film. */
export interface TimelinePace {
  /** Acting speed (finite, > 0); 0.5 plays each part at half speed. */
  readonly speed: number;
  /** Reading hold after each part but the last, seconds (finite, >= 0). */
  readonly holdS: number;
  /** One camera move, seconds (finite, > 0); not stretched by `speed`. */
  readonly camS: number;
  /** The pause before a part whose view stays, seconds (finite, >= 0). */
  readonly settleS: number;
}

/** One part's place on the timeline, seconds. */
export interface Segment {
  readonly index: number;
  readonly startS: number;
  readonly leadS: number;
  readonly actS: number;
  readonly holdS: number;
  readonly endS: number;
}

/** What the film shows at one position. */
export interface FilmPosition {
  readonly beat: number;
  readonly phase: "lead" | "act" | "hold";
  /** The part's own moment, seconds in [0, durS]. */
  readonly storyT: number;
  /** How far through its whole segment (lead, act, hold), in [0, 1]. */
  readonly segmentProgress: number;
  /** True at (and beyond) the end of the film. */
  readonly finished: boolean;
}

/**
 * The camera at one position: moving from one view to another, `k` the
 * move's LINEAR progress in [0, 1] (the scene eases it). Standing still is
 * `k` 1.
 */
export interface CameraAt<V extends string = string> {
  readonly from: V;
  readonly to: V;
  readonly k: number;
}

export interface Timeline<V extends string = string> {
  readonly totalS: number;
  readonly segments: readonly Segment[];
  positionAt(t: number): FilmPosition;
  cameraAt(t: number): CameraAt<V>;
  /** The position where part `i` starts (its lead). */
  startOf(i: number): number;
}

function finite(name: string, v: number, min: number, open: boolean): void {
  if (!Number.isFinite(v) || (open ? v <= min : v < min)) {
    throw new RangeError(
      `film timeline: ${name} must be a finite number ${open ? ">" : ">="} ${String(min)}, got ${String(v)}`,
    );
  }
}

function validate<V extends string>(
  beats: readonly BeatSpec<V>[],
  pace: TimelinePace,
): void {
  if (beats.length === 0) {
    throw new RangeError("film timeline: a film needs at least one part");
  }
  beats.forEach((b, i) => {
    finite(`part ${String(i)} durS`, b.durS, 0, true);
    const first = b.views[0];
    if (first?.atS !== 0) {
      throw new RangeError(
        `film timeline: part ${String(i)} must name its view at moment 0`,
      );
    }
    for (let j = 1; j < b.views.length; j++) {
      const at = b.views[j]!.atS;
      if (!(at > b.views[j - 1]!.atS && at < b.durS)) {
        throw new RangeError(
          `film timeline: part ${String(i)} view ${String(j)} must rise inside the part, got ${String(at)}`,
        );
      }
    }
  });
  finite("speed", pace.speed, 0, true);
  finite("holdS", pace.holdS, 0, false);
  finite("camS", pace.camS, 0, true);
  finite("settleS", pace.settleS, 0, false);
}

interface CameraEvent<V> {
  readonly atS: number;
  readonly from: V;
  readonly to: V;
}

export function createTimeline<V extends string>(
  beats: readonly BeatSpec<V>[],
  pace: TimelinePace,
): Timeline<V> {
  validate(beats, pace);
  const last = beats.length - 1;
  const segments: Segment[] = [];
  const events: CameraEvent<V>[] = [];
  const firstView = beats[0]!.views[0]!.view;
  let view = firstView;
  let at = 0;
  beats.forEach((b, i) => {
    const opening = b.views[0]!.view;
    const moves = i > 0 && opening !== view;
    const leadS = i === 0 ? 0 : moves ? pace.camS : pace.settleS;
    if (moves) events.push({ atS: at, from: view, to: opening });
    view = opening;
    const actS = b.durS / pace.speed;
    for (const v of b.views.slice(1)) {
      if (v.view !== view) {
        events.push({
          atS: at + leadS + v.atS / pace.speed,
          from: view,
          to: v.view,
        });
        view = v.view;
      }
    }
    const holdS = i === last ? 0 : pace.holdS;
    segments.push({
      index: i,
      startS: at,
      leadS,
      actS,
      holdS,
      endS: at + leadS + actS + holdS,
    });
    at += leadS + actS + holdS;
  });
  const totalS = at;

  const clampT = (t: number): number =>
    Number.isFinite(t)
      ? Math.min(totalS, Math.max(0, t))
      : t === Infinity
        ? totalS
        : 0;

  const segmentAt = (t: number): Segment => {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid]!.startS <= t) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo]!;
  };

  return {
    totalS,
    segments,
    positionAt(t) {
      const tt = clampT(t);
      const s = segmentAt(tt);
      const durS = beats[s.index]!.durS;
      const len = s.endS - s.startS;
      const segmentProgress = len > 0 ? clamp01((tt - s.startS) / len) : 1;
      const finished = tt >= totalS;
      const into = tt - s.startS;
      if (finished) {
        return {
          beat: last,
          phase: "act",
          storyT: beats[last]!.durS,
          segmentProgress: 1,
          finished,
        };
      }
      if (into < s.leadS) {
        return {
          beat: s.index,
          phase: "lead",
          storyT: 0,
          segmentProgress,
          finished,
        };
      }
      if (into < s.leadS + s.actS) {
        const storyT = Math.min(durS, (into - s.leadS) * pace.speed);
        return {
          beat: s.index,
          phase: "act",
          storyT,
          segmentProgress,
          finished,
        };
      }
      return {
        beat: s.index,
        phase: "hold",
        storyT: durS,
        segmentProgress,
        finished,
      };
    },
    cameraAt(t) {
      const tt = clampT(t);
      let ev: CameraEvent<V> | undefined;
      for (const e of events) {
        if (e.atS <= tt) ev = e;
        else break;
      }
      if (ev === undefined) return { from: firstView, to: firstView, k: 1 };
      return {
        from: ev.from,
        to: ev.to,
        k: clamp01((tt - ev.atS) / pace.camS),
      };
    },
    startOf(i) {
      if (!Number.isInteger(i) || i < 0 || i > last) {
        throw new RangeError(
          `film timeline: no part ${String(i)} in a film of ${String(beats.length)}`,
        );
      }
      return segments[i]!.startS;
    },
  };
}
