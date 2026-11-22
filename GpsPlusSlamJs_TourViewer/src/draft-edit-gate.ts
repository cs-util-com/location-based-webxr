/**
 * The edit gate of a page's draft question: while a draft of the open tour
 * is undecided (offered, or put off with "Not now"), every edit of the
 * tour document waits for the creator's answer instead of landing on top
 * of the draft. The page asks at the first waiting edit. "Delete it" lets
 * the waiting edits through after its own change; Restore and a put-off
 * drop them (a waiting edit was built from the document before the draft
 * came back, so replaying it after a Restore would write its old values
 * over the draft's).
 *
 * @see draft-edit-gate.ts.md
 */
import type { Middleware, UnknownAction } from "@reduxjs/toolkit";
import { isAnyOf } from "@reduxjs/toolkit";

import { tourDocumentActions } from "./tour-document.js";
import { tourDraftActions } from "./tour-draft-slice.js";

/** The question's words when an edit waits for it: said after the
 *  offer's own, on both pages. */
export const DRAFT_EDIT_WAITS =
  "Your change waits for this choice. Delete it: the earlier work goes, and your change is applied. Restore: the earlier work comes back, without your change. Not now: your change is cancelled.";

/** The same in AR, where the offer is out of sight (a tour a scan opened
 *  while AR runs: the start of AR asks first otherwise). */
export const DRAFT_EDIT_WAITS_IN_AR =
  "Your change waits: unsaved work for this tour is on this device. Leave AR to choose - Delete it applies your change, Restore brings the earlier work back and drops what you made in AR.";

/** Said after "Not now" dropped a waiting edit. */
export const DRAFT_EDIT_NOT_APPLIED = "Your change was not applied.";

/** Said after Restore, when an edit waited: it was dropped. */
export const DRAFT_EDIT_MAKE_AGAIN =
  "Your last change was not applied - make it again.";

/** `DRAFT_EDIT_MAKE_AGAIN` for `dropped` edits (more than one: plural). */
export function draftEditsMakeAgain(dropped: number): string {
  return dropped > 1
    ? "Your last changes were not applied - make them again."
    : DRAFT_EDIT_MAKE_AGAIN;
}

/** "Delete it"'s label while it runs, on both pages. */
export const DRAFT_DELETING = "Deleting...";

/** Said while an edit waits for a draft still being read. */
export const DRAFT_BEING_READ = "Reading saved work for this tour...";

/** What a held edit's dispatch returns instead of the action. */
export interface HeldEdit {
  readonly kind: "held";
  /** Resolved once the answer let the edit through, with the root state
   *  just before its own dispatch; null when it was dropped (Restore, the
   *  question put off, the tour closed or another opened). */
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
   *  (again after each `drop`), inside that dispatch, after the count
   *  of waiting edits reached the store: it shows the question and must
   *  not dispatch an edit of the document. */
  hold(ask: () => void): void;
  /** Holding stops, and the waiting edits are dispatched in the order
   *  they were made ("Delete it"). Their number. */
  release(): number;
  /** The waiting edits are dropped, none applied (Restore, "Not now");
   *  still holding, so the next edit asks again. Their number. */
  drop(): number;
  /** Whether edits wait (a draft is undecided). */
  holding(): boolean;
  /** Whether an edit is waiting for the answer now. */
  waiting(): boolean;
}

/** The document's actions that do NOT wait, each for its reason; every
 *  other `tourDocument/*` action does (a denylist, so an action added
 *  later waits by default; `draft-edit-gate.test.ts` fails on one nobody
 *  classified). */
export const DRAFT_GATE_PASSES: ReadonlySet<string> = new Set(
  [
    // A tour opened or closed: they end the question.
    tourDocumentActions.opened,
    tourDocumentActions.closed,
    // The answer's own change.
    tourDocumentActions.restored,
    // Nothing of this open is in the history while the draft is
    // undecided, so these change nothing then (pinned in the suite).
    tourDocumentActions.undone,
    tourDocumentActions.redone,
    // The file's save: what it writes is the document, never the draft.
    tourDocumentActions.saveStarted,
    tourDocumentActions.saved,
    tourDocumentActions.saveEnded,
    tourDocumentActions.saveClaimed,
    tourDocumentActions.saveReleased,
    tourDocumentActions.saveProgressed,
    tourDocumentActions.saveQueued,
    tourDocumentActions.saveBuilt,
    tourDocumentActions.saveDelivered,
    tourDocumentActions.saveLimited,
    tourDocumentActions.finishWaitsChanged,
    // A switch of the page's next placement, not work.
    tourDocumentActions.newStationArmed,
    // Files listed before the edit that names them; their bytes are this
    // page's own files, which "Delete it" keeps (`editor-draft.ts`).
    tourDocumentActions.assetsAdded,
    // The codes and their levels: not gated, their record re-states the
    // waiting draft's (`creator-draft.ts`).
    tourDocumentActions.codeTaken,
    tourDocumentActions.codeTakenFromDraft,
    tourDocumentActions.codeLetGo,
    tourDocumentActions.codeMeasurementDropped,
    tourDocumentActions.codeSaved,
    tourDocumentActions.codesRestored,
    tourDocumentActions.codesFinished,
    tourDocumentActions.handReleased,
    tourDocumentActions.codesForgotten,
    tourDocumentActions.levelsArrived,
    tourDocumentActions.levelsUnreadable,
    tourDocumentActions.levelsCleared,
    tourDocumentActions.levelsParsed,
  ].map((a) => a.type),
);

const DOCUMENT_PREFIX = "tourDocument/";

/** Whether `action` waits while a draft is undecided: a document action
 *  not named in `DRAFT_GATE_PASSES`. */
export function waitsForTheDraft(action: unknown): action is UnknownAction {
  if (typeof action !== "object" || action === null) return false;
  const type = (action as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    type.startsWith(DOCUMENT_PREFIX) &&
    !DRAFT_GATE_PASSES.has(type)
  );
}

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

  /** The count in the store's draft question (`tourDraft`): the pages
   *  say an edit waits from there. The held actions and their promises
   *  stay here - resources, not state. */
  function report(): void {
    dispatchOne?.(
      tourDraftActions.editsWaitingChanged({ count: waiting.length }),
    );
  }

  function dropAll(): number {
    const dropped = waiting;
    waiting = [];
    for (const w of dropped) w.settle(null);
    if (dropped.length > 0) report();
    return dropped.length;
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
      if (ask === null || !waitsForTheDraft(action)) return next(action);
      let settle: Waiting["settle"] = () => undefined;
      const landed = new Promise<{ readonly before: unknown } | null>(
        (resolve) => {
          settle = resolve;
        },
      );
      const first = waiting.length === 0;
      waiting.push({ action, settle });
      report();
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
      if (replay.length > 0) report();
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
