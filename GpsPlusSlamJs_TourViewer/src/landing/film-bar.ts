/**
 * The hero film's progress bar as data: one segment per part, each seen,
 * current or upcoming; the play/pause button's kind and name; the caption.
 * The current part stays "current" in every state but finished (paused it
 * is drawn solid red with a pause mark), so a touch never makes the
 * current segment look like an upcoming one.
 *
 * Pure: `film-bar-view.ts` draws this model.
 *
 * @see film-bar.ts.md
 */
import type { PlayerSnapshot } from "./film-player.js";

export type SegmentLook = "seen" | "current" | "upcoming";

export interface BarSegment {
  readonly index: number;
  readonly look: SegmentLook;
  /** How much of the segment is filled, [0, 1]: seen 1, upcoming 0. */
  readonly fill: number;
  /** "Part 3 of 8: A story you know". */
  readonly label: string;
  /** The one segment that gets `aria-current`; none once finished. */
  readonly current: boolean;
}

export interface BarModel {
  readonly segments: readonly BarSegment[];
  readonly finished: boolean;
  readonly paused: boolean;
  readonly button: {
    readonly kind: "pause" | "play" | "again";
    readonly label: string;
  };
  /** The caption of the part shown (the last part's once finished). */
  readonly caption: string;
  /** Reduced motion's opening still: every caption, as a list. */
  readonly captionsAsList: boolean;
}

export function barModel(
  snap: PlayerSnapshot,
  titles: readonly string[],
  captions: readonly string[],
): BarModel {
  const n = titles.length;
  if (n === 0 || captions.length !== n) {
    throw new RangeError(
      `film bar: need one title and one caption per part, got ${String(n)} and ${String(captions.length)}`,
    );
  }
  const finished = snap.status === "finished";
  const beat = Math.min(n - 1, Math.max(0, snap.position.beat));
  const segments = titles.map((title, index): BarSegment => {
    const label = `Part ${String(index + 1)} of ${String(n)}: ${title}`;
    if (finished || index < beat)
      return { index, look: "seen", fill: 1, label, current: false };
    if (index > beat)
      return { index, look: "upcoming", fill: 0, label, current: false };
    const fill = Math.min(1, Math.max(0, snap.position.segmentProgress));
    return { index, look: "current", fill, label, current: true };
  });
  const button: BarModel["button"] =
    snap.status === "playing"
      ? { kind: "pause", label: "Pause the film" }
      : finished && !snap.opening
        ? { kind: "again", label: "Play again" }
        : { kind: "play", label: "Play the film" };
  return {
    segments,
    finished,
    paused: snap.status === "paused",
    button,
    caption: captions[finished ? n - 1 : beat]!,
    captionsAsList: snap.opening,
  };
}
