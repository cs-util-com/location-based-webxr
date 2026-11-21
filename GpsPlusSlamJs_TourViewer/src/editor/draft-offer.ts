/**
 * The desktop editor's draft offer: what its three answers do, apart from
 * the toast that shows them (`edit-main.ts` renders the view). While the
 * draft is undecided every edit waits in the store's draft gate
 * (`draft-edit-gate.ts`); the first one shows the offer again.
 *
 * @see draft-offer.ts.md
 */
import {
  DRAFT_EDIT_MAKE_AGAIN,
  DRAFT_EDIT_NOT_APPLIED,
  DRAFT_EDIT_WAITS,
  type DraftEditGate,
} from "../draft-edit-gate.js";

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

export function createDraftOffer(deps: {
  gate: Pick<DraftEditGate, "hold" | "release" | "drop">;
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
  let visible = false;
  let waits = false;
  let deleting = false;

  const show = (): void => {
    visible = true;
    deps.render({
      text: waits ? `${deps.text} ${DRAFT_EDIT_WAITS}` : deps.text,
      deleting,
    });
  };
  const hide = (): void => {
    visible = false;
    deps.render(null);
  };

  deps.gate.hold(() => {
    waits = true;
    show();
  });
  show();

  return {
    restore() {
      if (deleting || !visible) return;
      hide();
      if (!deps.current()) return;
      // Dropped, never replayed: a waiting edit was built from the
      // document before the draft came back.
      const dropped = deps.gate.drop();
      const { count, line } = deps.restore();
      deps.gate.release();
      deps.changed(count, true);
      deps.say(dropped > 0 ? `${line} ${DRAFT_EDIT_MAKE_AGAIN}` : line);
    },
    notNow() {
      if (deleting || !visible) return;
      hide();
      waits = false;
      if (deps.gate.drop() > 0) deps.say(DRAFT_EDIT_NOT_APPLIED);
    },
    async deleteIt() {
      if (deleting || !visible) return;
      if (!deps.current()) {
        hide();
        return;
      }
      deleting = true;
      show();
      const ok = await deps.discard();
      deleting = false;
      if (!deps.current()) return;
      if (!ok) {
        // Still undecided: the edits that waited keep waiting.
        show();
        deps.say(deps.discardFailed, true);
        return;
      }
      hide();
      // Built from the state that stays: safe to replay.
      const landed = deps.gate.release();
      if (landed > 0) deps.changed(landed, false);
    },
  };
}
