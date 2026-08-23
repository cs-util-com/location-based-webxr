import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { selectDue } from "./schedule.mjs";

// Why this test matters: the example tests cover the queues we thought of.
// These state the invariants that must survive ANY queue, because the two
// outcomes this function can get wrong — publishing something unapproved, and
// posting to a community venue too often — are both irreversible in the way
// that matters: you cannot un-see a post, and you cannot un-ban an account.
//
// The generators are BUILT so that both branches are actually reached; the
// last test in this file fails if they ever stop being. A property that only
// ever exercises the withheld branch would pass forever while asserting
// nothing about publication, which is the exact trap the blog parser's
// property tests fell into.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

const CHANNELS = {
  fast: { autonomy: "auto", minIntervalMs: HOUR },
  capped: {
    autonomy: "auto",
    minIntervalMs: HOUR,
    maxPerWindow: 3,
    windowMs: 7 * DAY,
  },
  slow: { autonomy: "manual", minIntervalMs: 21 * DAY },
};

const itemArb = fc.record({
  id: fc.string({ minLength: 1 }),
  channel: fc.constantFrom("fast", "capped", "slow", "unknown-channel"),
  status: fc.constantFrom("approved", "draft", "rejected"),
  queuedAt: fc.integer({ min: NOW - 30 * DAY, max: NOW }),
});

/** Timestamps spread around the interesting boundaries, not uniformly. */
const historyArb = fc.record({
  fast: fc.array(fc.integer({ min: NOW - 3 * DAY, max: NOW }), {
    maxLength: 4,
  }),
  capped: fc.array(fc.integer({ min: NOW - 14 * DAY, max: NOW }), {
    maxLength: 6,
  }),
  slow: fc.array(fc.integer({ min: NOW - 60 * DAY, max: NOW }), {
    maxLength: 3,
  }),
});

describe("selectDue — invariants under arbitrary queues", () => {
  it("never releases an item that is not approved", () => {
    fc.assert(
      fc.property(fc.array(itemArb), historyArb, (items, history) => {
        const { due } = selectDue({
          items,
          channels: CHANNELS,
          history,
          now: NOW,
        });
        for (const entry of due) {
          expect(entry.item.status).toBe("approved");
        }
      }),
    );
  });

  it("never releases more than one item per channel in a run", () => {
    fc.assert(
      fc.property(fc.array(itemArb), historyArb, (items, history) => {
        const { due } = selectDue({
          items,
          channels: CHANNELS,
          history,
          now: NOW,
        });
        const channels = due.map((entry) => entry.item.channel);
        expect(new Set(channels).size).toBe(channels.length);
      }),
    );
  });

  it("never releases into a channel inside its minimum interval or over its cap", () => {
    fc.assert(
      fc.property(fc.array(itemArb), historyArb, (items, history) => {
        const { due } = selectDue({
          items,
          channels: CHANNELS,
          history,
          now: NOW,
        });
        for (const entry of due) {
          const config = CHANNELS[entry.item.channel];
          const past = history[entry.item.channel] ?? [];
          if (past.length > 0) {
            expect(NOW - Math.max(...past)).toBeGreaterThanOrEqual(
              config.minIntervalMs,
            );
          }
          if (config.maxPerWindow !== undefined) {
            const inWindow = past.filter((at) => at > NOW - config.windowMs);
            expect(inWindow.length).toBeLessThan(config.maxPerWindow);
          }
        }
      }),
    );
  });

  it("accounts for every item exactly once, and explains every withholding", () => {
    // Nothing may silently disappear from the queue: an item that is neither
    // released nor explained is one nobody will ever notice is missing.
    fc.assert(
      fc.property(fc.array(itemArb), historyArb, (items, history) => {
        const { due, withheld } = selectDue({
          items,
          channels: CHANNELS,
          history,
          now: NOW,
        });
        expect(due.length + withheld.length).toBe(items.length);
        for (const entry of withheld) {
          expect(typeof entry.reason).toBe("string");
          expect(entry.reason.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("reaches BOTH branches — the guard against these properties going vacuous", () => {
    let released = 0;
    let held = 0;
    fc.assert(
      fc.property(
        fc.array(itemArb, { minLength: 1 }),
        historyArb,
        (items, history) => {
          const { due, withheld } = selectDue({
            items,
            channels: CHANNELS,
            history,
            now: NOW,
          });
          released += due.length;
          held += withheld.length;
        },
      ),
      { numRuns: 300 },
    );
    expect(released).toBeGreaterThan(20);
    expect(held).toBeGreaterThan(20);
  });
});
