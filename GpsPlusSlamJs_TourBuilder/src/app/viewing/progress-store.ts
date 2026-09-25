/**
 * Durable viewing progress (plan VC14).
 *
 * A visitor's walk lasts 20–60 minutes on a phone that may evict the tab,
 * lose the session to the system back gesture, or simply be reloaded. Visited
 * waypoints drive the map's "next" highlight and the breadcrumb guidance, so
 * losing them mid-walk means losing the visitor's place in the tour.
 *
 * `localStorage`, not OPFS (which the authoring draft uses): this is a handful
 * of short ids, needed synchronously before the first frame. The authoring
 * side needed OPFS because it persists a growing action log.
 *
 * Everything here is best-effort by design — Safari private mode throws on
 * write, quota can be exhausted, and a corrupt value is always possible. None
 * of that may break a running tour, so every path degrades to "no stored
 * progress" instead of throwing.
 */

import { markWaypointVisited } from "../../store/tour-progress-slice.js";

/** The `localStorage` subset used here (injected in tests). */
export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredProgress {
  readonly visited: readonly string[];
}

function storageKey(tourId: string): string {
  return `tour:${tourId}`;
}

function defaultStorage(): ProgressStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Accessing `localStorage` itself can throw when storage is blocked.
    return null;
  }
}

/** Visited ids stored for `tourId`. Never throws; `[]` when unavailable. */
export function readProgress(
  tourId: string,
  storage: ProgressStorage | null = defaultStorage(),
): readonly string[] {
  if (storage === null) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(tourId));
  } catch {
    return [];
  }
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    const visited = (parsed as Partial<StoredProgress> | null)?.visited;
    if (!Array.isArray(visited)) return [];
    // A partially corrupt list still yields its usable entries — better than
    // discarding a whole walk because one entry rotted.
    return visited.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Persist the visited set for `tourId`. Never throws. */
export function persistProgress(
  tourId: string,
  visitedIds: readonly string[],
  storage: ProgressStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    const payload: StoredProgress = { visited: [...visitedIds] };
    storage.setItem(storageKey(tourId), JSON.stringify(payload));
  } catch {
    // Quota exhausted or storage blocked — the tour keeps running, it just
    // will not survive a reload.
  }
}

/**
 * Replay stored progress into the store. Safe to call right after
 * `loadTour`: `markWaypointVisited` is documented idempotent, so re-dispatching
 * ids the store may already hold changes nothing.
 */
export function restoreProgress(
  dispatch: (action: ReturnType<typeof markWaypointVisited>) => unknown,
  tourId: string,
  storage: ProgressStorage | null = defaultStorage(),
): void {
  for (const id of readProgress(tourId, storage)) {
    dispatch(markWaypointVisited(id));
  }
}

/** Forget a tour's progress ("Restart tour"). Never throws. */
export function clearProgress(
  tourId: string,
  storage: ProgressStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(storageKey(tourId));
  } catch {
    // Nothing to do — the caller's reset still proceeds in memory.
  }
}
