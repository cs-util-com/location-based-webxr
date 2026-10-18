/**
 * Editing placed objects (authoring plan 2026-09-28-0953 §3.4, M4; owner
 * item 6: "create works; move, edit and delete do not"): the object list's
 * actions - Edit text, Move to the reticle, Delete - and the AR selection
 * they apply to, over the creator's in-memory state.
 *
 * THE MODEL is the shared tour document (`tour-document.ts`, through the
 * page's handle `ctx.tourDocument`, `creator-document.ts`): an edit, a
 * move and a delete are its actions and an Undo is its undo - the same
 * rules, the same draft writes and the same history as the desktop
 * editor's.
 *
 * Every action is logged as a `tourAuthoring/*` action, reaches the draft
 * (the document's listener writes it; the row shows the in-progress state
 * until those writes settle, and a refused write is said, CLAUDE.md "UI
 * feedback for async actions"), and re-renders the previews.
 *
 * @see object-editing.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  selectAlignmentMatrix,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { Vector3, type Object3D } from "three";

import type { CreatorObject } from "./creator-document.js";
import { pinTextEdit } from "./object-edits.js";
import { objectListModel, type ObjectListView } from "./object-list.js";
import {
  objectDeleted,
  objectDeleteUndone,
  objectEdited,
  objectMoved,
} from "./tour-authoring-actions.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import type { NuePose } from "./visit-anchoring.js";
import { planMove, type SettleAlignmentInput } from "./visit-settle.js";

/** One object of the tour as the creator sees it now. */
export type AuthoringObject = CreatorObject;

export interface ObjectEditingDeps {
  /** Told after the selection changed (a tap, Done, a delete, a reset):
   *  the place buttons follow object mode (polish round M3). */
  readonly selectionChanged?: () => void;
  readonly ctx: TourViewerSession;
  readonly arStore: TourViewerStore;
  readonly view: ObjectListView;
  readonly getArWorldGroup: () => Object3D | null;
  /** An AR session is live. */
  readonly sessionLive: () => boolean;
  /** The placement gate (measured code, aligned, running, no Finish). */
  readonly placementAllowed: () => boolean;
  /** An object was moved in the running visit, now: the settle composes
   *  it through the first mature alignment after the MOVE (D33,
   *  `visit-alignment-picks.ts`). Optional: without it the move settles
   *  through the end alignment. */
  readonly notePlaced?: (id: string) => void;
  /** The settle's inputs as they stand (the level in hand, this visit's
   *  measurement and sighting, the GPS accuracy): what a move goes
   *  through, so it takes the same code correction (D10b). */
  readonly settleInputs: () => Omit<
    SettleAlignmentInput,
    "visit" | "alignment" | "zero"
  >;
  /** The stored codes' geo, for the list's distances. */
  readonly codes: () => readonly QrGeoPose[];
  /** Read a photo's picture from the open tour's file: a delete keeps it,
   *  so an Undo after a Finish wrote the delete can bring the photo back.
   *  Absent: such an Undo is refused, in words. */
  readonly loadPicture?: (image: string) => Promise<Blob>;
  /** A one-shot timer (the app's `schedule` seam): returns the cancel. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  /** The set of objects changed: bring the previews in line. */
  readonly syncPreviews: () => void;
  /** The panel should re-read state (placement count, Finish). */
  readonly renderAuthorReadout: () => void;
}

export interface ObjectEditing {
  /** Redraw the list if what it shows changed (cheap otherwise). */
  render(): void;
  /** Select an object (a tap in AR), or clear the selection with null. */
  select(id: string | null): void;
  /** The selected object's id, or null: object mode while it is not
   *  (polish round M3 - the place buttons step aside). */
  selected(): string | null;
  /** The tour's objects now (the document's `documentObjects`). */
  objects(): AuthoringObject[];
  /** A tour closed or a visit ended: the selection and outcome go. */
  reset(): void;
}

/** True on the page (Finish) and in AR (Done) alike (M3 review #12). */
const SAVED_SUFFIX = "it goes into the zip when you save the tour.";
const NOT_BACKED_UP =
  "this device could not save a backup copy - finish before closing the page.";

/**
 * How long an action's outcome stands against a tap that only changes the
 * selection, and how long a delete's Undo is offered (M4 review #5, #6).
 *
 * WHAT IT RESTS ON: reading the outcome, then reaching its button. The
 * outcomes run 8-17 words ("Deleted the photo - it leaves the zip on the
 * next Finish." is 11; a refused write's is 17). At 150-250 words a minute
 * that is 1.9-6.8 s to read, plus about 1-1.5 s to find and tap Undo with
 * the phone held up in AR - 3-8 s across that range; 8 s covers its slow
 * end. The common snackbar-with-action timings (4-10 s) sit around it.
 *
 * WHAT WOULD REVERSE IT: a field test in which creators reach for Undo after
 * it went (raise it, or keep Undo until the next action), or in which a held
 * note is read as describing the newly selected object (lower it).
 */
export const OUTCOME_HOLD_MS = 8_000;

/** A delete while its Undo can take it back: offered while the document
 *  stands where the delete left it (the same open, the same revision) -
 *  the document's undo takes back the LAST step, so any later change
 *  withdraws it. A Finish changes no revision: the Undo outlives it. */
interface Undoable {
  readonly generation: number;
  readonly revision: number;
  readonly run: () => void;
}

/** What an Undo of a delete names and logs, captured at the delete. */
interface DeletedObject {
  readonly object: TourObject;
  readonly hosted: boolean;
  /** "the photo" or the pin's quoted text. */
  readonly name: string;
}

export function wireObjectEditing(deps: ObjectEditingDeps): ObjectEditing {
  const { ctx, arStore, view } = deps;
  const tour = ctx.tourDocument;
  let selectedId: string | null = null;
  let note = "";
  /** The note is still within {@link OUTCOME_HOLD_MS}: a tap that only
   *  selects leaves it standing. */
  let held = false;
  let cancelHold: (() => void) | null = null;
  /** The last delete, while it can be undone: offered beside its note
   *  until the hold ends, the note changes, or the document moves on. */
  let undoable: Undoable | null = null;
  const busy = new Map<string, string>();

  function objects(): AuthoringObject[] {
    return tour.objects();
  }

  /** Whether `undo` still names the document's last step. */
  function stillUndoable(undo: Undoable): boolean {
    const state = tour.state();
    return (
      state.generation === undo.generation && state.revision === undo.revision
    );
  }

  function find(id: string): AuthoringObject | undefined {
    return objects().find((o) => o.object.id === id);
  }

  function render(): void {
    const all = objects();
    if (selectedId !== null && !all.some((o) => o.object.id === selectedId)) {
      selectedId = null;
    }
    // A change came after the delete (an edit, a placement, a settle's
    // re-pose) or another tour opened: the document's undo would take back
    // that, not the delete.
    if (undoable !== null && !stillUndoable(undoable)) {
      undoable = null;
    }
    view.render(
      objectListModel({
        entries: all,
        codes: deps.codes(),
        inAr: deps.sessionLive(),
        selectedId,
        busy,
        locked: ctx.finishing,
        note,
        undo: undoable !== null && !ctx.finishing,
      }),
    );
  }

  function stopHold(): void {
    cancelHold?.();
    cancelHold = null;
    held = false;
  }

  /**
   * Show `text` as the list's note, held for {@link OUTCOME_HOLD_MS}
   * against a tap that only selects (in AR every tap on the scene is one),
   * and with `undo` offered beside it for as long. Any later note replaces
   * both.
   */
  function say(text: string, undo: Undoable | null = null): void {
    note = text;
    undoable = undo;
    stopHold();
    if (text !== "") {
      held = true;
      cancelHold = deps.schedule(() => {
        cancelHold = null;
        held = false;
        if (undoable !== null) {
          undoable = null;
          render();
        }
      }, OUTCOME_HOLD_MS);
    }
    render();
  }

  function surface(): "page" | "ar" {
    return deps.sessionLive() ? "ar" : "page";
  }

  /** Mark `id` busy with `label` while `write` runs, then say the outcome. */
  async function withBusy(
    id: string,
    label: string,
    write: () => Promise<boolean>,
    outcome: (ok: boolean) => string,
  ): Promise<void> {
    busy.set(id, label);
    // A new action: the previous outcome (and its Undo) give way to it.
    note = "";
    undoable = null;
    stopHold();
    render();
    const ok = await write().catch(() => false);
    busy.delete(id);
    say(outcome(ok));
  }

  /** The actions refuse while a Finish rebuilds the zip: the rebuild has
   *  read the lists, and a change now would be in neither zip nor list. */
  function refusedDuringFinish(): boolean {
    if (!ctx.finishing) return false;
    say("Wait until the zip is rebuilt, then try again.");
    return true;
  }

  function editText(id: string, text: string): void {
    if (refusedDuringFinish()) return;
    const found = find(id);
    if (found === undefined) return;
    const before = found.object;
    if (before.kind !== "pin") return;
    // The shared rule (`object-edits.ts`), as the desktop editor uses it.
    const edit = pinTextEdit(before, text);
    if (edit.kind === "refused") {
      say(edit.reason);
      return;
    }
    if (edit.kind === "unchanged") {
      say("");
      return;
    }
    const after = edit.after;
    const label = after.kind === "pin" ? after.label : "";
    const changed = tour.edit(after, `the text of "${label}"`);
    if (changed === null) {
      say(`"${label}" could not be changed here.`);
      return;
    }
    arStore.dispatch(
      objectEdited({
        before,
        after,
        arVisitIndex: ctx.arSessionGeneration,
        atMs: Date.now(),
        surface: surface(),
      }),
    );
    deps.syncPreviews();
    deps.renderAuthorReadout();
    void withBusy(
      id,
      "Saving…",
      () => changed.backedUp,
      (ok) =>
        ok
          ? `Saved "${label}" - ${SAVED_SUFFIX}`
          : `Changed to "${label}", but ${NOT_BACKED_UP}`,
    );
  }

  /** The reticle in the world group's frame (odometry-NUE), or null
   *  with no surface under it. */
  function reticlePose(): NuePose | null {
    const reticle = ctx.reticle;
    const group = deps.getArWorldGroup();
    if (reticle === null || !reticle.isVisible() || group === null) {
      return null;
    }
    const p = group.worldToLocal(reticle.getWorldPosition(new Vector3()));
    return { position: [p.x, p.y, p.z], rotation: [0, 0, 0, 1] };
  }

  /** The pin a Move applies to, or null after saying why it cannot. */
  function movablePin(id: string): AuthoringObject | null {
    if (refusedDuringFinish()) return null;
    const found = find(id);
    if (found === undefined || found.object.kind !== "pin") return null;
    if (deps.sessionLive() && deps.placementAllowed()) return found;
    say(
      "Moving needs the AR setup running with the code measured and GPS aligned.",
    );
    return null;
  }

  function move(id: string): void {
    const found = movablePin(id);
    if (found === null) return;
    const local = reticlePose();
    if (local === null) {
      say(
        "Point the phone at a surface until the ring appears, then tap Move again.",
      );
      return;
    }
    const state = arStore.getState();
    const visitAlignment = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const visit = ctx.arSessionGeneration;
    const inputs = deps.settleInputs();
    const planned = planMove({
      ...inputs,
      visit,
      alignment: visitAlignment,
      zero,
      object: found.object,
      local,
    });
    if (planned === null || zero === null) {
      say("No usable GPS alignment yet - the pin was not moved.");
      return;
    }
    const before = found.object;
    const after = planned.object;
    const label = before.kind === "pin" ? before.label : "the pin";
    // The odometry pose is kept, so the visit's own settle recomputes it
    // with the rest of the visit at its end - and the preview is rigid in
    // AR meanwhile, like a newly placed pin.
    const moved = tour.move(after, `the move of "${label}"`, { visit, local });
    if (moved === null) {
      // Beyond what its station can carry (the format's bound, kilometres).
      say(`That spot is too far from its station - "${label}" was not moved.`);
      return;
    }
    deps.notePlaced?.(after.id);
    arStore.dispatch(
      objectMoved({
        before,
        after,
        arVisitIndex: visit,
        atMs: Date.now(),
        reticleOdomNue: local.position,
        basis: planned.basis,
        visitAlignment,
        usedAlignment: planned.alignment,
        sighting:
          planned.basis === "code-corrected" ? (inputs.sighting ?? null) : null,
        refusedCorrection: planned.refused,
        zero,
      }),
    );
    deps.syncPreviews();
    deps.renderAuthorReadout();
    void withBusy(
      id,
      "Moving…",
      () => moved.backedUp,
      (ok) =>
        ok
          ? `Moved "${label}" to the ring - ${SAVED_SUFFIX}`
          : `Moved "${label}", but ${NOT_BACKED_UP}`,
    );
  }

  function remove(id: string): void {
    if (refusedDuringFinish()) return;
    const found = find(id);
    if (found === undefined) return;
    const object = found.object;
    const name = object.kind === "pin" ? `"${object.label}"` : "the photo";
    keepPicture(found);
    const gone = tour.remove(id, `the delete of ${name}`);
    if (gone === null) return;
    /** Where the delete left the document: its Undo is offered while the
     *  document stays there. */
    const { generation, revision } = tour.state();
    if (selectedId === id) selectedId = null;
    arStore.dispatch(
      objectDeleted({
        object,
        hosted: found.hosted,
        arVisitIndex: ctx.arSessionGeneration,
        atMs: Date.now(),
        surface: surface(),
      }),
    );
    deps.syncPreviews();
    deps.renderAuthorReadout();
    // The row is gone at once; the in-progress state is the note until the
    // draft write settles.
    say(`Deleting ${name}…`);
    const deleted: DeletedObject = { object, hosted: found.hosted, name };
    // The draft's writes are the document's (`tour-document-draft.ts`): a
    // tombstone for an object the file carries, the record gone for one
    // only this device had - as the desktop editor's.
    void gone.backedUp.then((ok) => {
      // Undo is offered with the outcome either way: a delete the draft
      // did not record is still a delete in memory, and the next Finish.
      say(
        ok
          ? `Deleted ${name} - ${found.hosted ? "it leaves the zip when you save the tour." : "it will not be in the zip."}`
          : `Deleted ${name}, but ${NOT_BACKED_UP}`,
        {
          generation,
          revision,
          run: () => {
            undoDelete(deleted);
          },
        },
      );
    });
  }

  /**
   * Keep a deleted photo's picture beside the document: an Undo after a
   * Finish wrote the delete brings the photo back as an object the file no
   * longer carries, which needs its bytes (`picturesNeeded`). A photo
   * placed on this device has them already; one the opened file carries
   * is read from it now, while it is at hand.
   */
  function keepPicture(found: AuthoringObject): void {
    const { object } = found;
    const load = deps.loadPicture;
    if (object.kind !== "photo" || !found.hosted || load === undefined) return;
    if (tour.pictureOf(object.id) !== undefined) return;
    const generation = tour.state().generation;
    void load(object.image).then(
      (blob) => {
        // Not into another tour's table: the side table is the open one's.
        if (tour.state().generation === generation) {
          tour.keepPicture(object.id, blob);
        }
      },
      () => undefined,
    );
  }

  /**
   * Put a deleted object back (M4 review #5): the document's undo. The
   * object returns where the delete took it from (the Finish's order
   * holds), and the draft follows as for any change - the record first,
   * then the tombstone goes (`tour-document-draft.ts`), so an Undo cut
   * short leaves the object deleted rather than half restored.
   */
  function undoDelete(deleted: DeletedObject): void {
    if (refusedDuringFinish()) return;
    const undone = tour.undo();
    if (undone.kind === "nothing") return;
    if (undone.kind === "refused") {
      say(
        undone.reason === "saving"
          ? "Wait until the zip is rebuilt, then try again."
          : `${deleted.name} cannot come back: its picture is no longer on this device.`,
      );
      return;
    }
    arStore.dispatch(
      objectDeleteUndone({
        object: deleted.object,
        hosted: deleted.hosted,
        arVisitIndex: ctx.arSessionGeneration,
        atMs: Date.now(),
        surface: surface(),
      }),
    );
    deps.syncPreviews();
    deps.renderAuthorReadout();
    say(`Restoring ${deleted.name}…`);
    void undone.backedUp.then((ok) => {
      say(
        ok
          ? `Restored ${deleted.name}.`
          : `Restored ${deleted.name}, but ${NOT_BACKED_UP}`,
      );
    });
  }

  /** Select `id` (a tap in AR), or clear with null (Done, a tap on
   *  empty scene). */
  function selectObject(id: string | null): void {
    selectedId = id;
    // A tap in AR is also how the creator carries on, so it must not take
    // an outcome off the screen before it could be read (M4 review #6);
    // once the hold is over it clears it.
    if (!held) note = "";
    render();
    deps.selectionChanged?.();
  }

  view.bind({
    editText,
    move,
    remove,
    undo: () => {
      const pending = undoable;
      undoable = null;
      pending?.run();
    },
    deselect: () => {
      selectObject(null);
    },
  });

  return {
    render,
    select: selectObject,
    selected: () => selectedId,
    objects,
    reset: () => {
      selectedId = null;
      note = "";
      undoable = null;
      stopHold();
      busy.clear();
      render();
      // Not `selectionChanged`: a reset runs inside a visit's teardown,
      // and a full readout render there could start a measurement after
      // the visit's own had been cleared (M3 review #14). The next render
      // brings the place buttons and the ring along.
    },
  };
}
