/**
 * Editing placed objects (authoring plan 2026-09-28-0953 §3.4, M4; owner
 * item 6: "create works; move, edit and delete do not"): the object list's
 * actions - Edit text, Move to the reticle, Delete - and the AR selection
 * they apply to, over the creator's in-memory state.
 *
 * THE MODEL, in one place ({@link authoringObjects}):
 * - the tour's objects are the manifest's (the hosted zip, or the last
 *   Finish) with this device's records REPLACING theirs by id, this
 *   device's new ones appended, and the deleted ids filtered out - exactly
 *   what the Finish writes (`applyObjectChanges`);
 * - an edit or a move of a hosted object puts a record with the SAME id
 *   into `ctx.placedObjects` (replace by id, never a second entry);
 * - a delete of an object the manifest carries is a tombstone
 *   (`ctx.deletedObjectIds`); one that exists only on this device is
 *   simply dropped.
 *
 * Every action is logged as a `tourAuthoring/*` action, reaches the draft
 * (awaited, so the row shows the in-progress state until the write
 * settles, and a refused write is said, CLAUDE.md "UI feedback for async
 * actions"), and re-renders the previews.
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

import { applyObjectChanges } from "./authoring-draft.js";
import {
  objectListModel,
  type ObjectListEntry,
  type ObjectListView,
} from "./object-list.js";
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

type PlacedEntry = TourViewerSession["placedObjects"][number];

/** One object of the tour as the creator sees it now. */
export interface AuthoringObject extends ObjectListEntry {
  /** This device's entry for it (a placement, an edit, a move), if any. */
  readonly placed: PlacedEntry | null;
}

/**
 * The tour's objects now: the manifest's, this device's replacing them by
 * id, new ones appended, deleted ones gone - the Finish's own rule
 * (`applyObjectChanges`), so the list, the previews and the zip can never
 * disagree about what the tour holds.
 */
export function authoringObjects(
  manifest: readonly TourObject[],
  placed: readonly PlacedEntry[],
  deleted: readonly string[],
): AuthoringObject[] {
  const hosted = new Set(manifest.map((o) => o.id));
  const byId = new Map<string, PlacedEntry>();
  for (const entry of placed) byId.set(entry.object.id, entry);
  return applyObjectChanges(
    manifest,
    placed.map((p) => p.object),
    deleted,
  ).map((object) => {
    const entry = byId.get(object.id) ?? null;
    return {
      object,
      hosted: hosted.has(object.id),
      changed: entry !== null,
      placed: entry,
    };
  });
}

/** Replace the entry with `entry`'s id, or append it. */
export function upsertPlaced(
  placed: readonly PlacedEntry[],
  entry: PlacedEntry,
): PlacedEntry[] {
  const index = placed.findIndex((p) => p.object.id === entry.object.id);
  if (index < 0) return [...placed, entry];
  const out = [...placed];
  out[index] = entry;
  return out;
}

export interface ObjectEditingDeps {
  readonly ctx: TourViewerSession;
  readonly arStore: TourViewerStore;
  readonly view: ObjectListView;
  readonly getArWorldGroup: () => Object3D | null;
  /** An AR session is live. */
  readonly sessionLive: () => boolean;
  /** The placement gate (measured code, aligned, running, no Finish). */
  readonly placementAllowed: () => boolean;
  /** The settle's inputs as they stand (the level in hand, this visit's
   *  measurement and sighting, the GPS accuracy): what a move goes
   *  through, so it takes the same code correction (D10b). */
  readonly settleInputs: () => Omit<
    SettleAlignmentInput,
    "visit" | "alignment" | "zero"
  >;
  /** The stored codes' geo, for the list's distances. */
  readonly codes: () => readonly QrGeoPose[];
  /** Write a record to the draft; false when it did not land (no store,
   *  a refused write). */
  readonly saveDraftObject: (
    object: TourObject,
    blob?: Blob,
  ) => Promise<boolean>;
  /** Record a deletion in the draft; false when it did not land. */
  readonly saveDraftDeletion: (id: string) => Promise<boolean>;
  /** Drop a record only this device had from the draft. */
  readonly forgetDraftObject: (id: string) => Promise<void>;
  /** Take a deletion back out of the draft (an Undo); false when it did
   *  not land. */
  readonly forgetDraftDeletion: (id: string) => Promise<boolean>;
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
  /** The tour's objects now (see {@link authoringObjects}). */
  objects(): AuthoringObject[];
  /** A tour closed or a visit ended: the selection and outcome go. */
  reset(): void;
}

const SAVED_SUFFIX = "it goes into the zip on the next Finish.";
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

/** What an Undo of a delete puts back, captured at the delete. */
interface DeletedObject {
  readonly object: TourObject;
  /** This device's entry for it (an edit, a placement), or null. */
  readonly placed: PlacedEntry | null;
  /** Its place in `ctx.placedObjects`, so the Finish order is kept. */
  readonly index: number;
  readonly hosted: boolean;
  /** "the photo" or the pin's quoted text. */
  readonly name: string;
}

export function wireObjectEditing(deps: ObjectEditingDeps): ObjectEditing {
  const { ctx, arStore, view } = deps;
  let selectedId: string | null = null;
  let note = "";
  /** The note is still within {@link OUTCOME_HOLD_MS}: a tap that only
   *  selects leaves it standing. */
  let held = false;
  let cancelHold: (() => void) | null = null;
  /** The last delete, while it can be undone: offered beside its note
   *  until the hold ends, the note changes, or the zip is rebuilt. */
  let undoable: {
    readonly manifest: unknown;
    readonly run: () => void;
  } | null = null;
  const busy = new Map<string, string>();

  function objects(): AuthoringObject[] {
    return authoringObjects(
      ctx.tourManifest?.objects ?? [],
      ctx.placedObjects,
      ctx.deletedObjectIds,
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
    // A Finish applied the delete (the manifest advanced) or another tour
    // opened: there is nothing left to put it back into.
    if (undoable !== null && undoable.manifest !== ctx.tourManifest) {
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
  function say(
    text: string,
    undo: {
      readonly manifest: unknown;
      readonly run: () => void;
    } | null = null,
  ): void {
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
    const label = text.trim();
    if (label === "") {
      say("A pin needs some text - it was left as it was.");
      return;
    }
    if (label === before.label) {
      say("");
      return;
    }
    const after: TourObject = { ...before, label };
    ctx.placedObjects = upsertPlaced(ctx.placedObjects, {
      ...(found.placed ?? {}),
      object: after,
    });
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
      () => deps.saveDraftObject(after),
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
    // The odometry pose is kept, so the visit's own settle recomputes it
    // with the rest of the visit at its end - and the preview is rigid in
    // AR meanwhile, like a newly placed pin.
    ctx.placedObjects = upsertPlaced(ctx.placedObjects, {
      ...(found.placed ?? {}),
      object: after,
      placement: { visit, local },
    });
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
    const label = before.kind === "pin" ? before.label : "the pin";
    void withBusy(
      id,
      "Moving…",
      () => deps.saveDraftObject(after),
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
    const index = ctx.placedObjects.findIndex((p) => p.object.id === id);
    ctx.placedObjects = ctx.placedObjects.filter((p) => p.object.id !== id);
    if (found.hosted && !ctx.deletedObjectIds.includes(id)) {
      ctx.deletedObjectIds = [...ctx.deletedObjectIds, id];
    }
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
    const name = object.kind === "pin" ? `"${object.label}"` : "the photo";
    // The row is gone at once; the in-progress state is the note until the
    // draft write settles.
    say(`Deleting ${name}…`);
    const deleted: DeletedObject = {
      object,
      placed: found.placed,
      index,
      hosted: found.hosted,
      name,
    };
    const manifest = ctx.tourManifest;
    const write = found.hosted
      ? deps.saveDraftDeletion(id)
      : deps.forgetDraftObject(id).then(() => true);
    void write
      .catch(() => false)
      .then((ok) => {
        // Undo is offered with the outcome either way: a delete the draft
        // did not record is still a delete in memory, and the next Finish.
        say(
          ok
            ? `Deleted ${name} - ${found.hosted ? "it leaves the zip on the next Finish." : "it will not be in the zip."}`
            : `Deleted ${name}, but ${NOT_BACKED_UP}`,
          {
            manifest,
            run: () => {
              undoDelete(deleted);
            },
          },
        );
      });
  }

  /**
   * Put a deleted object back (M4 review #5): into the lists the Finish
   * writes, the scene, the draft and the log. The draft gets the record
   * first (an edited or locally placed object's) and loses the tombstone
   * after, both in the id's queue: until the tombstone goes it outranks
   * the record, so an Undo cut short leaves the object deleted rather
   * than half restored.
   */
  function undoDelete(deleted: DeletedObject): void {
    if (refusedDuringFinish()) return;
    const id = deleted.object.id;
    if (deleted.hosted) {
      ctx.deletedObjectIds = ctx.deletedObjectIds.filter((x) => x !== id);
    }
    if (
      deleted.placed !== null &&
      !ctx.placedObjects.some((p) => p.object.id === id)
    ) {
      const out = [...ctx.placedObjects];
      out.splice(Math.min(deleted.index, out.length), 0, deleted.placed);
      ctx.placedObjects = out;
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
    const writes: Promise<boolean>[] = [];
    if (deleted.placed !== null) {
      writes.push(
        deps.saveDraftObject(deleted.placed.object, deleted.placed.blob),
      );
    }
    if (deleted.hosted) writes.push(deps.forgetDraftDeletion(id));
    void Promise.all(writes.map((w) => w.catch(() => false))).then((oks) => {
      say(
        oks.every(Boolean)
          ? `Restored ${deleted.name}.`
          : `Restored ${deleted.name}, but ${NOT_BACKED_UP}`,
      );
    });
  }

  /** Select `id` (a tap in AR, or the chooser), or clear with null. */
  function selectObject(id: string | null): void {
    selectedId = id;
    // A tap in AR is also how the creator carries on, so it must not take
    // an outcome off the screen before it could be read (M4 review #6);
    // once the hold is over it clears it.
    if (!held) note = "";
    render();
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
    step: (delta) => {
      const ids = objects().map((o) => o.object.id);
      if (ids.length === 0) return;
      const at = selectedId === null ? -1 : ids.indexOf(selectedId);
      // Nothing selected: Next starts at the first, Previous at the last.
      const target =
        at < 0
          ? delta > 0
            ? 0
            : ids.length - 1
          : (at + delta + ids.length) % ids.length;
      selectObject(ids[target] ?? null);
    },
  });

  return {
    render,
    select: selectObject,
    objects,
    reset: () => {
      selectedId = null;
      note = "";
      undoable = null;
      stopHold();
      busy.clear();
      render();
    },
  };
}
