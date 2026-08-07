/**
 * What the details panel says about a selected affordance region (DEC-R7b-3a).
 *
 * WHY THIS IS A PURE MODULE AND NOT PART OF THE PANEL. Everything here that can
 * be wrong is arithmetic or wording — a median outside its own min/max, a
 * twelve-digit score printed in full, "1 cells" — and none of it needs a DOM to
 * check. The panel renders whatever this returns.
 *
 * WHY THE SESSION ASKED FOR IT. A region is painted by its MEDIAN, and the
 * session found an area whose median was 10 sitting over cells scoring 288:
 * _"der Median ist sehr weit weg an manchen Stellen"_. The spread was already
 * computed on every publish and thrown away at the UI — `Region` has carried
 * `minScore` and `maxScore` since it was written and nothing has ever displayed
 * either. This is the cheap half of that finding; showing WHERE inside the
 * region the peaks are needs per-cell scores to reach the 3D side, which they do
 * not, and is deliberately deferred.
 *
 * @see region-summary.ts.md
 */

import { formatScore } from "./heat-colours.js";

/** The part of a region this module needs. Structural, so a test can build one. */
export interface SummarisableRegion {
  readonly id: string;
  readonly category: string;
  readonly cellCount: number;
  readonly areaM2: number;
  readonly medianScore: number;
  readonly minScore: number;
  readonly maxScore: number;
}

/**
 * One labelled statistic, ready to render.
 *
 * Not exported: it is reachable as `RegionSummary["stats"][number]`, which is how
 * this demo names a member of a returned array elsewhere, and knip is right that a
 * second public name earns nothing.
 */
interface RegionStat {
  readonly label: string;
  readonly value: string;
}

export interface RegionSummary {
  readonly title: string;
  readonly stats: readonly RegionStat[];
  /**
   * The sentence a row of numbers cannot say, or `undefined` when there is
   * nothing worth saying.
   */
  readonly spreadNote: string | undefined;
}

/**
 * How many times the maximum must exceed the median before it is worth calling
 * out.
 *
 * TEN, because the scores are a PRODUCT of rule factors and span twelve orders
 * of magnitude at Cologne — a 2x spread inside one region is unremarkable and a
 * note about it would fire on almost every region, which is the same as no note
 * at all. The session's own example was 10 against 288, a 28x spread.
 */
const NOTABLE_SPREAD = 10;

/** Square metres, rounded the way an area is usually read. */
function formatArea(areaM2: number): string {
  if (!Number.isFinite(areaM2) || areaM2 < 0) return "—";
  if (areaM2 >= 1_000_000) return `${(areaM2 / 1_000_000).toFixed(2)} km²`;
  if (areaM2 >= 10_000) return `${(areaM2 / 10_000).toFixed(2)} ha`;
  return `${Math.round(areaM2)} m²`;
}

/**
 * The panel's model for one region.
 *
 * Scores go through `formatScore`, the same helper the legend uses. That is not
 * tidiness: round 7 shipped a legend reading `1 … 27992463056732.17` because a
 * second copy of the rounding existed, and a panel with its own would be the
 * third place the same quantity is formatted differently.
 */
export function summariseRegion(region: SummarisableRegion): RegionSummary {
  const cells = `${region.cellCount} ${region.cellCount === 1 ? "cell" : "cells"}`;
  const stats: RegionStat[] = [
    { label: "median", value: formatScore(region.medianScore) },
    {
      label: "range",
      value: `${formatScore(region.minScore)} – ${formatScore(region.maxScore)}`,
    },
    { label: "cells", value: cells },
    { label: "area", value: formatArea(region.areaM2) },
  ];

  return {
    title: `${region.category} region`,
    stats,
    spreadNote: spreadNote(region),
  };
}

/**
 * Names the gap between the colour and the contents, when there is one.
 *
 * THE POINT OF THE WHOLE PANEL. The slab is one flat colour derived from the
 * median, so a region containing a genuine hotspot looks exactly like a uniform
 * one. The median is the right paint value — `region-builder.ts` argues that at
 * length, and a mean would be dragged around by a single heavily-mapped cell —
 * so the fix is to stop the median being the ONLY thing shown, not to change it.
 */
function spreadNote(region: SummarisableRegion): string | undefined {
  const { medianScore, maxScore } = region;
  if (!Number.isFinite(medianScore) || !Number.isFinite(maxScore)) {
    return undefined;
  }
  if (medianScore <= 0 || maxScore < medianScore * NOTABLE_SPREAD) {
    return undefined;
  }
  return (
    `The colour is the median (${formatScore(medianScore)}), but cells inside ` +
    `reach ${formatScore(maxScore)}. Switch the cells layer on to see where.`
  );
}
