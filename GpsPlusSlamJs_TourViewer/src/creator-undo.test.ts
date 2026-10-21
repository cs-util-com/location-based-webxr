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
 * Why these tests matter (owner decision W-D4, Q-J): the phone's one-step
 * undo of a settle (plan M3b, Q-D) had no button, and the delete's Undo
 * went away after 8 s. The strip's Undo is persistent, so the two things
 * that can go wrong are the ones pinned here: a button that offers a step
 * the document's undo would NOT take back (any later change, or another
 * tour, makes the document's last step a different one), and a label that
 * does not say what the tap takes back.
 */

/** The document as the tracker reads it: where it stands in its history. */
function fakeTour() {
  const at = { generation: 1, revision: 0 };
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

/** An offer that counts its runs and settles as told. */
function counted(target: string, result: Promise<boolean> | null = null) {
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

describe("the Undo chip's words (W-D4)", () => {
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
    expect(settleUndoTarget(["move-back"])).toBe("the code's move back");
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

describe("the strip's Undo (W-D4)", () => {
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

  it("takes back exactly the last step offered, once", () => {
    const { dom, undo } = wired();
    const first = counted('delete "Gate"');
    const last = counted('delete "Mill"');
    undo.offer(first.offer);
    undo.offer(last.offer);
    dom.tap();
    dom.tap();
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

  it("goes back to Undo when the writes reject, and when a run took nothing back", async () => {
    const { dom, undo } = wired();
    undo.offer(counted('delete "Gate"', Promise.reject(new Error("x"))).offer);
    dom.tap();
    await flush();
    expect(dom.label.textContent).toBe("Undo");

    undo.offer(counted('delete "Mill"', null).offer);
    dom.tap();
    expect(dom.label.textContent).toBe("Undo");
    expect(dom.button.disabled).toBe(true);
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
  // document changes, opens and taps - the button is enabled exactly while
  // the LAST offer still names the document's last step, and a tap runs
  // that offer and nothing else.
  it("is enabled exactly while the last offer names the document's last step, and a tap runs only that offer (property)", () => {
    type Op = "offer" | "change" | "open" | "tap";
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Op>("offer", "change", "open", "tap"), {
          maxLength: 30,
        }),
        (ops) => {
          const { at, dom, undo } = wired();
          const runs: number[] = [];
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
                  return null;
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
              dom.tap();
              model = null;
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
