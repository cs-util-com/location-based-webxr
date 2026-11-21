/**
 * The setup's start answer in the page's store.
 *
 * Why these tests matter: the answer is read by more than one view (step
 * 2's panel and the host tiles, which offer no starter for "share"), so it
 * lives in the store, and the reducer is the one place that decides what
 * an answer may be. A value it does not know (a stale or mistyped
 * dispatch) must change nothing rather than leave a panel nobody draws.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  selectStartPanel,
  START_ANSWERS,
  type StartPanel,
  startPanelShown,
  startQuestionReducer,
} from "./start-question-slice.js";

const initial = startQuestionReducer(undefined, { type: "@@init" });

describe("startQuestion slice", () => {
  it("starts with no answer", () => {
    expect(selectStartPanel({ startQuestion: initial })).toBeNull();
  });

  it("holds the last panel shown, whatever came before (property)", () => {
    const panel = fc.constantFrom<StartPanel>(...START_ANSWERS, "share");
    fc.assert(
      fc.property(fc.array(panel, { minLength: 1 }), (panels) => {
        const state = panels.reduce(
          (s, p) => startQuestionReducer(s, startPanelShown(p)),
          initial,
        );
        expect(selectStartPanel({ startQuestion: state })).toBe(panels.at(-1));
      }),
    );
  });

  it("ignores a panel it does not know", () => {
    const shown = startQuestionReducer(initial, startPanelShown("link"));
    const after = startQuestionReducer(
      shown,
      startPanelShown("upload" as StartPanel),
    );
    expect(after).toBe(shown);
  });
});
