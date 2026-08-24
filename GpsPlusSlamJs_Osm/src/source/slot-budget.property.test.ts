/**
 * Slot-budget safety properties.
 *
 * TWO GROUPS, AND THE SECOND WAS ONCE WRITTEN OVER THE FIRST. The original four
 * properties below guard the ALLOCATION — never exceeding it, never reporting a
 * nonsensical count, always recovering, and never letting a sync make the
 * client less cautious. The per-operator group beneath them, added 2026-08-19
 * with the F2c fix, guards ATTRIBUTION. During that change this file was
 * rewritten rather than extended and all four allocation properties were lost
 * for one commit — including "never lets more requests be in flight than the
 * allocation permits", whose own comment calls it the property whose violation
 * is a blocked IP. They are restored here, and the two groups are kept in one
 * file because they constrain the same object and a split invites the same
 * accident.
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

/** The three operators the default pool actually reaches, plus a self-hosted. */
const operator = fc.constantFrom(
  "fossgis",
  "vk-maps",
  "private.coffee",
  "self-hosted.example",
);

/**
 * Penalty durations including the values third-party input produces.
 *
 * `Retry-After` is a header from someone else's server, so `0`, absurd values
 * and negatives are all reachable; the contract is that they clamp rather than
 * throw or brick the client.
 */
const penaltyMs = fc.oneof(
  fc.integer({ min: 0, max: 120_000 }),
  fc.constantFrom(-1, 999_999_999),
);

const penalties = fc.array(fc.tuple(operator, penaltyMs), { maxLength: 20 });

const ALL_OPERATORS = [
  "fossgis",
  "vk-maps",
  "private.coffee",
  "self-hosted.example",
] as const;

/**
 * A spared operator plus a NON-EMPTY run of penalties that never names it.
 *
 * Built this way rather than by filtering inside the property because of a
 * lesson this package already paid for once: a loop that can skip every
 * iteration proves nothing on the runs where it does, and `fc.array` generates
 * the empty array. Drawing the victims from the complement makes every single
 * run apply at least one penalty to someone other than `spared`, so there is no
 * vacuous case to hide in.
 *
 * @see operator-weights-evidence.test.ts — the test that shipped making zero
 * assertions, and the "assert the loop ran" half of the fix.
 */
const sparedAndPenalties = fc.constantFrom(...ALL_OPERATORS).chain((spared) => {
  const others = ALL_OPERATORS.filter((name) => name !== spared);
  return fc.tuple(
    fc.constant(spared),
    fc.array(
      fc.tuple(
        fc.nat({ max: others.length - 1 }).map((i) => others[i] as string),
        penaltyMs,
      ),
      { minLength: 1, maxLength: 20 },
    ),
  );
});

describe("per-operator penalties, over arbitrary sequences", () => {
  it("never blocks an operator that was not penalised", () => {
    // THE PROPERTY THE FIX EXISTS FOR. If this ever fails, one server's 429 is
    // again stopping requests to a server that never refused — the F2c defect,
    // reintroduced.
    fc.assert(
      fc.property(sparedAndPenalties, ([spared, sequence]) => {
        const budget = new OverpassSlotBudget({ now: () => 1_000_000 });
        for (const [who, ms] of sequence) budget.penalise(ms, who);
        // The generator guarantees this ran; asserted anyway, because the
        // guarantee lives in a `chain` a refactor could quietly loosen.
        expect(sequence.length).toBeGreaterThan(0);
        expect(budget.availableFor(spared)).toBeGreaterThan(0);
      }),
    );
  });

  it("admits a tile whenever any operator in the pool is unpenalised", () => {
    // `tryAcquire` is the only refusal point and it runs before an endpoint is
    // drawn, so this is where a leak would actually cost the user something.
    fc.assert(
      fc.property(sparedAndPenalties, ([spared, sequence]) => {
        const budget = new OverpassSlotBudget({ now: () => 1_000_000 });
        for (const [who, ms] of sequence) budget.penalise(ms, who);
        expect(sequence.length).toBeGreaterThan(0);
        expect(budget.tryAcquire([...ALL_OPERATORS, spared])).toBe(true);
      }),
    );
  });

  it("keeps msUntilAvailable within the clamp, whatever the header said", () => {
    // A single absurd `Retry-After` must not brick the client for a day; the
    // cost of under-waiting is one more 429, which is cheap and self-correcting.
    fc.assert(
      fc.property(penalties, (sequence) => {
        const budget = new OverpassSlotBudget({ now: () => 1_000_000 });
        for (const [who, ms] of sequence) budget.penalise(ms, who);
        const pool = ["fossgis", "vk-maps", "private.coffee"];
        const wait = budget.msUntilAvailable(pool);
        expect(wait).toBeGreaterThanOrEqual(0);
        expect(wait).toBeLessThanOrEqual(120_000);
      }),
    );
  });

  it("reports a wait no longer than the soonest operator's own block", () => {
    // The aggregate must never be pessimistic relative to its parts, or the
    // prefetch sleeps past a slot it could have used.
    fc.assert(
      fc.property(penalties, (sequence) => {
        const budget = new OverpassSlotBudget({ now: () => 1_000_000 });
        for (const [who, ms] of sequence) budget.penalise(ms, who);
        const pool = ["fossgis", "vk-maps", "private.coffee"];
        const aggregate = budget.msUntilAvailable(pool);
        const soonest = Math.min(
          ...pool.map((who) => budget.msUntilAvailable([who])),
        );
        expect(aggregate).toBe(soonest);
      }),
    );
  });
});
