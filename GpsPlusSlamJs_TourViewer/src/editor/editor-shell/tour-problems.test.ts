/**
 * Why these tests matter: the bottom panel's Problems tab and its badge
 * are drawn from these rules. An item outside its station's circle is
 * never found by a visitor standing at the station, so it must be listed
 * (with how far out it is), and the inspector's "outside" count must be
 * the same rule, not a second copy that could drift from it. A station
 * with nothing in it is worth a note, never a warning. A tour without a
 * problem lists nothing, which is what the empty state and the hidden
 * badge rest on.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { outsideItems, problemCounts, tourProblems } from "./tour-problems.js";

const AT = "2026-11-04T00:00:00.000Z";

function pin(id: string, north: number, east: number, caption = id, up = 1.5) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption,
    createdAtIso: AT,
    pose: { position: [north, up, east], rotation: [0, 0, 0, 1] },
  };
}

function station(
  id: string,
  blocks: readonly unknown[],
  title?: string,
  foundRadiusM = 25,
): TourStation {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    geo: { lat: 48.1, lon: 11.5, alt: 560, headingDeg: 0 },
    activateRadiusM: 50,
    foundRadiusM,
    hint: "arrow",
    steps: [],
    blocks,
  } as unknown as TourStation;
}

describe("tourProblems", () => {
  it("lists nothing for a tour without a problem", () => {
    expect(tourProblems([station("a", [pin("p", 3, 4)], "Square")])).toEqual(
      [],
    );
    expect(tourProblems([])).toEqual([]);
  });

  it("warns of an item outside its station's circle, with how far out", () => {
    const groups = tourProblems([
      station("a", [pin("in", 3, 4), pin("far", 30, 40, "Far pin")], "Square"),
    ]);
    expect(groups).toEqual([
      {
        stationId: "a",
        number: 1,
        title: "Square",
        problems: [
          {
            severity: "warning",
            what: "Outside its station's circle (50 m from the centre, circle 25 m)",
            who: "Far pin",
            select: "far",
          },
        ],
      },
    ]);
  });

  it("counts an item on the circle itself as inside", () => {
    expect(tourProblems([station("a", [pin("edge", 15, 20)])])).toEqual([]);
  });

  it("notes a station with nothing in it, named by its number when untitled", () => {
    const groups = tourProblems([
      station("a", [pin("p", 1, 1)], "Square"),
      station("b", []),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ stationId: "b", number: 2 });
    expect(groups[0]?.title).toMatch(/2/);
    expect(groups[0]?.problems).toEqual([
      {
        severity: "note",
        what: "Has no content yet",
        who: groups[0]?.title,
        select: "station:b",
      },
    ]);
  });

  it("counts the problems by severity", () => {
    const groups = tourProblems([
      station("a", [pin("x", 99, 0), pin("y", 0, 99)]),
      station("b", []),
    ]);
    expect(problemCounts(groups)).toEqual({ error: 0, warning: 2, note: 1 });
  });
});

describe("outsideItems", () => {
  // Why: the inspector's count and the Problems tab read this one rule;
  // for any place of an item, outside means farther from the station's
  // centre along the ground than its circle, the height never counting.
  it("is the ground distance against the circle, whatever the height (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: 1, max: 150, noNaN: true }),
        (north, east, up, radius) => {
          const out = outsideItems(
            station("a", [pin("p", north, east, "p", up)], "S", radius),
          );
          expect(out.length === 1).toBe(Math.hypot(north, east) > radius);
        },
      ),
    );
  });
});
