/**
 * The globe lab's debug log and export (round-6 plan 2026-10-04-1050 G6-0,
 * DEC-G6-6): a fixed-size ring of the page's events (band edges, releases,
 * drains, E steps, errors), always on and cheap, and the JSON the Debug
 * panel's Copy produces. Dependency-free, so it runs under `node --test`.
 *
 * @see globe-debug-log.js.md
 */

/** The export's format tag, for whoever reads a pasted export. */
const FORMAT = "globe-debug/1";

/**
 * A ring of the newest `capacity` events, each `{ t, kind, detail }` (`t`
 * from `now`, ms). RangeError for a capacity that is not a positive integer.
 *
 * @param {{ capacity?: number, now?: () => number }} [options]
 */
export function createDebugLog({
  capacity = 500,
  now = () => performance.now(),
} = {}) {
  if (!(Number.isInteger(capacity) && capacity > 0)) {
    throw new RangeError(
      `the log's capacity must be a positive integer, got ${capacity}`,
    );
  }
  /** @type {{ t: number, kind: string, detail: unknown }[]} */
  const ring = [];
  let next = 0;
  let total = 0;
  return {
    /** Logs one event; `detail` is any JSON-able value (null when absent). */
    log(kind, detail = null) {
      if (typeof kind !== "string" || kind === "") {
        throw new RangeError("an event needs a kind");
      }
      const entry = { t: now(), kind, detail };
      if (ring.length < capacity) ring.push(entry);
      else ring[next] = entry;
      next = (next + 1) % capacity;
      total += 1;
    },
    /** The kept events, oldest first. */
    entries() {
      return ring.length < capacity
        ? ring.slice()
        : [...ring.slice(next), ...ring.slice(0, next)];
    },
    /** Every event logged since the start, kept or not. */
    total: () => total,
  };
}

/** JSON.stringify's replacer: a non-finite number spelled out, never null. */
function finite(_key, value) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }
  return value;
}

/**
 * The Debug panel's export as text: the format tag, the device, the live
 * state, the manual recording's summary (or null) and the events.
 *
 * @param {{ device: unknown, live: unknown, recording: unknown,
 *   events: unknown[] }} parts
 */
export function debugExportText({ device, live, recording, events, link }) {
  return JSON.stringify(
    { format: FORMAT, link: link ?? null, device, live, recording, events },
    finite,
  );
}
