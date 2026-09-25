import { describe, expect, it } from "vitest";

import { nextId } from "./id.js";

/**
 * Why this matters: component 10 has no nanoid dependency (none exists in the
 * workspace — plan decision AU5) and generates ids as a pure function of the
 * draft's existing ids rather than a hidden mutable counter, so a session that
 * already has waypoints (e.g. resumed from a replay) never collides.
 */

describe("nextId", () => {
  it("returns prefix-1 when no existing ids match the prefix", () => {
    expect(nextId("wp", [])).toBe("wp-1");
  });

  it("returns one past the highest existing numeric suffix", () => {
    expect(nextId("wp", ["wp-1", "wp-2", "wp-3"])).toBe("wp-4");
  });

  it("ignores gaps — next is highest+1, not the first free gap", () => {
    expect(nextId("wp", ["wp-1", "wp-5"])).toBe("wp-6");
  });

  it("ignores ids from a different prefix", () => {
    expect(nextId("wp", ["asset-1", "asset-2"])).toBe("wp-1");
  });

  it("ignores malformed ids that merely start with the prefix", () => {
    expect(nextId("wp", ["wp-abc", "wp-", "wp-2x"])).toBe("wp-1");
  });

  it("is a pure function — repeated calls with the same input agree", () => {
    const ids = ["wp-1", "wp-2"];
    expect(nextId("wp", ids)).toBe(nextId("wp", ids));
  });
});
