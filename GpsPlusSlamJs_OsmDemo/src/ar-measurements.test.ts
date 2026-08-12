/**
 * The AR readout's formatting, and what it refuses to invent.
 *
 * WHY THESE TESTS MATTER. Milestone 4's whole job is to replace four stated
 * predictions with numbers, and the plan says any figure the environment cannot
 * reach must be "reported as unmeasured rather than estimated". A readout that
 * renders a missing value as `0` breaks that rule at the last step — the number
 * on the phone is what gets written down.
 *
 * @see ar-measurements.ts.md
 */

import { describe, it, expect } from "vitest";

import { describeArMeasurements } from "./ar-measurements.js";

describe("describeArMeasurements", () => {
  it("says nothing at all before anything has been measured", () => {
    // An empty readout is honest; a readout of zeroes is four false claims.
    expect(describeArMeasurements({})).toEqual([]);
  });

  it("reports the AR renderer's draw cost", () => {
    const lines = describeArMeasurements({
      drawCost: { calls: 42, triangles: 812_345 },
    });

    expect(lines).toContain("42 draws / 812,345 tri");
  });

  it("omits a draw cost of zero calls, because no frame has been drawn", () => {
    // three resets `info.render` per render, so zero calls means "no render
    // since the last reset" — not "a frame that drew nothing". Shown as "0
    // draws" those two become indistinguishable, and the second is the failure
    // worth noticing.
    expect(
      describeArMeasurements({ drawCost: { calls: 0, triangles: 0 } }),
    ).toEqual([]);
  });

  it("drops an INFINITE fps rather than printing it", () => {
    // Not hypothetical: fps is computed from `dt`, and the framework's frame
    // contract says `dt` is 0 on the first frame after a reset. `1/0` is
    // `Infinity`, and "Infinity fps" on a measurement HUD is worse than a blank
    // line, because someone might write it down.
    expect(describeArMeasurements({ fps: Number.POSITIVE_INFINITY })).toEqual(
      [],
    );
    expect(describeArMeasurements({ fps: Number.NaN })).toEqual([]);
  });

  it("keeps a tenth of a metre on a good fix and drops it on a poor one", () => {
    // The interesting distinction near the bottom of the range is 4.5 versus
    // 8 m — §4 predicts fix quality is the binding constraint, so that band is
    // exactly what the milestone is looking at. At 30 m the tenth is precision
    // the fix does not have.
    expect(describeArMeasurements({ fixAccuracyM: 4.53 })).toEqual([
      "fix ±4.5 m",
    ]);
    expect(describeArMeasurements({ fixAccuracyM: 28.4 })).toEqual([
      "fix ±28 m",
    ]);
  });

  it("shows distance in metres near the anchor and kilometres far from it", () => {
    // Live from the first step, where "0.0 km" would say nothing. The
    // far-travel WARNING speaks in kilometres because it does not fire until
    // 2 km; this line has to be useful before that.
    expect(describeArMeasurements({ metresFromAnchor: 87.4 })).toEqual([
      "87 m from anchor",
    ]);
    expect(describeArMeasurements({ metresFromAnchor: 2400 })).toEqual([
      "2.4 km from anchor",
    ]);
  });

  it("keeps a fixed order, so a glance always finds the same number in the same place", () => {
    // Read at arm's length, outdoors, while walking. A readout whose lines
    // reorder as values appear and disappear has to be re-read every time.
    const lines = describeArMeasurements({
      drawCost: { calls: 12, triangles: 1000 },
      fps: 59.6,
      fixAccuracyM: 6,
      metresFromAnchor: 40,
    });

    expect(lines).toEqual([
      "12 draws / 1,000 tri",
      "60 fps",
      "fix ±6.0 m",
      "40 m from anchor",
    ]);
  });

  it("omits only the missing ones, keeping the rest in order", () => {
    // The realistic state for most of a session: no fix accuracy yet, or a
    // renderer that has not drawn. The others must not shift meaning.
    expect(describeArMeasurements({ fps: 30, metresFromAnchor: 5 })).toEqual([
      "30 fps",
      "5 m from anchor",
    ]);
  });
});

describe("the vertical baseline — §4's prediction, on screen", () => {
  it("shows it SIGNED, because a negative one is the failure being predicted", () => {
    // §4: "matrix[13], re-estimated per alignment, is what will make the city
    // drift vertically". A baseline below zero means the alignment has put the
    // world under the user — so unlike the other numbers this one is not
    // filtered on `>= 0`; the sign is the information.
    expect(describeArMeasurements({ worldBaselineY: -0.42 })).toEqual([
      "baseline -0.42 m",
    ]);
  });

  it("keeps centimetres, because the question is whether it JUMPS", () => {
    // A metre of drift across a walk is expected. Ten centimetres between two
    // glances is not — and whole metres would hide exactly that.
    expect(describeArMeasurements({ worldBaselineY: 1.234 })).toEqual([
      "baseline 1.23 m",
    ]);
  });

  it("shows an exact zero rather than hiding it", () => {
    // Zero is a real reading here and a meaningful one: the alignment has not
    // moved the world vertically at all. The `>= 0` filter the other fields use
    // would be wrong, and the `undefined` check has to be what excludes it.
    expect(describeArMeasurements({ worldBaselineY: 0 })).toEqual([
      "baseline 0.00 m",
    ]);
  });

  it("drops a non-finite baseline", () => {
    expect(describeArMeasurements({ worldBaselineY: Number.NaN })).toEqual([]);
  });
});
