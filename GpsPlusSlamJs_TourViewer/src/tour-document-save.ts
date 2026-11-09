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
 * the newest bytes and the queue's tail - and lives in the handle
 * `createTourSaves` returns, one per open.
 *
 * @see tour-document-save.ts.md
 */

import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { SignedTourManifest } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { DEFAULT_ARCHIVE_LIMITS } from "gps-plus-slam-app-framework/storage";
import { hostedObjects } from "./authoring-draft.js";
import {
  finishedFileName,
  rebuildFinishedTour,
  type FinishedTour,
} from "./finish-rebuild.js";
import { isCapturedPhoto } from "./tour-content.js";
import {
  assetBytesPending,
  historyAssetIds,
  historyStoryAssetIds,
  historyTimingEntries,
  manifestNow,
  manifestToWrite,
  tourDocumentActions,
  type StationFrame,
  type TourDocumentState,
} from "./tour-document.js";
import { visitorEntryNames } from "./tour-read-set.js";
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
  readonly keepStoryAssets: ReadonlySet<string>;
  /** The read-along entries the history still names
   *  (`historyTimingEntries`): kept. */
  readonly keepEntries: ReadonlySet<string>;
  /** The frames it starts from: one moved while it runs stays the
   *  document's (`saved`). */
  readonly stationsAtStart: readonly StationFrame[];
  /** The history position of the view it writes (`TourDocumentState`
   *  `position`): an in-place write names it (`saved`'s `inPlaceAt`). */
  readonly position: number;
  /** The read-along texts set here (`timings`), by entry. */
  readonly timings: Readonly<Record<string, string | null>>;
  /** What the write carries besides the manifest and the photos, by path
   *  in the tour's folder: each read-along text set here that the written
   *  file does not hold, and each file brought in here that it does not
   *  list, with the bytes the page keeps. The rebuild writes the ones the
   *  written tour names. */
  readonly files: readonly {
    readonly path: string;
    readonly data: string | Blob;
  }[];
  /** The written file's entries a smaller file replaced (`replacedOf`):
   *  removed, whatever the write keeps. */
  readonly replaced: readonly string[];
  /** The swap counts it starts from (`saved`'s `swaps`). */
  readonly swaps: Readonly<Record<string, number>>;
  /** The bytes it writes for each asset, by id (`SavedTour.wrote`). */
  readonly wrote: ReadonlyMap<string, Blob>;
}

/** A save's file, and the bytes it wrote for each asset, by id: a draft
 *  spends a smaller file only when these are its bytes, since the same
 *  path may hold other bytes (a save that started before the swap). */
export type SavedTour = FinishedTour & {
  readonly wrote: ReadonlyMap<string, Blob>;
};

interface TourSaves {
  /** The name every save of this open is written under: the opened
   *  file's, made safe (the Finish's rule, `finishedFileName`). */
  readonly fileName: string;
  /** The newest bytes this open's saves wrote; null before one landed
   *  (a rebuild then reads the opened file). */
  newest(): NewestBytes | null;
  /** One save, queued behind the ones before it: the snapshot taken when
   *  it starts, the pictures' reads, the rebuild, the landing; it resolves
   *  to the file built. Rejects with
   *  `TOUR_REPLACED` when another open replaced this one before it
   *  started, and with the rebuild's own error; the slice says either
   *  (`saveEnded`'s `error`). */
  save(options: {
    readonly keepScan: boolean;
    /** The file built goes over the opened file (the page writes it in
     *  place): the document then knows where in its history the file on
     *  disk stands (D33). Default: a download. */
    readonly inPlace?: boolean;
  }): TourDocumentThunk<Promise<SavedTour>>;
  /** Run `start` after the saves queued before it (at once when none
   *  runs: its first steps run inside the dispatch), counted by the
   *  document - ended BEFORE the caller hears the end, so an undo asked
   *  for right after an awaited save is not refused. */
  queued<T>(start: () => Promise<T>): TourDocumentThunk<Promise<T>>;
  /** The document as a save reads it now. */
  snapshot(): TourDocumentThunk<TourSaveSnapshot>;
  /** The bytes a save of `state` adds to the written file: the pictures
   *  of the captured photos it does not host, the timing texts and the
   *  files brought in it lacks (the snapshot's own rule), less the old
   *  entries a smaller file replaces (`assetOptimized`): below zero when
   *  the swaps save more than the rest adds. With
   *  `keptOnly`, only the files the write keeps: one nothing names (an
   *  undo took it out and a later edit dropped its redo, or a file not
   *  named yet) is left out. */
  addedBytes(state: TourDocumentState, keptOnly?: boolean): number;
  /** Settles once the pictures being read are read: a rebuild waits for
   *  it, since it replaces the bytes they may be read from. */
  picturesRead(): Promise<void>;
  /** The file rebuilt from the newest bytes - or from `whole`, the opened
   *  file as the caller already read it, so it is not read twice. Throws
   *  what the rebuild throws. */
  rebuild(
    snap: TourSaveSnapshot,
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
  /** A file's bytes the page keeps, by asset id (its files table: Blobs
   *  are never state) - a file brought in (`addedAssets`), a photo's
   *  picture (a captured photo's id is its picture's). */
  readonly fileOf: (id: string) => Blob | undefined;
  /** Settles once the pictures being read are read. */
  readonly picturesRead: () => Promise<unknown>;
  /** The largest file a save writes (default: the archive's entry cap);
   *  a larger one, or a picture over the pixel cap, refuses the save. */
  readonly maxFileBytes?: number;
  /** The name a file brought in had, by asset id, for that refusal's
   *  words. */
  readonly fileNameOf?: (id: string) => string | undefined;
  /** Whether a job is making the file of asset `id` smaller now (queued
   *  or running), so that refusal can say so; absent: it says so always. */
  readonly shrinking?: (id: string) => boolean;
}): TourSaves {
  const { tour, generation } = input;
  let newest: NewestBytes | null = null;
  /** The end of the last queued run, for the next to start after. */
  let tail: Promise<unknown> = Promise.resolve();
  /** The newest bytes' entry sizes, by path in the tour's folder: the
   *  opened file's, then each landed save's files written and entries
   *  replaced. What a swap's old entry takes out of the next save
   *  (`addedBytes`); an entry not known here counts 0. */
  const entrySizes = new Map(
    tour.entries.flatMap((e) =>
      e.filename.startsWith(tour.manifestWrap)
        ? [[e.filename.slice(tour.manifestWrap.length), e.size] as const]
        : [],
    ),
  );

  function snapshotOf(state: TourDocumentState): TourSaveSnapshot {
    const manifest = manifestNow(state);
    if (manifest === null) throw new Error("no tour is open to save");
    return {
      placed: placedOf(state),
      deleted: [...state.deleted],
      manifest,
      keepAssets: historyAssetIds(state),
      keepStoryAssets: historyStoryAssetIds(state),
      keepEntries: historyTimingEntries(state),
      stationsAtStart: state.stations,
      position: state.position,
      timings: state.timings,
      files: filesOf(state),
      replaced: replacedOf(state),
      swaps: state.assetSwaps,
      wrote: new Map(assetFilesOf(state).map((f) => [f.id, f.blob])),
    };
  }

  /** The manifest a save of `state` writes; null when none can be built
   *  (then every file counts). */
  function writtenOrNull(state: TourDocumentState): TourManifest | null {
    try {
      return manifestToWrite(state);
    } catch {
      return null;
    }
  }

  /** The snapshot's `placed`: a captured photo the written file does not
   *  host carries its picture, which the save writes. */
  function placedOf(state: TourDocumentState): TourSaveSnapshot["placed"] {
    const hosted = hostedObjects(state.written);
    return state.placed.map(({ object }) => {
      const blob =
        isCapturedPhoto(object) && hosted.key(object.id) === undefined
          ? input.fileOf(object.id)
          : undefined;
      return blob === undefined ? { object } : { object, blob };
    });
  }

  /** The files brought in or replaced here whose bytes the written file
   *  lacks (`assetBytesPending`): at another path, or other bytes at the
   *  same path (a smaller file of the same format, the original put back),
   *  with the bytes the page keeps. */
  function assetFilesOf(
    state: TourDocumentState,
  ): { readonly id: string; readonly path: string; readonly blob: Blob }[] {
    return state.addedAssets.flatMap((asset) => {
      const blob = assetBytesPending(state, asset.id)
        ? input.fileOf(asset.id)
        : undefined;
      return blob === undefined
        ? []
        : [{ id: asset.id, path: asset.path, blob }];
    });
  }

  /** The snapshot's `files`: the texts the written file lacks, and the
   *  files `assetFilesOf` names. */
  function filesOf(state: TourDocumentState): TourSaveSnapshot["files"] {
    return [
      ...Object.entries(state.timings).flatMap(([path, text]) =>
        text === null || text === state.timingsWritten[path]
          ? []
          : [{ path, data: text }],
      ),
      ...assetFilesOf(state).map(({ path, blob }) => ({ path, data: blob })),
    ];
  }

  /** The written file's entries a save of `state` writes again at the same
   *  path: what they held leaves the file (`addedBytes`). */
  function rewrittenOf(state: TourDocumentState): readonly string[] {
    const listed = writtenPaths(state);
    return assetFilesOf(state).flatMap(({ id, path }) =>
      listed.get(id) === path ? [path] : [],
    );
  }

  /** The snapshot's `replaced`: the written path of each asset whose
   *  record here names another path (`assetOptimized`). Derived from the
   *  paths, so a save already running when the swap lands leaves it to
   *  the next one. */
  function replacedOf(state: TourDocumentState): readonly string[] {
    const listed = writtenPaths(state);
    return state.addedAssets.flatMap((asset) => {
      const was = listed.get(asset.id);
      return was === undefined || was === asset.path ? [] : [was];
    });
  }

  /** The words refusing a save of `snap`: a file it writes is over the
   *  entry cap (or a picture over the pixel cap), so no reader would open
   *  the zip - an original still being made smaller. Null when none is. */
  function oversizedFile(snap: TourSaveSnapshot): string | null {
    const maxBytes = input.maxFileBytes ?? DEFAULT_ARCHIVE_LIMITS.maxEntryBytes;
    for (const { path, data } of snap.files) {
      const asset = snap.manifest.assets.find((a) => a.path === path);
      if (asset === undefined || typeof data === "string") continue;
      const pixels = (asset.width ?? 0) * (asset.height ?? 0);
      if (data.size <= maxBytes && pixels <= TOUR_MAX_IMAGE_PIXELS) continue;
      const name = input.fileNameOf?.(asset.id);
      const what =
        name === undefined
          ? `${KIND_WORDS[asset.kind]} of this tour`
          : `"${name}"`;
      return input.shrinking?.(asset.id) === false
        ? `${what} is too large to save, and nothing is making it smaller. Use a smaller file, or remove it.`
        : `${what} is still too large to save - it is being made smaller. Save again once it is ready, or remove it.`;
    }
    return null;
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
            await saves.picturesRead();
            const finished = await saves.rebuild(snap, options.keepScan);
            dispatch(saves.land(finished, snap, options.inPlace === true));
            return { ...finished, wrote: snap.wrote };
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
    addedBytes(state, keptOnly = false) {
      const encoder = new TextEncoder();
      let sum = 0;
      for (const placed of placedOf(state)) sum += placed.blob?.size ?? 0;
      const files = filesOf(state);
      // `keptOnly`: what the save keeps (the rebuild's own filter); a file
      // no object or step names any more is left out of it.
      const written = keptOnly ? writtenOrNull(state) : null;
      const kept =
        written === null
          ? null
          : visitorEntryNames(
              files.map((file) => file.path),
              written,
              "",
            );
      for (const { path, data } of files) {
        if (kept !== null && !kept.has(path)) continue;
        sum += sizeOf(data, encoder);
      }
      // The old entries a smaller file replaces leave the file, and so do
      // the old bytes of an entry written again at its path.
      for (const path of [...replacedOf(state), ...rewrittenOf(state)]) {
        sum -= entrySizes.get(path) ?? 0;
      }
      return sum;
    },
    async picturesRead() {
      await input.picturesRead();
    },
    async rebuild(snap, keepScan, whole) {
      const oversized = oversizedFile(snap);
      if (oversized !== null) throw new Error(oversized);
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
        keepStoryAssets: snap.keepStoryAssets,
        keepEntries: snap.keepEntries,
        files: snap.files,
        replaced: snap.replaced,
        levels: [],
        keepScan,
        previous: newest,
      });
      if (finished === null) throw new Error("the save was stopped");
      return finished;
    },
    land(finished, snap, inPlace = false) {
      return (dispatch) => {
        const encoder = new TextEncoder();
        for (const path of snap.replaced) entrySizes.delete(path);
        for (const { path, data } of snap.files) {
          entrySizes.set(path, sizeOf(data, encoder));
        }
        newest = {
          blob: finished.blob,
          ...(finished.signedManifest === undefined
            ? {}
            : { signedManifest: finished.signedManifest }),
        };
        // Each text set here is what the file holds where the written
        // tour names its entry, and none where it does not (a write leaves
        // an entry nothing names out).
        const wrap = tour.manifestWrap;
        const entries = Object.keys(snap.timings);
        const named = visitorEntryNames(
          entries.map((entry) => `${wrap}${entry}`),
          finished.written,
          wrap,
        );
        dispatch(
          tourDocumentActions.saved({
            generation,
            written: finished.written,
            appliedDeletions: snap.deleted,
            stationsAtStart: snap.stationsAtStart,
            swaps: snap.swaps,
            ...(inPlace ? { inPlaceAt: snap.position } : {}),
            ...(entries.length === 0
              ? {}
              : {
                  timings: Object.fromEntries(
                    entries.map((entry) => [
                      entry,
                      named.has(`${wrap}${entry}`)
                        ? (snap.timings[entry] ?? null)
                        : null,
                    ]),
                  ),
                }),
          }),
        );
      };
    },
  };
  return saves;
}

/** A kind as the oversized refusal names it, at the start of a sentence. */
const KIND_WORDS = {
  image: "A picture",
  audio: "A sound",
  video: "A video",
  model: "A 3D model",
} as const;

/** The bytes `data` takes in the zip (a text as UTF-8). */
function sizeOf(data: string | Blob, encoder: TextEncoder): number {
  return typeof data === "string" ? encoder.encode(data).byteLength : data.size;
}

/** The written file's asset paths, by asset id. */
function writtenPaths(state: TourDocumentState): ReadonlyMap<string, string> {
  return new Map((state.written?.assets ?? []).map((a) => [a.id, a.path]));
}
