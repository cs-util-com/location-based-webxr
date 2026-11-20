/**
 * The setup page's stations (polish round M2b, the L5 look) over the
 * chosen path: which steps are done, which is current, how far the route
 * on the map is drawn, and where back and next lead.
 *
 * Why these tests matter: the card shows one step at a time as an item of
 * the path's checklist. Its navigation must never offer a "Next" past
 * "Start creating" (P8) or past a step whose action opens the tour (Next
 * would reach "Create" with no tour open), nor any row on the completion
 * step (P11), must never skip a step, and the drawn route must only ever
 * grow as the creator moves on - a route that shrank while they
 * progressed would read as going backwards.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SETUP_ANSWERS, SETUP_PATHS } from "./setup-path.js";
import {
  stationSlot,
  stationView,
  STATION_ROUTE_FRACTIONS,
} from "./setup-stations.js";

const SHARE = SETUP_PATHS["share-now"];
const STARTER = SETUP_PATHS["start-here"];

describe("stationView", () => {
  it("numbers the open step on its path and marks the ones before it done", () => {
    const view = stationView(SHARE, "print");
    expect(view.number).toBe(3);
    expect(view.total).toBe(6);
    expect(view.states).toEqual([
      "done",
      "done",
      "current",
      "todo",
      "todo",
      "todo",
    ]);
    const short = stationView(STARTER, "measure");
    expect([short.number, short.total]).toEqual([2, 3]);
    expect(short.states).toEqual(["done", "current", "todo"]);
  });

  it("offers no Back on the first step", () => {
    expect(stationView(SHARE, "host").back).toBeNull();
    expect(stationView(SHARE, "host").next).toBe("link");
  });

  it("offers no Next on the create step: Start creating is its action (P8)", () => {
    const view = stationView(SHARE, "measure");
    expect(view.back).toBe("hang");
    expect(view.next).toBeNull();
    expect(view.showNav).toBe(true);
  });

  it("offers no Next past a step that opens the tour from this phone", () => {
    // Why: "Create" with no tour open can place nothing; the step's own
    // button (choose the file, save and open the starter) moves on.
    expect(stationView(STARTER, "starter").next).toBeNull();
    expect(stationView(SETUP_PATHS["file-here"], "file").next).toBeNull();
  });

  it("shows no navigation row on the completion step (P11)", () => {
    const view = stationView(SHARE, "done");
    expect(view.showNav).toBe(false);
    expect(view.back).toBeNull();
    expect(view.next).toBeNull();
  });

  it("reads no open step, or one off the path, as the first one", () => {
    expect(stationView(SHARE, null)).toEqual(stationView(SHARE, "host"));
    expect(stationView(STARTER, "print")).toEqual(
      stationView(STARTER, "starter"),
    );
  });

  it("draws the whole route only at the completion step, on every path", () => {
    for (const answer of SETUP_ANSWERS) {
      const path = SETUP_PATHS[answer];
      expect(stationView(path, "done").routeFraction).toBe(1);
      expect(stationView(path, "measure").routeFraction).toBeLessThan(1);
    }
  });

  it("puts a path's stations on the last slots of the route", () => {
    expect(stationSlot(6, 0)).toBe(0);
    expect(stationSlot(3, 0)).toBe(3);
    expect(stationSlot(3, 2)).toBe(STATION_ROUTE_FRACTIONS.length - 1);
  });

  it("is consistent for every path and pair of its steps (property)", () => {
    // Exactly one current station, the ones before it done, the ones after
    // it to do; back and next are the neighbours (where offered); the
    // route only grows with the step.
    fc.assert(
      fc.property(
        fc.constantFrom(...SETUP_ANSWERS),
        fc.nat(),
        fc.nat(),
        (answer, ra, rb) => {
          const path = SETUP_PATHS[answer];
          const ia = ra % path.length;
          const ib = rb % path.length;
          const va = stationView(path, path[ia] ?? null);
          expect(va.states.filter((s) => s === "current")).toHaveLength(1);
          expect(va.states.slice(0, ia).every((s) => s === "done")).toBe(true);
          expect(va.states.slice(ia + 1).every((s) => s === "todo")).toBe(true);
          expect(va.back === null || path.indexOf(va.back) === ia - 1).toBe(
            true,
          );
          expect(va.next === null || path.indexOf(va.next) === ia + 1).toBe(
            true,
          );
          const vb = stationView(path, path[ib] ?? null);
          expect(ia >= ib || va.routeFraction < vb.routeFraction).toBe(true);
        },
      ),
    );
  });
});
