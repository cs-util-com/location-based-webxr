/**
 * Test-only: a clock and timers a test advances by hand, in the shape the
 * landing's controllers take (`CardTimer`). Due callbacks run in time order,
 * each with the clock set to its own due time, so a callback that schedules
 * another inside the same advance sees the right "now".
 */
import type { CardTimer } from "../landing/card-play.js";

export interface ManualTimer extends CardTimer {
  /** Move the clock on by `ms`, running every callback that falls due. */
  advance(ms: number): void;
  /** How many callbacks are still scheduled. */
  pending(): number;
}

export function manualTimer(): ManualTimer {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    set(fn, ms) {
      const id = next++;
      due.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clear(id) {
      due.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let first: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of due) {
          if (entry[1].at > end) continue;
          if (first === undefined || entry[1].at < first[1].at) first = entry;
        }
        if (first === undefined) break;
        due.delete(first[0]);
        now = first[1].at;
        first[1].fn();
      }
      now = end;
    },
    pending: () => due.size,
  };
}
