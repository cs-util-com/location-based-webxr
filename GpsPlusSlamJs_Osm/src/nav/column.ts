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

import { gridDisk, getResolution } from "h3-js";

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
 * @param stepThresholdM the climbable height change, defaulting to
 *   {@link STEP_THRESHOLD_M}. Must be finite and non-negative.
 * @throws if the threshold is not a finite non-negative number, or if the two
 *   cells are at different H3 resolutions.
 */
export function columnsAdjacent(
  a: Column,
  b: Column,
  stepThresholdM: number = STEP_THRESHOLD_M,
): boolean {
  if (!Number.isFinite(stepThresholdM) || stepThresholdM < 0) {
    throw new RangeError(
      `columnsAdjacent: step threshold must be a finite, non-negative number, got ${stepThresholdM}`,
    );
  }

  // MIXED RESOLUTIONS ARE A CALLER BUG, NOT A "NO ROUTE" ANSWER. `gridDisk` on
  // a res-13 origin never returns a res-8 cell, so a mixed pair would come back
  // non-adjacent and read as "there is no way across" — the one answer that
  // looks entirely plausible and is entirely wrong.
  const resolutionA = getResolution(a.cell);
  const resolutionB = getResolution(b.cell);
  if (resolutionA !== resolutionB) {
    throw new RangeError(
      `columnsAdjacent: cells must share a resolution, got ${resolutionA} and ${resolutionB}`,
    );
  }

  // A HEIGHT WE DO NOT KNOW IS NOT A HEIGHT WE CAN STEP TO. The DEM lookup
  // misses by returning NaN rather than throwing, and every comparison against
  // NaN is false — so `Math.abs(NaN) > threshold` would be false and the step
  // would be declared walkable. Refusing outright fails towards "no route",
  // which a caller can see, instead of inventing connectivity it cannot.
  if (!Number.isFinite(a.heightM) || !Number.isFinite(b.heightM)) return false;

  if (Math.abs(a.heightM - b.heightM) > stepThresholdM) return false;

  return a.cell === b.cell || gridDisk(a.cell, 1).includes(b.cell);
}
