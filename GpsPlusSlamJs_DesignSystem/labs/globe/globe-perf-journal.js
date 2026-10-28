/**
 * The frame-time recorder's sweep journal (`globe-perf.js`): the export
 * kept in the browser's storage after every run, so a page that was
 * reloaded mid-sweep (iOS kills a tab for memory) can offer what was
 * measured instead of starting over. Takes the storage as a getter, so it
 * runs under `node --test`.
 *
 * @see globe-perf-journal.js.md
 */

/** The storage key, one sweep per origin. */
export const SWEEP_JOURNAL_KEY = "globe-perf-sweep";

/**
 * `storage` returns a Storage (`localStorage`); reading it may throw (a
 * private window) or give undefined. Returns `{ save, load, unfinished,
 * clear, report }`:
 * - `save({ text, runs, total, state })` keeps the export text with the
 *   runs finished, the runs planned and the state (`"running"`,
 *   `"stopped"`, `"failed"` or `"done"`), stamped `savedAt` (epoch ms);
 *   returns whether it was kept;
 * - `load()` -> the entry or null (none, unreadable, malformed);
 * - `unfinished()` -> the entry unless it is `"done"`, else null;
 * - `clear()` removes it;
 * - `report()` -> `{ saves, failedSaves, lastError }`.
 * Never throws.
 */
export function createSweepJournal({ storage, key = SWEEP_JOURNAL_KEY }) {
  let saves = 0;
  let failedSaves = 0;
  let lastError = null;
  const store = () => {
    try {
      return storage() ?? null;
    } catch {
      return null;
    }
  };
  const load = () => {
    try {
      const raw = store()?.getItem(key);
      if (typeof raw !== "string") return null;
      const entry = JSON.parse(raw);
      return typeof entry?.text === "string" &&
        Number.isInteger(entry.runs) &&
        typeof entry.state === "string"
        ? entry
        : null;
    } catch {
      return null;
    }
  };
  return {
    save({ text, runs, total, state }) {
      try {
        const s = storage();
        if (!s) throw new Error("no storage");
        s.setItem(
          key,
          JSON.stringify({ text, runs, total, state, savedAt: Date.now() }),
        );
        saves += 1;
        return true;
      } catch (error) {
        failedSaves += 1;
        lastError = `${error?.name ?? "Error"}: ${error?.message ?? error}`;
        return false;
      }
    },
    load,
    unfinished() {
      const entry = load();
      return entry && entry.state !== "done" ? entry : null;
    },
    clear() {
      try {
        store()?.removeItem(key);
      } catch {
        // Nothing kept, or nothing reachable: nothing to clear.
      }
    },
    report: () => ({ saves, failedSaves, lastError }),
  };
}
