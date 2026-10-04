/**
 * Tests for the terrain lab's exaggeration and view-width rules (terrain plan
 * 2026-09-27-0605 DEC-TR-4, §6, §9 findings 9, 10 and 19).
 *
 * Why this file matters: the owner chose "auto" as a SWITCH, off by default,
 * so by default the relief is exactly the slider (2x). With auto on, the
 * factor multiplies the slider and the readout must say the product. A rule
 * that silently applied auto, or capped the product instead of the factor,
 * would show the owner a different relief than the one he set. The auto
 * rule's numbers are the plan's; its exponent is swept (owner rule
 * 2026-09-13) so a reader sees what 0.2 and 0.5 would have given.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  AUTO_RULE,
  EXAGGERATION,
  SLOPE_BOOST,
  autoFactor,
  effectiveExaggeration,
  slopeBoost,
  smoothAltitude,
  viewWidthM,
} from "./terrain-exaggeration.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

describe("the slider", () => {
  // DEC-TR-4's range; the start moved from 2 to the owner's 3 (globe
  // round-5 DEC-GL5-5: "rather too strong at first" than too weak).
  it("runs 1-10 and starts at 3 (DEC-TR-4, DEC-GL5-5)", () => {
    assert.deepEqual(
      [EXAGGERATION.min, EXAGGERATION.max, EXAGGERATION.fallback],
      [1, 10, 3],
    );
  });
});

describe("viewWidthM", () => {
  // Plan §9 finding 9: W from the camera's altitude with a fixed reference
  // view (portrait, 50° vertical field of view), W = 0.43 x altitude.
  it("is 0.43 x the altitude", () => {
    close(viewWidthM(580_000), 249_400, 1e-6, "580 km");
    close(viewWidthM(20_000), 8_600, 1e-6, "20 km");
  });

  it("is never negative (a camera below the datum plane)", () => {
    assert.equal(viewWidthM(-50), 0);
  });
});

describe("autoFactor", () => {
  // The plan's own numbers: 1x at 10 km or less, 2.6x at 250 km, about
  // 1.2x at 20 km, capped at 3.
  it("gives the plan's factors at 10, 20 and 250 km", () => {
    close(autoFactor(10_000), 1, 1e-12, "10 km");
    close(autoFactor(5_000), 1, 1e-12, "5 km (floored at 1)");
    close(autoFactor(20_000), 1.231, 1e-3, "20 km");
    close(autoFactor(250_000), 2.627, 1e-3, "250 km");
  });

  it("caps at 3", () => {
    close(autoFactor(10_000_000), 3, 1e-12, "10 000 km");
    assert.equal(AUTO_RULE.cap, 3);
  });

  // The exponent sweep (plan §6: 0.3, with 0.2 and 0.5 reported). At
  // 250 km: 1.90x, 2.63x, and 5.0x capped to 3.
  for (const [exponent, expected] of [
    [0.2, 1.904],
    [0.3, 2.627],
    [0.5, 3],
  ]) {
    it(`at 250 km with exponent ${exponent} gives ${expected}`, () => {
      close(
        autoFactor(250_000, { ...AUTO_RULE, exponent }),
        expected,
        1e-3,
        `exponent ${exponent}`,
      );
    });
  }

  it("never decreases as the view widens", () => {
    let previous = 0;
    for (let w = 1_000; w <= 5_000_000; w *= 1.3) {
      const f = autoFactor(w);
      assert.ok(f >= previous, `${w}`);
      previous = f;
    }
  });
});

describe("effectiveExaggeration", () => {
  // Default: auto off, so E is the slider at every altitude.
  it("is the slider when auto is off, at any altitude", () => {
    for (const altitudeM of [1_000, 20_000, 580_000, 2_000_000]) {
      assert.equal(
        effectiveExaggeration({ slider: 2, auto: false, altitudeM }),
        2,
      );
    }
  });

  // Plan §9 finding 9: with auto on, E = slider x factor, 5.3x at 250 km
  // with the slider at 2 (the product is not capped, the factor is).
  it("multiplies the slider by the factor when auto is on", () => {
    const altitudeM = 250_000 / 0.43;
    close(
      effectiveExaggeration({ slider: 2, auto: true, altitudeM }),
      5.254,
      1e-3,
      "slider 2 at 250 km",
    );
    close(
      effectiveExaggeration({ slider: 10, auto: true, altitudeM: 1e8 }),
      30,
      1e-9,
      "slider 10, factor capped at 3",
    );
  });

  it("reads a slider outside 1-10 as its nearest end", () => {
    assert.equal(
      effectiveExaggeration({ slider: 0, auto: false, altitudeM: 1 }),
      1,
    );
    assert.equal(
      effectiveExaggeration({ slider: 99, auto: false, altitudeM: 1 }),
      10,
    );
    assert.equal(
      effectiveExaggeration({ slider: Number.NaN, auto: false, altitudeM: 1 }),
      EXAGGERATION.fallback,
    );
  });
});

describe("smoothAltitude", () => {
  // Mapbox saw flicker when exaggeration followed the zoom directly (research
  // §7.2), so auto reads a smoothed altitude. The smoothing is geometric
  // (altitudes span three orders of magnitude on the fly-in), reaches 63 % of
  // the way in one time constant, and never overshoots.
  it("moves 63 % of the way (in log) in one time constant", () => {
    const next = smoothAltitude(10_000, 1_000_000, 0.5, 0.5);
    close(
      Math.log(next / 10_000) / Math.log(100),
      1 - Math.exp(-1),
      1e-9,
      "log fraction",
    );
  });

  it("jumps straight to the target with a zero time constant", () => {
    assert.equal(smoothAltitude(10_000, 20_000, 0.016, 0), 20_000);
  });

  it("never overshoots, over a range of time constants", () => {
    for (const tau of [0.1, 0.25, 0.5, 1, 2]) {
      let alt = 600_000;
      for (let i = 0; i < 200; i++) {
        alt = smoothAltitude(alt, 20_000, 1 / 60, tau);
        assert.ok(alt >= 20_000 && alt <= 600_000, `tau ${tau}`);
      }
    }
  });
});

describe("slopeBoost", () => {
  // Plan §9 finding 19: boost = clamp((W / 5 km)^0.3, 1, 5), 3.2x at 250 km.
  it("is 3.2x at 250 km and 1x at 5 km or less", () => {
    close(slopeBoost(250_000), 3.23, 0.01, "250 km");
    assert.equal(slopeBoost(4_000), 1);
    assert.equal(SLOPE_BOOST.cap, 5);
  });

  // Plan §6: exponent 0.3, with 0.2 and 0.4 reported.
  for (const [exponent, expected] of [
    [0.2, 2.187],
    [0.3, 3.233],
    [0.4, 4.781],
  ]) {
    it(`at 250 km with exponent ${exponent} gives ${expected}`, () => {
      close(
        slopeBoost(250_000, { ...SLOPE_BOOST, exponent }),
        expected,
        1e-3,
        `${exponent}`,
      );
    });
  }
});
