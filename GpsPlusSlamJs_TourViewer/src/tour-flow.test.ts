import { describe, expect, it } from "vitest";

import {
  arStatusLine,
  contentSegment,
  clearCacheLabel,
  compassHeadingVerdict,
  COMPASS_CONFIRMS_WEIGHT,
  isPlacementReady,
  placementSegment,
  qrSegment,
  type ArStatusInput,
  type CompassHeadingVerdict,
  type PlacementState,
} from "./tour-flow.js";

/**
 * Why these tests matter (flows plan M1): the AR status line is the ONLY
 * feedback a visitor gets during a session (`#error` is outside the DOM
 * overlay). Its copy used to be composed inline in `main.ts`'s
 * `renderArStatus`, where no test could pin it - and the first on-phone
 * session found it promising a printed code to a tour that cannot carry one
 * (F3). Every branch of the line is pinned here, string-exact, so a copy
 * regression is a red test and not a field report.
 */

const RUNNING_BASE: ArStatusInput = {
  mode: "visitor",
  arStatus: "running",
  cameraFrames: 3,
  tour: { kind: "none" },
  qr: {
    status: null,
    unknownCode: null,
    unusableCode: null,
    votedLocks: 0,
    lockedText: null,
    reprojectionErrorPx: null,
  },
  readiness: null,
  placement: { kind: "idle" },
  contentError: null,
  gate: { kind: "idle" },
  content: { kind: "none" },
};

describe("the fused pose's hint in the composed line (plan §66-§67)", () => {
  // Plan §67 #6: the gate passes on the same lock that first evaluates the
  // code, so the hint sits beside "Code recognised"; it must read as
  // fine-tuning, not as a second "code found".
  it("composes the hint with the passed gate, string-exact", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: 1 },
      qr: {
        ...RUNNING_BASE.qr,
        status: "tracking",
        fusedHint: "Measuring the code: keep it in view while you move slowly.",
      },
      gate: { kind: "passed", via: "code" },
    });
    expect(line).toBe(
      "Visitor mode — AR running · 3 camera frames · Measuring the code: keep it in view while you move slowly. · Code recognised - placing the tour.",
    );
  });
});

describe("the fused pose's hint while placement waits (milestone review of b4c #7)", () => {
  // The gate passes before tracking is ready, so a real session's line
  // also carries the placement's coaching segment; the stable-but-no-GPS
  // hint must read coherently beside it.
  it("composes the GPS-wait hint with the gate and the coaching hint", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: 1 },
      qr: {
        ...RUNNING_BASE.qr,
        status: "tracking",
        fusedHint: "Code measured - waiting for the first GPS fix.",
      },
      gate: { kind: "passed", via: "code" },
      placement: { kind: "waiting-ready" },
      readiness: {
        phase: "move-around",
        hint: "Walk around a few steps.",
        percentReady: 40,
      },
    });
    expect(line).toBe(
      "Visitor mode — AR running · 3 camera frames · Code measured - waiting for the first GPS fix. · Code recognised - placing the tour. · Walk around a few steps.",
    );
  });
});

describe("the scan gate and the content in the composed line (M5)", () => {
  it("a scanning gate shows its line and suppresses the placement's coaching hint", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      gate: { kind: "scanning", escapeOffered: false },
      placement: { kind: "waiting-ready" },
      readiness: {
        phase: "move-around",
        hint: "Walk around a few steps.",
        percentReady: 40,
      },
    });
    expect(line).toContain(
      "Point the phone at the tour's code (on the poster)",
    );
    expect(line).not.toContain("Walk around");
  });

  it("a passed gate lets the placement segment back in, and names the placed content", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      gate: { kind: "passed", via: "code" },
      placement: { kind: "waiting-ready" },
      readiness: {
        phase: "move-around",
        hint: "Walk around a few steps.",
        percentReady: 40,
      },
      content: { kind: "placed", count: 2, skipped: 1 },
    });
    expect(line).toContain("Code recognised");
    expect(line).toContain("Walk around");
    expect(line).toContain("2 placed objects (1 could not load)");
    expect(contentSegment({ kind: "placed", count: 1, skipped: 0 })).toBe(
      "1 placed object",
    );
  });

  it("a code-less tour says so once, through the gate's line (M5 review #12)", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: 0 },
      gate: { kind: "not-required", reason: "no-lockable-level" },
    });
    expect(line).toContain("no measured code - placing by GPS");
    expect(line).not.toContain("no printed codes.");
  });

  it("a tour whose levels could not be read says so once, and never scans for a code", () => {
    // Why this matters: a rejected level load leaves `levelCount` null
    // forever. The line once read "Scanning for the printed code… · The
    // tour's printed-code file could not be read · …" - a scan that can
    // never find what it looks for.
    const line = arStatusLine({
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: null },
      gate: { kind: "not-required", reason: "levels-unavailable" },
      // (A declined photo placement stood here, with its segment at the
      // end; a visitor no longer sees the walk's photos.)
      placement: { kind: "idle" },
    });
    expect(line).toBe(
      "Visitor mode — AR running · 3 camera frames · The tour's printed-code file could not be read - placing by GPS.",
    );
  });

  // (The image placement's own failure, "images failed: ...", went with
  // the walk's recorded photos; the content's failure keeps its segment.)
  it("a failed content render has its own segment (M5 review #5)", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      contentError: "labels",
    });
    expect(line).toContain("placed content failed: labels");
    expect(line).not.toContain("images failed");
  });
});

describe("arStatusLine - an unfinished tour", () => {
  // Why: a visitor of a tour that is not finished yet (no tour.json, or no
  // stations) has nothing to scan for or wait for; the debug line says so
  // after its fixed prefix, without the scan or placement segments.
  it("says the tour is not finished, with whom to ask, and nothing else", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      tour: {
        kind: "open",
        levelCount: 0,
        unfinished: { contact: "https://example.org/castle" },
      },
      qr: { ...RUNNING_BASE.qr, status: "scanning" },
      gate: { kind: "not-required", reason: "no-lockable-level" },
      placement: { kind: "waiting-ready" },
    });
    expect(line).toBe(
      "Visitor mode — AR running · 3 camera frames · This tour is not finished yet. Questions about this tour? Contact its maker: https://example.org/castle",
    );
  });
});

describe("arStatusLine - the fixed prefix", () => {
  it("renders mode and status while the session is not running", () => {
    expect(arStatusLine({ ...RUNNING_BASE, arStatus: "ready" })).toBe(
      "Visitor mode — ready",
    );
    expect(
      arStatusLine({ ...RUNNING_BASE, mode: "creator", arStatus: "starting" }),
    ).toBe("Creator mode — starting");
  });

  it("names the start failure's cause for the creator and ?debug=1 (U1 milestone review #1)", () => {
    // Why: the start button became a plain "Try again"; without this line
    // a creator read "error" with no cause anywhere.
    expect(
      arStatusLine({
        ...RUNNING_BASE,
        mode: "creator",
        arStatus: "error",
        arError: "Location permission is required for GPS AR.",
      }),
    ).toBe("Creator mode — error: Location permission is required for GPS AR.");
  });

  it("keeps the e2e-pinned running prefix exactly", () => {
    // ar-mode.spec.js asserts this literal text; the prefix is a contract.
    expect(arStatusLine(RUNNING_BASE)).toBe(
      "Visitor mode — AR running · 3 camera frames",
    );
  });
});

describe("qrSegment - the printed-code line", () => {
  const scanning = {
    ...RUNNING_BASE.qr,
    status: { state: "scanning" } as unknown as NonNullable<
      ArStatusInput["qr"]["status"]
    >,
  };

  it("says the tour has no printed codes instead of scanning for one (F3)", () => {
    expect(
      qrSegment({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: 0 },
        qr: scanning,
      }),
    ).toBe("This tour has no printed codes.");
  });

  it("keeps scanning while the tour's levels are still loading", () => {
    expect(
      qrSegment({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: null },
        qr: scanning,
      }),
    ).toBe("Scanning for the printed code…");
  });

  it("keeps scanning with no tour open - the 2026-09-04 verdict (DEC-T9)", () => {
    expect(qrSegment({ ...RUNNING_BASE, qr: scanning })).toBe(
      "Scanning for the printed code…",
    );
  });

  it("lets a detected unknown code override the no-codes line", () => {
    expect(
      qrSegment({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: 0 },
        qr: { ...scanning, unknownCode: "abc" },
      }),
    ).toBe("Code abc has no level in this tour.");
  });

  it("is empty in author mode and before the pipeline reports", () => {
    expect(qrSegment({ ...RUNNING_BASE, mode: "creator", qr: scanning })).toBe(
      "",
    );
    expect(qrSegment(RUNNING_BASE)).toBe("");
  });
});

describe("placementSegment - what the placement says", () => {
  // Why: once the wait for readiness ended, the placement says nothing; the
  // content's own segment counts what stands. (The walk's recorded photos'
  // "N photos at their stations" and "photos not shown" went with them: a
  // visitor no longer sees a debug camera capture.)
  const cases: [PlacementState, string][] = [
    [{ kind: "idle" }, ""],
    [{ kind: "waiting-ready" }, "Waiting for tracking to warm up…"],
  ];

  it.each(cases)("renders %j", (placement, expected) => {
    expect(placementSegment(placement)).toBe(expected);
  });
});

describe("readiness - the placement trigger and its waiting copy (F3, flows plan M4)", () => {
  // Why this matters: at the first GPS fix the alignment is the identity
  // (no heading), so placing then can start the scene up to 180° wrong.
  // The trigger is the tracking-quality `ready` phase, and while waiting
  // the visitor reads the framework's coaching line - never silence and
  // never "Scanning for the printed code…".
  it("isPlacementReady is true only for a report in the ok state", () => {
    expect(isPlacementReady(null)).toBe(false);
    expect(
      isPlacementReady({
        state: "warming-up",
        confidence: 0.2,
        subScores: {
          convergence: 0,
          residualConsensus: 0,
          gpsAccuracy: 0,
          coverage: 0.2,
        },
      } as never),
    ).toBe(false);
    expect(
      isPlacementReady({
        state: "ok",
        confidence: 0.9,
        subScores: {
          convergence: 1,
          residualConsensus: 1,
          gpsAccuracy: 1,
          coverage: 1,
        },
      } as never),
    ).toBe(true);
  });

  it("waiting-ready renders the phase's coaching hint, or a generic wait without one", () => {
    expect(
      placementSegment(
        { kind: "waiting-ready" },
        {
          phase: "move-around",
          percentReady: 0.3,
          hint: "Walk around a few steps so tracking can warm up.",
        },
      ),
    ).toBe("Walk around a few steps so tracking can warm up.");
    expect(placementSegment({ kind: "waiting-ready" }, null)).toBe(
      "Waiting for tracking to warm up…",
    );
  });

  // (A test of a declined photo placement on a tour without codes stood
  // here; the placement has no declined state since a visitor no longer
  // sees the walk's recorded photos.)
});

describe("clearCacheLabel - the Clear-cache confirmation (F1)", () => {
  // Why this matters: the old label read "Cache cleared" whatever happened,
  // and a count read AFTER the open session's eviction would say 0 for the
  // single-tour case - the exact "nothing happened" the report was about.
  it("names the count, singular and plural, and the empty case", () => {
    expect(clearCacheLabel(0)).toBe("Cache cleared - nothing was stored");
    expect(clearCacheLabel(1)).toBe("Cache cleared - 1 stored tour removed");
    expect(clearCacheLabel(3)).toBe("Cache cleared - 3 stored tours removed");
  });
});

describe("arStatusLine - composition", () => {
  // (The placement's segment here was a declined photo placement, and the
  // images error came after it; both went with the walk's recorded photos,
  // so the content's segments stand in for them.)
  it("joins prefix, QR line, content and the content error with middle dots", () => {
    expect(
      arStatusLine({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: 1 },
        qr: {
          ...RUNNING_BASE.qr,
          status: { state: "scanning" } as unknown as NonNullable<
            ArStatusInput["qr"]["status"]
          >,
        },
        content: { kind: "placed", count: 2, skipped: 0 },
        contentError: "That file does not exist.",
      }),
    ).toBe(
      "Visitor mode — AR running · 3 camera frames · Scanning for the printed code… · 2 placed objects · placed content failed: That file does not exist.",
    );
  });

  it("omits empty segments", () => {
    expect(
      arStatusLine({
        ...RUNNING_BASE,
        placement: { kind: "idle" },
      }),
    ).toBe("Visitor mode — AR running · 3 camera frames");
  });
});

describe("arStatusLine - a code the moved-code check ignores (D20, M5c)", () => {
  // Why (§7j #4): the visitor reads ONE plain sentence - the code seems
  // moved, its position is not used, GPS shows the tour - never the
  // "Relocalized" hold line, and not the gate's short pass on top of it.
  it("says it once, in plain words, with the gate's short pass folded in", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: 1 },
      qr: {
        ...RUNNING_BASE.qr,
        status: "tracking",
        votedLocks: 10,
        lockedText: "code",
        ignoredCode: "code",
      },
      gate: { kind: "passed", via: "ignored" },
    });
    expect(line).toBe(
      "Visitor mode — AR running · 3 camera frames · This code seems to have been moved, so its position is not used. Showing the tour by GPS.",
    );
  });

  it("shows the gate's short pass when the line has no code to name (a re-entry)", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: 1 },
      qr: { ...RUNNING_BASE.qr, status: "scanning" },
      gate: { kind: "passed", via: "ignored" },
    });
    expect(line).toContain("Code ignored - placing the tour by GPS.");
    expect(line).not.toContain("Scanning for the printed code");
  });
});

describe("compassHeadingVerdict - whether a compass stands behind the heading", () => {
  // Why these tests matter: the radar draws north as soon as the content
  // is placed, and calls that heading confirmed only when something stands
  // behind it. The compass diagnostics are external data: every field is
  // absent until measured, and the applied share drops back to 0 once GPS
  // alone carries the heading. A "confirms" on an absent or zero share
  // would draw a confident north nothing confirmed.
  it("confirms once a compass carries a real share of the heading", () => {
    for (const w of [1, 0.6, COMPASS_CONFIRMS_WEIGHT]) {
      expect(
        compassHeadingVerdict({ appliedWeight: w, trust: undefined }),
      ).toBe("confirms");
    }
    expect(
      compassHeadingVerdict({
        appliedWeight: 0.9,
        trust: { state: "trusted" },
      }),
    ).toBe("confirms");
  });

  it("is silent with no compass reading, a share too small, or a value that is no share", () => {
    for (const w of [
      undefined,
      0,
      COMPASS_CONFIRMS_WEIGHT - 0.01,
      Number.NaN,
      -1,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        compassHeadingVerdict({ appliedWeight: w, trust: undefined }),
      ).toBe("silent");
    }
    expect(compassHeadingVerdict(null)).toBe("silent");
    expect(compassHeadingVerdict(undefined)).toBe("silent");
    expect(
      compassHeadingVerdict({
        appliedWeight: undefined,
        trust: { state: "dormant" },
      }),
    ).toBe("silent");
  });

  it("distrusts a compass marked untrusted, whatever its share", () => {
    expect(
      compassHeadingVerdict({
        appliedWeight: 1,
        trust: { state: "untrusted" },
      }),
    ).toBe("distrusts");
  });

  // Why this test matters (the parameter rule: a verdict from one value is
  // provisional): the threshold decides when a provisional north turns
  // confirmed. Each scenario is the share a compass has over a few
  // updates, latched as the guide latches it (a confirm holds until a
  // distrust or the session's end); the sweep finds every threshold that
  // gives the shipped verdicts and requires the shipped value inside that
  // band with room on both sides. The band is (0.03, 0.4]: above 0.4 a
  // compass first seen once GPS carries 60 % of the heading no longer
  // confirms it; at or below 0.03 a compass carrying 3 % of it would.
  it("ships a threshold inside the band where every scenario's verdict holds", () => {
    const scenarios: {
      name: string;
      weights: (number | undefined)[];
      confirmed: boolean;
    }[] = [
      {
        name: "a cold start, standing still",
        weights: [1, 1, 0.95],
        confirmed: true,
      },
      {
        name: "handed back to GPS while walking",
        weights: [1, 0.8, 0.5, 0.2, 0.05],
        confirmed: true,
      },
      {
        name: "a compass first seen late",
        weights: [undefined, undefined, 0.4, 0.3],
        confirmed: true,
      },
      {
        name: "no compass",
        weights: [undefined, undefined, undefined],
        confirmed: false,
      },
      { name: "a compass with no share", weights: [0, 0, 0], confirmed: false },
      {
        name: "a compass with a sliver",
        weights: [0.02, 0.03, 0.01],
        confirmed: false,
      },
    ];
    const latched = (
      weights: (number | undefined)[],
      threshold: number,
    ): boolean => {
      let held = false;
      for (const w of weights) {
        const v: CompassHeadingVerdict = compassHeadingVerdict(
          { appliedWeight: w, trust: undefined },
          threshold,
        );
        if (v === "confirms") held = true;
        if (v === "distrusts") held = false;
      }
      return held;
    };
    const grid = [
      0.01, 0.02, 0.03, 0.04, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.41,
      0.45, 0.5, 0.6, 0.75, 0.9,
    ];
    const band = grid.filter((t) =>
      scenarios.every((s) => latched(s.weights, t) === s.confirmed),
    );
    expect(band).toEqual([0.04, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]);
    expect(band).toContain(COMPASS_CONFIRMS_WEIGHT);
    expect(COMPASS_CONFIRMS_WEIGHT).toBeGreaterThan(band[0]! * 2);
    expect(COMPASS_CONFIRMS_WEIGHT).toBeLessThan(band[band.length - 1]!);
  });
});
