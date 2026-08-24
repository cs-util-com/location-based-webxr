/**
 * Walking while AR is live — the gate, the warning, and the frozen anchor.
 *
 * WHY THIS IS ITS OWN MILESTONE. The demo has no GPS→position path today: every
 * position change comes from the map. Wiring the framework's GPS watch in is
 * "one line", and **that line starves the cycle** (plan §2.6).
 * `positionChanged` fires `loadTerrain` and `refresh` on every change with no
 * gate; `refresh` is `latestOnly` and aborts the run in flight. At 1 Hz against
 * a pass that takes tens of seconds, no ring ever publishes and the AR view
 * stays empty forever — the failure mode being one of continuous, invisible
 * work rather than an error.
 *
 * @see ar-walking.ts.md
 */

import { describe, it, expect } from "vitest";
import { SCORE_DISK_MAX_RADIUS } from "gps-plus-slam-osm";

import {
  AR_REFRESH_DISTANCE_M,
  FAR_TRAVEL_WARN_M,
  farTravelMessage,
  shouldRefreshFor,
} from "./ar-walking.js";

/** Cologne, and points a known distance from it. */
const ORIGIN = { lat: 50.9413, lng: 6.9583 };

/** A point `metres` due north of {@link ORIGIN}. One degree ≈ 111 320 m. */
function north(metres: number): { lat: number; lng: number } {
  return { lat: ORIGIN.lat + metres / 111_320, lng: ORIGIN.lng };
}

describe("the distance gate", () => {
  it("refuses a step shorter than the threshold, so a 1 Hz watch cannot starve the cycle", () => {
    // THE FAILURE THIS EXISTS TO PREVENT, and it is silent. `refresh` is
    // `latestOnly`: a new run aborts the one in flight. A GPS watch delivering
    // a fresh fix every second against a 15–90 s pass means every run is
    // aborted by the next one and NOTHING ever publishes — no error, no empty
    // state, just a view that stays as it was while the worker runs flat out.
    expect(
      shouldRefreshFor({ from: ORIGIN, to: north(20), passInFlight: false }),
    ).toBe(false);
  });

  it("lets a real walk through", () => {
    // The counterweight. A gate that never opens is the same empty view by a
    // different route, so the threshold has to be reachable at walking pace —
    // 100 m is ~71 s at 1.4 m/s.
    expect(
      shouldRefreshFor({
        from: ORIGIN,
        to: north(AR_REFRESH_DISTANCE_M + 1),
        passInFlight: false,
      }),
    ).toBe(true);
  });

  it("stays shut while a pass is in flight, however far the user has walked", () => {
    // The second half of §2.6's rule, and it is NOT implied by the distance
    // test: someone walking fast crosses the threshold again before a slow pass
    // finishes, and re-triggering there aborts the run that was about to
    // publish. The gate has to be closed by EITHER condition.
    expect(
      shouldRefreshFor({
        from: ORIGIN,
        to: north(AR_REFRESH_DISTANCE_M * 10),
        passInFlight: true,
      }),
    ).toBe(false);
  });

  it("keeps the anchor at the boundary rather than being a coin flip", () => {
    // `> threshold`, matching `nextAnchor`'s own convention. Exactly-at is a
    // measure-zero case in practice; pinning it is about the two modules
    // agreeing, so nobody has to remember which way each one rounds.
    expect(
      shouldRefreshFor({
        from: ORIGIN,
        to: north(AR_REFRESH_DISTANCE_M),
        passInFlight: false,
      }),
    ).toBe(false);
  });

  it("does not fire for a stationary user with a jittering fix", () => {
    // THE REASON THE THRESHOLD IS NOT 10 m. An urban GPS fix wanders 10–30 m
    // while the phone sits still (§2.6 calls fix quality the elephant), so a
    // threshold inside that band makes standing on a street corner pay for a
    // full 21 MB fetch and a re-scored working set, over and over.
    //
    // THE COST IS WASTE, NOT STARVATION, and this comment said starvation until
    // the r509 review. `passInFlight` makes starvation impossible at any
    // threshold — which is what that flag is for, and misattributing the
    // failure here is how someone later concludes the flag is redundant.
    for (const jitter of [5, 10, 20, 30]) {
      expect(
        shouldRefreshFor({
          from: ORIGIN,
          to: north(jitter),
          passInFlight: false,
        }),
        `${jitter} m of fix noise must not trigger a refresh`,
      ).toBe(false);
    }
    expect(AR_REFRESH_DISTANCE_M).toBeGreaterThan(30);
  });

  it("stays inside the scored disc at the worst-case pass duration", () => {
    // WHY 100 AND NOT 200. A refresh triggered after walking D metres lands
    // 1.4·T metres later at walking pace, so the user is D + 1.4·T from the last
    // scored centre when the new data arrives. At the 90 s worst case that is
    // D + 126 m, which must stay inside the scored disc.
    //
    // ⚠️ THE REACH IS DERIVED NOW, and used to be the literal 250. That literal
    // was the radius-4 reach; DEC-K1 raised the radius to 6 and the reach to
    // ~326 m, so this test kept passing while its stated reasoning was wrong —
    // in the conservative direction, which is exactly the kind of wrongness
    // nobody notices. The bound on D is now ~200 m rather than ~124 m.
    //
    // Pinned as an inequality rather than as `toBe(100)`: what matters is the
    // relationship, and a test asserting the constant equals itself would
    // survive a change that broke it.
    const WALKING_PACE_MS = 1.4;
    const WORST_CASE_PASS_S = 90;
    // res-11 centre-to-centre is 49.6 m, plus a 28.66 m edge at the rim.
    const SCORED_REACH_M = SCORE_DISK_MAX_RADIUS * 49.6 + 28.66;
    expect(
      AR_REFRESH_DISTANCE_M + WALKING_PACE_MS * WORST_CASE_PASS_S,
    ).toBeLessThan(SCORED_REACH_M);
  });

  it("refuses a non-finite position instead of comparing against NaN", () => {
    // `greatCircleDistance` returns NaN rather than throwing, and every
    // comparison against NaN is false — so a bad fix would silently mean "never
    // refresh again" for the rest of the session. Closed is the safe direction,
    // but it has to be the DELIBERATE one.
    expect(
      shouldRefreshFor({
        from: ORIGIN,
        to: { lat: Number.NaN, lng: ORIGIN.lng },
        passInFlight: false,
      }),
    ).toBe(false);
  });
});

describe("the far-travel warning", () => {
  it("says nothing while the user is near the session origin", () => {
    expect(farTravelMessage(0)).toBeNull();
    expect(farTravelMessage(FAR_TRAVEL_WARN_M - 1)).toBeNull();
  });

  it("warns from the threshold", () => {
    // `>=`, and the plan says so outright (§2.4: "`>= 2000` is the rule").
    expect(farTravelMessage(FAR_TRAVEL_WARN_M)).not.toBeNull();
  });

  it("KEEPS warning past the re-anchor threshold, which has no upper edge", () => {
    // THE DEFECT THIS TEST EXISTS FOR, and it was a real one rather than a
    // wording slip (r504 review). The band used to be written "2–5 km". 5 000 m
    // is `REANCHOR_THRESHOLD_M`, so a band ENDING there stops the warning
    // exactly where the projection error is worst — and where the suppressed
    // re-anchor means nothing else will fire either. 5 001 m specifically,
    // because that is the first metre past the old upper edge.
    expect(farTravelMessage(5001)).not.toBeNull();
    expect(farTravelMessage(50_000)).not.toBeNull();
  });

  it("warns below the re-anchor threshold, so the two cannot collide", () => {
    // The ordering is the invariant: the warning has to reach the user BEFORE
    // the distance at which the un-suppressed code would have re-anchored.
    expect(FAR_TRAVEL_WARN_M).toBeLessThan(5000);
  });

  it("names the distance, because 'you have walked far' is not actionable", () => {
    // The user's decision is whether to RELOAD here — not to leave AR and
    // re-enter, which changes nothing because `setZeroPos` is a no-op once set
    // (r509 review). So the message has to carry the number that decision turns
    // on. Asserted loosely: the wording is free to change, the number is not.
    expect(farTravelMessage(2400)).toMatch(/2\.4|2400/);
  });

  it("says nothing for a non-finite distance rather than 'NaN km away'", () => {
    expect(farTravelMessage(Number.NaN)).toBeNull();
  });
});
