/**
 * Why these tests matter: a click on a card of the 3D view's tree is the
 * editor's main way to get somewhere. One click selects, unfolds and
 * flies; a second click deselects and folds; but the second click of a
 * double click (or a double tap) is not a second click - a creator who
 * double-clicks out of habit must not see the card open and shut again.
 * The interval is the browser's own click count (`detail`) where it
 * reports one, with a time window as the fallback, so both are checked.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  NO_TREE_CLICK,
  TREE_DOUBLE_CLICK_MS,
  treeClick,
  treeClickPlan,
} from "./tree-click.js";

const STATIONS = [
  { id: "a", items: [{ id: "pin-1" }, { id: "photo-1" }] },
  { id: "b", items: [] },
];

describe("treeClick", () => {
  it("selects what is not selected", () => {
    const first = treeClick({
      id: "station:a",
      at: 1000,
      detail: 1,
      selected: null,
      last: NO_TREE_CLICK,
    });
    expect(first.outcome).toBe("select");
    expect(first.memory).toEqual({ id: "station:a", at: 1000 });
  });

  it("deselects the selected one on a second click after the interval", () => {
    const second = treeClick({
      id: "station:a",
      at: 1000 + TREE_DOUBLE_CLICK_MS + 1,
      detail: 1,
      selected: "station:a",
      last: { id: "station:a", at: 1000 },
    });
    expect(second.outcome).toBe("deselect");
  });

  it("does nothing on a second click inside the interval, by time or by the browser's count", () => {
    const byTime = treeClick({
      id: "station:a",
      at: 1000 + TREE_DOUBLE_CLICK_MS - 1,
      detail: 1,
      selected: "station:a",
      last: { id: "station:a", at: 1000 },
    });
    expect(byTime.outcome).toBe("none");
    // The browser counted a double click, whatever the clock says (its
    // count follows the system's double-click setting).
    const byCount = treeClick({
      id: "station:a",
      at: 99_999,
      detail: 2,
      selected: "station:a",
      last: { id: "station:a", at: 1000 },
    });
    expect(byCount.outcome).toBe("none");
  });

  it("selects another card at once, however quick the click", () => {
    const other = treeClick({
      id: "station:b",
      at: 1010,
      detail: 2,
      selected: "station:a",
      last: { id: "station:a", at: 1000 },
    });
    expect(other.outcome).toBe("select");
  });

  it("reads a click with no usable time as a slow one", () => {
    const out = treeClick({
      id: "station:a",
      at: Number.NaN,
      detail: 1,
      selected: "station:a",
      last: { id: "station:a", at: 1000 },
    });
    expect(out.outcome).toBe("deselect");
  });

  // Why: whatever the clicks and their timing, a toggle (deselect) only
  // ever follows a slow click on the selected card, and a click on any
  // other card always selects it.
  it("never toggles inside the interval, for any run of clicks", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.constantFrom("station:a", "station:b", "pin-1"),
            gap: fc.integer({ min: 0, max: 2 * TREE_DOUBLE_CLICK_MS }),
            detail: fc.integer({ min: 1, max: 3 }),
          }),
          { maxLength: 30 },
        ),
        (clicks) => {
          let selected: string | null = null;
          let last = NO_TREE_CLICK;
          let at = 0;
          for (const click of clicks) {
            at += click.gap;
            const rapid =
              click.detail > 1 ||
              (last.id === click.id && at - last.at < TREE_DOUBLE_CLICK_MS);
            const out = treeClick({ ...click, at, selected, last });
            let expected: string = rapid ? "none" : "deselect";
            if (click.id !== selected) expected = "select";
            expect(out.outcome).toBe(expected);
            last = out.memory;
            if (out.outcome === "select") selected = click.id;
            if (out.outcome === "deselect") selected = null;
          }
        },
      ),
    );
  });
});

describe("treeClickPlan", () => {
  it("selects a station, unfolds it and flies there", () => {
    expect(treeClickPlan("select", "station:a", STATIONS)).toEqual({
      select: "station:a",
      unfold: "a",
      fold: null,
      openCodes: false,
      fly: true,
    });
  });

  it("unfolds the station of a selected item", () => {
    expect(treeClickPlan("select", "photo-1", STATIONS)).toMatchObject({
      select: "photo-1",
      unfold: "a",
      fly: true,
    });
  });

  it("opens the codes for a selected code", () => {
    expect(treeClickPlan("select", "level-1", STATIONS)).toEqual({
      select: "level-1",
      unfold: null,
      fold: null,
      openCodes: true,
      fly: true,
    });
  });

  it("deselects and folds a station, the camera staying", () => {
    expect(treeClickPlan("deselect", "station:a", STATIONS)).toEqual({
      select: null,
      unfold: null,
      fold: "a",
      openCodes: false,
      fly: false,
    });
    // An item deselected folds nothing.
    expect(treeClickPlan("deselect", "pin-1", STATIONS)).toMatchObject({
      select: null,
      fold: null,
    });
  });

  it("does nothing for a click that does not toggle", () => {
    expect(treeClickPlan("none", "station:a", STATIONS)).toBeNull();
  });
});
