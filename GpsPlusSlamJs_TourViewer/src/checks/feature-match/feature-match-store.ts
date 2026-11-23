/**
 * The feature matching check page's store and its side effects: the
 * stored run plan and flat progress read back at start and written by a
 * listener whenever they change, and the side tables beside the state -
 * the shots' frames, Blob URLs and the flat target photos - kept in step
 * with it (an entry the state no longer names is dropped, a URL revoked).
 * The plan's photos are mirrored into the browser's database so a reload
 * brings them back. The camera, canvases, ORT
 * sessions and timers stay in the views.
 *
 * @see feature-match-store.ts.md
 */
import {
  configureStore,
  createListenerMiddleware,
  type UnknownAction,
} from "@reduxjs/toolkit";

import type { Frame } from "./bench-image";
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
import { isOldPlan, parsePlan, planPhotoIds, planText } from "./run-plan";
import type { KeyValueStore } from "../../key-value-db";

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

/** A shot's camera frame and the camera size it was taken from. */
export interface ShotFrame {
  readonly frame: Frame;
  readonly source: { readonly width: number; readonly height: number };
}

/** What lives beside the store, keyed by the ids the state holds. */
export interface FeatureMatchSides {
  /** The plan's camera photos, by `PhotoMeta.id`. */
  readonly frames: Map<string, ShotFrame>;
  /** The Blob URL of the prepared flat zip, by id. */
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

/** Whether a value read back from the database is a whole shot frame. */
function isShotFrame(v: unknown): v is ShotFrame {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const s = v as Partial<Record<keyof ShotFrame, unknown>>;
  const f = s.frame as Partial<Record<keyof Frame, unknown>> | undefined;
  const src = s.source as Record<string, unknown> | undefined;
  return (
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
  const photoIds = new Set(planPhotoIds(s.plan));
  for (const id of sides.frames.keys()) {
    if (!photoIds.has(id)) {
      sides.frames.delete(id);
    }
  }
  const urlIds = new Set(s.flat.prepared ? [s.flat.prepared.urlId] : []);
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
  const flat = readStored(
    () =>
      afterReload(parseFlatProgress(deps.storage.getItem(FLAT_PROGRESS_KEY))),
    undefined,
  );
  const planStored = readStored(() => deps.storage.getItem(PLAN_KEY), null);
  const plan = parsePlan(planStored);
  /** A stored plan of the pair-slot version was found and not read. */
  const oldPlanDiscarded = isOldPlan(planStored);
  const listener = createListenerMiddleware<FeatureMatchState>();
  const store = configureStore({
    reducer: featureMatchReducer,
    preloadedState: initialFeatureMatchState({
      session: deps.session,
      ...(flat ? { flat } : {}),
      ...(plan ? { plan } : {}),
    }),
    // Frames, results and URLs are side tables: the state holds only
    // plain data, so the default checks stay on.
    middleware: (getDefault) => getDefault().prepend(listener.middleware),
  });
  const sides: FeatureMatchSides = {
    frames: new Map(),
    urls: new Map(),
    flatFrames: new Map(),
    flatPhotos: new Map(),
  };

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
    },
  });
  // Only a plan change can name a new photo; a failure's own log line is
  // none, so a refusing database is not retried in a loop.
  listener.startListening({
    predicate: (_a, cur, prev) => cur.plan !== prev.plan,
    effect: (_a, api) => {
      mirror(api.getState());
    },
  });

  const db = deps.photoDb ?? null;
  const dbFailed = (e: unknown): void => {
    deps.photoDbFailed?.(e);
  };
  /** Plan photo ids written to the database (or found there). */
  const inDb = new Set<string>();
  /** Plan photo ids whose write is in flight. */
  const writing = new Set<string>();
  /**
   * Plan photo ids whose last write failed, oldest first. Retried one at a
   * time: the oldest when a new photo comes, the next after any write
   * succeeds. A refusing database (quota) is so not tried again for every
   * photo at every plan change, each try a full copy of the photo.
   */
  const unstored = new Set<string>();
  /** Unstored ids whose failure was reported; each is reported once. */
  const reported = new Set<string>();
  const named = (): Set<string> => new Set(planPhotoIds(store.getState().plan));
  const flagFailing = (failing: boolean): void => {
    if (store.getState().photoStoreFailing !== failing) {
      store.dispatch(A.photoStoreChanged(failing));
    }
  };
  /** Writes one photo; it counts as stored only once the write succeeded. */
  async function storePhoto(id: string, saved: ShotFrame): Promise<void> {
    if (!db) {
      return;
    }
    writing.add(id);
    let stored = false;
    try {
      await db.put(id, saved);
      stored = true;
    } catch (e) {
      // The photo stays in memory for this page, and is tried again.
      unstored.add(id);
      if (!reported.has(id)) {
        reported.add(id);
        dbFailed(e);
      }
    }
    writing.delete(id);
    if (stored) {
      unstored.delete(id);
      reported.delete(id);
      if (named().has(id)) {
        inDb.add(id);
      } else {
        // Retaken or reset while it was written. A failed delete leaves
        // an orphan for the next start's sweep, not an unstored photo.
        db.delete(id).catch(dbFailed);
      }
      retryOldest();
    }
    flagFailing(unstored.size > 0);
  }
  /**
   * Writes the oldest unstored photo still named, unless a retry is in
   * flight. A new photo's own write may run beside it, so at most two
   * photo copies are written at once.
   */
  function retryOldest(): void {
    if ([...unstored].some((id) => writing.has(id))) {
      return;
    }
    const ids = named();
    for (const id of unstored) {
      const saved = sides.frames.get(id);
      if (ids.has(id) && saved) {
        void storePhoto(id, saved);
        return;
      }
    }
  }
  /**
   * Writes the plan's new photos to the database and deletes the ones it
   * no longer names. Without a database no photo outlives a reload, which
   * the state says while the plan names one.
   */
  function mirror(s: FeatureMatchState): void {
    const ids = new Set(planPhotoIds(s.plan));
    if (!db) {
      flagFailing(ids.size > 0);
      return;
    }
    let fresh = false;
    for (const id of ids) {
      const saved = sides.frames.get(id);
      if (saved && !inDb.has(id) && !writing.has(id) && !unstored.has(id)) {
        fresh = true;
        void storePhoto(id, saved);
      }
    }
    for (const id of inDb) {
      if (!ids.has(id)) {
        inDb.delete(id);
        db.delete(id).catch(dbFailed);
      }
    }
    for (const id of unstored) {
      if (!ids.has(id)) {
        unstored.delete(id);
        reported.delete(id);
      }
    }
    if (fresh) {
      retryOldest();
    }
    flagFailing(unstored.size > 0);
  }

  /**
   * After a reload: brings the plan's photos back from the database into
   * the frames table, marks a photo it does not hold (or holds damaged) as
   * lost, and deletes what no shot names. Without a database every stored
   * photo is lost. Never rejects.
   */
  async function restorePhotos(): Promise<void> {
    const wanted = Object.entries(store.getState().plan.shots).map(
      ([shot, r]) => ({ shot, id: r.photo.id }),
    );
    if (db) {
      try {
        for (const key of await db.keys()) {
          // Read now, not before the wait: a photo taken meanwhile stays.
          if (!named().has(key) && !writing.has(key)) {
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
      const still = store.getState().plan.shots[w.shot]?.photo.id === w.id;
      if (!still) {
        continue;
      }
      if (isShotFrame(value)) {
        // Named by the state already, so no action is needed to keep it.
        inDb.add(w.id);
        sides.frames.set(w.id, value);
      } else {
        store.dispatch(A.planShotLost(w.shot));
      }
    }
  }

  let nextId = 0;
  /**
   * A fresh side table key. The page load's session token is part of it:
   * plan photo ids outlive a reload (the stored plan, the database), and a
   * count from 0 alone would hand out a stored photo's id again.
   */
  const newId = (prefix: string): string =>
    `${prefix}-${deps.session}-${String(++nextId)}`;

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
    oldPlanDiscarded,
  };
}

export type FeatureMatchStore = ReturnType<typeof createFeatureMatchStore>;
