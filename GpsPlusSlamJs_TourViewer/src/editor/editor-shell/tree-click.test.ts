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

  it("does nothing on a quick second click on the card it just deselected", () => {
    // Why: a double click on the selected card deselected it on
    // the first click and selected it again - and flew - on the second.
    const first = treeClick({
      id: "station:a",
      at: 5000,
      detail: 1,
      selected: "station:a",
      last: { id: "station:a", at: 1000 },
    });
    expect(first.outcome).toBe("deselect");
    const second = treeClick({
      id: "station:a",
      at: 5100,
      detail: 2,
      selected: null,
      last: first.memory,
    });
    expect(second.outcome).toBe("none");
  });

  // The rule, stated apart from the code: what a click does by whether its
  // card is selected, whether the click before was on the same card, and
  // whether it came inside the double-click interval (by the clock, or by
  // the browser's count). Only the first click of a quick run on one card
  // counts.
  const RULE: Readonly<
    Record<`${"sel" | "unsel"}/${"same" | "other"}/${"quick" | "slow"}`, string>
  > = {
    "unsel/other/quick": "select",
    "unsel/other/slow": "select",
    "unsel/same/quick": "none",
    "unsel/same/slow": "select",
    "sel/other/quick": "deselect",
    "sel/other/slow": "deselect",
    "sel/same/quick": "none",
    "sel/same/slow": "deselect",
  };

  // Why: any run of clicks, with any timing and click counts, follows the
  // table - in particular no quick run on one card ever toggles it.
  it("follows the rule's table for any run of clicks", () => {
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
          let previous: { id: string; at: number } | null = null;
          let at = 0;
          for (const click of clicks) {
            at += click.gap;
            const same = previous?.id === click.id;
            const quick =
              same &&
              (click.detail > 1 ||
                at - (previous?.at ?? 0) < TREE_DOUBLE_CLICK_MS);
            const key =
              `${click.id === selected ? "sel" : "unsel"}/${same ? "same" : "other"}/${quick ? "quick" : "slow"}` as const;
            const out = treeClick({ ...click, at, selected, last });
            expect(out.outcome).toBe(RULE[key]);
            last = out.memory;
            previous = { id: click.id, at };
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
