/**
 * Why these tests matter: the bottom bar's power actions are what the
 * inspector does not offer - a copy, a turn to face the station's way, the
 * position as text - and which of them a selection gets is a rule (a code
 * is read-only here, so it is never copied or turned). The copied text is
 * what a creator pastes into a note or a message to place something
 * again, so its numbers must be the ones the inspector shows.
 */
import { describe, expect, it } from "vitest";

import { ALIGNED_DEG, barActions, positionText } from "./bar-actions.js";
import type { InspectorModel } from "./inspector-model.js";

const station: InspectorModel = {
  kind: "station",
  title: "Gate",
  sub: "Station 1 of 2",
  place: { number: 1, count: 2 },
  description: null,
  imagePath: null,
  foundRadiusM: 25,
  activateRadiusM: 50,
  position: { eastM: 12.345, northM: -4.1, altM: 340.256, headingDeg: 90.4 },
  locked: true,
};

const item: InspectorModel = {
  kind: "item",
  itemKind: "pin",
  title: "Hello",
  sub: "Pin in Gate",
  sizeM: null,
  offset: { northM: 2, upM: 0.5, eastM: -1.25 },
  headingDeg: 15,
};

const code: InspectorModel = {
  kind: "code",
  title: "Code 1",
  sub: "On the gate",
  printSizeM: 0.2,
  position: { eastM: 0, northM: 0, altM: 339, headingDeg: null },
};

describe("barActions", () => {
  it("gives a station Duplicate and Copy position, an item Align to station too", () => {
    expect(barActions(station).map((a) => a.action)).toEqual([
      "duplicate",
      "copy",
    ]);
    expect(barActions(item).map((a) => a.action)).toEqual([
      "duplicate",
      "align",
      "copy",
    ]);
  });

  it("gives a code, read-only here, its position only, and nothing without a selection", () => {
    expect(barActions(code).map((a) => a.action)).toEqual(["copy"]);
    expect(barActions(null)).toEqual([]);
  });

  it("says each action in words, with its key where it has one", () => {
    expect(barActions(item)).toEqual([
      {
        action: "duplicate",
        label: "Duplicate",
        title: "Duplicate the selection (Ctrl+D)",
      },
      {
        action: "align",
        label: "Align to station",
        title: "Turn it to face the way its station faces",
      },
      {
        action: "copy",
        label: "Copy position",
        title: "Copy the position and heading as text",
      },
    ]);
  });

  it("offers no copy of a position the file does not give", () => {
    expect(
      barActions({ ...code, position: null }).map((a) => a.action),
    ).toEqual([]);
    expect(
      barActions({ ...station, position: null }).map((a) => a.action),
    ).toEqual(["duplicate"]);
  });
});

describe("positionText", () => {
  it("says a station's or a code's place as the inspector does: east, north, height, heading", () => {
    expect(positionText(station)).toBe(
      "E 12.35 m, N -4.10 m, height 340.26 m, heading 90 deg",
    );
    expect(positionText(code)).toBe(
      "E 0.00 m, N 0.00 m, height 339.00 m, no heading",
    );
  });

  it("says an item's place in its station's frame", () => {
    expect(positionText(item)).toBe(
      "2.00 m north, -1.25 m east, 0.50 m up of its station, heading 15 deg",
    );
    expect(positionText({ ...item, headingDeg: null })).toBe(
      "2.00 m north, -1.25 m east, 0.50 m up of its station, no heading",
    );
  });

  it("has nothing to say for no selection or no position, and never says -0", () => {
    expect(positionText(null)).toBeNull();
    expect(positionText({ ...code, position: null })).toBeNull();
    expect(
      positionText({
        ...station,
        position: { eastM: -0.001, northM: 0, altM: 1, headingDeg: 359.7 },
      }),
    ).toBe("E 0.00 m, N 0.00 m, height 1.00 m, heading 0 deg");
  });
});

describe("ALIGNED_DEG", () => {
  // Why: an item a hair off its station's way is aligned for the eye; a
  // turn of a tenth of a degree would only add an undo step.
  it("is half a degree", () => {
    expect(ALIGNED_DEG).toBe(0.5);
  });
});
