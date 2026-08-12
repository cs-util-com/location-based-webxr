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
 *     Σworker  = ΣpipelineParts + terrainWait + mesh + prefetch
 *     residual = wall - Σstages
 *              = (roundTrip + draw)
 *                - (Σworker + queue + (roundTrip - workerTotal - queue) + draw)
 *              = workerTotal - Σworker
 *
 * i.e. **exactly the time inside the worker that none of the enumerated stages
 * claims.** Time on the page cancels out entirely, and so does `queue` — it
 * appears in the stage list and in the boundary derivation with opposite signs.
 *
 * **`prefetch` belongs in that sum and was missing from this comment for three
 * commits**, along with the doc copies of it and the test that "pinned" the
 * identity — which passed only because its fixture set `prefetchMs: 0`. A term
 * added to the stage list has to be added to the algebra in the same breath, or
 * the algebra quietly describes an earlier version of the code.
 *
 * **AND PAGE TIME CANCELLING IS A LIMITATION, not only a sharpening.** It makes
 * a ring's residual a precise pointer at the worker — and equally makes it
 * incapable of ever surfacing a page-side stage nobody enumerated. That is why
 * {@link composeClickSummary} exists: a wall clock around the WHOLE click, with
 * `pageResidualMs` as the page's own unattributed time.
 *
 * **`ΣpipelineParts` is the ten COMPONENT fields, not `DemoStageTimings.pipelineMs`
 * — and the distinction is not pedantry**, because `pipelineMs` is a real field
 * of the very object being summed and reading the identity the obvious way
 * gives a different, wrong one. Since the components are summed rather than the
 * wall clock, the residual also contains unattributed time INSIDE
 * `DemoPipeline.update` — loop overhead, a refused network attempt on the
 * stale-on-rate-limit path. (**A joiner's cache probe used to be listed here
 * and no longer belongs**: since 2026-08-12 it is carried as `probeMs` and
 * lands in the `cache-probe` stage instead of the residual.) So read it as
 * "unattributed time anywhere inside the worker, `DemoPipeline.update`
 * included", not as "time in the worker handler". Chasing it starts in the
 * handler but does not end there.
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
   * Queueing the background neighbour ring.
   *
   * Small, synchronous, and enumerated anyway — it is a tenth thing the handler
   * does, and an unenumerated step in this exact handler is what this whole
   * instrument exists to catch.
   */
  readonly prefetchMs: number;
  /**
   * The whole handler, measured wholly INSIDE the worker.
   *
   * Exists so the page can derive stage 8 without ever subtracting a worker
   * timestamp from a page one — see {@link composeClickTimings}.
   */
  readonly workerTotalMs: number;
  /**
   * How long the `update` message sat in the worker's queue before its handler
   * ran — post to dispatch.
   *
   * **The one number here that DOES cross the boundary**, and deliberately: it
   * is computed from `performance.timeOrigin + performance.now()` on both
   * sides, which is an absolute epoch timeline rather than two unrelated
   * relative ones. Everything else is a duration measured wholly on one side,
   * because that needs no shared origin at all and is therefore more robust.
   *
   * **Coarse by design and that is fine here.** Browsers round
   * `performance.now()` and `timeOrigin` for timing-attack reasons — typically
   * to 0.1–1 ms outside a cross-origin-isolated context. Against a queue wait
   * measured in tens or hundreds of milliseconds that is noise; it would not be
   * against a sub-millisecond stage, which is why nothing else uses this route.
   */
  readonly queueMs: number;
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
  /** Printed even at zero — see `composeClickTimings`. */
  readonly always: boolean;
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
   * `fetchMs` minus the per-tile parts and the merge inside it.
   *
   * **The mini-residual §10.2 of the plan promised and the first cut did not
   * deliver.** It is the loop's own overhead — working-set arithmetic, `loaded`
   * lookups, await hops — and, more usefully, anything a source spends without
   * reporting. It was the stated reason the milestone-1 cache-probe gap was
   * deferred rather than closed blind; producing `fetchMs` and never
   * subtracting anything from it made that reasoning empty.
   */
  readonly fetchUnattributedMs: number;
  /**
   * `pipelineMs` minus everything `DemoPipeline.update` accounts for.
   *
   * **`pipelineMs` was computed, cloned across the worker boundary three times
   * per click, and read by NOTHING for three commits** — while three separate
   * places called it "the second reconciliation anchor". This is that anchor
   * actually doing its job: the method's own wall clock against the sum of the
   * stages it claims to be made of.
   *
   * It overlaps `residualMs` rather than adding to it — the residual is the
   * worker's whole unattributed time and this is the part of it inside
   * `update`. Reported separately because the two point at different files.
   */
  readonly pipelineUnattributedMs: number;
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
 * to time across it. The BOUNDARY term is therefore
 * `roundTrip - queue - workerTotal`: durations, each measured entirely on one
 * side. (It was called `transfer` and derived without the queue; this was the
 * last place in the file still saying so after the rename swept four others.)
 *
 * That subtraction can go NEGATIVE on clock skew or an over-reporting worker.
 * It is clamped, and the clamp is why {@link ClickTimings.reconciles} exists: a
 * negative stage would make the residual close by cancelling, so the sum would
 * look right while two numbers were wrong.
 */
export function composeClickTimings(input: ClickTimingInput): ClickTimings {
  const { pipeline: p, worker: w } = input;
  const wallMs = input.roundTripMs + input.drawMs;

  // QUEUEING IS ITS OWN STAGE NOW, and the claim it used to hide behind was
  // simply wrong. Earlier revisions of this file said the queue and the clone
  // "cannot be separated without a shared clock" — but `performance.timeOrigin`
  // is exposed in a dedicated worker as well as on the page, and it is an
  // ABSOLUTE origin, so `timeOrigin + now()` is a common timeline on both
  // sides. That is what `timeOrigin` is specified for. Deriving stage 8 rather
  // than timestamping it is still the right default (see below); declaring the
  // split impossible was an overstatement, in a doc series whose whole subject
  // is not asserting unchecked things as settled.
  //
  // It matters because this was the LARGEST term in the only line ever
  // observed. `main.ts` posts the terrain load and the refresh to the same
  // worker in the same tick (W3), so on a new position the concurrent DEM job's
  // CPU landed here and the reader was told to treat it as "contention" with no
  // way to check.
  const queueMs = Math.max(0, w.queueMs);
  // `boundary` is now only what it says: the reply's journey back, i.e. the
  // structured clone and its delivery. roundTrip − queue − workerTotal.
  const rawBoundaryMs = input.roundTripMs - w.workerTotalMs - queueMs;
  const boundaryMs = Math.max(0, rawBoundaryMs);

  // `always` marks the NINE STAGES §2 enumerates. They print even at zero,
  // because for two of them the zero is the answer: `parse` is genuinely 0 on a
  // cache hit (§6.1) and `terrain-wait` is 0 on a widening ring and non-zero on
  // a new position (§2 stage 6) — and those two zeros are exactly what
  // discriminates §3's competing predictions. Dropping them would leave the
  // line unable to falsify the thing it was built to test, and would reproduce
  // the absent-vs-zero confusion the source-level type spends a whole field
  // preventing. The sub-splits of stages 1–2 are the noise, and they drop.
  const measured: readonly (readonly [string, number, boolean])[] = [
    // Stage 1–2, split by the source. Sub-splits drop when zero.
    ["slot-wait", p.slotWaitMs, false],
    ["fetch", p.transportMs, true],
    ["decode", p.decodeMs, false],
    ["parse", p.parseMs, true],
    ["cache-probe", p.probeMs, false],
    ["cache-store", p.storeMs, false],
    ["dedup-join", p.joinedMs, false],
    // Stages 3–5.
    ["merge", p.mergeMs, true],
    ["score", p.scoreMs, true],
    ["derive", p.deriveMs, true],
    // Stages 6–9.
    ["terrain-wait", w.terrainWaitMs, true],
    ["mesh", w.meshMs, true],
    ["prefetch-queue", w.prefetchMs, false],
    ["queue", queueMs, true],
    ["boundary", boundaryMs, true],
    ["draw", input.drawMs, true],
  ];

  const stages = measured.map(([name, value, always]) => ({
    name,
    // CLAMPED HERE TOO, not only on the derived boundary term. Every producer
    // already floors its own durations, so this is belt and braces — but this
    // module is a boundary and its inputs cross a structured clone from another
    // thread. A property run over adversarial inputs found `prefetch-queue`
    // passing a negative straight through, which is precisely the value that
    // makes the reconciliation close by cancelling.
    ms: Math.max(0, value),
    always,
    // AGAINST THE WALL CLOCK, never against the sum. Shares computed against
    // the sum always total 100 %, so a breakdown missing a third of the click
    // would look complete — the exact reading this plan exists to prevent.
    share: wallMs > 0 ? Math.max(0, value) / wallMs : 0,
  }));

  // ANY CLAMP AT ALL MEANS A PRODUCER WAS WRONG ABOUT ITS OWN CLOCK, and after
  // clamping that is indistinguishable from a genuine zero (r504 review). The
  // clamps above are right — a negative stage makes the sum close by
  // CANCELLING — but silently right: the total reconciles, `reconciles`
  // reports true, and the line prints a confident ranking built on a stage
  // whose source contradicted itself.
  //
  // `reconciles` already refuses the DERIVED negative (`rawBoundaryMs`). This
  // extends the same rule to the MEASURED ones, which is what the file's own
  // argument demands and what it did not do.
  //
  // ALL FOUR CLAMP SITES, not just the stage list. The first version of this
  // rule covered `measured` alone while its own headline said "ANY CLAMP AT
  // ALL" — and the same commit added a test (`pipelineMs: 100` against parts
  // summing to 1200) that constructed exactly the uncovered case and asserted
  // only the clamp. A pipeline wall clock smaller than the parts it is made of
  // is the "something is double-counted" condition this file calls no more
  // trustworthy than something missing, and it printed as reconciled.
  //
  // `input.drawMs` needs no term of its own: it is the last entry of
  // `measured` and is held there RAW. `w.queueMs` does need one, because
  // `measured` holds the already-clamped copy.
  // HOISTED ABOVE `clamped`, which reads it. Both mini-residuals are clamped
  // and both therefore feed the rule.
  const insideFetchLoop =
    p.slotWaitMs +
    p.transportMs +
    p.decodeMs +
    p.parseMs +
    p.probeMs +
    p.storeMs +
    p.joinedMs +
    p.mergeMs;
  const rawFetchUnattributedMs = p.fetchMs - insideFetchLoop;
  const rawPipelineUnattributedMs =
    p.pipelineMs - (p.fetchMs + p.scoreMs + p.deriveMs);

  const clamped =
    w.queueMs < 0 ||
    measured.some(([, value]) => value < 0) ||
    rawFetchUnattributedMs < 0 ||
    rawPipelineUnattributedMs < 0;

  const summed = stages.reduce((sum, s) => sum + s.ms, 0);
  const residualMs = wallMs - summed;
  const residualShare = wallMs > 0 ? residualMs / wallMs : 0;

  return {
    radius: input.radius,
    wallMs,
    stages,
    residualMs,
    residualShare,
    fetchUnattributedMs: Math.max(0, rawFetchUnattributedMs),
    // THE SECOND ANCHOR, finally used. `pipelineMs` is the method's own wall
    // clock; the raw value above is everything it says it is made of.
    pipelineUnattributedMs: Math.max(0, rawPipelineUnattributedMs),
    // A NEGATIVE RESIDUAL IS NOT RECONCILED EITHER, and `Math.abs` here was a
    // bug: stages summing to MORE than the wall clock means something is
    // double-counted, which is no more trustworthy than something missing.
    //
    // AND A ZERO-WALL PASS DOES NOT RECONCILE. An instrument that measured
    // nothing must not report that its nothing adds up — that is §0.2's
    // "silence reads as measured" reproduced in the one artefact the owner is
    // meant to read.
    // AND A CLAMPED INPUT DOES NOT RECONCILE — see `clamped` above. A stage
    // that arrived negative was produced by a clock that disagreed with
    // itself, and no ranking may be read off a line containing one.
    reconciles:
      rawBoundaryMs >= 0 &&
      !clamped &&
      wallMs > 0 &&
      residualMs >= -RECONCILE_TOLERANCE_MS &&
      (residualMs <= RECONCILE_TOLERANCE_MS ||
        residualShare <= RECONCILE_TOLERANCE_SHARE),
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
    // FILTERED ON THE ROUNDED VALUE, so a 0.4 ms stage does not survive the
    // filter only to print as `0 ms (0 %)` — a zero-looking entry beside the
    // genuinely-zero ones that were dropped, which is the worst of both.
    // `always` stages ignore the filter entirely: see `composeClickTimings`.
    .filter((s) => s.always || Math.round(s.ms) > 0)
    .sort((a, b) => b.ms - a.ms)
    .map((s) => `${s.name} ${ms(s.ms)} (${pct(s.share)})`);

  return [
    `click ring ${String(t.radius)}: ${ms(t.wallMs)} total`,
    ...parts,
    `residual ${ms(t.residualMs)} (${pct(t.residualShare)})`,
    ...(Math.round(t.pipelineUnattributedMs) > 0
      ? [`of which pipeline-unattributed ${ms(t.pipelineUnattributedMs)}`]
      : []),
    ...(Math.round(t.fetchUnattributedMs) > 0
      ? [`of which fetch-unattributed ${ms(t.fetchUnattributedMs)}`]
      : []),
    `tiles ${served}`,
    // SHARES ARE ROUNDED INDEPENDENTLY, so the column can miss 100 by a few
    // points on a line with this many entries. Said out loud rather than left
    // for a reader to discover and reasonably conclude the instrument is
    // broken — on a line whose whole claim is that every number carries its
    // share of the whole.
    "(shares rounded; the column need not total 100)",
    ...(t.reconciles
      ? []
      : ["** DOES NOT RECONCILE — do not rank stages from this line **"]),
  ].join(" · ");
}

/**
 * The WHOLE CLICK, against the sum of its published rings.
 *
 * **Exists because the per-ring residual is blind to the page by
 * construction.** Substituting the definitions leaves
 * `workerTotal − Σ(worker stages)`: page time cancels exactly, which is what
 * makes a ring's residual a sharp pointer at the worker handler — and equally
 * what makes it incapable of ever surfacing a page-side stage nobody
 * enumerated. The plan mandated a wall clock "around the entire three-pass
 * refresh" and the first implementation shipped only per-pass ones.
 *
 * `pageResidualMs` is everything the cycle spent outside the rings: the
 * `fetchStarted` dispatch and the subscriber renders it triggers, the per-ring
 * layer reads and guards, the gaps between passes, and printing the lines.
 */
export interface ClickSummary {
  /** Wall clock around the whole widening, page-side. */
  readonly clickMs: number;
  /** Rings that actually published. Fewer than three means it stopped early. */
  readonly rings: number;
  /** Σ of the published rings' `wallMs`. */
  readonly ringSumMs: number;
  /** `clickMs − ringSumMs` — page time no ring accounts for. */
  readonly pageResidualMs: number;
}

export function composeClickSummary(
  clickMs: number,
  rings: readonly ClickTimings[],
): ClickSummary {
  const ringSumMs = rings.reduce((sum, r) => sum + r.wallMs, 0);
  return {
    clickMs: Math.max(0, clickMs),
    rings: rings.length,
    ringSumMs,
    pageResidualMs: Math.max(0, clickMs - ringSumMs),
  };
}

/**
 * One line for the whole click.
 *
 * Printed after the ring lines so the reader meets the parts before the total —
 * and it names `page-residual` explicitly rather than leaving the gap between
 * `clickMs` and the ring sum for someone to notice.
 */
export function describeClickSummary(s: ClickSummary): string {
  const share = s.clickMs > 0 ? s.pageResidualMs / s.clickMs : 0;
  return [
    `click TOTAL: ${ms(s.clickMs)} across ${String(s.rings)} ring(s)`,
    `rings ${ms(s.ringSumMs)}`,
    `page-residual ${ms(s.pageResidualMs)} (${pct(share)})`,
  ].join(" · ");
}
