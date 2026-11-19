/**
 * Why these tests matter: whatever mix of files lands in the drop area,
 * and whatever the person picked, the one action must keep the entry's
 * rules - a scan never opens as a tour, an unusable file is never acted
 * on, a tour opens only when it is the only one or the picked one, and a
 * scan joins only the tour it was given with or a new one.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  planEntryAction,
  type EntryAction,
  type EntryRow,
} from "./entry-drop.js";

const row = fc.record({
  kind: fc.constantFrom("tour", "scan", "neither"),
  n: fc.integer({ min: 0, max: 400 }),
});

const rowsArb = fc.array(row, { maxLength: 8 }).map((specs) =>
  specs.map(({ kind, n }, i): EntryRow => ({
    id: `r${String(i)}`,
    name: `f${String(i)}.zip`,
    chip:
      kind === "tour"
        ? { kind, title: null, stations: n }
        : kind === "scan"
          ? { kind, captures: n }
          : { kind, reason: "no" },
  })),
);

const pickArb = fc.option(
  fc.integer({ min: 0, max: 9 }).map((i) => `r${String(i)}`),
  { nil: null },
);

/** Every rule `action` breaks for `rows`, by name; none is the pass. */
function brokenRules(
  rows: readonly EntryRow[],
  picks: { tour: string | null; scan: string | null },
  tourOpen: boolean,
  action: EntryAction,
): string[] {
  const kindOf = (id: string): string | undefined =>
    rows.find((r) => r.id === id)?.chip.kind;
  const tours = rows.filter((r) => r.chip.kind === "tour").length;
  const scans = rows.filter((r) => r.chip.kind === "scan").length;
  const broken: string[] = [];
  const rule = (name: string, holds: boolean): void => {
    if (!holds) broken.push(name);
  };
  rule("no rows is empty", rows.length > 0 || action.kind === "empty");
  if (action.kind === "open") {
    rule("only a tour opens", kindOf(action.tour) === "tour");
    rule(
      "of several tours the picked one",
      tours < 2 || action.tour === picks.tour,
    );
    if (action.scan === null) rule("a scan given is not dropped", scans === 0);
    else {
      rule("only a scan is added", kindOf(action.scan) === "scan");
      rule(
        "of several scans the picked one",
        scans < 2 || action.scan === picks.scan,
      );
    }
  }
  if (action.kind === "new-tour-on-scan") {
    rule("a new tour only with no tour given", tours === 0);
    rule("the new tour gets a scan", kindOf(action.scan) === "scan");
    rule("add-to-open only with a tour open", action.addToOpen === tourOpen);
  }
  if (action.kind === "unusable") {
    rule("unusable only with nothing usable", tours + scans === 0);
  }
  rule(
    "something usable gives something to press or pick",
    tours + scans === 0 ||
      ["open", "new-tour-on-scan", "pick"].includes(action.kind),
  );
  return broken;
}

describe("planEntryAction, over any rows and picks", () => {
  it("keeps the entry's rules", () => {
    fc.assert(
      fc.property(
        rowsArb,
        pickArb,
        pickArb,
        fc.boolean(),
        (rows, tour, scan, tourOpen) => {
          const picks = { tour, scan };
          const action = planEntryAction(rows, picks, tourOpen);
          expect(brokenRules(rows, picks, tourOpen, action)).toEqual([]);
        },
      ),
    );
  });
});
