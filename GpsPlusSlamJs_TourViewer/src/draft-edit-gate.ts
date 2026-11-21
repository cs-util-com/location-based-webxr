/**
 * The edit gate of a page's draft question: while a draft of the open tour
 * is undecided (offered, or put off with "Not now"), every edit of the
 * tour document waits for the creator's answer instead of landing on top
 * of the draft. The page asks at the first waiting edit; Restore and
 * "Delete it" let the waiting edits through after their own change, a
 * put-off drops them.
 *
 * @see draft-edit-gate.ts.md
 */
import { isAnyOf, type Middleware, type UnknownAction } from "@reduxjs/toolkit";

import { isDocumentEdit, tourDocumentActions } from "./tour-document.js";

/** The question's words when an edit waits for it: said after the
 *  offer's own, on both pages. */
export const DRAFT_EDIT_WAITS =
  "Your change waits until you choose: Restore it, or Delete it.";

/** The same in AR, where the offer is out of sight. */
export const DRAFT_EDIT_WAITS_IN_AR =
  "Your change waits: unsaved work for this tour is on this device - leave AR to restore it or delete it.";

/** What a held edit's dispatch returns instead of the action. */
export interface HeldEdit {
  readonly kind: "held";
  /** Resolved once the answer let the edit through, with the root state
   *  just before its own dispatch; null when it was dropped (the question
   *  put off, the tour closed or another opened). */
  readonly landed: Promise<{ readonly before: unknown } | null>;
}

export function isHeldEdit(value: unknown): value is HeldEdit {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "held" &&
    (value as { landed?: unknown }).landed instanceof Promise
  );
}

export interface DraftEditGate {
  /** The store's middleware; installed before the document's listeners,
   *  so a held edit reaches neither the reducer nor the draft. */
  readonly middleware: Middleware;
  /** Edits wait from now on. `ask` runs at the first edit that waits
   *  (again after each `drop`), inside that dispatch: it shows the
   *  question and must not dispatch. */
  hold(ask: () => void): void;
  /** The answer was given: holding stops, and the waiting edits are
   *  dispatched in the order they were made. Their number. */
  release(): number;
  /** The question put off: the waiting edits are dropped, none applied;
   *  still holding, so the next edit asks again. */
  drop(): void;
  /** Whether edits wait (a draft is undecided). */
  holding(): boolean;
  /** Whether an edit is waiting for the answer now. */
  waiting(): boolean;
}

/** The actions that wait: the document's edits, but not the answer's own
 *  restore, and not an undo or a redo (with every edit held there is
 *  nothing of this open to take back). */
const isWaitingEdit = (action: unknown): action is UnknownAction =>
  isDocumentEdit(action) &&
  !isAnyOf(
    tourDocumentActions.restored,
    tourDocumentActions.undone,
    tourDocumentActions.redone,
  )(action);

/** A tour opened or closed: the question of the tour before goes. */
const endsQuestion = isAnyOf(
  tourDocumentActions.opened,
  tourDocumentActions.closed,
);

interface Waiting {
  readonly action: UnknownAction;
  readonly settle: (landed: { readonly before: unknown } | null) => void;
}

export function createDraftEditGate(): DraftEditGate {
  let ask: (() => void) | null = null;
  let waiting: Waiting[] = [];
  let dispatchOne: ((action: UnknownAction) => unknown) | null = null;
  let stateNow: (() => unknown) | null = null;

  function dropAll(): void {
    const dropped = waiting;
    waiting = [];
    for (const w of dropped) w.settle(null);
  }

  const middleware: Middleware = (api) => {
    dispatchOne = (action) => api.dispatch(action);
    stateNow = () => api.getState();
    return (next) => (action) => {
      if (endsQuestion(action)) {
        ask = null;
        dropAll();
        return next(action);
      }
      if (ask === null || !isWaitingEdit(action)) return next(action);
      let settle: Waiting["settle"] = () => undefined;
      const landed = new Promise<{ readonly before: unknown } | null>(
        (resolve) => {
          settle = resolve;
        },
      );
      const first = waiting.length === 0;
      waiting.push({ action, settle });
      if (first) ask();
      const held: HeldEdit = { kind: "held", landed };
      return held;
    };
  };

  return {
    middleware,
    hold(asking) {
      ask = asking;
    },
    release() {
      ask = null;
      const replay = waiting;
      waiting = [];
      for (const w of replay) {
        const before = stateNow?.();
        dispatchOne?.(w.action);
        w.settle({ before });
      }
      return replay.length;
    },
    drop: dropAll,
    holding: () => ask !== null,
    waiting: () => waiting.length > 0,
  };
}
