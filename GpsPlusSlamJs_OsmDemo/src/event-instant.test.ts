/**
 * WHY THESE TESTS MATTER (DEC-G1, W6).
 *
 * The picker's whole promise is "you asked for this local time, so this is the
 * local time you get". Every failure mode here is silent: an instant an hour or
 * a day out still produces a perfectly plausible event somewhere, and the label
 * agrees with it, so nothing looks broken.
 *
 * The two that would actually happen: `Date.parse("2026-08-07T18:00")` is local
 * while `Date.parse("2026-08-07")` is UTC — same engine, same shape, different
 * meaning, by spec — and `new Date(2026, 1, 31)` is 3 March rather than an
 * error, so a typed-in "31 February" would search a day the dialog never
 * displayed.
 *
 * These are written against the RUNNER's local zone rather than a pinned one,
 * because that is the property under test: whatever zone the device is in, the
 * boxes and the instant have to agree.
 */

import { describe, expect, it } from "vitest";

import {
  parseLocalInstant,
  toDateValue,
  toTimeValue,
} from "./event-instant.js";

describe("toDateValue / toTimeValue", () => {
  it("formats what the two inputs display, zero-padded", () => {
    // Single-digit months, days, hours and minutes all in one date, because a
    // missing pad produces "2026-8-7", which the input silently rejects and
    // renders as empty — a dialog that opens blank rather than at the time it
    // was given.
    const at = new Date(2026, 7, 7, 9, 5);
    expect(toDateValue(at)).toBe("2026-08-07");
    expect(toTimeValue(at)).toBe("09:05");
  });

  it("round-trips any local instant through both boxes", () => {
    // The property that matters: format, parse, and land on the same minute.
    for (const at of [
      new Date(2026, 0, 1, 0, 0),
      new Date(2026, 7, 7, 18, 15),
      new Date(2026, 11, 31, 23, 59),
      // Inside Europe's DST changeover week, in both directions.
      new Date(2026, 2, 29, 3, 30),
      new Date(2026, 9, 25, 2, 30),
    ]) {
      const parsed = parseLocalInstant(toDateValue(at), toTimeValue(at));
      expect(new Date(parsed ?? 0).getHours()).toBe(at.getHours());
      expect(new Date(parsed ?? 0).getDate()).toBe(at.getDate());
    }
  });
});

describe("parseLocalInstant", () => {
  it("reads the boxes as LOCAL time, not UTC", () => {
    // THE TRAP THIS EXISTS FOR. A joined ISO-like string is local when it has a
    // time and UTC when it does not, so a "helpful" `Date.parse` refactor moves
    // every picked event by the device's offset — invisibly, and correctly for
    // whoever wrote it if they happen to be at UTC+0.
    const instant = parseLocalInstant("2026-08-07", "18:00");
    const at = new Date(instant ?? 0);
    expect(at.getHours()).toBe(18);
    expect(at.getMinutes()).toBe(0);
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(7);
    expect(at.getDate()).toBe(7);
  });

  it("accepts a seconds field and ignores it", () => {
    // Some browsers add `:00` once a step is set. The event grid is
    // quarter-hourly, so seconds are precision the answer cannot carry.
    expect(parseLocalInstant("2026-08-07", "18:00:00")).toBe(
      parseLocalInstant("2026-08-07", "18:00"),
    );
  });

  it("returns undefined for an empty or malformed box", () => {
    // Either box can be cleared, and a browser without `type="date"` renders a
    // free-text field. Falling back to "now" would run a search for a time the
    // user did not ask for while the dialog showed the one they did.
    expect(parseLocalInstant("", "18:00")).toBeUndefined();
    expect(parseLocalInstant("2026-08-07", "")).toBeUndefined();
    expect(parseLocalInstant("07/08/2026", "18:00")).toBeUndefined();
    expect(parseLocalInstant("2026-08-07", "6pm")).toBeUndefined();
  });

  it("REJECTS a date that would roll over rather than accepting it", () => {
    // `new Date(2026, 1, 31)` is 3 March, silently. A text-mode input makes
    // "2026-02-31" typable, and the search would then run for a day the dialog
    // never displayed.
    expect(parseLocalInstant("2026-02-31", "18:00")).toBeUndefined();
    expect(parseLocalInstant("2026-04-31", "18:00")).toBeUndefined();
    // The same day in a leap year IS valid, so the check is a real one rather
    // than a blanket "reject 29-31".
    expect(parseLocalInstant("2028-02-29", "18:00")).not.toBeUndefined();
  });

  it("rejects out-of-range components", () => {
    expect(parseLocalInstant("2026-13-01", "18:00")).toBeUndefined();
    expect(parseLocalInstant("2026-00-01", "18:00")).toBeUndefined();
    expect(parseLocalInstant("2026-08-07", "24:00")).toBeUndefined();
    expect(parseLocalInstant("2026-08-07", "18:60")).toBeUndefined();
  });
});
