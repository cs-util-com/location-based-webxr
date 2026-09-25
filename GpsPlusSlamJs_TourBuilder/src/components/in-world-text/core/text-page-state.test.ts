import { describe, expect, it } from "vitest";

import {
  canNext,
  canPrev,
  initialTextPageState,
  pageLabel,
  textPageReducer,
  type TextPageState,
} from "./text-page-state.js";

const at = (pageIndex: number, pageCount: number): TextPageState => ({
  pageIndex,
  pageCount,
});

describe("textPageReducer", () => {
  it("advances and clamps at the last page", () => {
    expect(textPageReducer(at(0, 3), { type: "next" })).toEqual(at(1, 3));
    expect(textPageReducer(at(2, 3), { type: "next" })).toEqual(at(2, 3));
  });

  it("retreats and clamps at the first page", () => {
    expect(textPageReducer(at(1, 3), { type: "prev" })).toEqual(at(0, 3));
    expect(textPageReducer(at(0, 3), { type: "prev" })).toEqual(at(0, 3));
  });

  it("setText resets to page 0 and takes the new count (clamped to >= 1)", () => {
    expect(
      textPageReducer(at(2, 3), { type: "setText", pageCount: 5 }),
    ).toEqual(at(0, 5));
    expect(
      textPageReducer(at(2, 3), { type: "setText", pageCount: 0 }),
    ).toEqual(at(0, 1));
  });
});

describe("initialTextPageState", () => {
  it("starts on page 0 with at least one page", () => {
    expect(initialTextPageState(4)).toEqual(at(0, 4));
    expect(initialTextPageState(0)).toEqual(at(0, 1));
  });
});

describe("selectors", () => {
  it("canPrev / canNext reflect the edges", () => {
    expect(canPrev(at(0, 3))).toBe(false);
    expect(canPrev(at(1, 3))).toBe(true);
    expect(canNext(at(2, 3))).toBe(false);
    expect(canNext(at(1, 3))).toBe(true);
  });

  it("pageLabel is 1-based", () => {
    expect(pageLabel(at(0, 5))).toBe("1 / 5");
    expect(pageLabel(at(4, 5))).toBe("5 / 5");
  });
});
