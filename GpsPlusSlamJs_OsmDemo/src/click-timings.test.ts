/**
 * `click-timings.ts` — the reconciliation, and the arithmetic that must not lie.
 *
 * Why these tests matter: this module is the plan's correctness gate. §0.3 item
 * 2 says "draw no conclusion from a breakdown that does not add up", and the
 * only way that rule has teeth is if the residual is DERIVED from a separately
 * measured whole rather than back-filled to make the sum close. Every assertion
 * here is about a way the arithmetic could quietly close a gap that is really
 * there.
 *
 * Being a pure function is what makes it testable at all: the composition can
 * be driven with exact numbers, which is the half of §5's seeded-clock mandate
 * that the source-level tests could not reach — there, a fake clock can charge
 * `response.text()` but not `JSON.parse`.
 *
 * @see click-timings.ts.md
 */

import { describe, it, expect } from "vitest";
import {
  composeClickTimings,
  describeClickTimings,
  type ClickTimingInput,
} from "./click-timings.js";
import { ZERO_STAGE_TIMINGS } from "./snapshot-timings-fixture.js";

/** A pass where every stage costs a distinct, recognisable amount. */
const INPUT: ClickTimingInput = {
  radius: 2,
  pipeline: {
    ...ZERO_STAGE_TIMINGS,
    transportMs: 400,
    decodeMs: 100,
    parseMs: 200,
    storeMs: 30,
    probeMs: 20,
    slotWaitMs: 10,
    joinedMs: 0,
    fetchMs: 800,
    mergeMs: 40,
    scoreMs: 300,
    deriveMs: 100,
    pipelineMs: 1200,
    tilesFetched: 1,
    tilesHeld: 1,
    tilesFromNetwork: 1,
  },
  worker: {
    terrainWaitMs: 500,
    meshMs: 250,
    prefetchMs: 0,
    queueMs: 0,
    // Pipeline stages sum to 1200, plus 750 of worker stages = 1950. A worker
    // total of 1960 leaves a 10 ms residual: small, deliberate, and inside the
    // tolerance, so this fixture is a RECONCILING pass.
    workerTotalMs: 1960,
  },
  roundTripMs: 2200,
  drawMs: 50,
};

describe("composeClickTimings reconciles against a measured whole", () => {
  it("computes the wall clock and residual from INDEPENDENT expectations", () => {
    // REWRITTEN AFTER REVIEW, because the first version was circular: it read
    // `wallMs` and the stage list off the RESULT and asserted
    // `residualMs === wallMs - Σstages` — which is the implementation's own two
    // lines compared against themselves, and passes for any wrong or
    // incomplete stage list. Every number below is derived from `INPUT`
    // instead, so the test can disagree with the code.
    const t = composeClickTimings(INPUT);

    expect(t.wallMs).toBe(INPUT.roundTripMs + INPUT.drawMs);
    expect(t.residualMs).toBeCloseTo(10, 6);
    expect(t.reconciles).toBe(true);
  });

  it("derives the BOUNDARY term rather than timestamping across the worker", () => {
    // `performance.now()` in a dedicated worker is relative to the WORKER's
    // timeOrigin, so subtracting a worker timestamp from a page one yields an
    // offset rather than a duration. The boundary term is therefore the round
    // trip minus the queue wait minus
    // what the worker says it spent — durations, each measured wholly on
    // one side.
    const t = composeClickTimings(INPUT);
    const boundary = t.stages.find((s) => s.name === "boundary");

    expect(boundary?.ms).toBe(240); // 2200 round trip - 1960 in the worker
  });

  it("keeps the zeros the plan calls load-bearing, and drops the ones that are noise", () => {
    // The two zeros that discriminate §3's competing predictions: `parse` is
    // genuinely 0 on a cache hit, and `terrain-wait` is 0 on a widening ring
    // and non-zero on a new position. Dropping them would leave the line unable
    // to falsify the thing it exists to test — which the first version did.
    const warmRing3 = composeClickTimings({
      ...INPUT,
      radius: 3,
      pipeline: { ...INPUT.pipeline, parseMs: 0, probeMs: 0 },
      worker: { ...INPUT.worker, terrainWaitMs: 0, meshMs: 0 },
    });
    const line = describeClickTimings(warmRing3);

    expect(line).toContain("parse 0 ms");
    expect(line).toContain("terrain-wait 0 ms");
    expect(line).toContain("mesh 0 ms");
    // …while a zero sub-split of stages 1–2 is noise and stays out.
    expect(line).not.toContain("cache-probe");
  });

  it("makes the residual mean UNENUMERATED WORKER TIME, not vague leftover", () => {
    // Falls out of the algebra rather than being designed in, and it is worth
    // pinning because it makes the instrument sharper than "something is
    // missing": page time cancels, so a non-trivial residual points at the
    // worker handler specifically — which is precisely where the one stage this
    // plan's first draft missed (the terrain join) was hiding.
    // FIXTURE GIVES prefetch A NON-ZERO VALUE, which the first version did not
    // — and that is why it passed against an identity that omitted the term
    // entirely. `prefetchMs` was added to the stage list three commits before
    // this test was written and never added to the algebra here or in the three
    // documents that state it. A zero in a fixture hides a missing term
    // perfectly.
    const t = composeClickTimings({
      ...INPUT,
      worker: { ...INPUT.worker, prefetchMs: 7, workerTotalMs: 1967 },
    });
    const enumeratedInWorker =
      INPUT.pipeline.slotWaitMs +
      INPUT.pipeline.transportMs +
      INPUT.pipeline.decodeMs +
      INPUT.pipeline.parseMs +
      INPUT.pipeline.probeMs +
      INPUT.pipeline.storeMs +
      INPUT.pipeline.joinedMs +
      INPUT.pipeline.mergeMs +
      INPUT.pipeline.scoreMs +
      INPUT.pipeline.deriveMs +
      INPUT.worker.terrainWaitMs +
      INPUT.worker.meshMs +
      7; // prefetch — the term the first version of this identity omitted

    expect(t.residualMs).toBeCloseTo(1967 - enumeratedInWorker, 6);
  });

  it("floors a negative boundary at zero and reports it as unreconciled", () => {
    // The realistic failure: clock skew or a worker that over-reports makes
    // `roundTrip - workerTotal` negative. A negative stage would make the
    // residual close by CANCELLING — the sum would look right while two
    // numbers were wrong — so it is clamped, and the breakdown is flagged so
    // nobody reads a ranking off it.
    const t = composeClickTimings({
      ...INPUT,
      roundTripMs: 1900,
      worker: { ...INPUT.worker, workerTotalMs: 2000 },
    });
    const boundary = t.stages.find((s) => s.name === "boundary");

    expect(boundary?.ms).toBe(0);
    expect(t.reconciles).toBe(false);
  });

  it("computes shares against the WALL CLOCK, not against the sum of stages", () => {
    // If shares were computed against the sum they would always total 100 %,
    // and a breakdown missing a third of the click would look complete. Against
    // the wall clock, a missing stage shows up as shares that do not reach 100.
    const t = composeClickTimings(INPUT);
    const totalShare = t.stages.reduce((sum, s) => sum + s.share, 0);

    expect(totalShare).toBeLessThan(1);
    expect(totalShare + t.residualShare).toBeCloseTo(1, 6);
  });

  it("flags a breakdown that does not add up rather than hiding it", () => {
    // §0.3 item 2: no conclusion may be drawn from a breakdown that does not
    // reconcile. That is only enforceable if the object says so itself.
    // A LARGER ROUND TRIP WOULD NOT DO IT, and finding that out sharpened the
    // test: transfer is DERIVED as `roundTrip - workerTotal`, so extra page-side
    // time is attributed to transfer by construction and the sum still closes.
    // A real gap is worker time that no worker stage claims — which is exactly
    // the shape of an unenumerated stage inside the handler.
    const wild = composeClickTimings({
      ...INPUT,
      roundTripMs: 4000,
      worker: { ...INPUT.worker, workerTotalMs: 3000 },
    });

    expect(wild.reconciles).toBe(false);
    expect(wild.residualMs).toBeGreaterThan(1000);
  });

  it("treats a small residual as reconciled, because measurement is not free", () => {
    // The instrument itself costs a handful of `performance.now()` calls, and
    // the stages do not abut perfectly. A tolerance is honest; a zero tolerance
    // would cry wolf on every click and get ignored, which is worse than not
    // checking.
    const t = composeClickTimings(INPUT);
    expect(t.reconciles).toBe(true);
  });

  it("never distributes the residual across the stages", () => {
    // Named separately because it is the tempting fix when a breakdown does not
    // close, and it destroys the only signal this whole plan is built to
    // produce: where the unmeasured time is.
    // VARIED VIA `workerTotalMs`, not `roundTripMs` — the first version raised
    // the round trip, which cannot move any of the stages it checked because
    // they are verbatim pass-throughs, and omitted `boundary`, the one stage
    // that DOES change under that input. It was the very defect the commit that
    // introduced it congratulated itself on catching, two tests later.
    const withGap = composeClickTimings({
      ...INPUT,
      worker: { ...INPUT.worker, workerTotalMs: 3000 },
      roundTripMs: 4000,
    });
    const baseline = composeClickTimings(INPUT);

    expect(withGap.residualMs).toBeGreaterThan(baseline.residualMs + 500);
    for (const name of [
      "fetch",
      "parse",
      "merge",
      "score",
      "derive",
      "mesh",
      "terrain-wait",
      "draw",
    ]) {
      const before = baseline.stages.find((s) => s.name === name)?.ms;
      const after = withGap.stages.find((s) => s.name === name)?.ms;
      expect(after, `${name} absorbed part of the residual`).toBe(before);
    }
  });

  it("does NOT reconcile a negative residual — over-counting is not better than under", () => {
    // `Math.abs` was the first version and it was wrong: stages summing to MORE
    // than the wall clock means something is double-counted, which is exactly
    // as untrustworthy as something missing. It read `reconciles: true` for a
    // −1.9 % residual.
    const over = composeClickTimings({
      ...INPUT,
      worker: { ...INPUT.worker, workerTotalMs: 1000 },
    });

    expect(over.residualMs).toBeLessThan(-100);
    expect(over.reconciles).toBe(false);
  });

  it("does NOT reconcile a pass that measured nothing at all", () => {
    // §0.2's "silence reads as measured", reproduced in the one artefact the
    // owner is meant to read: an all-zero pass summed to an all-zero whole and
    // declared itself reconciled. An instrument that measured nothing has not
    // verified anything.
    const nothing = composeClickTimings({
      radius: 2,
      pipeline: ZERO_STAGE_TIMINGS,
      worker: {
        terrainWaitMs: 0,
        meshMs: 0,
        prefetchMs: 0,
        workerTotalMs: 0,
        queueMs: 0,
      },
      roundTripMs: 0,
      drawMs: 0,
    });

    expect(nothing.reconciles).toBe(false);
  });

  it("surfaces the fetch-loop mini-residual the plan promised", () => {
    // §10.2 deferred the milestone-1 cache-probe gap specifically because
    // `fetchMs` minus the per-tile parts would expose it — and then the first
    // cut produced `fetchMs` and subtracted nothing from it anywhere, which
    // made that reasoning empty.
    const t = composeClickTimings(INPUT);

    // 800 ms loop; parts inside it sum to 10+400+100+200+20+30+0+40 = 800.
    expect(t.fetchUnattributedMs).toBe(0);

    const leaky = composeClickTimings({
      ...INPUT,
      pipeline: { ...INPUT.pipeline, fetchMs: 950 },
    });
    expect(leaky.fetchUnattributedMs).toBe(150);
  });

  it("keeps the radius, because the three passes are not three of the same thing", () => {
    // Stages 6 and 7 are near-zero on passes 2 and 3 by design — the terrain is
    // already there and the mesh is already built. A per-click sum would hide
    // exactly that, so every line carries the ring it belongs to.
    expect(composeClickTimings({ ...INPUT, radius: 4 }).radius).toBe(4);
  });
});

describe("describeClickTimings is readable at a glance", () => {
  it("leads with the wall clock and gives every stage its share", () => {
    // §0.3 item 1: a stage number without its denominator is the form of
    // evidence this plan exists to replace, and it is easy to emit by accident.
    const line = describeClickTimings(composeClickTimings(INPUT));

    expect(line).toContain("ring 2");
    expect(line).toContain("2250 ms");
    expect(line).toMatch(/fetch \d+ ms \(\d+ %\)/);
    expect(line).toMatch(/parse \d+ ms \(\d+ %\)/);
  });

  it("always prints the residual, even when it is small", () => {
    // §5: the residual is where an unenumerated stage hides, so it is not
    // conditional on being interesting. A line that omits it when small trains
    // the reader to stop looking for it.
    expect(describeClickTimings(composeClickTimings(INPUT))).toContain(
      "residual",
    );
  });

  it("says loudly when the parts do not add up", () => {
    // Otherwise the one output that must never be quietly wrong is quietly
    // wrong: a ranking read off a non-reconciling breakdown is a wrong answer
    // delivered with a decimal point.
    const line = describeClickTimings(
      composeClickTimings({
        ...INPUT,
        roundTripMs: 4000,
        worker: { ...INPUT.worker, workerTotalMs: 3000 },
      }),
    );
    expect(line).toContain("DOES NOT RECONCILE");
  });

  it("names how the tiles were served, so a warm click is not read as cold", () => {
    // The single most likely misreading of this line. "fetch 20 ms" means
    // something entirely different on a cache hit than on a network fetch, and
    // the plan's §3 prediction is specifically about the warm path.
    const line = describeClickTimings(composeClickTimings(INPUT));
    expect(line).toContain("1 net");
  });

  it("flags unmeasured tiles rather than letting them read as free", () => {
    const line = describeClickTimings(
      composeClickTimings({
        ...INPUT,
        pipeline: { ...INPUT.pipeline, tilesUnmeasured: 2 },
      }),
    );
    expect(line).toContain("2 unmeasured");
  });
});
