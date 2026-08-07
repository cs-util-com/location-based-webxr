/**
 * Turning a date box and a time box into an instant, and back (DEC-G1, W6).
 *
 * WHY THIS IS ITS OWN MODULE. `<input type="date">` and `<input type="time">`
 * both hand back strings in a fixed format and neither knows about the other,
 * so "what instant did the user pick" is arithmetic — and it is the arithmetic
 * that is easy to get wrong in a way nobody notices until they are in another
 * timezone. Doing it inside the dialog would make it reachable only through a
 * DOM.
 *
 * **LOCAL TIME, EXPLICITLY (DEC-G1).** The demo already used the device's zone
 * implicitly, by passing `Date.now()`; making the picker explicit does not
 * change which zone is meant, it just says so. `new Date(y, m, d, hh, mm)` is
 * the local-time constructor, which is the whole point — `Date.parse` on an
 * ISO-like string without an offset is the trap, since `"2026-08-07T18:00"` is
 * local but `"2026-08-07"` alone is UTC, in the same engine, by spec.
 *
 * **The accepted cost, restated because it is a real one:** two devices in
 * different zones asking for "18:00" get different absolute instants, and
 * therefore different events. Cross-tab determinism is unaffected, since two
 * tabs share a zone.
 *
 * @see event-instant.ts.md
 */

/** Zero-padded to two digits, for the `<input>` formats. */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `yyyy-mm-dd` in LOCAL time, which is what `<input type="date">` shows. */
export function toDateValue(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `hh:mm` in LOCAL time, which is what `<input type="time">` shows. */
export function toTimeValue(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * The local instant a `yyyy-mm-dd` and an `hh:mm` denote, or `undefined`.
 *
 * RETURNS `undefined` RATHER THAN GUESSING. Both inputs can be empty — a user
 * can clear either box, and a browser that does not support `type="date"`
 * renders a free-text field — so "unparseable" is a state the caller has to
 * handle, and a silent fallback to "now" would run a search for a time the user
 * did not ask for while the dialog said otherwise.
 */
export function parseLocalInstant(
  date: string,
  time: string,
): number | undefined {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  // Seconds are optional in the `time` format and are ignored: the event grid
  // is quarter-hourly, so a seconds field would offer precision the answer
  // cannot carry.
  const timeParts = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (dateParts === null || timeParts === null) return undefined;

  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const hour = Number(timeParts[1]);
  const minute = Number(timeParts[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59) return undefined;

  // THE LOCAL-TIME CONSTRUCTOR, not `Date.parse` of a joined string. See the
  // module header: the two differ by the device's offset, silently.
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  // ROLL-OVER IS REJECTED, not accepted. `new Date(2026, 1, 31)` is 3 March,
  // so a "31 February" typed into a text-mode input would run a search for a
  // day the dialog never showed.
  if (at.getMonth() !== month - 1 || at.getDate() !== day) return undefined;
  return at.getTime();
}
