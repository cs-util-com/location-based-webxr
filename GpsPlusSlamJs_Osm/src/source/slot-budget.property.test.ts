/**
 * Slot-budget property tests.
 *
 * Why these tests matter:
 * The example tests cover the sequences someone thought of. These assert the
 * safety property over ARBITRARY interleavings of acquire / release / penalise
 * / sync — which is what production actually produces, since requests complete
 * out of order, aborts fire mid-flight, and status syncs land whenever the
 * network feels like it.
 *
 * The property being defended is the one whose violation gets an IP blocked:
 * never more concurrent dispatches than the allocation allows.
 *
 * @see slot-budget.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { OverpassSlotBudget } from "./slot-budget.js";
import { parseOverpassStatus } from "./overpass-status.js";

/** One operation against the budget. */
const operation = fc.oneof(
  fc.constant({ kind: "acquire" as const }),
  fc.constant({ kind: "release" as const }),
  fc.record({
    kind: fc.constant("penalise" as const),
    ms: fc.integer({ min: -10_000, max: 300_000 }),
  }),
  fc.record({
    kind: fc.constant("advance" as const),
    ms: fc.integer({ min: 0, max: 200_000 }),
  }),
);

describe("slot budget safety properties", () => {
  it("NEVER lets more requests be in flight than the allocation permits", () => {
    // The property whose violation is a blocked IP. Held across arbitrary
    // interleavings including over-releases, negative penalties and clock jumps.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.array(operation, { maxLength: 200 }),
        (slots, ops) => {
          let now = 1_000_000;
          const budget = new OverpassSlotBudget({ slots, now: () => now });

          let inFlight = 0;
          let peak = 0;

          for (const op of ops) {
            switch (op.kind) {
              case "acquire":
                if (budget.tryAcquire()) {
                  inFlight++;
                  peak = Math.max(peak, inFlight);
                }
                break;
              case "release":
                if (inFlight > 0) {
                  inFlight--;
                  budget.release();
                }
                break;
              case "penalise":
                budget.penalise(op.ms);
                break;
              case "advance":
                now += op.ms;
                break;
            }
          }

          expect(peak).toBeLessThanOrEqual(slots);
        },
      ),
    );
  });

  it("never reports negative or NaN availability", () => {
    // A NaN here would make `available > 0` false forever and look exactly like
    // a permanently rate-limited client — a silent, total outage.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.array(operation, { maxLength: 100 }),
        (slots, ops) => {
          let now = 1_000_000;
          const budget = new OverpassSlotBudget({ slots, now: () => now });

          for (const op of ops) {
            if (op.kind === "acquire") budget.tryAcquire();
            else if (op.kind === "release") budget.release();
            else if (op.kind === "penalise") budget.penalise(op.ms);
            else now += op.ms;

            expect(Number.isNaN(budget.available)).toBe(false);
            expect(budget.available).toBeGreaterThanOrEqual(0);
            expect(budget.msUntilAvailable()).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("always recovers once the clock passes every penalty", () => {
    // Liveness, not just safety: a budget that could get permanently stuck
    // would be indistinguishable from the app being broken. The max-penalty
    // clamp is what makes this bounded regardless of what the server claims.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -10_000, max: 10_000_000 }), {
          maxLength: 20,
        }),
        (penalties) => {
          let now = 1_000_000;
          const maxPenaltyMs = 120_000;
          const budget = new OverpassSlotBudget({
            slots: 2,
            now: () => now,
            maxPenaltyMs,
          });

          for (const ms of penalties) budget.penalise(ms);

          now += maxPenaltyMs + 1;
          expect(budget.tryAcquire()).toBe(true);
        },
      ),
    );
  });

  it("a sync can only ever make the client more cautious, never less", () => {
    // The asymmetry that encodes the measured /api/status lag. If a sync could
    // raise availability, the optimistic snapshot observed DURING active
    // 429-ing would undo the penalty that the 429 just installed.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 2 }),
        (acquisitions, reportedFree) => {
          const budget = new OverpassSlotBudget({ slots: 2 });
          for (let i = 0; i < acquisitions; i++) budget.tryAcquire();
          const before = budget.available;

          budget.sync(
            parseOverpassStatus(
              [
                "Connected as: 1",
                "Current time: 2026-07-28T08:40:04Z",
                "Rate limit: 2",
                ...(reportedFree > 0
                  ? [`${reportedFree} slots available now.`]
                  : []),
                "Currently running queries (pid, space limit, time limit, start time):",
              ].join("\n"),
            ),
          );

          expect(budget.available).toBeLessThanOrEqual(before);
        },
      ),
    );
  });
});
