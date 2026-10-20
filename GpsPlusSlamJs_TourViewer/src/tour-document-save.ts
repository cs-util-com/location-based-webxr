/**
 * The tour document's save (the follow-up of D30): a page's Save of the
 * open tour as thunks against the store. The snapshot is the document's
 * (taken when the save STARTS, after the saves queued before it - at the
 * dispatch only when none runs), the file is rebuilt by the Finish's
 * rules from the newest bytes (`finish-rebuild.ts`), and what it wrote
 * lands in the document (`saved`). Saves run one after another, counted
 * by the document (`saveStarted` / `saveEnded`): its save status is the
 * one place that says a save runs, landed or failed, and an undo waits
 * for it (`canStep`). What a save keeps between saves is imperative only -
 * the newest bytes, the photo spots' decision, the queue's tail - and
 * lives in the handle `createTourSaves` returns, one per open.
 *
 * @see tour-document-save.ts.md
 */

import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { SignedTourManifest } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { hostedObjects } from "./authoring-draft.js";
import {
  finishedFileName,
  rebuildFinishedTour,
  type FinishedTour,
} from "./finish-rebuild.js";
import type { RebuildPhotoSpots } from "./tour-document-bake.js";
import {
  historyAssetIds,
  manifestNow,
  tourDocumentActions,
  type StationFrame,
  type TourDocumentState,
} from "./tour-document.js";
import type { TourSession } from "./tour-session.js";

/** The store's state as a save reads it. */
interface TourDocumentRoot {
  readonly tourDocument: TourDocumentState;
}

/** A thunk against a store that holds the tour document. */
type TourDocumentThunk<R> = ThunkAction<
  R,
  TourDocumentRoot,
  unknown,
  UnknownAction
>;

/** A store that holds the tour document and runs Redux Toolkit's default
 *  middleware (`createTourViewerStore`): the thunk middleware among it. */
interface ThunkStore {
  dispatch(action: UnknownAction): unknown;
  getState(): TourDocumentRoot;
}

/**
 * Dispatch a document thunk into `store`, through its middleware. The
 * framework's store runs the thunk middleware, but its type names only
 * plain actions - this is the one place that says otherwise (a store
 * without the middleware refuses the function: Redux throws "Actions must
 * be plain objects").
 */
export function dispatchThunk<R>(
  store: ThunkStore,
  thunk: TourDocumentThunk<R>,
): R {
  return store.dispatch(thunk as unknown as UnknownAction) as R;
}

/** Said for a save asked of an open another open replaced: its bytes
 *  would be built for a tour no page shows. */
export const TOUR_REPLACED =
  "Another tour was opened since: this one is no longer open here.";

/** The newest bytes of this open: the last landed save's. */
interface NewestBytes {
  readonly blob: Blob;
  readonly signedManifest?: SignedTourManifest;
}

/** What a save reads from the document, all at once before its first
 *  await: an edit made from then on waits for the next save
 *  (`pendingAfterRebuild`, by content). */
interface TourSaveSnapshot {
  /** The entries, a photo the written file has no picture for with the
   *  one the page kept (an undo brought it back after a save took it
   *  out). */
  readonly placed: readonly {
    readonly object: TourObject;
    readonly blob?: Blob;
  }[];
  readonly deleted: readonly string[];
  /** The manifest the write starts from (`manifestNow`). */
  readonly manifest: TourManifest;
  /** The assets the history still names (`historyAssetIds`): kept. */
  readonly keepAssets: ReadonlySet<string>;
  /** The frames it starts from: one moved while it runs stays the
   *  document's (`saved`). */
  readonly stationsAtStart: readonly StationFrame[];
  /** The history position of the view it writes (`TourDocumentState`
   *  `position`): an in-place write names it (`saved`'s `inPlaceAt`). */
  readonly position: number;
}

/** A save that landed: the file it built and the photo spots it used. */
export interface TourSaveBuilt {
  readonly finished: FinishedTour;
  readonly photos: RebuildPhotoSpots;
}

interface TourSaves {
  /** The name every save of this open is written under: the opened
   *  file's, made safe (the Finish's rule, `finishedFileName`). */
  readonly fileName: string;
  /** The newest bytes this open's saves wrote; null before one landed
   *  (a rebuild then reads the opened file). */
  newest(): NewestBytes | null;
  /** One save, queued behind the ones before it: the snapshot taken when
   *  it starts, the photo spots, the rebuild, the landing. Rejects with
   *  `TOUR_REPLACED` when another open replaced this one before it
   *  started, and with the rebuild's own error; the slice says either
   *  (`saveEnded`'s `error`). */
  save(options: {
    readonly keepScan: boolean;
    /** The file built goes over the opened file (the page writes it in
     *  place): the document then knows where in its history the file on
     *  disk stands (D33). Default: a download. */
    readonly inPlace?: boolean;
  }): TourDocumentThunk<Promise<TourSaveBuilt>>;
  /** Run `start` after the saves queued before it (at once when none
   *  runs: its first steps run inside the dispatch), counted by the
   *  document - ended BEFORE the caller hears the end, so an undo asked
   *  for right after an awaited save is not refused. */
  queued<T>(start: () => Promise<T>): TourDocumentThunk<Promise<T>>;
  /** The document as a save reads it now. */
  snapshot(): TourDocumentThunk<TourSaveSnapshot>;
  /** What the open's bake decided about the walk's photos (`walkAtOpen`:
   *  once per open, never at a save), after the pictures being read
   *  (before a rebuild replaces the bytes they may be read from). */
  photoSpots(): Promise<RebuildPhotoSpots>;
  /** The file rebuilt from the newest bytes - or from `whole`, the opened
   *  file as the caller already read it, so it is not read twice. Throws
   *  what the rebuild throws. */
  rebuild(
    snap: TourSaveSnapshot,
    photos: RebuildPhotoSpots,
    keepScan: boolean,
    whole?: Blob,
  ): Promise<FinishedTour>;
  /** `finished` becomes the newest bytes and the document's written file
   *  (`saved`; nowhere for a tour opened since); `inPlace`: it goes over
   *  the opened file. */
  land(
    finished: FinishedTour,
    snap: TourSaveSnapshot,
    inPlace?: boolean,
  ): TourDocumentThunk<void>;
}

export function createTourSaves(input: {
  /** The open tour's bytes and their reads. */
  readonly tour: TourSession;
  /** The open the saves belong to (`TourDocumentState.generation`). */
  readonly generation: number;
  /** A photo's picture the page keeps (the side table: Blobs are never
   *  state). */
  readonly pictureOf: (id: string) => Blob | undefined;
  /** Settles once the pictures being read are read. */
  readonly picturesRead: () => Promise<unknown>;
  /** What the open's bake decided (`walkAtOpen`); absent: nothing to say
   *  (no recording, or the tour had its photos). */
  readonly photos?: RebuildPhotoSpots;
}): TourSaves {
  const { tour, generation } = input;
  let newest: NewestBytes | null = null;
  /** What the open's bake decided (`walkAtOpen`). */
  const atOpen = input.photos ?? {};
  /** The end of the last queued run, for the next to start after. */
  let tail: Promise<unknown> = Promise.resolve();

  function snapshotOf(state: TourDocumentState): TourSaveSnapshot {
    const manifest = manifestNow(state);
    if (manifest === null) throw new Error("no tour is open to save");
    const hosted = hostedObjects(state.written);
    return {
      placed: state.placed.map(({ object }) => {
        const blob =
          object.kind === "photo" && hosted.key(object.id) === undefined
            ? input.pictureOf(object.id)
            : undefined;
        return blob === undefined ? { object } : { object, blob };
      }),
      deleted: [...state.deleted],
      manifest,
      keepAssets: historyAssetIds(state),
      stationsAtStart: state.stations,
      position: state.position,
    };
  }

  const saves: TourSaves = {
    fileName: finishedFileName(tour),
    newest: () => newest,
    save(options) {
      return (dispatch, getState) =>
        dispatch(
          saves.queued(async () => {
            const state = getState().tourDocument;
            if (state.generation !== generation) {
              throw new Error(TOUR_REPLACED);
            }
            const snap = snapshotOf(state);
            const photos = await saves.photoSpots();
            const finished = await saves.rebuild(
              snap,
              photos,
              options.keepScan,
            );
            dispatch(saves.land(finished, snap, options.inPlace === true));
            return { finished, photos };
          }),
        );
    },
    queued(start) {
      return (dispatch, getState) => {
        const state = getState().tourDocument;
        const running =
          state.generation === generation && state.save.rebuilds > 0;
        // The tail never rejects (`next.catch` below).
        const run = running ? tail.then(start) : start();
        dispatch(tourDocumentActions.saveStarted({ generation }));
        const next = run.then(
          (value) => {
            dispatch(tourDocumentActions.saveEnded({ generation }));
            return value;
          },
          (err: unknown) => {
            dispatch(
              tourDocumentActions.saveEnded({
                generation,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            throw err;
          },
        );
        tail = next.catch(() => undefined);
        return next;
      };
    },
    snapshot() {
      return (_dispatch, getState) => snapshotOf(getState().tourDocument);
    },
    async photoSpots() {
      await input.picturesRead();
      return atOpen;
    },
    async rebuild(snap, decided, keepScan, whole) {
      const finished = await rebuildFinishedTour({
        tour:
          whole === undefined
            ? tour
            : {
                entries: tour.entries,
                manifestWrap: tour.manifestWrap,
                integrity: tour.integrity,
                budget: tour.budget,
                readWholeArchive: () => Promise.resolve(whole),
              },
        manifest: snap.manifest,
        placed: snap.placed,
        deleted: snap.deleted,
        keepAssets: snap.keepAssets,
        levels: [],
        keepScan,
        previous: newest,
      });
      if (finished === null) throw new Error("the save was stopped");
      return finished;
    },
    land(finished, snap, inPlace = false) {
      return (dispatch) => {
        newest = {
          blob: finished.blob,
          ...(finished.signedManifest === undefined
            ? {}
            : { signedManifest: finished.signedManifest }),
        };
        dispatch(
          tourDocumentActions.saved({
            generation,
            written: finished.written,
            appliedDeletions: snap.deleted,
            stationsAtStart: snap.stationsAtStart,
            ...(inPlace ? { inPlaceAt: snap.position } : {}),
          }),
        );
      };
    },
  };
  return saves;
}
