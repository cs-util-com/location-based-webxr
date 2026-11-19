/**
 * Why these tests matter: the drop area shows what each file is and offers
 * ONE action for the lot. A wrong plan opens a scan as a tour, opens one
 * of two tours the person never picked, or offers an action for files
 * that are not usable - each of which the person would only notice after
 * the press.
 */
import { describe, expect, it } from "vitest";

import {
  chipLine,
  isEntryRow,
  NOTHING_USABLE,
  planEntryAction,
  SCAN_ONLY_QUESTION,
  type EntryRow,
} from "./entry-drop.js";

const tour = (id: string, title: string | null = null): EntryRow => ({
  id,
  name: `${id}.zip`,
  chip: { kind: "tour", title, stations: title === null ? null : 3 },
});
const scan = (id: string): EntryRow => ({
  id,
  name: `${id}.zip`,
  chip: { kind: "scan", captures: 12 },
});
const bad = (id: string): EntryRow => ({
  id,
  name: `${id}.txt`,
  chip: { kind: "neither", reason: "This is not a .zip file." },
});
const none = { tour: null, scan: null };

describe("chipLine", () => {
  it("names a tour by its title and stations, or only as a tour", () => {
    expect(chipLine({ kind: "tour", title: "Castle walk", stations: 6 })).toBe(
      "Tour - 'Castle walk', 6 stations",
    );
    expect(chipLine({ kind: "tour", title: "One", stations: 1 })).toBe(
      "Tour - 'One', 1 station",
    );
    expect(chipLine({ kind: "tour", title: null, stations: 0 })).toBe(
      "Tour - 0 stations",
    );
    expect(chipLine({ kind: "tour", title: null, stations: null })).toBe(
      "Tour",
    );
  });

  it("counts a scan's camera captures", () => {
    expect(chipLine({ kind: "scan", captures: 312 })).toBe(
      "Scan - 312 camera captures",
    );
    expect(chipLine({ kind: "scan", captures: 1 })).toBe(
      "Scan - 1 camera capture",
    );
    expect(chipLine({ kind: "scan", captures: 0 })).toBe(
      "Scan - no camera captures",
    );
    expect(chipLine({ kind: "scan", captures: null })).toBe("Scan");
  });

  it("says why a file is not usable", () => {
    expect(chipLine({ kind: "neither", reason: "It is damaged." })).toBe(
      "Not usable - It is damaged.",
    );
  });
});

describe("planEntryAction", () => {
  it("waits with no rows, and offers nothing for unusable ones", () => {
    expect(planEntryAction([], none, false)).toEqual({ kind: "empty" });
    expect(planEntryAction([bad("a"), bad("b")], none, true)).toEqual({
      kind: "unusable",
      line: NOTHING_USABLE,
    });
  });

  it("opens a lone tour, and a tour with a scan, an unusable file left out", () => {
    expect(planEntryAction([tour("t")], none, false)).toEqual({
      kind: "open",
      tour: "t",
      scan: null,
      label: "Open the tour",
    });
    expect(
      planEntryAction([scan("s"), bad("x"), tour("t")], none, false),
    ).toEqual({
      kind: "open",
      tour: "t",
      scan: "s",
      label: "Open the tour with this scan",
    });
  });

  it("asks to start a new tour on a lone scan, offering the open tour too", () => {
    expect(planEntryAction([scan("s")], none, false)).toEqual({
      kind: "new-tour-on-scan",
      scan: "s",
      question: SCAN_ONLY_QUESTION,
      label: "Start a new tour on this scan",
      addToOpen: false,
    });
    expect(planEntryAction([scan("s")], none, true)).toMatchObject({
      kind: "new-tour-on-scan",
      addToOpen: true,
    });
  });

  it("waits for a pick among two tours, then opens the picked one", () => {
    const rows = [tour("a"), tour("b"), scan("s")];
    expect(planEntryAction(rows, none, false)).toEqual({
      kind: "pick",
      what: "tour",
      label: "Pick one tour above",
    });
    // A pick of a row that is no tour (or gone) is no pick.
    expect(planEntryAction(rows, { tour: "s", scan: null }, false).kind).toBe(
      "pick",
    );
    expect(planEntryAction(rows, { tour: "b", scan: null }, false)).toEqual({
      kind: "open",
      tour: "b",
      scan: "s",
      label: "Open the tour with this scan",
    });
  });

  it("waits for a pick among two scans", () => {
    const rows = [tour("t"), scan("s1"), scan("s2")];
    expect(planEntryAction(rows, none, false)).toMatchObject({
      kind: "pick",
      what: "scan",
    });
    expect(
      planEntryAction(rows, { tour: null, scan: "s2" }, false),
    ).toMatchObject({ kind: "open", tour: "t", scan: "s2" });
    expect(
      planEntryAction(
        [scan("s1"), scan("s2")],
        { tour: null, scan: "s1" },
        false,
      ),
    ).toMatchObject({ kind: "new-tour-on-scan", scan: "s1" });
  });
});

// Why: rows reach the store through an action, so a malformed one (an
// empty id, a chip of no known kind, a count that is no count) must be
// told apart before the drop area draws it.
describe("isEntryRow", () => {
  it("takes the three chips, and refuses a malformed row", () => {
    for (const row of [tour("t", "Castle"), tour("u"), scan("s"), bad("b")]) {
      expect(isEntryRow(row)).toBe(true);
    }
    for (const row of [
      null,
      "row",
      { id: "", name: "a.zip", chip: { kind: "scan", captures: 1 } },
      { id: "a", name: 3, chip: { kind: "scan", captures: 1 } },
      { id: "a", name: "a.zip", chip: { kind: "photo" } },
      { id: "a", name: "a.zip", chip: { kind: "scan", captures: -1 } },
      { id: "a", name: "a.zip", chip: { kind: "scan", captures: 1.5 } },
      { id: "a", name: "a.zip", chip: { kind: "tour", title: 4, stations: 1 } },
      { id: "a", name: "a.zip", chip: { kind: "neither" } },
    ]) {
      expect(isEntryRow(row)).toBe(false);
    }
  });
});
