/**
 * The woods governor's link knobs and its `?perf=1` readout.
 *
 * WHY THIS EXISTS. The governor (`gps-plus-slam-osm/three`'s
 * `woods-governor.ts`) thins the invented woods on a phone that draws a
 * frame in more than 50 ms. Nobody has measured a phone yet, so the owner
 * reads this line on his: whether the woods push it over 50 ms at all, which
 * share it settles at, and whether the worthwhile test fires (the mode reads
 * `resting`).
 *
 * THE KNOBS ARE READ-ONLY BOOT OVERRIDES (`url-state.ts`): `woodsauto=off`
 * switches the governor off for a measurement, `treeform=trunk` draws the
 * trunk-and-crown trees, `perf=1` shows this readout. There is no app
 * control for any of them and nothing writes them back.
 *
 * PURE, like `draw-cost.ts`: the view supplies the numbers, the sentence is
 * built here, so it can be pinned without a GPU.
 *
 * @see woods-readout.ts.md
 */

import {
  createWoodsGovernor,
  type TreeForm,
  type WoodsGovernorMode,
} from "gps-plus-slam-osm/three";

import { describeDrawCost, type DrawCost } from "./draw-cost.js";

export interface WoodsKnobs {
  /** Whether the governor may thin the woods: a phone, and not switched off. */
  readonly auto: boolean;
  readonly treeForm: TreeForm;
  /** Whether the readout is shown. */
  readonly perf: boolean;
}

/**
 * The knobs from a query string (`window.location.search`) and whether the
 * pointer is coarse (`matchMedia("(pointer: coarse)")`, the phone signal the
 * editor's globe uses for its quality tier). Unknown values read as the
 * default, so an old or mistyped link still opens.
 */
export function readWoodsKnobs(
  search: string,
  coarsePointer: boolean,
): WoodsKnobs {
  const params = new URLSearchParams(search);
  return {
    auto: coarsePointer && params.get("woodsauto") !== "off",
    treeForm: params.get("treeform") === "trunk" ? "trunk" : "crown",
    perf: params.get("perf") === "1",
  };
}

/** The counted-frame intervals of the last `windowMs`, for a percentile. */
export interface FrameWindow {
  /** One counted interval `ms` ending at `atMs`; ignored unless positive. */
  add(atMs: number, ms: number): void;
  /** The 95th percentile (nearest rank), undefined while empty. */
  p95(): number | undefined;
}

export function createFrameWindow(windowMs = 10_000): FrameWindow {
  const entries: { atMs: number; ms: number }[] = [];
  let newest = Number.NEGATIVE_INFINITY;
  return {
    add(atMs, ms) {
      if (!Number.isFinite(atMs) || !Number.isFinite(ms) || !(ms > 0)) return;
      newest = Math.max(newest, atMs);
      entries.push({ atMs, ms });
      while (
        entries.length > 0 &&
        (entries[0]?.atMs ?? newest) < newest - windowMs
      ) {
        entries.shift();
      }
    },
    p95() {
      if (entries.length === 0) return undefined;
      const sorted = entries.map((entry) => entry.ms).sort((a, b) => a - b);
      return sorted[Math.ceil(0.95 * sorted.length) - 1];
    },
  };
}

export interface WoodsReadout {
  readonly averageMs: number | undefined;
  readonly p95Ms: number | undefined;
  readonly share: number;
  readonly mode: WoodsGovernorMode;
  readonly inventedTrees: number;
  readonly drawCost: DrawCost | undefined;
}

const ms = (value: number | undefined): string =>
  value === undefined ? "-" : value.toFixed(1);

/**
 * One line: the smoothed counted-frame time, its p95 over the last 10 s, the
 * woods' share and the governor's mode, the invented trees drawn, and the
 * last frame's draws and triangles (`describeDrawCost`, dropped while
 * unmeasured).
 */
export function describeWoodsReadout(readout: WoodsReadout): string {
  return [
    `frame ${ms(readout.averageMs)} ms`,
    `p95 ${ms(readout.p95Ms)} ms`,
    `woods ${Math.round(readout.share * 100)} % (${readout.mode})`,
    `${readout.inventedTrees.toLocaleString("en-US")} invented trees`,
    describeDrawCost(readout.drawCost),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The governor, the percentile window and the readout, as the view uses them. */
export interface WoodsMeter {
  /**
   * One drawn frame at `atMs` (the rAF timestamp); `chained` when it was
   * requested from within the previous frame's callback. Returns the share
   * to apply when the governor just moved it, otherwise undefined.
   */
  frame(atMs: number, chained: boolean): number | undefined;
  /** The share the woods should be drawn at now. */
  share(): number;
  /** The readout line for the trees drawn and the last frame's cost. */
  describe(inventedTrees: number, drawCost: DrawCost | undefined): string;
}

export function createWoodsMeter(auto: boolean): WoodsMeter {
  const governor = createWoodsGovernor({ auto });
  const intervals = createFrameWindow();
  let lastMs: number | undefined;
  let share = governor.state().share;
  return {
    frame(atMs, chained) {
      // The same rule as the governor's: only a chained frame's interval is
      // a frame time; the first frame of a burst follows an idle pause.
      if (chained && lastMs !== undefined) intervals.add(atMs, atMs - lastMs);
      if (Number.isFinite(atMs)) lastMs = atMs;
      governor.frame(atMs, chained);
      const next = governor.state().share;
      if (next === share) return undefined;
      share = next;
      return next;
    },
    share: () => share,
    describe(inventedTrees, drawCost) {
      const state = governor.state();
      return describeWoodsReadout({
        averageMs: state.averageMs,
        p95Ms: intervals.p95(),
        share: state.share,
        mode: state.mode,
        inventedTrees,
        drawCost,
      });
    },
  };
}
