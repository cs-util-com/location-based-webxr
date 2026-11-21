/**
 * Why these tests matter: the page's selection is one string whose prefix
 * says what it names - `station:<id>`, `story:<id>`, `folder:<id>`, or a
 * bare id for an item or a code - and the prefix is taken apart by hand
 * (`startsWith` and `slice`) in many places of the editor. A later change
 * parses it in one place; these pin what `selectedStationOf`, the one
 * shared reader of it today, answers for each form, so that parser can be
 * checked against it. They also pin the corner the hand parsing has: a
 * bare id that happens to start with a prefix is read as that prefix.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FOLDER_PREFIX,
  STATION_PREFIX,
  STORY_PREFIX,
  selectedStationOf,
} from "./editor-model.js";

/** A station with free blocks as children (`tourStationChildIds` reads
 *  their ids). */
function station(id: string, childIds: readonly string[]) {
  return {
    id,
    children: childIds.map((childId) => ({ kind: "block", id: childId })),
  } as never;
}

const id = fc.stringMatching(/^[a-z0-9-]{1,12}$/);

describe("the selection's id forms", () => {
  it("are the three prefixes the page and the 3D view share", () => {
    expect([STATION_PREFIX, STORY_PREFIX, FOLDER_PREFIX]).toEqual([
      "station:",
      "story:",
      "folder:",
    ]);
  });

  it("read the station of each form (property)", () => {
    fc.assert(
      fc.property(fc.uniqueArray(id, { minLength: 3, maxLength: 6 }), (ids) => {
        const [stationId, childId, otherId, ...rest] = ids as [
          string,
          string,
          string,
        ];
        const manifest = {
          stations: [station(stationId, [childId, ...rest])],
        };
        // A station by its own id, a gone one not at all.
        expect(
          selectedStationOf(`${STATION_PREFIX}${stationId}`, manifest),
        ).toBe(stationId);
        expect(
          selectedStationOf(`${STATION_PREFIX}${otherId}`, manifest),
        ).toBeNull();
        // A child the station holds, bare or as a story or a folder.
        for (const form of ["", STORY_PREFIX, FOLDER_PREFIX]) {
          expect(selectedStationOf(`${form}${childId}`, manifest)).toBe(
            stationId,
          );
          expect(selectedStationOf(`${form}${otherId}`, manifest)).toBeNull();
        }
        // No selection, or no tour.
        expect(selectedStationOf(null, manifest)).toBeNull();
        expect(selectedStationOf(childId, null)).toBeNull();
      }),
    );
  });

  // The station prefix is only ever a station: a child id behind it is
  // not looked up among the children.
  it("never reads a station-prefixed id as a child", () => {
    const manifest = { stations: [station("s1", ["p1"])] };
    expect(selectedStationOf(`${STATION_PREFIX}p1`, manifest)).toBeNull();
  });

  // The corner of the hand parsing: a child whose own id starts with
  // "story:" is found only through the double prefix, because the bare
  // id loses its first "story:" to the parse.
  it("strips one story or folder prefix from any id, a child's own included", () => {
    const manifest = { stations: [station("s1", ["story:x"])] };
    expect(selectedStationOf("story:x", manifest)).toBeNull();
    expect(selectedStationOf("story:story:x", manifest)).toBe("s1");
  });
});
