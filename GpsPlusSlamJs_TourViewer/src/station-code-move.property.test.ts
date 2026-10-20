/**
 * Why these properties matter (tour editor plan 2026-10-17-1816, D17): the
 * owner's condition is that a re-measured code moves a station ATOMICALLY
 * and never changes the local poses of its content. Over random tours,
 * codes and improvements: the items are the very same objects, exactly
 * the stations the rule names move, and every item of a moved station
 * lands where the code's own correction puts it (rigid), so a station's
 * content never separates from it or from the code.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type {
  TourItem,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import "./test-support/v3-tour.js";
import { moveWithCode, takesAlong } from "./move-with-code.js";
import { moveStationsWithCode } from "./station-code-move.js";

const M_PER_DEG = 111_320;

const yaw = (deg: number): [number, number, number, number] => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};

function offset(
  base: QrGeoPose,
  north: number,
  east: number,
  up: number,
  turnDeg: number,
): QrGeoPose {
  return {
    lat: base.lat + north / M_PER_DEG,
    lon: base.lon + east / (M_PER_DEG * Math.cos((base.lat * Math.PI) / 180)),
    alt: base.alt + up,
    rotation: yaw(turnDeg),
  };
}

function metres(a: QrGeoPose, b: QrGeoPose): number {
  const r = calcRelativeCoordsInMeters(a, b, b.alt, a.alt);
  return Math.hypot(r[0], r[1], r[2]);
}

const metresArb = (max: number) =>
  fc.double({ min: -max, max, noNaN: true, noDefaultInfinity: true });

const item = fc
  .record({
    n: metresArb(20),
    u: metresArb(3),
    e: metresArb(20),
    turn: metresArb(180),
  })
  .map(({ n, u, e, turn }) => (id: string): TourItem => ({
    id,
    kind: "pin",
    label: "x",
    createdAtIso: "2026-10-18T00:00:00.000Z",
    pose: { position: [n, u, e], rotation: yaw(turn) },
  }));

const tour = fc.record({
  code: fc.record({
    lat: fc.double({ min: -60, max: 60, noNaN: true }),
    lon: fc.double({ min: -170, max: 170, noNaN: true }),
    turn: metresArb(180),
  }),
  stations: fc.array(
    fc.record({
      n: metresArb(80),
      e: metresArb(80),
      u: metresArb(5),
      turn: metresArb(180),
      items: fc.array(item, { maxLength: 3 }),
    }),
    { maxLength: 6 },
  ),
  others: fc.array(fc.record({ n: metresArb(100), e: metresArb(100) }), {
    maxLength: 2,
  }),
  improvement: fc.record({
    n: metresArb(5),
    e: metresArb(5),
    u: metresArb(1),
    turn: metresArb(60),
  }),
  claimFirst: fc.boolean(),
});

describe("moveStationsWithCode (property, D17)", () => {
  it("moves exactly the stations the rule names, rigidly, and never touches an item", () => {
    fc.assert(
      fc.property(tour, (t) => {
        const from: QrGeoPose = {
          lat: t.code.lat,
          lon: t.code.lon,
          alt: 400,
          rotation: yaw(t.code.turn),
        };
        const to = offset(
          from,
          t.improvement.n,
          t.improvement.e,
          t.improvement.u,
          t.code.turn + t.improvement.turn,
        );
        const others = t.others.map((o) => offset(from, o.n, o.e, 0, 0));
        const stations: TourStation[] = t.stations.map((s, i) => ({
          id: `s${String(i)}`,
          geo: offset(from, s.n, s.e, s.u, s.turn),
          activateRadiusM: 50,
          foundRadiusM: 25,
          hint: "arrow",
          steps: [],
          items: s.items.map((it, j) => it(`i${String(i)}-${String(j)}`)),
        }));
        const claimed = new Set(t.claimFirst ? ["s0"] : []);
        const out = moveStationsWithCode(stations, {
          from,
          to,
          others,
          claimed,
        });
        const expected = stations
          .filter((s) => !claimed.has(s.id) && takesAlong(s.geo, from, others))
          .map((s) => s.id);
        expect(out.moved).toEqual(expected);
        expect(out.stations.map((s) => s.id)).toEqual(
          stations.map((s) => s.id),
        );
        const pairs = stations.map((before, i) => ({
          before,
          after: out.stations[i]!,
        }));
        const movedIds = new Set(expected);
        // Never an item: the same array, the same objects.
        for (const { before, after } of pairs) {
          expect(after.items).toBe(before.items);
        }
        for (const { before, after } of pairs.filter(
          (p) => !movedIds.has(p.before.id),
        )) {
          expect(after).toBe(before);
        }
        for (const { before, after } of pairs.filter((p) =>
          movedIds.has(p.before.id),
        )) {
          expect({ ...after, geo: before.geo }).toEqual(before);
          // Rigid: each item where the code's correction puts it.
          for (const it of before.items) {
            const was = itemGeoPose(it.pose, before.geo);
            const is = itemGeoPose(it.pose, after.geo);
            expect(metres(is, moveWithCode(was, from, to))).toBeLessThan(0.002);
          }
          // And the anchor keeps its distance to the code.
          expect(
            Math.abs(metres(to, after.geo) - metres(from, before.geo)),
          ).toBeLessThan(0.002);
        }
      }),
      { numRuns: 200 },
    );
  });
});
