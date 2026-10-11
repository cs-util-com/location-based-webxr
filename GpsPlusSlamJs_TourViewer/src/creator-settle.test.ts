/**
 * `creator-settle.ts` on its own, with the real code owner and the real
 * planner (code book refactor plan M4c-2): what the settle HANDS the planner
 * when a visit measured two codes. The planner's own rules are
 * `visit-settle.codes.test.ts`'s; the composed suites cannot show this
 * wiring, because their alignment does not move between two measurements
 * (the M4c-2 sampled mutants survived them).
 */

import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";

import { mintPin, objectPoseNue } from "./content-placement.js";
import { wireCreatorCodes } from "./creator-codes.js";
import { wireCreatorSettle } from "./creator-settle.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import { throughAlignment } from "./visit-anchoring.js";
import type { CodeMeasurement } from "./visit-settle.js";

// The geodesy is licence-gated; building a store activates it, as the
// page does at boot - before the pin below is minted.
const real = createTourViewerStore();

const ZERO = { lat: 47.5, lon: 8.7 };
const INFO = { hasMatrix: true, sampleCount: 40, gpsAccuracyM: 4 };

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

const measurementOf = (levelId: string, x: number): CodeMeasurement => ({
  levelId,
  text: `https://example.invalid/?qr=${levelId}`,
  odomPose: { position: [x, 1.5, -2], rotation: [0, 0, 0, 1] },
  sizeM: 0.16,
  visit: 0,
});

describe("the settle hands the planner every code of the visit (M4c-2)", () => {
  it("settles a pin next to A through A's own pick, and saves both codes as re-minted", () => {
    const aEnd = yawAlignment(10, [5, 401, 3]);
    const aPickA = yawAlignment(-4, [1, 400, 0.5]);
    const aPickB = yawAlignment(6, [3, 400.5, 2]);
    const ctx = createTourViewerSession();
    const local: [number, number, number] = [1, 0, -1];
    const pin = mintPin({
      id: "byA",
      label: "by A",
      worldNuePosition: { x: 0, y: 400, z: 0 },
      zero: ZERO,
      nowIso: "2026-10-06T10:00:00.000Z",
    }) as TourObject;
    ctx.placedObjects = [
      {
        object: pin,
        placement: {
          visit: 0,
          local: { position: local, rotation: [0, 0, 0, 1] },
        },
      },
    ];
    const codes = wireCreatorCodes({ ctx });
    // A then B measured in this visit; B is in hand.
    codes.setInHand(
      { id: "aaaaaaaaaaa1", json: "{}" },
      measurementOf("aaaaaaaaaaa1", 0),
    );
    codes.setInHand(
      { id: "bbbbbbbbbbb2", json: "{}" },
      measurementOf("bbbbbbbbbbb2", 20),
    );
    const arStore = {
      getState: () =>
        ({
          ...real.getState(),
          gpsData: {
            zero: ZERO,
            gpsEvents: {
              alignmentMatrix: aEnd,
              gpsPositions: Array.from(
                { length: MIN_ALIGNMENT_SAMPLES },
                () => ZERO,
              ),
              odometryPositions: [],
            },
          },
        }) as never,
      dispatch: () => undefined,
    };
    const pickA = {
      atMs: 1_000,
      walkedM: 0,
      alignment: aPickA,
      alignmentInfo: INFO,
    };
    const pickB = {
      atMs: 30_000,
      walkedM: 30,
      alignment: aPickB,
      alignmentInfo: INFO,
    };
    const settle = wireCreatorSettle({
      ctx,
      arStore: arStore as never,
      seams: { getScene: () => null },
      sizeOf: () => 0.16,
      previews: {
        inVisit: () => false,
        placeEarlier: () => undefined,
        sync: () => undefined,
      },
      alignmentPicks: {
        sync: () => undefined,
        gpsExtent: () => 50,
        picks: () => ({
          objects: new Map([
            ["byA", { atMs: 2_000, walkedM: 2, alignment: aEnd }],
          ]),
          measurement: pickB,
          measurements: new Map([
            ["aaaaaaaaaaa1", pickA],
            ["bbbbbbbbbbb2", pickB],
          ]),
          sightings: [],
        }),
      },
      draft: {
        saveMeta: () => Promise.resolve(true),
        recordPlacement: () => undefined,
        recordVisit: () => undefined,
      },
      codes,
      visitLog: { entries: () => [] },
      pageId: "page",
      alignmentInfo: () => INFO,
    });
    settle.settleVisit("visit-end");
    // Next to A (2 m walked from A's measurement, 28 m from B's): through
    // A's own pick, not B's (the code in hand) nor the end alignment.
    const settled = new Vector3(
      ...objectPoseNue(ctx.placedObjects[0]!.object.geo, ZERO).positionNue,
    );
    const viaA = new Vector3(
      ...throughAlignment({ position: local, rotation: [0, 0, 0, 1] }, aPickA)!
        .position,
    );
    expect(settled.distanceTo(viaA)).toBeLessThan(1e-3);
    // Both codes re-minted and saved for the Finish: neither is left at the
    // placeholder text it was taken with.
    const written = codes.toWrite();
    expect(written.map((l) => l.id)).toEqual(["aaaaaaaaaaa1", "bbbbbbbbbbb2"]);
    expect(written.every((l) => l.json !== "{}")).toBe(true);
  });
});
