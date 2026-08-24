import { describe, expect, it } from "vitest";

import { selectDue } from "./schedule.mjs";

// Why this test matters: this function is the only thing standing between an
// automated pipeline and the two failure modes that cannot be undone —
// publishing something the owner has not approved, and posting to a community
// venue often enough to get the project's account banned. Reddit and Hacker
// News tolerate roughly one self-promotional post per author per several
// weeks; there is no apology that restores a burned account.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

const channels = {
  bluesky: { autonomy: "auto", minIntervalMs: 20 * HOUR },
  x: { autonomy: "manual", minIntervalMs: 20 * HOUR },
  blog: {
    autonomy: "manual",
    minIntervalMs: DAY,
    maxPerWindow: 3,
    windowMs: 7 * DAY,
  },
  reddit: { autonomy: "manual", minIntervalMs: 21 * DAY },
};

/** @param {Partial<import('./schedule.mjs').QueueItem>} [o] */
const item = (o = {}) => ({
  id: "i1",
  channel: "bluesky",
  status: "approved",
  queuedAt: NOW - DAY,
  ...o,
});

describe("selectDue", () => {
  it("releases an approved item whose channel is idle", () => {
    const { due, withheld } = selectDue({
      items: [item()],
      channels,
      history: {},
      now: NOW,
    });

    expect(due).toHaveLength(1);
    expect(due[0].item.id).toBe("i1");
    expect(due[0].mode).toBe("auto");
    expect(withheld).toEqual([]);
  });

  it("never releases an item that is not approved", () => {
    // The whole review model rests on this line.
    for (const status of ["draft", "rejected", "", undefined]) {
      const { due, withheld } = selectDue({
        items: [item({ status })],
        channels,
        history: {},
        now: NOW,
      });

      expect(due).toEqual([]);
      expect(withheld[0].reason).toMatch(/approved/i);
    }
  });

  it("marks a manual-autonomy channel for a human to send", () => {
    const { due } = selectDue({
      items: [item({ id: "x1", channel: "x" })],
      channels,
      history: {},
      now: NOW,
    });

    // Due, but the pipeline must not post it itself — X's rules sanction the
    // API and prohibit browser automation, so a human presses the button.
    expect(due[0].mode).toBe("manual");
  });

  it("withholds a channel posted to inside its minimum interval", () => {
    const { due, withheld } = selectDue({
      items: [item()],
      channels,
      history: { bluesky: [NOW - 2 * HOUR] },
      now: NOW,
    });

    expect(due).toEqual([]);
    expect(withheld[0].reason).toMatch(/interval/i);
    expect(withheld[0].nextEligibleAt).toBe(NOW - 2 * HOUR + 20 * HOUR);
  });

  it("holds a community channel for WEEKS, not hours", () => {
    // The expensive mistake this exists to prevent.
    const { due, withheld } = selectDue({
      items: [item({ id: "r1", channel: "reddit" })],
      channels,
      history: { reddit: [NOW - 5 * DAY] },
      now: NOW,
    });

    expect(due).toEqual([]);
    expect(withheld[0].nextEligibleAt).toBe(NOW - 5 * DAY + 21 * DAY);
  });

  it("enforces a rolling window cap as well as an interval", () => {
    // The blog is capped at ~3 per week even though its interval is a day:
    // a young domain publishing a burst of articles is the shape that
    // scaled-content policies target.
    const { due, withheld } = selectDue({
      items: [item({ id: "b1", channel: "blog" })],
      channels,
      history: { blog: [NOW - 2 * DAY, NOW - 4 * DAY, NOW - 6 * DAY] },
      now: NOW,
    });

    expect(due).toEqual([]);
    expect(withheld[0].reason).toMatch(/3 in the last 7 days|window/i);
  });

  it("ignores history that has fallen outside the window", () => {
    const { due } = selectDue({
      items: [item({ id: "b1", channel: "blog" })],
      channels,
      history: { blog: [NOW - 8 * DAY, NOW - 9 * DAY, NOW - 30 * DAY] },
      now: NOW,
    });

    expect(due).toHaveLength(1);
  });

  it("releases at most one item per channel per run", () => {
    // Two posts to one channel in one run defeats the interval entirely.
    const { due, withheld } = selectDue({
      items: [
        item({ id: "a", queuedAt: NOW - 2 * DAY }),
        item({ id: "b", queuedAt: NOW - DAY }),
      ],
      channels,
      history: {},
      now: NOW,
    });

    expect(due).toHaveLength(1);
    expect(due[0].item.id).toBe("a"); // oldest first — the queue is a queue
    expect(withheld.map((w) => w.item.id)).toEqual(["b"]);
  });

  it("withholds an item whose channel it does not recognise", () => {
    const { due, withheld } = selectDue({
      items: [item({ channel: "linkedin" })],
      channels,
      history: {},
      now: NOW,
    });

    expect(due).toEqual([]);
    expect(withheld[0].reason).toMatch(/unknown channel/i);
  });

  it("gives every withheld item a reason", () => {
    const { withheld } = selectDue({
      items: [
        item({ id: "a", status: "draft" }),
        item({ id: "b", channel: "nope" }),
        item({ id: "c", channel: "reddit" }),
        item({ id: "d", channel: "reddit" }),
      ],
      channels,
      history: { reddit: [NOW - HOUR] },
      now: NOW,
    });

    for (const entry of withheld) {
      expect(typeof entry.reason).toBe("string");
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("rejects a channel config with no minimum interval rather than assuming one", () => {
    // A missing interval must not silently mean "post as often as you like".
    expect(() =>
      selectDue({
        items: [item({ channel: "sloppy" })],
        channels: { sloppy: { autonomy: "auto" } },
        history: {},
        now: NOW,
      }),
    ).toThrow(/minIntervalMs/);
  });

  it("rejects a NaN interval, which would read as exactly the forbidden 'unlimited'", () => {
    // `typeof NaN === "number"`, so the old guard passed it — and downstream
    // `now - lastAt < NaN` is false, so the item was NEVER withheld: a channel
    // configured with `minIntervalMs: NaN` posted on every run. Not reachable
    // from the literal CHANNELS table, but `channels` is injected and the
    // natural next step is reading the table from JSON, where `Number("21d")`
    // produces exactly this. Found by claude[bot] review on PR #337.
    expect(() =>
      selectDue({
        items: [item({ channel: "sloppy" })],
        channels: { sloppy: { autonomy: "auto", minIntervalMs: Number.NaN } },
        history: {},
        now: NOW,
      }),
    ).toThrow(/minIntervalMs/);
  });
});
