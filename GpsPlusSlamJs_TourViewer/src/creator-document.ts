/**
 * The tour document as the phone's creator page holds it: a handle over
 * the shared `tourDocument` slice (`tour-document.ts`) - the one copy of
 * the tour both pages edit - with what the slice must never hold kept
 * beside it in side tables keyed by object id: a photo's picture (a Blob)
 * and where an object was placed in AR (its odometry pose in one visit).
 * Every change goes through the slice's actions after its own guards
 * (`canPlace`, `objectFits`, `canStep`); the draft follows the document
 * from a listener (`followDocument`), never from the gesture.
 *
 * @see creator-document.ts.md
 */

import type { TypedStartListening, UnknownAction } from "@reduxjs/toolkit";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  canPlace,
  canStep,
  documentObjects,
  isDocumentEdit,
  manifestNow,
  nextStep,
  objectFits,
  picturesNeeded,
  selectTourDocument,
  tourDocumentActions,
  type StationFrame,
  type StationPose,
  type TourDocumentState,
} from "./tour-document.js";
import {
  followDocument,
  type TourDocumentDraft,
} from "./tour-document-draft.js";
import type { NuePose } from "./visit-anchoring.js";

/**
 * Where an object was placed in AR, kept for the settle (authoring plan
 * 2026-09-28-0953 §3.2, M2c): its pose in the world group's frame
 * (odometry-NUE, `visit-anchoring.ts`) and the AR visit that frame belongs
 * to - odometry from another visit is meaningless. Absent for an object
 * that came back from a draft: it has only its geo.
 */
export interface VisitPlacement {
  /** `arSessionGeneration` at the tap. */
  readonly visit: number;
  readonly local: NuePose;
}

/** One of this page's entries: the object as the document holds it, with
 *  its picture and its AR placement from the side tables. */
export interface PlacedEntry {
  readonly object: TourObject;
  readonly blob?: Blob;
  readonly placement?: VisitPlacement;
}

/** One object of the tour as the creator sees it now (the document's
 *  `documentObjects`), its entry joined with the side tables. */
export type CreatorObject = Omit<
  ReturnType<typeof documentObjects>[number],
  "placed"
> & { readonly placed: PlacedEntry | null };

/** A change the document took: `backedUp` settles once every draft write
 *  it caused settled - true when all landed, or when no draft follows. */
export interface DocumentChange {
  readonly backedUp: Promise<boolean>;
}

/** What an undo did, or why it did not. */
export type DocumentUndo =
  | ({ readonly kind: "undone"; readonly what: string } & DocumentChange)
  | { readonly kind: "nothing" }
  | { readonly kind: "refused"; readonly reason: "saving" | "picture-gone" };

/** The store the document lives in (`createTourViewerStore`). */
export interface CreatorDocumentStore {
  getState(): { readonly tourDocument: TourDocumentState };
  dispatch(action: UnknownAction): unknown;
  readonly listenToDocument: TypedStartListening<{
    tourDocument: TourDocumentState;
  }>;
}

export interface CreatorDocument {
  /** The slice as it stands. */
  state(): TourDocumentState;
  /** The open tour's manifest as it stands (its station frames moved, its
   *  setting and details applied: `manifestNow`); null while no tour file
   *  is open - none, or one without `tour.json` - and nothing was written
   *  yet. The same object until the document changes. */
  manifest(): TourManifest | null;
  /** This page's entries (placed, edited or moved, not yet pruned by a
   *  write), in order. The same array until the document or a side table
   *  changes. */
  entries(): readonly PlacedEntry[];
  /** Ids of the written file's objects deleted and not yet written. */
  deleted(): readonly string[];
  /** The tour's objects now, each with this page's entry. */
  objects(): CreatorObject[];
  /** A photo's picture from the side table. */
  pictureOf(id: string): Blob | undefined;
  /** Keep a photo's picture (a deleted photo's, for an undo after a
   *  write took it out). */
  keepPicture(id: string, blob: Blob): void;
  /** A tour's manifest settled (null: the tour has no `tour.json`): the
   *  document opens it. Work made while no tour was open comes along as
   *  one restored step; anything of another tour is gone. */
  open(manifest: TourManifest | null): void;
  /** The tour closed: back to no tour, its work and side tables gone. */
  close(): void;
  /** A new object (a tap in AR, or work carried in): null when refused
   *  (`canPlace`). */
  place(
    object: TourObject,
    extras: { readonly blob?: Blob; readonly placement?: VisitPlacement },
    what: string,
  ): DocumentChange | null;
  /** A pin's text changed (`objectFits`); its placement is kept. */
  edit(object: TourObject, what: string): DocumentChange | null;
  /** An object moved (`objectFits`): `placement` replaces its AR placement
   *  when given (a move in AR), else it is kept (a settle's re-pose). */
  move(
    object: TourObject,
    what: string,
    placement?: VisitPlacement,
  ): DocumentChange | null;
  /** An object deleted; null for an id the tour does not carry. */
  remove(id: string, what: string): DocumentChange | null;
  /** A station's frame moved (D17), its items rigidly with it; null for a
   *  station the document does not carry. */
  moveStation(
    stationId: string,
    geo: QrGeoPose,
    what: string,
  ): DocumentChange | null;
  /** A draft's work put back, already filtered by the page's rules, with
   *  its photos' pictures: one step. */
  restore(
    work: {
      readonly objects: readonly TourObject[];
      readonly deleted: readonly string[];
      readonly pictures: ReadonlyMap<string, Blob>;
      readonly stations?: readonly StationPose[];
    },
    what: string,
  ): DocumentChange;
  /** One step back, unless a write runs (`canStep`) or a photo it brings
   *  back has no picture here (`picturesNeeded`). */
  undo(): DocumentUndo;
  /** Counts every edit, undo and redo (`TourDocumentState.revision`). */
  revision(): number;
  /** A write (the Finish) begins: undo waits; its generation, which every
   *  later answer names. */
  saveStarted(): number;
  /** The write landed (`saved`); the AR placements of the entries it
   *  took out go with them. */
  saved(save: {
    readonly generation: number;
    readonly written: TourManifest;
    readonly appliedDeletions: readonly string[];
    readonly stationsAtStart: readonly StationFrame[];
  }): void;
  /** The write ended, landed or not. */
  saveEnded(generation: number, error?: string): void;
  /** The draft follows the document from now on: each edit's writes,
   *  issued by a listener after the reducer. One draft per page. */
  follow(draft: TourDocumentDraft): void;
}

export function createCreatorDocument(
  store: CreatorDocumentStore,
): CreatorDocument {
  /** The document with no tour open: the slice takes edits only into an
   *  open document, and the creator may place before any tour opens (the
   *  scan-to-open plan §9 #5) - so "no tour" is this empty one, told apart
   *  by identity. */
  const noTour = createEmptyTourManifest();
  /** Photos' pictures and AR placements, by object id: never state. */
  const pictures = new Map<string, Blob>();
  const placements = new Map<string, VisitPlacement>();
  /** Bumped when a side table changes: the entries are joined again. */
  let sideVersion = 0;
  /** The draft writes the dispatch under way issued, while one is
   *  collected (the listener runs inside the dispatch). */
  let collecting: Promise<boolean>[] | null = null;
  let followed = false;

  store.dispatch(tourDocumentActions.opened({ manifest: noTour }));

  function state(): TourDocumentState {
    return selectTourDocument(store.getState());
  }

  /** Dispatch `action`, collecting the draft writes it causes. */
  function change(action: UnknownAction): DocumentChange {
    const writes: Promise<boolean>[] = [];
    const outer = collecting;
    collecting = writes;
    try {
      store.dispatch(action);
    } finally {
      collecting = outer;
    }
    return {
      backedUp: Promise.all(writes).then((all) => all.every(Boolean)),
    };
  }

  function join(object: TourObject): PlacedEntry {
    const blob = pictures.get(object.id);
    const placement = placements.get(object.id);
    return {
      object,
      ...(blob === undefined ? {} : { blob }),
      ...(placement === undefined ? {} : { placement }),
    };
  }

  let manifestMemo: {
    readonly key: readonly unknown[];
    readonly value: TourManifest | null;
  } | null = null;
  function manifest(): TourManifest | null {
    const s = state();
    if (s.written === null || s.written === noTour) return null;
    const key = [s.written, s.stations, s.placed, s.needsNoGps, s.details];
    if (manifestMemo?.key.every((k, i) => k === key[i]) !== true) {
      manifestMemo = { key, value: manifestNow(s) };
    }
    return manifestMemo.value;
  }

  let entriesMemo: {
    readonly placed: TourDocumentState["placed"];
    readonly version: number;
    readonly value: readonly PlacedEntry[];
  } | null = null;
  function entries(): readonly PlacedEntry[] {
    const { placed } = state();
    if (entriesMemo?.placed !== placed || entriesMemo.version !== sideVersion) {
      entriesMemo = {
        placed,
        version: sideVersion,
        value: placed.map((p) => join(p.object)),
      };
    }
    return entriesMemo.value;
  }

  function setPlacement(id: string, placement: VisitPlacement): void {
    placements.set(id, placement);
    sideVersion += 1;
  }

  function setPicture(id: string, blob: Blob): void {
    pictures.set(id, blob);
    sideVersion += 1;
  }

  function reopen(manifestToOpen: TourManifest): void {
    pictures.clear();
    placements.clear();
    sideVersion += 1;
    store.dispatch(tourDocumentActions.opened({ manifest: manifestToOpen }));
  }

  return {
    state,
    manifest,
    entries,
    deleted: () => state().deleted,
    objects: () =>
      documentObjects(state()).map((o) => ({
        ...o,
        placed: o.placed === null ? null : join(o.placed.object),
      })),
    pictureOf: (id) => pictures.get(id),
    keepPicture: setPicture,
    open(opened) {
      const before = state();
      // Only work made with no tour open comes along: another tour's was
      // that tour's (it is gone at its close).
      const carried =
        before.written === noTour ? before.placed.map((p) => p.object) : [];
      const kept = new Map(
        carried.map((o) => [
          o.id,
          { picture: pictures.get(o.id), placement: placements.get(o.id) },
        ]),
      );
      reopen(opened ?? noTour);
      for (const [id, side] of kept) {
        if (side.picture !== undefined) pictures.set(id, side.picture);
        if (side.placement !== undefined) placements.set(id, side.placement);
      }
      if (carried.length > 0) {
        change(
          tourDocumentActions.restored({
            objects: carried,
            deleted: [],
            what: "the work made before the tour opened",
          }),
        );
      }
    },
    close() {
      reopen(noTour);
    },
    place(object, extras, what) {
      if (!canPlace(state(), object)) return null;
      if (extras.blob !== undefined) setPicture(object.id, extras.blob);
      if (extras.placement !== undefined) {
        setPlacement(object.id, extras.placement);
      }
      return change(tourDocumentActions.placed({ object, what }));
    },
    edit(object, what) {
      if (!objectFits(state(), object)) return null;
      return change(tourDocumentActions.edited({ object, what }));
    },
    move(object, what, placement) {
      if (!objectFits(state(), object)) return null;
      if (placement !== undefined) setPlacement(object.id, placement);
      return change(tourDocumentActions.moved({ object, what }));
    },
    remove(id, what) {
      if (!documentObjects(state()).some((o) => o.object.id === id)) {
        return null;
      }
      return change(tourDocumentActions.deleted({ id, what }));
    },
    moveStation(stationId, geo, what) {
      if (!state().stations.some((s) => s.id === stationId)) return null;
      return change(tourDocumentActions.stationMoved({ stationId, geo, what }));
    },
    restore(work, what) {
      for (const [id, blob] of work.pictures) setPicture(id, blob);
      return change(
        tourDocumentActions.restored({
          objects: work.objects,
          deleted: work.deleted,
          ...(work.stations === undefined ? {} : { stations: work.stations }),
          what,
        }),
      );
    },
    undo() {
      const s = state();
      if (!canStep(s)) return { kind: "refused", reason: "saving" };
      const step = nextStep(s, "undo");
      if (step === undefined) return { kind: "nothing" };
      if (picturesNeeded(s, step.view).some((id) => !pictures.has(id))) {
        return { kind: "refused", reason: "picture-gone" };
      }
      return {
        kind: "undone",
        what: step.what,
        ...change(tourDocumentActions.undone()),
      };
    },
    revision: () => state().revision,
    saveStarted() {
      const { generation } = state();
      store.dispatch(tourDocumentActions.saveStarted({ generation }));
      return generation;
    },
    saved(save) {
      store.dispatch(tourDocumentActions.saved(save));
      const kept = new Set(state().placed.map((p) => p.object.id));
      for (const id of [...placements.keys()]) {
        if (!kept.has(id)) placements.delete(id);
      }
      sideVersion += 1;
    },
    saveEnded(generation, error) {
      store.dispatch(
        tourDocumentActions.saveEnded({
          generation,
          ...(error === undefined ? {} : { error }),
        }),
      );
    },
    follow(draft) {
      if (followed) throw new Error("the document already has a draft");
      followed = true;
      /** Each write the listener issues, collected for the change that
       *  caused it (`DocumentChange.backedUp`). */
      const collected =
        <A extends unknown[]>(write: (...args: A) => Promise<boolean>) =>
        (...args: A): Promise<boolean> => {
          const written = write(...args).catch(() => false);
          collecting?.push(written);
          return written;
        };
      const tracked: TourDocumentDraft = {
        saveObject: collected(draft.saveObject),
        saveDeletion: collected(draft.saveDeletion),
        forgetDeletion: collected(draft.forgetDeletion),
        forgetObject: (id) => {
          const forgotten = draft.forgetObject(id).then(
            () => true,
            () => false,
          );
          collecting?.push(forgotten);
          return forgotten.then(() => undefined);
        },
        saveSettings: collected((record) => draft.saveSettings(record)),
      };
      store.listenToDocument({
        predicate: isDocumentEdit,
        effect: (_action, api) => {
          followDocument(
            tracked,
            selectTourDocument(api.getOriginalState()),
            selectTourDocument(api.getState()),
            (id) => pictures.get(id),
          );
        },
      });
    },
  };
}
