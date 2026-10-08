/**
 * Why these tests matter (UI round 1, U3; second plan review #3): the
 * keep-or-replace decision for a STORED code runs inside the visit's
 * settle, where the alignment, its picks and the sightings still exist.
 * The planner must judge the walk through the SAME alignment the code
 * would be re-minted through (else the rule and the saved quality block
 * disagree), hand the settle a measurement only when the code changes,
 * and stay out of the way for a code measured in this visit, a code not
 * seen, and a print answered "second copy".
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { mintQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { walkNeededM } from "./code-verdict.js";
import {
  planCodePosition,
  type CodePositionSettleInput,
} from "./code-position-settle.js";
import type { CodeSighting, VisitAlignmentPicks } from "./visit-settle.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ZERO = { lat: 47.5, lon: 8.7 };
const INFO = { hasMatrix: true, sampleCount: 5, gpsAccuracyM: 4 };
const LEVEL_ID = "a1b2c3d4e5f6";
const TEXT = "https://gps.csutil.com/tour/?qr=position";

function yawAlignment(deg: number, t: [number, number, number]): number[] {
  const half = (deg * Math.PI) / 360;
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(0, Math.sin(half), 0, Math.cos(half)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

const CODE: Pose = { position: [0.3, 1.5, -2], rotation: [0, 0, 0, 1] };
const SIGHTING: CodeSighting = {
  text: TEXT,
  levelId: LEVEL_ID,
  odomPose: CODE,
};

/** The stored level, minted through `alignment`, with `extentM` recorded
 *  as its D31 spread (absent: a level from before D31). */
function stored(
  alignment = yawAlignment(0, [0, 400, 0]),
  extentM?: number,
): { id: string; json: string } {
  const result = mintQrLevel({
    odomPose: CODE,
    alignmentMatrix: alignment as never,
    zero: ZERO,
    alignment: INFO,
    sizeM: 0.21,
    nowIso: "2026-10-06T10:00:00.000Z",
  });
  if (!result.ok) throw new Error(result.error);
  const level = JSON.parse(result.json) as {
    qr: { mintQuality?: Record<string, unknown> };
  };
  if (extentM !== undefined) {
    level.qr.mintQuality = {
      ...level.qr.mintQuality,
      alignmentGpsExtentM: extentM,
    };
  }
  return { id: LEVEL_ID, json: JSON.stringify(level) };
}

/** A visit that saw the stored code once, through `alignment`, its pick
 *  resting on `extentM` of GPS spread at 4 m accuracy. */
function input(
  overrides: Partial<CodePositionSettleInput> & {
    alignment?: number[];
    extentM?: number;
  } = {},
): CodePositionSettleInput {
  const alignment = overrides.alignment ?? yawAlignment(2, [1, 400, 0.5]);
  const picks: VisitAlignmentPicks = {
    objects: new Map(),
    measurement: null,
    sightings: [
      {
        atMs: 1_000,
        alignment,
        alignmentInfo: INFO,
        gpsExtentM: overrides.extentM ?? 40,
        walkedM: 3,
        sighting: SIGHTING,
      },
    ],
  };
  return {
    visit: 2,
    mintedLevel: stored(),
    measurement: null,
    sighting: SIGHTING,
    picks,
    alignment,
    zero: ZERO,
    endQuality: { extentM: 0, accuracyM: 4 },
    sizeM: 0.21,
    ...overrides,
  };
}

describe("planCodePosition", () => {
  it("replaces a stored position of unknown quality after a reliable walk, through the sighting's own pick", () => {
    const plan = planCodePosition(input());
    expect(plan?.decision).toEqual({ kind: "replace" });
    // 40 m at 4 m accuracy (needs about 19 m): judged through the pick,
    // not the end alignment's 0 m.
    expect(plan?.candidate).toEqual({ extentM: 40, accuracyM: 4 });
    expect(plan?.stored).toEqual({ extentM: null, accuracyM: 4 });
    expect(plan?.measurement).toEqual({
      levelId: LEVEL_ID,
      text: TEXT,
      odomPose: CODE,
      // The size the visit's poses were solved at.
      sizeM: 0.21,
      visit: 2,
    });
    expect(plan?.pick?.alignmentInfo).toEqual(INFO);
    expect(plan?.offsetM).toBeLessThan(15);
  });

  it("measures the offset through the sighting's pick, not the drifted end alignment", () => {
    // Why: the end alignment carries the drift walked after the sighting;
    // through it a code seen right at its saved spot looks 40 m off and
    // would be left to the move question instead of improved.
    const plan = planCodePosition({
      ...input(),
      alignment: yawAlignment(0, [40, 400, 0]),
    });
    expect(plan?.offsetM).toBeLessThan(3);
    expect(plan?.decision).toEqual({ kind: "replace" });
  });

  it("keeps the stored position for the field recording's standing re-measure (R1: 6 m of spread)", () => {
    const plan = planCodePosition(
      input({
        extentM: 6,
        mintedLevel: stored(undefined, undefined),
      }),
    );
    expect(plan?.decision).toMatchObject({
      kind: "keep",
      reason: "not-walked",
    });
    expect(plan?.measurement).toBeNull();
  });

  it("keeps a stored position that was itself walked well", () => {
    const plan = planCodePosition(
      input({ mintedLevel: stored(undefined, 60) }),
    );
    expect(plan?.decision).toEqual({ kind: "keep", reason: "stored-good" });
  });

  it("leaves a code seen far from its saved spot to the automatic code-spot rule", () => {
    const plan = planCodePosition(
      input({ alignment: yawAlignment(0, [40, 400, 0]) }),
    );
    expect(plan?.offsetM).toBeCloseTo(40, 0);
    expect(plan?.decision).toEqual({ kind: "keep", reason: "far" });
  });

  it("applies an automatic move once the walk is reliable, and keeps the code before", () => {
    const far = yawAlignment(0, [40, 400, 0]);
    const moved = planCodePosition(
      input({ alignment: far, automaticMove: true }),
    );
    expect(moved?.decision).toEqual({ kind: "move" });
    expect(moved?.measurement?.odomPose).toEqual(CODE);
    const kept = planCodePosition(
      input({ alignment: far, extentM: 5, automaticMove: true }),
    );
    expect(kept?.decision.kind).toBe("keep");
    expect(kept?.measurement).toBeNull();
  });

  // The automatic code-spot rule mints the move where this plan's
  // candidate lies, so the offset must come out north and east as well.
  it("reports the candidate's offset north and east of the saved spot", () => {
    const plan = planCodePosition(
      input({ alignment: yawAlignment(0, [40, 400, 0]) }),
    );
    expect(plan?.offsetNorthM).toBeCloseTo(40, 0);
    expect(plan?.offsetEastM).toBeCloseTo(0, 0);
  });

  it("decides nothing for a code measured in this visit, or a visit that never saw it", () => {
    expect(
      planCodePosition(
        input({
          measurement: {
            levelId: LEVEL_ID,
            text: TEXT,
            odomPose: CODE,
            sizeM: 0.21,
            visit: 2,
          },
        }),
      ),
    ).toBeNull();
    const unseen = input({ sighting: null });
    expect(
      planCodePosition({
        ...unseen,
        picks: { objects: new Map(), measurement: null, sightings: [] },
      }),
    ).toBeNull();
    expect(planCodePosition(input({ mintedLevel: null }))).toBeNull();
    expect(planCodePosition(input({ zero: null }))).toBeNull();
  });

  it("without a pick's quality block, judges and re-mints through the end alignment, keeping the sighting's walked distance", () => {
    // Why: the settle re-mints through the pick only when it carries its
    // quality block (R7 of D33); the rule must judge that same alignment.
    const base = input();
    const only = base.picks!.sightings[0]!;
    const { alignmentInfo: _dropped, ...withoutInfo } = only;
    const plan = planCodePosition({
      ...base,
      picks: { ...base.picks!, sightings: [withoutInfo] },
      endQuality: { extentM: 30, accuracyM: 4 },
    });
    expect(plan?.candidate).toEqual({ extentM: 30, accuracyM: 4 });
    expect(plan?.decision).toEqual({ kind: "replace" });
    expect(plan?.pick?.alignment).toBeNull();
    expect(plan?.pick?.walkedM).toBe(3);
  });

  // Why (U3 milestone review #1): a pick freezes once its alignment
  // matures at 40 m of GPS spread, but 4.77 x accuracy exceeds 40 m above
  // about 8.4 m accuracy - judged through the pick alone, no walk could
  // ever improve or move the code. The end alignment keeps growing.
  it("judges through the end alignment when the frozen pick is not reliable", () => {
    const base = input();
    const frozen = {
      ...base.picks!.sightings[0]!,
      gpsExtentM: 40,
      alignmentInfo: { ...INFO, gpsAccuracyM: 10 },
    };
    const plan = planCodePosition({
      ...base,
      picks: { ...base.picks!, sightings: [frozen] },
      endQuality: { extentM: 60, accuracyM: 10 },
    });
    expect(plan?.decision).toEqual({ kind: "replace" });
    expect(plan?.candidate).toEqual({ extentM: 60, accuracyM: 10 });
    expect(plan?.pick?.alignment).toBeNull();
  });

  it("can always be reached by walking: swept over GPS accuracy 3-20 m with the pick frozen at 40 m", () => {
    // The verdict across the range the plan named (§7 #4), not at one
    // accuracy: a walk just past the need replaces, just short keeps.
    for (let accuracyM = 3; accuracyM <= 20; accuracyM += 1) {
      const need = Math.max(10, walkNeededM(accuracyM));
      const base = input();
      const frozen = {
        ...base.picks!.sightings[0]!,
        gpsExtentM: 40,
        alignmentInfo: { ...INFO, gpsAccuracyM: accuracyM },
      };
      const at = (extentM: number) =>
        planCodePosition({
          ...base,
          picks: { ...base.picks!, sightings: [frozen] },
          endQuality: { extentM, accuracyM },
        })?.decision.kind;
      expect(at(need + 1), String(accuracyM)).toBe("replace");
      // Just short: the frozen pick decides while it is reliable itself.
      expect(at(need - 1), String(accuracyM)).toBe(
        need > 40 ? "keep" : "replace",
      );
    }
  });

  it("never silently replaces a code beyond the code correction's plausibility bound, even below 15 m", () => {
    // Why (U3 milestone review #11): with 2 m accuracies the bound is
    // about 13.5 m; an offset between it and 15 m is a second print or a
    // moved poster to the settle, never a silent improvement.
    const precise = { ...INFO, gpsAccuracyM: 2 };
    const level = (() => {
      const r = mintQrLevel({
        odomPose: CODE,
        alignmentMatrix: yawAlignment(0, [0, 400, 0]) as never,
        zero: ZERO,
        alignment: precise,
        sizeM: 0.21,
        nowIso: "2026-10-06T10:00:00.000Z",
      });
      if (!r.ok) throw new Error(r.error);
      return { id: LEVEL_ID, json: r.json };
    })();
    const base = input({ alignment: yawAlignment(0, [14, 400, 0]) });
    const plan = planCodePosition({
      ...base,
      mintedLevel: level,
      picks: {
        ...base.picks!,
        sightings: [{ ...base.picks!.sightings[0]!, alignmentInfo: precise }],
      },
    });
    expect(plan?.offsetM).toBeCloseTo(14, 0);
    expect(plan?.decision).toEqual({ kind: "keep", reason: "far" });
  });
});
