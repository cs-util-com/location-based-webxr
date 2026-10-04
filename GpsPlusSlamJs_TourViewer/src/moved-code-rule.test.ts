/**
 * The viewer's whole moved-code rule (authoring plan 2026-09-28-0953 §3.6,
 * D20, M5c; owner decision of 2026-10-02 on the turn check): the position
 * half against the 20 m floor alone, and ONE turn check - the code's heading
 * in GPS world space (the rigid fit's yaw) against its saved heading.
 *
 * Why these tests matter: a `moved` verdict makes the viewer ignore a printed
 * code for the rest of the tour, and the rigid fit's displacement alone can
 * never see a poster re-hung facing another way (§7l D3) - it absorbs the
 * turn exactly. The fit's yaw only means "turned" when the saved heading was
 * settled; an early save carries its alignment's heading error into every
 * reading (28.5 % of unmoved codes past 45 degrees on the real walks). The
 * owner ruled (2026-10-02) that the code's rotation comes ONLY from its pose
 * in GPS world space: no compass, and no fallback for an early save. A
 * channel that came back would be a silent false alarm, so its absence is
 * pinned here.
 */
import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  CODE_MOVE_RULE,
  type DisplacementEstimate,
} from "./code-displacement.js";
import {
  CODE_TURN_RULE,
  isSettledSave,
  judgeCodeMove,
  MOVED_CODE_HORIZON_S,
} from "./moved-code-rule.js";

const est = (
  over: Partial<DisplacementEstimate> = {},
): DisplacementEstimate => ({
  displacementM: [3, 0],
  magnitudeM: 3,
  spanS: 120,
  spreadM: 12,
  samples: 200,
  yawDeg: 0,
  ...over,
});

const level = (alignmentSampleCount?: number): QrLevel => ({
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    ...(alignmentSampleCount === undefined
      ? {}
      : { mintQuality: { alignmentSampleCount } }),
  },
});

describe("the turn check's input", () => {
  // Why: the level carries no alignment age, only how many fixes its
  // alignment had solved; 120 is about 60 s at the corpus' 2 Hz. A level
  // without the count must not be trusted as settled.
  it("calls a save settled from its alignment's solved-fix count, and nothing else", () => {
    expect(isSettledSave(level(120))).toBe(true);
    expect(isSettledSave(level(500))).toBe(true);
    expect(isSettledSave(level(119))).toBe(false);
    expect(isSettledSave(level())).toBe(false);
    expect(isSettledSave(level(Number.NaN))).toBe(false);
  });

  // Why (owner decision D31, 2026-10-02): a code composed through an
  // alignment with under about 10 m of GPS extent has a near-guesswork
  // heading (measured 0-5 m: about 41 degrees p50), however many fixes that
  // alignment had solved - a visitor standing still at the code piles up
  // fixes without any extent. The mint marks such a level
  // `headingUncertain`; the viewer must then not trust its heading, so the
  // turn check does not run. Absent or `false` keeps the count rule
  // (levels minted before D31 carry no marker).
  it("never calls a save marked headingUncertain settled, whatever its count", () => {
    const marked = (
      alignmentSampleCount: number,
      headingUncertain: boolean,
    ): QrLevel => ({
      version: 1,
      qr: {
        physicalSizeM: 0.2,
        geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
        mintQuality: {
          alignmentSampleCount,
          alignmentGpsExtentM: headingUncertain ? 3 : 40,
          headingUncertain,
        },
      },
    });
    expect(isSettledSave(marked(120, true))).toBe(false);
    expect(isSettledSave(marked(5_000, true))).toBe(false);
    expect(isSettledSave(marked(120, false))).toBe(true);
    expect(isSettledSave(marked(119, false))).toBe(false);
  });
});

describe("judgeCodeMove", () => {
  it("reads moved by position first, settled or not", () => {
    for (const settled of [true, false]) {
      const j = judgeCodeMove({
        settled,
        estimate: est({ displacementM: [25, 0], magnitudeM: 25, yawDeg: 120 }),
      });
      expect(j).toEqual({
        verdict: "moved",
        decidedBy: "position",
        boundM: 20,
        turnChecked: settled,
      });
    }
  });

  // Why: the turn check is the rigid fit's yaw past 45 degrees, gated like
  // the position (60 s, 2 m) - below the spread the fit has no turn.
  it("settled: the rigid yaw past 45 degrees, with the position rule's evidence", () => {
    const settled = { settled: true };
    expect(
      judgeCodeMove({ ...settled, estimate: est({ yawDeg: -46 }) }),
    ).toEqual({
      verdict: "moved",
      decidedBy: "turn",
      boundM: 20,
      turnChecked: true,
    });
    expect(
      judgeCodeMove({ ...settled, estimate: est({ yawDeg: 45 }) }).verdict,
    ).toBe("consistent");
    expect(
      judgeCodeMove({
        ...settled,
        estimate: est({ yawDeg: 90, spreadM: 1.9 }),
      }).verdict,
    ).toBe("undecided");
    expect(
      judgeCodeMove({ ...settled, estimate: est({ yawDeg: 90, spanS: 59 }) })
        .verdict,
    ).toBe("undecided");
  });

  // Why (owner, 2026-10-02): an early save's heading is not trustworthy, so
  // its code is never judged turned - however far the visitor walks and
  // however large the fit's yaw. Only the position can veto it.
  it("unsettled save: no turn check at all, at any yaw and any spread", () => {
    for (const yawDeg of [46, 91, 150, -179]) {
      for (const spreadM of [2, 10, 50]) {
        const j = judgeCodeMove({
          settled: false,
          estimate: est({ yawDeg, spreadM, spanS: 300 }),
        });
        expect(j).toEqual({
          verdict: "consistent",
          decidedBy: null,
          boundM: 20,
          turnChecked: false,
        });
      }
    }
  });

  // Why (owner, 2026-10-02): "the global rotation of the QR code should only
  // ever come from the global pose in the GPS world space". A compass reading
  // handed in by any caller must change nothing: the rule has no input for
  // it, settled or not.
  it("uses no compass reading: a stray compass input changes no verdict", () => {
    for (const settled of [true, false]) {
      const plain = judgeCodeMove({ settled, estimate: est({ yawDeg: 10 }) });
      const withCompass = judgeCodeMove({
        settled,
        estimate: est({ yawDeg: 10 }),
        compassTurnDeg: 170,
        outdoor: true,
      } as Parameters<typeof judgeCodeMove>[0]);
      expect(withCompass).toEqual(plain);
      expect(withCompass.verdict).toBe("consistent");
    }
  });

  // Why: the owner approved these values on 2026-10-02 and M5c measured them
  // on the real walks (the figures are on CODE_TURN_RULE); a change moves the
  // veto's false-alarm and detection limits. No compass or fallback value
  // may come back.
  it("records the approved turn rule and the check's horizon", () => {
    expect(CODE_TURN_RULE).toEqual({
      settledYawDeg: 45,
      settledAlignmentSamples: 120,
    });
    expect(MOVED_CODE_HORIZON_S).toBe(300);
    expect(CODE_MOVE_RULE.floorM).toBe(20);
  });
});
