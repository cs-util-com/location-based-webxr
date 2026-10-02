/**
 * Properties of the viewer's moved-code rule (authoring plan 2026-09-28-0953
 * §3.6, D20, M5c).
 *
 * Why these properties matter: the unit tests pick a few numbers; the rule
 * runs on every device fix of every visitor who scans a code. So, for ANY
 * odometry frame, saved pose and turn:
 * - against a perfect compass the compass channel reads exactly the turn
 *   (the pin turns by it; nothing else reaches the reading);
 * - no channel ever reads `moved` from an estimate inside every threshold:
 *   an unmoved, unturned code with good sensors is never vetoed;
 * - `moved` by position never depends on the turn inputs.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Matrix4, Quaternion, Vector3 } from "three";

import {
  CODE_MOVE_RULE,
  pinCode,
  type DisplacementEstimate,
} from "./code-displacement.js";
import { alignmentNorthBearingDeg } from "./gps-noise-fit.js";
import {
  CODE_TURN_RULE,
  compassTurnDeg,
  judgeCodeMove,
} from "./moved-code-rule.js";

const rad = (d: number): number => (d * Math.PI) / 180;
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const yaw = fc.double({ min: -180, max: 180, noNaN: true });
const coord = fc.double({ min: -300, max: 300, noNaN: true });

const turnInputs = fc.record({
  settled: fc.boolean(),
  compassTurnDeg: fc.option(yaw, { nil: null }),
  outdoor: fc.boolean(),
});

describe("moved-code rule properties", () => {
  it("reads a turned poster's turn exactly against a perfect compass, in any frame", () => {
    fc.assert(
      fc.property(
        yaw,
        fc.tuple(coord, coord),
        fc.tuple(coord, coord, yaw),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (odomYaw, shift, [sn, se, sh], turn) => {
          const odomToWorld = new Matrix4().compose(
            new Vector3(shift[0], 0, shift[1]),
            new Quaternion().setFromAxisAngle(
              new Vector3(0, 1, 0),
              rad(odomYaw),
            ),
            new Vector3(1, 1, 1),
          );
          const facing = (deg: number) =>
            new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad(deg));
          const physical = new Matrix4().compose(
            new Vector3(sn, 1.5, se),
            facing(sh + turn),
            new Vector3(1, 1, 1),
          );
          const seen = odomToWorld.clone().invert().multiply(physical);
          const p = new Vector3();
          const q = new Quaternion();
          seen.decompose(p, q, new Vector3());
          const stored = facing(sh);
          const pin = pinCode(
            { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] },
            {
              position: [sn, 1.5, se],
              rotation: [stored.x, stored.y, stored.z, stored.w],
            },
          );
          if (pin === null) return;
          const compass = alignmentNorthBearingDeg(odomToWorld.toArray())!;
          const read = compassTurnDeg(compass, pin)!;
          expect(
            Math.abs(wrap180(Math.abs(read) - Math.abs(turn))),
          ).toBeLessThan(1e-6);
        },
      ),
    );
  });

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
      compass: fc.double({
        min: -CODE_TURN_RULE.compassDeg,
        max: CODE_TURN_RULE.compassDeg,
        noNaN: true,
      }),
    });
    fc.assert(
      fc.property(inside, turnInputs, (e, input) => {
        const estimate: DisplacementEstimate = {
          displacementM: [e.magnitudeM, 0],
          magnitudeM: e.magnitudeM,
          spanS: e.spanS,
          spreadM: e.spreadM,
          samples: 1,
          yawDeg: e.yawDeg,
        };
        const j = judgeCodeMove({
          ...input,
          compassTurnDeg: input.compassTurnDeg === null ? null : e.compass,
          estimate,
        });
        expect(j.verdict).not.toBe("moved");
      }),
    );
  });

  it("decides a position move the same whatever the turn inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20.001, max: 500, noNaN: true }),
        yaw,
        turnInputs,
        turnInputs,
        (m, y, a, b) => {
          const estimate: DisplacementEstimate = {
            displacementM: [0, m],
            magnitudeM: m,
            spanS: 60,
            spreadM: 2,
            samples: 1,
            yawDeg: y,
          };
          expect(judgeCodeMove({ ...a, estimate })).toMatchObject({
            verdict: "moved",
            decidedBy: "position",
          });
          expect(judgeCodeMove({ ...b, estimate }).decidedBy).toBe("position");
        },
      ),
    );
  });
});
