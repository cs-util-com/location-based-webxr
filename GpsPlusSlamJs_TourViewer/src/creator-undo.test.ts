import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  UNDO_BUSY,
  UNDO_IDLE,
  settleUndoTarget,
  undoChipText,
  wireCreatorUndo,
  type UndoOffer,
} from "./creator-undo.js";

/**
 * Why these tests matter (W4 build plan MU): the phone's one-step
 * undo of a settle (plan M3b, Q-D) had no button, and the delete's Undo
 * went away after 8 s. The strip's Undo is persistent, so the two things
 * that can go wrong are the ones pinned here: a button that offers a step
 * the document's undo would NOT take back (any later change, or another
 * tour, makes the document's last step a different one), and a label that
 * does not say what the tap takes back.
 */

/** The document as the tracker reads it: where it stands in its history,
 *  its last step's codes and the code book they are checked against. */
function fakeTour() {
  const at = {
    generation: 1,
    revision: 0,
    past: [] as {
      what: string;
      codes?: { id: string; from: string; to: string }[];
    }[],
    future: [] as unknown[],
    codes: { book: [] as { levelId: string; saved: string }[] },
  };
  return {
    at,
    tour: { state: () => at as never },
  };
}

/** The button and its label, as the strip's DOM gives them. */
function fakeDom() {
  let onClick: ((event?: unknown) => void) | null = null;
  return {
    button: {
      disabled: false,
      hidden: false,
      addEventListener: (type: string, fn: (event?: unknown) => void) => {
        if (type === "click") onClick = fn;
      },
    },
    label: { textContent: "" },
    tap: () => onClick?.(),
  };
}

function wired(
  options: { locked?: () => boolean; hidden?: () => boolean } = {},
) {
  const { at, tour } = fakeTour();
  const dom = fakeDom();
  const undo = wireCreatorUndo({
    tour,
    dom,
    locked: options.locked ?? (() => false),
    hidden: options.hidden ?? (() => false),
  });
  return { at, dom, undo };
}

/** An offer that counts its runs and settles as told (null: refused). */
function counted(
  target: string,
  result: Promise<boolean> | null = Promise.resolve(true),
) {
  const runs = { count: 0 };
  const offer: UndoOffer = {
    target,
    run: () => {
      runs.count += 1;
      return result;
    },
  };
  return { offer, runs };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("the Undo chip's words (MU)", () => {
  // Why: the label is the promise - it must say what the tap takes back,
  // and say only "Undo" while there is nothing.
  it("says what the tap takes back, and only Undo with nothing to take back", () => {
    expect(undoChipText('delete "Gate"', false)).toBe('Undo: delete "Gate"');
    expect(undoChipText("the code's improvement", false)).toBe(
      "Undo: the code's improvement",
    );
    expect(undoChipText(null, false)).toBe(UNDO_IDLE);
    expect(UNDO_IDLE).toBe("Undo");
  });

  it("says Undoing… while a tap's draft writes run, whatever it takes back", () => {
    expect(undoChipText('delete "Gate"', true)).toBe(UNDO_BUSY);
    expect(undoChipText(null, true)).toBe(UNDO_BUSY);
  });

  // Why: Q-D's scope is an AUTOMATIC change of a stored code. A settle
  // that only re-minted a code this visit measured (no decision, null) is
  // the measurement being refined, and a creator would not know what an
  // Undo of it means - so it is offered only when an automatic decision
  // is among its codes, and named by it when it changed one code.
  it("names a settle's step by its automatic code change, and offers none without one", () => {
    expect(settleUndoTarget(["improvement"])).toBe("the code's improvement");
    expect(settleUndoTarget(["move"])).toBe("the code's move");
    expect(settleUndoTarget(["improvement", null])).toBe(
      "the 2 codes' new positions",
    );
    expect(settleUndoTarget(["improvement", "move", null])).toBe(
      "the 3 codes' new positions",
    );
    expect(settleUndoTarget([null])).toBeNull();
    expect(settleUndoTarget([null, null])).toBeNull();
    expect(settleUndoTarget([])).toBeNull();
  });
});

describe("the strip's Undo (MU)", () => {
  it("is disabled and says Undo before anything was offered", () => {
    const { dom, undo } = wired();
    undo.render();
    expect(dom.button.disabled).toBe(true);
    expect(dom.label.textContent).toBe("Undo");
    expect(undo.target()).toBeNull();
  });

  it("offers the step while the document stands where the step left it, and names it", () => {
    const { dom, undo } = wired();
    undo.offer(counted('delete "Gate"').offer);
    expect(dom.button.disabled).toBe(false);
    expect(dom.label.textContent).toBe('Undo: delete "Gate"');
    expect(undo.target()).toBe('delete "Gate"');
  });

  // Why: the document's undo takes back its LAST step. Any later change
  // (a placement, an edit) or another tour makes that a different step, so
  // an offer from before must go - or a tap labelled "delete Gate" would
  // take back a pin the creator just placed.
  it("withdraws the offer when the document moved on or another tour opened", () => {
    const { at, dom, undo } = wired();
    undo.offer(counted('delete "Gate"').offer);
    at.revision += 1;
    undo.render();
    expect(dom.button.disabled).toBe(true);
    expect(dom.label.textContent).toBe("Undo");

    undo.offer(counted('delete "Mill"').offer);
    at.generation += 1;
    undo.render();
    expect(dom.button.disabled).toBe(true);
    expect(undo.target()).toBeNull();
  });

  it("takes back exactly the last step offered, once", async () => {
    const { dom, undo } = wired();
    const first = counted('delete "Gate"');
    const last = counted('delete "Mill"');
    undo.offer(first.offer);
    undo.offer(last.offer);
    dom.tap();
    await flush();
    dom.tap();
    await flush();
    expect(first.runs.count).toBe(0);
    expect(last.runs.count).toBe(1);
    // Single level: the step before it is not offered by the tap.
    expect(dom.button.disabled).toBe(true);
    expect(dom.label.textContent).toBe("Undo");
  });

  // Why (the delete Undo's LOW-1, carried over): a change that rendered
  // nothing may land between the render and the tap; the tap checks again.
  it("takes back nothing when the document moved since the button was drawn", () => {
    const { at, dom, undo } = wired();
    const offered = counted('delete "Gate"');
    undo.offer(offered.offer);
    expect(dom.button.disabled).toBe(false);
    at.revision += 1;
    dom.tap();
    expect(offered.runs.count).toBe(0);
    expect(dom.button.disabled).toBe(true);
  });

  // Why: the async-UI rule (root CLAUDE.md) - a tap whose draft writes
  // take time shows that it runs, then its final state, on success and on
  // failure alike; never a button that still offers the step it took back.
  it("shows Undoing… until the tap's writes settle, then Undo, when they landed and when they did not", async () => {
    for (const outcome of [true, false]) {
      let settle: (ok: boolean) => void = () => undefined;
      const writes = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      const { dom, undo } = wired();
      undo.offer(counted('delete "Gate"', writes).offer);
      dom.tap();
      expect(dom.label.textContent).toBe(UNDO_BUSY);
      expect(dom.button.disabled).toBe(true);
      settle(outcome);
      await flush();
      expect(dom.label.textContent).toBe("Undo");
      expect(dom.button.disabled).toBe(true);
    }
  });

  it("goes back to Undo when the writes reject", async () => {
    const { dom, undo } = wired();
    undo.offer(counted('delete "Gate"', Promise.reject(new Error("x"))).offer);
    dom.tap();
    await flush();
    expect(dom.label.textContent).toBe("Undo");
    expect(dom.button.disabled).toBe(true);
  });

  // Why: a run the document refused (a Finish rebuilds, a photo's picture
  // is gone) took nothing back and said why in the note; the chip stays as
  // it was, still offering the step, so the creator can try again.
  it("keeps the offer when the document refused the run, and a later tap runs it again", () => {
    const { dom, undo } = wired();
    const refused = counted('delete "Mill"', null);
    undo.offer(refused.offer);
    dom.tap();
    expect(refused.runs.count).toBe(1);
    expect(dom.label.textContent).toBe('Undo: delete "Mill"');
    expect(dom.button.disabled).toBe(false);
    dom.tap();
    expect(refused.runs.count).toBe(2);
  });

  // Why: a code changes without a step of its own (the code-spot rule's
  // confirmation writes the book, no revision), and the document's undo
  // leaves a code that no longer holds the text the step set. An offer
  // whose step would take back none of the codes it names must go, or the
  // tap restores nothing for the code and still says it did.
  it("withdraws the offer once a code of the last step no longer holds the text the step set", () => {
    const { at, dom, undo } = wired();
    at.past = [
      { what: "the settle", codes: [{ id: "L", from: "new", to: "old" }] },
    ];
    at.codes = { book: [{ levelId: "L", saved: "new" }] };
    undo.offer(counted("the code's move").offer);
    expect(dom.button.disabled).toBe(false);
    at.codes = { book: [{ levelId: "L", saved: "newer" }] };
    undo.render();
    expect(dom.button.disabled).toBe(true);
    expect(dom.label.textContent).toBe("Undo");
    // Gone for good: the code coming back to the text is a new state.
    at.codes = { book: [{ levelId: "L", saved: "new" }] };
    undo.render();
    expect(undo.target()).toBeNull();
  });

  // Why: a failed Finish forgets its visit's settle, which settles again
  // at the visit's end; the settle's offer goes with it (creator-setup.ts),
  // and only that offer - a later one stands.
  it("withdraws an offer by name, and leaves a different standing offer alone", () => {
    const { dom, undo } = wired();
    const settle = counted("the code's move");
    const later = counted('delete "Gate"');
    undo.offer(settle.offer);
    undo.offer(later.offer);
    undo.withdraw(settle.offer);
    expect(dom.label.textContent).toBe('Undo: delete "Gate"');
    undo.withdraw(later.offer);
    expect(dom.button.disabled).toBe(true);
    expect(undo.target()).toBeNull();
  });

  it("an offer made while a tap's writes run is shown once they settle", async () => {
    let settle: (ok: boolean) => void = () => undefined;
    const writes = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const { at, dom, undo } = wired();
    undo.offer(counted('delete "Gate"', writes).offer);
    dom.tap();
    at.revision += 1;
    undo.offer(counted('delete "Mill"').offer);
    expect(dom.label.textContent).toBe(UNDO_BUSY);
    settle(true);
    await flush();
    expect(dom.label.textContent).toBe('Undo: delete "Mill"');
    expect(dom.button.disabled).toBe(false);
  });

  // Why: a Finish rebuilding the zip has read the document; the document
  // refuses an undo then (`canStep`), so the button must not invite one.
  it("is disabled while a Finish rebuilds, and the offer comes back after it", () => {
    const lock = { on: true };
    const { dom, undo } = wired({ locked: () => lock.on });
    const offered = counted('delete "Gate"');
    undo.offer(offered.offer);
    expect(dom.button.disabled).toBe(true);
    expect(dom.label.textContent).toBe('Undo: delete "Gate"');
    dom.tap();
    expect(offered.runs.count).toBe(0);
    lock.on = false;
    undo.render();
    expect(dom.button.disabled).toBe(false);
  });

  // Why: object mode (polish round M3) - a selected object's actions take
  // the strip's place, the Undo with the other chips.
  it("steps aside with the strip in object mode, keeping its offer", () => {
    const selected = { on: true };
    const { dom, undo } = wired({ hidden: () => selected.on });
    undo.offer(counted('delete "Gate"').offer);
    expect(dom.button.hidden).toBe(true);
    selected.on = false;
    undo.render();
    expect(dom.button.hidden).toBe(false);
    expect(dom.button.disabled).toBe(false);
  });

  it("forgets the offer at a reset (a tour closed)", () => {
    const { dom, undo } = wired();
    undo.offer(counted('delete "Gate"').offer);
    undo.reset();
    expect(dom.button.disabled).toBe(true);
    expect(undo.target()).toBeNull();
  });

  // Why: the enablement rule as a property over any order of offers,
  // document changes, opens, taps and refused taps - the button is enabled
  // exactly while the LAST offer still names the document's last step, a
  // tap runs that offer and nothing else, and a refused run keeps it.
  it("is enabled exactly while the last offer names the document's last step, and a tap runs only that offer (property)", async () => {
    type Op = "offer" | "change" | "open" | "tap" | "refused";
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<Op>("offer", "change", "open", "tap", "refused"),
          { maxLength: 30 },
        ),
        async (ops) => {
          const { at, dom, undo } = wired();
          const runs: number[] = [];
          let refusing = false;
          // The model: the runs a correct chip makes, and the offer that
          // still names the document's last step.
          const expectedRuns: number[] = [];
          let model: { id: number; gen: number; rev: number } | null = null;
          const live = () =>
            model !== null &&
            model.gen === at.generation &&
            model.rev === at.revision
              ? model
              : null;
          let next = 0;
          for (const op of ops) {
            if (op === "offer") {
              const id = next;
              next += 1;
              undo.offer({
                target: `step ${String(id)}`,
                run: () => {
                  runs.push(id);
                  return refusing ? null : Promise.resolve(true);
                },
              });
              model = { id, gen: at.generation, rev: at.revision };
            } else if (op === "change") {
              at.revision += 1;
              undo.render();
            } else if (op === "open") {
              at.generation += 1;
              undo.render();
            } else {
              const tapped = live();
              if (tapped !== null) expectedRuns.push(tapped.id);
              refusing = op === "refused";
              dom.tap();
              refusing = false;
              await flush();
              model = op === "refused" ? tapped : null;
            }
            const standing = live();
            expect(runs).toEqual(expectedRuns);
            expect(dom.button.disabled).toBe(standing === null);
            expect(dom.label.textContent).toBe(
              standing === null ? "Undo" : `Undo: step ${String(standing.id)}`,
            );
          }
        },
      ),
    );
  });
});
