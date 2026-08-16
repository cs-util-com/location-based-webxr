/**
 * What an affordance score costs a route (DEC-R13-1, DEC-R13-11 … DEC-R13-13).
 *
 * WHY THIS IS ITS OWN MODULE. The ninth testing session asked for "a mixture of
 * optimal direct distance and orienting on the tiles with the highest weights",
 * and the ratio between those two IS the behaviour — it is the difference
 * between an NPC that cuts across the grass and one that follows the park paths.
 * A number that decides a behaviour users describe in words deserves a file, a
 * name, and tests, not a literal inside a cost function.
 *
 * THREE DECISIONS LIVE HERE, and each was taken against a plausible alternative:
 *
 * - **which category** (DEC-R13-11). `CellScore.scores` is keyed by category and
 *   the demo OPENS on `battleArea` (DEC-G3 — the geo-event is the headline
 *   feature and "a geo-event for walkable?" read as nonsense). A planner reading
 *   the selected category would therefore route the shipped default by
 *   battle-area suitability. This module names `walkable` and ignores the UI.
 * - **what an unscored cell costs** (DEC-R13-12, amending DEC-R13-2). Not 1.
 *   One is also the admissibility floor, so "unscored costs 1" would make
 *   unknown ground at least as cheap as the best mapped path and strictly
 *   cheaper than ordinary grass — giving A\* a standing incentive to route
 *   AROUND the ~250 m scored disk, the inverse of what was asked for. An
 *   unscored cell is the score IDENTITY instead, which is the same `?? 1` the
 *   heat scale already applies to a cell with no entry in a category.
 * - **what the log is measured against** (DEC-R13-13). Fixed constants, NOT a
 *   maximum derived from whatever is currently scored. Such a maximum moves on
 *   every pan, and a moving baseline means the same click gives a different
 *   route after the working set grows — a flake generator for the corpus test
 *   and an irreproducible user bug report, in the same round that adds
 *   camera-target URLs so a finding can be pointed at.
 *
 *   **THE COLOURS HAVE SINCE FOLLOWED THIS FILE (DEC-H5).** The snapshot's
 *   derived `heatMax` is gone; `heat-colours.ts` now anchors on a fixed
 *   `HEAT_CAP` for exactly the reason recorded here, one round later and about
 *   pixels instead of paths. Note the two anchors are **not** the same number —
 *   `PATH_SCORE` is 5 000 and `HEAT_CAP` is 1e4 — and they answer different
 *   questions: one is "what does a good path cost", the other "where does the
 *   ramp top out". Neither is derived from the other, and a future round that
 *   wants them unified has to argue it rather than assume it.
 *
 * @see route-penalty.ts.md
 */

/**
 * The affordance category the planner routes on.
 *
 * NOT the selected one — see the header. Named here rather than imported from a
 * rule table because the table is loaded at runtime and may not contain it; the
 * absence is handled as a value, not as an error.
 */
export const WALKABLE_CATEGORY = "walkable";

/**
 * The score of a cell nothing has anything to say about.
 *
 * ONE, and it is not an arbitrary pick: the scorer multiplies contributions, so
 * 1 is the identity — and `demo-pipeline.ts` already spells the same convention
 * as `cell.scores[category] ?? 1` when it builds the heat scale. An unscored
 * cell and a scored-but-unremarkable cell therefore price identically, which is
 * what stops the edge of the scored disk becoming a feature of the route.
 */
export const NEUTRAL_SCORE = 1;

/**
 * The score at which a cell is as cheap as a cell can be.
 *
 * FIVE THOUSAND, from the session's own reading of the data: the Central Park
 * footways score in the thousands ("was weiß ich, hier 5.000 in New York im
 * Central Park, da wo eben die Wege langgehen"). Anything above it clamps, so
 * the 24 000s are not preferred over the 5 000s — past "this is definitely a
 * path" there is nothing left to buy, and letting the top of the range keep
 * pulling would make the NPC seek out one particular kind of way over every
 * other perfectly good one.
 */
export const PATH_SCORE = 5_000;

/**
 * THE TUNABLE. How much dearer neutral ground is than a mapped path.
 *
 * Read it as a detour budget: at 2, the planner will walk up to twice as far to
 * stay on paths before cutting across open ground, and no further. Turning it up
 * makes the NPC hug the footways; turning it down towards 1 makes it walk
 * straight lines again, which is precisely the "he does not prefer the paths"
 * complaint this round answers.
 *
 * **IT IS ALSO THE EXPANSION DIAL, and that is the non-obvious half.** The A\*
 * heuristic is unpenalised metres while edges cost metres × penalty, so the
 * larger this is the looser the guidance and the more the search behaves like
 * Dijkstra. `agent-route.test.ts` pins the expansion cost at the shipped value;
 * raising it means re-checking that test, not just watching the demo.
 */
export const PATH_PREFERENCE = 2;

/**
 * The most any cell can cost, as a multiple of its metres.
 *
 * The clamp for scores BELOW neutral — a cell something has actively said is bad
 * to walk on (the session's 0.2). It exists because the log curve has no bottom:
 * without it a score approaching zero costs unboundedly much, which stops being
 * a preference and becomes an obstacle, and obstacles are `crossesObstacle`'s
 * job alone in this demo.
 */
export const MAX_PENALTY = 3;

/** `ln(PATH_SCORE)`, the span the curve normalises against. Hoisted, not magic. */
const LN_PATH_SCORE = Math.log(PATH_SCORE);

/**
 * The multiplier a cell's metres are charged at, from its walkable score.
 *
 * `undefined` means the cell is unscored — outside the ~250 m scoring disk, or
 * inside a rule table with no `walkable` column — and prices as neutral ground.
 *
 * **ALWAYS BETWEEN 1 AND {@link MAX_PENALTY}, for every input including `NaN`,
 * negative and unbounded ones.** The score is external data, and the A\*
 * heuristic stays a lower bound only while this cannot dip below 1.
 *
 * Log-linear between the two anchors, because the scores span five orders of
 * magnitude (0.2 … 24 000 in the session's own examples) and a linear map would
 * put every ordinary cell in the same bucket:
 *
 * ```
 * penalty(NEUTRAL_SCORE) = PATH_PREFERENCE     // ln 1 = 0
 * penalty(PATH_SCORE)    = 1
 * ```
 */
/**
 * What non-path ground costs relative to a path, on top of its score penalty
 * (DEC-R2).
 *
 * **A SURCHARGE OFF PATHS, NOT A DISCOUNT ON THEM, and that is forced rather
 * than chosen.** `agent-route.ts`'s heuristic is unpenalised straight-line
 * metres, which is a lower bound only while every edge costs at least its own
 * metres. Any factor below 1 would destroy that and make A* return
 * non-optimal routes that still look plausible — the worst kind of wrong,
 * because nothing reports it.
 *
 * 1.5 is a starting value, not a measurement: it makes an off-path detour worth
 * taking only when the path costs more than half as much again in distance.
 * The owner asked for "stay on the paths unless it is a big detour"; this is the
 * knob that means it, and it is expected to want tuning by eye.
 */
export const NON_PATH_PENALTY = 1.5;

/**
 * @param onPath - whether the cell carries a pedestrian way, or `undefined`
 *   where nothing is known.
 *
 * **Unknown counts as OFF path**, deliberately. Outside the scored disk nothing
 * is known, so every cell takes the same surcharge — a uniform multiplier, which
 * cannot change which route is cheapest. The alternative would price unmapped
 * ground as though it were a path, making it preferable to mapped ground: the
 * inverse of the intent, and the same trap DEC-R13-12 already records for the
 * score itself.
 */
export function pathFactor(onPath: boolean | undefined): number {
  return onPath === true ? 1 : NON_PATH_PENALTY;
}

export function penaltyFor(score: number | undefined): number {
  // NON-FINITE IS UNKNOWN, NOT TERRIBLE. `NaN` here means the score pipeline
  // produced something uninterpretable; bending routes around a data fault
  // would be a confidently wrong answer where "nothing is known about this
  // cell" is the honest one.
  if (score === undefined || !Number.isFinite(score)) {
    return penaltyAtLog(0);
  }
  // At or below zero the logarithm has nothing to say — and a cell scored zero
  // is the worst a cell can be, so it takes the ceiling directly rather than
  // through `log(0) = -Infinity`.
  if (score <= 0) return MAX_PENALTY;
  return penaltyAtLog(Math.log(score));
}

/** The curve itself, given `ln(score)`, clamped at both ends. */
function penaltyAtLog(lnScore: number): number {
  const raw =
    PATH_PREFERENCE + (1 - PATH_PREFERENCE) * (lnScore / LN_PATH_SCORE);
  return Math.min(MAX_PENALTY, Math.max(1, raw));
}

/**
 * The walkable score out of a cell's per-category scores, if there is one.
 *
 * Takes the score record rather than a `CellScore` so the worker can hand over
 * exactly what it has, and so this stays testable without constructing one.
 * `undefined` for a missing record and for a table with no `walkable` column
 * alike — both mean the same thing to {@link penaltyFor}, and a rule table
 * without the column is an already-shipping case rather than a hypothetical.
 */
export function walkableScoreOf(
  scores: Readonly<Record<string, number>> | undefined,
): number | undefined {
  return scores?.[WALKABLE_CATEGORY];
}
