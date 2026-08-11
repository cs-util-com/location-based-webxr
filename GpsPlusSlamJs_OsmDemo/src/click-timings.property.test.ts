/**
 * `composeClickTimings` — the invariants that must hold for ANY inputs.
 *
 * Why this test matters: this module's prose makes four absolute claims —
 * the stages plus the residual equal the wall clock exactly, no stage is
 * negative, every share is a fraction of the whole, and no stage is altered on
 * its way through. All four were written in comments and enforced by
 * example-based tests over one hand-tuned fixture, which is the configuration
 * where an arithmetic edge (a zero wall clock, an over-reporting worker, a
 * stage larger than the whole) is least likely to be tried.
 *
 * The library half of this same work shipped `tile-timings.property.test.ts`
 * and it earned its keep on the first run by producing `transportMs: -1`
 * against a design whose entire justification was avoiding that. The same rule
 * applies here, and this is the more arithmetic of the two modules.
 *
 * @see click-timings.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  composeClickTimings,
  describeClickTimings,
  type ClickTimingInput,
} from "./click-timings.js";
import { ZERO_STAGE_TIMINGS } from "./snapshot-timings-fixture.js";

/** Non-negative durations, the shape a real clock produces. */
const duration = fc.integer({ min: 0, max: 120_000 });

/** Any number at all, including negative — an adversarial or skewed clock. */
const anyNumber = fc.integer({ min: -50_000, max: 120_000 });

const arbInput = (n: fc.Arbitrary<number>): fc.Arbitrary<ClickTimingInput> =>
  fc.record({
    radius: fc.integer({ min: 2, max: 4 }),
    pipeline: fc.record({
      transportMs: n,
      decodeMs: n,
      parseMs: n,
      storeMs: n,
      probeMs: n,
      slotWaitMs: n,
      joinedMs: n,
      fetchMs: n,
      mergeMs: n,
      scoreMs: n,
      deriveMs: n,
      pipelineMs: n,
      tilesFetched: fc.integer({ min: 0, max: 3 }),
      tilesHeld: fc.integer({ min: 0, max: 20 }),
      tilesFromNetwork: fc.integer({ min: 0, max: 3 }),
      tilesFromCache: fc.integer({ min: 0, max: 3 }),
      tilesUnmeasured: fc.integer({ min: 0, max: 3 }),
    }),
    worker: fc.record({
      terrainWaitMs: n,
      meshMs: n,
      prefetchMs: n,
      queueMs: n,
      workerTotalMs: n,
    }),
    roundTripMs: n,
    drawMs: n,
  });

describe("the reconciliation identity holds for any inputs", () => {
  it("derives the residual from the INPUTS, not from its own output", () => {
    // REWRITTEN. The first version read `wallMs` and the stage list off the
    // RESULT and asserted `residualMs === wallMs - Σstages` — the
    // implementation's own two lines compared against themselves. It could not
    // fail for any input, including one where a stage was missing or doubled,
    // while its comment called it "the one thing the whole instrument rests
    // on".
    //
    // That is the fourth assertion-that-cannot-fail on this branch, and the
    // SECOND in this exact form: the sibling unit-test file documents removing
    // the identical circularity a few commits earlier. The rule this file now
    // encodes: an expectation rebuilt from the INPUT can disagree with the
    // code; one rebuilt from the OUTPUT cannot.
    //
    // The algebra is the module header's — residual = workerTotal − Σ(worker
    // stages), with page time and `queue` cancelling.
    fc.assert(
      fc.property(arbInput(duration), (input) => {
        const p = input.pipeline;
        const w = input.worker;
        const enumeratedInWorker =
          p.slotWaitMs +
          p.transportMs +
          p.decodeMs +
          p.parseMs +
          p.probeMs +
          p.storeMs +
          p.joinedMs +
          p.mergeMs +
          p.scoreMs +
          p.deriveMs +
          w.terrainWaitMs +
          w.meshMs +
          w.prefetchMs;
        // `fc.pre` DISCARDS the case rather than skipping the assertion. An
        // `if` around `expect` would let the property pass vacuously if the
        // precondition stopped holding — and a conditional expect is how a
        // property test quietly stops testing anything.
        //
        // The precondition: nothing was clamped. A clamped boundary breaks the
        // identity deliberately, and that case has its own unit test.
        fc.pre(input.roundTripMs - w.workerTotalMs - w.queueMs >= 0);
        const t = composeClickTimings(input);
        expect(t.residualMs).toBeCloseTo(
          w.workerTotalMs - enumeratedInWorker,
          6,
        );
      }),
      { numRuns: 300 },
    );
  });

  it("keeps stages plus residual equal to the wall clock", () => {
    // KEPT, but labelled honestly as the weaker companion: an
    // internal-consistency check, not an independent one. It catches a future
    // edit that makes `residualMs` something other than `wall - Σstages`; it
    // cannot catch a wrong or incomplete stage list, which is what the previous
    // version's comment implied it did.
    fc.assert(
      fc.property(arbInput(anyNumber), (input) => {
        const t = composeClickTimings(input);
        const summed = t.stages.reduce((sum, s) => sum + s.ms, 0);
        expect(summed + t.residualMs).toBeCloseTo(t.wallMs, 6);
      }),
      { numRuns: 200 },
    );
  });

  it("never emits a negative stage, even from a skewed clock", () => {
    // A negative stage makes the sum close by CANCELLING, so the identity above
    // would still hold while two numbers were wrong — the failure mode that
    // silences the gate exactly when it should shout.
    fc.assert(
      fc.property(arbInput(anyNumber), (input) => {
        for (const stage of composeClickTimings(input).stages) {
          expect(stage.ms, `${stage.name} was negative`).toBeGreaterThanOrEqual(
            0,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("passes every enumerated stage through unaltered", () => {
    // The non-distribution rule, as a property rather than as five hand-picked
    // stage names. No input may cause the module to reapportion a stage — that
    // would destroy the residual, which is the output that matters most.
    fc.assert(
      fc.property(arbInput(duration), (input) => {
        const byName = new Map(
          composeClickTimings(input).stages.map((s) => [s.name, s.ms]),
        );
        expect(byName.get("fetch")).toBe(input.pipeline.transportMs);
        expect(byName.get("parse")).toBe(input.pipeline.parseMs);
        expect(byName.get("merge")).toBe(input.pipeline.mergeMs);
        expect(byName.get("score")).toBe(input.pipeline.scoreMs);
        expect(byName.get("derive")).toBe(input.pipeline.deriveMs);
        expect(byName.get("terrain-wait")).toBe(input.worker.terrainWaitMs);
        expect(byName.get("mesh")).toBe(input.worker.meshMs);
        expect(byName.get("draw")).toBe(input.drawMs);
      }),
      { numRuns: 200 },
    );
  });

  it("never claims to reconcile a pass that measured nothing", () => {
    // §0.2's "silence reads as measured", in the one artefact the owner reads.
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), (radius) => {
        const nothing = composeClickTimings({
          radius,
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
      }),
      { numRuns: 10 },
    );
  });

  it("always produces a line that names the ring and the residual", () => {
    // The console line is the deliverable. It must not throw, and it must not
    // silently omit the residual, whatever the numbers are.
    fc.assert(
      fc.property(arbInput(anyNumber), (input) => {
        const line = describeClickTimings(composeClickTimings(input));
        expect(line).toContain("click ring ");
        expect(line).toContain("residual ");
      }),
      { numRuns: 200 },
    );
  });
});
