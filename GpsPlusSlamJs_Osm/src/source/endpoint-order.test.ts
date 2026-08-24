/**
 * The per-tile endpoint attempt order.
 *
 * WHY THESE TESTS MATTER. This module reverses a decision that was taken on
 * measured evidence (2026-07-28 removed randomisation because it made the pool
 * order decorative and let the slowest host serve its full share), so it has to
 * deliver the thing that justified the reversal — a preference that still
 * biases strongly — while fixing what the strict order cost: every client
 * hitting entry 0 first, which is the 429 the twelfth session reported.
 *
 * Three properties carry that, and each has a way of silently not holding:
 * a draw that is not actually weighted, an entry that becomes unreachable, and
 * an attempt sequence that revisits a spent quota before an untried one.
 */

import { describe, expect, it } from "vitest";

import { planEndpointOrder } from "./endpoint-order.js";
import { operatorForUrl } from "./overpass-operators.js";
import { DEFAULT_OVERPASS_ENDPOINTS } from "./overpass-source.js";

/** Draws in sequence, then repeats — so a test can script exact choices. */
function scriptedRandom(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

const WEIGHTS = { fossgis: 6, "vk-maps": 3, "private.coffee": 1 };

describe("planEndpointOrder", () => {
  it("returns a PERMUTATION — every endpoint stays reachable", () => {
    // Why this test matters: the modulo this replaces could not promise it.
    // With `maxRetries = 3` and five entries, `attempt % length` reaches four
    // of five and `overpass-api.de` was unreachable in the default
    // configuration — a host in the pool that no request could ever use.
    const order = planEndpointOrder(
      DEFAULT_OVERPASS_ENDPOINTS,
      WEIGHTS,
      scriptedRandom([0.1, 0.5, 0.9]),
    );

    expect([...order].sort()).toEqual([...DEFAULT_OVERPASS_ENDPOINTS].sort());
  });

  it("visits every distinct operator before revisiting any", () => {
    // THE PROPERTY THE WHOLE MODULE EXISTS FOR. Five entries are three
    // operators, so a draw over ENTRIES gives FOSSGIS three tickets and makes a
    // 429 on one predict a 429 on the next. Spending attempts 0-2 on three
    // different quotas is what makes a retry mean something.
    for (const seed of [0.01, 0.33, 0.5, 0.77, 0.99]) {
      const order = planEndpointOrder(
        DEFAULT_OVERPASS_ENDPOINTS,
        WEIGHTS,
        scriptedRandom([seed]),
      );
      const operators = order.map(operatorForUrl);
      const distinct = new Set(operators).size;
      // The first `distinct` attempts must all be different operators.
      expect(new Set(operators.slice(0, distinct)).size).toBe(distinct);
    }
  });

  it("puts the heaviest operator first MOST of the time, not every time", () => {
    // Both halves are the point. "Most" is what the 2026-07-28 measurement
    // bought and must not be given back; "not every time" is what fixes the
    // herding that decision knowingly accepted. A draw that always returned the
    // heaviest would pass an "is it biased" test and reintroduce the bug.
    const draws = 2000;
    let heaviestFirst = 0;
    const seen = new Set<string>();
    for (let i = 0; i < draws; i++) {
      // A deterministic sweep across [0, 1) rather than Math.random, so the
      // test cannot flake: it samples the distribution exactly.
      const u = (i + 0.5) / draws;
      const first = planEndpointOrder(
        DEFAULT_OVERPASS_ENDPOINTS,
        WEIGHTS,
        scriptedRandom([u]),
      )[0] as string;
      seen.add(operatorForUrl(first));
      if (operatorForUrl(first) === "fossgis") heaviestFirst++;
    }

    // Weights 6:3:1 → fossgis should lead 60% of the time.
    expect(heaviestFirst / draws).toBeGreaterThan(0.55);
    expect(heaviestFirst / draws).toBeLessThan(0.65);
    // …and every operator must get a turn, or this is the strict order again.
    expect(seen).toEqual(new Set(["fossgis", "vk-maps", "private.coffee"]));
  });

  it("keeps an operator's own entries in pool order", () => {
    // They share a quota, so randomising between them buys nothing — and pool
    // order is already the measured preference between the FOSSGIS front-ends.
    const order = planEndpointOrder(
      DEFAULT_OVERPASS_ENDPOINTS,
      WEIGHTS,
      scriptedRandom([0.0]),
    );
    const fossgis = order.filter((url) => operatorForUrl(url) === "fossgis");
    const poolFossgis = DEFAULT_OVERPASS_ENDPOINTS.filter(
      (url) => operatorForUrl(url) === "fossgis",
    );
    expect(fossgis).toEqual(poolFossgis);
  });

  it("treats an unweighted operator as ordinary rather than unreachable", () => {
    // A self-hosted endpoint passed via `endpoints` will not be in the weight
    // table. It must still be drawn — the alternative is a host the caller
    // explicitly configured and the client silently never uses.
    const withCustom = [
      ...DEFAULT_OVERPASS_ENDPOINTS,
      "https://my-own.example/api/interpreter",
    ];
    const firsts = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const order = planEndpointOrder(
        withCustom,
        WEIGHTS,
        scriptedRandom([(i + 0.5) / 400]),
      );
      firsts.add(operatorForUrl(order[0] as string));
    }
    expect(firsts.has("my-own.example")).toBe(true);
  });

  it("survives weights that are zero, negative or not numbers", () => {
    // Defensive at a boundary a caller can reach: `endpoints` and any future
    // weight override are public surface. A bad weight should make an operator
    // unlikely, never divide by zero or drop an endpoint.
    const broken = {
      fossgis: 0,
      "vk-maps": -5,
      "private.coffee": Number.NaN,
    } as unknown as Record<string, number>;

    const order = planEndpointOrder(
      DEFAULT_OVERPASS_ENDPOINTS,
      broken,
      scriptedRandom([0.5]),
    );
    expect([...order].sort()).toEqual([...DEFAULT_OVERPASS_ENDPOINTS].sort());
  });

  it("handles a single-entry pool without drawing anything", () => {
    const one = ["https://only.example/api/interpreter"];
    expect(planEndpointOrder(one, WEIGHTS, scriptedRandom([0.5]))).toEqual(one);
  });
});
