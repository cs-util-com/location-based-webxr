/**
 * Why this test matters: the run's actions arrive in any order a person
 * and a trainer can produce - stop while a stretch finishes, train again
 * during a run, late events from a stopped attempt. Whatever the order,
 * a finished stretch must never train again unless someone asked for
 * exactly that, the queue must never hold a stretch twice, and at most
 * one stretch trains at a time.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { judged, storeAt } from "../test-support/splat-trainer-fixtures.js";
import {
  currentWindow,
  secondsLeftInRun,
  trainerPageActions as A,
  type TrainerPageState,
} from "./trainer-page-slice.js";

const VERDICTS = ["good", "weak", "poor"] as const;

const command = fc.oneof(
  fc.record({ k: fc.constant("finish"), v: fc.constantFrom(...VERDICTS) }),
  fc.record({ k: fc.constant("lateFinish"), w: fc.nat(7), attempt: fc.nat(3) }),
  fc.record({ k: fc.constant("progress"), f: fc.double({ noNaN: false }) }),
  fc.record({ k: fc.constant("stopAsk") }),
  fc.record({ k: fc.constant("stopKeep") }),
  fc.record({ k: fc.constant("stopYes"), w: fc.nat(7) }),
  fc.record({ k: fc.constant("continue") }),
  fc.record({ k: fc.constant("again"), w: fc.nat(7) }),
  fc.record({
    k: fc.constant("decide"),
    w: fc.nat(7),
    d: fc.constantFrom("keep", "discard", null),
  }),
);

type Command = typeof command extends fc.Arbitrary<infer C> ? C : never;
type Store = ReturnType<typeof storeAt>;

function run(store: Store, c: Command): void {
  const s = store.getState();
  const cur = currentWindow(s);
  switch (c.k) {
    case "finish":
      if (cur === undefined) return;
      store.dispatch(
        A.windowFinished({
          id: cur.id,
          attempt: cur.attempt,
          outcome: "finished",
          metrics: null,
          judgement: judged(c.v),
          trainingS: 10,
        }),
      );
      return;
    case "lateFinish":
      store.dispatch(
        A.windowFinished({
          id: `w${c.w}`,
          attempt: c.attempt,
          outcome: "finished",
          metrics: null,
          judgement: judged("good"),
          trainingS: 10,
        }),
      );
      return;
    case "progress":
      if (cur === undefined) return;
      store.dispatch(
        A.progressed({
          id: cur.id,
          attempt: cur.attempt,
          fraction: c.f,
          secondsLeft: c.f,
          previewEveryS: null,
          stage: "training",
        }),
      );
      return;
    case "stopAsk":
      store.dispatch(A.stopAsked());
      return;
    case "stopKeep":
      store.dispatch(A.stopDismissed());
      return;
    case "stopYes":
      store.dispatch(A.stopConfirmed({ id: `w${c.w}` }));
      return;
    case "continue":
      store.dispatch(A.continued());
      return;
    case "again":
      store.dispatch(A.trainAgainAsked({ id: `w${c.w}` }));
      return;
    case "decide":
      store.dispatch(A.decided({ id: `w${c.w}`, decision: c.d }));
      return;
  }
}

function checkInvariants(s: TrainerPageState): void {
  // The bar shows this as minutes: never NaN or Infinity.
  const left = secondsLeftInRun(s);
  expect(left === null || Number.isFinite(left)).toBe(true);
  expect(new Set(s.queue).size).toBe(s.queue.length);
  if (s.current !== null) expect(s.queue).not.toContain(s.current);
  const training = s.windows.filter((w) => w.status === "training");
  expect(training.length).toBeLessThanOrEqual(1);
  expect(training[0]?.id ?? null).toBe(s.current);
  for (const id of s.queue) {
    expect(s.windows.find((w) => w.id === id)?.status).not.toBe("done");
  }
  if (s.phase === "done") {
    expect(s.current).toBeNull();
    expect(s.queue).toEqual([]);
  }
  for (const w of s.windows) {
    expect(w.progress).toBeGreaterThanOrEqual(0);
    expect(w.progress).toBeLessThanOrEqual(1);
    if (w.decision !== null) expect(w.judgement?.verdict).toBe("poor");
  }
  // Every stretch is accounted for exactly once: finished, training,
  // queued, or (only before the run reaches it) waiting in the queue.
  if (s.phase === "training" || s.phase === "stopped") {
    for (const w of s.windows) {
      const placed =
        w.status === "done" || w.id === s.current || s.queue.includes(w.id);
      expect(placed || s.held).toBe(true);
    }
  }
}

describe("the run's invariants under any order of actions (property)", () => {
  it("holds them, and never re-runs a finished stretch nobody asked to", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.array(command, { maxLength: 80 }),
        (n, commands) => {
          const store = storeAt(n);
          store.dispatch(A.trainingStarted());
          for (const c of commands) {
            const before = store.getState();
            const doneBefore = new Set(
              before.windows
                .filter((w) => w.status === "done")
                .map((w) => w.id),
            );
            run(store, c);
            const after = store.getState();
            // A finished stretch is unfinished again only by "train again" for it.
            const reopened = after.windows
              .filter((w) => doneBefore.has(w.id) && w.status !== "done")
              .map((w) => w.id);
            const allowed =
              c.k === "again" ? reopened.filter((id) => id === `w${c.w}`) : [];
            expect(reopened).toEqual(allowed);
            checkInvariants(after);
          }
        },
      ),
    );
  });
});
