/**
 * Why these tests matter: the editor on the globe shares the mouse and
 * the keys with the globe's camera controls, and the owner decided each
 * overlap by name (2026-10-27). A wrong row is felt at once and is easy to
 * miss in review: a right drag that opens the menu after the turn, a
 * double click on the ground that selects nothing and zooms nothing, an
 * arrow key that does nothing with nothing selected. These pin the table
 * row by row, and the drag threshold over a sweep.
 */
import { describe, expect, it } from "vitest";

import {
  GLOBE_GESTURES,
  routeGlobeInput,
  type GlobeHit,
} from "./globe-gestures.js";

const HITS: readonly GlobeHit[] = ["object", "handle", "ground", "sky"];

describe("routeGlobeInput, the owner's table", () => {
  // Why: on a phone the globe's controls pinch, twist and tilt with two
  // fingers, as in the globe lab; the editor once took two fingers for
  // itself and, having nothing to do with them on the globe, locked the
  // camera still. A second finger is the camera's wherever the first one
  // started: on a handle the drag is cancelled first.
  it("gives two fingers to the camera, wherever the first one started", () => {
    for (const on of HITS) {
      expect(routeGlobeInput({ kind: "fingers", on })).toBe("camera");
    }
  });

  it("rotates on a right drag and opens the menu on a right click", () => {
    for (const on of HITS) {
      expect(routeGlobeInput({ kind: "press", button: "right", on })).toBe(
        "camera",
      );
      expect(
        routeGlobeInput({ kind: "release", button: "right", on, movedPx: 12 }),
      ).toBe("none");
      expect(
        routeGlobeInput({ kind: "release", button: "right", on, movedPx: 2 }),
      ).toBe("menu");
    }
  });

  it("selects an object on a left click and deselects on the ground or the sky", () => {
    const click = (on: GlobeHit) =>
      routeGlobeInput({ kind: "release", button: "left", on, movedPx: 1 });
    expect(click("object")).toBe("select");
    expect(click("ground")).toBe("deselect");
    expect(click("sky")).toBe("deselect");
  });

  // Why: a click also fires after a long drag (measured in the lab), so a
  // pan over an object must not select it on its release.
  it("selects nothing after a left drag", () => {
    for (const on of ["object", "ground", "sky"] as const) {
      expect(
        routeGlobeInput({ kind: "release", button: "left", on, movedPx: 60 }),
      ).toBe("none");
    }
  });

  it("gives a left press on a handle to the gizmo and any other to the camera", () => {
    expect(
      routeGlobeInput({ kind: "press", button: "left", on: "handle" }),
    ).toBe("edit");
    for (const on of ["object", "ground", "sky"] as const) {
      expect(routeGlobeInput({ kind: "press", button: "left", on })).toBe(
        "camera",
      );
    }
    // The gizmo's drag ends as an edit however far it moved.
    for (const movedPx of [0, 3, 60]) {
      expect(
        routeGlobeInput({
          kind: "release",
          button: "left",
          on: "handle",
          movedPx,
        }),
      ).toBe("edit");
    }
  });

  it("flies to an object on a double click and zooms on the ground", () => {
    expect(routeGlobeInput({ kind: "double", on: "object" })).toBe(
      "select-and-fly",
    );
    expect(routeGlobeInput({ kind: "double", on: "ground" })).toBe(
      "camera-zoom",
    );
    expect(routeGlobeInput({ kind: "double", on: "sky" })).toBe("camera-zoom");
    expect(routeGlobeInput({ kind: "double", on: "handle" })).toBe("none");
  });

  it("nudges with a selection and steps the camera without one", () => {
    expect(routeGlobeInput({ kind: "arrow", selected: true })).toBe("nudge");
    expect(routeGlobeInput({ kind: "arrow", selected: false })).toBe(
      "camera-step",
    );
  });
});

describe("routeGlobeInput, the drag threshold", () => {
  it("is 5 px by default: 4.99 is a click, 5 a drag", () => {
    expect(GLOBE_GESTURES.dragPx).toBe(5);
    const right = (movedPx: number) =>
      routeGlobeInput({
        kind: "release",
        button: "right",
        on: "ground",
        movedPx,
      });
    expect(right(4.99)).toBe("menu");
    expect(right(5)).toBe("none");
  });

  // Why: the lab measured 3 to 8 px as the plausible range; the table must
  // keep its meaning at any of them.
  it("splits click from drag at the threshold for every value of a sweep", () => {
    for (const dragPx of [3, 5, 8]) {
      const left = (movedPx: number) =>
        routeGlobeInput(
          { kind: "release", button: "left", on: "object", movedPx },
          dragPx,
        );
      expect(left(dragPx * 0.99)).toBe("select");
      expect(left(dragPx)).toBe("none");
    }
  });

  it("refuses a bad movement or threshold", () => {
    expect(() =>
      routeGlobeInput({
        kind: "release",
        button: "left",
        on: "sky",
        movedPx: NaN,
      }),
    ).toThrow(RangeError);
    expect(() =>
      routeGlobeInput({
        kind: "release",
        button: "left",
        on: "sky",
        movedPx: -1,
      }),
    ).toThrow(RangeError);
    expect(() => routeGlobeInput({ kind: "arrow", selected: true }, 0)).toThrow(
      RangeError,
    );
    expect(() =>
      routeGlobeInput({ kind: "arrow", selected: true }, Infinity),
    ).toThrow(RangeError);
  });
});
