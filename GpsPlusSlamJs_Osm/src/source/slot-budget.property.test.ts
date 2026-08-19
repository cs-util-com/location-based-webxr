/**
 * `OverpassSlotBudget`'s per-operator accounting, over arbitrary penalty
 * sequences.
 *
 * WHY A PROPERTY SPEC AND NOT MORE EXAMPLES. The defect this accounting fixes
 * (F2c) was not a wrong number — it was one operator's refusal leaking into
 * another's account. That is a universally quantified statement about every
 * possible interleaving of penalties, and the example tests next door pin three
 * hand-picked sequences. A leak that needs four penalties in a particular order
 * to appear is exactly what they would miss, and it is exactly the shape a
 * later "simplification" of the map bookkeeping would introduce.
 *
 * The failure mode being guarded is quiet and expensive: a client that refuses
 * to dispatch to a server which never rate-limited it shows the user a blank
 * screen for up to two minutes, and nothing in the UI distinguishes that from a
 * slow network.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OverpassSlotBudget } from "./slot-budget.js";

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
