/**
 * `planEndpointOrder` over arbitrary pools, weights and draws.
 *
 * WHY A PROPERTY SPEC AND NOT MORE EXAMPLES. This module's whole contract is
 * three universally quantified statements — the result is a permutation of the
 * input, the first *k* entries are *k* distinct operators, and no weight can
 * make it throw — over three inputs that are trivially generatable. The example
 * tests next door pin one hand-picked pool at a handful of hand-picked seeds,
 * which is exactly the shape that leaves a skewed pool or a duplicate URL
 * unexercised. Those two cases had to be reasoned about by hand in review;
 * this is what stops the next one needing that.
 *
 * The failure mode being guarded is specific and quiet: this function decides
 * which donated server every request goes to, so "drops an endpoint" or
 * "revisits a spent quota first" is not a crash — it is a client that quietly
 * never uses a host, or retries into a 429 it could have avoided.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { planEndpointOrder } from "./endpoint-order.js";
import { operatorForUrl } from "./overpass-operators.js";

/**
 * URLs drawn from a small alphabet of hosts, deliberately mixing hosts that
 * SHARE an operator with hosts that do not — the grouping is the thing under
 * test, so a generator of unrelated hostnames would make every draw trivially
 * one-entry-per-operator and prove nothing.
 */
const url = fc.constantFrom(
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://self-hosted.example/api/interpreter",
);

/** Non-empty pools, duplicates allowed — a caller can repeat a URL. */
const pool = fc.array(url, { minLength: 1, maxLength: 12 });

/**
 * Weights including the values a misconfiguration produces.
 *
 * `0`, negatives, `NaN` and `Infinity` are all reachable from a hand-edited
 * constant or a computed weight, and this module's stated contract is that they
 * degrade rather than throw.
 */
const weights = fc.dictionary(
  fc.constantFrom(
    "fossgis",
    "vk-maps",
    "private.coffee",
    "self-hosted.example",
  ),
  fc.oneof(
    fc.integer({ min: 0, max: 20 }),
    fc.constantFrom(-1, Number.NaN, Number.POSITIVE_INFINITY),
  ),
);

/** `random()` must be [0, 1); the boundaries are included on purpose. */
const draws = fc.array(fc.double({ min: 0, max: 0.9999999, noNaN: true }), {
  minLength: 1,
  maxLength: 12,
});

function scripted(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

describe("planEndpointOrder, over arbitrary inputs", () => {
  it("always returns a permutation of the pool", () => {
    // Covers the two cases the example tests do not: a pool where one operator
    // holds many more entries than the others (the round-robin has to keep
    // draining it after the others are empty) and duplicate URLs (which must
    // come out the same number of times, not be deduplicated).
    fc.assert(
      fc.property(pool, weights, draws, (endpoints, w, ds) => {
        const order = planEndpointOrder(endpoints, w, scripted(ds));
        expect([...order].sort()).toEqual([...endpoints].sort());
      }),
    );
  });

  it("visits every distinct operator before revisiting any", () => {
    // The property the module exists for. If it ever fails, a retry is spending
    // an attempt on a quota that has already refused while an untried operator
    // is still available — which is the exact defect M4 and M6 were written to
    // remove, reintroduced silently.
    fc.assert(
      fc.property(pool, weights, draws, (endpoints, w, ds) => {
        const order = planEndpointOrder(endpoints, w, scripted(ds));
        const operators = order.map(operatorForUrl);
        const distinct = new Set(operators).size;
        expect(new Set(operators.slice(0, distinct)).size).toBe(distinct);
      }),
    );
  });

  it("never throws, whatever the weights say", () => {
    // Zero, negative, NaN and Infinity are all reachable from a hand-edited
    // constant. This runs inside the retry loop, where a throw would turn a
    // recoverable fetch failure into an unhandled one.
    fc.assert(
      fc.property(pool, weights, draws, (endpoints, w, ds) => {
        expect(() =>
          planEndpointOrder(endpoints, w, scripted(ds)),
        ).not.toThrow();
      }),
    );
  });

  it("terminates on an empty pool instead of spinning", () => {
    // `while (order.length < endpoints.length)` with nothing to drain is the
    // one shape that could hang rather than fail. `OverpassSource` rejects an
    // empty pool at construction, so this is about the module standing on its
    // own — and a hang in a property runner is far worse to diagnose than a
    // wrong answer.
    fc.assert(
      fc.property(weights, draws, (w, ds) => {
        expect(planEndpointOrder([], w, scripted(ds))).toEqual([]);
      }),
    );
  });
});
