/**
 * The frame-time recorder's sweep journal (`globe-perf.js`): the export
 * kept in the browser's storage after every run and at the end, so a page
 * that was reloaded (iOS kills a tab for memory, or a tester reloads after
 * Done) can offer what was measured instead of starting over. Takes the
 * storage as a getter, so it runs under `node --test`.
 *
 * @see globe-perf-journal.js.md
 */

/** The storage key, one sweep per origin. */
export const SWEEP_JOURNAL_KEY = "globe-perf-sweep";

/**
 * `storage` returns a Storage (`localStorage`); reading it may throw (a
 * private window) or give undefined. Returns `{ save, load, previous,
 * clear, report }`:
 * - `save({ text, runs, total, state, link })` keeps the export text with
 *   the runs finished, the runs planned, the state (`"running"`,
 *   `"stopped"`, `"failed"` or `"done"`) and the link it was measured
 *   with (the page's `location.hash`), stamped `savedAt` (epoch ms);
 *   returns whether it was kept;
 * - `load()` -> the entry or null (none, unreadable, malformed);
 * - `previous(link)` -> the entry, whatever its state, with `sameLink`
 *   (whether it was measured with `link`), or null;
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
    save({ text, runs, total, state, link }) {
      try {
        const s = storage();
        if (!s) throw new Error("no storage");
        s.setItem(
          key,
          JSON.stringify({
            text,
            runs,
            total,
            state,
            link,
            savedAt: Date.now(),
          }),
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
    previous(link) {
      const entry = load();
      if (!entry) return null;
      // An entry without a link (kept before links were stored) matches
      // none, so it never blocks a link's auto-start.
      const sameLink = typeof entry.link === "string" && entry.link === link;
      return { ...entry, sameLink };
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

/** How a kept sweep ended, in words. */
const ENDED = Object.freeze({
  running: "cut off",
  done: "finished",
  stopped: "stopped",
  failed: "failed",
});

/**
 * The overlay's line for a kept sweep (`previous(link)`): how it ended
 * and how many runs it has, and whether it is this link's sweep (start
 * fresh) or one from other settings (a new sweep replaces it).
 */
export function previousSweepText({ state, runs, total, sameLink }) {
  const ended = ENDED[state] ?? state;
  const counted = `${runs} of ${total} runs`;
  if (!sameLink) {
    return `An earlier sweep with other settings is kept (${ended}, ${counted}). Copy or Download it; a new sweep replaces it.`;
  }
  const what =
    state === "running"
      ? `cut off after ${counted} (page reloaded)`
      : state === "done"
        ? `finished: ${counted}`
        : `${ended} after ${counted}`;
  return `Previous sweep ${what}. Copy or Download it, or start fresh.`;
}
