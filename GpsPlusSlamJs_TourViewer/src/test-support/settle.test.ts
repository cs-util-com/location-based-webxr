/**
 * Why these tests matter: `settle` replaces fixed waits across the unit
 * suites, so what it promises is what those tests may assume. A step the
 * fingerprint cannot see (a digest on the thread pool) is only covered by
 * the quiet window of wall clock, whatever the platform's timer tick; and a
 * state that never settles must be said by settle's own message, which a
 * bound above the test timeout would never let anyone read.
 */
import { describe, expect, it } from "vitest";

import { settle } from "./settle.js";

describe("settle", () => {
  it("waits out the quiet window of wall clock even when nothing changes", async () => {
    const start = performance.now();
    await settle(() => [1], { quietMs: 60 });
    expect(performance.now() - start).toBeGreaterThanOrEqual(59);
  });

  it("counts the quiet window from the last change", async () => {
    let value = 0;
    let lastChange = 0;
    const moving = setInterval(() => {
      if (value < 3) {
        value += 1;
        lastChange = performance.now();
      }
    }, 5);
    await settle(() => [value], { quietMs: 40 });
    clearInterval(moving);
    expect(value).toBe(3);
    expect(performance.now() - lastChange).toBeGreaterThanOrEqual(39);
  });

  it("says so when the state never stops changing, inside the default test timeout", async () => {
    let value = 0;
    const start = performance.now();
    await expect(settle(() => [(value += 1)])).rejects.toThrow(
      /still changing after 4000 ms/,
    );
    expect(performance.now() - start).toBeLessThan(5000);
  }, 10_000);
});
