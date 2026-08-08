/**
 * The route cost's score penalty (DEC-R13-1, DEC-R13-11, DEC-R13-12,
 * DEC-R13-13).
 *
 * Why these tests matter:
 * This is the only place in the round where a number decides a behaviour the
 * user will describe in words ("he follows the paths", "he goes straight"). The
 * four things worth pinning are the four the decisions argued about, and each
 * has a way of going quietly wrong:
 *
 * - **the floor** — a penalty below 1 makes the A\* heuristic inadmissible and
 *   the routes stop being optimal, silently;
 * - **the neutral value** — an unscored cell must not be the CHEAPEST cell, or
 *   the planner gains a standing incentive to route around the scored disk
 *   rather than through it (DEC-R13-12 amending DEC-R13-2);
 * - **the direction** — a higher score must never cost more, which is the whole
 *   of what "prefer the walkable tiles" means;
 * - **the reference scale** — fixed constants, so the same click gives the same
 *   route after a pan (DEC-R13-13). A test cannot see that directly; what it can
 *   see is that nothing in the signature could carry a moving baseline.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  MAX_PENALTY,
  NEUTRAL_SCORE,
  PATH_PREFERENCE,
  PATH_SCORE,
  WALKABLE_CATEGORY,
  penaltyFor,
  walkableScoreOf,
} from "./route-penalty.js";

describe("penaltyFor", () => {
  /**
   * ADMISSIBILITY, WHICH IS NOT A STYLE POINT. `findCheapestPath` settles a
   * state on pop, so a heuristic that can overestimate returns a route that is
   * merely plausible. The heuristic is unpenalised metres, so it stays a lower
   * bound exactly as long as this never dips below 1.
   */
  it("never falls below 1, for any input at all", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ noDefaultInfinity: false, noNaN: false }),
          fc.constantFrom(
            undefined,
            0,
            -0,
            -1,
            1e-12,
            1e12,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
          ),
        ),
        (score) => {
          const penalty = penaltyFor(score);
          expect(penalty).toBeGreaterThanOrEqual(1);
          expect(penalty).toBeLessThanOrEqual(MAX_PENALTY);
          expect(Number.isFinite(penalty)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * DEC-R13-12, AND THE REASON IT AMENDS DEC-R13-2. "Unscored costs 1" would
   * make unknown ground at least as cheap as the best mapped path and strictly
   * cheaper than ordinary grass, so A\* would route AROUND the ~250 m scored
   * disk. An unscored cell is the score identity instead — the same `?? 1` the
   * heat scale already uses for a cell with no entry in a category.
   */
  it("prices an unscored cell as neutral ground, not as the floor", () => {
    expect(penaltyFor(undefined)).toBe(penaltyFor(NEUTRAL_SCORE));
    expect(penaltyFor(undefined)).toBeGreaterThan(1);
    expect(penaltyFor(undefined)).toBe(PATH_PREFERENCE);
  });

  /**
   * The tunable, stated as the ratio it actually controls: how much longer a
   * route along paths may be before walking straight across neutral ground wins.
   */
  it("makes neutral ground exactly PATH_PREFERENCE times a mapped path", () => {
    expect(penaltyFor(PATH_SCORE)).toBe(1);
    expect(penaltyFor(NEUTRAL_SCORE) / penaltyFor(PATH_SCORE)).toBe(
      PATH_PREFERENCE,
    );
  });

  it("clamps at 1 above the path score, so 24 000 is not cheaper than 5 000", () => {
    expect(penaltyFor(PATH_SCORE * 10)).toBe(1);
    expect(penaltyFor(24_000)).toBe(1);
  });

  /**
   * MONOTONE, WHICH IS THE WHOLE ASK IN ONE WORD. "He should prefer the tiles
   * that are more walkable" is exactly "a higher score never costs more", and a
   * curve that folded back anywhere would produce an NPC that avoids the very
   * best paths.
   */
  it("never charges more for a better score", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1e6, noNaN: true }),
        fc.double({ min: 0.001, max: 1e6, noNaN: true }),
        (a, b) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          expect(penaltyFor(high)).toBeLessThanOrEqual(penaltyFor(low));
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * THE SESSION'S OWN NUMBERS (R13-1): "a walkable score of 0.2 is far less
   * likely to be walkable than one of 270, or even one of 24 000". Whatever the
   * curve, that ordering is the reported requirement.
   */
  it("orders the session's own examples", () => {
    expect(penaltyFor(0.2)).toBeGreaterThan(penaltyFor(2));
    expect(penaltyFor(2)).toBeGreaterThan(penaltyFor(270));
    expect(penaltyFor(270)).toBeGreaterThan(penaltyFor(5_000));
  });

  /**
   * A cell explicitly scored as impassable-ish is the most expensive there is,
   * rather than being read through `log(0) = -Infinity`.
   */
  it("prices a zero or negative score at the ceiling", () => {
    expect(penaltyFor(0)).toBe(MAX_PENALTY);
    expect(penaltyFor(-5)).toBe(MAX_PENALTY);
  });

  /**
   * NON-FINITE IS UNKNOWN, NOT TERRIBLE. `NaN` reaching here means the score
   * pipeline produced something the planner cannot interpret; treating that as
   * "avoid at all costs" would bend routes around a data fault, which is a
   * confidently wrong answer where "I know nothing about this cell" is the
   * honest one.
   */
  it("treats a non-finite score as unscored", () => {
    expect(penaltyFor(Number.NaN)).toBe(penaltyFor(undefined));
    expect(penaltyFor(Number.POSITIVE_INFINITY)).toBe(penaltyFor(undefined));
  });
});

describe("walkableScoreOf", () => {
  /**
   * DEC-R13-11, AND WHY IT IS NOT A NUANCE. `CellScore.scores` is keyed by
   * category and the demo OPENS on `battleArea` (DEC-G3, because the geo-event
   * is the headline feature). A planner reading the selected category would
   * route the shipped default by battle-area suitability while the whole session
   * talked about walkability.
   */
  it("reads walkable, whatever else the cell scores", () => {
    expect(walkableScoreOf({ battleArea: 900, [WALKABLE_CATEGORY]: 42 })).toBe(
      42,
    );
  });

  it("is undefined when the table has no walkable column", () => {
    expect(walkableScoreOf({ battleArea: 900 })).toBeUndefined();
    expect(walkableScoreOf(undefined)).toBeUndefined();
  });

  /**
   * A rule table without the column is an already-shipping case
   * (`data-and-caching.spec.js` boots one), so this path must degrade to a flat
   * penalty rather than throw — and a flat penalty everywhere is plain distance,
   * since a uniform multiplier cannot change which route is cheapest.
   */
  it("degrades to the neutral penalty rather than throwing", () => {
    expect(penaltyFor(walkableScoreOf({ battleArea: 900 }))).toBe(
      PATH_PREFERENCE,
    );
  });
});
