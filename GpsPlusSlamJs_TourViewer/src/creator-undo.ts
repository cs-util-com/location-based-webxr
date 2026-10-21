/**
 * The persistent Undo of the creator's AR action strip (owner decision
 * W-D4, Q-J of the debug-captures plan): one chip that takes back the
 * tour document's last step when that step is one the page offered - a
 * delete, or a settle that changed a stored code automatically together
 * with the stations and objects it moved (plan M3b, Q-D: one step).
 *
 * The callers OFFER a step right after taking it (`object-editing.ts` at
 * a delete, `creator-settle.ts` at a settle's commit); the offer stands
 * while the document stays where that step left it (the same open, the
 * same revision), because the document's undo takes back its LAST step.
 * Single level: a tap takes the offered step back and offers nothing
 * further.
 *
 * @see creator-undo.ts.md
 */

import type { CreatorDocument } from "./creator-document.js";
import { NOT_BACKED_UP } from "./object-editing.js";
import type { SettleUndoneLog } from "./tour-authoring-actions.js";
import {
  documentCodes,
  documentObjects,
  type TourDocumentState,
} from "./tour-document.js";

/** The chip with nothing to take back. */
export const UNDO_IDLE = "Undo";
/** The chip while a tap's draft writes run (the async-UI rule). */
export const UNDO_BUSY = "Undoing…";

/** A step the strip can take back. */
export interface UndoOffer {
  /** What a tap takes back, in words: `delete "Gate"`, "the code's
   *  improvement". The chip reads "Undo: " and this. */
  readonly target: string;
  /** Take it back: the document's undo with what follows it (the scene,
   *  the log, the note naming what was undone). Settles once the draft
   *  writes it caused did (true: all landed); null when nothing was taken
   *  back - refused, which the run says in words itself. */
  run(): Promise<boolean> | null;
}

/** The chip's text: what a tap takes back, "Undo" with nothing, and
 *  "Undoing…" while a tap's writes run. */
export function undoChipText(target: string | null, busy: boolean): string {
  if (busy) return UNDO_BUSY;
  return target === null ? UNDO_IDLE : `Undo: ${target}`;
}

/** How a settle changed one code's saved text: an automatic improvement
 *  (`replace`), an automatic move to the poster's new spot, or a move back
 *  to its earlier spot (the code-spot rule's undo); null for a code the
 *  settle only re-minted from this visit's own measurement. */
export type SettleCodeChange = "improvement" | "move" | "move-back" | null;

/**
 * What the strip's Undo names a settle's step by, from the codes whose
 * saved text the step changed (each with how): one code by its change,
 * several by their count. Null - no offer - when no automatic change is
 * among them: Q-D's undo is the one of an automatic code change, and a
 * settle that only refined this visit's own measurement has nothing a
 * creator would recognise as a thing to take back.
 */
export function settleUndoTarget(
  changes: readonly SettleCodeChange[],
): string | null {
  if (!changes.some((c) => c !== null)) return null;
  if (changes.length === 1) {
    const [only] = changes;
    if (only === "move") return "the code's move";
    if (only === "move-back") return "the code's move back";
    return "the code's improvement";
  }
  return `the ${String(changes.length)} codes' new positions`;
}

/** What an undo from `before` to `after` put back: the codes whose saved
 *  text changed, the station frames and the objects that moved (each at
 *  its geo after). */
function wentBack(
  before: TourDocumentState,
  after: TourDocumentState,
): Pick<SettleUndoneLog, "levelIds" | "stations" | "objects"> {
  const savedBefore = new Map(
    documentCodes(before).map((c) => [c.levelId, c.saved]),
  );
  const framesBefore = new Map(
    before.stations.map((s) => [s.id, JSON.stringify(s.geo)]),
  );
  const objectsBefore = new Map(
    documentObjects(before).map((o) => [
      o.object.id,
      JSON.stringify(o.object.geo),
    ]),
  );
  return {
    levelIds: documentCodes(after).flatMap((c) =>
      savedBefore.has(c.levelId) && savedBefore.get(c.levelId) !== c.saved
        ? [c.levelId]
        : [],
    ),
    stations: after.stations.flatMap((s) =>
      framesBefore.has(s.id) && framesBefore.get(s.id) !== JSON.stringify(s.geo)
        ? [{ id: s.id, geo: s.geo }]
        : [],
    ),
    objects: documentObjects(after).flatMap(({ object }) =>
      objectsBefore.has(object.id) &&
      objectsBefore.get(object.id) !== JSON.stringify(object.geo)
        ? [{ id: object.id, geo: object.geo }]
        : [],
    ),
  };
}

/**
 * The strip's tap on a settle's step (Q-D, W-D4): the document's undo,
 * which takes back the codes' texts with the stations and objects the
 * settle moved in ONE step (the hand letting go of the codes it took back
 * is `creator-codes.ts`'s listener). Logged (`tourAuthoring/settleUndone`),
 * then `changed` brings the scene and the readout along, and `say` names
 * what was undone once its draft writes settled. Null when the document
 * refused (a Finish rebuilds) or had nothing to take back - said in words
 * for a refusal.
 */
export function undoSettle(deps: {
  readonly tour: Pick<CreatorDocument, "state" | "undo">;
  /** What the strip named the step (`settleUndoTarget`). */
  readonly target: string;
  /** The visit the tap is made in. */
  readonly visit: number;
  log(payload: SettleUndoneLog): void;
  changed(): void;
  say(text: string): void;
}): Promise<boolean> | null {
  const { tour, target } = deps;
  const before = tour.state();
  const undone = tour.undo();
  if (undone.kind === "nothing") return null;
  if (undone.kind === "refused") {
    deps.say(
      undone.reason === "saving"
        ? "Wait until the zip is rebuilt, then try again."
        : "That could not be undone: a photo it brings back is no longer on this device.",
    );
    return null;
  }
  const back = wentBack(before, tour.state());
  deps.log({
    arVisitIndex: deps.visit,
    atMs: Date.now(),
    what: target,
    ...back,
  });
  deps.changed();
  const what =
    back.levelIds.length > 1
      ? "the codes and everything that moved with them are back where they were."
      : "the code and everything that moved with it are back where they were.";
  return undone.backedUp.then((ok) => {
    deps.say(
      ok
        ? `Undone: ${target} - ${what}`
        : `Undone: ${target}, but ${NOT_BACKED_UP}`,
    );
    return ok;
  });
}

export interface CreatorUndoDom {
  /** The chip (`#setup-undo`). */
  readonly button: Pick<
    HTMLButtonElement,
    "disabled" | "hidden" | "addEventListener"
  >;
  /** Its text (the chip's label span; the icon stays). */
  readonly label: Pick<HTMLElement, "textContent">;
}

export interface CreatorUndo {
  /** A step was just taken: offer it while the document stays where it
   *  left it. Replaces any earlier offer. */
  offer(offer: UndoOffer): void;
  /** What a tap would take back now, or null. */
  target(): string | null;
  /** Bring the chip in line (the readout's render calls it). */
  render(): void;
  /** A tour closed: the offer goes. */
  reset(): void;
}

export function wireCreatorUndo(deps: {
  /** The page's tour document: where it stands in its history. */
  readonly tour: Pick<CreatorDocument, "state">;
  readonly dom: CreatorUndoDom;
  /** A Finish rebuilds the zip: the document refuses an undo meanwhile
   *  (`canStep`), so the chip is disabled. */
  locked(): boolean;
  /** Object mode: the chip steps aside with the strip's other chips. */
  hidden(): boolean;
}): CreatorUndo {
  const { tour, dom } = deps;
  let offered: {
    readonly generation: number;
    readonly revision: number;
    readonly offer: UndoOffer;
  } | null = null;
  /** A tap's draft writes are running. */
  let busy = false;

  /** The offer, while the document stands where its step left it. */
  function current(): UndoOffer | null {
    if (offered === null) return null;
    const { generation, revision } = tour.state();
    if (offered.generation !== generation || offered.revision !== revision) {
      offered = null;
      return null;
    }
    return offered.offer;
  }

  function render(): void {
    const offer = current();
    const text = undoChipText(offer?.target ?? null, busy);
    if (dom.label.textContent !== text) dom.label.textContent = text;
    const disabled = busy || offer === null || deps.locked();
    if (dom.button.disabled !== disabled) dom.button.disabled = disabled;
    const hidden = deps.hidden();
    if (dom.button.hidden !== hidden) dom.button.hidden = hidden;
  }

  dom.button.addEventListener("click", () => {
    if (busy || deps.locked()) return;
    // Checked again at the tap: a change that rendered nothing may have
    // landed since the chip was drawn.
    const offer = current();
    offered = null;
    if (offer === null) {
      render();
      return;
    }
    const writes = offer.run();
    if (writes === null) {
      render();
      return;
    }
    busy = true;
    render();
    void writes
      .catch(() => false)
      .finally(() => {
        busy = false;
        render();
      });
  });

  return {
    offer(offer) {
      const { generation, revision } = tour.state();
      offered = { generation, revision, offer };
      render();
    },
    target: () => current()?.target ?? null,
    render,
    reset() {
      offered = null;
      render();
    },
  };
}
