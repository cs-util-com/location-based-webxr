/**
 * The column model: an agent's state is `(cell, heightM)`, not a cell.
 *
 * H3 cells are 2D, and the navigation design states the consequence bluntly:
 * **an agent on top of the Tower wall and an agent at its foot occupy the same
 * H3 cell**. A reachability pass built on cells alone therefore cannot tell the
 * two apart, and merging it with 3D geometry naively lets them path to each
 * other — straight through 8 m of masonry.
 *
 * So cells are treated as COLUMNS. Two states are adjacent when their cells are
 * neighbours under the same `gridDisk(cell, 1)` that `connectedComponents`
 * already uses, AND the height between them is a climbable step. That second
 * clause is the whole point: it is what forces a path around a wall rather than
 * over it, and it applies within a single cell as much as between two.
 *
 * This module is deliberately pure and graph-free. The design calls the column
 * model its highest-risk assumption and says to test it before anything is
 * built on it, which only means something if the thing under test has no graph,
 * no geometry and no rendering wrapped around it.
 *
 * @see column.ts.md
 */

import { gridDisk, getResolution, getHexagonEdgeLengthAvg, UNITS } from "h3-js";

/**
 * A navigable state: a cell, and the height at which the agent stands in it.
 *
 * `heightM` is metres in whatever vertical datum the caller's height source
 * uses. Only DIFFERENCES matter here, so the datum never has to be pinned down
 * — but it does have to be consistent between the two states being compared.
 */
export interface Column {
  readonly cell: string;
  readonly heightM: number;
  /**
   * The walking surface of this cell, in the same datum as {@link heightM}.
   *
   * **Optional, and its absence is a real mode rather than an oversight.** With
   * it, `heightM - groundM` is how far the agent stands ABOVE the ground — a
   * wall top, a bridge deck — and {@link columnsAdjacent} can price a
   * discontinuity separately from a hillside. Without it there is no way to
   * tell the two apart and the predicate keeps the single absolute rule it has
   * always had, which is exactly what a caller with no height source wants.
   *
   * **It is not part of a state's identity.** The ground is a property of the
   * cell, so two states in one cell cannot disagree about it, and `columnKey`
   * deliberately does not include it.
   */
  readonly groundM?: number;
}

/**
 * The default height change an agent can step up or down, in metres.
 *
 * **This is a provisional value and the design leaves it open (Q1).** The
 * anchors that bound it: a kerb is ~0.15 m and a stair riser ~0.18 m, so a
 * threshold below those makes ordinary steps impassable; a curtain wall is
 * metres, so anything under ~1 m severs it. 0.5 m sits clear of both, admitting
 * stairs and kerbs while rejecting walls, terraces and retaining edges.
 *
 * It is a DEFAULT rather than a law — {@link columnsAdjacent} takes an override
 * so that tuning it does not mean forking the predicate.
 */
export const STEP_THRESHOLD_M = 0.5;

/**
 * The steepest GROUND an agent will walk, as rise over run.
 *
 * **This exists because {@link STEP_THRESHOLD_M} was doing two incompatible
 * jobs.** The threshold is calibrated against discontinuities — kerbs, risers,
 * walls — but in production the heights compared are DEM samples at cell
 * centres ~6.4–6.9 m apart, so as a single absolute limit it declared any
 * continuous ground steeper than **~7.5 %** unwalkable. The demo reported the
 * Cologne Frankenwerft promenade as unreachable in every downhill direction
 * while the `walkable` heat map rated it highly, and that is the whole defect:
 * a hillside is not a wall.
 *
 * 0.5 — 1 in 2, ~26.6° — is DEC-S2, and it is the value the evidence picks
 * rather than a defensible guess. Measured at Terrarium z13 as the share of
 * res-13 neighbour steps this refuses:
 *
 * - **0.3 would be actively harmful** — it refuses 16.8 % of steps around the
 *   Heidelberg castle hill, ordinary walkable hillside, which is this defect
 *   returning in a milder form.
 * - **1.0 would be meaningfully less protective** — it admits 9.5 % of the
 *   Cliffs of Moher's steps and 3.7 % of Victoria Peak's that 0.5 refuses.
 * - **0.5 sits in the gap**: 0.2–1.5 % of city steps (0.21 % at the reported
 *   Cologne location), against 18–26 % on genuine cliffs, where a single step
 *   drops as much as 45 m.
 *
 * ⚠️ **It cannot tell a 26° hillside from a 2 m retaining wall smeared across
 * one cell**, and nothing at this resolution can: both are the same rise over
 * the same run. Mapped barriers are what refuse those, through
 * `crossesObstacle`; an UNMAPPED retaining wall under the limit stays walkable.
 *
 * @see ../../docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md
 */
export const MAX_GROUND_GRADIENT = 0.5;

/** What an agent can climb, and how steep it will walk. */
export interface StepLimits {
  /** Climbable discontinuity, metres. Defaults to {@link STEP_THRESHOLD_M}. */
  readonly stepThresholdM?: number;
  /** Steepest walkable ground. Defaults to {@link MAX_GROUND_GRADIENT}. */
  readonly maxGroundGradient?: number;
}

/** Memoised per resolution; there are sixteen of them and they never change. */
const SPACING_BY_RESOLUTION: number[] = [];

/**
 * The run a grade is measured over: the distance between two neighbouring cell
 * centres at `resolution`, in metres.
 *
 * **The resolution's AVERAGE spacing, not the exact distance between the two
 * cells in hand**, and that is a deliberate approximation on two grounds:
 *
 * - `columnsAdjacent` is the search's hottest arithmetic path — `columnSpace`
 *   calls it before the geometry test precisely because it is cheap — and an
 *   exact answer costs two `cellToLatLng` calls and a haversine per candidate.
 * - **The error is bounded and small.** At res 13 this yields 7.088 m; real
 *   neighbour centres are 5.18–7.82 m apart over a 24 000-pair global sample,
 *   so the model is off by at most −27 %/+10 %. Where the real run is LONGER
 *   than the model the rule errs strict — which is **64 % of pairs globally**,
 *   so that is the normal case, not the exception. The worst of it costs
 *   `0.5 × 7.088/7.818 = 0.453` of effective gradient instead of 0.5, still far
 *   above any street.
 *
 *   ⚠️ **This bullet claimed the error "errs permissive" until PR review
 *   2026-08-18, and that was false.** It generalised a measurement taken at one
 *   latitude — 6.34–6.91 m at Cologne, where the model does happen to be
 *   permissive — to the globe. Corrected in place rather than deleted, because
 *   the wrong version was an argument that the approximation is SAFE, and a
 *   reader is entitled to know it was checked properly.
 *
 * A regular hexagon of edge `a` has adjacent centres `a√3` apart; H3 cells are
 * near-regular, which is what the measured spread above bounds.
 */
export function neighbourSpacingM(resolution: number): number {
  const cached = SPACING_BY_RESOLUTION[resolution];
  if (cached !== undefined) return cached;
  const spacing = getHexagonEdgeLengthAvg(resolution, UNITS.m) * Math.sqrt(3);
  SPACING_BY_RESOLUTION[resolution] = spacing;
  return spacing;
}

/**
 * Both limits, defaulted and checked.
 *
 * SPLIT OUT SO THE PREDICATE STAYS READABLE — validating two limits inline put
 * `columnsAdjacent` over the complexity budget, and the argument checks are not
 * the part of it anyone comes here to read.
 */
function resolveLimits(limits: StepLimits): Required<StepLimits> {
  const stepThresholdM = limits.stepThresholdM ?? STEP_THRESHOLD_M;
  const maxGroundGradient = limits.maxGroundGradient ?? MAX_GROUND_GRADIENT;
  if (!Number.isFinite(stepThresholdM) || stepThresholdM < 0) {
    throw new RangeError(
      `columnsAdjacent: step threshold must be a finite, non-negative number, got ${stepThresholdM}`,
    );
  }
  if (!Number.isFinite(maxGroundGradient) || maxGroundGradient < 0) {
    throw new RangeError(
      `columnsAdjacent: ground gradient must be a finite, non-negative number, got ${maxGroundGradient}`,
    );
  }
  return { stepThresholdM, maxGroundGradient };
}

/**
 * The resolution the two cells share.
 *
 * MIXED RESOLUTIONS ARE A CALLER BUG, NOT A "NO ROUTE" ANSWER. `gridDisk` on a
 * res-13 origin never returns a res-8 cell, so a mixed pair would come back
 * non-adjacent and read as "there is no way across" — the one answer that looks
 * entirely plausible and is entirely wrong.
 */
function sharedResolution(cellA: string, cellB: string): number {
  const resolutionA = getResolution(cellA);
  const resolutionB = getResolution(cellB);
  if (resolutionA !== resolutionB) {
    throw new RangeError(
      `columnsAdjacent: cells must share a resolution, got ${resolutionA} and ${resolutionB}`,
    );
  }
  return resolutionA;
}

/**
 * Whether an agent can move directly between two states.
 *
 * Reflexive (a state is adjacent to itself) because `gridDisk(cell, 1)`
 * includes its own origin and this rule is defined in terms of that same
 * neighbourhood. Graph construction, not the predicate, is where self-edges get
 * skipped.
 *
 * Symmetric, and deliberately so: an agent that could descend a drop it could
 * not climb would need a directed graph, and the design does not ask for one.
 * A one-way drop is a separate feature, not an accident of this comparison.
 *
 * **TWO LIMITS, BECAUSE THERE ARE TWO QUESTIONS.** When both states carry a
 * {@link Column.groundM} the comparison decomposes:
 *
 * - the height ABOVE the ground is a **step** — a kerb, a riser, a wall — and
 *   is bounded by `stepThresholdM`, at any distance including zero;
 * - the ground itself is a **slope**, and is bounded by `maxGroundGradient`
 *   times the run between the two cell centres.
 *
 * Without a ground on both states neither question can be told from the other,
 * and the single absolute rule this module shipped with applies unchanged.
 *
 * @param limits the climbable step and the walkable grade; each defaults to its
 *   constant above, and each must be finite and non-negative.
 * @throws if either limit is not a finite non-negative number, or if the two
 *   cells are at different H3 resolutions.
 */
export function columnsAdjacent(
  a: Column,
  b: Column,
  limits: StepLimits = {},
): boolean {
  const { stepThresholdM, maxGroundGradient } = resolveLimits(limits);
  const resolution = sharedResolution(a.cell, b.cell);

  // A HEIGHT WE DO NOT KNOW IS NOT A HEIGHT WE CAN STEP TO. The DEM lookup
  // misses by returning NaN rather than throwing, and every comparison against
  // NaN is false — so `Math.abs(NaN) > threshold` would be false and the step
  // would be declared walkable. Refusing outright fails towards "no route",
  // which a caller can see, instead of inventing connectivity it cannot.
  if (!Number.isFinite(a.heightM) || !Number.isFinite(b.heightM)) return false;

  if (!climbable(a, b, stepThresholdM, maxGroundGradient, resolution)) {
    return false;
  }

  // THE EXPENSIVE HALF, AND IT IS LAST FOR THAT REASON. Measured at ~2.26 µs of
  // a ~2.66 µs call — `gridDisk` allocates seven H3 index strings — against 4 ns
  // for the arithmetic above. A caller that already knows the two cells are
  // neighbours should use {@link columnsClimbable} and skip it entirely.
  return a.cell === b.cell || gridDisk(a.cell, 1).includes(b.cell);
}

/**
 * The height half of {@link columnsAdjacent}, without the neighbourhood test.
 *
 * **For a caller that GENERATED the second state as a neighbour of the first**,
 * and it is unsound for any other. `columnSpace` is that caller: every candidate
 * it produces comes out of `gridDisk(state.cell, 1)`, and `search.ts` only ever
 * asks `canEnter(from, to)` about a `to` that came from `candidates(from)` — so
 * the full predicate spends ~85 % of its time re-deriving something already
 * established by construction. Removing it is worth **23 %** of a real route on
 * the reported Cologne data (268 → 206 ms, interleaved A/B, identical results),
 * and the saving lands on the reply the demo most wants quick: a refusal, which
 * must exhaust the frontier.
 *
 * ⚠️ **This says NOTHING about where the cells are.** Two states on opposite
 * sides of a city at the same height are "climbable". Pinned by a test, because
 * the failure it invites — an agent stepping across the map — looks like a
 * pathfinder bug rather than a misused predicate.
 *
 * Both guards are kept: the limits are validated and mixed resolutions throw, so
 * the cheap path cannot turn a caller bug into a plausible "no route".
 *
 * @see ../../docs/2026-08-18-0745-column-adjacency-griddisk-cost-followup.md
 */
export function columnsClimbable(
  a: Column,
  b: Column,
  limits: StepLimits = {},
): boolean {
  const { stepThresholdM, maxGroundGradient } = resolveLimits(limits);
  const resolution = sharedResolution(a.cell, b.cell);

  if (!Number.isFinite(a.heightM) || !Number.isFinite(b.heightM)) return false;
  return climbable(a, b, stepThresholdM, maxGroundGradient, resolution);
}

/**
 * The height half of adjacency: whether the vertical change between two states
 * is one an agent can negotiate.
 *
 * **A UNION OF TWO READINGS, EITHER OF WHICH ADMITS THE STEP.** They answer the
 * same question about different pairs of surfaces, and neither subsumes the
 * other:
 *
 *  1. **As a step between two surfaces** — the absolute height change, against
 *     `stepThresholdM`. This is the rule the module shipped with, and it is
 *     what lets an agent walk off a wall top onto a terrace at the same height:
 *     it moves horizontally, whatever the ground far below either surface does.
 *  2. **As a walk along one continuous surface** — the GROUND change against a
 *     grade, and the height ABOVE that ground against `stepThresholdM`. This is
 *     the reading the module lacked, and its absence is what made every
 *     hillside a wall.
 *
 * **Clause 1 is the old rule verbatim, so this can only ADD edges** — asserted
 * as a property, because "we only relaxed it" is exactly the kind of claim that
 * quietly stops being true.
 *
 * ⚠️ **That is a statement about this PREDICATE, not about a planner built on
 * it** (PR review, 2026-08-18). More edges mean more states below the goal's
 * cost, so a bounded search can reach its expansion cap sooner than it did — and
 * `planRouteWithIndex` reports a cap as `undefined`, which is indistinguishable
 * from "no route". Measured over 1 200 routes on the six-site corpus: no route
 * that existed before was lost. Bounded, not impossible.
 *
 * Reading 2 is skipped when either ground is missing or non-finite: a caller
 * that cannot say where the surface is has given nothing to separate a hillside
 * from a wall with, and a DEM misses by returning `NaN`.
 */
function climbable(
  a: Column,
  b: Column,
  stepThresholdM: number,
  maxGroundGradient: number,
  resolution: number,
): boolean {
  if (Math.abs(a.heightM - b.heightM) <= stepThresholdM) return true;

  if (
    a.groundM === undefined ||
    b.groundM === undefined ||
    !Number.isFinite(a.groundM) ||
    !Number.isFinite(b.groundM)
  ) {
    return false;
  }

  // THE GRADE. Zero run within one cell, so climbing onto a wall inside a cell
  // gets no slope budget at all — the design's motivating case, which must not
  // be loosened by the arrival of a second limit.
  const run = a.cell === b.cell ? 0 : neighbourSpacingM(resolution);
  if (Math.abs(a.groundM - b.groundM) > maxGroundGradient * run) return false;

  // THE STEP, measured against each cell's OWN ground. This is what keeps a
  // wall unclimbable however steep the hill it stands on: its top is a fixed
  // height above the ground beneath it, and no amount of terrain relief adds to
  // the budget for climbing it.
  const rise = a.heightM - a.groundM - (b.heightM - b.groundM);
  return Math.abs(rise) <= stepThresholdM;
}
