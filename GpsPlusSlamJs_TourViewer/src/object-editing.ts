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

export function wireObjectEditing(deps: ObjectEditingDeps): ObjectEditing {
  const { ctx, arStore, view } = deps;
  let selectedId: string | null = null;
  let note = "";
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
    view.render(
      objectListModel({
        entries: all,
        codes: deps.codes(),
        inAr: deps.sessionLive(),
        selectedId,
        busy,
        locked: ctx.finishing,
        note,
      }),
    );
  }

  function say(text: string): void {
    note = text;
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
    note = "";
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
    note = `Deleting ${name}…`;
    render();
    const write = found.hosted
      ? deps.saveDraftDeletion(id)
      : deps.forgetDraftObject(id).then(() => true);
    void write.then(
      (ok) => {
        say(
          ok
            ? `Deleted ${name} - ${found.hosted ? "it leaves the zip on the next Finish." : "it will not be in the zip."}`
            : `Deleted ${name}, but ${NOT_BACKED_UP}`,
        );
      },
      () => {
        say(`Deleted ${name}, but ${NOT_BACKED_UP}`);
      },
    );
  }

  view.bind({
    editText,
    move,
    remove,
    clearSelection: () => {
      selectedId = null;
      render();
    },
  });

  return {
    render,
    select: (id) => {
      selectedId = id;
      note = "";
      render();
    },
    objects,
    reset: () => {
      selectedId = null;
      note = "";
      busy.clear();
      render();
    },
  };
}
