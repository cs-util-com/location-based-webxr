/**
 * The settle with SEVERAL codes in one visit (code book refactor plan M4b;
 * the owner's choice after the M3 sweep: D2, "nearest code event in walked
 * distance"). `planVisitSettle` takes the visit's codes as `codes`; each
 * object settles through the code event nearest it in walked distance of
 * ANY code of the visit - a stored code's sighting (the D10b correction
 * onto its stored pose) or a measured code's measurement or sighting (its
 * own re-minted pose) - within `CODE_EVENT_REACH_M`.
 *
 * Why these tests matter: with one slot, a visit that saw two codes
 * corrected every note through the code in hand, so a note placed next to
 * the other code carried the whole disagreement between the two stored
 * poses (10.3 m at p90 in the M3 sweep at 10 m of disagreement). And a
 * one-code visit must settle exactly as before - the golden oracle
 * (`visit-settle.golden.test.ts`) holds that; here a one-code `codes` list
 * is checked against the legacy fields directly.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { mintQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { mintPin, objectPoseNue } from "./content-placement.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";
import {
  CODE_EVENT_REACH_M,
  planVisitSettle,
  storedGeo,
  visitEndChoice,
  liveCodeChoices,
  settleAlignment,
  type CodeMeasurement,
  type CodeSighting,
} from "./visit-settle.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ZERO = { lat: 47.5, lon: 8.7 };
const NOW = "2026-10-06T10:00:00.000Z";
const INFO = { hasMatrix: true, sampleCount: 5, gpsAccuracyM: 4 };
const ID_A = "a00000000001";
const ID_B = "b00000000002";
const TEXT_A = "https://example.invalid/?qr=a";
const TEXT_B = "https://example.invalid/?qr=b";

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

/** Code A's and code B's fused poses in this visit's raw WebXR odometry:
 *  B about 20 m from A. */
const POSE_A: Pose = { position: [0.3, 1.5, -2], rotation: yawQ(10) };
const POSE_B: Pose = { position: [20.3, 1.5, -2.5], rotation: yawQ(15) };

/** A level as the mint writes it, through `alignment`. */
function levelThrough(
  id: string,
  pose: Pose,
  alignment: number[],
): { id: string; json: string } {
  const result = mintQrLevel({
    odomPose: pose,
    alignmentMatrix: alignment as never,
    zero: ZERO,
    alignment: INFO,
    sizeM: 0.16,
    nowIso: NOW,
  });
  if (!result.ok) throw new Error(result.error);
  return { id, json: result.json };
}

function placedPin(id: string, local: [number, number, number]) {
  const object = mintPin({
    id,
    label: id,
    worldNuePosition: { x: 0, y: 400, z: 0 },
    zero: ZERO,
    nowIso: NOW,
  })!;
  return {
    object: object as TourObject,
    placement: {
      visit: 1,
      local: { position: local, rotation: [0, 0, 0, 1] as const },
    },
  };
}

function worldOf(object: TourObject): Vector3 {
  return new Vector3(...objectPoseNue(object.geo, ZERO).positionNue);
}

/** Where `alignment` puts odometry point `local`. */
function through(local: [number, number, number], alignment: number[]) {
  return new Vector3(
    ...throughAlignment({ position: local, rotation: [0, 0, 0, 1] }, alignment)!
      .position,
  );
}

const nueOf = (pose: Pose): [number, number, number] =>
  [...odomNueFromWebXr(pose).position] as [number, number, number];

const sightingOf = (
  levelId: string,
  text: string,
  pose: Pose,
): CodeSighting => ({
  text,
  levelId,
  odomPose: pose,
});

const measurementOf = (
  levelId: string,
  text: string,
  pose: Pose,
): CodeMeasurement => ({
  levelId,
  text,
  odomPose: pose,
  sizeM: 0.16,
  visit: 1,
});

// The visit's own alignment, and the two earlier alignments the codes were
// stored through: A's and B's stored poses disagree by a couple of metres
// and degrees, as two codes minted in different visits do.
const aVisit = yawAlignment(-5, [96, 401, 47]);
const aStoredA = yawAlignment(20, [100, 400, 50]);
const aStoredB = yawAlignment(22, [101.5, 400, 48.8]);
const storedA = levelThrough(ID_A, POSE_A, aStoredA);
const storedB = levelThrough(ID_B, POSE_B, aStoredB);
/** Two spots of the visit: next to A, and next to B. */
const NEAR_A: [number, number, number] = nueOf({
  position: [1.3, 0, -5],
  rotation: [0, 0, 0, 1],
});
const NEAR_B: [number, number, number] = nueOf({
  position: [19.3, 0, -5.5],
  rotation: [0, 0, 0, 1],
});

/** A visit that sighted stored A at 0 m walked and stored B at 30 m. */
function twoStoredSettle(
  notes: { id: string; local: [number, number, number]; walkedM: number }[],
) {
  return planVisitSettle({
    visit: 1,
    placed: notes.map((n) => placedPin(n.id, n.local)),
    alignment: aVisit,
    zero: ZERO,
    mintedLevel: storedA,
    measurement: null,
    sighting: sightingOf(ID_B, TEXT_B, POSE_B),
    gpsAccuracyM: 4,
    alignmentInfo: INFO,
    nowIso: NOW,
    codes: [
      { level: storedA, measurement: null },
      { level: storedB, measurement: null },
    ],
    picks: {
      objects: new Map(
        notes.map((n) => [
          n.id,
          { atMs: n.walkedM * 1000, walkedM: n.walkedM, alignment: aVisit },
        ]),
      ),
      measurement: null,
      sightings: [
        {
          atMs: 0,
          walkedM: 0,
          alignment: aVisit,
          sighting: sightingOf(ID_A, TEXT_A, POSE_A),
        },
        {
          atMs: 30_000,
          walkedM: 30,
          alignment: aVisit,
          sighting: sightingOf(ID_B, TEXT_B, POSE_B),
        },
      ],
    },
  })!;
}

describe("the settle with several codes: each note follows the nearest code event (D2)", () => {
  it("corrects a note next to A through A's stored pose and one next to B through B's", () => {
    const plan = twoStoredSettle([
      { id: "a", local: NEAR_A, walkedM: 3 },
      { id: "b", local: NEAR_B, walkedM: 27 },
    ]);
    const [a, b] = plan.objects;
    expect(a!.basis).toBe("code-corrected");
    expect(b!.basis).toBe("code-corrected");
    // Through a code's correction a note sits where that code's storing
    // visit would have put it relative to the code.
    expect(
      worldOf(a!.object).distanceTo(through(NEAR_A, aStoredA)),
    ).toBeLessThan(1e-3);
    expect(
      worldOf(b!.object).distanceTo(through(NEAR_B, aStoredB)),
    ).toBeLessThan(1e-3);
    // And the two stored frames do disagree here, so the test can tell
    // which code each note followed.
    expect(
      through(NEAR_B, aStoredA).distanceTo(through(NEAR_B, aStoredB)),
    ).toBeGreaterThan(1);
  });

  // Why this test matters: a photo that lands after the settle is at the
  // visit's end, where the code seen LAST is the nearest event - with one
  // slot it went through the code in hand whatever was seen since.
  it("puts what lands after the settle through the code seen last", () => {
    const plan = twoStoredSettle([
      { id: "a", local: NEAR_A, walkedM: 3 },
      { id: "b", local: NEAR_B, walkedM: 27 },
    ]);
    expect(plan.basis).toBe("code-corrected");
    expect(plan.alignment).toEqual(plan.objects[1]!.alignment);
    expect(plan.alignment).not.toEqual(plan.objects[0]!.alignment);
  });

  // Why this test matters (plan §5's guard, M4 milestone review #6): a
  // second code must change nothing near the first. A note beside A, with
  // another code sighted 100 m of walking away, settles exactly as the
  // one-code settle puts it - the run-merge, the per-code views and the
  // nearest-event rule all leave it alone.
  it("leaves a note beside A exactly as the one-code settle puts it, when a second code is 100 m away", () => {
    const base = {
      visit: 1,
      placed: [placedPin("a", NEAR_A)],
      alignment: aVisit,
      zero: ZERO,
      mintedLevel: storedA,
      measurement: null,
      sighting: sightingOf(ID_A, TEXT_A, POSE_A),
      gpsAccuracyM: 4,
      alignmentInfo: INFO,
      nowIso: NOW,
    };
    const seenA = {
      atMs: 0,
      walkedM: 0,
      alignment: aVisit,
      sighting: sightingOf(ID_A, TEXT_A, POSE_A),
    };
    const objects = new Map([
      ["a", { atMs: 3_000, walkedM: 3, alignment: aVisit }],
    ]);
    const alone = planVisitSettle({
      ...base,
      picks: { objects, measurement: null, sightings: [seenA] },
    })!;
    const withFar = planVisitSettle({
      ...base,
      codes: [
        { level: storedA, measurement: null },
        { level: storedB, measurement: null },
      ],
      picks: {
        objects,
        measurement: null,
        sightings: [
          seenA,
          {
            atMs: 100_000,
            walkedM: 100,
            alignment: aVisit,
            sighting: sightingOf(ID_B, TEXT_B, POSE_B),
          },
        ],
      },
    })!;
    expect(alone.objects[0]!.basis).toBe("code-corrected");
    expect(withFar.objects[0]!.object).toEqual(alone.objects[0]!.object);
    expect(withFar.objects[0]!.basis).toBe(alone.objects[0]!.basis);
  });

  // Why this test matters (code book plan M5a): the end choice used to be
  // the code in hand's. It is the code seen LAST - temporal, not spatial -
  // and it exists when the visit placed nothing (the plan is null then),
  // which is when a late photo needs it.
  it("ends the visit through the code seen last, even when nothing was placed", () => {
    const input = {
      visit: 1,
      placed: [],
      alignment: aVisit,
      zero: ZERO,
      mintedLevel: storedA,
      measurement: null,
      sighting: sightingOf(ID_A, TEXT_A, POSE_A),
      gpsAccuracyM: 4,
      alignmentInfo: INFO,
      nowIso: NOW,
      codes: [
        { level: storedA, measurement: null },
        { level: storedB, measurement: null },
      ],
      picks: {
        objects: new Map(),
        measurement: null,
        sightings: [
          {
            atMs: 0,
            walkedM: 0,
            alignment: aVisit,
            sighting: sightingOf(ID_A, TEXT_A, POSE_A),
          },
          {
            atMs: 30_000,
            walkedM: 30,
            alignment: aVisit,
            sighting: sightingOf(ID_B, TEXT_B, POSE_B),
          },
        ],
      },
    };
    expect(planVisitSettle(input)).toBeNull();
    const end = visitEndChoice(input)!;
    expect(end.basis).toBe("code-corrected");
    expect(end.level).toEqual(storedB);
    expect(end.sighting?.levelId).toBe(ID_B);
    // Through B's stored frame: a spot next to B lands where B's storing
    // visit put it.
    expect(
      through(NEAR_B, end.alignment).distanceTo(through(NEAR_B, aStoredB)),
    ).toBeLessThan(1e-3);
  });

  // Why this test matters (code book plan M5b): while the visit runs, the
  // earlier objects are drawn through the code nearest each of them - so
  // each code needs its OWN live choice, through its own stored pose, not
  // the code in hand's. With one code the choice must stay what the panel
  // and the frame always used (`settleAlignment`).
  it("judges each code live through its own stored pose, and names the code seen last", () => {
    const plan = twoStoredSettle([]);
    expect(plan).toBeNull();
    const input = {
      visit: 1,
      placed: [],
      alignment: aVisit,
      zero: ZERO,
      mintedLevel: storedA,
      measurement: null,
      sighting: sightingOf(ID_B, TEXT_B, POSE_B),
      gpsAccuracyM: 4,
      alignmentInfo: INFO,
      nowIso: NOW,
      codes: [
        { level: storedA, measurement: null },
        { level: storedB, measurement: null },
      ],
      picks: {
        objects: new Map(),
        measurement: null,
        sightings: [
          {
            atMs: 0,
            walkedM: 0,
            alignment: aVisit,
            sighting: sightingOf(ID_A, TEXT_A, POSE_A),
          },
          {
            atMs: 30_000,
            walkedM: 30,
            alignment: aVisit,
            sighting: sightingOf(ID_B, TEXT_B, POSE_B),
          },
        ],
      },
    };
    const live = liveCodeChoices(input);
    expect(live.last).toBe(ID_B);
    const a = live.byCode.get(ID_A)!;
    const b = live.byCode.get(ID_B)!;
    expect(a.basis).toBe("code-corrected");
    expect(b.basis).toBe("code-corrected");
    expect(
      through(NEAR_A, a.alignment).distanceTo(through(NEAR_A, aStoredA)),
    ).toBeLessThan(1e-3);
    expect(
      through(NEAR_B, b.alignment).distanceTo(through(NEAR_B, aStoredB)),
    ).toBeLessThan(1e-3);
    // One code: the live choice is settleAlignment's.
    const one = {
      ...input,
      codes: undefined,
      sighting: sightingOf(ID_A, TEXT_A, POSE_A),
    };
    const single = liveCodeChoices(one).byCode.get(ID_A)!;
    const legacy = settleAlignment(one)!;
    expect({
      basis: single.basis,
      alignment: single.alignment,
      refused: single.refused,
    }).toEqual(legacy);
  });

  it("keeps a note out of reach of every code event on its own alignment", () => {
    const plan = twoStoredSettle([
      { id: "far", local: NEAR_B, walkedM: 30 + CODE_EVENT_REACH_M + 1 },
    ]);
    expect(plan.objects[0]!.basis).toBe("visit-alignment");
    expect(plan.objects[0]!.alignment).toEqual(aVisit);
  });

  // Why this test matters: `codes` must not change a one-code visit - the
  // legacy fields and a one-code list settle every object identically.
  it("settles a one-code list exactly as the legacy fields do", () => {
    const base = {
      visit: 1,
      placed: [placedPin("a", NEAR_A), placedPin("b", NEAR_B)],
      alignment: aVisit,
      zero: ZERO,
      mintedLevel: storedA,
      measurement: null,
      sighting: sightingOf(ID_A, TEXT_A, POSE_A),
      gpsAccuracyM: 4,
      alignmentInfo: INFO,
      nowIso: NOW,
      picks: {
        objects: new Map([
          ["a", { atMs: 3000, walkedM: 3, alignment: aVisit }],
          ["b", { atMs: 27_000, walkedM: 27, alignment: aVisit }],
        ]),
        measurement: null,
        sightings: [
          {
            atMs: 0,
            walkedM: 0,
            alignment: aVisit,
            sighting: sightingOf(ID_A, TEXT_A, POSE_A),
          },
        ],
      },
    };
    const legacy = planVisitSettle(base);
    const listed = planVisitSettle({
      ...base,
      codes: [{ level: storedA, measurement: null }],
    });
    expect(listed).toEqual(legacy);
  });

  // Why this test matters: the mixed visit (plan §4 M4) - a stored A seen,
  // a NEW code B measured in the same visit - is the owner's case for a
  // tour that grows: a note next to B lines up with B as minted here, one
  // next to A with A's stored pose.
  it("settles a mixed visit: next to the stored A through A, next to the measured B through B's own pick", () => {
    const aPickB = yawAlignment(-3, [96.5, 401, 46.5]);
    const plan = planVisitSettle({
      visit: 1,
      placed: [placedPin("a", NEAR_A), placedPin("b", NEAR_B)],
      alignment: aVisit,
      zero: ZERO,
      mintedLevel: storedA,
      measurement: null,
      sighting: sightingOf(ID_A, TEXT_A, POSE_A),
      gpsAccuracyM: 4,
      alignmentInfo: INFO,
      nowIso: NOW,
      codes: [
        { level: storedA, measurement: null },
        {
          level: { id: ID_B, json: "{}" },
          measurement: measurementOf(ID_B, TEXT_B, POSE_B),
          measurementPick: {
            atMs: 30_000,
            walkedM: 30,
            alignment: aPickB,
            alignmentInfo: INFO,
          },
        },
      ],
      picks: {
        objects: new Map([
          ["a", { atMs: 3000, walkedM: 3, alignment: aVisit }],
          ["b", { atMs: 28_000, walkedM: 28, alignment: aVisit }],
        ]),
        measurement: null,
        sightings: [
          {
            atMs: 0,
            walkedM: 0,
            alignment: aVisit,
            sighting: sightingOf(ID_A, TEXT_A, POSE_A),
          },
        ],
      },
    })!;
    const [a, b] = plan.objects;
    expect(a!.basis).toBe("code-corrected");
    expect(
      worldOf(a!.object).distanceTo(through(NEAR_A, aStoredA)),
    ).toBeLessThan(1e-3);
    expect(b!.basis).toBe("measured-here");
    expect(b!.alignment).toEqual(aPickB);
    // B is re-minted through its own pick; A, stored, is not re-minted.
    expect(plan.levels.map((l) => l.id)).toEqual([ID_B]);
    expect(plan.levels[0]!.alignment).toEqual(aPickB);
    const geo = storedGeo(plan.levels[0]!.json)!;
    const bWorld = new Vector3(...objectPoseNue(geo, ZERO).positionNue);
    expect(bWorld.distanceTo(through(nueOf(POSE_B), aPickB))).toBeLessThan(
      1e-3,
    );
  });

  // Why this test matters: the owner's case (plan §4 M4, M4e) - two NEW
  // codes in one visit, both measured, both re-minted, so one Finish can
  // write both levels.
  it("re-mints every code measured in the visit, each through its own pick", () => {
    const aPickA = yawAlignment(-6, [95.5, 401, 47.2]);
    const aPickB = yawAlignment(-3, [96.5, 401, 46.5]);
    const plan = planVisitSettle({
      visit: 1,
      placed: [placedPin("a", NEAR_A), placedPin("b", NEAR_B)],
      alignment: aVisit,
      zero: ZERO,
      mintedLevel: { id: ID_A, json: "{}" },
      measurement: measurementOf(ID_A, TEXT_A, POSE_A),
      sighting: null,
      gpsAccuracyM: 4,
      alignmentInfo: INFO,
      nowIso: NOW,
      codes: [
        {
          level: { id: ID_A, json: "{}" },
          measurement: measurementOf(ID_A, TEXT_A, POSE_A),
          measurementPick: {
            atMs: 0,
            walkedM: 0,
            alignment: aPickA,
            alignmentInfo: INFO,
          },
        },
        {
          level: { id: ID_B, json: "{}" },
          measurement: measurementOf(ID_B, TEXT_B, POSE_B),
          measurementPick: {
            atMs: 30_000,
            walkedM: 30,
            alignment: aPickB,
            alignmentInfo: INFO,
          },
        },
      ],
      picks: {
        objects: new Map([
          ["a", { atMs: 3000, walkedM: 3, alignment: aVisit }],
          ["b", { atMs: 28_000, walkedM: 28, alignment: aVisit }],
        ]),
        measurement: null,
        sightings: [],
      },
    })!;
    expect(plan.levels.map((l) => [l.id, l.alignment])).toEqual([
      [ID_A, aPickA],
      [ID_B, aPickB],
    ]);
    // The first code stays the legacy `level` (the code in hand).
    expect(plan.level?.id).toBe(ID_A);
    expect(plan.objects[0]!.alignment).toEqual(aPickA);
    expect(plan.objects[1]!.alignment).toEqual(aPickB);
  });
});
