/**
 * The nine stages of one refresh pass, reconciled against a measured whole.
 *
 * WHY THIS IS A PURE MODULE. The stages are measured in three places — the
 * pipeline, the worker handler and the page — and the interesting part is not
 * any one of them but whether they ADD UP. Putting the arithmetic here means it
 * can be driven with exact numbers in a test, which is the half of the plan's
 * testing mandate that the source-level tests cannot reach: a fake clock can
 * charge `response.text()`, but nothing can charge `JSON.parse` from outside.
 *
 * THE ONE RULE THIS FILE ENFORCES. `residualMs` is derived as
 * `wall - Σstages`, and it is never distributed. Unattributed time is the most
 * interesting output this instrument can produce — it is where the next
 * unmeasured stage is hiding — and the plan's own first draft missed a stage
 * (the terrain join) that only a residual would have surfaced. Closing the gap
 * by renormalising the shares would make that class of finding impossible.
 *
 * **AND THE RESIDUAL HAS A SHARPER MEANING THAN "LEFTOVER", which fell out of
 * the arithmetic rather than being designed in.** Substituting the definitions:
 *
 *     residual = wall - Σstages
 *             = (roundTrip + draw) - (pipeline + terrainWait + mesh
 *                                     + (roundTrip - workerTotal) + draw)
 *             = workerTotal - (pipeline + terrainWait + mesh)
 *
 * i.e. **exactly the time the worker spent that none of its enumerated stages
 * claims.** Time on the page cancels out. That is a better instrument than a
 * vague leftover: a non-trivial residual points at the worker handler
 * specifically, which is where the one stage this plan missed was hiding.
 *
 * @see click-timings.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-08-11-0717-osm-demo-click-path-stage-timing-plan.md
 */

import type { DemoStageTimings } from "./demo-pipeline.js";

/** Stages 6–7 plus the worker's own wall clock. See `demo-worker.ts`. */
export interface WorkerStageTimings {
  /**
   * Stage 6 — `terrainGate.waitFor`, the DEM join.
   *
   * **The stage this plan's first draft did not know existed.** W3 runs the
   * terrain load concurrently with stages 1–5, so this is only what those
   * stages did not already cover: zero on a category change or a widening
   * ring, a network round trip on a new position.
   */
  readonly terrainWaitMs: number;
  /** Stage 7 — the mesh build, full or regions-only per `meshPlanner`. */
  readonly meshMs: number;
  /**
   * The whole handler, measured wholly INSIDE the worker.
   *
   * Exists so the page can derive stage 8 without ever subtracting a worker
   * timestamp from a page one — see {@link composeClickTimings}.
   */
  readonly workerTotalMs: number;
}

export interface ClickTimingInput {
  /** Which ring of the widening this pass scored. */
  readonly radius: number;
  /** Stages 1–5, from `DemoSnapshot.timings`. */
  readonly pipeline: DemoStageTimings;
  /** Stages 6–7, from the worker's `update` handler. */
  readonly worker: WorkerStageTimings;
  /** Page-side wall clock around `worker.call`. */
  readonly roundTripMs: number;
  /** Page-side wall clock around the mesh hand-over and the dispatch. */
  readonly drawMs: number;
}

/**
 * One stage's cost and its share of the click.
 *
 * NOT EXPORTED, unlike `OsmTileTimings` in the OSM package — and the difference
 * is real rather than inconsistency. That type is part of a published API: a
 * consumer writing its own `OsmDataSource` has to name it. This one is internal
 * to the demo and is reachable as `ClickTimings["stages"][number]`, which is how
 * `protocol.ts` already names a member of a transferred array. A second public
 * name earns nothing and the dead-code gate is right to say so.
 */
interface ClickStage {
  readonly name: string;
  readonly ms: number;
  /** Fraction of {@link ClickTimings.wallMs}, in [0, 1]. */
  readonly share: number;
}

export interface ClickTimings {
  readonly radius: number;
  /** The separately measured whole: round trip plus draw. */
  readonly wallMs: number;
  readonly stages: readonly ClickStage[];
  /** `wallMs - Σstages`. Never distributed, always reported. */
  readonly residualMs: number;
  readonly residualShare: number;
  /**
   * Whether the parts add up well enough to draw a conclusion from.
   *
   * `false` means the breakdown is lying somewhere and no ranking may be read
   * off it — the plan's §0.3 item 2, expressed as data rather than as a rule
   * someone has to remember.
   */
  readonly reconciles: boolean;
  readonly tilesFetched: number;
  readonly tilesFromNetwork: number;
  readonly tilesFromCache: number;
  readonly tilesUnmeasured: number;
  readonly tilesHeld: number;
}

/**
 * How far the parts may miss the whole before the breakdown is untrustworthy.
 *
 * **A tolerance rather than zero, and that is honest rather than lax.** The
 * instrument itself costs a handful of `performance.now()` calls, the stages do
 * not abut perfectly, and the page and worker clocks are read microseconds
 * apart. A zero tolerance would fail on every click and be ignored within a
 * day, which is strictly worse than not checking. Generous enough to survive
 * measurement noise; far too tight to hide a stage.
 */
const RECONCILE_TOLERANCE_MS = 20;
const RECONCILE_TOLERANCE_SHARE = 0.02;

/**
 * Assembles the nine stages and checks them against the wall clock.
 *
 * **Stage 8 is DERIVED, never timestamped across the boundary.** A dedicated
 * worker has its own `performance.timeOrigin`, so subtracting a worker
 * timestamp from a page one produces an offset, not a duration —
 * `GeoEventStats` gives no warning about this because all three of its timings
 * are taken wholly inside the worker, and this is the first thing in the demo
 * to time across it. Transfer is therefore `roundTrip - workerTotal`: two
 * durations, each measured entirely on one side.
 *
 * That subtraction can go NEGATIVE on clock skew or an over-reporting worker.
 * It is clamped, and the clamp is why {@link ClickTimings.reconciles} exists: a
 * negative stage would make the residual close by cancelling, so the sum would
 * look right while two numbers were wrong.
 */
export function composeClickTimings(input: ClickTimingInput): ClickTimings {
  const { pipeline: p, worker: w } = input;
  const wallMs = input.roundTripMs + input.drawMs;

  const rawTransferMs = input.roundTripMs - w.workerTotalMs;
  const transferMs = Math.max(0, rawTransferMs);

  const measured: readonly (readonly [string, number])[] = [
    // Stage 1–2, already split by the source.
    ["slot-wait", p.slotWaitMs],
    ["fetch", p.transportMs],
    ["decode", p.decodeMs],
    ["parse", p.parseMs],
    ["cache-probe", p.probeMs],
    ["cache-store", p.storeMs],
    ["dedup-join", p.joinedMs],
    // Stages 3–5.
    ["merge", p.mergeMs],
    ["score", p.scoreMs],
    ["derive", p.deriveMs],
    // Stages 6–9.
    ["terrain-wait", w.terrainWaitMs],
    ["mesh", w.meshMs],
    ["transfer", transferMs],
    ["draw", input.drawMs],
  ];

  const stages = measured.map(([name, value]) => ({
    name,
    ms: value,
    // AGAINST THE WALL CLOCK, never against the sum. Shares computed against
    // the sum always total 100 %, so a breakdown missing a third of the click
    // would look complete — the exact reading this plan exists to prevent.
    share: wallMs > 0 ? value / wallMs : 0,
  }));

  const summed = stages.reduce((sum, s) => sum + s.ms, 0);
  const residualMs = wallMs - summed;
  const residualShare = wallMs > 0 ? residualMs / wallMs : 0;

  return {
    radius: input.radius,
    wallMs,
    stages,
    residualMs,
    residualShare,
    reconciles:
      rawTransferMs >= 0 &&
      (Math.abs(residualMs) <= RECONCILE_TOLERANCE_MS ||
        Math.abs(residualShare) <= RECONCILE_TOLERANCE_SHARE),
    tilesFetched: p.tilesFetched,
    tilesFromNetwork: p.tilesFromNetwork,
    tilesFromCache: p.tilesFromCache,
    tilesUnmeasured: p.tilesUnmeasured,
    tilesHeld: p.tilesHeld,
  };
}

/** Milliseconds, rounded — sub-millisecond precision is noise here. */
function ms(value: number): string {
  return `${Math.round(value)} ms`;
}

function pct(share: number): string {
  return `${Math.round(share * 100)} %`;
}

/**
 * One line per pass, for the console.
 *
 * **EVERY STAGE CARRIES ITS SHARE.** A stage number without its denominator is
 * the form of evidence this whole plan exists to replace — "merge is 12 ms" is
 * useless until it is "…of a 4 200 ms click" — and it is easy to emit by
 * accident. The wall clock leads for the same reason.
 *
 * Zero-cost stages are dropped from the line, because on passes 2 and 3 most of
 * them are legitimately zero and printing fourteen `0 ms` entries would bury
 * the three that matter. The residual is NEVER dropped: it is where an
 * unenumerated stage hides, and a line that omits it when small trains the
 * reader to stop looking for it.
 */
export function describeClickTimings(t: ClickTimings): string {
  const served = [
    `${t.tilesFetched} fetched`,
    `${t.tilesFromNetwork} net`,
    `${t.tilesFromCache} cache`,
    ...(t.tilesUnmeasured > 0 ? [`${t.tilesUnmeasured} unmeasured`] : []),
    `${t.tilesHeld} held`,
  ].join("/");

  const parts = t.stages
    .filter((s) => s.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .map((s) => `${s.name} ${ms(s.ms)} (${pct(s.share)})`);

  return [
    `click ring ${String(t.radius)}: ${ms(t.wallMs)} total`,
    ...parts,
    `residual ${ms(t.residualMs)} (${pct(t.residualShare)})`,
    `tiles ${served}`,
    ...(t.reconciles
      ? []
      : ["** DOES NOT RECONCILE — do not rank stages from this line **"]),
  ].join(" · ");
}
