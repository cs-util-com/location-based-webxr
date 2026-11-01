/**
 * Which parts of each long text the creator kept as typed ("Keep as
 * typed"), remembered in this browser only. The tour format has no field
 * for it, so the choice never travels with the tour: it is a reminder for
 * the person editing, and an unavailable or broken storage only means the
 * reminder is forgotten when the page closes.
 *
 * @see kept-store.ts.md
 */

/** The storage key; the version lets a later shape start afresh. */
export const KEPT_STORAGE_KEY = "tour-viewer.editor.kept-as-typed.v1";

/** The most part keys kept for one text; older ones are dropped first. */
export const KEPT_PER_TEXT_MAX = 200;

/** The kept parts of every long text, by block id. */
export interface KeptStore {
  /** The keys kept for `blockId` (a copy). */
  get(blockId: string): ReadonlySet<string>;
  /** Keeps (`true`) or stops keeping (`false`) `key` for `blockId`. */
  set(blockId: string, key: string, kept: boolean): void;
}

/** The part of `Storage` the store uses. */
export type KeptStorage = Pick<Storage, "getItem" | "setItem">;

/** The browser's `localStorage`, or null where reading it throws. */
function defaultStorage(): KeptStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored map, keeping only well-formed entries. */
function read(storage: KeptStorage | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (storage === null) return out;
  let raw: string | null;
  try {
    raw = storage.getItem(KEPT_STORAGE_KEY);
  } catch {
    return out;
  }
  if (raw === null) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return out;
  }
  for (const [id, keys] of Object.entries(parsed)) {
    if (!Array.isArray(keys)) continue;
    const strings = keys.filter((k): k is string => typeof k === "string");
    if (strings.length > 0) out.set(id, strings.slice(-KEPT_PER_TEXT_MAX));
  }
  return out;
}

/**
 * A kept-parts store over `storage` (default: `localStorage`). It reads
 * the stored map once and writes it after every change; a storage that
 * throws leaves the store working in memory.
 */
export function createKeptStore(
  storage: KeptStorage | null = defaultStorage(),
): KeptStore {
  const map = read(storage);
  const write = (): void => {
    if (storage === null) return;
    try {
      storage.setItem(
        KEPT_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(map)),
      );
    } catch {
      // Full or blocked storage: the choice lasts until the page closes.
    }
  };
  return {
    get: (blockId) => new Set(map.get(blockId) ?? []),
    set: (blockId, key, kept) => {
      const keys = (map.get(blockId) ?? []).filter((k) => k !== key);
      if (kept) keys.push(key);
      if (keys.length === 0) map.delete(blockId);
      else map.set(blockId, keys.slice(-KEPT_PER_TEXT_MAX));
      write();
    },
  };
}
