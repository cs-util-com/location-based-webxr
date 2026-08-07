/**
 * The column model as a searchable state space.
 *
 * This is the piece that was missing when review on #257 found that pass A
 * "collapses the column model back to 2D". The collapse had two causes and both
 * are answered here:
 *
 * - **One state per cell.** A cell-keyed visited set can hold the wall foot or
 *   the wall top, never both. {@link columnKey} puts the height in the key.
 * - **One height per cell.** A predicate handed only cell strings must resolve a
 *   single height, which is a heightfield, not a column. {@link ColumnSpaceOptions.levelsAt}
 *   returns **every standable height** in a cell, so the two states are
 *   generated in the first place.
 *
 * The second is the substantive one. Keying by height without a source that can
 * report more than one height per cell would still produce a single-valued
 * field — just with a longer key.
 *
 * @see column-space.ts.md
 */

import { gridDisk } from "h3-js";

import { columnsAdjacent, STEP_THRESHOLD_M, type Column } from "./column.js";
import type { StateSpace } from "./search.js";

/**
 * Decimal places kept when a height becomes part of a state's identity.
 *
 * QUANTISED BECAUSE FLOATS ARE NOT IDENTITIES. Heights arrive from a DEM
 * interpolation, so two samples of the same physical surface can differ in the
 * last bits — and two states that are the same place must produce the same key
 * or the search revisits the same ground forever. A millimetre is far below any
 * distinction the step threshold can make.
 */
const KEY_PRECISION = 3;

/** A state's identity: where it is, and at what level. */
export function columnKey(column: Column): string {
  return `${column.cell}@${column.heightM.toFixed(KEY_PRECISION)}`;
}

export interface ColumnSpaceOptions {
  /**
   * Every height at which an agent can stand in this cell, in metres.
   *
   * **Returning more than one is the whole point.** A cell containing a wall has
   * the ground beside it and the walkway on top; a cell with a footbridge over a
   * road has two. Returning exactly one everywhere reduces this to the 2D model.
   *
   * An empty result means the cell is not standable at all — inside a building,
   * or off the scored working set — and no state is generated for it.
   */
  levelsAt: (cell: string) => readonly number[];
  /** The climbable height change; defaults to {@link STEP_THRESHOLD_M}. */
  stepThresholdM?: number;
  /**
   * Whether the agent may pass between two cells at all, ignoring height.
   *
   * **This is what makes a wall block laterally**, and it is separate from
   * `levelsAt` on purpose: levels answer "where can I stand", and no answer to
   * that question can stop a step at this resolution. A res-13 cell is ~8 m
   * across and a wall ~0.5 m thick, so a wall almost never contains a cell's
   * centre — an agent simply walked along the ground through it.
   * `crossesObstacle` in `obstacles.ts` is the intended implementation.
   *
   * Defaults to admitting every step, which is design rung 5.3: agents wander
   * over free `gridDisk` adjacency and walk up the Tower walls, and that rung's
   * whole point is that they do.
   */
  canCross?: (fromCell: string, toCell: string) => boolean;
}

/**
 * A {@link StateSpace} over `(cell, heightM)` states.
 *
 * Candidates are every level of the cell itself and of its six neighbours;
 * `canEnter` is {@link columnsAdjacent}, which is what rejects a step the agent
 * cannot climb — **including a step within one cell**, which is the case a
 * cell-keyed search cannot express.
 */
export function columnSpace(options: ColumnSpaceOptions): StateSpace<Column> {
  const stepThresholdM = options.stepThresholdM ?? STEP_THRESHOLD_M;
  const canCross = options.canCross ?? (() => true);

  return {
    key: columnKey,
    candidates(state: Column): Column[] {
      const out: Column[] = [];
      // THE CELL ITSELF IS INCLUDED, and that is not redundant: moving between
      // two levels of one cell — stepping up onto the wall where it is low
      // enough — is a legal move that only exists in a column model. The search
      // drops the state's own key, so standing still is not generated.
      //
      // Sorted for the same reason `connectedComponents` sorts: `gridDisk`
      // promises no ordering, and a route that depends on it would vary with
      // the H3 version.
      for (const cell of gridDisk(state.cell, 1).sort()) {
        for (const heightM of options.levelsAt(cell)) {
          out.push({ cell, heightM });
        }
      }
      return out;
    },
    canEnter(from: Column, to: Column): boolean {
      if (!columnsAdjacent(from, to, stepThresholdM)) return false;
      // ORDER MATTERS FOR COST, not for the answer: `columnsAdjacent` is
      // arithmetic and `canCross` walks geometry, so the cheap test rejects the
      // overwhelming majority of candidate pairs first.
      //
      // A MOVE WITHIN ONE CELL IS NEVER BLOCKED — stepping up onto a low wall
      // where it is low enough crosses no boundary between cells, and asking
      // the predicate about a cell and itself would refuse it whenever the
      // wall's own footprint covers that cell.
      if (from.cell === to.cell) return true;
      return canCross(from.cell, to.cell);
    },
  };
}
