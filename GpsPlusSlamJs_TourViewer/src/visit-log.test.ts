/**
 * The page-side visit log (authoring plan 2026-09-28-0953 §3.3 and §7 #4,
 * milestone M3b).
 *
 * Why these tests matter: the summary map shows each AR visit's walk and
 * judges each code from what the visits measured - but the store forgets
 * all of it at every AR exit. What the settle copies here is therefore the
 * ONLY record, and each of its rules is one the summary's verdict rests
 * on: the code goes through the visit's OWN alignment (a code-corrected
 * one would just repeat the stored pose and fake agreement), synthetic
 * code votes are not the creator's walk, the accuracy and the baseline are
 * the two inputs of the M3a weighting, and what goes into the draft must
 * come back after a reload or be skipped, never half-read.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import {
  calcRelativeCoordsInMeters,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
} from "gps-plus-slam-app-framework/core";
import { Matrix4, Quaternion, Vector3 } from "three";

import { combineCodeVisits } from "./code-visit-combine.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";
import {
  buildVisitLogEntry,
  codeVisitPoses,
  createVisitLog,
  deviceSamples,
  maxHorizontalExtentM,
  newVisitId,
  parseVisitLogEntry,
  serializeVisitLogEntry,
  thinPath,
  VISIT_PATH_MAX_POINTS,
  VISIT_PATH_SPACING_M,
  type VisitLogEntry,
  type VisitLogInput,
} from "./visit-log.js";

// The library gates its geodesy helpers on a licence the store activates.
createTourViewerStore();

const ZERO = { lat: 47.5, lon: 8.7 };

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

/** A device fix at `n`, `e` metres from ZERO, as the store holds it. */
function fix(n: number, e: number, accuracy = 5, source?: string) {
  const R = 6_371_000;
  return {
    latitude: ZERO.lat + (n / R) * (180 / Math.PI),
    longitude:
      ZERO.lon +
      (e / (R * Math.cos((ZERO.lat * Math.PI) / 180))) * (180 / Math.PI),
    latLongAccuracy: accuracy,
    ...(source === undefined ? {} : { source }),
  };
}

/** A walk 30 m North and back along a line, one fix and one odometry
 *  position per metre (odometry NUE: x North, y Up, z East). */
function lineWalk(): Pick<VisitLogInput, "gpsPositions" | "odometryPositions"> {
  const gpsPositions = [];
  const odometryPositions = [];
  for (let i = 0; i <= 60; i += 1) {
    const n = i <= 30 ? i : 60 - i;
    gpsPositions.push(fix(n, 0, 3 + (i % 5)));
    odometryPositions.push([n, 0, 0]);
  }
  return { gpsPositions, odometryPositions };
}

const CODE_POSE = { position: [0, 0, -2], rotation: [0, 0, 0, 1] } as const;

function input(overrides: Partial<VisitLogInput> = {}): VisitLogInput {
  return {
    visitId: "page-0",
    atMs: 1_000,
    ...lineWalk(),
    alignment: yawAlignment(0, [0, 400, 0]),
    pathAlignment: yawAlignment(0, [0, 400, 0]),
    zero: ZERO,
    codes: [{ levelId: "lvl", odomPose: CODE_POSE }],
    ...overrides,
  };
}

function northEast(lat: number, lng: number): [number, number] {
  const nue = calcRelativeCoordsInMeters(ZERO, { lat, lon: lng }, 0, 0);
  return [nue[0], nue[2]];
}

describe("buildVisitLogEntry", () => {
  it("keeps the median accuracy, the walked extent and the thinned walk", () => {
    const entry = buildVisitLogEntry(input());
    // Accuracies cycle 3..7: the median is 5.
    expect(entry.gpsAccuracyM).toBe(5);
    // 30 m out and back: the baseline is the 30 m extent (a thinned subset
    // can only be shorter, by at most two spacings).
    expect(entry.baselineM).toBeLessThanOrEqual(30);
    expect(entry.baselineM).toBeGreaterThanOrEqual(
      30 - 2 * VISIT_PATH_SPACING_M,
    );
    expect(entry.gps.length).toBeGreaterThan(20);
    expect(entry.gps.length).toBeLessThanOrEqual(61);
    // The fused path goes through the path alignment: it walks North.
    const [n] = northEast(
      entry.fused.at(30)?.lat ?? 0,
      entry.fused.at(30)?.lng ?? 0,
    );
    expect(entry.fused.length).toBeGreaterThan(20);
    expect(n).toBeGreaterThan(20);
  });

  it("leaves synthetic code votes out of the walk: their odometry is the code, not the creator", () => {
    const walk = lineWalk();
    const gpsPositions = [
      ...walk.gpsPositions,
      fix(500, 500, 0.05, GPS_POINT_SOURCE_SYNTHETIC_QR),
    ];
    const odometryPositions = [...walk.odometryPositions, [500, 0, 500]];
    const entry = buildVisitLogEntry(
      input({ gpsPositions, odometryPositions }),
    );
    expect(entry.baselineM).toBeLessThanOrEqual(30);
    expect(entry.gpsAccuracyM).toBe(5);
    for (const p of entry.gps)
      expect(northEast(p.lat, p.lng)[0]).toBeLessThan(31);
  });

  it("puts the code through the visit's PLAIN alignment, never the corrected one the pins used", () => {
    const plain = yawAlignment(10, [3, 400, -2]);
    const corrected = yawAlignment(25, [9, 400, 4]);
    const entry = buildVisitLogEntry(
      input({ alignment: plain, pathAlignment: corrected }),
    );
    const world = throughAlignment(odomNueFromWebXr(CODE_POSE), plain)!;
    const expected = mintQrGeoPose({
      worldNuePosition: {
        x: world.position[0],
        y: world.position[1],
        z: world.position[2],
      },
      worldNueRotation: [...world.rotation],
      zero: ZERO,
    });
    expect(entry.codes).toHaveLength(1);
    expect(entry.codes[0]?.levelId).toBe("lvl");
    expect(entry.codes[0]?.geo.lat).toBeCloseTo(expected.lat, 9);
    expect(entry.codes[0]?.geo.lon).toBeCloseTo(expected.lon, 9);
    expect(entry.codes[0]?.geo.rotation).toEqual(expected.rotation);
  });

  it("keeps the walk but no code and no fused path without an alignment", () => {
    const entry = buildVisitLogEntry(
      input({ alignment: null, pathAlignment: null }),
    );
    expect(entry.codes).toEqual([]);
    expect(entry.fused).toEqual([]);
    expect(entry.gps.length).toBeGreaterThan(0);
  });

  it("refuses a non-finite alignment rather than minting garbage", () => {
    const bad = yawAlignment(0, [0, 400, 0]);
    bad[12] = Number.NaN;
    const entry = buildVisitLogEntry(
      input({ alignment: bad, pathAlignment: bad }),
    );
    expect(entry.codes).toEqual([]);
    expect(entry.fused).toEqual([]);
  });

  it("falls back to the store's accuracy, then to none", () => {
    const noAcc = lineWalk().gpsPositions.map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
    }));
    expect(
      buildVisitLogEntry(input({ gpsPositions: noAcc, storeAccuracyM: 6 }))
        .gpsAccuracyM,
    ).toBe(6);
    expect(
      buildVisitLogEntry(input({ gpsPositions: noAcc, storeAccuracyM: null }))
        .gpsAccuracyM,
    ).toBeNull();
  });

  it("skips unreadable fixes and odometry that is not paired with them", () => {
    const entry = buildVisitLogEntry(
      input({
        gpsPositions: [
          fix(0, 0),
          { latitude: "x", longitude: 8.7 },
          { latitude: 95, longitude: 8.7 },
          fix(10, 0),
        ],
        // Not paired index for index: no baseline is made up.
        odometryPositions: [[0, 0, 0]],
      }),
    );
    expect(entry.gps).toHaveLength(2);
    expect(entry.baselineM).toBe(0);
  });

  // Why this test matters (M3a/M3b review #8): the measuring visit names
  // its code twice - the measurement at the tap, then its latest stable
  // sighting - and the M3a spike measured each visit by its LAST look,
  // which is also the later, longer-settled pose. Keeping the first logged
  // the tap-time pose instead.
  it("records a code once, from its LAST look, when it is named twice", () => {
    const later = { position: [1, 0, -2], rotation: [0, 0, 0, 1] } as const;
    const entry = buildVisitLogEntry(
      input({
        codes: [
          { levelId: "lvl", odomPose: CODE_POSE },
          { levelId: "lvl", odomPose: later },
        ],
      }),
    );
    const fromLater = buildVisitLogEntry(
      input({ codes: [{ levelId: "lvl", odomPose: later }] }),
    );
    expect(entry.codes).toHaveLength(1);
    expect(entry.codes[0]?.geo).toEqual(fromLater.codes[0]?.geo);
  });

  // Why this test matters (M3a/M3b review #2): the summary grades the
  // STORED pose - what visitors get - by the visit it came from. Only the
  // settle knows which visit saved it, so the entry records the saved
  // pose on that code, and the summary finds the visit by it.
  it("marks the pose this visit's settle saved on that code only", () => {
    const saved = { lat: 47.50001, lon: 8.70002, alt: 401, headingDeg: 30 };
    const entry = buildVisitLogEntry(
      input({
        codes: [
          { levelId: "lvl", odomPose: CODE_POSE },
          { levelId: "other", odomPose: CODE_POSE },
        ],
        saved: { levelId: "lvl", geo: saved },
      }),
    );
    expect(entry.codes.find((c) => c.levelId === "lvl")?.savedGeo).toEqual(
      saved,
    );
    expect(
      entry.codes.find((c) => c.levelId === "other")?.savedGeo,
    ).toBeUndefined();
    const back = parseVisitLogEntry(serializeVisitLogEntry(entry));
    expect(back!.codes).toEqual(entry.codes);
  });
});

describe("deviceSamples", () => {
  // Why this test matters: the D20 displacement estimators (M5a,
  // `code-displacement.ts`) read the viewer's GPS history through this ONE
  // filter, so a synthetic code vote (whose odometry is the code, not the
  // visitor) never counts as GPS evidence against the code it came from.
  // They count evidence in TIME, so the fix's own timestamp comes along.
  it("keeps device fixes with their odometry partner and timestamp, and drops the votes", () => {
    const samples = deviceSamples({
      gpsPositions: [
        { ...fix(0, 0, 4), timestamp: 1_000 },
        { ...fix(9, 9, 0.05, GPS_POINT_SOURCE_SYNTHETIC_QR), timestamp: 1_500 },
        { ...fix(2, 0, 6), timestamp: 2_000 },
        // No usable time: kept, without one.
        { ...fix(4, 0, 6), timestamp: Number.NaN },
      ],
      odometryPositions: [
        [0, 0, 0],
        [9, 0, 9],
        [2, 0, 0],
        [4, 0, 0],
      ],
    });
    expect(samples.map((s) => s.odom)).toEqual([
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
    ]);
    expect(samples.map((s) => s.timestampMs)).toEqual([
      1_000,
      2_000,
      undefined,
    ]);
    expect(samples.map((s) => s.fix.accuracy)).toEqual([4, 6, 6]);
  });
});

describe("thinPath", () => {
  const dist = (a: number, b: number): number => Math.abs(b - a);

  it("keeps a sparse path whole, and the end of a dense one", () => {
    expect(thinPath([0, 5, 10], dist, 1)).toEqual([0, 5, 10]);
    expect(thinPath([0, 0.2, 0.4, 0.6], dist, 1)).toEqual([0, 0.6]);
    expect(thinPath([], dist)).toEqual([]);
    expect(thinPath([7], dist)).toEqual([7]);
  });

  it("is an ordered subset with both ends, spaced, and capped", () => {
    // Why: the summary draws exactly this, and the baseline is measured
    // on it - a reordered or invented point would draw a walk that did not
    // happen.
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -500, max: 500, noNaN: true }), {
          minLength: 2,
          maxLength: 300,
        }),
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        fc.integer({ min: 2, max: 50 }),
        (points, spacing, cap) => {
          const out = thinPath(points, dist, spacing, cap);
          expect(out.length).toBeLessThanOrEqual(cap);
          expect(out[0]).toBe(points[0]);
          expect(out.at(-1)).toBe(points.at(-1));
          let from = 0;
          for (const p of out) {
            const at = points.indexOf(p, from);
            expect(at).toBeGreaterThanOrEqual(from);
            from = at;
          }
          // Spaced apart (but the end), unless the cap resampled it.
          const spaced = out
            .slice(1, -1)
            .every((p, i) => dist(out[i]!, p) >= spacing);
          expect(out.length === cap || spaced).toBe(true);
        },
      ),
    );
  });

  it("caps an hour's walk at the stored maximum", () => {
    const walk = Array.from({ length: 3_600 }, (_, i) => i * 1.4);
    expect(thinPath(walk, dist)).toHaveLength(VISIT_PATH_MAX_POINTS);
  });
});

describe("maxHorizontalExtentM", () => {
  it("measures North and East, never Up", () => {
    expect(
      maxHorizontalExtentM([
        [0, 0, 0],
        [3, 50, 4],
      ]),
    ).toBe(5);
    expect(maxHorizontalExtentM([])).toBe(0);
  });
});

describe("the draft file", () => {
  it("round-trips an entry within the stored rounding", () => {
    const entry = buildVisitLogEntry(input());
    const back = parseVisitLogEntry(serializeVisitLogEntry(entry));
    expect(back).not.toBeNull();
    expect(back!.visitId).toBe(entry.visitId);
    expect(back!.atMs).toBe(entry.atMs);
    expect(back!.gpsAccuracyM).toBe(entry.gpsAccuracyM);
    expect(back!.baselineM).toBeCloseTo(entry.baselineM, 2);
    expect(back!.gps).toHaveLength(entry.gps.length);
    expect(back!.fused).toHaveLength(entry.fused.length);
    back!.gps.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(entry.gps[i]!.lat, 7);
      expect(p.accuracy).toBeCloseTo(entry.gps[i]!.accuracy!, 1);
    });
    expect(back!.codes).toEqual(entry.codes);
  });

  it("round-trips any readable entry (property)", () => {
    const point = fc.record({
      lat: fc.double({ min: -90, max: 90, noNaN: true }),
      lng: fc.double({ min: -180, max: 180, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.record({
          visitId: fc.string({ minLength: 1, maxLength: 20 }),
          atMs: fc.integer({ min: 0, max: 2 ** 45 }),
          gpsAccuracyM: fc.option(
            fc.double({ min: 0.5, max: 100, noNaN: true }),
            {
              nil: null,
            },
          ),
          baselineM: fc.double({ min: 0, max: 5_000, noNaN: true }),
          gps: fc.array(point, { maxLength: 20 }),
          fused: fc.array(point, { maxLength: 20 }),
        }),
        (raw) => {
          const entry: VisitLogEntry = { ...raw, codes: [] };
          const back = parseVisitLogEntry(serializeVisitLogEntry(entry));
          expect(back).not.toBeNull();
          expect(back!.visitId).toBe(entry.visitId);
          expect(back!.gps).toHaveLength(entry.gps.length);
          expect(back!.fused).toHaveLength(entry.fused.length);
          back!.fused.forEach((p, i) => {
            expect(Math.abs(p.lat - entry.fused[i]!.lat)).toBeLessThanOrEqual(
              1e-7,
            );
          });
        },
      ),
    );
  });

  it("skips a file that is not this version's entry, and costs a bad point or code only itself", () => {
    expect(parseVisitLogEntry("not json")).toBeNull();
    expect(parseVisitLogEntry("null")).toBeNull();
    expect(
      parseVisitLogEntry(
        JSON.stringify({ version: 2, visitId: "v", atMs: 1, baselineM: 0 }),
      ),
    ).toBeNull();
    expect(
      parseVisitLogEntry(
        JSON.stringify({ version: 1, visitId: "", atMs: 1, baselineM: 0 }),
      ),
    ).toBeNull();
    const good = buildVisitLogEntry(input());
    const parsed = JSON.parse(serializeVisitLogEntry(good)) as Record<
      string,
      unknown[]
    >;
    parsed["gps"]!.push(["a", 1], [91, 0], null);
    parsed["codes"]!.push(
      { levelId: "x", geo: { lat: 47.5, lon: 8.7, alt: 400 } },
      { levelId: 5, geo: good.codes[0]!.geo },
    );
    const back = parseVisitLogEntry(JSON.stringify(parsed));
    expect(back!.gps).toHaveLength(good.gps.length);
    expect(back!.codes).toEqual(good.codes);
    // An unreadable saved pose costs that field, not the code.
    const withBadSaved = JSON.parse(serializeVisitLogEntry(good)) as {
      codes: Record<string, unknown>[];
    };
    withBadSaved.codes[0]!["savedGeo"] = { lat: "x" };
    expect(parseVisitLogEntry(JSON.stringify(withBadSaved))!.codes).toEqual(
      good.codes,
    );
  });
});

describe("the in-memory log", () => {
  const entry = (visitId: string, atMs: number): VisitLogEntry => ({
    visitId,
    atMs,
    gpsAccuracyM: 5,
    baselineM: 10,
    gps: [],
    fused: [],
    codes: [],
  });

  it("replaces a visit settled again, keeps a live visit over a restored one, and lists oldest first", () => {
    const log = createVisitLog();
    log.record(entry("b", 20));
    log.record({ ...entry("b", 30), baselineM: 99 });
    log.restore([entry("a", 10), { ...entry("b", 5), baselineM: 1 }]);
    expect(log.entries().map((e) => e.visitId)).toEqual(["a", "b"]);
    expect(log.entries()[1]?.baselineM).toBe(99);
    expect([...log.ids()].sort()).toEqual(["a", "b"]);
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it("names a visit uniquely across page loads", () => {
    expect(newVisitId("abc", 0)).not.toBe(newVisitId("abd", 0));
    expect(newVisitId("abc", 0)).not.toBe(newVisitId("abc", 1));
  });
});

describe("codeVisitPoses", () => {
  it("hands combineCodeVisits one pose per visit that measured the code, and none it cannot weigh", () => {
    const a = buildVisitLogEntry(input({ visitId: "a" }));
    const b = buildVisitLogEntry(input({ visitId: "b", storeAccuracyM: null }));
    const blind = { ...b, gpsAccuracyM: null };
    const poses = codeVisitPoses([a, blind], "lvl");
    expect(poses).toHaveLength(2);
    expect(codeVisitPoses([a], "other")).toEqual([]);
    // The visit without an accuracy is skipped by the combiner, not
    // trusted with a made-up one.
    expect(combineCodeVisits(poses)?.visitCount).toBe(1);
  });
});

describe("the move boundary (authoring plan 2026-09-28-0953 §3.6, M5b)", () => {
  // Why these tests matter (§7j #12): once the author says a code moved
  // ("Use the new spot"), the visits before describe the OLD spot. Combined
  // with the visits after, the summary's estimate would sit between the two
  // spots - a place the code never was. The visit that moved it marks the
  // code, and the combiner reads only from the latest such mark on.
  it("marks a code this visit moved, and only that code, and keeps the mark through the draft", () => {
    const entry = buildVisitLogEntry(
      input({
        codes: [
          { levelId: "lvl", odomPose: CODE_POSE },
          { levelId: "other", odomPose: CODE_POSE },
        ],
        moved: ["lvl"],
      }),
    );
    expect(entry.codes.find((c) => c.levelId === "lvl")?.moved).toBe(true);
    expect(entry.codes.find((c) => c.levelId === "other")?.moved).toBe(
      undefined,
    );
    expect(parseVisitLogEntry(serializeVisitLogEntry(entry))!.codes).toEqual(
      entry.codes,
    );
    // Anything but `true` in a draft file is no mark.
    const raw = JSON.parse(serializeVisitLogEntry(entry)) as {
      codes: Record<string, unknown>[];
    };
    raw.codes[0]!["moved"] = "yes";
    expect(
      parseVisitLogEntry(JSON.stringify(raw))!.codes[0]!.moved,
    ).toBeUndefined();
  });

  it("combines only the visits from the latest move of the code on", () => {
    const before = buildVisitLogEntry(input({ visitId: "before", atMs: 1 }));
    const moved = buildVisitLogEntry(
      input({ visitId: "moved", atMs: 2, moved: ["lvl"] }),
    );
    const after = buildVisitLogEntry(input({ visitId: "after", atMs: 3 }));
    expect(codeVisitPoses([before, moved, after], "lvl")).toHaveLength(2);
    expect(codeVisitPoses([before, after], "lvl")).toHaveLength(2);
    expect(codeVisitPoses([before, moved, after], "other")).toEqual([]);
    // A second move: only from it on.
    const again = buildVisitLogEntry(
      input({ visitId: "again", atMs: 4, moved: ["lvl"] }),
    );
    expect(codeVisitPoses([before, moved, after, again], "lvl")).toHaveLength(
      1,
    );
  });
});
