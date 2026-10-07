import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";

import {
  advanceMatureAlignmentPick,
  openMatureAlignmentPick,
  type AlignmentMoment,
  type MatureAlignmentPick,
} from "gps-plus-slam-app-framework/state/alignment-maturity";

import {
  computeCaptureGeoJoin,
  createCapturePickTracker,
  type ReplayedJoinState,
} from "./capture-geo-join";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

/**
 * Why this property matters (geo-join plan Rev 2 §4): the join's whole
 * contract is that going odom → alignment → geo and back into the VIEWER's
 * NUE frame lands each photo at the aligned position — for EVERY
 * translation and capture position, not the two examples the unit tests
 * pick. A sign flip, an axis swap, or a degrees/metres confusion anywhere
 * in the chain breaks the round-trip by metres and fails loudly here;
 * geodesy round-trip error at these scales is millimetres.
 */
describe("capture-geo-join — round-trip property", () => {
  it("geo output re-projected into the recording zero's NUE equals the aligned odom position", () => {
    const metres = (range: number) =>
      fc.double({ min: -range, max: range, noNaN: true }).map((v) => v + 0);
    fc.assert(
      fc.property(
        fc.record({
          tN: metres(100),
          tU: metres(30),
          tE: metres(100),
          pN: metres(50),
          pU: metres(10),
          pE: metres(50),
        }),
        ({ tN, tU, tE, pN, pU, pE }) => {
          const zero = { lat: 47.5, lon: 8.7 };
          const state: ReplayedJoinState = {
            gpsData: {
              zero,
              gpsEvents: {
                gpsPositions: [{}, {}, {}],
                // Column-major identity rotation + translation.
                alignmentMatrix: [
                  1,
                  0,
                  0,
                  0,
                  0,
                  1,
                  0,
                  0,
                  0,
                  0,
                  1,
                  0,
                  tN,
                  tU,
                  tE,
                  1,
                ],
                alignmentRotation: [0, 0, 0, 1],
                gpsAccuracyMedian: null,
              },
              odometryPath: {
                points: [
                  {
                    imageFile: "images/p.jpg",
                    position: [pN, pU, pE],
                    rotation: [0, 0, 0, 1],
                  },
                ],
              },
            },
          };
          const [pose] = computeCaptureGeoJoin(state);
          const nue = calcRelativeCoordsInMeters(
            zero,
            { lat: pose!.geo.lat, lon: pose!.geo.lon },
            pose!.geo.altitude,
            0,
          );
          expect(nue[0]).toBeCloseTo(pN + tN, 2);
          expect(nue[1]).toBeCloseTo(pU + tU, 2);
          expect(nue[2]).toBeCloseTo(pE + tE, 2);
        },
      ),
    );
  });
});

/**
 * Why this property matters (S1 milestone review #10): the pick tracker
 * runs over every action of a walk, at the Finish and in the viewer. Folding
 * each open photo's pick on every action costs actions x open photos, which
 * on a long walk that never settles is tens of millions of steps. The
 * tracker shares one "latest usable" moment instead; this property pins that
 * it picks EXACTLY what the per-photo fold of the shared rule
 * (`state/alignment-maturity`) picks, for any sequence.
 */
describe("createCapturePickTracker - equals the per-photo fold of the maturity rule", () => {
  type Step =
    | { kind: "tick"; matrix: number | null; extentM: number }
    | { kind: "photo"; file: number; matrix: number | null; extentM: number };
  const matrixOf = (m: number) => Array.from({ length: 16 }, (_, i) => m + i);
  interface Moment extends AlignmentMoment {
    readonly id: number;
  }

  it("for any walk of ticks and photos", () => {
    const step = fc.oneof(
      fc.record({
        kind: fc.constant("tick" as const),
        matrix: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
        extentM: fc.double({ min: 0, max: 80, noNaN: true }),
      }),
      fc.record({
        kind: fc.constant("photo" as const),
        file: fc.integer({ min: 0, max: 6 }),
        matrix: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
        extentM: fc.double({ min: 0, max: 80, noNaN: true }),
      }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), (steps: Step[]) => {
        const extents = new WeakMap<object, number>();
        const tracker = createCapturePickTracker({
          extentOf: (state) => extents.get(state) ?? 0,
        });
        // The reference: one pick per photo, advanced on every step.
        const reference = new Map<string, MatureAlignmentPick<Moment>>();
        steps.forEach((s, id) => {
          const matrix = s.matrix === null ? null : matrixOf(s.matrix);
          const state = {
            gpsData: {
              zero: { lat: 47.5, lon: 8.7 },
              gpsEvents: {
                gpsPositions: [],
                alignmentMatrix: matrix,
                alignmentRotation: [0, 0, 0, 1] as const,
              },
            },
          };
          extents.set(state, s.extentM);
          const now: Moment = {
            id,
            alignmentMatrix: matrix,
            zero: { lat: 47.5, lon: 8.7 },
            gpsExtentM: s.extentM,
          };
          for (const [file, pick] of reference) {
            reference.set(file, advanceMatureAlignmentPick(pick, now));
          }
          const file =
            s.kind === "photo" ? `images/f${String(s.file)}.jpg` : null;
          if (file !== null) reference.set(file, openMatureAlignmentPick(now));
          tracker.observe(
            file === null
              ? { type: "gpsData/recordGpsEvent" }
              : { type: "gpsData/add2dImage", payload: { imageFile: file } },
            state as never,
          );
        });
        for (const [file, pick] of reference) {
          const expected = pick.alignment.alignmentMatrix;
          expect(tracker.alignmentFor(file)?.matrix ?? null).toEqual(expected);
        }
      }),
      { numRuns: 300 },
    );
  });
});
