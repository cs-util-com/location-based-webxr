/**
 * How well each operator has actually served THIS session, and the endpoint
 * weights that follow from it.
 *
 * WHY THIS EXISTS RATHER THAN BETTER CONSTANTS. `DEFAULT_OPERATOR_WEIGHTS` is
 * three numbers, and a measurement on 2026-09-21 put what the shipped ones cost
 * at mean 39.5 s and p90 67.0 s per tile against 22.3 s / 22.0 s for a
 * measured-ish alternative. Re-tuning them was rejected by the owner for a
 * reason the same measurement supplies: the pool moves. `maps.mail.ru` served
 * 3 of 3 whole tiles on 2026-09-20 and 1 of 5 on 2026-09-21. A constant tuned
 * to either day is wrong on the other, and no amount of measuring fixes that -
 * only a feedback loop does.
 *
 * **THIS IS NOT THE ADAPTIVE DEADLINE REJECTED ON 2026-09-20**, and the
 * distinction is worth stating because the two are one observation apart. A
 * deadline that adapts learns to be PATIENT with a slow host, which is exactly
 * backwards. A weight that adapts learns to AVOID it.
 *
 * THE SHAPE, and why it is this small. A feedback loop in the fetch path is the
 * kind of machinery whose failure modes outnumber its lines, so this is a
 * decayed success ratio per operator and nothing else - no scheduler, no
 * per-endpoint state, no clock. It multiplies the caller's base weights; it
 * does not replace them.
 *
 * FOUR PROPERTIES CARRY THE DESIGN, each of them a way a feedback loop breaks:
 *
 * - **It never reaches zero** ({@link DEFAULT_HEALTH_FLOOR}). A zero weight
 *   removes an endpoint from the draw, so a host that recovers is never tried
 *   and never gets the success that would restore it - a transient outage made
 *   permanent by the mechanism meant to route around it.
 * - **It is inert while everything works.** The ratio is 1 for an operator that
 *   keeps succeeding, so a healthy pool is drawn exactly as the base weights
 *   say. Measured against a synthetic all-healthy pool, every parameter setting
 *   swept gave the static weights' own figure to the tenth of a second - which
 *   is the property that makes reacting fast safe. It was originally stated the
 *   other way round, as "one observation moves it only a little", and the sweep
 *   falsified that; see the prior's own note.
 * - **It forgets.** Counts decay, so an operator that recovered stops being
 *   punished. Without that, a host demoted in the first minute carries it for
 *   the session - the same staleness a static weight already has.
 * - **It ignores our own faults.** A 400 is a malformed query, and demoting the
 *   operator that reported it honestly would walk the pool one endpoint at a
 *   time while the query stayed broken.
 *
 * @see operator-health.ts.md
 */

import type { OperatorWeights } from "./endpoint-order.js";

/**
 * What an attempt is evidence of.
 *
 * `"ours"` is not a third grade of badness - it is NOT EVIDENCE, and is dropped
 * rather than counted. A malformed query says nothing about the host that
 * rejected it.
 */
export type OperatorOutcome = "success" | "failure" | "ours";

/**
 * The smallest share of its base weight an operator can fall to.
 *
 * **A floor, not a tuning knob.** Its job is only to keep an endpoint
 * reachable: at 10% of base, a demoted operator still comes up often enough
 * that one success starts its recovery, while a healthy sibling is drawn ten
 * times as often. Any value in roughly 0.02-0.25 gives the same behaviour -
 * below that the recovery path gets thin, above it the demotion stops biting.
 */
export const DEFAULT_HEALTH_FLOOR = 0.1;

/**
 * How much weight the past keeps when a new observation arrives.
 *
 * 0.9 gives a half-life of about seven observations, so a host is judged on
 * roughly its last dozen attempts. Slower, and it cannot track a pool that
 * moves within a session; faster, and it is chasing noise.
 */
const DECAY = 0.9;

/**
 * The prior, in observations. Both counts start here, so an unobserved operator
 * reads as exactly its base weight and one observation moves the ratio part of
 * the way rather than all of it.
 *
 * **DERIVED, NOT PICKED.** The prior is what stops a single 504 rewriting the
 * pool, so the temptation is to make it large - and a large one silently
 * defeats the whole mechanism. `DECAY` saturates the attempt count at
 * `1 / (1 - DECAY)` = 10, so an operator that has failed forever still reads
 * `PRIOR / (10 + PRIOR)`. For the demotion to be able to invert the shipped
 * 4:1 base spread - a failing FOSSGIS must be able to fall below a succeeding
 * `private.coffee` - that floor has to be under 1/4, which needs
 * `PRIOR < 10 / 3`. The first version used 4, and its own test caught it:
 * a fully-failed operator at weight 4 still outranked a fully-succeeded one at
 * weight 1.
 *
 * **1, CHOSEN BY SWEEP RATHER THAN BY TASTE.** Resampling the measured
 * 2026-09-21 per-host outcomes into 30-tile sessions, mean time per tile:
 * shipped static 39.5 s, prior 3 33.9-34.8 s, prior 2 32.8-33.9 s, **prior 1
 * 30.4-30.7 s**. And against the counter-scenario that resampled day cannot
 * show - a pool where every host is healthy - every prior and every decay gave
 * 17.9 s, exactly the static weights' own figure. So a fast-reacting prior
 * costs nothing when nothing is broken and saves the most when something is.
 *
 * The intuition this replaced was that a small prior would "chase noise". The
 * measurement says it does not, and the intuition had been written into a test
 * before it was checked.
 *
 * One failure takes an operator to half its weight, which sounds drastic and is
 * not: the floor keeps it reachable, and one success takes most of it back.
 */
const PRIOR_ATTEMPTS = 1;
const PRIOR_SUCCESSES = 1;

/**
 * Decayed evidence about one operator.
 *
 * NOT exported: nothing outside this module names it, and the root `knip`
 * stage rejects an export with no importer - which it did, on this very type,
 * at the publish preflight. A consumer that wants it has `snapshot()`'s return
 * type, structurally.
 */
interface OperatorTally {
  readonly attempts: number;
  readonly successes: number;
}

export interface OperatorHealth {
  /** Records one attempt's outcome. `"ours"` is dropped, not counted. */
  record(operator: string, outcome: OperatorOutcome): void;
  /**
   * The caller's base weights, scaled by observed health.
   *
   * An operator with no observations comes back EXACTLY as given - identity,
   * not a rounded approximation of it - so a fresh session behaves precisely as
   * the constants say.
   */
  weightsFrom(base: OperatorWeights): OperatorWeights;
  /** What has been observed, for diagnostics. */
  snapshot(): Readonly<Record<string, OperatorTally>>;
}

/** A tracker with no state of its own. */
export function createOperatorHealth(): OperatorHealth {
  const tallies = new Map<string, { attempts: number; successes: number }>();

  return {
    record(operator: string, outcome: OperatorOutcome): void {
      if (outcome === "ours") return;
      const held = tallies.get(operator) ?? { attempts: 0, successes: 0 };
      const next = {
        attempts: held.attempts * DECAY + 1,
        successes: held.successes * DECAY + (outcome === "success" ? 1 : 0),
      };
      tallies.set(operator, next);
    },

    weightsFrom(base: OperatorWeights): OperatorWeights {
      const scaled: Record<string, number> = {};
      for (const [operator, weight] of Object.entries(base)) {
        const tally = tallies.get(operator);
        // UNOBSERVED IS NOT UNHEALTHY. Returning the base value itself rather
        // than `weight * 1` keeps `weightsFrom(base)` deep-equal to `base` on a
        // fresh tracker, which is what makes "a new session behaves exactly as
        // the constants say" testable rather than approximate.
        if (tally === undefined) {
          scaled[operator] = weight;
          continue;
        }
        const ratio =
          (tally.successes + PRIOR_SUCCESSES) /
          (tally.attempts + PRIOR_ATTEMPTS);
        scaled[operator] = weight * Math.max(DEFAULT_HEALTH_FLOOR, ratio);
      }
      return scaled;
    },

    snapshot(): Readonly<Record<string, OperatorTally>> {
      return Object.fromEntries(
        [...tallies].map(([operator, tally]) => [operator, { ...tally }]),
      );
    },
  };
}
