/**
 * The feature matching check page's store and its side effects: the
 * stored progress read back at start and written by a listener whenever
 * it changes, and the side tables beside the state - frames, results,
 * Blob URLs and the flat target photos - kept in step with it (an entry
 * the state no longer names is dropped, a URL revoked). The camera,
 * canvases, ORT sessions and timers stay in the views.
 *
 * @see feature-match-store.ts.md
 */
import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";

import { parseProgress, progressText, type SavedFrame } from "./bench-export";
import type { Frame } from "./bench-image";
import type { MethodResult } from "./bench-run";
import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  type FeatureMatchState,
} from "./feature-match-slice";
import {
  afterReload,
  flatProgressText,
  parseFlatProgress,
  unsavedCount,
  type SurfaceProgress,
} from "./flat-progress";
import type { PoseId } from "./flat-target";

/** The running number, pair and spot, kept across a reload. */
export const PROGRESS_KEY = "feature-match-check.progress";
/** The flat target progress, kept across reloads. */
export const FLAT_PROGRESS_KEY = "feature-match-check.flat-progress";

/** `localStorage`'s two calls; either may throw (storage blocked). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One surface's photos, in memory only until downloaded. */
export interface SurfacePhotos {
  reference: Frame | null;
  rectified: Frame | null;
  /** Keyed by `shotKey`. */
  readonly shots: Map<string, Frame>;
  original: File | null;
  /** The camera stream's size when the reference was taken. */
  camera: { width: number; height: number } | null;
}

/** What lives beside the store, keyed by the ids the state holds. */
export interface FeatureMatchSides {
  /** The camera photos, by `PhotoMeta.id`. */
  readonly frames: Map<string, SavedFrame>;
  /** The camera run's results, by `resultsId`. */
  readonly results: Map<string, readonly MethodResult[]>;
  /** Blob URLs of offered files and the prepared flat zip, by id. */
  readonly urls: Map<string, string>;
  /** The flat reference being marked and its preview, by `FrameMeta.id`. */
  readonly flatFrames: Map<string, Frame>;
  /** The flat target photos, by surface id. */
  readonly flatPhotos: Map<number, SurfacePhotos>;
}

export const shotKey = (pose: PoseId, q: number): string =>
  `${pose}#${String(q)}`;

export interface FeatureMatchStoreDeps {
  readonly storage: KeyValueStorage;
  readonly session: string;
  /** `URL.revokeObjectURL`. */
  readonly revokeUrl: (url: string) => void;
}

function readStored<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    // Storage blocked: start over.
    return fallback;
  }
}

function write(storage: KeyValueStorage, key: string, text: string): void {
  try {
    storage.setItem(key, text);
  } catch {
    // Storage blocked: the progress lasts as long as the page.
  }
}

/** Drops every side table entry the state no longer names. */
function reconcile(
  s: FeatureMatchState,
  sides: FeatureMatchSides,
  revokeUrl: (url: string) => void,
): void {
  const photoIds = new Set([s.photos.a?.id, s.photos.b?.id]);
  for (const id of sides.frames.keys()) {
    if (!photoIds.has(id)) {
      sides.frames.delete(id);
    }
  }
  for (const id of sides.results.keys()) {
    if (id !== s.resultsId) {
      sides.results.delete(id);
    }
  }
  const urlIds = new Set(s.offered.map((o) => o.id));
  if (s.flat.prepared) {
    urlIds.add(s.flat.prepared.urlId);
  }
  for (const [id, url] of sides.urls) {
    if (!urlIds.has(id)) {
      revokeUrl(url);
      sides.urls.delete(id);
    }
  }
  const flatIds = new Set([s.flat.still?.id, s.flat.preview?.id]);
  for (const id of sides.flatFrames.keys()) {
    if (!flatIds.has(id)) {
      sides.flatFrames.delete(id);
    }
  }
  for (const [id, photos] of sides.flatPhotos) {
    const surface = s.flat.progress.surfaces.find((x) => x.id === id);
    if (!surface) {
      sides.flatPhotos.delete(id);
      continue;
    }
    const keys = new Set(surface.shots.map((x) => shotKey(x.pose, x.q)));
    for (const k of photos.shots.keys()) {
      if (!keys.has(k)) {
        photos.shots.delete(k);
      }
    }
  }
}

/** What of a surface exists only in this page, an attached original included. */
const unsavedHere = (x: SurfaceProgress, sides: FeatureMatchSides): number =>
  unsavedCount(x, (sides.flatPhotos.get(x.id)?.original ?? null) !== null);

/**
 * Frees the photos of every surface but `keep` with nothing left to
 * download, so a long session does not keep every surface's frames in
 * memory. A later zip of such a surface lists its earlier photos with a
 * null file, as after a reload.
 */
function freeOtherPhotos(
  s: FeatureMatchState,
  sides: FeatureMatchSides,
  keep: number | null,
): void {
  for (const x of s.flat.progress.surfaces) {
    if (x.id !== keep && unsavedHere(x, sides) === 0) {
      sides.flatPhotos.delete(x.id);
    }
  }
}

/** Flat photos that exist only in this page: leaving it would lose them. */
export const flatHasUnsaved = (
  s: FeatureMatchState,
  sides: FeatureMatchSides,
): boolean =>
  s.flat.still !== null ||
  s.flat.progress.surfaces.some((x) => unsavedHere(x, sides) > 0);

export function createFeatureMatchStore(deps: FeatureMatchStoreDeps) {
  const progress = readStored(
    () => parseProgress(deps.storage.getItem(PROGRESS_KEY)),
    undefined,
  );
  const flat = readStored(
    () =>
      afterReload(parseFlatProgress(deps.storage.getItem(FLAT_PROGRESS_KEY))),
    undefined,
  );
  const listener = createListenerMiddleware<FeatureMatchState>();
  const store = configureStore({
    reducer: featureMatchReducer,
    preloadedState: initialFeatureMatchState({
      session: deps.session,
      ...(progress ? { progress } : {}),
      ...(flat ? { flat } : {}),
    }),
    // Frames, results and URLs are side tables: the state holds only
    // plain data, so the default checks stay on.
    middleware: (getDefault) => getDefault().prepend(listener.middleware),
  });
  const sides: FeatureMatchSides = {
    frames: new Map(),
    results: new Map(),
    urls: new Map(),
    flatFrames: new Map(),
    flatPhotos: new Map(),
  };

  listener.startListening({
    predicate: (_a, cur, prev) =>
      cur.progress.sequence !== prev.progress.sequence ||
      cur.progress.pair !== prev.progress.pair ||
      cur.progress.spot !== prev.progress.spot,
    effect: (_a, api) => {
      const p = api.getState().progress;
      write(
        deps.storage,
        PROGRESS_KEY,
        progressText({ sequence: p.sequence, pair: p.pair, spot: p.spot }),
      );
    },
  });
  listener.startListening({
    predicate: (_a, cur, prev) => cur.flat.progress !== prev.flat.progress,
    effect: (_a, api) => {
      write(
        deps.storage,
        FLAT_PROGRESS_KEY,
        flatProgressText(api.getState().flat.progress),
      );
    },
  });
  listener.startListening({
    predicate: (a) =>
      A.flatSurfaceSelected.match(a) || A.flatSurfaceAdded.match(a),
    effect: (_a, api) => {
      const s = api.getState();
      freeOtherPhotos(s, sides, s.flat.progress.current);
    },
  });
  listener.startListening({
    predicate: () => true,
    effect: (_a, api) => {
      reconcile(api.getState(), sides, deps.revokeUrl);
    },
  });

  let nextId = 0;
  /** A fresh side table key. */
  const newId = (prefix: string): string => `${prefix}${String(++nextId)}`;

  /** The photos of surface `id`, created empty on first use. */
  const photosOf = (id: number): SurfacePhotos => {
    let p = sides.flatPhotos.get(id);
    if (!p) {
      p = {
        reference: null,
        rectified: null,
        shots: new Map(),
        original: null,
        camera: null,
      };
      sides.flatPhotos.set(id, p);
    }
    return p;
  };

  function dispose(): void {
    listener.clearListeners();
    for (const url of sides.urls.values()) {
      deps.revokeUrl(url);
    }
    sides.urls.clear();
  }

  return { store, sides, newId, photosOf, dispose };
}

export type FeatureMatchStore = ReturnType<typeof createFeatureMatchStore>;
