import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { DEFAULT_PLAN, type SpikeResult } from "./worker-spike-model";
import {
  createWorkerSpikeStore,
  workerSpikeActions as A,
  type SpikePhase,
} from "./worker-spike-slice";

const result: SpikeResult = {
  camera: { verdict: "unknown", text: "" },
  xfeat: { started: false, text: "" },
  methods: [],
  notice: null,
};
const error = { message: "m", todo: "t" };

const action = fc.oneof(
  fc.constant(A.cameraOn()),
  fc.constant(A.cameraFailed(error)),
  fc.integer().map((n) => A.runStarted(n)),
  fc.constant(A.stepBegan({ step: { kind: "photos", taken: 0 }, now: 1 })),
  fc.constant(A.stepBegan({ step: { kind: "pairs", done: 0 }, now: 1 })),
  fc.constant(A.photoTaken()),
  fc.constant(A.pairMeasured({ ms: 10, now: 2 })),
  fc.constant(A.finished(result)),
  fc.constant(A.runFailed(error)),
);

/** How far a phase is along; a run never goes back. */
const order: Record<SpikePhase, number> = {
  starting: 0,
  ready: 1,
  running: 2,
  done: 3,
  failed: 3,
};

describe("worker spike slice properties", () => {
  // Why: whatever order the page's callbacks fire in, the run only moves
  // forward, ends once, and never counts more pairs than planned.
  it("any action sequence keeps the run's rules", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.array(action, { maxLength: 60 }),
        (pairs, actions) => {
          const store = createWorkerSpikeStore({ ...DEFAULT_PLAN, pairs });
          let last = store.getState();
          for (const a of actions) {
            store.dispatch(a);
            const s = store.getState();
            expect(order[s.phase]).toBeGreaterThanOrEqual(order[last.phase]);
            const ended = last.phase === "done" || last.phase === "failed";
            expect(ended ? s.phase : last.phase).toBe(last.phase);
            const pairsDone = s.step?.kind === "pairs" ? s.step.done : 0;
            expect(pairsDone).toBeLessThanOrEqual(pairs);
            expect(
              s.phase === "running" ||
                s.phase === "done" ||
                s.phase === "failed" ||
                s.step === null,
            ).toBe(true);
            last = s;
          }
        },
      ),
    );
  });
});
