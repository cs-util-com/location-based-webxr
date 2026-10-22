import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bearingDeltaDeg } from "gps-plus-slam-app-framework/utils/bearing-degrees";

import {
  walkRadarModel,
  type WalkRadarGeometry,
  type WalkRadarInput,
  type WalkRadarStation,
} from "./walk-radar-model";
import type { WalkChipKind } from "./visitor-guide-slice";
import type { WalkRowState } from "./walk-sheet-model";

/**
 * Why these properties matter (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M3, Tests): the radar is the visitor's map; a blip off its bearing, a
 * nearer station drawn farther out, a blip outside the rim, two oranges,
 * an orange where the guide cannot tell which station is nearest, or a
 * blur narrower for a worse fix would each mislead. The properties state
 * these for every tour, heading, size and precision, not for one picture;
 * and the frozen radar's promise - it never reads the live position - as
 * an equality over two different live geometries.
 */

const STATES: readonly WalkRowState[] = [
  "next",
  "left",
  "found",
  "here",
  "skipped",
  "later",
];
const KINDS: readonly WalkChipKind[] = [
  "pending",
  "code",
  "gps",
  "weak",
  "none",
  "lost",
];

const stationsArb = fc
  .array(
    fc.record({
      state: fc.constantFrom(...STATES),
      bearing: fc.double({ min: 0, max: 359.999, noNaN: true }),
      distance: fc.double({ min: 0, max: 2000, noNaN: true }),
    }),
    { minLength: 1, maxLength: 30 },
  )
  .map((list) => {
    // At most one "next" (the sheet's focus), as the list draws it.
    let seen = false;
    return list.map((s, i) => {
      const state = s.state === "next" && seen ? "left" : s.state;
      if (state === "next") seen = true;
      return { ...s, state, id: `s${String(i)}`, number: i + 1 };
    });
  });

type Gen = {
  id: string;
  number: number;
  state: WalkRowState;
  bearing: number;
  distance: number;
};

function geometryOf(
  list: readonly Gen[],
  headingDeg: number | null,
): WalkRadarGeometry {
  return {
    headingDeg,
    bearings: new Map(list.map((s) => [s.id, s.bearing])),
    distances: new Map(list.map((s) => [s.id, s.distance])),
  };
}

function inputOf(
  list: readonly Gen[],
  over: Partial<WalkRadarInput>,
): WalkRadarInput {
  const stations: WalkRadarStation[] = list.map(({ id, number, state }) => ({
    id,
    number,
    state,
  }));
  const geo = geometryOf(list, 0);
  return {
    stations,
    order: "any",
    kind: "code",
    accuracyM: null,
    live: geo,
    snapshot: geo,
    fovDeg: 64,
    sizePx: 132,
    ...over,
  };
}

describe("walkRadarModel - properties", () => {
  it("a blip's angle is bearingDeltaDeg of the station's bearing and the camera's", () => {
    fc.assert(
      fc.property(
        stationsArb,
        fc.double({ min: 0, max: 359.999, noNaN: true }),
        fc.constantFrom<WalkChipKind>("code", "gps", "weak"),
        (list, heading, kind) => {
          const m = walkRadarModel(
            inputOf(list, {
              live: geometryOf(list, heading),
              kind,
              accuracyM: 10,
            }),
          );
          for (const b of m.blips) {
            const dx = b.x - m.centre;
            const dy = m.centre - b.y;
            if (Math.hypot(dx, dy) < 1e-6) continue;
            const s = list.find((g) => g.id === b.id)!;
            const drawn = (Math.atan2(dx, dy) * 180) / Math.PI;
            expect(
              Math.abs(
                bearingDeltaDeg(drawn, bearingDeltaDeg(s.bearing, heading)),
              ),
            ).toBeLessThan(1e-6);
          }
        },
      ),
    );
  });

  it("a blip's radius is monotone in distance and never past the rim", () => {
    fc.assert(
      fc.property(
        stationsArb,
        fc.integer({ min: 96, max: 144 }),
        (list, size) => {
          const m = walkRadarModel(inputOf(list, { sizePx: size }));
          const radial = m.blips.map((b) => ({
            d: list.find((g) => g.id === b.id)!.distance,
            r: Math.hypot(b.x - m.centre, b.y - m.centre),
          }));
          for (const p of radial) {
            expect(p.r).toBeLessThanOrEqual(m.rimR - 8 + 1e-9);
            const nearerOutside = radial.filter(
              (q) => p.d < q.d && p.r > q.r + 1e-9,
            );
            expect(nearerOutside).toEqual([]);
          }
        },
      ),
    );
  });

  // Changed in M4: which station is the focus is the guide's (§1.9 R-1,
  // R-2) - in R-2's condition it names none, so no row is "next" (the
  // guide's and the sheet's properties hold that); the radar draws
  // exactly the row the guide names, and none while frozen.
  it("at most one orange blip, only on the guide's focus, none frozen", () => {
    fc.assert(
      fc.property(
        stationsArb,
        fc.constantFrom(...KINDS),
        fc.constantFrom<"any" | "fixed" | "branch">("any", "fixed", "branch"),
        (list, kind, order) => {
          const m = walkRadarModel(
            inputOf(list, { kind, order, accuracyM: 30 }),
          );
          const oranges =
            m.blips.filter((b) => b.look === "focus").length +
            m.distanceRings.filter((r) => r.focus).length;
          expect(oranges).toBeLessThanOrEqual(1);
          const frozen = kind === "none" || kind === "lost";
          const named = list.some((s) => s.state === "next");
          expect(frozen || !named ? oranges : 0).toBe(0);
          const orange = m.blips.find((b) => b.look === "focus");
          expect(
            orange === undefined ||
              list.find((s) => s.id === orange.id)?.state === "next",
          ).toBe(true);
          expect(m.rimArc === null || oranges === 1).toBe(true);
        },
      ),
    );
  });

  it("the GPS blur grows with the accuracy", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.constantFrom<WalkChipKind>("gps", "weak"),
        fc.integer({ min: 96, max: 144 }),
        (a, b, kind, size) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const blur = (acc: number): number => {
            const v = walkRadarModel(
              inputOf([], { kind, accuracyM: acc, sizePx: size }),
            ).visitor;
            if (v.kind !== "blur") throw new Error("no blur");
            return v.r;
          };
          expect(blur(lo)).toBeLessThanOrEqual(blur(hi));
          expect(blur(lo)).toBeGreaterThanOrEqual(7);
        },
      ),
    );
  });

  it("a frozen radar never reads the live position", () => {
    fc.assert(
      fc.property(
        stationsArb,
        stationsArb,
        fc.option(fc.double({ min: 0, max: 359.999, noNaN: true })),
        fc.constantFrom<WalkChipKind>("none", "lost"),
        (list, otherLive, heading, kind) => {
          const snapshot = geometryOf(list, heading);
          const a = walkRadarModel(
            inputOf(list, { kind, snapshot, live: geometryOf(otherLive, 77) }),
          );
          const b = walkRadarModel(
            inputOf(list, { kind, snapshot, live: null }),
          );
          expect(a).toEqual(b);
        },
      ),
    );
  });
});
