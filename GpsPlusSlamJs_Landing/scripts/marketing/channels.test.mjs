import { describe, expect, it } from "vitest";

import { CHANNELS, validateChannels } from "./channels.mjs";
import { selectDue } from "./schedule.mjs";

// Why this test matters: this table is the entire autonomy model (D3). If a
// channel silently starts at 'auto', the review gate the owner asked for does
// not exist and nobody finds out until something is published. And if a
// community channel's interval is wrong in the permissive direction, the cost
// is a banned account rather than a failed test.

describe("the channel table", () => {
  it("is valid on its own terms", () => {
    expect(validateChannels(CHANNELS)).toEqual([]);
  });

  it("starts EVERY channel at review-everything", () => {
    // D3: channels graduate to agent-published individually, once the owner
    // trusts that channel's output. None has yet.
    for (const [name, config] of Object.entries(CHANNELS)) {
      expect(config.autonomy, `${name} must start at manual`).toBe("manual");
    }
  });

  it("holds the community channels for weeks, not hours", () => {
    const THREE_WEEKS = 21 * 24 * 60 * 60 * 1000;
    for (const name of ["reddit", "hackernews"]) {
      expect(CHANNELS[name].minIntervalMs).toBeGreaterThanOrEqual(THREE_WEEKS);
    }
  });

  it("caps the blog per rolling week as well as per day", () => {
    expect(CHANNELS.blog.maxPerWindow).toBe(3);
    expect(CHANNELS.blog.windowMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("works with the scheduler it is written for", () => {
    // Guards the seam: a table the scheduler rejects is a table that only
    // looks configured.
    expect(() =>
      selectDue({ items: [], channels: CHANNELS, history: {}, now: 0 }),
    ).not.toThrow();
  });
});

describe("validateChannels", () => {
  it("rejects a missing interval", () => {
    expect(validateChannels({ x: { autonomy: "auto" } })).toContainEqual(
      expect.stringMatching(/minIntervalMs/),
    );
  });

  it("rejects a cap with no window", () => {
    // A cap with no window never fires, which is worse than no cap at all:
    // it reads, at a glance, like a limit that is being enforced.
    expect(
      validateChannels({
        x: { autonomy: "auto", minIntervalMs: 1, maxPerWindow: 3 },
      }),
    ).toContainEqual(expect.stringMatching(/together/));
  });

  it("rejects an autonomy value it does not understand", () => {
    expect(
      validateChannels({ x: { autonomy: "yes-please", minIntervalMs: 1 } }),
    ).toContainEqual(expect.stringMatching(/autonomy/));
  });
});
