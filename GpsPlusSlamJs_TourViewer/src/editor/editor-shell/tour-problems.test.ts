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
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { outsideItems, problemCounts, tourProblems } from "./tour-problems.js";
import { stationContent, storyOf } from "../../test-support/station-content.js";

const AT = "2026-11-04T00:00:00.000Z";

// The fix's geodesy is licence-gated: building a store activates the
// licence, as the page's own store does at boot.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

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
    ...stationContent(blocks as readonly TourBlock[]),
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
    expect(groups).toMatchObject([
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

  // Why: the Problems row of an item outside its circle offers "Move
  // inside", as the chosen layout does. The edit must bring the item back
  // inside the circle along the line it stands on (the creator's
  // direction kept), at its height and heading, as one ordinary pose edit
  // the page writes and can undo.
  it("offers to move an outside item inside, along its line, height kept", () => {
    const far = pin("far", 30, 40, "Far pin", 2.5);
    const [group] = tourProblems([station("a", [far], "Square")]);
    const fix = group?.problems[0]?.fix;
    expect(fix?.label).toBe("Move inside");
    expect(fix?.done).toBe('Moved "Far pin" inside its station\'s circle');
    const edit = fix!.edit();
    expect(edit.kind).toBe("item-pose");
    expect(edit.id).toBe("far");
    const geo = edit.geo;
    const northM = (geo.lat - 48.1) * 111_320;
    const eastM = (geo.lon - 11.5) * 111_320 * Math.cos((48.1 * Math.PI) / 180);
    const distanceM = Math.hypot(northM, eastM);
    expect(distanceM).toBeLessThan(25);
    expect(distanceM).toBeGreaterThan(19);
    // Along its line: 30 north to 40 east.
    expect(Math.atan2(eastM, northM)).toBeCloseTo(Math.atan2(40, 30), 2);
    expect(geo.alt).toBeCloseTo(560 + 2.5, 6);
    // A station's own note has nothing to fix in one click.
    const [empty] = tourProblems([station("b", [])]);
    expect(empty?.problems[0]?.fix).toBeUndefined();
  });

  // Why: a move of tens of metres on sloping ground kept the item's
  // height in the station's frame, so it floated over a downhill spot or
  // sank into an uphill one. Where the view has the ground loaded at both
  // spots, the item keeps its height over the ground instead; where it
  // has not, the frame's height is kept (as above).
  it("keeps the moved item's height over the ground where the ground is known", () => {
    const far = pin("far", 30, 40, "Far pin", 2.5);
    const [group] = tourProblems([station("a", [far], "Square")]);
    const fix = group!.problems[0]!.fix!;
    const asked: { lat: number; lon: number }[] = [];
    // The far spot (50 m out) lies 4 m lower than the station's anchor
    // ground; the new spot (21 m out) 7 m higher than it.
    const ground = (place: { lat: number; lon: number }) => {
      asked.push(place);
      const northM = (place.lat - 48.1) * 111_320;
      return northM > 20 ? 556 : 567;
    };
    const geo = fix.edit(ground).geo;
    expect(asked).toHaveLength(2);
    // 6.5 m over the old ground (562.5 - 556), so 6.5 m over the new.
    expect(geo.alt).toBeCloseTo(567 + 6.5, 3);
    // One spot without ground loaded: the frame's height is kept.
    const half = fix.edit((place) =>
      (place.lat - 48.1) * 111_320 > 20 ? 556 : null,
    ).geo;
    expect(half.alt).toBeCloseTo(560 + 2.5, 3);
  });

  it("moves an outside item of a small circle halfway in", () => {
    const [group] = tourProblems([
      station("a", [pin("far", 6, 8, "Far pin")], "Square", 4),
    ]);
    const geo = group!.problems[0]!.fix!.edit().geo;
    const northM = (geo.lat - 48.1) * 111_320;
    const eastM = (geo.lon - 11.5) * 111_320 * Math.cos((48.1 * Math.PI) / 180);
    expect(Math.hypot(northM, eastM)).toBeCloseTo(2, 1);
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

  // Why: a station whose only content is a story has something to show;
  // the note would send a creator looking for a fault that is not there.
  it("does not note a station whose content is all in a story", () => {
    const told = station("a", [], "Square");
    expect(
      tourProblems([
        {
          ...told,
          children: [
            storyOf("first", [
              {
                id: "line",
                kind: "shortText",
                view: "card",
                caption: "Hello",
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              },
            ]),
          ],
        },
      ]),
    ).toEqual([]);
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
