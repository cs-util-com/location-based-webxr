/**
 * The landing's step cards: which picture moves, and when. A state
 * machine with no DOM, so the rules are unit-tested in node; the page's
 * card module (`landing-cards.ts`) feeds it how much of each picture is in
 * view and the reader's taps, and renders what it says.
 *
 * The rules:
 * - a picture starts once at least `startShare` of it (of as much of it as
 *   fits the view) has stayed in view for `settleMs`, so a fast scroll past
 *   starts nothing;
 * - only the picture most in view moves; the others show their last frame;
 * - it keeps moving: it plays, holds its last frame for `holdMs` and plays
 *   again, until it is tapped or leaves the view;
 * - a tap freezes it where it is, until the next tap, also across a scroll
 *   away and back; while the picture most in view is paused nothing moves;
 * - "Show again" restarts a picture at once and clears its pause;
 * - reduced motion: nothing starts by itself, and "Show again" plays once;
 * - while the film above plays (`setBlocked(true)`) no card moves by
 *   itself: one moving thing at a time.
 *
 * @see card-play.ts.md
 */

import { clamp01 } from "./clamp01.js";

/** How much of a picture must be in view before it starts: 0.9 of it, or
 *  of as much of it as fits the view (the caller normalises). Swept over
 *  0.6, 0.75, 0.9 and 1.0 at 390x844 and 844x390 (see the sidecar). */
export const START_SHARE = 0.9;

/** How long a picture must stay most in view before it starts, so a
 *  scroll past does not start it. Swept over 150, 300 and 600 ms. */
export const SETTLE_MS = 300;

/** How long a picture holds its last frame before it plays again (about
 *  2 s; swept over 1.5, 2 and 3 s). */
export const HOLD_MS = 2000;

/** Shares this close count as equal, so a picture already moving keeps
 *  its place against one just as much in view. */
const TIE = 0.001;

type CardPhase = "still" | "playing" | "holding";

/** What a card shows: its last frame (`still`), its sequence running
 *  (`playing`, `run` counts the starts so a renderer can restart it), or its
 *  last frame between two runs (`holding`). `paused` freezes either moving
 *  phase where it is. */
export interface CardState {
  readonly phase: CardPhase;
  readonly paused: boolean;
  readonly run: number;
}

/** The clock and timers (the browser's in production, a manual one in the
 *  tests). */
export interface CardTimer {
  now(): number;
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface CardPlayOptions {
  /** How long each card's sequence runs, in ms; one per card. */
  readonly durationsMs: readonly number[];
  readonly reducedMotion: boolean;
  readonly timer: CardTimer;
  /** Called with a card's new state, only when it changed. */
  readonly render: (index: number, state: CardState) => void;
  readonly startShare?: number;
  readonly settleMs?: number;
  readonly holdMs?: number;
}

export interface CardPlay {
  /** How much of picture `index` is in view, 0 to 1, of as much of it as
   *  can be. Not a finite number reads as nothing in view. */
  seen(index: number, share: number): void;
  /** The reader's tap on the picture: pause, or resume. */
  tap(index: number): void;
  /** The picture's "Show again": restart it now, clearing its pause. */
  showAgain(index: number): void;
  /** Whether the film above is playing (no card moves by itself then). */
  setBlocked(blocked: boolean): void;
  state(index: number): CardState;
  /** Stop every timer; later calls do nothing. */
  destroy(): void;
}

const STILL: CardState = { phase: "still", paused: false, run: 0 };

export function createCardPlay(options: CardPlayOptions): CardPlay {
  const durations = [...options.durationsMs];
  if (
    durations.length === 0 ||
    !durations.every((d) => Number.isFinite(d) && d > 0)
  ) {
    throw new Error(
      "card-play: every card needs a positive, finite duration in ms",
    );
  }
  const { timer, render, reducedMotion } = options;
  const startShare = options.startShare ?? START_SHARE;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const holdMs = options.holdMs ?? HOLD_MS;
  const count = durations.length;

  const states: CardState[] = Array.from({ length: count }, () => STILL);
  const shares: number[] = Array.from({ length: count }, () => 0);
  /** What is left of a frozen card's phase, in ms. */
  const left: number[] = Array.from({ length: count }, () => 0);
  /** The one card whose timers run (playing or holding, not paused). */
  let active: number | null = null;
  /** A card started by "Show again", until its run ends. */
  let forced: number | null = null;
  let blocked = false;
  let destroyed = false;
  let phaseTimer: number | null = null;
  let phaseEndsAt = 0;
  let pending: { index: number; id: number } | null = null;

  const valid = (i: number): boolean =>
    Number.isInteger(i) && i >= 0 && i < count;

  function emit(i: number, next: CardState): void {
    const now = states[i] ?? STILL;
    if (
      now.phase === next.phase &&
      now.paused === next.paused &&
      now.run === next.run
    ) {
      return;
    }
    states[i] = next;
    render(i, next);
  }

  /** The eligible card most in view; on a tie the one already moving. */
  function leader(): number | null {
    let best: number | null = null;
    let bestShare = -1;
    shares.forEach((share, i) => {
      if (share < startShare - TIE) return;
      const tied = Math.abs(share - bestShare) <= TIE;
      if (best === null || share > bestShare + TIE || (tied && i === active)) {
        best = i;
        bestShare = share;
      }
    });
    return best;
  }

  /** The card that should be moving now by itself, or null. */
  function target(): number | null {
    if (blocked || reducedMotion) return null;
    const lead = leader();
    if (lead === null || (states[lead] ?? STILL).paused) return null;
    return lead;
  }

  function cancelPhase(): void {
    if (phaseTimer !== null) timer.clear(phaseTimer);
    phaseTimer = null;
  }

  function cancelPending(): void {
    if (pending !== null) timer.clear(pending.id);
    pending = null;
  }

  function schedulePhase(i: number, ms: number): void {
    cancelPhase();
    phaseEndsAt = timer.now() + ms;
    phaseTimer = timer.set(() => {
      phaseTimer = null;
      phaseEnded(i);
    }, ms);
  }

  function startRun(i: number): void {
    const now = states[i] ?? STILL;
    active = i;
    emit(i, { phase: "playing", paused: false, run: now.run + 1 });
    schedulePhase(i, durations[i] ?? 1);
  }

  /** The moving card back to its last frame. */
  function stopActive(): void {
    if (active === null) return;
    const i = active;
    cancelPhase();
    active = null;
    if (forced === i) forced = null;
    const now = states[i] ?? STILL;
    emit(i, { ...now, phase: "still" });
  }

  function phaseEnded(i: number): void {
    if (active !== i) return;
    const now = states[i] ?? STILL;
    if (now.phase === "holding") {
      startRun(i);
      return;
    }
    if (forced === i) {
      forced = null;
      if (target() !== i) {
        stopActive();
        reconsider();
        return;
      }
    }
    emit(i, { ...now, phase: "holding" });
    schedulePhase(i, holdMs);
  }

  function reconsider(): void {
    if (destroyed) return;
    if (forced !== null) {
      cancelPending();
      return;
    }
    const want = target();
    if (active !== null && active !== want) stopActive();
    if (want === null || want === active) {
      cancelPending();
      return;
    }
    if (pending?.index === want) return;
    cancelPending();
    pending = {
      index: want,
      id: timer.set(() => {
        pending = null;
        if (forced === null && active === null && target() === want) {
          startRun(want);
        } else {
          reconsider();
        }
      }, settleMs),
    };
  }

  function pause(i: number): void {
    const now = states[i] ?? STILL;
    if (active === i) {
      left[i] = Math.max(0, phaseEndsAt - timer.now());
      cancelPhase();
      active = null;
      if (forced === i) forced = null;
    }
    if (pending?.index === i) cancelPending();
    emit(i, { ...now, paused: true });
  }

  function resume(i: number): void {
    const now = states[i] ?? STILL;
    const frozen = now.phase !== "still";
    // `target()` skips a paused leader, and this one is still marked paused.
    const leads = !blocked && !reducedMotion && leader() === i;
    if (frozen && leads && active === null && forced === null) {
      cancelPending();
      active = i;
      emit(i, { ...now, paused: false });
      schedulePhase(i, left[i] ?? 0);
      return;
    }
    emit(i, { ...now, phase: "still", paused: false });
    reconsider();
  }

  return {
    seen(index, share) {
      if (destroyed || !valid(index)) return;
      shares[index] = clamp01(share);
      reconsider();
    },
    tap(index) {
      if (destroyed || !valid(index)) return;
      if ((states[index] ?? STILL).paused) resume(index);
      else pause(index);
      reconsider();
    },
    showAgain(index) {
      if (destroyed || !valid(index)) return;
      cancelPending();
      if (active !== null && active !== index) stopActive();
      cancelPhase();
      forced = index;
      startRun(index);
    },
    setBlocked(value) {
      if (destroyed) return;
      blocked = value;
      reconsider();
    },
    state(index) {
      return valid(index) ? (states[index] ?? STILL) : STILL;
    },
    destroy() {
      destroyed = true;
      cancelPhase();
      cancelPending();
    },
  };
}
