import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { type BackdropId, draftOf } from "./maker-draft.js";
import {
  makerActions as A,
  makerReducer,
  makerStateFrom,
  type MakerState,
} from "./maker-slice.js";

type Action = Parameters<typeof makerReducer>[1];

/** Any sequence the page can dispatch, including values it never sends. */
const action: fc.Arbitrary<Action> = fc.oneof(
  fc.integer({ min: -2, max: 8 }).map((i) => A.went(i)),
  fc.integer({ min: -2, max: 8 }).map((i) => A.reached(i)),
  // Short texts, and texts around the description cap (2000), so the cap
  // itself is tested: plain fc.string rarely reaches that length.
  fc
    .oneof(
      fc.string({ maxLength: 40 }),
      fc.string({ minLength: 1990, maxLength: 2500 }),
    )
    .map((t) => A.descChanged(t)),
  fc.oneof(fc.nat(), fc.constant(Number.NaN)).map((t) => A.copied(t)),
  fc.constant(A.copyRefused()),
  fc.constant(A.cutStarted()),
  fc.constant(A.cutFinished()),
  fc.string({ maxLength: 40 }).map((m) => A.cutFailed(m)),
  fc.constant(A.cutAborted()),
  fc.constant(A.cutReplaced()),
  fc.constantFrom("drawn", "steady").map((c) => A.talkChosen(c)),
  fc
    .constantFrom("meadow", "autumn", "city", "snow", "mars")
    .map((g) => A.groundChosen(g as BackdropId)),
  fc
    .record({
      whiteTol: fc.integer({ min: -50, max: 300 }),
      shadowOn: fc.boolean(),
      shadowFloor: fc.integer({ min: -50, max: 300 }),
      islandMin: fc.integer({ min: -50, max: 5000 }),
      edgeSoft: fc.integer({ min: -5, max: 20 }),
    })
    .map((c) => A.cutChanged(c)),
  fc.constant(A.cutReset()),
  fc.string({ maxLength: 40 }).map((n) => A.named(n)),
  fc.nat().map((t) => A.left(t)),
  fc.constant(A.startedAnother()),
);

/** Every state on the way, the first one included. */
const runAll = (actions: readonly Action[]): MakerState[] => {
  let s = makerStateFrom(null);
  const states = [s];
  for (const a of actions) {
    s = makerReducer(s, a);
    states.push(s);
  }
  return states;
};
const finalOf = (actions: readonly Action[]): MakerState =>
  actions.reduce((s, a) => makerReducer(s, a), makerStateFrom(null));

describe("maker-slice properties", () => {
  // Why: whatever the page dispatches, the step stays one of the six and the
  // furthest step reached one of the first four, and steps 5 and 6 (the
  // check and the save) are never shown without a cut to check or save.
  it("keeps the step in range and the last two steps behind a cut", () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
        const states = runAll(actions);
        for (const s of states) {
          expect(s.draft.step).toBeGreaterThanOrEqual(0);
          expect(s.draft.step).toBeLessThanOrEqual(5);
          expect(s.draft.maxStep).toBeGreaterThanOrEqual(0);
          expect(s.draft.maxStep).toBeLessThanOrEqual(3);
        }
        // The cut status before every step change that entered step 5 or 6.
        const entered = actions.flatMap((a, i) =>
          (A.went.match(a) || A.reached.match(a)) &&
          (states[i + 1]?.draft.step ?? 0) >= 4
            ? [states[i]?.cut]
            : [],
        );
        expect(entered).toEqual(entered.map(() => "ready"));
      }),
    );
  });

  // Why: the listener stores the draft as JSON and the next page load reads
  // it back field by field; any draft the reducers make survives that trip
  // unchanged, so a reload never loses or alters what the author made.
  it("keeps every draft it makes through storage", () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
        const { draft } = finalOf(actions);
        expect(draftOf(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
      }),
    );
  });

  // Why: Undo hands back a draft taken earlier in the same session; the
  // reducer reads it field by field, so it must take back any earlier draft
  // as it was.
  it("restores any earlier draft as it was", () => {
    fc.assert(
      fc.property(
        fc.array(action, { minLength: 1, maxLength: 30 }),
        fc.nat(),
        fc.boolean(),
        (actions, pick, hadCut) => {
          const states = runAll(actions);
          const earlier = states[pick % states.length]?.draft;
          expect(earlier).toBeDefined();
          const back = makerReducer(
            finalOf(actions),
            A.restored({ draft: earlier!, hadCut }),
          );
          expect(back.draft).toEqual(earlier);
        },
      ),
    );
  });
});
