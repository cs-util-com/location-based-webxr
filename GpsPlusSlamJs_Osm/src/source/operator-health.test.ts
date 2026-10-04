/**
 * Per-operator success tracking, and the weights it derives from it.
 *
 * Why these tests matter:
 * The shipped weights are three constants - `fossgis: 4, vk-maps: 3,
 * private.coffee: 1` - and a measurement on 2026-09-21 put what they cost at
 * mean 39.5 s and p90 67.0 s per tile against 22.3 s / 22.0 s for a
 * measured-ish alternative. But no constant can be right for long: the same
 * pool had `maps.mail.ru` at 3/3 on 2026-09-20 and 1/5 a day later. The owner's
 * decision was therefore to ADAPT rather than re-tune.
 *
 * That makes this module a feedback loop in the fetch path, which is the kind
 * of machinery this repo has learned to distrust. So the tests below are
 * written against the ways a feedback loop goes wrong rather than the way it
 * goes right:
 *
 * - it must never drive an operator to zero, or one bad afternoon removes an
 *   endpoint for the rest of the session and a transient outage becomes
 *   permanent;
 * - it must not overreact to one observation, or the first 504 of a healthy
 *   host rewrites the pool;
 * - it must forget, or an operator that recovered stays punished;
 * - it must not punish an operator for OUR bug - a 400 is a malformed query,
 *   and demoting the host that reported it honestly would walk the pool.
 *
 * This is NOT the adaptive deadline rejected on 2026-09-20. A deadline that
 * adapts learns to be patient with a slow host; a weight that adapts learns to
 * avoid it. Opposite direction, from the same observation.
 *
 * @see operator-health.ts.md
 */

import { describe, expect, it } from "vitest";

import {
  createOperatorHealth,
  DEFAULT_HEALTH_FLOOR,
} from "./operator-health.js";

const BASE = { fossgis: 4, "vk-maps": 3, "private.coffee": 1 };

describe("createOperatorHealth", () => {
  it("returns the base weights unchanged before anything has been observed", () => {
    // A fresh session must behave exactly as the constants say. Anything else
    // would make the first fetch of every session a different experiment.
    const health = createOperatorHealth();

    expect(health.weightsFrom(BASE)).toEqual(BASE);
  });

  it("leaves an operator alone while it keeps succeeding", () => {
    const health = createOperatorHealth();
    for (let i = 0; i < 20; i++) health.record("fossgis", "success");

    expect(health.weightsFrom(BASE).fossgis).toBeCloseTo(BASE.fossgis, 5);
  });

  it("demotes an operator that keeps failing", () => {
    // THE ITEM. Five failures is what `private.coffee` did on 2026-09-21 - 2 of
    // 5 whole tiles, both of those beyond the shipped 45 s deadline.
    const health = createOperatorHealth();
    for (let i = 0; i < 5; i++) health.record("private.coffee", "failure");

    const weights = health.weightsFrom(BASE);
    expect(weights["private.coffee"]).toBeLessThan(BASE["private.coffee"]);
    // ...and the others are untouched, because health is per operator.
    expect(weights.fossgis).toBeCloseTo(BASE.fossgis, 5);
  });

  it("NEVER drives an operator to zero, however long it has failed", () => {
    // The failure mode that matters most. A weight of zero removes the endpoint
    // from the draw entirely, so a host that recovers is never tried again and
    // never gets the success that would restore it - a transient outage made
    // permanent by the mechanism meant to route around it.
    const health = createOperatorHealth();
    for (let i = 0; i < 1_000; i++) health.record("vk-maps", "failure");

    const weight = health.weightsFrom(BASE)["vk-maps"] ?? 0;
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeGreaterThanOrEqual(
      BASE["vk-maps"] * DEFAULT_HEALTH_FLOOR,
    );
  });

  it("halves an operator on one failure, and gives most of it back on one success", () => {
    // ONE FAILURE IS WORTH A LOT, and that is a measured choice rather than an
    // oversight. An earlier version of this test demanded that a single failure
    // leave more than half the weight, on the intuition that reacting fast
    // would chase noise. The sweep that chose the prior says otherwise: against
    // a synthetic pool where every host is healthy, every setting swept gave
    // the static weights' own mean to the tenth of a second, so there was no
    // noise to chase - while on the measured day the fastest-reacting setting
    // saved the most.
    //
    // What keeps it safe is not slowness but REVERSIBILITY, which is what this
    // asserts: the demotion is undone almost as fast as it was applied.
    const health = createOperatorHealth();
    health.record("fossgis", "failure");
    const afterFailure = health.weightsFrom(BASE).fossgis ?? 0;
    expect(afterFailure).toBeCloseTo(BASE.fossgis * 0.5, 5);

    // 69% of base, i.e. most of the way back from 50% in a single success.
    health.record("fossgis", "success");
    expect(health.weightsFrom(BASE).fossgis ?? 0).toBeGreaterThan(
      BASE.fossgis * 0.65,
    );
  });

  it("recovers an operator that starts succeeding again", () => {
    // It must FORGET. Without decay a host punished in the first minute of a
    // session carries that for hours, which is exactly the staleness a static
    // weight already has.
    const health = createOperatorHealth();
    for (let i = 0; i < 10; i++) health.record("vk-maps", "failure");
    const punished = health.weightsFrom(BASE)["vk-maps"] ?? 0;

    for (let i = 0; i < 20; i++) health.record("vk-maps", "success");
    const recovered = health.weightsFrom(BASE)["vk-maps"] ?? 0;

    expect(recovered).toBeGreaterThan(punished);
    // Most of the way back, not all of it: the decayed failures are still in
    // the window, which is the point of a window.
    expect(recovered).toBeGreaterThan(BASE["vk-maps"] * 0.9);
  });

  it("ignores an outcome that is OUR fault", () => {
    // A 400 is a malformed query - our bug, reported honestly. Demoting the
    // operator that answered would walk the whole pool one endpoint at a time
    // while the query stayed broken.
    const health = createOperatorHealth();
    for (let i = 0; i < 10; i++) health.record("fossgis", "ours");

    expect(health.weightsFrom(BASE)).toEqual(BASE);
  });

  it("keeps an operator it has never seen at its base weight", () => {
    // A self-hosted endpoint passed via `endpoints` becomes its own operator,
    // and an unobserved operator must not be treated as a failing one.
    const health = createOperatorHealth();
    health.record("fossgis", "failure");

    expect(health.weightsFrom(BASE)["private.coffee"]).toBe(
      BASE["private.coffee"],
    );
  });

  it("carries no state between instances", () => {
    // The health is per source, so two sources in one page - or two tests -
    // cannot contaminate each other.
    const first = createOperatorHealth();
    for (let i = 0; i < 10; i++) first.record("fossgis", "failure");

    expect(createOperatorHealth().weightsFrom(BASE)).toEqual(BASE);
  });

  it("eventually ranks a failing operator BELOW a healthy one four times lighter", () => {
    // The property a consumer actually depends on, and the hardest one to hold:
    // the shipped spread is 4:1, so inverting it means the demotion has to be
    // worth more than the whole base difference.
    //
    // "EVENTUALLY" IS THE HONEST WORD, and the number of observations it needs
    // is a real cost rather than a detail. The decay saturates the attempt
    // count at 1/(1-DECAY), so the demotion approaches its limit rather than
    // reaching it; a first version of this test used 8 observations and failed
    // at 1.04 against 1.00 - close, and on the wrong side.
    const health = createOperatorHealth();
    for (let i = 0; i < 25; i++) {
      health.record("fossgis", "failure");
      health.record("private.coffee", "success");
    }

    const weights = health.weightsFrom(BASE);
    expect(weights["private.coffee"]).toBeGreaterThan(weights.fossgis ?? 0);
  });

  it("is INERT while every operator keeps working", () => {
    // THE PROPERTY THAT MAKES REACTING FAST SAFE, and the one the sweep
    // actually established. If nothing is failing, the draw must be exactly the
    // base draw - so the whole mechanism costs nothing on an ordinary day and
    // can afford to be decisive on a bad one.
    //
    // This replaces a test that asserted the opposite - that a handful of
    // failures must NOT overturn a 4:1 preference. That was an intuition about
    // noise, and the measurement found no noise to protect against.
    const health = createOperatorHealth();
    for (let i = 0; i < 30; i++) {
      for (const operator of Object.keys(BASE)) {
        health.record(operator, "success");
      }
    }

    const weights = health.weightsFrom(BASE);
    const ratio = (weights.fossgis ?? 0) / (weights["private.coffee"] ?? 1);
    expect(ratio).toBeCloseTo(BASE.fossgis / BASE["private.coffee"], 5);
  });

  it("reports what it has seen, so a session can be explained", () => {
    // Every other diagnostic in this package is readable; a selection policy
    // that cannot answer "why did it stop using that host" is the one thing
    // nobody can debug from a field report.
    const health = createOperatorHealth();
    health.record("fossgis", "success");
    health.record("fossgis", "failure");
    health.record("vk-maps", "ours");

    const seen = health.snapshot();
    // DECAYED counts, not raw ones: the first of the two attempts has already
    // been discounted once by the time the second lands, so two observations
    // read as 1.9 rather than 2. Asserting the raw number here would pin an
    // implementation this module deliberately does not have.
    expect(seen.fossgis?.attempts).toBeCloseTo(1.9, 5);
    expect(seen.fossgis?.successes).toBeCloseTo(0.9, 5);
    // The ignored outcome is not an attempt at all.
    expect(seen["vk-maps"]).toBeUndefined();
  });
});

describe("operators the base weights do not name", () => {
  /**
   * WHY THIS MATTERS, and it was found by a PR reviewer rather than by these
   * tests: `weightsFrom` iterated the BASE map, so an operator that had been
   * observed but was absent from it never got a scaled entry at all.
   *
   * That is not a corner case. `operatorForUrl` makes an unknown host **its own
   * operator**, `endpoints` is a documented option, and `takeWeighted` falls
   * back to a neutral weight of 1 for anything the map omits. So a self-hosted
   * endpoint that failed every request would keep weight 1 for the whole
   * session while the named operators around it were demoted to a tenth of
   * theirs - the mechanism steering traffic TOWARDS the broken host, which is
   * the exact inverse of its purpose.
   */
  const NAMED = { fossgis: 4 };

  it("demotes an observed operator that the base map omits", () => {
    const health = createOperatorHealth();
    for (let i = 0; i < 25; i++)
      health.record("self.hosted.example", "failure");

    const weights = health.weightsFrom(NAMED);
    // The neutral fallback is 1, so anything below it is a demotion that
    // `takeWeighted` will actually act on.
    expect(weights["self.hosted.example"]).toBeLessThan(1);
    expect(weights["self.hosted.example"]).toBeGreaterThan(0);
  });

  it("ranks an unnamed failing operator below a named healthy one", () => {
    // The property that was inverted: the unnamed host kept 1 while `fossgis`
    // was scaled down around it.
    const health = createOperatorHealth();
    for (let i = 0; i < 25; i++) {
      health.record("self.hosted.example", "failure");
      health.record("fossgis", "success");
    }

    const weights = health.weightsFrom(NAMED);
    expect(weights["self.hosted.example"]).toBeLessThan(weights.fossgis ?? 0);
  });

  it("leaves an unobserved operator out, so the fallback still applies", () => {
    // The mirror: `weightsFrom` must not invent entries for operators nobody
    // has seen, or it would pin the fallback into the map and make a later
    // change to `DEFAULT_OPERATOR_WEIGHT` silently ineffective.
    const health = createOperatorHealth();
    health.record("fossgis", "success");

    expect(health.weightsFrom(NAMED)).toEqual({ fossgis: 4 });
  });

  it("keeps every base entry, observed or not", () => {
    // Iterating the tallies must not drop the operators the caller named.
    const health = createOperatorHealth();
    health.record("vk-maps", "failure");

    const weights = health.weightsFrom({ fossgis: 4, "private.coffee": 1 });
    expect(weights.fossgis).toBe(4);
    expect(weights["private.coffee"]).toBe(1);
    expect(weights["vk-maps"]).toBeLessThan(1);
  });
});
