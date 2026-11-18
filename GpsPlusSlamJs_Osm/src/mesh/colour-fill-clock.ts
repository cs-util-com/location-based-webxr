/**
 * A measurement instrument for the time-of-day blend spike: the time
 * `buildCity` spends choosing and writing colours, summed across calls, so a
 * caller can set it against the whole build. Throwaway; it lives on a spike
 * branch only.
 *
 * @see colour-fill-clock.ts.md
 */

/** The summed colouring time, milliseconds; a caller zeroes `ms` before a build. */
export const colourFillClock = { ms: 0 };

/** Runs `work` and adds its wall time to {@link colourFillClock}. */
export function timedColourFill<T>(work: () => T): T {
  const start = performance.now();
  try {
    return work();
  } finally {
    colourFillClock.ms += performance.now() - start;
  }
}
