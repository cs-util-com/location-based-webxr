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

/**
 * Why these tests matter: the height residual reported from the field is ~10 m
 * and repeatable, and the findings doc that diagnosed it ranked this readout
 * AHEAD of the elevation nudge buttons — because a nudge is a number with
 * nothing to check it against until the raw altitude and its accuracy are on
 * screen. Two filed defects already account for the residual, one of them a
 * library defect where the vertical solve runs no outlier rejection, so
 * distinguishing "the data is wrong" from "my nudge is wrong" is the whole
 * point of showing it.
 */
describe("altitude readout", () => {
  it("shows the reported altitude with its vertical accuracy", () => {
    expect(
      describeArMeasurements({ altitudeM: 123.45, altitudeAccuracyM: 4.2 }),
    ).toEqual(["alt 123.5 m ±4.2 m"]);
  });

  it("shows the altitude alone when no vertical accuracy is reported", () => {
    // Vertical accuracy is optional in the Geolocation API and commonly absent.
    // Omitting the whole line because half of it is missing would hide the
    // number the session is about.
    expect(describeArMeasurements({ altitudeM: 51 })).toEqual(["alt 51.0 m"]);
  });

  it("shows nothing when there is no altitude, even with an accuracy", () => {
    // An accuracy without a value describes nothing, and rendering it alone
    // would read as a measurement.
    expect(describeArMeasurements({ altitudeAccuracyM: 4 })).toEqual([]);
    expect(describeArMeasurements({})).toEqual([]);
  });

  it("keeps a NEGATIVE altitude, which is a real place", () => {
    // The shared `isUsable` guard rejects negatives because an accuracy or a
    // frame rate cannot be below zero. Altitude can: Schiphol, the Dead Sea, any
    // basement. Reusing that guard here would silently drop them.
    expect(describeArMeasurements({ altitudeM: -3.5 })).toEqual(["alt -3.5 m"]);
  });

  it("drops a non-finite altitude", () => {
    expect(describeArMeasurements({ altitudeM: Number.NaN })).toEqual([]);
    expect(
      describeArMeasurements({ altitudeM: 10, altitudeAccuracyM: Number.NaN }),
    ).toEqual(["alt 10.0 m"]);
  });
});

/**
 * Why these tests matter: this is the height decomposition (DEC-H1), the
 * measurement that decides whether the ~10 m residual is a biased GPS altitude
 * or the filed vertical-solve defect. Those two need OPPOSITE fixes, so a line
 * that quietly invents a number here sends weeks of work at the wrong cause.
 * The `no DEM` cases carry most of the weight: a failed terrain load samples
 * flat zero, so the honest-looking `0.0 m` is exactly the false reading this
 * module exists to refuse.
 */
describe("describeArMeasurements — the height decomposition", () => {
  it("shows the residual between GPS altitude and the terrain under the user", () => {
    // THE LINE THE WHOLE READOUT IS FOR. A phone at chest height should read
    // about +1.5 m; a steady +10 m is the reported symptom, stated instead of
    // inferred from a scene that looks wrong.
    const lines = describeArMeasurements({
      altitudeM: 105.5,
      terrainHeightM: 104,
      terrainHasData: true,
    });

    expect(lines).toContain("above terrain +1.5 m");
  });

  it("signs a NEGATIVE residual, which means the camera is under the ground", () => {
    // The sign is the information: below the terrain is the state that makes
    // buildings float overhead.
    expect(
      describeArMeasurements({
        altitudeM: 94,
        terrainHeightM: 104,
        terrainHasData: true,
      }),
    ).toContain("above terrain -10.0 m");
  });

  it("refuses the residual when the DEM never loaded", () => {
    // `heightfieldFrom` samples FLAT ZERO when `hasData` is false, so a failed
    // terrain load would otherwise produce a confident "above terrain +105.5 m".
    const lines = describeArMeasurements({
      altitudeM: 105.5,
      terrainHeightM: 0,
      terrainHasData: false,
    });

    expect(lines.some((line) => line.startsWith("above terrain"))).toBe(false);
    expect(lines).toContain("terrain: no DEM");
  });

  it("warns about a missing DEM even while COLLAPSED", () => {
    // A warning that only appears when expanded is a warning nobody sees
    // (DEC-H2). Everything else new is expanded-only; this is not.
    expect(describeArMeasurements({ terrainHasData: false })).toContain(
      "terrain: no DEM",
    );
  });

  it("shows the auto offset with its confidence, even collapsed", () => {
    // THE PAIR IS THE INSTRUMENT (plan §2.6): `above terrain` is the RAW
    // GPS-vs-DEM residual, untouched by the offset; `auto` is the estimator's
    // correction. Their difference exposes the fused-vertical error LIVE, and
    // once auto engages the city can look right while `above terrain` still
    // reads +7 m — so both lines must be visible while walking, not only in
    // the expanded screenshot set.
    const lines = describeArMeasurements({
      autoOffsetM: 1.4,
      autoConfidence: 0.83,
      autoEngaged: true,
    });

    expect(lines).toContain("auto +1.4 m (conf 0.83)");
  });

  it("says an unengaged offset is NOT applied (cold-review F1)", () => {
    // WHY THIS TEST MATTERS. Below the confidence gate the estimator still
    // publishes a real measurement, but the city is NOT moved by it. A line
    // reading `auto +1.4 m (conf 0.12)` would have the field observer looking
    // for a 1.4 m correction that was never applied and concluding the whole
    // feature is broken — the readout must say which of the two states it is
    // in, because nothing else on screen can.
    expect(
      describeArMeasurements({
        autoOffsetM: 1.4,
        autoConfidence: 0.12,
        autoEngaged: false,
      }),
    ).toContain("auto +1.4 m (conf 0.12, low)");
  });

  it("names both states when an unengaged offset is also frozen", () => {
    // Both flags are independent and both are diagnostic — neither may be
    // swallowed by the other.
    expect(
      describeArMeasurements({
        autoOffsetM: -2.5,
        autoConfidence: 0.08,
        autoEngaged: false,
        autoFrozen: true,
      }),
    ).toContain("auto -2.5 m (conf 0.08, low, frozen)");
  });

  it("says 'not applied' when unengaged with no confidence reported", () => {
    // A bare `low` with no number to qualify it would be meaningless; the
    // fact that survives is that the value is not on the content.
    expect(
      describeArMeasurements({ autoOffsetM: 1.4, autoEngaged: false }),
    ).toContain("auto +1.4 m (not applied)");
  });

  it("signs a negative auto offset and names the frozen state", () => {
    // Frozen means the freeze layer is holding the offset while the user
    // climbs man-made structure — the state the M5 tower test looks for, and
    // invisible anywhere else.
    expect(
      describeArMeasurements({
        autoOffsetM: -2.5,
        autoConfidence: 0.4,
        // Engaged at 0.40: below the 0.5 ENGAGE threshold but above the 0.3
        // RELEASE one — the hysteresis dead band, held from a healthier tick.
        autoEngaged: true,
        autoFrozen: true,
      }),
    ).toContain("auto -2.5 m (conf 0.40, frozen)");
  });

  it("drops the confidence suffix when it was not reported", () => {
    expect(describeArMeasurements({ autoOffsetM: 1.4 })).toContain(
      "auto +1.4 m",
    );
  });

  it("names the serving DEM on the auto line itself (cold-review F7)", () => {
    // The auto offset is a correction AGAINST a specific DEM, and the two
    // candidate DEMs differ by an order of magnitude in resolution — so an
    // offset without its DEM is as uncheckable as a terrain height without
    // one. The terrain line carries the source only in the EXPANDED set;
    // the auto line is in the collapsed walking set, so the source must
    // ride here too or every walking screenshot loses the provenance.
    const lines = describeArMeasurements({
      autoOffsetM: 1.4,
      autoConfidence: 0.82,
      demSourceId: "mapterhorn+terrarium",
      demStats: { servedBy: "mapterhorn", upgrades: 1 },
    });

    expect(lines).toContain("auto +1.4 m (conf 0.82) · mapterhorn");
  });

  it("keeps the auto line suffix-free while no DEM source is reported", () => {
    // Absent id, absent suffix — "not reported" must not render as an empty
    // separator (the terrain line's rule, applied to the paired line).
    expect(
      describeArMeasurements({ autoOffsetM: 1.4, autoConfidence: 0.82 }),
    ).toContain("auto +1.4 m (conf 0.82)");
  });

  it("says nothing about auto while it publishes nothing", () => {
    // Null/off is ABSENCE, never `auto +0.0 m` — a zero would claim the
    // estimator measured agreement when it measured nothing.
    const lines = describeArMeasurements({ autoConfidence: 0.5 });

    expect(lines.some((line) => line.startsWith("auto"))).toBe(false);
  });

  it("names the active DEM source on the terrain line", () => {
    // WHY THIS TEST MATTERS. The demo composes two DEMs (Mapterhorn primary,
    // AWS Terrarium fallback) and the two differ by an order of magnitude in
    // resolution — so a screenshot of the terrain height is only checkable
    // against the upstream if it says which composition produced it.
    const expanded = describeArMeasurements(
      {
        terrainHeightM: 104,
        terrainHasData: true,
        demSourceId: "mapterhorn+terrarium",
      },
      { expanded: true },
    );

    expect(expanded).toContain("terrain 104.0 m · mapterhorn+terrarium");
  });

  it("names the DEM the CURRENT field came from", () => {
    // WHY THIS TEST MATTERS. The composed id names what was ASKED; the stats
    // say what is actually underfoot. A field session standing on the ~30 m
    // global DEM while the line reads like LiDAR would check residuals against
    // the wrong upstream — the source name is what makes the screenshot
    // attributable.
    //
    // CHANGED 2026-08-19 WITH THE DEM RACE. This used to render the primary's
    // SHARE of answered posts ("mapterhorn 98%"), and the share was meaningful
    // only because `fallbackProvider` guaranteed the two sources answered
    // disjoint positions. Under a race both answer every position, so the ratio
    // stops partitioning anything and the percentage becomes arithmetically
    // undefined rather than merely stale. A confident wrong number on a readout
    // used to judge alignment in the field is worse than a plain name.
    const expanded = describeArMeasurements(
      {
        terrainHeightM: 104,
        terrainHasData: true,
        demSourceId: "mapterhorn+terrarium",
        demStats: { servedBy: "mapterhorn", upgrades: 1 },
      },
      { expanded: true },
    );

    expect(expanded).toContain("terrain 104.0 m · mapterhorn");
  });

  it("names the fast source outright while the upgrade has not landed", () => {
    // The state a cold start spends its first seconds in, and the one worth
    // being able to read: everything on screen is the coarse global DEM.
    const expanded = describeArMeasurements(
      {
        terrainHeightM: 104,
        terrainHasData: true,
        demSourceId: "mapterhorn+terrarium",
        demStats: { servedBy: "terrarium", upgrades: 0 },
      },
      { expanded: true },
    );

    expect(expanded).toContain("terrain 104.0 m · terrarium");
  });

  it("falls back to the composed id before anything has served", () => {
    // "none" carries no serving information — nothing has answered yet — so the
    // honest label is the composition that was asked.
    const expanded = describeArMeasurements(
      {
        terrainHeightM: 104,
        terrainHasData: true,
        demSourceId: "mapterhorn+terrarium",
        demStats: { servedBy: "none", upgrades: 0 },
      },
      { expanded: true },
    );

    expect(expanded).toContain("terrain 104.0 m · mapterhorn+terrarium");
  });

  it("keeps the composed-id line when no stats are reported", () => {
    // The pre-stats behaviour, kept: a worker (or fake) that predates the
    // snapshot must not lose the source label it already had.
    const expanded = describeArMeasurements(
      {
        terrainHeightM: 104,
        terrainHasData: true,
        demSourceId: "mapterhorn+terrarium",
      },
      { expanded: true },
    );

    expect(expanded).toContain("terrain 104.0 m · mapterhorn+terrarium");
  });

  it("keeps the plain terrain line when no DEM source is reported", () => {
    // A missing id is "not reported", never an empty suffix — the same
    // omission rule every other absent value here follows.
    const expanded = describeArMeasurements(
      { terrainHeightM: 104, terrainHasData: true },
      { expanded: true },
    );

    expect(expanded).toContain("terrain 104.0 m");
  });

  it("keeps the terrain height and the geoid out of the COLLAPSED readout", () => {
    // DEC-H2: the collapsed set is what you walk with. These are screenshot
    // material, and 14 lines over a camera feed covers the scene being
    // photographed.
    const collapsed = describeArMeasurements({
      terrainHeightM: 104,
      terrainHasData: true,
      geoidUndulationM: 46.2,
    });

    expect(collapsed.some((line) => line.startsWith("terrain "))).toBe(false);
    expect(collapsed.some((line) => line.startsWith("geoid"))).toBe(false);
  });

  it("shows terrain, geoid and position once EXPANDED", () => {
    const expanded = describeArMeasurements(
      {
        terrainHeightM: 104,
        terrainHasData: true,
        geoidUndulationM: 46.2,
        position: { lat: 50.941234, lng: 6.958765 },
      },
      { expanded: true },
    );

    expect(expanded).toContain("terrain 104.0 m");
    expect(expanded).toContain("geoid N +46.2 m");
    // SIX DECIMALS -- a screenshot without coordinates cannot be checked
    // against an external elevation service, returned to, or correlated with
    // another screenshot.
    expect(expanded).toContain("50.941234, 6.958765");
  });

  it("says out loud when NO geoid correction is being applied", () => {
    // The dangerous state is invisible by construction: with N = 0 the whole
    // scene is ~46 m out in central Europe and nothing else on the readout
    // would say so. `describeGeoid` exists in the library for this reason.
    const lines = describeArMeasurements(
      {
        geoidUndulationM: 0,
        geoidModelId: "zero (NO geoid correction applied)",
      },
      { expanded: true },
    );

    expect(lines).toContain(
      "geoid N +0.0 m — zero (NO geoid correction applied)",
    );
  });

  it("keeps a NEGATIVE geoid undulation, which is most of the planet", () => {
    // N is around -30 m over India and -50 m south of Sri Lanka. Routing this
    // through the shared `isUsable` guard would drop exactly those places.
    expect(
      describeArMeasurements({ geoidUndulationM: -31.4 }, { expanded: true }),
    ).toContain("geoid N -31.4 m");
  });

  it("reports how stale the fix is, and warns about it even COLLAPSED", () => {
    // A stale fix and a fresh one look identical on the readout today, and
    // "the alignment drifted" is often "no fix has arrived for 40 s".
    expect(
      describeArMeasurements({ fixAgeMs: 3200 }, { expanded: true }),
    ).toContain("fix 3 s ago");
    expect(describeArMeasurements({ fixAgeMs: 3200 })).toEqual([]);
    expect(describeArMeasurements({ fixAgeMs: 42_000 })).toContain(
      "fix 42 s ago — STALE",
    );
  });

  it("shows the fused bearing, which is the alignment's own answer for north", () => {
    // Read beside the library's compass bearing once that is exposed: the two
    // differing by tens of degrees says the compass is being outvoted or is
    // wrong. Either line alone says nothing.
    expect(
      describeArMeasurements({ fusedBearingDeg: 137.4 }, { expanded: true }),
    ).toContain("fused 137°");
  });

  it("drops every new value when it is not finite", () => {
    // Same rule as the rest of the module: unmeasured is omitted, never zero.
    const lines = describeArMeasurements(
      {
        terrainHeightM: Number.NaN,
        terrainHasData: true,
        geoidUndulationM: Number.NaN,
        fixAgeMs: Number.NaN,
        fusedBearingDeg: Number.NaN,
        position: { lat: Number.NaN, lng: 6.9 },
      },
      { expanded: true },
    );

    expect(lines).toEqual([]);
  });
});
