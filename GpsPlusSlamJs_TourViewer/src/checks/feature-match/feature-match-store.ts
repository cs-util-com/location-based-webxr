/**
 * The feature matching check page's store and its side effects: the
 * stored run plan and flat progress read back at start and written by a
 * listener whenever they change, and the side tables beside the state -
 * the shots' PNGs and previews, results, Blob URLs and the flat target
 * photos - kept in step with it (an entry the state no longer names is
 * dropped, a URL revoked). The plan's photos, the measured results and
 * the log are mirrored into the browser's database so a reload brings
 * them back; one tab at a time holds the run. The camera, canvases, ORT
 * sessions and the views' timers stay in the views.
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
  logText,
  planResultKeys,
  type FeatureMatchState,
  type ResultEntry,
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
  EMPTY_PLAN,
  isOldPlan,
  parsePlan,
  planPhotoIds,
  planText,
} from "./run-plan";
import type { KeyValueStore } from "../../key-value-db";

/** The flat target progress, kept across reloads. */
export const FLAT_PROGRESS_KEY = "feature-match-check.flat-progress";
/** The photo test run plan, kept across reloads. */
export const PLAN_KEY = "feature-match-check.run-plan";
/** The browser database and store the plan's photos live in. */
export const PHOTO_DB = "feature-match-check-photos";
export const PHOTO_STORE = "photos";
/** The database key of a plan photo's PNG. */
export const photoKey = (id: string): string => `photo:${id}`;
/** The database key of a pair's measured outcome, by its result key. */
export const resultDbKey = (key: string): string => `result:${key}`;
/** The database key of the page log. */
export const LOG_KEY = "log";
/** How long after a log line the log is written, in ms. */
export const LOG_DELAY_MS = 1000;
/** The lock one tab of the page holds for its life. */
export const TAB_LOCK = "feature-match-run";

/** What a pair's database record holds. */
export interface ResultRecord {
  readonly entry: ResultEntry;
  /** The matches JSON of a measured pair, as the zip carries it. */
  readonly matches?: string;
}

/** The part of `navigator.locks` the tab lock uses. */
export interface TabLocks {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: object | null) => Promise<unknown> | undefined,
  ): Promise<unknown>;
}

/**
 * Takes the page's lock for the page's life; false when another tab holds
 * it. Without the API (or when it fails) this tab counts as the only one.
 */
export function holdTabLock(locks: TabLocks | undefined): Promise<boolean> {
  if (!locks) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    try {
      locks
        .request(TAB_LOCK, { ifAvailable: true }, (lock) => {
          resolve(lock !== null);
          // Held until the page goes: a promise that never settles.
          return lock === null
            ? undefined
            : new Promise<never>(() => undefined);
        })
        .catch(() => {
          resolve(true);
        });
    } catch {
      resolve(true);
    }
  });
}

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
  /**
   * A plan photo's PNG, by `PhotoMeta.id`, held until its database write
   * succeeded (then storage holds it).
   */
  readonly photos: Map<string, Promise<Blob>>;
  /** A plan photo's small copy the views draw, by `PhotoMeta.id`. */
  readonly previews: Map<string, Frame>;
  /** A measured pair's matches JSON, by result key, held until stored. */
  readonly results: Map<string, string>;
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
  /** A stored PNG's preview for the views, at a restore. */
  readonly previewOf?: (png: Blob) => Promise<Frame>;
  /** Takes the tab lock (`holdTabLock`); true when this tab holds the run. */
  readonly lock?: () => Promise<boolean>;
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

/** Whether a value read back from the database is a pair's record. */
function isResultRecord(v: unknown): v is ResultRecord {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const r = v as {
    entry?: Partial<Record<keyof ResultEntry, unknown>>;
    matches?: unknown;
  };
  const e = r.entry;
  return (
    typeof e === "object" &&
    e !== null &&
    (e.status === "done" || e.status === "failed") &&
    typeof e.text === "string" &&
    typeof e.persisted === "boolean" &&
    (r.matches === undefined || typeof r.matches === "string")
  );
}

/** Drops every side table entry the state no longer names. */
function reconcile(
  s: FeatureMatchState,
  sides: FeatureMatchSides,
  revokeUrl: (url: string) => void,
): void {
  const photoIds = new Set(planPhotoIds(s.plan));
  for (const table of [sides.photos, sides.previews]) {
    for (const id of table.keys()) {
      if (!photoIds.has(id)) {
        table.delete(id);
      }
    }
  }
  for (const key of sides.results.keys()) {
    if (s.results[key]?.status !== "done") {
      sides.results.delete(key);
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
  /**
   * The restore deletes what the plan does not name only when a plan was
   * read or an old one discarded: with none (storage cleared or blocked)
   * it would delete every stored photo.
   */
  const sweepAllowed = plan !== undefined || oldPlanDiscarded;
  const listener = createListenerMiddleware<FeatureMatchState>();
  if (oldPlanDiscarded) {
    // Written once now, so the next start does not find and log it again.
    write(deps.storage, PLAN_KEY, planText(EMPTY_PLAN));
  }
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
    photos: new Map(),
    previews: new Map(),
    results: new Map(),
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
  // Only a plan or result change can name a new record; a failure's own
  // log line is none, so a refusing database is not retried in a loop.
  listener.startListening({
    predicate: (_a, cur, prev) =>
      cur.plan !== prev.plan || cur.results !== prev.results,
    effect: (_a, api) => {
      mirror(api.getState());
    },
  });
  // The log, once the stored one was read back: a second after a change.
  listener.startListening({
    predicate: (_a, cur, prev) =>
      cur.restored && (cur.log !== prev.log || !prev.restored),
    effect: () => {
      logTimer ??= setTimeout(writeLog, LOG_DELAY_MS);
    },
  });

  const db = deps.photoDb ?? null;
  const dbFailed = (e: unknown): void => {
    deps.photoDbFailed?.(e);
  };
  /** Database keys written (or found there) of records the state names. */
  const inDb = new Set<string>();
  /** Database keys whose write is in flight. */
  const writing = new Set<string>();
  /**
   * Database keys whose last write failed, oldest first. Retried one at a
   * time: the oldest when a new record comes, the next after any write
   * succeeds. A refusing database (quota) is so not tried again for every
   * record at every change, each try a full copy of a photo.
   */
  const unstored = new Set<string>();
  /** Unstored keys whose failure was reported; each is reported once. */
  const reported = new Set<string>();
  /** The records the state names: its photos and its kept results. */
  const wanted = (s: FeatureMatchState): Set<string> => {
    const keys = new Set(planPhotoIds(s.plan).map(photoKey));
    for (const [k, e] of Object.entries(s.results)) {
      if (e.persisted) {
        keys.add(resultDbKey(k));
      }
    }
    return keys;
  };
  /** A record's value from memory, or undefined when memory has none. */
  const held = (key: string): Promise<unknown> | undefined => {
    if (key.startsWith("photo:")) {
      return sides.photos.get(key.slice("photo:".length));
    }
    const k = key.slice("result:".length);
    const entry = store.getState().results[k];
    const matches = sides.results.get(k);
    if (!entry || (entry.status === "done" && matches === undefined)) {
      return undefined;
    }
    const record: ResultRecord =
      matches === undefined ? { entry } : { entry, matches };
    return Promise.resolve(record);
  };
  /** A written record's copy in memory goes; a photo then reads "stored". */
  const stored = (key: string): void => {
    if (key.startsWith("photo:")) {
      const id = key.slice("photo:".length);
      sides.photos.delete(id);
      store.dispatch(A.photoStored(id));
    } else {
      sides.results.delete(key.slice("result:".length));
    }
  };
  const flagFailing = (failing: boolean): void => {
    if (store.getState().photoStoreFailing !== failing) {
      store.dispatch(A.photoStoreChanged(failing));
    }
  };
  /** Writes one record; it counts as stored only once the write succeeded. */
  async function storeRecord(
    key: string,
    value: Promise<unknown>,
  ): Promise<void> {
    if (!db) {
      return;
    }
    writing.add(key);
    let ok = false;
    try {
      await db.put(key, await value);
      ok = true;
    } catch (e) {
      // The record stays in memory for this page, and is tried again.
      unstored.add(key);
      if (!reported.has(key)) {
        reported.add(key);
        dbFailed(e);
      }
    }
    writing.delete(key);
    if (ok) {
      unstored.delete(key);
      reported.delete(key);
      if (wanted(store.getState()).has(key)) {
        inDb.add(key);
        stored(key);
      } else {
        // Retaken or reset while it was written. A failed delete leaves
        // an orphan for the next start's sweep, not an unstored record.
        db.delete(key).catch(dbFailed);
      }
      retryOldest();
    }
    flagFailing(unstored.size > 0);
  }
  /**
   * Writes the oldest unstored record still named, unless a retry is in
   * flight. Every new record's own write starts at once beside it, so the
   * writes in flight are the new records not yet written plus at most one
   * retry.
   */
  function retryOldest(): void {
    if ([...unstored].some((k) => writing.has(k))) {
      return;
    }
    const keys = wanted(store.getState());
    for (const key of unstored) {
      const value = keys.has(key) ? held(key) : undefined;
      if (value) {
        void storeRecord(key, value);
        return;
      }
    }
  }
  /**
   * Writes the state's new records to the database and deletes the ones
   * it no longer names. Without a database no photo outlives a reload,
   * which the state says while the plan names one.
   */
  function mirror(s: FeatureMatchState): void {
    const keys = wanted(s);
    if (!db) {
      flagFailing(planPhotoIds(s.plan).length > 0);
      return;
    }
    let fresh = false;
    for (const key of keys) {
      const value =
        inDb.has(key) || writing.has(key) || unstored.has(key)
          ? undefined
          : held(key);
      if (value) {
        fresh = true;
        void storeRecord(key, value);
      }
    }
    for (const key of inDb) {
      if (!keys.has(key)) {
        inDb.delete(key);
        db.delete(key).catch(dbFailed);
      }
    }
    for (const key of unstored) {
      if (!keys.has(key)) {
        unstored.delete(key);
        reported.delete(key);
      }
    }
    if (fresh) {
      retryOldest();
    }
    flagFailing(unstored.size > 0);
  }

  let logTimer: ReturnType<typeof setTimeout> | null = null;
  /** A failed log write was reported; reset by a write that succeeds. */
  let logReported = false;
  /** Writes the log now, once the stored one was read back. */
  function writeLog(): void {
    if (logTimer !== null) {
      clearTimeout(logTimer);
      logTimer = null;
    }
    const s = store.getState();
    if (!db || !s.restored) {
      return;
    }
    db.put(LOG_KEY, logText(s)).then(
      () => {
        logReported = false;
      },
      (e: unknown) => {
        if (!logReported) {
          logReported = true;
          dbFailed(e);
        }
      },
    );
  }

  /** A database read that reports a failure and reads as nothing. */
  const read = async (key: string): Promise<unknown> => {
    if (!db) {
      return undefined;
    }
    try {
      return await db.get(key);
    } catch (e) {
      dbFailed(e);
      return undefined;
    }
  };

  /** Deletes what the plan does not name: orphans, old ids, stale results. */
  async function sweep(): Promise<void> {
    if (!db) {
      return;
    }
    try {
      for (const key of await db.keys()) {
        // Read now, not before the wait: a photo taken meanwhile stays.
        const s = store.getState();
        const keep =
          key === LOG_KEY ||
          writing.has(key) ||
          wanted(s).has(key) ||
          (key.startsWith("result:") &&
            planResultKeys(s.plan).has(key.slice("result:".length)));
        if (!keep) {
          await db.delete(key);
        }
      }
    } catch (e) {
      dbFailed(e);
    }
  }

  /**
   * After a load: takes the tab lock (another tab holding it ends here,
   * with nothing read or deleted), sweeps (`sweepAllowed`), then reads
   * back the plan's photos as previews, the ready pairs' kept results and
   * the log. A photo storage does not hold (or holds damaged) is marked
   * lost. Without a database every stored photo is lost. Never rejects.
   * Runs once: a later call returns the first call's promise, so work
   * that needs the restored state (the run zip) awaits it again.
   */
  let restoring: Promise<void> | null = null;
  function restore(): Promise<void> {
    restoring ??= restoreOnce();
    return restoring;
  }

  async function restoreOnce(): Promise<void> {
    if (!(await (deps.lock ?? (() => Promise.resolve(true)))())) {
      store.dispatch(A.otherTabFound());
      return;
    }
    if (sweepAllowed) {
      await sweep();
    }
    const found: string[] = [];
    for (const [shot, r] of Object.entries(store.getState().plan.shots)) {
      const id = r.photo.id;
      const value = await read(photoKey(id));
      let preview: Frame | undefined;
      let ok = value instanceof Blob;
      if (value instanceof Blob && deps.previewOf) {
        try {
          preview = await deps.previewOf(value);
        } catch (e) {
          dbFailed(e);
          ok = false;
        }
      }
      // A retake while this was reading has replaced the photo: leave it.
      if (store.getState().plan.shots[shot]?.photo.id !== id) {
        continue;
      }
      if (ok) {
        // Named by the state already, so no action is needed to keep it.
        inDb.add(photoKey(id));
        found.push(id);
        if (preview) {
          sides.previews.set(id, preview);
        }
      } else {
        store.dispatch(A.planShotLost(shot));
      }
    }
    const results: Record<string, ResultEntry> = {};
    for (const key of planResultKeys(store.getState().plan).keys()) {
      const v = await read(resultDbKey(key));
      if (isResultRecord(v) && v.entry.persisted) {
        results[key] = v.entry;
        inDb.add(resultDbKey(key));
      }
    }
    const text = await read(LOG_KEY);
    const log = typeof text === "string" ? text.split("\n") : [];
    if (log.at(-1) === "") {
      log.pop();
    }
    store.dispatch(A.restoreFinished({ stored: found, results, log }));
  }

  /**
   * A photo's PNG: from storage, else from memory (a write refused or
   * pending). Rejects when neither holds it.
   */
  async function readPhoto(id: string): Promise<Blob> {
    const value = await read(photoKey(id));
    if (value instanceof Blob) {
      return value;
    }
    const kept = sides.photos.get(id);
    if (kept) {
      return kept;
    }
    throw new Error(`the photo ${id} is not stored`);
  }

  /** A measured pair's matches JSON from storage, else from memory. */
  async function readMatches(key: string): Promise<string | undefined> {
    const value = await read(resultDbKey(key));
    if (isResultRecord(value) && value.matches !== undefined) {
      return value.matches;
    }
    return sides.results.get(key);
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
    if (logTimer !== null) {
      clearTimeout(logTimer);
      logTimer = null;
    }
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
    restore,
    readPhoto,
    readMatches,
    /** Writes the log now (the page hides or goes). */
    flushLog: writeLog,
    dispose,
    oldPlanDiscarded,
  };
}

export type FeatureMatchStore = ReturnType<typeof createFeatureMatchStore>;
