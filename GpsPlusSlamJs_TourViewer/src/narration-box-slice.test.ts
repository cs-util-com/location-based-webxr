/**
 * Why this test matters: the narration box is not the only reader of the
 * voice's state - the compass's speaking sign and the coming story and
 * quiz steps in the same bottom area read it too. They must see one
 * answer: which text the box shows, whether its voice plays, and where it
 * is. A scrub must not read as speaking, and a hidden box must not read
 * as anything.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  narrationBoxFollowed,
  narrationBoxHidden,
  narrationBoxReducer,
  narrationBoxScrubbing,
  narrationBoxShown,
  selectNarrationBox,
  selectNarrationSpeaking,
  type NarrationBoxState,
} from "./narration-box-slice.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

const at = (s: NarrationBoxState) => ({ narrationBox: s });

describe("narration box slice", () => {
  it("starts hidden and silent", () => {
    const s = narrationBoxReducer(undefined, { type: "init" });
    expect(s).toEqual({
      key: null,
      playing: false,
      scrubbing: false,
      word: -1,
      line: 0,
    });
    expect(selectNarrationSpeaking(at(s))).toBe(false);
  });

  it("speaks while a shown text plays and is not scrubbed", () => {
    let s = narrationBoxReducer(undefined, narrationBoxShown("a"));
    s = narrationBoxReducer(
      s,
      narrationBoxFollowed({ playing: true, word: 4, line: 1 }),
    );
    expect(selectNarrationSpeaking(at(s))).toBe(true);
    expect(selectNarrationBox(at(s))).toMatchObject({ word: 4, line: 1 });
    s = narrationBoxReducer(s, narrationBoxScrubbing(true));
    expect(selectNarrationSpeaking(at(s))).toBe(false);
    s = narrationBoxReducer(s, narrationBoxScrubbing(false));
    expect(selectNarrationSpeaking(at(s))).toBe(true);
  });

  // Why: another text is another voice; its place starts afresh.
  it("starts a new text at its beginning, and keeps the place on a re-show", () => {
    let s = narrationBoxReducer(undefined, narrationBoxShown("a"));
    s = narrationBoxReducer(
      s,
      narrationBoxFollowed({ playing: true, word: 9, line: 3 }),
    );
    expect(narrationBoxReducer(s, narrationBoxShown("a"))).toBe(s);
    expect(narrationBoxReducer(s, narrationBoxShown("b"))).toEqual({
      key: "b",
      playing: false,
      scrubbing: false,
      word: -1,
      line: 0,
    });
  });

  it("forgets everything when hidden (property: any history)", () => {
    const action = fc.oneof(
      fc.string({ maxLength: 3 }).map((k) => narrationBoxShown(k)),
      fc
        .record({
          playing: fc.boolean(),
          word: fc.integer({ min: -1, max: 50 }),
          line: fc.nat(20),
        })
        .map((p) => narrationBoxFollowed(p)),
      fc.boolean().map((b) => narrationBoxScrubbing(b)),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 20 }), (actions) => {
        let s = narrationBoxReducer(undefined, { type: "init" });
        for (const a of actions) s = narrationBoxReducer(s, a);
        s = narrationBoxReducer(s, narrationBoxHidden());
        expect(s.key).toBeNull();
        expect(selectNarrationSpeaking(at(s))).toBe(false);
      }),
    );
  });

  // Why: a follow with nonsense numbers (a NaN from a not yet loaded
  // voice) must not reach the readers.
  it("refuses a follow with a bad place, and any follow while hidden", () => {
    let s = narrationBoxReducer(
      undefined,
      narrationBoxFollowed({ playing: true, word: 3, line: 1 }),
    );
    expect(s.playing).toBe(false);
    s = narrationBoxReducer(s, narrationBoxShown("a"));
    const before = s;
    s = narrationBoxReducer(
      s,
      narrationBoxFollowed({ playing: true, word: Number.NaN, line: 1 }),
    );
    expect(s).toBe(before);
  });

  it("is part of the page's store", () => {
    const store = createTourViewerStore();
    store.dispatch(narrationBoxShown("a"));
    expect(selectNarrationBox(store.getState()).key).toBe("a");
  });
});
