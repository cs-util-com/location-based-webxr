/**
 * Why this test matters: the narration box will not be the only reader of
 * the voice's state - the story's next step and a quiz in the same bottom
 * area will read it too. They must see one answer: which text the box
 * shows, whether its voice plays, and whether a finger holds it. A scrub
 * must not read as speaking, and a hidden box must not read as anything.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  narrationBoxHidden,
  narrationBoxPlaying,
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
    expect(s).toEqual({ key: null, playing: false, scrubbing: false });
    expect(selectNarrationSpeaking(at(s))).toBe(false);
  });

  it("speaks while a shown text plays and is not scrubbed", () => {
    let s = narrationBoxReducer(undefined, narrationBoxShown("a"));
    s = narrationBoxReducer(s, narrationBoxPlaying(true));
    expect(selectNarrationSpeaking(at(s))).toBe(true);
    s = narrationBoxReducer(s, narrationBoxScrubbing(true));
    expect(selectNarrationSpeaking(at(s))).toBe(false);
    s = narrationBoxReducer(s, narrationBoxScrubbing(false));
    expect(selectNarrationSpeaking(at(s))).toBe(true);
    s = narrationBoxReducer(s, narrationBoxPlaying(false));
    expect(selectNarrationSpeaking(at(s))).toBe(false);
  });

  // Why: another text is another voice; it starts silent.
  it("starts a new text silent, and keeps the state on a re-show", () => {
    let s = narrationBoxReducer(undefined, narrationBoxShown("a"));
    s = narrationBoxReducer(s, narrationBoxPlaying(true));
    expect(narrationBoxReducer(s, narrationBoxShown("a"))).toBe(s);
    expect(narrationBoxReducer(s, narrationBoxShown("b"))).toEqual({
      key: "b",
      playing: false,
      scrubbing: false,
    });
  });

  it("forgets everything when hidden (property: any history)", () => {
    const action = fc.oneof(
      fc.string({ maxLength: 3 }).map((k) => narrationBoxShown(k)),
      fc.boolean().map((b) => narrationBoxPlaying(b)),
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

  // Why: a voice that reports late, after its box went, must not make a
  // hidden box read as playing.
  it("ignores playing and scrubbing while hidden", () => {
    let s = narrationBoxReducer(undefined, narrationBoxPlaying(true));
    s = narrationBoxReducer(s, narrationBoxScrubbing(true));
    expect(s).toEqual({ key: null, playing: false, scrubbing: false });
  });

  it("is part of the page's store", () => {
    const store = createTourViewerStore();
    store.dispatch(narrationBoxShown("a"));
    expect(selectNarrationBox(store.getState()).key).toBe("a");
  });
});
