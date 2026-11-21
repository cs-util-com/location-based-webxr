import { describe, expect, it, vi } from "vitest";

import { CUT_CHOICE_DEFAULTS, freshDraft } from "./maker-draft.js";
import {
  createMakerStore,
  hasCut,
  isCutting,
  makerActions as A,
  makerReducer,
  makerStateFrom,
  type MakerState,
} from "./maker-slice.js";

const fresh = (): MakerState => makerStateFrom(null);
type Action = Parameters<typeof makerReducer>[1];
const run = (s: MakerState, ...actions: Action[]): MakerState =>
  actions.reduce((acc, a) => makerReducer(acc, a), s);
const ready = (): MakerState => run(fresh(), A.cutStarted(), A.cutFinished());

describe("maker-slice", () => {
  // Why: a reload brings back the stored draft, but never the cut picture
  // (it is not stored), and a draft that was saved already starts a new
  // character with the backdrop kept. These are the page's boot rules.
  it("reads the stored draft back as the page starts", () => {
    expect(fresh()).toEqual({ draft: freshDraft(), cut: "none", version: 0 });
    const back = makerStateFrom({ step: 5, maxStep: 3, desc: "a fox" });
    expect(back.draft).toMatchObject({ step: 3, maxStep: 3, desc: "a fox" });
    expect(back.cut).toBe("none");
    const saved = makerStateFrom({
      step: 5,
      desc: "a fox",
      savedId: "c1",
      ground: "snow",
    });
    expect(saved.draft).toEqual({ ...freshDraft(), ground: "snow" });
    expect(makerStateFrom("garbage").draft).toEqual(freshDraft());
  });

  // Why: steps 0 to 3 open once reached, 4 and 5 only with a cut; a tap on
  // a closed step, or a step that does not exist, changes nothing.
  it("goes only to a step that is open", () => {
    const s = fresh();
    expect(run(s, A.went(2))).toBe(s);
    expect(run(s, A.went(4))).toBe(s);
    expect(run(s, A.went(9))).toBe(s);
    expect(run(s, A.went(1.5))).toBe(s);
    expect(run(s, A.went(3)).draft).toMatchObject({ step: 3, maxStep: 3 });
    const cut = run(ready(), A.went(5));
    expect(cut.draft.step).toBe(5);
    expect(cut.draft.maxStep).toBe(3);
  });

  // Why: the Next button and coming back from the image AI move the author
  // on by reaching a step, which opens it first.
  it("reaches the next step, which opens it", () => {
    const s = run(fresh(), A.reached(1), A.reached(2));
    expect(s.draft).toMatchObject({ step: 2, maxStep: 2 });
    expect(run(s, A.went(0), A.went(2)).draft.step).toBe(2);
    // Step 4 needs a cut: reaching it opens up to step 3 but stays put.
    expect(run(fresh(), A.reached(4)).draft).toMatchObject({
      step: 0,
      maxStep: 3,
    });
  });

  // Why: a new description makes an earlier copy of the prompt stale, so
  // the copy step is open again; the same text again keeps the copy.
  it("forgets the copy when the description changes", () => {
    const s = run(fresh(), A.descChanged("a fox"), A.copied(5));
    expect(s.draft.copiedAt).toBe(5);
    expect(run(s, A.descChanged("a fox"))).toBe(s);
    expect(run(s, A.descChanged("a cat")).draft).toMatchObject({
      desc: "a cat",
      copiedAt: 0,
    });
    expect(run(s, A.copyRefused()).draft.copiedAt).toBe(0);
    expect(run(s, A.copied(Number.NaN))).toBe(s);
  });

  // Why: a picture brought back starts a fresh cut at step 4: an earlier
  // failure, a talk style and a saved id belong to the old picture. While
  // it cuts, a second picture is not taken.
  it("runs a cut from start to finish", () => {
    const s0 = run(
      fresh(),
      A.talkChosen("steady"),
      A.saved({ id: "c1", name: "Pip" }),
      A.cutFailed("Only three poses"),
    );
    const s = run(s0, A.cutStarted());
    expect(isCutting(s)).toBe(true);
    expect(s.draft).toMatchObject({
      step: 3,
      maxStep: 3,
      failure: "",
      choice: "drawn",
      savedId: "",
    });
    expect(run(s, A.cutStarted())).toBe(s);
    const done = run(s, A.cutFinished());
    expect(hasCut(done)).toBe(true);
    expect(done.version).toBe(s.version + 1);
    const failed = run(s, A.cutFailed("Only three poses"));
    expect(failed.cut).toBe("none");
    expect(failed.draft.failure).toBe("Only three poses");
    expect(run(s, A.cutAborted()).cut).toBe("none");
  });

  // Why: the previews redraw when the version moves: a re-cut and a talk
  // style change move it; a re-cut without a cut does nothing.
  it("moves the version on a re-cut and a talk style", () => {
    const s = ready();
    expect(run(s, A.cutReplaced()).version).toBe(s.version + 1);
    expect(run(fresh(), A.cutReplaced())).toEqual(fresh());
    const steady = run(s, A.talkChosen("steady"));
    expect(steady.draft.choice).toBe("steady");
    expect(steady.version).toBe(s.version + 1);
    expect(run(s, A.talkChosen("wobbly" as "steady"))).toBe(s);
  });

  // Why: the cut sliders arrive from page inputs; a value outside a
  // slider's range takes its default rather than reaching the cut.
  it("keeps the cut settings inside their ranges", () => {
    const s = run(
      fresh(),
      A.cutChanged({ ...CUT_CHOICE_DEFAULTS, whiteTol: 40, islandMin: 9999 }),
    );
    expect(s.draft.cut).toEqual({ ...CUT_CHOICE_DEFAULTS, whiteTol: 40 });
    expect(run(s, A.cutReset()).draft.cut).toEqual(CUT_CHOICE_DEFAULTS);
    expect(run(s, A.groundChosen("snow")).draft.ground).toBe("snow");
    expect(run(s, A.groundChosen("mars" as "snow"))).toBe(s);
  });

  // Why: "Make another", "Start over" and "Discard" start a new character
  // with the backdrop kept, and their Undo brings the old one back with its
  // cut. A cut still running keeps running through both.
  it("starts another and undoes it", () => {
    const before = run(
      ready(),
      A.groundChosen("city"),
      A.descChanged("a fox"),
      A.went(4),
    );
    const another = run(before, A.startedAnother());
    expect(another.draft).toEqual({ ...freshDraft(), ground: "city" });
    expect(another.cut).toBe("none");
    const back = run(
      another,
      A.restored({ draft: before.draft, hadCut: true }),
    );
    expect(back.draft).toEqual(before.draft);
    expect(back.cut).toBe("ready");
    const cutting = run(fresh(), A.cutStarted());
    expect(run(cutting, A.startedAnother()).cut).toBe("cutting");
    expect(
      run(cutting, A.restored({ draft: before.draft, hadCut: true })).cut,
    ).toBe("cutting");
    expect(
      run(another, A.restored({ draft: { step: 99 } as never, hadCut: false }))
        .draft,
    ).toEqual(freshDraft());
  });

  // Why: the name, the save and the time the author left are what the
  // library row and the welcome-back offer read.
  it("keeps the name, the save and the time the author left", () => {
    const s = run(
      fresh(),
      A.named("Pip"),
      A.saved({ id: "c1", name: "Pip" }),
      A.left(42),
    );
    expect(s.draft).toMatchObject({
      name: "Pip",
      savedId: "c1",
      savedName: "Pip",
      leftAt: 42,
    });
  });

  // Why: the draft is kept in local storage by a listener, so every change
  // of the draft is written once, and an action that changes only the cut
  // status writes nothing; a write that throws (private mode) does not
  // break the page.
  it("writes the draft whenever it changes", () => {
    const save = vi.fn();
    const store = createMakerStore({ stored: null, save });
    store.dispatch(A.descChanged("a fox"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ desc: "a fox" }),
    );
    store.dispatch(A.descChanged("a fox"));
    store.dispatch(A.cutReplaced());
    expect(save).toHaveBeenCalledTimes(1);
    store.dispatch(A.cutStarted());
    store.dispatch(A.cutFinished());
    expect(save).toHaveBeenCalledTimes(2);
    const throwing = createMakerStore({
      stored: null,
      save: () => {
        throw new Error("private mode");
      },
    });
    expect(() => throwing.dispatch(A.named("Pip"))).not.toThrow();
    expect(throwing.getState().characterMaker.draft.name).toBe("Pip");
  });
});
