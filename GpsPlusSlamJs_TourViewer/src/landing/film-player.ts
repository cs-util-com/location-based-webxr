/**
 * The hero film's player: owns the film's one number (its position on the
 * timeline) and decides when it moves. It plays once by itself when a set
 * share of the film is in view, pauses when the film leaves the view and
 * resumes where it stopped, pauses and resumes on a tap, jumps to a part,
 * and yields to AR (`release`). It requests an animation frame ONLY while
 * it plays: paused, finished, waiting or out of view costs nothing.
 *
 * DOM-free: the frame scheduler, the drawing and the page's listener are
 * seams, so the rules are unit-tested in node.
 *
 * @see film-player.ts.md
 */
import type { FilmPosition, Timeline } from "./film-timeline.js";

export type FilmStatus = "waiting" | "playing" | "paused" | "finished";
/** Who paused it: a tap or the button, the view, or the AR handoff. */
export type PauseReason = "user" | "view" | "release";

export interface PlayerSnapshot {
  readonly status: FilmStatus;
  /** Set exactly while `status` is "paused". */
  readonly pausedBy: PauseReason | null;
  /** The position, seconds in [0, totalS]. */
  readonly t: number;
  readonly position: FilmPosition;
  /** Reduced motion's opening still: the final frame, never played yet. */
  readonly opening: boolean;
  /** Playing with at least the start share in view: the page's one moving thing. */
  readonly moving: boolean;
}

export interface FilmPlayerOptions {
  readonly timeline: Timeline;
  /** No autoplay; opens on the final frame. Explicit play still plays. */
  readonly reducedMotion: boolean;
  /** Share of the film in view that starts or resumes it, (0, 1]. */
  readonly startShare: number;
  /** Below this share it has left the view and pauses, [0, startShare). */
  readonly leaveShare: number;
  requestFrame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  /** Draws the film at position `t`. */
  render(t: number): void;
  /** Called after every change and every drawn frame. */
  onChange(snapshot: PlayerSnapshot): void;
  /** The longest step one frame may take, seconds (default 0.1). */
  readonly maxStepS?: number;
}

export interface FilmPlayer {
  snapshot(): PlayerSnapshot;
  /** The share of the film in view, [0, 1]; garbage reads as 0. */
  setViewShare(share: number): void;
  /** A tap on the scene: pause or resume; starts a waiting film; nothing once finished. */
  tap(): void;
  /** The play/pause button: like a tap, and "Play again" once finished. */
  toggle(): void;
  /** Plays from the start of part `beat`. Throws RangeError for no such part. */
  jumpTo(beat: number): void;
  /** The AR handoff: pause; resume only on a fresh entry into view or a tap. */
  release(): void;
  /** Draws once at the current position (a resize, a new renderer). */
  redraw(): void;
  destroy(): void;
}

export function createFilmPlayer(o: FilmPlayerOptions): FilmPlayer {
  if (!(
    Number.isFinite(o.startShare) &&
    o.startShare > 0 &&
    o.startShare <= 1
  )) {
    throw new RangeError(
      `film player: startShare must be in (0, 1], got ${String(o.startShare)}`,
    );
  }
  if (!(
    Number.isFinite(o.leaveShare) &&
    o.leaveShare >= 0 &&
    o.leaveShare < o.startShare
  )) {
    throw new RangeError(
      `film player: leaveShare must be in [0, startShare), got ${String(o.leaveShare)}`,
    );
  }
  const maxStepS = o.maxStepS ?? 0.1;
  const total = o.timeline.totalS;

  let status: FilmStatus = o.reducedMotion ? "finished" : "waiting";
  let pausedBy: PauseReason | null = null;
  let t = o.reducedMotion ? total : 0;
  let opening = o.reducedMotion;
  let share = 0;
  /** False after a release until the film has left the view once. */
  let armed = true;
  let frameId = 0;
  let lastNow: number | null = null;
  let destroyed = false;

  const snapshot = (): PlayerSnapshot => ({
    status,
    pausedBy,
    t,
    position: o.timeline.positionAt(t),
    opening,
    moving: status === "playing" && share >= o.startShare,
  });
  const emit = () => {
    if (!destroyed) o.onChange(snapshot());
  };
  const cancel = () => {
    if (frameId !== 0) o.cancelFrame(frameId);
    frameId = 0;
  };
  const schedule = () => {
    if (frameId === 0 && !destroyed) frameId = o.requestFrame(onFrame);
  };

  function onFrame(now: number): void {
    frameId = 0;
    if (destroyed || status !== "playing") return;
    const dt =
      lastNow === null
        ? 0
        : Math.min(maxStepS, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    t = Math.min(total, t + dt);
    if (t >= total) {
      t = total;
      status = "finished";
    }
    o.render(t);
    emit();
    if (status === "playing") schedule();
  }

  const play = () => {
    if (destroyed) return;
    status = "playing";
    pausedBy = null;
    opening = false;
    armed = true;
    lastNow = null;
    schedule();
  };
  const pause = (reason: PauseReason) => {
    cancel();
    status = "paused";
    pausedBy = reason;
  };
  const drawAt = (pos: number) => {
    t = pos;
    o.render(t);
  };
  const tap = () => {
    if (destroyed || status === "finished") return;
    if (status === "playing") pause("user");
    else play();
    emit();
  };

  return {
    snapshot,
    setViewShare(v) {
      if (destroyed) return;
      share = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      if (share < o.leaveShare) {
        armed = true;
        if (status === "playing") pause("view");
      } else if (share >= o.startShare && armed) {
        if (status === "waiting" && !o.reducedMotion) play();
        else if (status === "paused" && pausedBy !== "user") play();
      }
      emit();
    },
    tap,
    toggle() {
      if (destroyed) return;
      if (status === "finished") {
        drawAt(0);
        play();
        emit();
        return;
      }
      tap();
    },
    jumpTo(beat) {
      const start = o.timeline.startOf(beat);
      if (destroyed) return;
      cancel();
      drawAt(start);
      play();
      emit();
    },
    release() {
      if (destroyed) return;
      if (status === "playing") pause("release");
      else if (status === "paused" && pausedBy === "view") pausedBy = "release";
      if (status !== "finished") armed = false;
      emit();
    },
    redraw() {
      if (destroyed) return;
      o.render(t);
      emit();
    },
    destroy() {
      cancel();
      destroyed = true;
    },
  };
}
