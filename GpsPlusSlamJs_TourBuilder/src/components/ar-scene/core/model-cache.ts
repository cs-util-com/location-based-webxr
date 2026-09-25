/**
 * Tier-2 memory: the parsed-model LRU with ref-counting (plan A9, TASK §2.5.5).
 *
 * Parsing a GLTF is the expensive half of making a knight appear, and a visitor
 * pacing near a boundary would otherwise rebuild the same model repeatedly. So
 * the last few *parsed templates* are kept warm after their waypoint drops to
 * IDLE, and the real `dispose()` + `release()` happen on **eviction** instead.
 *
 * That deliberately softens the contract's zone table (contract §2.5: "IDLE →
 * dispose GPU + release Blob") into "IDLE → drop the clone; eviction → dispose
 * + release". It stays a bounded budget, not a leak: at most `capacity`
 * templates survive, and every one of them is freed by `dispose()`.
 *
 * The module is pure bookkeeping, generic over an opaque handle, with the actual
 * GPU/blob freeing injected as `onEvict`. That is what makes eviction order,
 * ref-counting and the "never free something still on screen" rule testable
 * with `T = string` and no WebGL.
 *
 * Ref-counting matters because the contract explicitly allows the same asset id
 * on two waypoints — two knights sharing one model must parse once and free
 * once.
 *
 * @see plans/2026-07-31-ar-scene-plan.md §5.2
 */

export interface ModelCacheOptions<T> {
  /** Templates kept warm beyond their last use. */
  readonly capacity: number;
  /** Free the real resources: geometry/material/texture dispose + release(id). */
  readonly onEvict: (key: string, value: T) => void;
}

export interface ModelCache<T> {
  /**
   * Take a reference to a cached template. Returns `undefined` on a miss — the
   * caller then loads it and calls `put`. A hit marks the entry most-recently
   * used and increments its ref-count.
   */
  acquire(key: string): T | undefined;
  /**
   * Insert a freshly parsed template, already holding **one** reference for the
   * caller (so a `put` is balanced by a `release`, exactly like `acquire`).
   * Inserting may evict other entries, never this one.
   */
  put(key: string, value: T): void;
  /** Balance one `acquire`/`put`. At zero references the entry becomes evictable. */
  release(key: string): void;
  /** Free everything regardless of ref-count (teardown only). */
  clear(): void;
  /** Live keys, least-recently-used first — introspection for tests and the demo HUD. */
  keys(): readonly string[];
  /** Current reference count for a key (0 when absent). */
  refCount(key: string): number;
}

interface Entry<T> {
  readonly value: T;
  refs: number;
  /** Monotonic use stamp; the smallest is the least recently used. */
  used: number;
}

export function createModelCache<T>(
  options: ModelCacheOptions<T>,
): ModelCache<T> {
  const entries = new Map<string, Entry<T>>();
  let clock = 0;

  /**
   * Evict least-recently-used entries with **no live references** until the
   * cache fits. Entries still referenced are skipped rather than freed: a knight
   * currently on screen outranks the capacity budget, so the cache may briefly
   * exceed `capacity` under heavy simultaneous load and shrinks again as
   * waypoints go IDLE.
   */
  const evictIfNeeded = (protectedKey: string): void => {
    while (entries.size > options.capacity) {
      let victimKey: string | null = null;
      let victimUsed = Infinity;
      for (const [key, entry] of entries) {
        if (key === protectedKey || entry.refs > 0) continue;
        if (entry.used < victimUsed) {
          victimKey = key;
          victimUsed = entry.used;
        }
      }
      if (victimKey === null) return; // everything is in use — keep it all
      const victim = entries.get(victimKey)!;
      entries.delete(victimKey);
      options.onEvict(victimKey, victim.value);
    }
  };

  return {
    acquire(key: string): T | undefined {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entry.refs += 1;
      entry.used = ++clock;
      return entry.value;
    },

    put(key: string, value: T): void {
      const existing = entries.get(key);
      if (existing !== undefined) {
        // Raced with another loader for the same asset: keep the first template
        // (clones may already reference it) and free the duplicate right away.
        existing.refs += 1;
        existing.used = ++clock;
        options.onEvict(key, value);
        return;
      }
      entries.set(key, { value, refs: 1, used: ++clock });
      evictIfNeeded(key);
    },

    release(key: string): void {
      const entry = entries.get(key);
      if (entry === undefined) return;
      if (entry.refs > 0) entry.refs -= 1;
      evictIfNeeded("");
    },

    clear(): void {
      for (const [key, entry] of entries) options.onEvict(key, entry.value);
      entries.clear();
    },

    keys(): readonly string[] {
      return [...entries.entries()]
        .sort((a, b) => a[1].used - b[1].used)
        .map(([key]) => key);
    },

    refCount(key: string): number {
      return entries.get(key)?.refs ?? 0;
    },
  };
}
