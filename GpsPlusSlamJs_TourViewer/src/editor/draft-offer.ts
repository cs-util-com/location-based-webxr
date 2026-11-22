/**
 * The desktop editor's draft offer: what its three answers do, apart from
 * the toast that shows them (`edit-main.ts` renders the view). Its status
 * is the store's draft question (`tour-draft-slice.ts`), shared with the
 * phone page, and the view is drawn from that slice's selectors. While the
 * draft is undecided every edit waits in the store's draft gate
 * (`draft-edit-gate.ts`); the first one shows the offer again.
 *
 * @see draft-offer.ts.md
 */
import type { UnknownAction } from "@reduxjs/toolkit";

import {
  DRAFT_EDIT_NOT_APPLIED,
  DRAFT_EDIT_WAITS,
  draftEditsMakeAgain,
  type DraftEditGate,
} from "../draft-edit-gate.js";
import {
  selectDraftOffer,
  tourDraftActions,
  type TourDraftState,
} from "../tour-draft-slice.js";

/** What the offer shows; null: hidden. */
export interface DraftOfferView {
  readonly text: string;
  /** "Delete it" runs: every answer is off, and it reads `DRAFT_DELETING`. */
  readonly deleting: boolean;
}

export interface DraftOfferAnswers {
  restore(): void;
  notNow(): void;
  deleteIt(): Promise<void>;
}

/** The answers of an offer the store refused: each does nothing. */
const NO_ANSWERS: DraftOfferAnswers = {
  restore: () => undefined,
  notNow: () => undefined,
  deleteIt: () => Promise.resolve(),
};

export function createDraftOffer(deps: {
  /** The page's store: the offer is its draft question (`tourDraft`). */
  store: {
    dispatch(action: UnknownAction): unknown;
    getState(): { readonly tourDraft: TourDraftState };
    subscribe(listener: () => void): () => void;
    /** Its edit gate: every edit waits in it while the draft is undecided. */
    readonly draftGate: Pick<DraftEditGate, "hold" | "release" | "drop">;
  };
  /** The question this offer answers: the store's `generation` when the
   *  page started reading the draft. */
  question: number;
  /** The offer's own words. */
  text: string;
  render(view: DraftOfferView | null): void;
  /** A line for the creator; `error` for a failure. */
  say(text: string, error?: boolean): void;
  /** Whether the offer's tour is still the one open. */
  current(): boolean;
  /** Puts the draft back: how many changes, and the line saying so. */
  restore(): { count: number; line: string };
  /** "Delete it"'s removal; whether it landed. */
  discard(): Promise<boolean>;
  discardFailed: string;
  /** Work landed: `count` changes, from a Restore or from edits that
   *  waited for a landed "Delete it". */
  changed(count: number, restored: boolean): void;
}): DraftOfferAnswers {
  const { store, question: generation } = deps;
  const gate = store.draftGate;
  const draft = (): TourDraftState => store.getState().tourDraft;
  /** This offer's question, and its offer showing ("Delete it" may run). */
  const showing = (): boolean =>
    draft().generation === generation && draft().status === "offered";

  // The view is drawn from the store, whoever moved it: an edit that
  // waits (the gate's count), an answer here, the next tour's read.
  let drawn: DraftOfferView | null = null;
  let unsubscribe: (() => void) | null = null;
  const draw = (): void => {
    const shown =
      draft().generation === generation
        ? selectDraftOffer(store.getState())
        : null;
    const view: DraftOfferView | null =
      shown === null
        ? null
        : {
            text: shown.waits
              ? `${shown.text} ${DRAFT_EDIT_WAITS}`
              : shown.text,
            deleting: shown.deleting,
          };
    if (view?.text !== drawn?.text || view?.deleting !== drawn?.deleting) {
      drawn = view;
      deps.render(view);
    }
    // Another question now: this offer is done with the store.
    if (draft().generation !== generation) leave();
  };
  /** Hidden for good: its tour was left. */
  const leave = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    if (drawn !== null) {
      drawn = null;
      deps.render(null);
    }
  };

  store.dispatch(tourDraftActions.found({ generation, text: deps.text }));
  // Refused: the question moved on while the draft was read. Nothing is
  // held, since no answer of this offer could release the gate again.
  if (!showing()) return NO_ANSWERS;
  // The gate's count reaches the store before it asks, and a put-off
  // offer shows again from there (`tour-draft-slice.ts`): nothing to do.
  gate.hold(() => undefined);
  unsubscribe = store.subscribe(draw);
  draw();

  return {
    restore() {
      if (!showing() || draft().deleting) return;
      if (!deps.current()) {
        leave();
        return;
      }
      // Dropped, never replayed: a waiting edit was built from the
      // document before the draft came back.
      const dropped = gate.drop();
      store.dispatch(tourDraftActions.restored({ generation }));
      const { count, line } = deps.restore();
      gate.release();
      deps.changed(count, true);
      deps.say(dropped > 0 ? `${line} ${draftEditsMakeAgain(dropped)}` : line);
    },
    notNow() {
      if (!showing() || draft().deleting) return;
      if (!deps.current()) {
        leave();
        return;
      }
      store.dispatch(tourDraftActions.declined({ generation }));
      if (gate.drop() > 0) deps.say(DRAFT_EDIT_NOT_APPLIED);
    },
    async deleteIt() {
      if (!showing() || draft().deleting) return;
      if (!deps.current()) {
        leave();
        return;
      }
      store.dispatch(tourDraftActions.deleteStarted({ generation }));
      const ok = await deps.discard();
      store.dispatch(tourDraftActions.deleteEnded({ generation, landed: ok }));
      if (!deps.current() || draft().generation !== generation) return;
      if (!ok) {
        // Still undecided: the edits that waited keep waiting.
        deps.say(deps.discardFailed, true);
        return;
      }
      // Built from the state that stays: safe to replay.
      const landed = gate.release();
      if (landed > 0) deps.changed(landed, false);
    },
  };
}
