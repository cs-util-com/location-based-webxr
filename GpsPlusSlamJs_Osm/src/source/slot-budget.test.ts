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
