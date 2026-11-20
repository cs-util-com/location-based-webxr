import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { stepStates, type FlowState } from "./bench-steps";

const flow = (over: Partial<FlowState>): FlowState => ({
  a: false,
  b: false,
  run: "none",
  saved: false,
  ...over,
});

// Why these tests matter: the guided flow exists so no step is forgotten;
// exactly one step is current until everything is done, and a step only
// shows done once its work exists.
describe("stepStates", () => {
  it("walks photo A, photo B, run, save", () => {
    expect(stepStates(flow({}))).toEqual(["current", "todo", "todo", "todo"]);
    expect(stepStates(flow({ a: true }))).toEqual([
      "done",
      "current",
      "todo",
      "todo",
    ]);
    expect(stepStates(flow({ a: true, b: true, run: "running" }))).toEqual([
      "done",
      "done",
      "current",
      "todo",
    ]);
    expect(stepStates(flow({ a: true, b: true, run: "done" }))).toEqual([
      "done",
      "done",
      "done",
      "current",
    ]);
    expect(
      stepStates(flow({ a: true, b: true, run: "done", saved: true })),
    ).toEqual(["done", "done", "done", "done"]);
  });

  it("keeps a failed run current", () => {
    expect(stepStates(flow({ a: true, b: true, run: "failed" }))[2]).toBe(
      "current",
    );
  });

  it("has one current step until all are done, and done only after every earlier step", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<FlowState["run"]>("none", "running", "done", "failed"),
        fc.boolean(),
        (a, b, run, saved) => {
          const s = stepStates({ a, b, run, saved });
          expect(s.filter((x) => x === "current").length).toBeLessThanOrEqual(
            1,
          );
          // Once a step is not done, no later step is.
          const firstOpen = s.findIndex((x) => x !== "done");
          const tail = firstOpen < 0 ? [] : s.slice(firstOpen);
          expect(tail.filter((x) => x === "done")).toEqual([]);
          expect(tail[0]).toBe(firstOpen < 0 ? undefined : "current");
        },
      ),
    );
  });
});
