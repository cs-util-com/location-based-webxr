import { describe, it, expect } from "vitest";

import { composeSignals } from "./compose-signals.js";

/**
 * Why these tests matter: the helper looks trivial, and the one property that
 * makes it correct is invisible in its three lines. Both callers discriminate a
 * DEADLINE (`TimeoutError`, retryable - fail over to the next endpoint) from a
 * CALLER ABORT (`AbortError`, terminal - abandon the work). If composition
 * flattened those reasons, nothing would look broken: the request would still
 * abort, only the recovery path would silently change, and a slow endpoint
 * would start killing tiles instead of being retried.
 */
describe("composeSignals", () => {
  it("returns undefined when nothing constrains the request", () => {
    expect(composeSignals()).toBeUndefined();
    expect(composeSignals(undefined, undefined)).toBeUndefined();
  });

  it("returns the single signal unwrapped, without allocating a composite", () => {
    // An allocation optimisation, not a correctness requirement - see below.
    const controller = new AbortController();
    expect(composeSignals(controller.signal)).toBe(controller.signal);
    expect(composeSignals(undefined, controller.signal)).toBe(
      controller.signal,
    );
  });

  it("preserves a CALLER abort reason identity through composition", () => {
    // The composite must still say AbortError, or `isAbortError` in the
    // attempt loop stops recognising a cancellation and retries work the
    // caller has already abandoned.
    const caller = new AbortController();
    const deadline = AbortSignal.timeout(60_000);
    const composed = composeSignals(caller.signal, deadline);

    caller.abort();

    expect(composed?.aborted).toBe(true);
    expect((composed?.reason as Error).name).toBe("AbortError");
  });

  it("preserves a DEADLINE's reason identity through composition", async () => {
    // The mirror case, and the one that actually regressed in the field: a
    // deadline must stay a TimeoutError so the loop treats it as a retryable
    // transport failure rather than a terminal abort.
    const caller = new AbortController();
    const deadline = AbortSignal.timeout(1);
    const composed = composeSignals(caller.signal, deadline);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(composed?.aborted).toBe(true);
    expect((composed?.reason as Error).name).toBe("TimeoutError");
    // And the caller's own signal is untouched - composing must not abort it.
    expect(caller.signal.aborted).toBe(false);
  });

  it("aborts on whichever source fires FIRST, not on a fixed precedence", () => {
    // Guards an implementation that checked one source before the other: the
    // composite is a race, and a deadline that fires first must not be
    // reported as the caller's abort.
    const caller = new AbortController();
    const other = new AbortController();
    const composed = composeSignals(caller.signal, other.signal);

    other.abort(new DOMException("second one won", "TimeoutError"));

    expect((composed?.reason as Error).name).toBe("TimeoutError");
  });
});
