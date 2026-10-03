/**
 * Properties of the viewer's moved-code rule (authoring plan 2026-09-28-0953
 * §3.6, D20, M5c; owner decision of 2026-10-02 on the turn check).
 *
 * Why these properties matter: the unit tests pick a few numbers; the rule
 * runs on every device fix of every visitor who scans a code. So, for ANY
 * estimate:
 * - nothing ever reads `moved` from an estimate inside every threshold: an
 *   unmoved, unturned code is never vetoed;
 * - an unsettled save is never read as turned, whatever the fit's yaw;
 * - `moved` by position never depends on whether the save was settled.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  CODE_MOVE_RULE,
  type DisplacementEstimate,
} from "./code-displacement.js";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import {
  CODE_TURN_RULE,
  isSettledSave,
  judgeCodeMove,
} from "./moved-code-rule.js";

const yaw = fc.double({ min: -180, max: 180, noNaN: true });

describe("moved-code rule properties", () => {
  it("never reads moved from an estimate inside every threshold", () => {
    const inside = fc.record({
      magnitudeM: fc.double({
        min: 0,
        max: CODE_MOVE_RULE.floorM,
        noNaN: true,
      }),
      spanS: fc.double({ min: 0, max: 3600, noNaN: true }),
      spreadM: fc.double({ min: 0, max: 500, noNaN: true }),
      yawDeg: fc.double({
        min: -CODE_TURN_RULE.settledYawDeg,
        max: CODE_TURN_RULE.settledYawDeg,
        noNaN: true,
      }),
    });
    fc.assert(
      fc.property(inside, fc.boolean(), (e, settled) => {
        const estimate: DisplacementEstimate = {
          displacementM: [e.magnitudeM, 0],
          magnitudeM: e.magnitudeM,
          spanS: e.spanS,
          spreadM: e.spreadM,
          samples: 1,
          yawDeg: e.yawDeg,
        };
        expect(judgeCodeMove({ settled, estimate }).verdict).not.toBe("moved");
      }),
    );
  });

  it("never reads an unsettled save as turned, at any yaw, span or spread", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: CODE_MOVE_RULE.floorM, noNaN: true }),
        yaw,
        fc.double({ min: 0, max: 3600, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (m, y, spanS, spreadM) => {
          const j = judgeCodeMove({
            settled: false,
            estimate: {
              displacementM: [m, 0],
              magnitudeM: m,
              spanS,
              spreadM,
              samples: 1,
              yawDeg: y,
            },
          });
          expect(j.verdict).not.toBe("moved");
          expect(j.turnChecked).toBe(false);
        },
      ),
    );
  });

  it("decides a position move the same whether or not the save was settled", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20.001, max: 500, noNaN: true }),
        yaw,
        fc.boolean(),
        (m, y, settled) => {
          const estimate: DisplacementEstimate = {
            displacementM: [0, m],
            magnitudeM: m,
            spanS: 60,
            spreadM: 2,
            samples: 1,
            yawDeg: y,
          };
          expect(judgeCodeMove({ settled, estimate })).toMatchObject({
            verdict: "moved",
            decidedBy: "position",
          });
        },
      ),
    );
  });

  // Why (owner decision D31): the uncertain-heading marker overrides any
  // fix count, and an absent or `false` marker leaves the count rule alone,
  // so levels minted before D31 read exactly as they did.
  it("never calls a headingUncertain save settled; absent or false keeps the count rule", () => {
    const levelOf = (n: number, marker: boolean | undefined): QrLevel => ({
      version: 1,
      qr: {
        physicalSizeM: 0.2,
        geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
        mintQuality: {
          alignmentSampleCount: n,
          ...(marker === undefined ? {} : { headingUncertain: marker }),
        },
      },
    });
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000 }), (n) => {
        const byCount = n >= CODE_TURN_RULE.settledAlignmentSamples;
        expect(isSettledSave(levelOf(n, true))).toBe(false);
        expect(isSettledSave(levelOf(n, false))).toBe(byCount);
        expect(isSettledSave(levelOf(n, undefined))).toBe(byCount);
      }),
    );
  });
});
