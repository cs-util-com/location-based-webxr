/**
 * The draft question's transitions over random sequences of reads,
 * answers, reopens and closes (`tour-draft-slice.ts`).
 *
 * Why this property matters: on both pages a read, a Restore and a
 * "Delete it" end asynchronously, so their answers arrive in any order
 * against reopens and closes. Whatever the order: an answer of an earlier
 * question changes nothing; the offer's words exist exactly while the
 * draft is undecided; "Delete it" runs only on a showing offer; no answer
 * lands while it runs; a decided or deleted draft is never offered again
 * within its question; and each status is reached only from where its
 * answer may come: Restore from an undecided draft, a deleted one from a
 * running "Delete it", an offer from a read or a put-off offer.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { tourDocumentActions } from "./tour-document.js";
import {
  initialTourDraftState,
  tourDraftActions as a,
  tourDraftReducer,
  type TourDraftState,
} from "./tour-draft-slice.js";

/** A step and the question it names: the present one, or one earlier
 *  (a late answer). */
type Step =
  | { kind: "read" | "end" | "close" }
  | { kind: "count"; count: number }
  | {
      kind:
        | "found"
        | "none"
        | "unavailable"
        | "restore"
        | "decline"
        | "reshow"
        | "deleteStart"
        | "deleteLanded"
        | "deleteFailed";
      late: number;
    };

const answer = fc.record({
  kind: fc.constantFrom(
    "found",
    "none",
    "unavailable",
    "restore",
    "decline",
    "reshow",
    "deleteStart",
    "deleteLanded",
    "deleteFailed",
  ),
  late: fc.constantFrom(0, 0, 1, 1, 2),
});

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom({ kind: "read" as const }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      { kind: "end" as const },
      { kind: "close" as const },
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: 0, max: 3 })
      .map((count) => ({ kind: "count" as const, count })),
  },
  { weight: 6, arbitrary: answer },
);

function actionOf(s: Step, state: TourDraftState) {
  switch (s.kind) {
    case "read":
      return a.readStarted();
    case "end":
      return a.questionEnded();
    case "close":
      return tourDocumentActions.closed();
    case "count":
      return a.editsWaitingChanged({ count: s.count });
  }
  const generation = state.generation - s.late;
  switch (s.kind) {
    case "found":
      return a.found({ generation, text: `words ${generation}` });
    case "none":
      return a.noneFound({ generation });
    case "unavailable":
      return a.unavailable({ generation, reason: "storage" });
    case "restore":
      return a.restored({ generation });
    case "decline":
      return a.declined({ generation });
    case "reshow":
      return a.reshown({ generation });
    case "deleteStart":
      return a.deleteStarted({ generation });
    case "deleteLanded":
      return a.deleteEnded({ generation, landed: true });
    case "deleteFailed":
      return a.deleteEnded({ generation, landed: false });
  }
}

const undecided = (s: TourDraftState) =>
  s.status === "offered" || s.status === "declined";

describe("the draft question over random sequences", () => {
  it("keeps every answer to its own question, and its invariants", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        let state = initialTourDraftState;
        /** Statuses this question has decided: never offered again. */
        let decidedInQuestion = false;
        for (const s of steps) {
          const before = state;
          const action = actionOf(s, state);
          state = tourDraftReducer(state, action);
          const late = "late" in s && s.late > 0;
          // A late answer changes nothing at all.
          expect(late ? state : before).toEqual(before);
          // Only a read or an end moves the question, by one.
          const moves =
            s.kind === "read" || s.kind === "end" || s.kind === "close";
          expect(state.generation).toBe(before.generation + (moves ? 1 : 0));
          if (moves) decidedInQuestion = false;
          // The words exist exactly while undecided; the reason exactly
          // while unavailable; "Delete it" runs only on a showing offer.
          expect(state.text !== null).toBe(undecided(state));
          expect(state.reason !== null).toBe(state.status === "unavailable");
          expect(!state.deleting || state.status === "offered").toBe(true);
          // Nothing but its end answers while "Delete it" runs.
          const heldByDelete =
            before.deleting &&
            !moves &&
            s.kind !== "deleteLanded" &&
            s.kind !== "deleteFailed";
          expect(heldByDelete ? state.status : before.status).toBe(
            before.status,
          );
          if (
            before.status !== state.status &&
            (state.status === "restored" ||
              (state.status === "none" && before.deleting))
          ) {
            decidedInQuestion = true;
          }
          expect(decidedInQuestion && undecided(state)).toBe(false);
          // Where each status comes from, within the question.
          const changed = !moves && state.status !== before.status;
          expect(
            !changed || state.status !== "restored" || undecided(before),
            "Restore only from an undecided draft",
          ).toBe(true);
          expect(
            !changed ||
              before.status !== "offered" ||
              state.status !== "none" ||
              before.deleting,
            "an offer ends as none only through Delete it",
          ).toBe(true);
          expect(
            !changed ||
              state.status !== "offered" ||
              (before.status === "reading"
                ? s.kind === "found"
                : before.status === "declined" &&
                  (s.kind === "reshow" || s.kind === "count")),
            "an offer from a read or a put-off offer",
          ).toBe(true);
          expect(state.editsWaiting).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("shows a put-off offer again whenever an edit waits", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        let state = initialTourDraftState;
        for (const s of steps) {
          state = tourDraftReducer(state, actionOf(s, state));
          expect(state.editsWaiting > 0 && state.status === "declined").toBe(
            false,
          );
        }
      }),
      { numRuns: 300 },
    );
  });
});
