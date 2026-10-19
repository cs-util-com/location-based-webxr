/**
 * The desktop editor's open tour and its edits (M6 E2a): the shared rules
 * of the phone's object list (`object-edits.ts`) over the tour the page
 * opened, and a Save built by the phone's own Finish rules
 * (`finish-rebuild.ts`). Page-free: the page shows `model()`, calls the
 * edits, and downloads what `save()` returns.
 *
 * @see editor-session.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_ITEM_MAX_OFFSET_M } from "gps-plus-slam-app-framework/ar/tour-items";
import { tourCoverEntry } from "gps-plus-slam-app-framework/ar/tour-details";
import { rebuildZipWithEntries } from "gps-plus-slam-app-framework/storage";
import { recordingEntryNames, scanEntryNames } from "../tour-read-set.js";
import type { DraftObjectWrites } from "../draft-actions.js";
import type { TourSession } from "../tour-session.js";
import {
  checkDetailsForm,
  DETAIL_FIELDS,
  type DetailsForm,
  type TourDetailFields,
} from "../tour-details-form.js";
import {
  canStep,
  changeCount,
  coverImageIds,
  detailsChange,
  documentObjects,
  effectiveDetails,
  isDocumentEdit,
  manifestNow,
  objectFits,
  nextStep,
  objectMoveChange,
  picturesNeeded,
  pinTextChange,
  selectTourDocument,
  tourDocumentActions,
  tourDocumentReducer,
  unsavedEntries,
  type TourDocumentState,
} from "../tour-document.js";
import { followDocument } from "../tour-document-draft.js";
import {
  createTourSaves,
  dispatchThunk,
  TOUR_REPLACED,
  type TourSaveBuilt,
} from "../tour-document-save.js";
import {
  createTourViewerStore,
  type TourViewerStore,
} from "../tour-viewer-session.js";
import type { DetailsOutcome } from "./details-dialog.js";
import type { EditorTourSettings } from "./editor-draft.js";
import { buildEditorModel, type EditorModel } from "./editor-model.js";
import { checkNoGps, type NoGpsCheck } from "./no-gps-check.js";
import { readZipBlobEntry, zipBlobEntryNames } from "../zip-blob.js";

/** One of the tour's objects as it stands, with this page's entry. */
type AuthoringObject = ReturnType<typeof documentObjects>[number];

/** Said for an undo or a redo asked for while a save runs: the save's end
 *  decides what the file carries, so the step waits (W2). */
const SAVE_RUNNING = "A save is running - undo or redo once it has finished.";

/** Said when an undo would bring back a photo a save already took out of
 *  the file, and its picture could not be kept. */
const PICTURE_GONE =
  "This photo's picture is no longer at hand, so its delete cannot be undone here.";

/** An object as the undo's words name it: its text, shortened, or what
 *  it is. */
function objectName(object: TourObject): string {
  const label =
    "label" in object && typeof object.label === "string"
      ? object.label.trim()
      : "";
  if (label === "") return object.kind === "photo" ? "a photo" : "a note";
  const chars = [...label];
  return `"${chars.length > 40 ? `${chars.slice(0, 39).join("")}…` : label}"`;
}

/** The outcome of an undo or a redo: the step taken (in words), nothing
 *  to take, or a refusal in words. */
type UndoOutcome =
  | { readonly kind: "undone" | "redone"; readonly what: string }
  | { readonly kind: "nothing" }
  | EditorRefusal;

export interface EditorSave {
  readonly blob: Blob;
  /** The opened file's name, made safe to save (the Finish's rule). */
  readonly filename: string;
  /** Entries visitors never read that the save left out. */
  readonly scanLeftOut: readonly string[];
  /** Why the recorded photos could not be placed, when they could not. */
  readonly notPlaced?: string;
  /** The manifest the zip carries (the draft's `written` versions, M6
   *  E2c). */
  readonly written: TourManifest;
}

/** The walk's own file, named after the tour's (W2, D19): `castle.zip`
 *  gives `castle-walk.zip`. */
export function walkFileName(tourName: string): string {
  return `${tourName.replace(/\.zip$/i, "")}-walk.zip`;
}

/** Said when "Move the walk out" finds no walk in the newest bytes. */
const NO_WALK = "This tour carries no walk recording to move out.";

/** Said when the recorded photos the tour carries are still placed by the
 *  walk: moving it out would leave them nowhere (`finish-rebuild.ts`, S1
 *  milestone review #2). A walk that names no photo of the tour places
 *  nothing and moves out (the M4b milestone review #3). */
function walkStaysReason(notPlaced: string | undefined): string {
  return `The walk cannot be moved out: this tour's recorded photos can only be placed with it, and they could not be fixed in place without it${notPlaced === undefined ? "" : ` (${notPlaced})`}. The tour keeps its walk.`;
}

/** The note inside a moved-out walk's zip, at its root: which tour it came
 *  from (the M4b milestone review #8). */
export const WALK_NOTE = "about-this-walk.txt";

function walkNoteText(tour: {
  readonly fileName: string;
  readonly title: string | undefined;
  readonly seriesId: string | null;
}): string {
  return [
    "This is the walk recording of a tour: the GPS track of the walk, the depth the phone measured and the recorded photos.",
    `It was moved out of the tour file ${tour.fileName}${tour.title === undefined ? "" : ` (the tour "${tour.title}")`} by the tour editor, so that the tour file people open does not carry it.`,
    ...(tour.seriesId === null ? [] : [`The tour's series: ${tour.seriesId}.`]),
    "Keep this file to yourself: the tour does not need it.",
    "",
  ].join("\n");
}

/**
 * A built move of the walk out of the tour (W2, D19): the walk's own zip
 * (the whole recording of the newest bytes - the frames the tour keeps for
 * its visitors included - byte for byte, under its own paths, and a note
 * naming the tour, `WALK_NOTE`) and the tour without the walk, with the
 * pending edits. Nothing of the
 * session changes until `commit()`: the page writes the walk's zip first,
 * then the tour, and commits only when both landed - a commit before that
 * would let the next save rebuild from walk-free bytes the creator never
 * received. The page holds every save while a move runs.
 */
interface WalkMove {
  readonly kind: "ready";
  readonly walk: { readonly blob: Blob; readonly filename: string };
  readonly save: EditorSave;
  /** No other save landed since the move was built: asked before the
   *  tour is written, so a stale move writes nothing (the M4b milestone
   *  review #2: the page's second click may come after an autosave). */
  current(): boolean;
  /** Make the walk-free tour the session's newest bytes, as a landed save
   *  does; throws when another save landed since the move was built.
   *  `inPlace`: the tour was written over the opened file (D33). */
  commit(inPlace?: boolean): void;
}

/** Said for an id the tour no longer carries (a restore or a save took
 *  it away while its card was open, M6 E2c review #11). */
export const NOT_IN_TOUR = "That note is no longer in this tour.";

/** Said for a placement of an id the tour already carries. */
const ALREADY_IN_TOUR = "That note is already in this tour.";

/** Said for a move of a station the tour does not carry. */
const NO_SUCH_STATION = "That station is no longer in this tour.";

/** Said for a move further from the note's station than a tour can carry
 *  (`TOUR_ITEM_MAX_OFFSET_M` per axis): the format would refuse the tour,
 *  so every later save failed with the parser's own words (the M5a
 *  milestone review L1). A note stays in its station however far it is
 *  moved (`tour-content.ts`). */
export const TOO_FAR_FROM_STATION = `It cannot go that far: a note must stay within ${String(TOUR_ITEM_MAX_OFFSET_M / 1000)} km of its station.`;

/** An edit, move or delete of an id the tour no longer carries, said in
 *  words (`NOT_IN_TOUR`) by all three alike (PR #622 bot finding C). */
interface EditorRefusal {
  readonly kind: "refused";
  readonly reason: string;
}

/** What a draft offers back (`editor-draft.ts`). */
interface EditorRestore {
  readonly objects: readonly TourObject[];
  readonly deleted: readonly string[];
  /** The tour-level settings, when the draft holds a change of them. */
  readonly settings?: EditorTourSettings;
}

/** Where the session backs its edits up: the objects' writes the phone
 *  shares (`draft-actions.ts`), and the tour's settings (QR-first M1b-2)
 *  with its details (W2). */
export interface EditorSessionDraft extends DraftObjectWrites {
  saveSettings(settings: EditorTourSettings): Promise<boolean>;
}

/** One image a tour may show as its cover (W2): a placed photo, or an
 *  image the tour carries as a content asset. */
interface CoverChoice {
  readonly id: string;
  /** Its entry in the zip (`content/<id>.jpg`). */
  readonly image: string;
}

export interface EditorSession {
  /** The tour as it stands with the edits, for the rail and the map. */
  model(): EditorModel;
  /** Edits and deletions not yet in a saved file, by content: a text
   *  edited back to the tour's own is no change (E2a review #10). */
  changeCount(): number;
  /** The ids of the notes with an edit or a move not yet saved. */
  pendingIds(): string[];
  /** The name every save of this open is written under: the opened
   *  file's, made safe (the Finish's rule). The page names the walk's
   *  file after it before a save ran. */
  savedName(): string;
  /** The tour's "needs no GPS" setting as it stands with the edits
   *  (QR-first M1b-2, owner Q-QF-1). */
  needsNoGps(): boolean;
  /** Turn it on or off: one pending change while it differs from the
   *  saved file, none once it is back at the file's own value. */
  setNeedsNoGps(on: boolean): { kind: "changed" | "unchanged" };
  /** The tour's name, description, cover and contact as they stand with
   *  the edits (W2); a cover whose image is gone (a deleted photo) is
   *  none. */
  details(): DetailsForm;
  /** Change them all at once (the "Tour details" dialog): each field that
   *  differs from the saved file is one pending change, an emptied field
   *  removes the detail. Refused in plain words, changing nothing, for
   *  what the format would drop. */
  setDetails(next: DetailsForm): DetailsOutcome;
  /** The images the tour may show as its cover: its placed photos and
   *  image assets, as they stand with the edits. */
  coverChoices(): CoverChoice[];
  /** What the setting's warnings are about: the code-less stations, the
   *  stations on a code the viewer cannot use, and whether a code can
   *  place the tour (`no-gps-check.ts`). */
  noGpsCheck(): NoGpsCheck;
  editText(
    id: string,
    text: string,
  ): { kind: "edited" | "unchanged" } | EditorRefusal;
  /** Move a note on the map (its height and facing kept): beyond its
   *  station's found radius the station rule seats it anew - the station
   *  holding its new spot, or a new one there - so no move is too far.
   *  Refused for an id the tour no longer carries. Throws for a position
   *  nobody can draw (`moveObjectTo`). */
  move(id: string, lat: number, lon: number): { kind: "moved" } | EditorRefusal;
  /** Delete (undone by `undo`, also after a save wrote it: a photo's
   *  picture is kept for that). Refused, deleting nothing, for an id the
   *  tour no longer carries. */
  remove(id: string): { kind: "deleted" } | EditorRefusal;
  /** Place a new object (the phone places in AR; the desktop has no
   *  placing gesture yet - the parity contract drives it): refused for an
   *  id the tour carries and for a spot further from its station than a
   *  tour can carry. */
  place(object: TourObject): { kind: "placed" } | EditorRefusal;
  /** Move a station's frame (D17): its items move rigidly with it.
   *  Refused for a station the tour does not carry. */
  moveStation(
    stationId: string,
    geo: QrGeoPose,
  ): { kind: "moved" } | EditorRefusal;
  /** Take back the newest edit (W2): the tour goes back to how it stood
   *  before it - an edit like any other, pending until saved and written
   *  to the draft. A note brought back after a save wrote its delete is
   *  not offered by a later open's draft, though (it places nothing new):
   *  that undo lasts this tab (M4a review #2). Refused while a save runs. */
  undo(): UndoOutcome;
  /** Take an undone edit again; a new edit drops what could be redone. */
  redo(): UndoOutcome;
  /** Counts every edit, undo and redo: a page holding an older offer
   *  (the delete toast's Undo) tells whether it is still the newest. */
  revision(): number;
  /** A photo's picture this session holds and the opened file may not (one
   *  an undo brought back after a save took it out), for the card. */
  pictureOf(id: string): Blob | undefined;
  /** Put a draft's work back by the session's own rules (M6 E2c): an
   *  object the tour carries gets the draft's version, a deletion its
   *  tombstone; live work on an id wins, and an id the tour no longer
   *  carries is skipped. The settings likewise: a change made here since
   *  the open wins, and an applied one counts among `changed`. What was
   *  applied is written to the draft again; it is one step to undo. */
  restore(work: EditorRestore): { changed: number; deleted: number };
  /** Build the saved zip from the newest bytes; edits made while it runs
   *  wait for the next save. Saves run one after another: one called
   *  while another runs starts when it ends (E2a review #9). */
  save(options: {
    readonly keepScan: boolean;
    /** The page writes it over the opened file (D33's resave reads where
     *  that file stands in the history). Default: a download. */
    readonly inPlace?: boolean;
  }): Promise<EditorSave>;
  /** The walk recording's entries in the newest bytes (W2, D19): none
   *  once it was moved out, or when the last save left it out. */
  walkEntries(): Promise<string[]>;
  /** Build the move of the walk out (`WalkMove`), queued with the saves;
   *  refused, in words, when there is no walk or the recorded photos the
   *  tour carries still need it (a walk that places nothing moves out).
   *  Bringing a walk back is a later feature. */
  moveWalkOut(): Promise<WalkMove | EditorRefusal>;
}

export function createEditorSession(input: {
  readonly session: TourSession;
  readonly manifest: TourManifest;
  readonly levels: ReadonlyMap<string, QrLevel>;
  /** The file's name for the model's title (default: the session's). */
  readonly fileName?: string;
  /** Where every edit, move, delete and undo is backed up (M6 E2c); none
   *  in a test that does not need it. */
  readonly draft?: EditorSessionDraft;
  /** Read a photo's picture by its entry (`content/<id>.jpg`) when it is
   *  deleted, so an undo after a save can bring it back (default: the
   *  opened file's; the page reads its copy of what it last wrote). */
  readonly loadPhoto?: (image: string) => Promise<Blob>;
  /** The store holding the tour document (D29): the page's own, so its
   *  views read the same state; a fresh one when absent (tests). Opening
   *  the session opens the document in it - whatever it held is gone. */
  readonly store?: TourViewerStore;
}): EditorSession {
  const { session, levels } = input;
  const store = input.store ?? createTourViewerStore();
  store.dispatch(tourDocumentActions.opened({ manifest: input.manifest }));
  /** This session's open: a later one in the same store makes every edit
   *  here refused and every save of it land nowhere. */
  const generation = doc().generation;

  // What follows is imperative resources only (root CLAUDE.md, "App state
  // lives in the Redux store"): the pictures' side table, and the saves'
  // own (the newest bytes, the photo spots' cache, the queue) in the
  // document's save (`tour-document-save.ts`), whose status is the slice's.
  /** Deleted photos' pictures, for an undo after a save took them out
   *  (the side table: Blobs are never state). */
  const pictures = new Map<string, Blob>();
  /** Pictures being read: a save waits for them, so an undo right after
   *  the save that wrote a photo's delete finds its picture. */
  const pictureReads = new Set<Promise<void>>();
  const loadPhoto =
    input.loadPhoto ?? ((image: string) => session.loadContentEntry(image));
  const saves = createTourSaves({
    tour: session,
    generation,
    pictureOf: (id) => pictures.get(id),
    picturesRead: () => Promise.all(pictureReads),
  });
  /** The saved file's name: the opened one's, made safe (the Finish's rule). */
  const savedName = saves.fileName;
  /** The name the page shows when the tour has no title. */
  const shownName = input.fileName ?? savedName;

  const draft = input.draft;
  if (draft !== undefined) {
    // The draft follows the document (`tour-document-draft.ts`), after
    // each reducer - never from `store.subscribe`.
    store.listenToDocument({
      predicate: isDocumentEdit,
      effect: (_action, api) => {
        const after = selectTourDocument(api.getState());
        if (after.generation !== generation) {
          api.unsubscribe();
          return;
        }
        followDocument(
          draft,
          selectTourDocument(api.getOriginalState()),
          after,
          (id) => pictures.get(id),
        );
      },
    });
  }

  function doc(): TourDocumentState {
    return selectTourDocument(store.getState());
  }

  /** The document as this session opened it; null once another open
   *  replaced it. */
  function mine(): TourDocumentState | null {
    const state = doc();
    return state.generation === generation ? state : null;
  }

  /** The document as this session reads it: the store's while this open
   *  is the newest, else as it stood when another open replaced it - a
   *  replaced session never reads another tour (the r875 milestone review
   *  #4). */
  let last = doc();
  // Kept after every change of the document while this open is the newest
  // - an edit or a save's landing that no read of the session followed
  // included - so "as it stood when replaced" is that, not the last read
  // before it. The listener middleware runs the effect synchronously
  // after the reducer, inside the dispatch, so `last` is never behind.
  store.listenToDocument({
    predicate: (_action, after, before) =>
      selectTourDocument(after) !== selectTourDocument(before),
    effect: (_action, api) => {
      const state = selectTourDocument(api.getState());
      if (state.generation === generation) last = state;
      else api.unsubscribe();
    },
  });
  function own(): TourDocumentState {
    const state = mine();
    if (state !== null) last = state;
    return last;
  }

  /** The written tour (this session's). */
  function written(): TourManifest {
    return own().written ?? input.manifest;
  }

  /** The tour as it stands, frames and settings applied. */
  function now(): TourManifest {
    return manifestNow(own()) ?? input.manifest;
  }

  const notInTour: EditorRefusal = { kind: "refused", reason: NOT_IN_TOUR };

  /** Undefined for an id the tour no longer carries, or a tour no longer
   *  open: a page holding an older card gets a refusal, never a throw (E2c
   *  plan review #11). */
  function find(id: string): AuthoringObject | undefined {
    const state = mine();
    if (state === null) return undefined;
    return documentObjects(state).find((o) => o.object.id === id);
  }

  /** The tour's pins and photos as they stand with the edits, for what
   *  reads its images. */
  function current(): TourObject[] {
    return documentObjects(own()).map((o) => o.object);
  }

  function coverIds(state: TourDocumentState = own()): Set<string> {
    return coverImageIds(state);
  }

  /** Keep a deleted photo's picture for an undo after a save. */
  function keepPicture(found: AuthoringObject): void {
    const object = found.object;
    if (object.kind !== "photo") return;
    const id = object.id;
    if (pictures.has(id)) return;
    // Read now, while the copy that carries it is at hand; failing that,
    // from this session's own last bytes - the page's copy may not read
    // right after an in-place write (M4a review #5). A read that fails
    // both ways leaves an undo after a save refused, in words.
    const newest = saves.newest()?.blob;
    const read = loadPhoto(object.image)
      .catch((err: unknown) =>
        newest === undefined
          ? Promise.reject(err instanceof Error ? err : new Error(String(err)))
          : readZipBlobEntry(newest, `${session.manifestWrap}${object.image}`),
      )
      .then(
        (blob) => {
          pictures.set(id, blob);
        },
        () => undefined,
      )
      .finally(() => {
        pictureReads.delete(read);
      });
    pictureReads.add(read);
  }

  /** One step of the history (undo or redo); refused while a save runs,
   *  and when a photo it brings back has no picture. */
  function step(which: "undo" | "redo"): UndoOutcome {
    const state = mine();
    if (state === null) return notInTour;
    if (!canStep(state)) return { kind: "refused", reason: SAVE_RUNNING };
    const next = nextStep(state, which);
    if (next === undefined) return { kind: "nothing" };
    if (picturesNeeded(state, next.view).some((id) => !pictures.has(id))) {
      return { kind: "refused", reason: PICTURE_GONE };
    }
    store.dispatch(
      which === "undo"
        ? tourDocumentActions.undone()
        : tourDocumentActions.redone(),
    );
    return { kind: which === "undo" ? "undone" : "redone", what: next.what };
  }

  /** A draft's details put back by the dialog's own checks (a record
   *  whose details the format would drop leaves them as they are), against
   *  `state` (the draft's objects already put back: a cover may name one). */
  function restoredDetails(
    state: TourDocumentState,
    offered: TourDetailFields,
  ): TourDetailFields | null {
    const was = effectiveDetails(state);
    const checked = checkDetailsForm(
      {
        name: offered.title ?? "",
        description: offered.description ?? "",
        cover: offered.cover ?? null,
        contact: offered.contact ?? "",
      },
      coverIds(state),
      was,
      "drop",
    );
    if (!checked.ok) return null;
    return DETAIL_FIELDS.some((f) => checked.details[f] !== was[f])
      ? checked.details
      : null;
  }

  return {
    model() {
      return buildEditorModel({
        manifest: now(),
        objects: current(),
        levels,
        fileName: shownName,
      });
    },
    changeCount() {
      return changeCount(own());
    },
    pendingIds() {
      return unsavedEntries(own()).map((p) => p.object.id);
    },
    savedName() {
      return savedName;
    },
    needsNoGps() {
      return own().needsNoGps;
    },
    setNeedsNoGps(on) {
      const state = mine();
      if (state === null || on === state.needsNoGps) {
        return { kind: "unchanged" };
      }
      store.dispatch(
        tourDocumentActions.settingsChanged({
          needsNoGps: on,
          what: 'the "needs no GPS" setting',
        }),
      );
      return { kind: "changed" };
    },
    details() {
      const shown = effectiveDetails(own());
      return {
        name: shown.title ?? "",
        description: shown.description ?? "",
        cover: shown.cover ?? null,
        contact: shown.contact ?? "",
      };
    },
    setDetails(next) {
      const state = mine();
      if (state === null) return notInTour;
      const change = detailsChange(state, next);
      if (change.kind !== "changed") return change;
      store.dispatch(
        tourDocumentActions.detailsChanged({
          details: change.details,
          what: "the tour details",
        }),
      );
      return { kind: "changed" };
    },
    coverChoices() {
      const tour = { objects: current(), assets: written().assets };
      return [...coverIds()].flatMap((id) => {
        const image = tourCoverEntry({ ...tour, cover: id });
        return image === null ? [] : [{ id, image }];
      });
    },
    noGpsCheck() {
      return checkNoGps({ stations: now().stations, levels });
    },
    editText(id, text) {
      const state = mine();
      if (state === null) return notInTour;
      const edit = pinTextChange(state, id, text);
      if (edit.kind === "missing") return notInTour;
      if (edit.kind !== "edited") return edit;
      store.dispatch(
        tourDocumentActions.edited({
          object: edit.after,
          what: `the text of ${objectName(edit.after)}`,
        }),
      );
      return { kind: "edited" };
    },
    move(id, lat, lon) {
      const state = mine();
      if (state === null) return notInTour;
      const change = objectMoveChange(state, id, lat, lon);
      if (change.kind === "missing") return notInTour;
      store.dispatch(
        tourDocumentActions.moved({
          object: change.after,
          what: `the move of ${objectName(change.before)}`,
        }),
      );
      return { kind: "moved" };
    },
    place(object) {
      const state = mine();
      if (state === null) return notInTour;
      if (find(object.id) !== undefined) {
        return { kind: "refused", reason: ALREADY_IN_TOUR };
      }
      if (!objectFits(state, object)) {
        return { kind: "refused", reason: TOO_FAR_FROM_STATION };
      }
      store.dispatch(
        tourDocumentActions.placed({
          object,
          what: `the placement of ${objectName(object)}`,
        }),
      );
      return { kind: "placed" };
    },
    moveStation(stationId, geo) {
      const state = mine();
      const station = state?.stations.find((s) => s.id === stationId);
      if (station === undefined) {
        return { kind: "refused", reason: NO_SUCH_STATION };
      }
      store.dispatch(
        tourDocumentActions.stationMoved({
          stationId,
          geo,
          what: `the move of ${station.title === undefined ? "a station" : `"${station.title}"`}`,
        }),
      );
      return { kind: "moved" };
    },
    remove(id) {
      const found = find(id);
      if (found === undefined) return notInTour;
      keepPicture(found);
      store.dispatch(
        tourDocumentActions.deleted({
          id,
          what: `the delete of ${objectName(found.object)}`,
        }),
      );
      return { kind: "deleted" };
    },
    undo() {
      return step("undo");
    },
    redo() {
      return step("redo");
    },
    revision() {
      return own().revision;
    },
    pictureOf(id) {
      return unsavedEntries(own()).some((p) => p.object.id === id)
        ? pictures.get(id)
        : undefined;
    },
    restore(work) {
      const state = mine();
      if (state === null) return { changed: 0, deleted: 0 };
      const live = new Set([
        ...state.placed.map((p) => p.object.id),
        ...state.deleted,
      ]);
      const settings = work.settings;
      // The draft's station poses (D17; the r875 milestone review #1) -
      // unless a frame was moved here meanwhile: live work wins. Only a
      // station the tour carries, at a pose other than its own.
      const stations = (
        settings?.stations === undefined || state.touched.stations
          ? []
          : settings.stations
      ).filter((pose) => {
        const frame = state.stations.find((s) => s.id === pose.id);
        return (
          frame !== undefined &&
          JSON.stringify(frame.geo) !== JSON.stringify(pose.geo)
        );
      });
      // An object its station cannot carry (a draft written before far
      // moves re-ran the station rule) is seated by the rule as the
      // restore puts it back (`restored`), never skipped.
      const objects = work.objects.filter(
        (object) => !live.has(object.id) && find(object.id) !== undefined,
      );
      const deleted = work.deleted.filter(
        (id) => !live.has(id) && find(id) !== undefined,
      );
      // The stations the draft's objects were seated in that the tour
      // lacks (a far move started one), whole: back before the objects.
      const created = settings?.createdStations ?? [];
      const createdStations =
        created.length === 0 ? {} : { createdStations: created };
      const needsNoGps =
        settings !== undefined &&
        !state.touched.needsNoGps &&
        settings.needsNoGps !== state.needsNoGps
          ? settings.needsNoGps
          : undefined;
      // The details against the tour with the draft's objects back: a
      // cover may name a photo they bring.
      const withObjects = tourDocumentReducer(
        state,
        tourDocumentActions.restored({
          objects,
          deleted,
          ...(stations.length === 0 ? {} : { stations }),
          ...createdStations,
          what: "",
        }),
      );
      const details =
        settings?.details === undefined || state.touched.details
          ? null
          : restoredDetails(withObjects, settings.details);
      const was = effectiveDetails(withObjects);
      const detailFields =
        details === null
          ? 0
          : DETAIL_FIELDS.filter((f) => details[f] !== was[f]).length;
      const changed =
        objects.length +
        stations.length +
        (needsNoGps === undefined ? 0 : 1) +
        detailFields;
      if (changed + deleted.length > 0) {
        store.dispatch(
          tourDocumentActions.restored({
            objects,
            deleted,
            ...(needsNoGps === undefined ? {} : { needsNoGps }),
            ...(details === null ? {} : { details }),
            ...(stations.length === 0 ? {} : { stations }),
            ...createdStations,
            what: "the restored changes",
          }),
        );
      }
      return { changed, deleted: deleted.length };
    },
    save(options) {
      // The document's save (`tour-document-save.ts`): a thunk, queued with
      // the moves of the walk.
      return dispatchThunk(store, saves.save(options)).then(saveOf);
    },
    async walkEntries() {
      return scanEntryNames(
        await newestNames(),
        written(),
        session.manifestWrap,
      );
    },
    moveWalkOut() {
      return dispatchThunk(store, saves.queued(buildWalkMove));
    },
  };

  /** The newest bytes' entry names: the last save's, else the opened
   *  file's. */
  async function newestNames(): Promise<string[]> {
    const newest = saves.newest();
    return newest === null
      ? session.entries.map((e) => e.filename)
      : zipBlobEntryNames(newest.blob);
  }

  function saveOf({ finished, photos }: TourSaveBuilt): EditorSave {
    return {
      blob: finished.blob,
      filename: savedName,
      scanLeftOut: finished.scanLeftOut,
      written: finished.written,
      ...(photos.notPlaced === undefined
        ? {}
        : { notPlaced: photos.notPlaced }),
    };
  }

  /** The move of the walk out (D19), built from the newest bytes. */
  async function buildWalkMove(): Promise<WalkMove | EditorRefusal> {
    if (mine() === null) return { kind: "refused", reason: TOUR_REPLACED };
    const snap = dispatchThunk(store, saves.snapshot());
    const base = saves.newest();
    const wrap = session.manifestWrap;
    const names = await newestNames();
    if (scanEntryNames(names, snap.manifest, wrap).length === 0) {
      return { kind: "refused", reason: NO_WALK };
    }
    const photos = await saves.photoSpots(snap.manifest);
    // Without baked spots the walk is what places the recorded photos: the
    // rebuild would keep it (`finish-rebuild.ts`), so the move refuses -
    // unless the walk places nothing (the M4b milestone review #3).
    if (photos.spots === undefined && photos.placesNothing !== true) {
      return { kind: "refused", reason: walkStaysReason(photos.notPlaced) };
    }
    // The walk's own file is the whole recording (the M4b milestone review
    // #8): the frames the tour keeps for its visitors too, so it is a
    // complete recording on its own.
    const recording = new Set(recordingEntryNames(names));
    const source = base === null ? await session.readWholeArchive() : base.blob;
    const walkBlob = await rebuildZipWithEntries(
      source,
      [
        {
          path: WALK_NOTE,
          data: walkNoteText({
            fileName: savedName,
            title: snap.manifest.title,
            seriesId:
              session.integrity.kind === "listed"
                ? session.integrity.manifest.seriesId
                : null,
          }),
        },
      ],
      {
        remove: names.filter((name) => !recording.has(name)),
        // The opened file is untrusted: read under the session's budget, as
        // the rebuild below reads it (K0 milestone review R1).
        ...(base === null ? { budget: session.budget } : {}),
      },
    );
    // From the same bytes, read once (review #11).
    const finished = await saves.rebuild(
      snap,
      photos,
      false,
      base === null ? source : undefined,
    );
    return {
      kind: "ready",
      walk: { blob: walkBlob, filename: walkFileName(savedName) },
      save: saveOf({ finished, photos }),
      current: () => saves.newest() === base,
      commit(inPlace) {
        if (saves.newest() !== base) {
          throw new Error(
            "another save landed while the walk was moved out - move it again",
          );
        }
        dispatchThunk(store, saves.land(finished, snap, inPlace));
      },
    };
  }
}
