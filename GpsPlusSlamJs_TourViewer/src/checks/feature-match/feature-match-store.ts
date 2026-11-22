/**
 * The feature matching check page's store and its side effects: the
 * stored progress read back at start and written by a listener whenever
 * it changes, and the side tables beside the state - frames, results,
 * Blob URLs, kept pair zips and the flat target photos - kept in step with
 * it (an entry the state no longer names is dropped, a URL revoked). The
 * run plan is stored too, and its photos are mirrored into the browser's
 * database so a reload brings them back. The camera, canvases, ORT
 * sessions and timers stay in the views.
 *
 * @see feature-match-store.ts.md
 */
import {
  configureStore,
  createListenerMiddleware,
  type UnknownAction,
} from "@reduxjs/toolkit";

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
import {
  parsePlan,
  planAfterReload,
  planPhotoIds,
  planSlots,
  planText,
} from "./run-plan";
import type { KeyValueStore } from "../../key-value-db";

/** The running number, pair and spot, kept across a reload. */
export const PROGRESS_KEY = "feature-match-check.progress";
/** The flat target progress, kept across reloads. */
export const FLAT_PROGRESS_KEY = "feature-match-check.flat-progress";
/** The photo test run plan, kept across reloads. */
export const PLAN_KEY = "feature-match-check.run-plan";
/** The browser database and store the plan's photos live in. */
export const PHOTO_DB = "feature-match-check-photos";
export const PHOTO_STORE = "photos";

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
  /** The camera photos, the page's pair and the plan's, by `PhotoMeta.id`. */
  readonly frames: Map<string, SavedFrame>;
  /** The plan's kept pair zips, by `KeptFile.id`. */
  readonly blobs: Map<string, Blob>;
  /** Run results, by the camera run's `resultsId` or `planRun.resultsId`. */
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
  /** Where the plan's photos outlive a reload; null keeps them in memory. */
  readonly photoDb?: KeyValueStore | null;
  /** A database call failed; the photos stay in memory. */
  readonly photoDbFailed?: (e: unknown) => void;
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

const isDim = (n: unknown): boolean =>
  typeof n === "number" && Number.isInteger(n) && n > 0;

/** Whether a value read back from the database is a whole saved frame. */
function isSavedFrame(v: unknown): v is SavedFrame {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const s = v as Partial<Record<keyof SavedFrame, unknown>>;
  const f = s.frame as Partial<Record<keyof Frame, unknown>> | undefined;
  const src = s.source as Record<string, unknown> | undefined;
  return (
    (s.name === "A" || s.name === "B") &&
    typeof f === "object" &&
    f !== null &&
    isDim(f.width) &&
    isDim(f.height) &&
    f.rgba instanceof Uint8ClampedArray &&
    f.rgba.length === (f.width as number) * (f.height as number) * 4 &&
    typeof src === "object" &&
    src !== null &&
    isDim(src.width) &&
    isDim(src.height)
  );
}

/** Drops every side table entry the state no longer names. */
function reconcile(
  s: FeatureMatchState,
  sides: FeatureMatchSides,
  revokeUrl: (url: string) => void,
): void {
  const photoIds = new Set([
    s.photos.a?.id,
    s.photos.b?.id,
    ...planPhotoIds(s.plan),
  ]);
  for (const id of sides.frames.keys()) {
    if (!photoIds.has(id)) {
      sides.frames.delete(id);
    }
  }
  const keptIds = new Set(s.plan.kept.map((k) => k.id));
  for (const id of sides.blobs.keys()) {
    if (!keptIds.has(id)) {
      sides.blobs.delete(id);
    }
  }
  const resultIds = new Set([s.resultsId, s.planRun?.resultsId]);
  for (const id of sides.results.keys()) {
    if (!resultIds.has(id)) {
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
  const plan = readStored(
    () => parsePlan(deps.storage.getItem(PLAN_KEY)),
    undefined,
  );
  const listener = createListenerMiddleware<FeatureMatchState>();
  const store = configureStore({
    reducer: featureMatchReducer,
    preloadedState: initialFeatureMatchState({
      session: deps.session,
      ...(progress ? { progress } : {}),
      ...(flat ? { flat } : {}),
      ...(plan ? { plan: planAfterReload(plan) } : {}),
    }),
    // Frames, results and URLs are side tables: the state holds only
    // plain data, so the default checks stay on.
    middleware: (getDefault) => getDefault().prepend(listener.middleware),
  });
  const sides: FeatureMatchSides = {
    frames: new Map(),
    blobs: new Map(),
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
    predicate: (_a, cur, prev) => cur.plan !== prev.plan,
    effect: (_a, api) => {
      write(deps.storage, PLAN_KEY, planText(api.getState().plan));
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
      mirror(api.getState());
    },
  });

  const db = deps.photoDb ?? null;
  const dbFailed = (e: unknown): void => {
    deps.photoDbFailed?.(e);
  };
  /** Plan photo ids written to the database (or found there). */
  const inDb = new Set<string>();
  /**
   * Writes the plan's new photos to the database and deletes the ones it
   * no longer names. A failed write is reported once and not retried: the
   * photo stays in memory for this page.
   */
  function mirror(s: FeatureMatchState): void {
    if (!db) {
      return;
    }
    const named = new Set(planPhotoIds(s.plan));
    for (const id of named) {
      const saved = sides.frames.get(id);
      if (saved && !inDb.has(id)) {
        inDb.add(id);
        db.put(id, saved).catch(dbFailed);
      }
    }
    for (const id of inDb) {
      if (!named.has(id)) {
        inDb.delete(id);
        db.delete(id).catch(dbFailed);
      }
    }
  }

  /**
   * After a reload: brings the plan's photos back from the database into
   * the frames table, marks a photo it does not hold (or holds damaged) as
   * lost, and deletes what no slot names. Without a database every stored
   * photo is lost. Never rejects.
   */
  async function restorePhotos(): Promise<void> {
    const s = store.getState().plan;
    const wanted = planSlots(s).flatMap((slot) => {
      const r = s.slots[slot.id];
      return (["a", "b"] as const).flatMap((which) => {
        const id = r?.[which]?.id;
        return id === undefined ? [] : [{ slot: slot.id, which, id }];
      });
    });
    if (db) {
      try {
        const ids = new Set(wanted.map((w) => w.id));
        for (const key of await db.keys()) {
          if (!ids.has(key)) {
            await db.delete(key);
          }
        }
      } catch (e) {
        dbFailed(e);
      }
    }
    for (const w of wanted) {
      let value: unknown;
      try {
        value = db ? await db.get(w.id) : undefined;
      } catch (e) {
        dbFailed(e);
      }
      // A retake while this was reading has replaced the photo: leave it.
      const still = store.getState().plan.slots[w.slot]?.[w.which]?.id === w.id;
      if (!still) {
        continue;
      }
      if (isSavedFrame(value)) {
        // Named by the state already, so no action is needed to keep it.
        inDb.add(w.id);
        sides.frames.set(w.id, value);
      } else {
        store.dispatch(A.planPhotoLost({ slot: w.slot, which: w.which }));
      }
    }
  }

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

  /**
   * Dispatches `action` and says whether the reducer took it: a refused
   * action returns the same state object. So "I started the run" is never
   * confused with "a run was already going".
   */
  const accepted = (action: UnknownAction): boolean => {
    const before = store.getState();
    store.dispatch(action);
    return store.getState() !== before;
  };

  /**
   * Puts side table entries in place and dispatches the action that names
   * them, in one step: no other action can come between and drop them as
   * unnamed. An entry the action does not name (it was refused) is dropped
   * by the reconcile it triggers, a URL revoked. Returns `accepted`.
   */
  const put = <V>(
    table: Map<string, V>,
    entries: readonly (readonly [string, V])[],
    action: UnknownAction,
  ): boolean => {
    for (const [id, value] of entries) {
      table.set(id, value);
    }
    return accepted(action);
  };

  function dispose(): void {
    listener.clearListeners();
    for (const url of sides.urls.values()) {
      deps.revokeUrl(url);
    }
    sides.urls.clear();
  }

  return {
    store,
    sides,
    newId,
    photosOf,
    accepted,
    put,
    restorePhotos,
    dispose,
  };
}

export type FeatureMatchStore = ReturnType<typeof createFeatureMatchStore>;
