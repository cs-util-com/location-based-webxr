/**
 * Slot-budget tests.
 *
 * Why these tests matter:
 * This is the only component that decides whether a request is dispatched at
 * all, so every quota bug this package could ever have passes through here. It
 * exists as a separate thing from the `/api/status` parser because of a
 * measured fact: **`/api/status` lags actual consumption.** Three concurrent
 * queries returned `200, 429, 200` while a status read 600 ms into the burst
 * still reported the full allocation free. A client that asked the server
 * "may I?" before each request would therefore still get 429s.
 *
 * So the budget is authoritative and local: decremented the instant a request
 * is dispatched, restored when it completes, and re-synced from `/api/status`
 * only as a correction and a source of recovery times.
 *
 * Every test injects the clock — none of them sleep.
 *
 * @see slot-budget.ts.md
 */

import { describe, it, expect } from "vitest";
import { OverpassSlotBudget } from "./slot-budget.js";
import { parseOverpassStatus } from "./overpass-status.js";

/** A controllable clock, so recovery is tested without waiting for it. */
function testClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("the default allocation matches what the public instances report", () => {
  it("starts with 2 slots, the measured public limit", () => {
    const budget = new OverpassSlotBudget();
    expect(budget.available).toBe(2);
  });
});

describe("local accounting — the part /api/status cannot do in time", () => {
  it("decrements on acquire and restores on release", () => {
    const budget = new OverpassSlotBudget({ slots: 2 });
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.available).toBe(1);
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.available).toBe(0);

    budget.release();
    expect(budget.available).toBe(1);
  });

  it("refuses once the allocation is spent, rather than queueing inside itself", () => {
    // The budget's job is to answer yes/no immediately. Waiting is the
    // caller's decision, because a movement trigger wants to give up and serve
    // cache while an explicit prefetch wants to wait.
    const budget = new OverpassSlotBudget({ slots: 1 });
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.tryAcquire()).toBe(false);
    expect(budget.available).toBe(0);
  });

  it("never counts a slot back twice, however enthusiastically release is called", () => {
    // Guards the bug that would silently grant unlimited quota: a release path
    // that runs in both a `then` and a `finally`, or on both success and abort.
    const budget = new OverpassSlotBudget({ slots: 2 });
    budget.tryAcquire();
    budget.release();
    budget.release();
    budget.release();
    expect(budget.available).toBe(2);
  });
});

describe("penalty after a 429 — the server's own recovery time is honoured", () => {
  it("blocks until the reported recovery time, then recovers on its own", () => {
    const clock = testClock();
    const budget = new OverpassSlotBudget({ slots: 2, now: clock.now });

    budget.penalise(30_000);
    expect(budget.tryAcquire()).toBe(false);
    expect(budget.msUntilAvailable()).toBe(30_000);

    clock.advance(29_999);
    expect(budget.tryAcquire()).toBe(false);

    clock.advance(1);
    expect(budget.tryAcquire()).toBe(true);
  });

  it("takes the LONGEST outstanding penalty, not the most recent", () => {
    // Two 429s in flight: honouring only the latest would let a short second
    // penalty cancel a long first one and put us straight back into the wall.
    const clock = testClock();
    const budget = new OverpassSlotBudget({ slots: 2, now: clock.now });

    budget.penalise(60_000);
    budget.penalise(5_000);

    clock.advance(10_000);
    expect(budget.tryAcquire()).toBe(false);
    expect(budget.msUntilAvailable()).toBe(50_000);
  });

  it("clamps a nonsensical penalty rather than trusting it", () => {
    // Retry-After is attacker-adjacent third-party input; a negative value must
    // not unblock us and an absurd one must not brick the client for a day.
    const clock = testClock();
    const budget = new OverpassSlotBudget({
      slots: 1,
      now: clock.now,
      maxPenaltyMs: 120_000,
    });

    budget.penalise(-5_000);
    expect(budget.tryAcquire()).toBe(true);
    budget.release();

    budget.penalise(86_400_000);
    expect(budget.msUntilAvailable()).toBe(120_000);
  });
});

describe("re-syncing from /api/status", () => {
  const statusText = (slots: number, pendingInSeconds?: number) =>
    [
      "Connected as: 1354464119",
      "Current time: 2026-07-28T08:40:04Z",
      "Rate limit: 2",
      ...(slots > 0 ? [`${slots} slots available now.`] : []),
      ...(pendingInSeconds === undefined
        ? []
        : [
            `Slot available after: 2026-07-28T08:40:${String(4 + pendingInSeconds).padStart(2, "0")}Z, in ${pendingInSeconds} seconds.`,
          ]),
      "Currently running queries (pid, space limit, time limit, start time):",
    ].join("\n");

  it("adopts the server's allocation size when it differs from ours", () => {
    // A self-hosted or differently-configured instance may allow more or fewer
    // than the public 2, and hardcoding 2 would either waste it or overrun it.
    const budget = new OverpassSlotBudget({ slots: 2 });
    budget.sync(
      parseOverpassStatus(
        statusText(1).replace("Rate limit: 2", "Rate limit: 6"),
      ),
    );
    expect(budget.capacity).toBe(6);
  });

  it("does NOT raise availability above what we locally believe", () => {
    // The measured lag, encoded as a rule. The server said "2 free" while it
    // was actively 429-ing us, so a sync must be allowed to make the client
    // MORE cautious and never less. Without this the budget would be reset to
    // optimism by the very response that proves optimism is wrong.
    const budget = new OverpassSlotBudget({ slots: 2 });
    budget.tryAcquire();
    budget.tryAcquire();
    expect(budget.available).toBe(0);

    budget.sync(parseOverpassStatus(statusText(2)));
    expect(budget.available).toBe(0);
  });

  it("DOES lower availability when the server knows better than we do", () => {
    // The other direction is trusted: if the server says nothing is free while
    // we think everything is, something consumed our allocation that we did not
    // account for — another tab, another process, a retry we lost track of.
    const clock = testClock();
    const budget = new OverpassSlotBudget({ slots: 2, now: clock.now });
    expect(budget.available).toBe(2);

    budget.sync(parseOverpassStatus(statusText(0, 25)));
    expect(budget.tryAcquire()).toBe(false);
    expect(budget.msUntilAvailable()).toBe(25_000);
  });

  it("IGNORES a status that reports neither free slots nor a recovery time", () => {
    // The soft-lock this prevents, found by a test that was trying to assert
    // something else entirely:
    //
    // The parser infers "0 free" from the ABSENCE of the availability line,
    // because that is how Overpass reports exhaustion. But a genuinely
    // exhausted response always ALSO carries "Slot available after:" lines. A
    // body with neither — a changed format, a truncated response, a proxy being
    // helpful — is uninformative, not bad news. Acting on it sets inUse to the
    // full allocation, and then nothing ever releases it (we never acquired
    // anything) and no penalty ever expires (none was set). The client stops
    // fetching. Permanently. Looking exactly like a rate limit that never lifts.
    const budget = new OverpassSlotBudget({ slots: 2 });
    budget.sync(
      parseOverpassStatus(
        [
          "Connected as: 1",
          "Current time: 2026-07-28T08:40:04Z",
          "Rate limit: 2",
          "Currently running queries (pid, space limit, time limit, start time):",
        ].join("\n"),
      ),
    );

    expect(budget.available).toBe(2);
    expect(budget.tryAcquire()).toBe(true);
  });

  it("treats an unlimited instance as unlimited", () => {
    // Rate limit: 0 must not read as "zero slots" — see the parser tests.
    const budget = new OverpassSlotBudget({ slots: 2 });
    budget.sync(
      parseOverpassStatus(
        [
          "Connected as: 1",
          "Current time: 2026-07-28T08:40:04Z",
          "Rate limit: 0",
          "Currently running queries (pid, space limit, time limit, start time):",
        ].join("\n"),
      ),
    );
    expect(budget.unlimited).toBe(true);
    for (let i = 0; i < 50; i++) expect(budget.tryAcquire()).toBe(true);
  });
});

describe("msUntilAvailable", () => {
  it("is 0 when a slot is free", () => {
    expect(new OverpassSlotBudget({ slots: 2 }).msUntilAvailable()).toBe(0);
  });

  it("is 0 when slots are merely in use, because a release could come at any moment", () => {
    // Distinguishes "busy" from "penalised". Busy resolves when our own
    // in-flight request finishes, which the caller is already awaiting; there
    // is no meaningful duration to report.
    const budget = new OverpassSlotBudget({ slots: 1 });
    budget.tryAcquire();
    expect(budget.msUntilAvailable()).toBe(0);
  });
});

describe("a real 429 outranks a claim of 'no limit'", () => {
  // Observed in the wild on 2026-07-28: the public pool normally reports
  // `Rate limit: 2`, but a run saw it report `0` — which means unlimited. If
  // that claim let the budget ignore penalties, the protection this class
  // exists to provide would switch itself off exactly when a server was under
  // enough stress to misreport its own configuration.
  //
  // The rule: a status line is a CLAIM, a 429 is EVIDENCE.
  const unlimitedStatus = () =>
    parseOverpassStatus(
      [
        "Connected as: 1",
        "Current time: 2026-07-28T08:40:04Z",
        "Rate limit: 0",
        "Currently running queries (pid, space limit, time limit, start time):",
      ].join("\n"),
    );

  it("still blocks after a penalty on an unlimited instance", () => {
    const clock = testClock();
    const budget = new OverpassSlotBudget({ slots: 2, now: clock.now });
    budget.sync(unlimitedStatus());
    expect(budget.tryAcquire()).toBe(true);

    budget.penalise(30_000);
    expect(budget.tryAcquire()).toBe(false);
    expect(budget.msUntilAvailable()).toBe(30_000);

    clock.advance(30_000);
    expect(budget.tryAcquire()).toBe(true);
  });

  it("a later 'unlimited' sync does not clear a penalty already held", () => {
    // The contradictory case: the server 429s us, then tells us it has no
    // limit. Believing the second statement would immediately undo the first.
    const clock = testClock();
    const budget = new OverpassSlotBudget({ slots: 2, now: clock.now });
    budget.penalise(30_000);
    budget.sync(unlimitedStatus());

    expect(budget.tryAcquire()).toBe(false);
  });
});

describe("acquisitions are counted even while unlimited", () => {
  /**
   * WHY THIS MATTERS, and it is not bookkeeping tidiness.
   *
   * `tryAcquire` used to return `true` WITHOUT incrementing `inUse` whenever
   * the instance claimed no limit. If a `sync` then reports a real allocation
   * while those requests are still in flight, the client resumes from an
   * `inUse` of zero and happily dispatches a full allocation on top of the
   * requests it already has open — exceeding the limit it just learned about.
   *
   * That is the one direction of error this whole class exists to prevent: it
   * is deliberately local and pessimistic precisely because `/api/status` lags
   * actual consumption.
   */
  it("does not forget in-flight requests when a real limit appears", () => {
    const budget = new OverpassSlotBudget({ now: () => 0 });
    const unlimited = {
      clientId: "x",
      serverTimeMs: 0,
      rateLimit: 0,
      unlimited: true,
      slotsAvailable: 0,
      slotsAvailableAtMs: [],
      runningQueries: 0,
    };
    budget.sync(unlimited);

    // Two requests dispatched and still open.
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.tryAcquire()).toBe(true);

    // The instance now reports a real two-slot allocation.
    budget.sync({
      ...unlimited,
      rateLimit: 2,
      unlimited: false,
      slotsAvailable: 2,
    });

    // Both requests are still in flight, so nothing is free. Before the fix
    // this read 2 and the client would have dispatched two more.
    expect(budget.available).toBe(0);
  });

  it("frees the slots again as those requests complete", () => {
    const budget = new OverpassSlotBudget({ now: () => 0 });
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.available).toBe(1);
    budget.release();
    expect(budget.available).toBe(2);
  });
});

describe("a penalty is attributed to the operator that issued it (F2c, DEC-U2)", () => {
  /**
   * WHY THESE TESTS MATTER. Until 2026-08-19 a single 429 from one operator set
   * one global `blockedUntilMs`, so the client stopped dispatching to ALL
   * operators for the full penalty — 35 s by default. That is the same flawed
   * premise the retry loop was fixed for one level up: a 429 from FOSSGIS says
   * nothing about VK's quota. On a cold start with an empty cache it is 35 s of
   * nothing on screen, and it is one of the two mechanisms that could have
   * produced the owner's reported "another thirty seconds".
   *
   * The pool has three operators, so these use plain names rather than URLs —
   * attribution is the caller's job (`operatorForUrl`), and the budget only has
   * to keep the accounts apart.
   */

  it("blocks only the refusing operator, leaving the others dispatchable in the same tick", () => {
    const clock = testClock();
    const budget = new OverpassSlotBudget({ now: clock.now });

    budget.penalise(35_000, "fossgis");

    expect(budget.availableFor("fossgis")).toBe(0);
    expect(budget.availableFor("vk-maps")).toBe(2);
    expect(budget.availableFor("private.coffee")).toBe(2);
  });

  it("still blocks the refusing operator for the FULL penalty", () => {
    // The fix must not weaken the protection it is narrowing. An operator that
    // said "too many requests" is still off limits for exactly as long as it
    // asked for.
    const clock = testClock();
    const budget = new OverpassSlotBudget({ now: clock.now });

    budget.penalise(35_000, "fossgis");
    clock.advance(34_999);
    expect(budget.availableFor("fossgis")).toBe(0);
    clock.advance(1);
    expect(budget.availableFor("fossgis")).toBe(2);
  });

  it("keeps the longest outstanding penalty per operator, independently", () => {
    // The global version took the longest of everything, which is right within
    // one operator and wrong across two: a short penalty on VK must not shorten
    // a long one on FOSSGIS, and must not be lengthened by it either.
    const clock = testClock();
    const budget = new OverpassSlotBudget({ now: clock.now });

    budget.penalise(60_000, "fossgis");
    budget.penalise(5_000, "fossgis");
    budget.penalise(5_000, "vk-maps");

    clock.advance(6_000);
    expect(budget.availableFor("fossgis")).toBe(0);
    expect(budget.availableFor("vk-maps")).toBe(2);
  });

  it("clamps a per-operator penalty exactly as it clamps a global one", () => {
    // `Retry-After` is third-party input on this path too; an absurd value must
    // not brick one operator for a day.
    const clock = testClock();
    const budget = new OverpassSlotBudget({
      now: clock.now,
      maxPenaltyMs: 10_000,
    });

    budget.penalise(999_999_999, "fossgis");
    clock.advance(10_001);
    expect(budget.availableFor("fossgis")).toBe(2);
  });
});

describe("tryAcquire refuses only when EVERY operator is blocked", () => {
  /**
   * WHY THIS MATTERS MORE THAN IT LOOKS. `tryAcquire` runs once per TILE, in
   * `fetchTileUncached`, BEFORE any endpoint is drawn — so it has no operator
   * of its own to check. Getting this wrong in either direction breaks
   * something shipped:
   *
   * - refuse whenever any operator is blocked → the original bug, unfixed;
   * - never refuse → `RateLimitedError` stops being thrown, and with it
   *   `CachingSource`'s stale-serve and `area-loader`'s prefetch back-off,
   *   both of which branch on that error type.
   *
   * So the caller passes the operators it could actually reach, and the budget
   * answers for the set.
   */

  it("admits a tile while at least one operator in the pool is free", () => {
    const clock = testClock();
    const budget = new OverpassSlotBudget({ now: clock.now });
    const pool = ["fossgis", "vk-maps", "private.coffee"];

    budget.penalise(35_000, "fossgis");

    expect(budget.tryAcquire(pool)).toBe(true);
  });

  it("refuses a tile once every operator in the pool is blocked", () => {
    const clock = testClock();
    const budget = new OverpassSlotBudget({ now: clock.now });
    const pool = ["fossgis", "vk-maps"];

    budget.penalise(35_000, "fossgis");
    budget.penalise(20_000, "vk-maps");

    expect(budget.tryAcquire(pool)).toBe(false);
  });

  it("reports the SOONEST recovery across the pool, not the longest", () => {
    // This value becomes `RateLimitedError.retryAfterMs`, which the prefetch
    // back-off sleeps on. Reporting the longest would idle the client past the
    // moment it could legitimately have asked the faster-recovering operator.
    const clock = testClock();
    const budget = new OverpassSlotBudget({ now: clock.now });
    const pool = ["fossgis", "vk-maps"];

    budget.penalise(35_000, "fossgis");
    budget.penalise(20_000, "vk-maps");

    expect(budget.msUntilAvailable(pool)).toBe(20_000);
  });

  it("keeps the old global behaviour when no operator is named", () => {
    // `penalise(ms)` with no operator, and `tryAcquire()` with no pool, are the
    // pre-2026-08-19 surface. External consumers hold this class through the
    // package index, so the unqualified calls must keep meaning what they did.
    const clock = testClock();
    const budget = new OverpassSlotBudget({ now: clock.now });

    budget.penalise(35_000);

    expect(budget.tryAcquire()).toBe(false);
    expect(budget.tryAcquire(["fossgis", "vk-maps"])).toBe(false);
    expect(budget.msUntilAvailable()).toBe(35_000);
  });

  it("still refuses on a spent allocation, however free the operators are", () => {
    // The concurrency cap stays GLOBAL: it models our own outbound limit, not
    // any server's quota, so splitting it per operator would let one client
    // dispatch three times its allocation by spreading it across the pool.
    const budget = new OverpassSlotBudget({ slots: 1 });
    const pool = ["fossgis", "vk-maps"];

    expect(budget.tryAcquire(pool)).toBe(true);
    expect(budget.tryAcquire(pool)).toBe(false);
  });
});
