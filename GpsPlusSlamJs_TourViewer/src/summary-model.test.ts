/**
 * The summary map's model (authoring plan 2026-09-28-0953 §1 item 5,
 * §3.3, M3b): exactly what the map view hands to Leaflet.
 *
 * Why these tests matter: the owner asked for "a clearly visible line for
 * the direction the code faces" and the result of the final estimate, so
 * the author can decide whether to scan more. A facing line off by 90
 * degrees, a combined estimate drawn as if it were the stored position,
 * or a pin at the wrong place would each mislead that decision while the
 * map still renders - none of it is visible to a test that only checks a
 * map appeared. So the model is tested here, without a map.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type LatLong,
} from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { rotationFromHeading } from "./content-placement.js";
import {
  buildSummaryModel,
  DIFFERS_M,
  FACING_LINE_MAX_M,
  FACING_LINE_MIN_M,
  facingBearingDeg,
  type MapPoint,
} from "./summary-model.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import type { VisitLogEntry } from "./visit-log.js";

// The library gates its geodesy helpers on a licence the store activates.
createTourViewerStore();

const ZERO: LatLong = { lat: 47.5, lon: 8.7 };

function at(n: number, e: number): MapPoint {
  const ll = calcGpsCoords(ZERO, [n, 0, e]);
  return { lat: ll.lat, lng: ll.lon };
}

/** A wall poster `n`/`e` m from ZERO, its local +X at `headingDeg`. */
function poster(n: number, e: number, headingDeg: number): QrGeoPose {
  const p = at(n, e);
  return {
    lat: p.lat,
    lon: p.lng,
    alt: 400,
    headingDeg,
    rotation: [...rotationFromHeading(headingDeg)],
  };
}

function visit(
  visitId: string,
  codes: VisitLogEntry["codes"],
  overrides: Partial<VisitLogEntry> = {},
): VisitLogEntry {
  return {
    visitId,
    atMs: 1,
    gpsAccuracyM: 4,
    baselineM: 40,
    gps: [at(0, 0), at(20, 0)].map((p) => ({ ...p, accuracy: 4 })),
    fused: [at(0, 1), at(20, 1)],
    codes,
    ...overrides,
  };
}

function distanceM(a: MapPoint, b: MapPoint): number {
  const nue = calcRelativeCoordsInMeters(
    { lat: a.lat, lon: a.lng },
    { lat: b.lat, lon: b.lng },
    0,
    0,
  );
  return Math.hypot(nue[0], nue[2]);
}

function bearingDeg(a: MapPoint, b: MapPoint): number {
  const nue = calcRelativeCoordsInMeters(
    { lat: a.lat, lon: a.lng },
    { lat: b.lat, lon: b.lng },
    0,
    0,
  );
  return ((Math.atan2(nue[2], nue[0]) * 180) / Math.PI + 360) % 360;
}

const pin = (id: string, label: string, p: MapPoint): TourObject => ({
  id,
  kind: "pin",
  label,
  createdAtIso: "2026-10-01T00:00:00.000Z",
  geo: { lat: p.lat, lon: p.lng, alt: 400, rotation: [0, 0, 0, 1] },
});

describe("facingBearingDeg", () => {
  it("is headingDeg + 90 for a wall poster: the printed face's normal, not its edge", () => {
    expect(facingBearingDeg(poster(0, 0, 30))).toBeCloseTo(120, 6);
    expect(facingBearingDeg(poster(0, 0, 300))).toBeCloseTo(30, 6);
  });

  it("reads a heading-only level the same way, and lets the rotation win when both exist", () => {
    const geo = poster(0, 0, 30);
    expect(
      facingBearingDeg({
        lat: geo.lat,
        lon: geo.lon,
        alt: 400,
        headingDeg: 30,
      }),
    ).toBeCloseTo(120, 6);
    expect(
      facingBearingDeg({
        ...geo,
        headingDeg: 30,
        rotation: [...rotationFromHeading(100)],
      }),
    ).toBeCloseTo(190, 6);
  });

  it("gives a code lying flat no facing at all", () => {
    // Face up: +Z turned onto Up, a quarter turn about North.
    const s = Math.SQRT1_2;
    expect(
      facingBearingDeg({
        lat: 47.5,
        lon: 8.7,
        alt: 400,
        rotation: [-s, 0, 0, s],
      }),
    ).toBeNull();
  });

  it("is headingDeg + 90 at every heading (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 359.99, noNaN: true }), (h) => {
        const facing = facingBearingDeg(poster(0, 0, h))!;
        const d = Math.abs(facing - ((h + 90) % 360));
        expect(Math.min(d, 360 - d)).toBeLessThan(1e-6);
      }),
    );
  });
});

describe("buildSummaryModel", () => {
  it("draws the measured code once, with its facing line, its ring and its verdict", () => {
    const geo = poster(10, 0, 30);
    const model = buildSummaryModel({
      visits: [visit("v1", [{ levelId: "lvl", geo }])],
      references: [{ levelId: "lvl", geo }],
      objects: [],
    });
    expect(model.codes).toHaveLength(1);
    const code = model.codes[0]!;
    expect(code.label).toBe("The code");
    expect(code.reference?.lat).toBeCloseTo(geo.lat, 9);
    // The line leaves the code in the direction the face looks.
    const line = code.reference!.facingLine!;
    expect(bearingDeg(line[0], line[1])).toBeCloseTo(120, 3);
    const length = distanceM(line[0], line[1]);
    expect(length).toBeGreaterThanOrEqual(FACING_LINE_MIN_M - 1e-6);
    expect(length).toBeLessThanOrEqual(FACING_LINE_MAX_M + 1e-6);
    // One visit: the estimate IS the stored pose - not drawn twice.
    expect(code.combined?.shown).toBe(false);
    expect(code.combined?.ringM).toBeCloseTo(4, 6);
    // 4 m GPS over a 40 m walk: within 5 m and 12 degrees.
    expect(code.verdict.kind).toBe("good");
    expect(code.details.join(" ")).toMatch(
      /1 visit: expected within 4\.0 m and 6 degrees/,
    );
    expect(code.details.join(" ")).toMatch(/provisional/);
  });

  it("draws the visits' estimate beside a stored pose it disagrees with, as information only", () => {
    const stored = poster(0, 0, 30);
    const measured = poster(0, 6, 30);
    const model = buildSummaryModel({
      visits: [
        visit("v1", [{ levelId: "lvl", geo: measured }]),
        visit("v2", [{ levelId: "lvl", geo: measured }]),
      ],
      references: [{ levelId: "lvl", geo: stored }],
      objects: [],
    });
    const code = model.codes[0]!;
    // The reference stays where it is stored...
    expect(distanceM(code.reference!, at(0, 0))).toBeLessThan(0.01);
    // ...and the estimate is drawn 6 m away, and said so.
    expect(code.combined?.shown).toBe(true);
    expect(code.combined?.offsetM).toBeCloseTo(6, 1);
    expect(code.combined?.offsetM).toBeGreaterThan(DIFFERS_M);
    expect(code.details.join(" ")).toMatch(
      /6\.0 m and 0 degrees from the saved position; the saved position stays/,
    );
  });

  it("shows a code no visit measured, with a scan-again verdict and no ring", () => {
    const model = buildSummaryModel({
      visits: [],
      references: [{ levelId: "lvl", geo: poster(0, 0, 0) }],
      objects: [],
    });
    const code = model.codes[0]!;
    expect(code.combined).toBeNull();
    expect(code.verdict.kind).toBe("scan-again");
    expect(code.details).toEqual([
      "No AR visit on this device measured this code yet.",
    ]);
  });

  it("shows a code only the visits know, and numbers several codes", () => {
    const model = buildSummaryModel({
      visits: [visit("v1", [{ levelId: "other", geo: poster(5, 5, 0) }])],
      references: [{ levelId: "lvl", geo: poster(0, 0, 0) }],
      objects: [],
    });
    expect(model.codes.map((c) => [c.levelId, c.label])).toEqual([
      ["lvl", "Code 1"],
      ["other", "Code 2"],
    ]);
    expect(model.codes[1]?.reference).toBeNull();
    expect(model.codes[1]?.combined?.shown).toBe(true);
  });

  it("labels pins by their text and photos by caption or kind, where they stand", () => {
    const photo: TourObject = {
      id: "p1",
      kind: "photo",
      image: "content/p1.jpg",
      imageWidth: 4,
      imageHeight: 3,
      createdAtIso: "2026-10-01T00:00:00.000Z",
      geo: {
        lat: at(3, 3).lat,
        lon: at(3, 3).lng,
        alt: 400,
        rotation: [0, 0, 0, 1],
      },
    };
    const model = buildSummaryModel({
      visits: [],
      references: [],
      objects: [
        pin("a", "Old gate", at(1, 2)),
        photo,
        { ...photo, id: "p2", label: "The tower" },
      ],
    });
    expect(model.objects.map((o) => [o.kind, o.label])).toEqual([
      ["pin", "Old gate"],
      ["photo", "Photo"],
      ["photo", "The tower"],
    ]);
    expect(distanceM(model.objects[0]!, at(1, 2))).toBeLessThan(0.01);
  });

  it("keeps each visit's walk apart and drops points it cannot place", () => {
    const model = buildSummaryModel({
      visits: [
        visit("v1", []),
        visit("v2", [], { fused: [at(0, 0), { lat: Number.NaN, lng: 8.7 }] }),
      ],
      references: [],
      objects: [pin("bad", "x", { lat: 91, lng: 0 })],
    });
    expect(model.tracks.map((t) => t.visitId)).toEqual(["v1", "v2"]);
    expect(model.tracks[1]?.fused).toHaveLength(1);
    expect(model.objects).toEqual([]);
    for (const p of model.fitPoints) {
      expect(Number.isFinite(p.lat) && Number.isFinite(p.lng)).toBe(true);
    }
  });

  it("frames everything it draws: the walk, the pins, the facing line and the ring", () => {
    const geo = poster(0, 0, 30);
    const model = buildSummaryModel({
      visits: [visit("v1", [{ levelId: "lvl", geo }], { gpsAccuracyM: 30 })],
      references: [{ levelId: "lvl", geo }],
      objects: [pin("a", "far pin", at(-50, 10))],
    });
    const fit = model.fitPoints;
    const has = (p: MapPoint) => fit.some((f) => distanceM(f, p) < 0.01);
    expect(has(at(-50, 10))).toBe(true);
    expect(has(model.codes[0]!.reference!.facingLine![1])).toBe(true);
    // The 30 m ring's North edge.
    expect(fit.some((f) => Math.abs(distanceM(f, at(0, 0)) - 30) < 0.5)).toBe(
      true,
    );
  });
});
