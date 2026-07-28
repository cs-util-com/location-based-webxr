/**
 * Retry-policy tests.
 *
 * Why these tests matter:
 * Backoff is the difference between "a public server had a bad minute" and
 * "our library made it worse". The jitter property in particular is not
 * cosmetic: every client that backs off on the same fixed schedule retries in
 * the same instant, turning one overload into a self-sustaining thundering
 * herd. And `Retry-After` is the server explicitly telling us how much room it
 * needs — ignoring it is how a client gets blocked outright.
 *
 * @see backoff.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  backoffDelayMs,
  parseRetryAfterMs,
  nextDelayMs,
  sleep,
  RETRYABLE_STATUSES,
} from "./backoff.js";

describe("which statuses are worth retrying", () => {
  it.each([429, 502, 503, 504])("%i is retryable", (status) => {
    expect(RETRYABLE_STATUSES.has(status)).toBe(true);
  });

  it.each([200, 400, 401, 403, 404, 500])("%i is NOT retryable", (status) => {
    // 400 in particular: our query is malformed, so retrying just burns quota
    // to get the same answer several times.
    expect(RETRYABLE_STATUSES.has(status)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially in its ceiling", () => {
    const options = { baseDelayMs: 100, maxDelayMs: 100_000, random: () => 1 };
    expect(backoffDelayMs(0, options)).toBe(100);
    expect(backoffDelayMs(1, options)).toBe(200);
    expect(backoffDelayMs(2, options)).toBe(400);
    expect(backoffDelayMs(3, options)).toBe(800);
  });

  it("is capped by maxDelayMs", () => {
    const options = { baseDelayMs: 1000, maxDelayMs: 5000, random: () => 1 };
    expect(backoffDelayMs(10, options)).toBe(5000);
  });

  it("uses FULL jitter — the delay spans the whole interval, not a fixed value", () => {
    // The anti-thundering-herd property. With fixed exponential backoff every
    // client retries at the same instant and the overload sustains itself.
    const delays = new Set<number>();
    for (let i = 0; i < 200; i++) {
      delays.add(backoffDelayMs(4, { baseDelayMs: 100, maxDelayMs: 100_000 }));
    }
    expect(delays.size).toBeGreaterThan(50);
  });

  it("never returns a negative delay, for any attempt number", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 40 }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        (attempt, r) => {
          expect(
            backoffDelayMs(attempt, { random: () => r }),
          ).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("never exceeds maxDelayMs, for any attempt number", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        (attempt, r) => {
          const delay = backoffDelayMs(attempt, {
            baseDelayMs: 1000,
            maxDelayMs: 30_000,
            random: () => r,
          });
          expect(delay).toBeLessThanOrEqual(30_000);
        },
      ),
    );
  });
});

describe("parseRetryAfterMs", () => {
  const NOW = Date.parse("2026-05-06T03:25:00Z");

  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("120", NOW)).toBe(120_000);
  });

  it("parses an HTTP-date into a delta from now", () => {
    expect(parseRetryAfterMs("Wed, 06 May 2026 03:25:30 GMT", NOW)).toBe(
      30_000,
    );
  });

  it("clamps a past HTTP-date to zero rather than going negative", () => {
    expect(parseRetryAfterMs("Wed, 06 May 2026 03:20:00 GMT", NOW)).toBe(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["nonsense", "soon-ish"],
    ["negative seconds", "-5"],
  ])("returns undefined for %s rather than guessing", (_label, header) => {
    // A wrong guess here either hammers a server that asked for room, or stalls
    // for hours. Falling back to our own backoff is the safe answer.
    expect(parseRetryAfterMs(header, NOW)).toBeUndefined();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRetryAfterMs("  42  ", NOW)).toBe(42_000);
  });
});

describe("nextDelayMs", () => {
  const NOW = 1_000_000;

  it("prefers the server's Retry-After over our own backoff", () => {
    // The server knows its own load. Ignoring its instruction is how a client
    // gets blocked.
    expect(
      nextDelayMs(0, "9", NOW, { baseDelayMs: 100, random: () => 1 }),
    ).toBe(9000);
  });

  it("caps even a Retry-After at maxDelayMs, so one bad header cannot stall forever", () => {
    expect(nextDelayMs(0, "86400", NOW, { maxDelayMs: 30_000 })).toBe(30_000);
  });

  it("falls back to jittered backoff when the header is absent or unparseable", () => {
    expect(
      nextDelayMs(2, undefined, NOW, { baseDelayMs: 100, random: () => 1 }),
    ).toBe(400);
    expect(
      nextDelayMs(2, "later please", NOW, {
        baseDelayMs: 100,
        random: () => 1,
      }),
    ).toBe(400);
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(10_000, controller.signal)).rejects.toThrow(/aborted/i);
  });

  it("rejects when aborted mid-wait, and does not leave the timer running", async () => {
    // Leaving an area must stop work promptly; a pending 30 s backoff timer
    // would otherwise keep the process alive and then retry an area the user
    // has already walked away from.
    const controller = new AbortController();
    const pending = sleep(30_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/i);
  });
});
