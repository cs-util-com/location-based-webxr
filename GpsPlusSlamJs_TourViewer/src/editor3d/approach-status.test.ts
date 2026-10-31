/**
 * Why these tests matter: the line under the approach's bar is the only
 * thing that tells a creator what the empty-looking scene is waiting for,
 * and the owner limited it to three plain wordings. These pin the
 * wordings, their order, that the line goes once nothing is waiting, and
 * that its hold keeps it readable.
 *
 * Parameter: the hold (`LINE_HOLD_MS`, declared 600 ms: about two reading
 * fixations of a two-word line). The flicker check is swept over holds of
 * 0, 300, 600 and 1200 ms: the number of changes in a 3 s burst of
 * alternating wishes must stay within 3 s / hold + 1 at every value.
 */
import { describe, expect, it } from "vitest";

import {
  APPROACH_LINES,
  approachLine,
  createLineHold,
  LINE_HOLD_MS,
} from "./approach-status.js";

const none = { tour: 0, textures: 0, buildings: 0 };

describe("approachLine", () => {
  it("names the tour first, then the textures, then the buildings", () => {
    // Why: the stations are what the creator came for, so their loading
    // is named over the ground's.
    expect(approachLine({ tour: 1, textures: 4, buildings: 2 }, true)).toBe(
      APPROACH_LINES.tour,
    );
    expect(approachLine({ tour: 0, textures: 4, buildings: 2 }, true)).toBe(
      APPROACH_LINES.textures,
    );
    expect(approachLine({ tour: 0, textures: 0, buildings: 2 }, false)).toBe(
      APPROACH_LINES.buildings,
    );
  });

  it("says Loading tour while flying with nothing named, and goes after", () => {
    // Why: the bar is never shown wordless during the flight, and after
    // the landing a line that stays with nothing loading would be a lie.
    expect(approachLine(none, true)).toBe(APPROACH_LINES.tour);
    expect(approachLine(none, false)).toBeNull();
  });

  it("reads a count that is not a positive number as nothing waiting", () => {
    // Why: a stats source that is not up yet reports NaN or -1; that
    // must not hold the line forever.
    expect(
      approachLine({ tour: Number.NaN, textures: -1, buildings: 0 }, false),
    ).toBeNull();
  });

  it("never names an internal concept", () => {
    // Why: the owner's rule - no tiles, LOD, OSM or workers in the text.
    for (const line of Object.values(APPROACH_LINES)) {
      expect(line).not.toMatch(/tile|lod|osm|worker|mesh|relief/i);
    }
  });
});

describe("createLineHold", () => {
  it("shows the first wording at once and holds each for the hold", () => {
    // Why: the first words must not wait; a change inside the hold must.
    const hold = createLineHold(600);
    expect(hold.step(0, APPROACH_LINES.tour)).toBe(APPROACH_LINES.tour);
    expect(hold.step(100, APPROACH_LINES.textures)).toBe(APPROACH_LINES.tour);
    expect(hold.step(599, APPROACH_LINES.textures)).toBe(APPROACH_LINES.tour);
    expect(hold.step(600, APPROACH_LINES.textures)).toBe(
      APPROACH_LINES.textures,
    );
    expect(hold.step(1300, null)).toBeNull();
    expect(hold.shown).toBeNull();
  });

  it.each([0, 300, LINE_HOLD_MS, 1200])(
    "changes at most once per hold (%i ms) under alternating wishes",
    (holdMs) => {
      const hold = createLineHold(holdMs);
      let changes = 0;
      let last: string | null = null;
      for (let t = 0; t <= 3000; t += 16) {
        const wanted =
          Math.floor(t / 48) % 2 === 0
            ? APPROACH_LINES.tour
            : APPROACH_LINES.textures;
        const shown = hold.step(t, wanted);
        if (shown !== last) changes++;
        last = shown;
      }
      const bound = holdMs === 0 ? Infinity : 3000 / holdMs + 1;
      expect(changes).toBeLessThanOrEqual(bound);
      expect(changes).toBeGreaterThan(0);
    },
  );

  it("refuses a hold that is not a number >= 0", () => {
    // Why: a NaN hold would freeze the line on its first words.
    expect(() => createLineHold(Number.NaN)).toThrow(RangeError);
    expect(() => createLineHold(-1)).toThrow(RangeError);
  });
});
