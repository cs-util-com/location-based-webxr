/**
 * The authoring settle (authoring plan 2026-09-28-0953 §3.2, M2c; D2,
 * D10b): which alignment a finished AR visit's objects are recomputed
 * through, and what comes out.
 *
 * Why these tests matter: symptom B had two halves. Within a visit, the
 * code was composed through the alignment at its "Save" tap and each note
 * through the alignment at ITS tap, so even a perfect relocalization could
 * not put the notes back relative to the code (plan §2.2, B2). Across
 * visits, a later visit's own GPS alignment put its notes metres from the
 * code's stored geo (§7b finding 2). The settle has to remove both, and
 * leave everything it has no odometry for exactly as it was.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { mintQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { mintPin, objectPoseNue } from "./content-placement.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";
import {
  CORRECTION_MAX_YAW_DEG,
  correctionBoundM,
  measurementRole,
  planMove,
  planVisitSettle,
  settleAlignment,
  type CodeMeasurement,
  type CodeSighting,
} from "./visit-settle.js";

// The geodesy is licence-gated; building a store activates it, as the
// page does at boot.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ZERO = { lat: 47.5, lon: 8.7 };
const NOW = "2026-09-30T10:00:00.000Z";
const INFO = { hasMatrix: true, sampleCount: 5, gpsAccuracyM: 4 };
const LEVEL_ID = "a1b2c3d4e5f6";
const TEXT = "https://gps.csutil.com/tour/?qr=settle";

function yawQ(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function yawAlignment(deg: number, t: [number, number, number]): number[] {
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(...yawQ(deg)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

/** The code's fused pose in raw WebXR odometry. */
const CODE: Pose = { position: [0.3, 1.5, -2], rotation: yawQ(10) };

/** The level as the mint writes it, through `alignment`. */
function levelThrough(alignment: number[]): { id: string; json: string } {
  const result = mintQrLevel({
    odomPose: CODE,
    alignmentMatrix: alignment as never,
    zero: ZERO,
    alignment: INFO,
    sizeM: 0.16,
    nowIso: NOW,
  });
  if (!result.ok) throw new Error(result.error);
  return { id: LEVEL_ID, json: result.json };
}

/** A pin placed at odometry-NUE `local` in `visit`, its tap-time geo
 *  through `tapAlignment`. */
function placedPin(
  id: string,
  local: [number, number, number],
  visit: number,
  tapAlignment: number[],
) {
  const world = throughAlignment(
    { position: local, rotation: [0, 0, 0, 1] },
    tapAlignment,
  )!;
  const object = mintPin({
    id,
    label: id,
    worldNuePosition: {
      x: world.position[0],
      y: world.position[1],
      z: world.position[2],
    },
    zero: ZERO,
    nowIso: NOW,
  })!;
  return {
    object: object as TourObject,
    placement: {
      visit,
      local: { position: local, rotation: [0, 0, 0, 1] as const },
    },
  };
}

function worldOf(object: TourObject): Vector3 {
  return new Vector3(...objectPoseNue(object.geo, ZERO).positionNue);
}

function codeWorldOf(level: { json: string }): Vector3 {
  const geo = parseQrLevel(JSON.parse(level.json) as unknown).qr.geo!;
  return new Vector3(...objectPoseNue(geo, ZERO).positionNue);
}

const measuredInVisit = (visit: number): CodeMeasurement => ({
  levelId: LEVEL_ID,
  text: TEXT,
  odomPose: CODE,
  sizeM: 0.16,
  visit,
});

describe("settling the visit that measured the code (B2)", () => {
  it("recomputes the code and every note of the visit through ONE alignment, so they agree as placed", () => {
    // The code was saved at alignment A0, the pin placed at A1: composed
    // through different alignments, the two disagree by the alignment's
    // change - which no later relocalization can undo. Settled together
    // through the visit's end alignment, the pin sits relative to the code
    // exactly as it did in the phone's tracking.
    const a0 = yawAlignment(0, [0, 400, 0]);
    const a1 = yawAlignment(7, [3, 400, -2]);
    const end = yawAlignment(4, [1.5, 400.2, -1]);
    const pinLocal: [number, number, number] = [2, 0, -1];
    const codeLocal = odomNueFromWebXr(CODE).position;
    const placed = [placedPin("gate", pinLocal, 0, a1)];
    const tapLevel = levelThrough(a0);

    // Before: the tap-time records disagree with the odometry.
    const trueOffset = new Vector3(...pinLocal).sub(new Vector3(...codeLocal));
    const tapOffset = worldOf(placed[0]!.object).sub(codeWorldOf(tapLevel));
    expect(Math.abs(tapOffset.length() - trueOffset.length())).toBeGreaterThan(
      0.1,
    );

    const plan = planVisitSettle({
      visit: 0,
      placed,
      alignment: end,
      zero: ZERO,
      mintedLevel: tapLevel,
      measurement: measuredInVisit(0),
      sighting: null,
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    expect(plan?.basis).toBe("measured-here");
    expect(plan?.alignment).toEqual(end);
    expect(plan?.objects.map((o) => o.index)).toEqual([0]);
    expect(plan?.level?.id).toBe(LEVEL_ID);

    const settledOffset = worldOf(plan!.objects[0]!.object).sub(
      codeWorldOf(plan!.level!),
    );
    // Same length, and the direction the end alignment turns it to.
    const expected = trueOffset
      .clone()
      .applyQuaternion(new Quaternion(...yawQ(4)));
    expect(settledOffset.distanceTo(expected)).toBeLessThan(1e-3);
  });

  it("keeps the pin's record apart from its geo, and gives a pin no facing", () => {
    const end = yawAlignment(30, [0, 400, 0]);
    const placed = [placedPin("gate", [2, 0, -1], 0, end)];
    const plan = planVisitSettle({
      visit: 0,
      placed,
      alignment: end,
      zero: ZERO,
      mintedLevel: null,
      measurement: null,
      sighting: null,
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    const settled = plan!.objects[0]!.object;
    expect({ ...settled, geo: null }).toEqual({
      ...placed[0]!.object,
      geo: null,
    });
    expect(settled.geo.rotation).toEqual([0, 0, 0, 1]);
  });

  it("turns a photo's facing through the alignment with its position", () => {
    const end = yawAlignment(90, [0, 400, 0]);
    const cameraPose: Pose = { position: [0, 1.4, 0], rotation: [0, 0, 0, 1] };
    const photo = {
      object: {
        id: "shot",
        kind: "photo",
        image: "content/shot.jpg",
        imageWidth: 4,
        imageHeight: 3,
        createdAtIso: NOW,
        geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 401.4 },
      } as TourObject,
      placement: { visit: 0, local: odomNueFromWebXr(cameraPose) },
    };
    const plan = planVisitSettle({
      visit: 0,
      placed: [photo],
      alignment: end,
      zero: ZERO,
      mintedLevel: null,
      measurement: null,
      sighting: null,
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    const geo = plan!.objects[0]!.object.geo;
    const world = throughAlignment(odomNueFromWebXr(cameraPose), end)!;
    expect(
      new Quaternion(...geo.rotation!).angleTo(
        new Quaternion(...world.rotation),
      ),
    ).toBeLessThan(1e-6);
  });

  it("gives the re-minted code the quality block of the alignment its geo now comes from, not the tap's", () => {
    // Why this matters: `mintQuality` is how the field validation (QR-pose
    // plan M5) attributes a code's position error - "this geo came from an
    // alignment of N fixes at accuracy A". After the settle the stored geo
    // comes from the visit's END alignment, so a block still describing the
    // tap-time alignment would blame the error on numbers that did not
    // produce it. The e2e sees this as 3 fixes at the tap, 6 at Finish.
    const tapLevel = levelThrough(yawAlignment(0, [0, 400, 0]));
    const later = "2026-09-30T10:05:00.000Z";
    const settleInfo = { hasMatrix: true, sampleCount: 9, gpsAccuracyM: 3 };
    const input = {
      visit: 0,
      placed: [],
      alignment: yawAlignment(4, [1.5, 400.2, -1]),
      zero: ZERO,
      mintedLevel: tapLevel,
      measurement: measuredInVisit(0),
      sighting: null,
      alignmentInfo: settleInfo,
      nowIso: later,
    };
    const quality = (json: string) =>
      parseQrLevel(JSON.parse(json) as unknown).qr.mintQuality;
    expect(quality(tapLevel.json)).toEqual({
      mintedAtIso: NOW,
      alignmentSampleCount: INFO.sampleCount,
      gpsAccuracyM: INFO.gpsAccuracyM,
    });
    const plan = planVisitSettle(input);
    expect(quality(plan!.level!.json)).toEqual({
      mintedAtIso: later,
      alignmentSampleCount: 9,
      gpsAccuracyM: 3,
    });
    // A re-mint the gate refuses changes neither half: the old geo keeps
    // the block that describes it (the caller keeps `mintedLevel`).
    const refused = planVisitSettle({
      ...input,
      alignmentInfo: { ...settleInfo, sampleCount: 2 },
    });
    expect(refused?.level).toBeNull();
  });

  it("leaves objects of other visits and restored ones exactly as they were", () => {
    const end = yawAlignment(12, [5, 400, 5]);
    const earlier = placedPin(
      "old",
      [1, 0, 1],
      0,
      yawAlignment(0, [0, 400, 0]),
    );
    const restored = { object: earlier.object };
    const current = placedPin("new", [2, 0, 2], 1, end);
    const plan = planVisitSettle({
      visit: 1,
      placed: [earlier, restored, current],
      alignment: end,
      zero: ZERO,
      mintedLevel: null,
      measurement: null,
      sighting: null,
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    expect(plan?.objects.map((o) => o.index)).toEqual([2]);
    expect(plan?.level).toBeNull();
  });

  it("has nothing to do for a visit that placed and measured nothing", () => {
    const plan = planVisitSettle({
      visit: 2,
      placed: [placedPin("old", [1, 0, 1], 0, yawAlignment(0, [0, 400, 0]))],
      alignment: yawAlignment(0, [0, 400, 0]),
      zero: ZERO,
      mintedLevel: levelThrough(yawAlignment(0, [0, 400, 0])),
      measurement: measuredInVisit(0),
      sighting: null,
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    expect(plan).toBeNull();
  });

  it("refuses without a readable alignment or a zero, keeping the tap-time geo", () => {
    const placed = [
      placedPin("gate", [2, 0, -1], 0, yawAlignment(0, [0, 400, 0])),
    ];
    const base = {
      visit: 0,
      placed,
      mintedLevel: null,
      measurement: null,
      sighting: null,
      alignmentInfo: INFO,
      nowIso: NOW,
    };
    expect(
      planVisitSettle({ ...base, alignment: null, zero: ZERO }),
    ).toBeNull();
    expect(
      planVisitSettle({ ...base, alignment: [1, 2, 3], zero: ZERO }),
    ).toBeNull();
    expect(
      planVisitSettle({
        ...base,
        alignment: yawAlignment(0, [0, 400, 0]),
        zero: null,
      }),
    ).toBeNull();
  });
});

describe("a later visit, corrected through the code (D10b)", () => {
  const a1 = yawAlignment(20, [100, 400, 50]);
  const a2 = yawAlignment(-35, [80, 403, 40]);
  const stored = levelThrough(a1);
  const sighting: CodeSighting = {
    text: TEXT,
    levelId: LEVEL_ID,
    odomPose: CODE,
  };

  it("settles through the measuring visit's alignment once the code was seen in this visit", () => {
    const placed = [placedPin("later", [3, 0, -1], 1, a2)];
    const plan = planVisitSettle({
      visit: 1,
      placed,
      alignment: a2,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting,
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    expect(plan?.basis).toBe("code-corrected");
    plan!.alignment.forEach((v, i) => {
      // Sub-millimetre: the stored code went through a geo round trip.
      expect(v).toBeCloseTo(a1[i]!, 4);
    });
    // The note keeps its place relative to the stored code, not the 20 m
    // the second visit's GPS put between them.
    const offset = worldOf(plan!.objects[0]!.object).sub(codeWorldOf(stored));
    const expected = new Vector3(3, 0, -1)
      .sub(new Vector3(...odomNueFromWebXr(CODE).position))
      .applyQuaternion(new Quaternion(...yawQ(20)));
    expect(offset.distanceTo(expected)).toBeLessThan(1e-3);
    // The stored code is the reference: it is not re-minted.
    expect(plan?.level).toBeNull();
  });

  it("corrects through THIS visit's sighting when the odometry origin moved between visits", () => {
    // Why this test matters (M2c review #3): every other D10b test put the
    // code at the same odometry pose in both visits, so settling through
    // the measuring visit's `measurement.odomPose` instead of this visit's
    // `sighting.odomPose` passed them all. WebXR gives every session its own
    // origin: here visit 1's odometry is visit 0's turned 70 degrees and
    // moved 8 m, so only the sighting says where the code is now.
    const move = new Matrix4().compose(
      new Vector3(4, -0.3, -7),
      new Quaternion(...yawQ(70)),
      new Vector3(1, 1, 1),
    );
    const inVisit1 = (pose: Pose): Pose => {
      const m = new Matrix4()
        .compose(
          new Vector3(...pose.position),
          new Quaternion(...pose.rotation),
          new Vector3(1, 1, 1),
        )
        .premultiply(move);
      const p = new Vector3();
      const q = new Quaternion();
      m.decompose(p, q, new Vector3());
      return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
    };
    // A spot 3 m in front of the code, as raw odometry of visit 0.
    const spot: Pose = { position: [0.3, 0, -5], rotation: [0, 0, 0, 1] };
    const local1 = odomNueFromWebXr(inVisit1(spot)).position;
    // Visit 1's GPS alignment as the solver finds it for the moved origin:
    // a2's GPS error, in the new odometry frame.
    const moveNue = new Matrix4()
      .copy(WEBXR_TO_NUE)
      .multiply(move)
      .multiply(new Matrix4().copy(WEBXR_TO_NUE).invert());
    const a2Moved = new Matrix4()
      .fromArray(a2)
      .multiply(moveNue.invert())
      .toArray();
    const plan = planVisitSettle({
      visit: 1,
      placed: [placedPin("later", [...local1], 1, a2Moved)],
      alignment: a2Moved,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting: { ...sighting, odomPose: inVisit1(CODE) },
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    expect(plan?.basis).toBe("code-corrected");
    // Where the measuring visit's alignment puts that spot: the note keeps
    // its place relative to the stored code across the origin change.
    const expected = new Vector3(
      ...throughAlignment(odomNueFromWebXr(spot), a1)!.position,
    );
    expect(worldOf(plan!.objects[0]!.object).distanceTo(expected)).toBeLessThan(
      1e-3,
    );
  });

  it("uses the plain visit alignment when the code was not seen in this visit", () => {
    const choice = settleAlignment({
      visit: 1,
      alignment: a2,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting: null,
    });
    expect(choice?.basis).toBe("visit-alignment");
    expect(choice?.alignment).toEqual(a2);
  });

  it("does not correct through a DIFFERENT code seen in this visit", () => {
    const choice = settleAlignment({
      visit: 1,
      alignment: a2,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting: { ...sighting, levelId: "ffffffffffff" },
    });
    expect(choice?.basis).toBe("visit-alignment");
  });

  it("treats a level with no measurement in this page (a restored draft) as stored earlier", () => {
    const choice = settleAlignment({
      visit: 0,
      alignment: a2,
      zero: ZERO,
      mintedLevel: stored,
      measurement: null,
      sighting,
    });
    expect(choice?.basis).toBe("code-corrected");
  });

  it("falls back to the plain alignment when the stored level carries no readable pose", () => {
    const choice = settleAlignment({
      visit: 1,
      alignment: a2,
      zero: ZERO,
      mintedLevel: { id: LEVEL_ID, json: "{}" },
      measurement: measuredInVisit(0),
      sighting,
    });
    expect(choice?.basis).toBe("visit-alignment");
  });
});

describe("a new measurement of a code whose pose is already stored (D10b, M2c review #5)", () => {
  // Why these tests matter: "newest wins" let a re-measure silently replace
  // the stored pose, and a hosted tour opened in a new page had to be
  // re-measured before Finish - which rewrote the code's geo through THIS
  // visit's GPS while the hosted notes kept the old frame: symptom B across
  // sessions. A stored pose is the reference; a new measurement of it is a
  // sighting that corrects the visit. Replacing it on purpose is M4's.
  const stored = levelThrough(yawAlignment(20, [100, 400, 50]));

  it("keeps the level in hand (an earlier visit's, or a restored draft's) as the reference", () => {
    expect(
      measurementRole({
        levelId: LEVEL_ID,
        visit: 1,
        inHand: stored,
        inHandMeasurement: measuredInVisit(0),
        hostedJson: null,
      }),
    ).toEqual({ kept: "level-in-hand", reference: stored });
    expect(
      measurementRole({
        levelId: LEVEL_ID,
        visit: 0,
        inHand: stored,
        inHandMeasurement: null,
        hostedJson: null,
      }),
    ).toEqual({ kept: "level-in-hand", reference: stored });
  });

  it("keeps the hosted zip's level when nothing is in hand", () => {
    expect(
      measurementRole({
        levelId: LEVEL_ID,
        visit: 0,
        inHand: null,
        inHandMeasurement: null,
        hostedJson: stored.json,
      }),
    ).toEqual({
      kept: "hosted-level",
      reference: { id: LEVEL_ID, json: stored.json },
    });
  });

  it("lets a re-measure in the SAME visit replace its own measurement (nothing was stored yet)", () => {
    // Both measurements share this visit's odometry, and the settle re-mints
    // the level at the visit's end anyway: the newer one is simply better.
    expect(
      measurementRole({
        levelId: LEVEL_ID,
        visit: 0,
        inHand: stored,
        inHandMeasurement: measuredInVisit(0),
        hostedJson: stored.json,
      }),
    ).toEqual({ kept: "measurement" });
  });

  it("makes the measurement the reference when no stored pose reads", () => {
    const base = {
      levelId: LEVEL_ID,
      visit: 1,
      inHandMeasurement: null,
    };
    // Nothing stored anywhere.
    expect(
      measurementRole({ ...base, inHand: null, hostedJson: null }),
    ).toEqual({ kept: "measurement" });
    // A DIFFERENT code in hand is not this code's reference.
    expect(
      measurementRole({
        ...base,
        inHand: { id: "ffffffffffff", json: stored.json },
        hostedJson: null,
      }),
    ).toEqual({ kept: "measurement" });
    // A stored level without a readable pose (no geo, or not a level).
    expect(
      measurementRole({ ...base, inHand: null, hostedJson: "{}" }),
    ).toEqual({ kept: "measurement" });
    expect(
      measurementRole({
        ...base,
        inHand: { id: LEVEL_ID, json: "not json" },
        hostedJson: null,
      }),
    ).toEqual({ kept: "measurement" });
  });
});

describe("the code correction's plausibility bound (M2c review #2)", () => {
  // Why these tests matter: a level's id is a hash of the printed TEXT, so a
  // second print of the poster, or one re-hung elsewhere, counts as the same
  // code - and an unbounded correction would move every note of the visit
  // by however far apart the two prints hang. A correction larger than two
  // visits' GPS can plausibly disagree is refused; the visit then settles
  // through its plain alignment, and the refusal is reported.
  const a1 = yawAlignment(20, [100, 400, 50]);
  const stored = levelThrough(a1);
  const sighting: CodeSighting = {
    text: TEXT,
    levelId: LEVEL_ID,
    odomPose: CODE,
  };
  /** A visit alignment whose view of the code is `dx` m North and `dyaw`
   *  degrees off the stored one (the code is the pivot). */
  function offBy(dx: number, dyaw: number): number[] {
    const c = new Vector3(...odomNueFromWebXr(CODE).position);
    const turned = yawAlignment(20 + dyaw, [0, 0, 0]);
    const at = c.clone().applyMatrix4(new Matrix4().fromArray(turned));
    const want = c.clone().applyMatrix4(new Matrix4().fromArray(a1));
    return yawAlignment(20 + dyaw, [
      want.x - at.x + dx,
      want.y - at.y,
      want.z - at.z,
    ]);
  }
  const choose = (alignment: number[], gpsAccuracyM?: number) =>
    settleAlignment({
      visit: 1,
      alignment,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting,
      ...(gpsAccuracyM === undefined ? {} : { gpsAccuracyM }),
    });

  it("is 5 m plus three times the two visits' combined GPS accuracy", () => {
    expect(correctionBoundM(3, 4)).toBeCloseTo(5 + 3 * 5, 9);
    // Unknown or unusable accuracies count as the default.
    expect(correctionBoundM(undefined, null)).toBeCloseTo(
      5 + 3 * Math.hypot(5, 5),
      9,
    );
    expect(correctionBoundM(Number.NaN, -2)).toBe(
      correctionBoundM(undefined, undefined),
    );
  });

  it("accepts a correction just inside the bound and refuses one just outside, across plausible accuracies", () => {
    // The stored level's mint quality says 4 m (INFO); this visit's
    // accuracy is swept over what phones report outdoors and near
    // buildings.
    for (const accuracy of [3, 5, 10, 15]) {
      const bound = correctionBoundM(accuracy, INFO.gpsAccuracyM);
      const inside = choose(offBy(bound - 0.5, 0), accuracy);
      expect(inside?.basis, `accuracy ${String(accuracy)} m`).toBe(
        "code-corrected",
      );
      expect(inside?.refused).toBeNull();
      const outside = choose(offBy(bound + 0.5, 0), accuracy);
      expect(outside?.basis).toBe("visit-alignment");
      expect(outside?.refused?.maxHorizontalM).toBeCloseTo(bound, 9);
      expect(outside?.refused?.horizontalM).toBeCloseTo(bound + 0.5, 2);
    }
  });

  it("refuses a correction that turns the visit by more than the yaw bound, whatever the distance", () => {
    expect(choose(offBy(0, CORRECTION_MAX_YAW_DEG - 1))?.basis).toBe(
      "code-corrected",
    );
    const refused = choose(offBy(0, CORRECTION_MAX_YAW_DEG + 1));
    expect(refused?.basis).toBe("visit-alignment");
    expect(refused?.refused?.yawDeg).toBeCloseTo(CORRECTION_MAX_YAW_DEG + 1, 4);
    // The refused choice is the plain visit alignment, not a corrected one.
    expect(refused?.alignment).toEqual(offBy(0, CORRECTION_MAX_YAW_DEG + 1));
  });

  it("carries the refusal into the settle plan", () => {
    const far = offBy(60, 0);
    const plan = planVisitSettle({
      visit: 1,
      placed: [placedPin("later", [3, 0, -1], 1, far)],
      alignment: far,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting,
      alignmentInfo: INFO,
      nowIso: NOW,
    });
    expect(plan?.basis).toBe("visit-alignment");
    expect(plan?.refused?.horizontalM).toBeCloseTo(60, 2);
  });
});

describe("moving a pin to the reticle (M4) goes through the settle's alignment", () => {
  // Why these tests matter: the plan (§3.2, D10b) requires a move to use
  // the SAME code correction the settle uses. A move minted through the
  // visit's raw GPS alignment would put a pin moved in a later visit
  // metres from the code - symptom B again, through the editing door.
  const a1 = yawAlignment(20, [100, 400, 50]);
  const a2 = yawAlignment(-35, [80, 403, 40]);
  const stored = levelThrough(a1);
  const sighting: CodeSighting = {
    text: TEXT,
    levelId: LEVEL_ID,
    odomPose: CODE,
  };
  const hostedPin = placedPin("hosted", [9, 0, 9], 0, a1).object;
  const reticle = {
    position: [3, 0, -1] as const,
    rotation: [0, 0, 0, 1] as const,
  };

  it("puts a pin moved in a later visit where the code says, through the correction", () => {
    const moved = planMove({
      object: hostedPin,
      local: reticle,
      visit: 1,
      alignment: a2,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting,
    });
    expect(moved?.basis).toBe("code-corrected");
    const offset = worldOf(moved!.object).sub(codeWorldOf(stored));
    const expected = new Vector3(...reticle.position)
      .sub(new Vector3(...odomNueFromWebXr(CODE).position))
      .applyQuaternion(new Quaternion(...yawQ(20)));
    expect(offset.distanceTo(expected)).toBeLessThan(1e-3);
    // The record is the same object: id, text and creation time kept.
    expect(moved!.object.id).toBe("hosted");
    expect(moved!.object.kind === "pin" && moved!.object.label).toBe("hosted");
    expect(moved!.object.createdAtIso).toBe(hostedPin.createdAtIso);
  });

  it("uses the plain visit alignment when the code was not seen, and says so", () => {
    const moved = planMove({
      object: hostedPin,
      local: reticle,
      visit: 1,
      alignment: a2,
      zero: ZERO,
      mintedLevel: stored,
      measurement: measuredInVisit(0),
      sighting: null,
    });
    expect(moved?.basis).toBe("visit-alignment");
    const world = throughAlignment(reticle, a2)!;
    expect(
      worldOf(moved!.object).distanceTo(new Vector3(...world.position)),
    ).toBeLessThan(1e-3);
  });

  it("refuses without a readable alignment or a zero", () => {
    const base = {
      object: hostedPin,
      local: reticle,
      visit: 1,
      mintedLevel: stored,
      measurement: null,
      sighting: null,
    };
    expect(planMove({ ...base, alignment: null, zero: ZERO })).toBeNull();
    expect(planMove({ ...base, alignment: a2, zero: null })).toBeNull();
  });
});
