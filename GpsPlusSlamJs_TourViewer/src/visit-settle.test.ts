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
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { mintPin, objectPoseNue } from "./content-placement.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";
import {
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
