/**
 * The viewer's whole moved-code rule (authoring plan 2026-09-28-0953 §3.6,
 * D20, M5c): the position half against the 20 m floor alone, and the turn
 * check with its three channels.
 *
 * Why these tests matter: a `moved` verdict makes the viewer ignore a printed
 * code for the rest of the tour, and the rigid fit alone can never see a
 * poster re-hung facing another way (§7l D3) - it absorbs the turn exactly.
 * Each channel exists because the others cannot be trusted in its case: the
 * fit's yaw only means "turned" when the saved heading was settled, the
 * compass only outdoors, and the fallback only past a threshold the real
 * walks put at 90 degrees. A wrong channel choice is a silent false alarm
 * (or a silent miss), so the choice is pinned here.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  CODE_MOVE_RULE,
  pinCode,
  type DisplacementEstimate,
} from "./code-displacement.js";
import { alignmentNorthBearingDeg } from "./gps-noise-fit.js";
import {
  CODE_TURN_RULE,
  compassTurnDeg,
  isOutdoorByAccuracy,
  isSettledSave,
  judgeCodeMove,
  MOVED_CODE_HORIZON_S,
  turnChannelOf,
} from "./moved-code-rule.js";
import type { NuePose } from "./visit-anchoring.js";

const rad = (d: number): number => (d * Math.PI) / 180;

function pose(n: number, e: number, yawDeg: number): NuePose {
  const h = rad(yawDeg) / 2;
  return { position: [n, 1.5, e], rotation: [0, Math.sin(h), 0, Math.cos(h)] };
}

/** The true odometry-to-world transform: a 40 degree turn and a shift. */
const ODOM_TO_WORLD = new Matrix4().compose(
  new Vector3(120, 3, -60),
  new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad(40)),
  new Vector3(1, 1, 1),
);
/** What a perfect compass reads: the bearing of the odometry's north. */
const TRUE_AR_NORTH = alignmentNorthBearingDeg(ODOM_TO_WORLD.toArray())!;

/** The saved code at world (10, 20) facing 30 degrees, as the odometry sees
 *  it after a turn of `turnDeg` (the pin of that sighting). */
function pinTurned(turnDeg: number) {
  const stored = pose(10, 20, 30);
  const physical = new Matrix4().compose(
    new Vector3(...stored.position),
    new Quaternion(...pose(0, 0, 30 + turnDeg).rotation),
    new Vector3(1, 1, 1),
  );
  const seen = ODOM_TO_WORLD.clone().invert().multiply(physical);
  const p = new Vector3();
  const q = new Quaternion();
  seen.decompose(p, q, new Vector3());
  return pinCode(
    { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] },
    stored,
  )!;
}

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

describe("the turn check's inputs", () => {
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

  // Why: the outdoor proxy is the only thing between an indoor compass
  // (10 % false alarms at 45 degrees) and a veto.
  it("reads outdoors from the device fixes' median reported accuracy", () => {
    expect(isOutdoorByAccuracy(4)).toBe(true);
    expect(isOutdoorByAccuracy(6.5)).toBe(true);
    expect(isOutdoorByAccuracy(6.6)).toBe(false);
    expect(isOutdoorByAccuracy(null)).toBe(false);
    expect(isOutdoorByAccuracy(0)).toBe(false);
    expect(isOutdoorByAccuracy(Number.NaN)).toBe(false);
  });

  // Why: "the code's facing direction at the scan" is the compass's view of
  // the odometry combined with the camera's view of the code; it reduces to
  // the bearing the code's pin gives the odometry's north against the
  // compass's. A turned poster turns the pin by the turn.
  it("reads a turned poster as its turn against a perfect compass, and an unturned one as zero", () => {
    expect(compassTurnDeg(TRUE_AR_NORTH, pinTurned(0))).toBeCloseTo(0, 6);
    expect(Math.abs(compassTurnDeg(TRUE_AR_NORTH, pinTurned(90))!)).toBeCloseTo(
      90,
      6,
    );
    expect(
      Math.abs(compassTurnDeg(TRUE_AR_NORTH, pinTurned(180))!),
    ).toBeCloseTo(180, 6);
    expect(compassTurnDeg(Number.NaN, pinTurned(0))).toBeNull();
  });

  it("picks exactly one channel: settled yaw, else an outdoor compass, else the fallback", () => {
    expect(
      turnChannelOf({ settled: true, compassTurnDeg: 5, outdoor: true }),
    ).toBe("settled-yaw");
    expect(
      turnChannelOf({ settled: false, compassTurnDeg: 5, outdoor: true }),
    ).toBe("compass");
    expect(
      turnChannelOf({ settled: false, compassTurnDeg: 5, outdoor: false }),
    ).toBe("fallback-yaw");
    expect(
      turnChannelOf({ settled: false, compassTurnDeg: null, outdoor: true }),
    ).toBe("fallback-yaw");
  });
});

describe("judgeCodeMove", () => {
  const unsettledNoCompass = {
    settled: false,
    compassTurnDeg: null,
    outdoor: true,
  };

  it("reads moved by position first, whatever the turn channel says", () => {
    const j = judgeCodeMove({
      ...unsettledNoCompass,
      estimate: est({ displacementM: [25, 0], magnitudeM: 25, yawDeg: 120 }),
    });
    expect(j).toEqual({
      verdict: "moved",
      decidedBy: "position",
      boundM: 20,
      turnChannel: "fallback-yaw",
    });
  });

  // Why: the settled channel is the rigid fit's yaw past 45 degrees, gated
  // like the position (60 s, 2 m) - below the spread the fit has no turn.
  it("settled: the rigid yaw past 45 degrees, with the position rule's evidence", () => {
    const settled = { settled: true, compassTurnDeg: null, outdoor: true };
    expect(
      judgeCodeMove({ ...settled, estimate: est({ yawDeg: -46 }) }),
    ).toMatchObject({ verdict: "moved", decidedBy: "settled-yaw" });
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

  // Why: the compass decides at the scan (no evidence gate), and only when
  // the save is not settled and the fixes read as outdoors.
  it("not settled, outdoors with a compass: the compass past 60 degrees, at once", () => {
    const at = (deg: number, outdoor = true) =>
      judgeCodeMove({
        settled: false,
        compassTurnDeg: deg,
        outdoor,
        estimate: null,
      });
    expect(at(-61)).toMatchObject({ verdict: "moved", decidedBy: "compass" });
    expect(at(60).verdict).toBe("undecided");
    // Indoors the compass is not read; the fallback has no evidence yet.
    expect(at(120, false)).toMatchObject({
      verdict: "undecided",
      turnChannel: "fallback-yaw",
    });
  });

  // Why: an early save's heading error reaches every yaw reading; the real
  // walks put the fallback at 90 degrees (1.1 % false alarms) and the spread
  // at 10 m.
  it("not settled, no compass: the rigid yaw past 90 degrees once the walk spreads 10 m", () => {
    expect(
      judgeCodeMove({
        ...unsettledNoCompass,
        estimate: est({ yawDeg: 91, spreadM: 10 }),
      }),
    ).toMatchObject({ verdict: "moved", decidedBy: "fallback-yaw" });
    expect(
      judgeCodeMove({
        ...unsettledNoCompass,
        estimate: est({ yawDeg: 91, spreadM: 9.9 }),
      }).verdict,
    ).toBe("consistent");
    expect(
      judgeCodeMove({
        ...unsettledNoCompass,
        estimate: est({ yawDeg: 89, spreadM: 30 }),
      }).verdict,
    ).toBe("consistent");
  });

  // Why: the owner approved these values on 2026-10-02 and M5c measured the
  // rest on the real walks (the figures are on CODE_TURN_RULE); a change
  // moves the veto's false-alarm and detection limits.
  it("records the approved and measured turn rule and the check's horizon", () => {
    expect(CODE_TURN_RULE).toEqual({
      settledYawDeg: 45,
      settledAlignmentSamples: 120,
      compassDeg: 60,
      outdoorMaxAccuracyM: 6.5,
      fallbackYawDeg: 90,
      fallbackMinSpreadM: 10,
    });
    expect(MOVED_CODE_HORIZON_S).toBe(300);
    expect(CODE_MOVE_RULE.floorM).toBe(20);
  });
});
