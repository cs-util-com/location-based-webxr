import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  featureMatchActions as A,
  initialFeatureMatchState,
  MAX_CRASHES,
  planResultKeys,
} from "./feature-match-slice";
import { WorkerCrashed } from "./measure-client";
import {
  doneOf,
  flush as settle,
  harness,
  result,
  shot,
} from "../../test-support/measure-queue-harness";
import { planShots } from "./run-plan";

const SHOTS = planShots(initialFeatureMatchState({ session: "s1" }).plan).map(
  (s) => s.id,
);

type Step =
  | { readonly kind: "shot"; readonly shot: number; readonly photo: number }
  | { readonly kind: "answer"; readonly outcome: "done" | "failed" | "crash" }
  | { readonly kind: "speed" }
  | { readonly kind: "restore" };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("shot" as const),
      shot: fc.nat(SHOTS.length - 1),
      photo: fc.nat(30),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("answer" as const),
      outcome: fc.constantFrom(
        "done" as const,
        "failed" as const,
        "crash" as const,
      ),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: "speed" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "restore" as const }) },
);

// Why (model-based property): with any order of shots, retakes, speed
// runs and worker answers, the queue starts nothing before the restore,
// never has two pairs in the worker, never measures a result key twice,
// starts nothing while a speed run holds the device, stops after two
// crashes in a row, and otherwise drains: every ready pair gets a result.
describe("the measuring queue (model-based)", () => {
  it("measures each ready pair once, one at a time, and drains", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 40 }), async (steps) => {
        const h = harness();
        const sent = new Set<string>();
        let answered = 0;
        let crashesInRow = 0;
        // Pairs started while a speed run held the device: must stay 0.
        let startedDuringSpeed = 0;
        const check = () => {
          const open = h.calls.length - answered;
          expect(open).toBeLessThanOrEqual(1);
          for (const c of h.calls.slice(sent.size)) {
            expect(c.key).not.toBeNull();
            expect(sent.has(c.key!)).toBe(false);
            sent.add(c.key!);
          }
          expect(h.state().restored || h.calls.length === 0).toBe(true);
        };
        const answer = async (outcome: "done" | "failed" | "crash") => {
          const c = h.calls[answered];
          if (c === undefined) {
            return;
          }
          answered++;
          if (outcome === "crash") {
            crashesInRow++;
            c.reject(new WorkerCrashed("stopped"));
          } else {
            crashesInRow = 0;
            c.resolve(
              doneOf([result("sift", outcome === "failed" ? "init: x" : null)]),
            );
          }
          await settle();
        };
        for (const s of steps) {
          if (s.kind === "shot") {
            h.store.dispatch(shot(SHOTS[s.shot]!, `p${String(s.photo)}`));
          } else if (s.kind === "restore") {
            h.store.dispatch(
              A.restoreFinished({ stored: [], results: {}, log: [] }),
            );
          } else if (s.kind === "speed") {
            const before = h.calls.length;
            h.store.dispatch(A.runStarted("speed"));
            await settle();
            // While the speed run holds the device the queue starts nothing.
            if (h.state().running !== null) {
              startedDuringSpeed += h.calls.length - before;
            }
            h.store.dispatch(A.runFinished({ text: "done" }));
          } else {
            await answer(s.outcome);
          }
          await settle();
          check();
        }
        h.store.dispatch(
          A.restoreFinished({ stored: [], results: {}, log: [] }),
        );
        await settle();
        check();
        while (answered < h.calls.length) {
          await answer("done");
          check();
        }
        expect(startedDuringSpeed).toBe(0);
        const st = h.state();
        const stopped = st.queue.crashes >= MAX_CRASHES;
        expect(!stopped || crashesInRow >= MAX_CRASHES).toBe(true);
        const missing = stopped
          ? []
          : [...planResultKeys(st.plan).keys()].filter(
              (k) => st.results[k] === undefined,
            );
        expect(missing).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});
